import type { Prisma, PaymentJournalEvent, PaymentAdjustment, BankPaymentBinding, PaymentAllocationChange, BankImportRow, Income, CashTransaction } from '@prisma/client';
import { ledgerSummary, type LedgerInvoice } from './service';
import { exactPaymentCents, PaymentJournalError } from './contract';
import { financialHash, validateAdjustmentEvidence, assertOrdinaryAdjustmentInvoice, type AdjustmentAllocationProof } from './adjustment-evidence';
import { adjustmentReview } from './adjustment-contract';
import { reduceAllocationLedger, MAX_ALLOCATION_GRAPH_RECORDS, type RootCapabilities } from './allocation-contract';
import { validateAllocationChain, allocationBasisSnapshot, assertAllocationInvoice, assertAllocationCancellationBasis } from './allocation-evidence';
import { cancellationBasis } from './adjustment-service';

export type CheckedAllocationRoot = {
  root: PaymentJournalEvent; income: (Income & { cashTransaction: CashTransaction | null }) | null;
  binding: BankPaymentBinding | null; row: BankImportRow | null; changes: PaymentAllocationChange[];
  head: PaymentAllocationChange | null; currentInvoice: LedgerInvoice; originInvoice: LedgerInvoice;
  adjustments: PaymentAdjustment[]; allocatedInvoiceId: number;
  bindingStableKey: string | null; allocationRevision: number | null; allocationChangeStableKey: string | null;
};
export type InvoicePaymentState = ReturnType<typeof projectInvoicePaymentState>;
export type PaymentStateLoadOptions = { validateProjection?: boolean; onReview?: 'omit' };
const include = { incomes: { include: { cashTransaction: true }, orderBy: { id: 'asc' as const }, take: MAX_ALLOCATION_GRAPH_RECORDS + 1 }, paymentJournalEvents: { orderBy: { id: 'asc' as const }, take: MAX_ALLOCATION_GRAPH_RECORDS + 1 }, paymentAdjustments: { orderBy: { id: 'asc' as const }, take: MAX_ALLOCATION_GRAPH_RECORDS + 1 } };
function checkRelations(invoice: LedgerInvoice) { bounded(invoice.incomes); bounded(invoice.paymentJournalEvents); bounded(invoice.paymentAdjustments); bounded(invoice.creditNotes); }
const bounded = <T>(rows: T[]): T[] => { if (rows.length > MAX_ALLOCATION_GRAPH_RECORDS) adjustmentReview('Zu umfangreicher Zahlungsgraph; vollständige Prüfung erforderlich.'); return rows; };

