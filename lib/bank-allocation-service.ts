import 'server-only';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { inTransaction, isRetryableDatabaseError } from '@/lib/db-transaction';
import { createFinancialAuditLog } from '@/lib/audit-log';
import { bankImportRowKeys } from '@/lib/bank-import-evidence';
import { bankImportUuid, type BankImportEvidence } from '@/lib/bank-import-contract';
import { BankAllocationError, BANK_ALLOCATION_SEARCH_LIMIT, parseBankAllocationSearchInput, parseBankRecordPaymentInput, parseBankReallocationInput,
  type BankAllocationInvoice, type BankAllocationOperationReceipt, type BankAllocationPreflight, type BankAllocationRecovery, type BankAllocationResult, type BankAllocationRowEnvelope,
  type BankAllocationSearchInput, type BankRecordPaymentInput, type BankReallocationInput } from '@/lib/bank-allocation-contract';
import { parseBusinessDate } from '@/lib/business-date';
import { formatMoneyEUR } from '@/lib/money';
import { PaymentJournalError, exactPaymentCents } from '@/lib/payment-journal/contract';
import { recordFullPaymentInTransaction } from '@/lib/payment-journal/service';
import { reduceAllocationLedger } from '@/lib/payment-journal/allocation-contract';
import { financialHash } from '@/lib/payment-journal/adjustment-evidence';
import { bankBindingBasisSnapshot, allocationChangeBasisSnapshot, assertAllocationInvoice, assertSameAllocationContext } from '@/lib/payment-journal/allocation-evidence';
import { loadInvoicePaymentState, updateInvoicePaymentProjection, type InvoicePaymentState } from '@/lib/payment-journal/allocation-ledger';

