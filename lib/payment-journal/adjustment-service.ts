import { Prisma } from '@prisma/client';
import { adjustmentBasisSnapshot, adjustmentFingerprint, payoutIdentity, assertOrdinaryAdjustmentInvoice } from './adjustment-evidence';
import { inTransaction, isRetryableDatabaseError } from '@/lib/db-transaction';
import { createFinancialAuditLog } from '@/lib/audit-log';
import { exactPaymentCents, paymentDate, paymentText, PaymentJournalError } from './contract';
import { ownedInvoice, assertBookable, ledgerSummary, type LedgerInvoice } from './service';
import { paymentLedgerVersion, reducePaymentLedger, type AdjustmentInput } from './adjustment-contract';
import { loadInvoicePaymentState, updateInvoicePaymentProjection, invoicePaymentResponse, type InvoicePaymentState } from './allocation-ledger';
import { reduceAllocationLedger } from './allocation-contract';
import { allocationBasisSnapshot } from './allocation-evidence';

const fail = (message: string, code = 'PAYMENT_REVIEW_REQUIRED'): never => { throw new PaymentJournalError(message, 409, code); };
const today = () => new Date().toISOString().slice(0, 10);
export function cancellationBasis(invoice: LedgerInvoice) {
  if (invoice.status !== 'CANCELLED' || invoice.creditNotes.length !== 1) return null;
  const basis = invoice.creditNotes[0];
  if (basis.userId !== invoice.userId || basis.originalInvoiceId !== invoice.id || basis.type !== 'CREDIT_NOTE'
    || basis.status !== 'SENT' || basis.issuanceState !== 'ISSUED' || basis.customerId !== invoice.customerId
    || !basis.invoiceNumber || !basis.cancellationReason?.trim() || !basis.invoiceDate
    || basis.totalAmount !== -invoice.totalAmount!) return null;
  const parsed = basis.parsedData;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.currency != null && parsed.currency !== 'EUR') return null;
  return basis;
}
export function cancellationBasisSnapshot(invoice: LedgerInvoice, basis: NonNullable<ReturnType<typeof cancellationBasis>>) {
  return adjustmentBasisSnapshot(invoice, basis);
}
export async function assertAdjustable(invoice: LedgerInvoice) {
  await assertBookable(invoice);
  ledgerSummary(invoice);
  if (invoice.issuanceState !== 'ISSUED' || !['SENT', 'PAID', 'CANCELLED'].includes(invoice.status)
    || !invoice.paymentJournalEvents.length || invoice.paymentJournalEvents.some(root => root.dateCertainty !== 'ACTUAL'
      || !root.paidAt || root.paidAt.toISOString().slice(0, 10) > today())) fail('Nur eindeutig belegte tatsächliche EUR-Zahlungen können korrigiert werden; Legacy-Nachweise benötigen Prüfung.');
  if (invoice.paymentJournalEvents.every(root => invoice.incomes.find(income => income.id === root.incomeId)?.cashTransaction != null)) fail('Kassenbuch-verknüpfte Zahlungen sind von diesem Ablauf ausgeschlossen.', 'CASHBOOK_ADJUSTMENT_UNSUPPORTED');
  assertOrdinaryAdjustmentInvoice(invoice);
}
export async function adjustmentEligibility(invoice: LedgerInvoice) {
  let adjustmentReviewReason: string | null = null;
  try { await assertAdjustable(invoice); } catch (error) { adjustmentReviewReason = error instanceof Error ? error.message : 'Zahlung prüfen.'; }
  const basis = cancellationBasis(invoice);
  return { canRecordAdjustment: adjustmentReviewReason === null, adjustmentReviewReason,
    eligibleCancellationBasis: basis ? { invoiceId: basis.id, invoiceNumber: basis.invoiceNumber } : null };
}