export async function invoiceHasAllocationHistory(tx: Prisma.TransactionClient, userId: string, invoiceId: number): Promise<boolean> {
  return await tx.bankPaymentBinding.count({ where: { userId, OR: [{ paymentJournalEvent: { invoiceId } }, { allocationChanges: { some: { OR: [{ fromInvoiceId: invoiceId }, { toInvoiceId: invoiceId }] } } }] } }) > 0;
}
/** One bounded bulk closure shared by singular reads, lists and commands. */
async function loadPaymentGraph(tx: Prisma.TransactionClient, userId: string, requestedIds: number[]) {
  const initialInvoices = bounded(await tx.invoice.findMany({ where: { userId, id: { in: requestedIds } }, include, orderBy: { id: 'asc' }, take: MAX_ALLOCATION_GRAPH_RECORDS + 1 }));
  if (initialInvoices.length !== requestedIds.length) throw new PaymentJournalError('Rechnung nicht gefunden', 404, 'INVOICE_NOT_FOUND');
  initialInvoices.forEach(invoice => { bounded(invoice.incomes); bounded(invoice.paymentJournalEvents); bounded(invoice.paymentAdjustments); });
  const bindings = bounded(await tx.bankPaymentBinding.findMany({ where: { userId, OR: [
    { paymentJournalEvent: { invoiceId: { in: requestedIds } } }, { allocationChanges: { some: { OR: [{ fromInvoiceId: { in: requestedIds } }, { toInvoiceId: { in: requestedIds } }] } } },
  ] }, include: { bankImportRow: true, paymentJournalEvent: true, allocationChanges: { orderBy: { revision: 'asc' }, take: MAX_ALLOCATION_GRAPH_RECORDS + 1 } }, orderBy: { id: 'asc' }, take: MAX_ALLOCATION_GRAPH_RECORDS + 1 }));
  const roots = new Map(initialInvoices.flatMap(invoice => invoice.paymentJournalEvents).map(root => [root.id, root]));
  for (const binding of bindings) { bounded(binding.allocationChanges); roots.set(binding.paymentJournalEvent.id, binding.paymentJournalEvent); }
  bounded([...roots.values()]);
  const adjustments = roots.size ? bounded(await tx.paymentAdjustment.findMany({ where: { userId, originalPaymentId: { in: [...roots.keys()] } }, orderBy: { id: 'asc' }, take: MAX_ALLOCATION_GRAPH_RECORDS + 1 })) : [];
  const relatedIds = new Set([...requestedIds, ...[...roots.values()].map(root => root.invoiceId), ...adjustments.map(value => value.invoiceId)]);
  for (const binding of bindings) for (const change of binding.allocationChanges) { relatedIds.add(change.fromInvoiceId); relatedIds.add(change.toInvoiceId); }
  bounded([...relatedIds]);
  const requested = new Set(requestedIds), missing = [...relatedIds].filter(id => !requested.has(id));
  const relatedInvoices = missing.length ? bounded(await tx.invoice.findMany({ where: { userId, id: { in: missing } }, include, orderBy: { id: 'asc' }, take: MAX_ALLOCATION_GRAPH_RECORDS + 1 })) : [];
  if (relatedInvoices.length !== missing.length) adjustmentReview();
  relatedInvoices.forEach(invoice => { bounded(invoice.incomes); bounded(invoice.paymentJournalEvents); bounded(invoice.paymentAdjustments); });
  const cancellationIds = [...initialInvoices, ...relatedInvoices].filter(invoice => invoice.status === 'CANCELLED').map(invoice => invoice.id);
  const bases = cancellationIds.length ? bounded(await tx.invoice.findMany({ where: { userId, originalInvoiceId: { in: cancellationIds } }, orderBy: { id: 'asc' }, take: MAX_ALLOCATION_GRAPH_RECORDS + 1 })) : [];
  const invoices: LedgerInvoice[] = [...initialInvoices, ...relatedInvoices].map(invoice => ({ ...invoice, creditNotes: bases.filter(basis => basis.originalInvoiceId === invoice.id) }));
  invoices.forEach(checkRelations);
  const customerIds = [...new Set(invoices.flatMap(invoice => invoice.customerId === null ? [] : [invoice.customerId]))];
  const customers = customerIds.length ? await tx.customer.findMany({ where: { userId, id: { in: customerIds } }, select: { id: true }, take: MAX_ALLOCATION_GRAPH_RECORDS + 1 }) : [];
  const allocationReviewReasons = new Map<number, string | null>();
  for (const invoice of invoices) {
    try { await assertAllocationCancellationBasis(invoice); allocationReviewReasons.set(invoice.id, null); }
    catch (error) { allocationReviewReasons.set(invoice.id, error instanceof Error ? error.message : 'Stornobasis prüfen.'); }
  }
  return { invoices, bindings, adjustments, allocationReviewReasons, customerIds: new Set(customers.map(customer => customer.id)) };
}
function projectInvoicePaymentState(graph: Awaited<ReturnType<typeof loadPaymentGraph>>, userId: string, invoiceId: number, options: PaymentStateLoadOptions) {
  const invoice = graph.invoices.find(invoice => invoice.id === invoiceId)!;
  const bindings = graph.bindings.filter(binding => binding.paymentJournalEvent.invoiceId === invoiceId || binding.allocationChanges.some(change => change.fromInvoiceId === invoiceId || change.toInvoiceId === invoiceId));
  const rootById = new Map(invoice.paymentJournalEvents.map(root => [root.id, root]));
  for (const binding of bindings) rootById.set(binding.paymentJournalEvent.id, binding.paymentJournalEvent);
  const adjustments = graph.adjustments.filter(adjustment => rootById.has(adjustment.originalPaymentId));
  const relevantIds = new Set([invoiceId, ...[...rootById.values()].map(root => root.invoiceId), ...adjustments.map(value => value.invoiceId)]);
  for (const binding of bindings) for (const change of binding.allocationChanges) { relevantIds.add(change.fromInvoiceId); relevantIds.add(change.toInvoiceId); }
  const invoices = graph.invoices.filter(invoice => relevantIds.has(invoice.id));
  if (invoices.some(invoice => invoice.customerId !== null && !graph.customerIds.has(invoice.customerId))) adjustmentReview();
  const byInvoice = new Map(invoices.map(value => [value.id, value]));
  if (bindings.length && invoices.some(invoice => graph.allocationReviewReasons.get(invoice.id) !== null)) adjustmentReview('Historische Bankzuordnung enthält keine vollständig unterstützte übereinstimmende Rechnungs- und Stornobasis.');
  const byBinding = new Map(bindings.map(binding => [binding.paymentJournalEventId, binding]));
  const rootStates: CheckedAllocationRoot[] = [];
  const proofs = new Map<number, AdjustmentAllocationProof>();
  for (const root of rootById.values()) {
    const originInvoice = byInvoice.get(root.invoiceId)!;
    const income = root.incomeId === null ? null : originInvoice.incomes.find(value => value.id === root.incomeId) ?? null;
    if (root.userId !== userId || root.currency !== 'EUR') adjustmentReview();
    if (root.dateCertainty === 'ACTUAL') {
      if (!['MANUAL', 'LEGACY_STATUS'].includes(root.source) || !root.paidAt || !income || income.userId !== userId
        || income.invoiceId !== root.invoiceId || income.customerId !== originInvoice.customerId
        || exactPaymentCents(income.amount).toString() !== root.amountCents || income.date.getTime() !== root.paidAt.getTime()) adjustmentReview();
    }
    const binding = byBinding.get(root.id) ?? null;
    const changes = binding?.allocationChanges ?? [], row = binding?.bankImportRow ?? null;
    const chain = binding && row ? validateAllocationChain(binding, row, root, originInvoice, changes, byInvoice) : null;
    const currentInvoice = chain ? byInvoice.get(Number(chain.currentInvoice.id))! : originInvoice;
    const head = chain?.head as PaymentAllocationChange | null ?? null;
    const rootAdjustments = adjustments.filter(value => value.originalPaymentId === root.id);
    if (binding && row) {
      const snapshot = allocationBasisSnapshot(binding, row, root, originInvoice, currentInvoice, head);
      proofs.set(root.id, { bindingId: binding.id, revision: chain!.revision, changeId: head?.id ?? null, snapshot });
      // An adjustment permanently freezes this exact head. A later raw hop must not be tolerated.
      if (rootAdjustments.some(value => value.contractVersion !== 3 || value.allocationRevision !== chain!.revision || value.allocationChangeId !== (head?.id ?? null))) adjustmentReview();
    }
    rootStates.push({ root, income, binding, row, changes, head, currentInvoice, originInvoice, adjustments: rootAdjustments, allocatedInvoiceId: currentInvoice.id,
      bindingStableKey: binding?.stableKey ?? null, allocationRevision: binding ? chain!.revision : null, allocationChangeStableKey: head?.stableKey ?? null });
  }
  // Validate evidence against the affected/current invoice, never a falsified origin root.invoiceId.
  for (const current of invoices) {
    const linked = adjustments.filter(value => value.invoiceId === current.id);
    if (!linked.length) continue;
    validateAdjustmentEvidence(current, [...rootById.values()], linked, current.creditNotes,
      new Set(rootStates.filter(value => value.income?.cashTransaction).map(value => value.income!.id)), proofs);
  }
  // Every origin Income is covered exactly once. Unknown/unbound legacy invariants stay the old v2 contract.
  for (const origin of invoices.filter(value => [...rootById.values()].some(root => root.invoiceId === value.id))) {
    const roots = origin.paymentJournalEvents;
    if (new Set(roots.filter(root => root.incomeId !== null).map(root => root.incomeId)).size !== origin.incomes.length) adjustmentReview();
  }
  const requiresV3 = bindings.length > 0 || adjustments.some(a => a.contractVersion === 3);
  if (!requiresV3 && options.validateProjection !== false) ledgerSummary(invoice);
  let reduced: ReturnType<typeof reduceAllocationLedger>;
  try { reduced = reduceAllocationLedger(invoice.totalAmount!, invoice.id, invoice.status, rootStates); }
  catch (error) { if (error instanceof PaymentJournalError && error.code === 'INVALID_PAYMENT') adjustmentReview('Rechnungsbetrag ist nicht eindeutig prüfbar.'); throw error; }
  if (options.validateProjection !== false && requiresV3) {
    if (invoice.status !== 'CANCELLED' && invoice.status !== (reduced.summary.paid ? 'PAID' : 'SENT') && !(invoice.status === 'DRAFT' && rootStates.length === 0)) adjustmentReview();
    if (invoice.status !== 'CANCELLED' && ((reduced.summary.paid ? reduced.settlementDate?.getTime() ?? null : null) !== (invoice.paidAt?.getTime() ?? null))) adjustmentReview();
  }
  const basis = cancellationBasis(invoice);
  const eligibleCancellationBasis = basis ? { invoiceId: basis.id, invoiceNumber: basis.invoiceNumber } : null;
  const rootCapabilities: RootCapabilities[] = reduced.effectivePayments.map(effective => {
    const state = rootStates.find(value => value.root.id === effective.originalPaymentId)!;
    let common: string | null = null;
    try {
      if (state.binding) assertAllocationInvoice(invoice); else assertOrdinaryAdjustmentInvoice(invoice);
      if (!['SENT', 'PAID', 'CANCELLED'].includes(invoice.status) || state.root.dateCertainty !== 'ACTUAL' || !state.root.paidAt
        || state.root.paidAt.toISOString().slice(0, 10) > new Date().toISOString().slice(0, 10)) throw new Error('Nur belegte tatsächliche Zahlungen unterstützen diese Aktion.');
      if (state.income?.cashTransaction) throw new Error('Diese Zahlung ist mit dem Kassenbuch verknüpft.');
    } catch (error) { common = error instanceof Error ? error.message : 'Zahlung prüfen.'; }
    const remaining = effective.retainedCents;
    const correctionReviewReason = common ?? (remaining === '0' ? 'Kein verbleibender Betrag.' : null);
    const refundReviewReason = common ?? (!basis ? 'Passender vollständiger Stornobeleg erforderlich.' : remaining === '0' ? 'Kein verbleibender Betrag.' : null);
    let reallocationReviewReason: string | null = common;
    if (!reallocationReviewReason) {
      try { assertAllocationInvoice(invoice); } catch (error) { reallocationReviewReason = error instanceof Error ? error.message : 'Rechnung prüfen.'; }
      reallocationReviewReason ??= !state.binding ? 'Nur bewusst gespeicherte Bankzuordnungen können verschoben werden.' : state.adjustments.length ? 'Nach einer Korrektur oder Erstattung bleibt diese Zuordnung eingefroren.' : invoice.status === 'CANCELLED' ? 'Stornierte Rechnungen können nicht neu zugeordnet werden.' : null;
    }
    return { originalPaymentId: effective.originalPaymentId, correctableCents: correctionReviewReason ? '0' : remaining,
      refundableCents: refundReviewReason ? '0' : remaining, canCorrect: correctionReviewReason === null, canRefund: refundReviewReason === null,
      canReallocate: reallocationReviewReason === null, correctionReviewReason, refundReviewReason, reallocationReviewReason };
  });
  const allocationHistory = bindings.flatMap(binding => binding.allocationChanges).filter(change => change.fromInvoiceId === invoiceId || change.toInvoiceId === invoiceId).sort((a, b) => a.id - b.id);
  // Explicit selected fields: include every current head even A -> B -> A, and root-wide adjustments.
  const ledgerVersion = financialHash({ contract: 3, invoice: { id: invoice.id, userId, type: invoice.type, status: invoice.status, issuanceState: invoice.issuanceState, customerId: invoice.customerId,
    invoiceNumber: invoice.invoiceNumber, totalAmount: invoice.totalAmount, paidAt: invoice.paidAt, parsedData: invoice.parsedData },
    roots: rootStates.map(state => ({ root: state.root, income: state.income, binding: state.binding, changes: state.changes, adjustments: state.adjustments, currentInvoiceId: state.allocatedInvoiceId })), creditNotes: invoice.creditNotes });
  return { invoice, allocationReviewReason: graph.allocationReviewReasons.get(invoice.id) ?? null, ...reduced, originEvents: invoice.paymentJournalEvents, rootStates, rootCapabilities, adjustments: adjustments.filter(adjustment => rootStates.some(state => state.root.id === adjustment.originalPaymentId && (state.root.invoiceId === invoiceId || state.allocatedInvoiceId === invoiceId))), allocationHistory,
    ledgerVersion, eligibleCancellationBasis, requiresV3 };
}
/** Missing map entries under onReview:'omit' mean review-only, NEVER zero/unpaid. */
export async function loadInvoicePaymentStates(tx: Prisma.TransactionClient, userId: string, invoiceIds: readonly number[], options: PaymentStateLoadOptions = {}): Promise<Map<number, InvoicePaymentState>> {
  const ids = [...new Set(invoiceIds)];
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new PaymentJournalError('Ungültige Rechnungs-ID');
  if (!ids.length) return new Map();
  bounded(ids);
  let graph: Awaited<ReturnType<typeof loadPaymentGraph>>;
  try { graph = await loadPaymentGraph(tx, userId, ids); }
  catch (error) { if (options.onReview === 'omit' && error instanceof PaymentJournalError && error.code === 'PAYMENT_REVIEW_REQUIRED') return new Map(); throw error; }
  const result = new Map<number, InvoicePaymentState>();
  for (const id of ids) {
    try { result.set(id, projectInvoicePaymentState(graph, userId, id, options)); }
    catch (error) {
      const sourceError = error instanceof PaymentJournalError && error.code === 'INVALID_PAYMENT'
        ? new PaymentJournalError('Rechnungsbetrag oder Zahlungsnachweise sind nicht eindeutig prüfbar.', 409, 'PAYMENT_REVIEW_REQUIRED') : error;
      if (!(options.onReview === 'omit' && sourceError instanceof PaymentJournalError && sourceError.code === 'PAYMENT_REVIEW_REQUIRED')) throw sourceError;
    }
  }
  return result;
}
export async function loadInvoicePaymentState(tx: Prisma.TransactionClient, userId: string, invoiceId: number, options: PaymentStateLoadOptions = {}): Promise<InvoicePaymentState> {
  const states = await loadInvoicePaymentStates(tx, userId, [invoiceId], { validateProjection: options.validateProjection });
  return states.get(invoiceId)!;
}
export async function updateInvoicePaymentProjection(tx: Prisma.TransactionClient, state: InvoicePaymentState) {
  if (state.invoice.status === 'CANCELLED') return;
  await tx.invoice.update({ where: { id: state.invoice.id, userId: state.invoice.userId }, data: { status: state.summary.paid ? 'PAID' : 'SENT', paidAt: state.summary.paid ? state.settlementDate : null, issuanceState: 'ISSUED' } });
}
export function invoicePaymentResponse(state: InvoicePaymentState) {
  const canRecordAdjustment = state.rootCapabilities.some(value => value.canCorrect || value.canRefund);
  return { paymentContractVersion: 3 as const, currency: 'EUR' as const, ledger: state.ledger, summary: state.summary, ledgerVersion: state.ledgerVersion,
    originEvents: state.originEvents, events: state.originEvents, event: state.originEvents.length === 1 ? state.originEvents[0] : null,
    originAssignments: state.rootPayments.filter(root => root.originInvoiceId === state.invoice.id),
    effectivePayments: state.effectivePayments, rootCapabilities: state.rootCapabilities,
    adjustments: state.adjustments.map(adjustment => ({ ...adjustment, fiscalMappingStatus: 'UNREVIEWED' as const })), allocationHistory: state.allocationHistory,
    adjustmentCapacities: state.rootCapabilities.map(value => ({ originalPaymentId: value.originalPaymentId, correctableCents: value.correctableCents, refundableCents: value.refundableCents })),
    canRecordAdjustment, adjustmentReviewReason: canRecordAdjustment ? null : state.rootCapabilities[0]?.correctionReviewReason ?? 'Keine geeignete tatsächliche Zahlung.',
    eligibleCancellationBasis: state.eligibleCancellationBasis, legacyAdoptionRequired: state.invoice.status === 'PAID' && state.originEvents.length === 0 && state.effectivePayments.length === 0,
    reviewRequired: false, canRecordPayment: !state.summary.paid && ['DRAFT', 'SENT'].includes(state.invoice.status) };
}
export function requireV3PaymentCapability(state: Pick<InvoicePaymentState, 'requiresV3'>, version: number) {
  if (state.requiresV3 && version !== 3) throw new PaymentJournalError('Dieser Zahlungsstand erfordert Zahlungsjournal-Vertrag 3.', 409, 'PAYMENT_CAPABILITY_REQUIRED');
}