type Tx = Prisma.TransactionClient;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const fail = (message: string, code = 'BANK_ALLOCATION_REVIEW_REQUIRED'): never => { throw new BankAllocationError(message, 409, code); };
const today = () => new Date().toISOString().slice(0, 10);
async function ownedRow(tx: Tx, userId: string, stableKey: string) {
  bankImportUuid(stableKey);
  const row = await tx.bankImportRow.findUnique({ where: { userId_stableKey: { userId, stableKey } }, include: { batch: true } });
  if (!row || row.batch.userId !== userId) throw new BankAllocationError('Gespeicherte Umsatzzeile nicht gefunden.', 404, 'BANK_ROW_NOT_FOUND');
  return row;
}
type SavedRow = Awaited<ReturnType<typeof ownedRow>>;
function rowEvidence(row: SavedRow) { return row.evidence as unknown as BankImportEvidence; }
export function bankRowEvidenceHash(row: Pick<SavedRow, 'stableKey' | 'sourceRow' | 'evidence'> & { batch: { sourceSha256: string } }): string {
  return financialHash(row.evidence);
}
function rowReviewReasons(row: SavedRow): string[] {
  const evidence = rowEvidence(row), reasons: string[] = [];
  try {
    if (!evidence || !Array.isArray(evidence.errors) || evidence.errors.length || evidence.currency !== 'EUR' || !evidence.date || evidence.date > today()
      || evidence.amountCents === null || !/^[1-9]\d{0,15}$/u.test(evidence.amountCents)
      || exactPaymentCents(formatMoneyEUR(BigInt(evidence.amountCents))).toString() !== evidence.amountCents
      || parseBusinessDate(evidence.date).toISOString().slice(0, 10) !== evidence.date || evidence.rowNumber !== row.sourceRow) throw new Error();
    const keys = bankImportRowKeys(row.batch.accountAlias, evidence);
    if (keys.externalKey !== row.externalKey || keys.contentKey !== row.contentKey || keys.dayAmountKey !== row.dayAmountKey || !keys.contentKey || !keys.dayAmountKey) throw new Error();
  } catch { reasons.push('Nur eine gültige positive EUR-Zeile mit eindeutigem gespeichertem Betrag und tatsächlichem Datum bis heute kann zugeordnet werden.'); }
  if (evidence?.duplicate || !evidence?.priorMatches || Object.values(evidence.priorMatches).some(count => count > 0) || (row.batch.receipt as unknown as { sameFilePreviouslySaved?: boolean }).sameFilePreviouslySaved) reasons.push('Die gespeicherten Überschneidungs- oder Dublettenhinweise benötigen Prüfung. Es wird keine weitere Zahlung erfasst.');
  return reasons;
}
async function currentOverlap(tx: Tx, userId: string, row: SavedRow) {
  const keys = (['externalKey', 'contentKey', 'dayAmountKey'] as const).flatMap(key => row[key] ? [{ [key]: row[key] }] : []);
  if (!keys.length) return true;
  return await tx.bankImportRow.findFirst({ where: { userId, id: { not: row.id }, OR: keys }, select: { id: true } }) !== null;
}
async function ambiguityReasons(tx: Tx, userId: string, row: SavedRow, selectedInvoiceId?: number) {
  const reasons = rowReviewReasons(row);
  if (await currentOverlap(tx, userId, row)) reasons.push('Eine aktuell gespeicherte Umsatzzeile überschneidet sich mit diesem Nachweis. Die mögliche Doppelzählung muss zuerst geprüft werden.');
  const evidence = rowEvidence(row);
  if (!reasons.length && evidence.date && evidence.amountCents) {
    // Exact day/amount is a conservative review signal, never external bank identity.
    // Query the whole own history, not the browser's latest-100 suggestions.
    const manual = await tx.paymentJournalEvent.findFirst({ where: { userId, source: { in: ['MANUAL', 'LEGACY_STATUS'] }, dateCertainty: 'ACTUAL',
      amountCents: evidence.amountCents, paidAt: parseBusinessDate(evidence.date), bankPaymentBinding: { is: null } }, select: { id: true } });
    if (manual) reasons.push('Ein bisher nicht bankgebundener tatsächlicher Zahlungsnachweis mit demselben Tag und Betrag könnte diesen Eingang bereits erfassen. Bitte manuell prüfen; keine automatische Verknüpfung.');
  }
  if (selectedInvoiceId !== undefined && await tx.paymentJournalEvent.findFirst({ where: { userId, invoiceId: selectedInvoiceId, source: { in: ['MANUAL', 'LEGACY_STATUS'] }, dateCertainty: 'ACTUAL', bankPaymentBinding: { is: null } }, select: { id: true } })) {
    // Initial v1 only: booking/value dates and earlier partial manual recordings can differ.
    // This is reconciliation uncertainty, NOT an invoice-wide ban on other root actions.
    reasons.push('Für diese Rechnung gibt es bereits einen nicht bankgebundenen Zahlungsnachweis. Buchungsdatum und Teilbeträge können vom CSV-Umsatz abweichen. Bitte zuerst manuell abgleichen; hier wird keine weitere Zahlung erfasst und nichts automatisch verknüpft.');
  }
  return reasons;
}
async function invoiceDto(tx: Tx, userId: string, state: InvoicePaymentState): Promise<BankAllocationInvoice> {
  const customer = state.invoice.customerId === null ? null : await tx.customer.findFirst({ where: { id: state.invoice.customerId, userId }, select: { name: true } });
  return { invoiceId: state.invoice.id, invoiceNumber: state.invoice.invoiceNumber!, customerName: customer?.name.slice(0, 255) ?? '', ledgerVersion: state.ledgerVersion,
    totalCents: state.summary.totalCents, paidCents: state.summary.paidCents, openCents: state.summary.openCents };
}
/** Older immutable roots predate PaymentOperation; their tenant-wide keys remain reserved. */
async function operationKeyExists(tx: Tx, userId: string, idempotencyKey: string): Promise<boolean> {
  const [operation, root] = await Promise.all([
    tx.paymentOperation.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } }, select: { id: true } }),
    tx.paymentJournalEvent.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } }, select: { id: true } }),
  ]);
  return operation !== null || root !== null;
}
async function bindingForRow(tx: Tx, userId: string, row: SavedRow) {
  return tx.bankPaymentBinding.findUnique({ where: { userId_bankImportRowId: { userId, bankImportRowId: row.id } } });
}
async function boundState(tx: Tx, userId: string, row: SavedRow) {
  const binding = await bindingForRow(tx, userId, row);
  if (!binding) return null;
  const original = await tx.paymentJournalEvent.findFirst({ where: { id: binding.paymentJournalEventId, userId } });
  if (!original) return fail('Der gebundene Zahlungsnachweis muss geprüft werden.');
  const origin = await loadInvoicePaymentState(tx, userId, original.invoiceId);
  const rootState = origin.rootStates.find(state => state.root.id === original.id);
  if (!rootState || rootState.binding?.id !== binding.id) return fail('Die aktuelle Zahlungszuordnung muss geprüft werden.');
  const current = rootState.currentInvoice.id === origin.invoice.id ? origin : await loadInvoicePaymentState(tx, userId, rootState.currentInvoice.id);
  const capability = current.rootCapabilities.find(value => value.originalPaymentId === original.id);
  const effective = current.effectivePayments.find(value => value.originalPaymentId === original.id);
  if (!capability || !effective || effective.bindingStableKey !== binding.stableKey || effective.allocationRevision === null || !original.paidAt) return fail('Die aktuelle Zahlungszuordnung muss geprüft werden.');
  return { binding, original, origin, current, rootState, capability, effective };
}
async function envelope(tx: Tx, userId: string, row: SavedRow, tolerateReview = false): Promise<BankAllocationRowEnvelope> {
  const base = { rowStableKey: row.stableKey, evidence: rowEvidence(row), rowEvidenceHash: bankRowEvidenceHash(row) };
  const binding = await bindingForRow(tx, userId, row);
  if (!binding) return { ...base, assignmentState: 'UNASSIGNED', bindingStableKey: null, assignmentReviewReason: null, assignment: null };
  try {
    const state = await boundState(tx, userId, row);
    if (!state) return fail('Die bestehende Zahlungszuordnung muss geprüft werden.');
    return { ...base, assignmentState: 'ASSIGNED', bindingStableKey: binding.stableKey, assignmentReviewReason: null, assignment: {
      bindingStableKey: state.binding.stableKey, originalPaymentId: state.original.id, originInvoiceId: state.origin.invoice.id, originInvoiceNumber: state.origin.invoice.invoiceNumber!,
      allocatedInvoice: await invoiceDto(tx, userId, state.current), allocationRevision: state.effective.allocationRevision!, allocationChangeStableKey: state.effective.allocationChangeStableKey,
      amountCents: state.original.amountCents, currency: 'EUR', paidAt: state.original.paidAt!.toISOString(), canReallocate: state.capability.canReallocate, reallocationReviewReason: state.capability.reallocationReviewReason,
    } };
  } catch (error) {
    if (!tolerateReview || (!(error instanceof PaymentJournalError) && !(error instanceof BankAllocationError))) throw error;
    return { ...base, assignmentState: 'REVIEW_REQUIRED', bindingStableKey: binding.stableKey, assignment: null,
      assignmentReviewReason: 'Die bestehende Zahlungszuordnung muss geprüft werden. Der unveränderte Importnachweis bleibt lesbar; bitte keine neue Zahlung erfassen.' };
  }
}
/** Bounded outer envelopes; immutable BankImportEvidence/BankImportReceipt are never extended. */
export async function readBankAllocationRowsInTransaction(tx: Tx, userId: string, rows: { stableKey: string }[]) {
  const result: BankAllocationRowEnvelope[] = [];
  for (const value of rows) result.push(await envelope(tx, userId, await ownedRow(tx, userId, value.stableKey), true));
  return result;
}
function liveInvoice(state: InvoicePaymentState) {
  if (state.allocationReviewReason !== null) fail(state.allocationReviewReason);
  assertAllocationInvoice(state.invoice);
  if (!['SENT', 'PAID'].includes(state.invoice.status)) fail('Nur eine eigene ausgestellte und nicht stornierte Rechnung ist als Ziel unterstützt.');
}
async function searchInvoices(tx: Tx, userId: string, input: BankAllocationSearchInput, origin?: InvoicePaymentState) {
  const invoices = await tx.invoice.findMany({ where: { userId, type: 'INVOICE', issuanceState: 'ISSUED', status: { in: ['SENT', 'PAID'] }, invoiceNumber: { not: null }, customerId: { not: null }, id: { gt: input.cursor },
    ...(origin ? { customerId: origin.invoice.customerId } : {}), ...(input.search ? { OR: [{ invoiceNumber: { contains: input.search } }, { customer: { name: { contains: input.search } } }] } : {}) },
    orderBy: { id: 'asc' }, take: BANK_ALLOCATION_SEARCH_LIMIT + 1, select: { id: true } });
  const results: BankAllocationInvoice[] = [];
  for (const invoice of invoices.slice(0, BANK_ALLOCATION_SEARCH_LIMIT)) {
    try {
      const state = await loadInvoicePaymentState(tx, userId, invoice.id); liveInvoice(state);
      if (origin) assertSameAllocationContext(origin.invoice, state.invoice);
      results.push(await invoiceDto(tx, userId, state));
    } catch (error) { if (!(error instanceof PaymentJournalError) && !(error instanceof BankAllocationError)) throw error; }
  }
  return { invoices: results, nextCursor: invoices.length > BANK_ALLOCATION_SEARCH_LIMIT ? invoices[BANK_ALLOCATION_SEARCH_LIMIT - 1].id : null };
}
async function preflight(tx: Tx, userId: string, row: SavedRow, input: BankAllocationSearchInput, reallocate: boolean): Promise<BankAllocationPreflight> {
  const bound = await boundState(tx, userId, row);
  const reviewReasons: string[] = reallocate ? [] : await ambiguityReasons(tx, userId, row, input.invoiceId);
  if (reallocate && !bound) fail('Für diese Zeile besteht noch keine Zahlungszuordnung.');
  if (!reallocate && bound) reviewReasons.push('Diese Umsatzzeile hat bereits genau einen Zahlungsnachweis. Die aktuelle Zuordnung wird angezeigt.');
  if (reallocate && bound && !bound.capability.canReallocate) reviewReasons.push(bound.capability.reallocationReviewReason ?? 'Diese Zuordnung kann nicht weiter geändert werden.');
  const candidates = await searchInvoices(tx, userId, input, reallocate ? bound!.origin : undefined);
  let selection: BankAllocationInvoice | null = null, afterOpenCents: string | null = null, sourceAfterOpenCents: string | null = null;
  if (input.invoiceId !== undefined) {
    const target = await loadInvoicePaymentState(tx, userId, input.invoiceId);
    try { liveInvoice(target); if (reallocate) assertSameAllocationContext(bound!.origin.invoice, target.invoice); selection = await invoiceDto(tx, userId, target); }
    catch (error) { if (!(error instanceof PaymentJournalError) && !(error instanceof BankAllocationError)) throw error; reviewReasons.push(error.message); }
    if (reallocate && target.invoice.id === bound!.current.invoice.id) reviewReasons.push('Bitte eine andere Rechnung wählen.');
    const amount = reallocate ? bound!.original.amountCents : rowEvidence(row).amountCents;
    if (amount && /^[1-9]\d{0,15}$/u.test(amount)) {
      if (BigInt(amount) > BigInt(target.summary.openCents)) reviewReasons.push('Der ganze gespeicherte Eingang übersteigt den offenen Restbetrag der Zielrechnung. Teilzuordnungen sind nicht unterstützt.');
      else if (reallocate) {
        // A read-only hypothetical assignment uses the shared projector; never new cash evidence.
        const movedRoot = { ...bound!.rootState, allocatedInvoiceId: target.invoice.id };
        const sourceRoots = bound!.current.rootStates.map(root => root.root.id === movedRoot.root.id ? movedRoot : root);
        const targetRoots = [...target.rootStates.filter(root => root.root.id !== movedRoot.root.id), movedRoot];
        sourceAfterOpenCents = reduceAllocationLedger(bound!.current.invoice.totalAmount!, bound!.current.invoice.id, bound!.current.invoice.status, sourceRoots).summary.openCents;
        afterOpenCents = reduceAllocationLedger(target.invoice.totalAmount!, target.invoice.id, target.invoice.status, targetRoots).summary.openCents;
      } else afterOpenCents = (BigInt(target.summary.openCents) - BigInt(amount)).toString();
    }
  }
  return { version: 1, row: await envelope(tx, userId, row), ...candidates, selection, canConfirm: selection !== null && reviewReasons.length === 0 && afterOpenCents !== null, reviewReasons: [...new Set(reviewReasons)], afterOpenCents, sourceAfterOpenCents };
}
export async function preflightBankPayment(userId: string, rowStableKey: string, value: unknown) {
  const input = parseBankAllocationSearchInput(value);
  return prisma.$transaction(async tx => preflight(tx, userId, await ownedRow(tx, userId, rowStableKey), input, false));
}
async function rowForBinding(tx: Tx, userId: string, stableKey: string) {
  bankImportUuid(stableKey);
  const binding = await tx.bankPaymentBinding.findUnique({ where: { userId_stableKey: { userId, stableKey } }, include: { bankImportRow: { select: { stableKey: true } } } });
  if (!binding) throw new BankAllocationError('Zahlungszuordnung nicht gefunden.', 404, 'BANK_BINDING_NOT_FOUND');
  return ownedRow(tx, userId, binding.bankImportRow.stableKey);
}
export async function preflightBankReallocation(userId: string, bindingStableKey: string, value: unknown) {
  const input = parseBankAllocationSearchInput(value);
  return prisma.$transaction(async tx => preflight(tx, userId, await rowForBinding(tx, userId, bindingStableKey), input, true));
}
function snapshot(value: Prisma.JsonValue) { if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Der unveränderliche Aktionsnachweis muss geprüft werden.'); return value as Record<string, unknown>; }
async function initialReceipt(tx: Tx, userId: string, binding: NonNullable<Awaited<ReturnType<typeof bindingForRow>>>): Promise<BankAllocationOperationReceipt> {
  const basis = snapshot(binding.basisSnapshot), root = await tx.paymentJournalEvent.findFirst({ where: { id: binding.paymentJournalEventId, userId } });
  if (!root || !root.paidAt || binding.semanticFingerprint !== financialHash(basis)) return fail('Der unveränderliche Aktionsnachweis muss geprüft werden.');
  return { kind: 'BANK_PAYMENT_RECORDED', idempotencyKey: binding.idempotencyKey, bindingStableKey: binding.stableKey, rowStableKey: String(basis.rowStableKey), originalPaymentId: root.id,
    originInvoiceId: root.invoiceId, originInvoiceNumber: String(basis.originInvoiceNumber), amountCents: root.amountCents, currency: 'EUR', paidAt: root.paidAt.toISOString(), recordedAt: binding.createdAt.toISOString(), expectedLedgerVersion: String(basis.expectedLedgerVersion), expectedRowEvidenceHash: String(basis.rowEvidenceHash) };
}
async function changeReceipt(tx: Tx, userId: string, change: Awaited<ReturnType<Tx['paymentAllocationChange']['findFirstOrThrow']>>): Promise<BankAllocationOperationReceipt> {
  const basis = snapshot(change.basisSnapshot), binding = await tx.bankPaymentBinding.findFirst({ where: { id: change.bindingId, userId }, select: { stableKey: true } });
  if (!binding || change.semanticFingerprint !== financialHash(basis)) return fail('Der unveränderliche Aktionsnachweis muss geprüft werden.');
  return { kind: 'PAYMENT_ALLOCATION_CHANGED', idempotencyKey: change.idempotencyKey, bindingStableKey: binding.stableKey, changeStableKey: change.stableKey, revision: change.revision,
    fromInvoiceId: change.fromInvoiceId, fromInvoiceNumber: String(basis.fromInvoiceNumber), toInvoiceId: change.toInvoiceId, toInvoiceNumber: String(basis.toInvoiceNumber), amountCents: change.amountCents, currency: 'EUR', actionDate: change.actionDate.toISOString().slice(0, 10), reason: change.reason, recordedAt: change.recordedAt.toISOString(), expectedSourceLedgerVersion: String(basis.expectedSourceLedgerVersion), expectedTargetLedgerVersion: String(basis.expectedTargetLedgerVersion) };
}
async function recover(tx: Tx, userId: string, row: SavedRow, key: string | null, reallocate = false): Promise<BankAllocationRecovery> {
  let operation: BankAllocationOperationReceipt | null = null;
  if (key) {
    bankImportUuid(key);
    if (reallocate) {
      const change = await tx.paymentAllocationChange.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: key } } });
      const binding = await bindingForRow(tx, userId, row);
      if (change && (!binding || binding.id !== change.bindingId)) fail('Der Schlüssel gehört zu einer anderen Finanzaktion.', 'IDEMPOTENCY_CONFLICT');
      if (change) operation = await changeReceipt(tx, userId, change);
    } else {
      const binding = await tx.bankPaymentBinding.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: key } } });
      if (binding && binding.bankImportRowId !== row.id) fail('Der Schlüssel gehört zu einer anderen Finanzaktion.', 'IDEMPOTENCY_CONFLICT');
      if (binding) operation = await initialReceipt(tx, userId, binding);
    }
    if (!operation && await operationKeyExists(tx, userId, key)) fail('Der Schlüssel gehört zu einer anderen Finanzaktion oder benötigt Prüfung.', 'IDEMPOTENCY_CONFLICT');
  }
  return { operation, row: await envelope(tx, userId, row, true) };
}
export function recoverBankPayment(userId: string, rowStableKey: string, key: string | null) { return prisma.$transaction(async tx => recover(tx, userId, await ownedRow(tx, userId, rowStableKey), key)); }
export function recoverBankReallocation(userId: string, bindingStableKey: string, key: string) { return prisma.$transaction(async tx => recover(tx, userId, await rowForBinding(tx, userId, bindingStableKey), key, true)); }
async function recordInTransaction(tx: Tx, userId: string, rowStableKey: string, input: BankRecordPaymentInput): Promise<BankAllocationResult> {
  const row = await ownedRow(tx, userId, rowStableKey);
  const prior = await tx.bankPaymentBinding.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } } });
  // Historical replay is resolved before fresh eligibility, overlap and token checks.
  if (prior) {
    const basis = snapshot(prior.basisSnapshot);
    const root = await tx.paymentJournalEvent.findFirst({ where: { id: prior.paymentJournalEventId, userId }, select: { invoiceId: true } });
    if (prior.bankImportRowId !== row.id || root?.invoiceId !== input.invoiceId || basis.rowEvidenceHash !== input.expectedRowEvidenceHash || basis.expectedLedgerVersion !== input.expectedLedgerVersion || basis.receiptConfirmed !== true) fail('Der Schlüssel gehört zu einer anderen Finanzaktion.', 'IDEMPOTENCY_CONFLICT');
    return { operation: await initialReceipt(tx, userId, prior), row: await envelope(tx, userId, row), replayed: true };
  }
  if (await operationKeyExists(tx, userId, input.idempotencyKey)) fail('Der Schlüssel gehört zu einer anderen Finanzaktion.', 'IDEMPOTENCY_CONFLICT');
  if (await bindingForRow(tx, userId, row)) fail('Diese Zeile hat bereits einen Zahlungsnachweis. Bitte die aktuelle Zuordnung laden.', 'BANK_ROW_ALREADY_BOUND');
  if (bankRowEvidenceHash(row) !== input.expectedRowEvidenceHash) fail('Der gespeicherte Zeilennachweis hat sich geändert. Bitte erneut prüfen.', 'BANK_ROW_STATE_CHANGED');
  const reasons = await ambiguityReasons(tx, userId, row, input.invoiceId);
  if (reasons.length) fail(reasons[0]);
  const target = await loadInvoicePaymentState(tx, userId, input.invoiceId); liveInvoice(target);
  if (target.ledgerVersion !== input.expectedLedgerVersion) fail('Der Zahlungsstand hat sich geändert. Bitte erneut prüfen und bewusst bestätigen.', 'PAYMENT_STATE_CHANGED');
  const basis = bankBindingBasisSnapshot(row, target.invoice, input), evidence = rowEvidence(row);
  const recorded = await recordFullPaymentInTransaction(tx, userId, input.invoiceId, { amount: formatMoneyEUR(BigInt(evidence.amountCents!)), currency: 'EUR', paidAt: evidence.date!, source: 'MANUAL',
    reference: `bank-row:${row.stableKey}`, idempotencyKey: input.idempotencyKey, expectedPaidCents: target.summary.paidCents, expectedLedgerVersion: input.expectedLedgerVersion });
  if (recorded.replayed) fail('Ein Zahlungsbeleg ohne Bankbindung muss geprüft werden. Es wird nichts automatisch verknüpft.');
  const binding = await tx.bankPaymentBinding.create({ data: { stableKey: randomUUID(), userId, bankImportRowId: row.id, paymentJournalEventId: recorded.event.id,
    idempotencyKey: input.idempotencyKey, semanticFingerprint: financialHash(basis), basisSnapshot: json(basis), contractVersion: 1 } });
  await updateInvoicePaymentProjection(tx, await loadInvoicePaymentState(tx, userId, input.invoiceId, { validateProjection: false }));
  return { operation: await initialReceipt(tx, userId, binding), row: await envelope(tx, userId, row), replayed: false };
}
async function reallocateInTransaction(tx: Tx, userId: string, bindingStableKey: string, input: BankReallocationInput): Promise<BankAllocationResult> {
  const row = await rowForBinding(tx, userId, bindingStableKey), binding = (await bindingForRow(tx, userId, row))!;
  const prior = await tx.paymentAllocationChange.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } } });
  if (prior) {
    const basis = snapshot(prior.basisSnapshot);
    if (prior.bindingId !== binding.id || prior.toInvoiceId !== input.invoiceId || prior.revision !== input.expectedAllocationRevision + 1 || prior.actionDate.toISOString().slice(0, 10) !== input.actionDate || prior.reason !== input.reason
      || basis.expectedSourceLedgerVersion !== input.expectedSourceLedgerVersion || basis.expectedTargetLedgerVersion !== input.expectedTargetLedgerVersion || basis.cashNeutralReviewed !== true) fail('Der Schlüssel gehört zu einer anderen Finanzaktion.', 'IDEMPOTENCY_CONFLICT');
    return { operation: await changeReceipt(tx, userId, prior), row: await envelope(tx, userId, row), replayed: true };
  }
  if (await operationKeyExists(tx, userId, input.idempotencyKey)) fail('Der Schlüssel gehört zu einer anderen Finanzaktion.', 'IDEMPOTENCY_CONFLICT');
  const state = (await boundState(tx, userId, row))!;
  if (state.effective.allocationRevision !== input.expectedAllocationRevision || state.current.ledgerVersion !== input.expectedSourceLedgerVersion) fail('Der Zahlungs- oder Zuordnungsstand hat sich geändert. Bitte beide Rechnungen erneut prüfen.', 'PAYMENT_STATE_CHANGED');
  if (!state.capability.canReallocate || state.rootState.adjustments.length) fail(state.capability.reallocationReviewReason ?? 'Dieser Zahlungseingang kann nicht weiter zugeordnet werden.');
  liveInvoice(state.current);
  const target = await loadInvoicePaymentState(tx, userId, input.invoiceId); liveInvoice(target);
  assertSameAllocationContext(state.origin.invoice, target.invoice);
  if (target.ledgerVersion !== input.expectedTargetLedgerVersion) fail('Der Zahlungs- oder Zuordnungsstand hat sich geändert. Bitte beide Rechnungen erneut prüfen.', 'PAYMENT_STATE_CHANGED');
  if (target.invoice.id === state.current.invoice.id) fail('Bitte eine andere Rechnung wählen.');
  if (input.actionDate < state.original.paidAt!.toISOString().slice(0, 10) || input.actionDate > today()) throw new BankAllocationError('Das Entdeckungsdatum muss zwischen ursprünglichem Zahlungstag und heute liegen.');
  if (BigInt(state.original.amountCents) > BigInt(target.summary.openCents)) fail('Der ganze Zahlungseingang übersteigt den offenen Restbetrag der Zielrechnung.', 'PAYMENT_EXCEEDS_OPEN');
  const head = state.rootState.changes.at(-1) ?? null;
  const basis = allocationChangeBasisSnapshot(binding, state.original, state.current.invoice, target.invoice, head, input);
  await tx.paymentOperation.create({ data: { userId, idempotencyKey: input.idempotencyKey, kind: 'PAYMENT_ALLOCATION_CHANGED' } });
  const change = await tx.paymentAllocationChange.create({ data: { stableKey: randomUUID(), userId, bindingId: binding.id, revision: input.expectedAllocationRevision + 1, previousChangeId: head?.id ?? null,
    fromInvoiceId: state.current.invoice.id, toInvoiceId: target.invoice.id, amountCents: state.original.amountCents, currency: 'EUR', actionDate: parseBusinessDate(input.actionDate), reason: input.reason,
    idempotencyKey: input.idempotencyKey, semanticFingerprint: financialHash(basis), basisSnapshot: json(basis), contractVersion: 1 } });
  // The shared projector, never a bank-specific balance engine, updates both sides.
  await updateInvoicePaymentProjection(tx, await loadInvoicePaymentState(tx, userId, state.current.invoice.id, { validateProjection: false }));
  await updateInvoicePaymentProjection(tx, await loadInvoicePaymentState(tx, userId, target.invoice.id, { validateProjection: false }));
  await createFinancialAuditLog({ userId, action: 'PAYMENT_ALLOCATION_CHANGED', entityType: 'Invoice', entityId: target.invoice.id,
    newValues: { bindingStableKey: binding.stableKey, allocationChangeStableKey: change.stableKey, originalPaymentId: state.original.id, fromInvoiceId: state.current.invoice.id, toInvoiceId: target.invoice.id, revision: change.revision },
    metadata: { actorId: userId, tenantId: userId, operation: 'invoice.payment-allocation-change', originalReference: `bank-row:${row.stableKey}`, reason: 'user-confirmed whole cash-neutral invoice allocation change' } }, tx);
  return { operation: await changeReceipt(tx, userId, change), row: await envelope(tx, userId, row), replayed: false };
}
async function write<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let retry = 0; ; retry++) {
    try { return await inTransaction(work); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && retry === 0) continue;
      if (isRetryableDatabaseError(error) || error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new BankAllocationError('Die Aktion ist noch nicht sicher bestätigt. Bitte zuerst mit unverändertem Schlüssel den Stand prüfen.', 503, 'PAYMENT_RETRY_REQUIRED');
      throw error;
    }
  }
}
export async function recordBankPayment(userId: string, rowStableKey: string, value: unknown) { const input = parseBankRecordPaymentInput(value); return write(tx => recordInTransaction(tx, userId, rowStableKey, input)); }
export async function reallocateBankPayment(userId: string, bindingStableKey: string, value: unknown) { const input = parseBankReallocationInput(value); return write(tx => reallocateInTransaction(tx, userId, bindingStableKey, input)); }