function resultForState(state: InvoicePaymentState) {
  return state.requiresV3 ? invoicePaymentResponse(state) : { ...reducePaymentLedger(state.invoice.totalAmount!, state.invoice.paymentJournalEvents, state.invoice.paymentAdjustments, state.invoice.status), ledgerVersion: paymentLedgerVersion(state.invoice) };
}
export async function recordPaymentAdjustmentInTransaction(tx: Prisma.TransactionClient, userId: string, invoiceId: number, input: AdjustmentInput) {
  if (!['PAYMENT_CORRECTION', 'CUSTOMER_REFUND'].includes(input.kind)) throw new PaymentJournalError('Nicht unterstützte Zahlungsaktion.');
  if (!Number.isSafeInteger(input.originalPaymentId) || input.originalPaymentId <= 0) throw new PaymentJournalError('Originalzahlung fehlt.');
  if (typeof input.amount !== 'string') throw new PaymentJournalError('Berichtigungsbetrag muss als centgenaue EUR-Zeichenfolge angegeben werden.');
  const amountCents = exactPaymentCents(input.amount).toString();
  const actionDate = paymentDate(input.actionDate);
  const reason = paymentText(input.reason, 'Begründung', 1000);
  const reference = paymentText(input.reference, 'Nachweisbezug', 255);
  const idempotencyKey = paymentText(input.idempotencyKey, 'Idempotenzschlüssel', 128);
  if (input.kind === 'PAYMENT_CORRECTION' && (input.declarationNeverReceived !== true || input.cancellationInvoiceId !== undefined)) {
    throw new PaymentJournalError('Bitte ausdrücklich bestätigen: Nur der nie eingegangene Betrag wird berichtigt; keine Umbuchung echten Geldes.');
  }
  if (input.kind === 'CUSTOMER_REFUND' && (input.declarationNeverReceived !== undefined || !Number.isSafeInteger(input.cancellationInvoiceId))) throw new PaymentJournalError('Originalverknüpfter vollständiger Stornobeleg fehlt.');
  const invoice = await ownedInvoice(tx, userId, invoiceId);
  // Resolve a known success before testing today's head, capacity, cancellation or ledger token.
  const prior = await tx.paymentAdjustment.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
  if (prior) {
    if (prior.invoiceId !== invoiceId || prior.originalPaymentId !== input.originalPaymentId || prior.kind !== input.kind
      || prior.amountCents !== amountCents || prior.actionDate.getTime() !== actionDate.getTime() || prior.reason !== reason
      || prior.reference !== reference || prior.cancellationInvoiceId !== (input.cancellationInvoiceId ?? null)
      || (prior.contractVersion === 3 ? prior.allocationRevision !== input.expectedAllocationRevision : input.expectedAllocationRevision !== undefined)) fail('Idempotenzschlüssel gehört zu einer anderen Finanzaktion.', 'IDEMPOTENCY_CONFLICT');
    const current = await loadInvoicePaymentState(tx, userId, invoiceId);
    return { adjustment: { ...prior, fiscalMappingStatus: 'UNREVIEWED' as const }, ...resultForState(current), replayed: true };
  }
  const [operation, legacyKey] = await Promise.all([
    tx.paymentOperation.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } }),
    tx.paymentJournalEvent.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } }),
  ]);
  if (operation || legacyKey) fail('Idempotenzschlüssel gehört zu einer anderen Finanzaktion.', 'IDEMPOTENCY_CONFLICT');
  const state = await loadInvoicePaymentState(tx, userId, invoiceId);
  const selected = state.rootStates.find(value => value.root.id === input.originalPaymentId && value.allocatedInvoiceId === invoiceId);
  if (!selected) throw new PaymentJournalError('Aktuell zugeordnete Originalzahlung nicht gefunden.', 404, 'PAYMENT_NOT_FOUND');
  const original = selected.root;
  await assertBookable(invoice);
  const currentVersion = state.requiresV3 ? state.ledgerVersion : paymentLedgerVersion(invoice);
  if (!/^[a-f0-9]{64}$/u.test(input.expectedLedgerVersion ?? '')
    || (input.expectedLedgerVersion !== state.ledgerVersion && (state.requiresV3 || input.expectedLedgerVersion !== currentVersion))
    || (selected.binding ? !Number.isSafeInteger(input.expectedAllocationRevision) || input.expectedAllocationRevision !== selected.allocationRevision : input.expectedAllocationRevision !== undefined)) {
    throw new PaymentJournalError('Zahlungsjournal, Zuordnung oder Stornobasis geändert. Bitte neu laden und bewusst bestätigen.', 409, 'PAYMENT_STATE_CHANGED', state.summary, currentVersion);
  }
  if (selected.income?.cashTransaction) fail('Kassenbuch-verknüpfte Zahlungen sind von diesem Ablauf ausgeschlossen.', 'CASHBOOK_ADJUSTMENT_UNSUPPORTED');
  const capability = state.rootCapabilities.find(value => value.originalPaymentId === original.id)!;
  if (!(input.kind === 'PAYMENT_CORRECTION' ? capability.canCorrect : capability.canRefund)) fail((input.kind === 'PAYMENT_CORRECTION' ? capability.correctionReviewReason : capability.refundReviewReason) ?? 'Diese Zahlung muss geprüft werden.');
  if (!original.paidAt || input.actionDate < original.paidAt.toISOString().slice(0, 10) || input.actionDate > today()) throw new PaymentJournalError('Datum muss zwischen ursprünglichem Zahlungstag und heute liegen.');
  const basis = input.kind === 'CUSTOMER_REFUND' ? cancellationBasis(invoice) : null;
  if (input.kind === 'CUSTOMER_REFUND' && (!basis || basis.id !== input.cancellationInvoiceId)) fail('Erstattung erfordert den passenden vollständig ausgestellten Stornobeleg.', 'REFUND_BASIS_REQUIRED');
  const payoutEvidenceIdentity = input.kind === 'CUSTOMER_REFUND' ? payoutIdentity(reference) : null;
  if (payoutEvidenceIdentity && await tx.paymentAdjustment.findUnique({ where: { userId_payoutEvidenceIdentity: { userId, payoutEvidenceIdentity } } })) fail('Dieser Auszahlungsnachweis wurde bereits verwendet.', 'DUPLICATE_PAYOUT_EVIDENCE');
  const accountingEffectiveOn = input.kind === 'PAYMENT_CORRECTION' ? original.paidAt : actionDate;
  const basisSnapshot = basis ? cancellationBasisSnapshot(invoice, basis) : null;
  const allocationSnapshot = selected.binding && selected.row ? allocationBasisSnapshot(selected.binding, selected.row, original, selected.originInvoice, invoice, selected.head) : null;
  const contractVersion = allocationSnapshot ? 3 : 2;
  const semanticFingerprint = adjustmentFingerprint({ kind: input.kind, amountCents, actionDate, accountingEffectiveOn, reason, reference, contractVersion, allocationBasisSnapshot: allocationSnapshot }, original, basisSnapshot);
  const evidence = { originalPaymentId: original.id, kind: input.kind, amountCents };
  // All prior corrections/refunds on this physical root consume the SAME capacity, even across invoice IDs.
  const reduction = reduceAllocationLedger(invoice.totalAmount!, invoiceId, invoice.status, state.rootStates.map(value => value === selected ? { ...value, adjustments: [...value.adjustments, evidence] } : value));
  await tx.paymentOperation.create({ data: { userId, idempotencyKey, kind: input.kind } });
  const adjustment = await tx.paymentAdjustment.create({ data: { userId, invoiceId, originalPaymentId: original.id,
    kind: input.kind, amountCents, currency: 'EUR', actionDate, accountingEffectiveOn, reason, reference,
    payoutEvidenceIdentity, cancellationInvoiceId: basis?.id ?? null, basisSnapshot: basisSnapshot ?? Prisma.DbNull,
    idempotencyKey, semanticFingerprint, contractVersion, allocationBindingId: selected.binding?.id ?? null,
    allocationRevision: selected.allocationRevision, allocationChangeId: selected.head?.id ?? null, allocationBasisSnapshot: allocationSnapshot ?? Prisma.DbNull } });
  await updateInvoicePaymentProjection(tx, { ...state, ...reduction });
  await createFinancialAuditLog({ userId, action: input.kind, entityType: 'Invoice', entityId: invoiceId,
    entityName: invoice.invoiceNumber ?? undefined,
    newValues: { paymentAdjustmentId: adjustment.id, originalPaymentId: original.id, kind: input.kind, amountCents, actionDate, accountingEffectiveOn,
      reason, reference, cancellationInvoiceId: basis?.id ?? null, fiscalMappingStatus: 'UNREVIEWED', contractVersion,
      ...(allocationSnapshot ? { allocationBasisSnapshot: allocationSnapshot } : {}) },
    metadata: { actorId: userId, tenantId: userId, operation: `invoice.${input.kind.toLowerCase()}`, originalReference: original.reference, reason },
  }, tx);
  const refreshed = await loadInvoicePaymentState(tx, userId, invoiceId);
  return { adjustment: { ...adjustment, fiscalMappingStatus: 'UNREVIEWED' as const }, ...resultForState(refreshed), replayed: false };
}
export async function recordPaymentAdjustment(userId: string, invoiceId: number, input: AdjustmentInput) {
  for (let retry = 0; ; retry++) {
    try { return await inTransaction(tx => recordPaymentAdjustmentInTransaction(tx, userId, invoiceId, input)); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && retry === 0) continue;
      if (isRetryableDatabaseError(error) || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw new PaymentJournalError('Finanzaktion nicht sicher bestätigt. Mit unverändertem Schlüssel erneut versuchen.', 503, 'PAYMENT_RETRY_REQUIRED');
      throw error;
    }
  }
}
