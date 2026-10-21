import { Prisma } from '@prisma/client';
import { adjustmentBasisSnapshot, adjustmentFingerprint, payoutIdentity, assertOrdinaryAdjustmentInvoice } from './adjustment-evidence';
import { inTransaction, isRetryableDatabaseError } from '@/lib/db-transaction';
import { createFinancialAuditLog } from '@/lib/audit-log';
import { exactPaymentCents, paymentDate, paymentText, PaymentJournalError } from './contract';
import { ownedInvoice, assertBookable, ledgerSummary, type LedgerInvoice } from './service';
import { paymentLedgerVersion, reducePaymentLedger, type AdjustmentInput } from './adjustment-contract';

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
  if (invoice.incomes.some(income => income.cashTransaction != null)) fail('Kassenbuch-verknüpfte Zahlungen sind von diesem Ablauf ausgeschlossen.', 'CASHBOOK_ADJUSTMENT_UNSUPPORTED');
  assertOrdinaryAdjustmentInvoice(invoice);
}
export async function adjustmentEligibility(invoice: LedgerInvoice) {
  let adjustmentReviewReason: string | null = null;
  try { await assertAdjustable(invoice); } catch (error) { adjustmentReviewReason = error instanceof Error ? error.message : 'Zahlung prüfen.'; }
  const basis = cancellationBasis(invoice);
  return { canRecordAdjustment: adjustmentReviewReason === null, adjustmentReviewReason,
    eligibleCancellationBasis: basis ? { invoiceId: basis.id, invoiceNumber: basis.invoiceNumber } : null };
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
  const original = invoice.paymentJournalEvents.find(root => root.id === input.originalPaymentId);
  if (!original) throw new PaymentJournalError('Originalzahlung nicht gefunden.', 404, 'PAYMENT_NOT_FOUND');
  const prior = await tx.paymentAdjustment.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
  if (prior) {
    if (prior.invoiceId !== invoiceId || prior.originalPaymentId !== input.originalPaymentId || prior.kind !== input.kind
      || prior.amountCents !== amountCents || prior.actionDate.getTime() !== actionDate.getTime() || prior.reason !== reason
      || prior.reference !== reference || prior.cancellationInvoiceId !== (input.cancellationInvoiceId ?? null)) fail('Idempotenzschlüssel gehört zu einer anderen Finanzaktion.', 'IDEMPOTENCY_CONFLICT');
    ledgerSummary(invoice);
    return { adjustment: { ...prior, fiscalMappingStatus: 'UNREVIEWED' as const }, ...reducePaymentLedger(invoice.totalAmount!, invoice.paymentJournalEvents, invoice.paymentAdjustments, invoice.status), ledgerVersion: paymentLedgerVersion(invoice), replayed: true };
  }
  const [operation, legacyKey] = await Promise.all([
    tx.paymentOperation.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } }),
    tx.paymentJournalEvent.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } }),
  ]);
  if (operation || legacyKey) fail('Idempotenzschlüssel gehört zu einer anderen Finanzaktion.', 'IDEMPOTENCY_CONFLICT');
  await assertAdjustable(invoice);
  if (!/^[a-f0-9]{64}$/u.test(input.expectedLedgerVersion ?? '') || input.expectedLedgerVersion !== paymentLedgerVersion(invoice)) {
    throw new PaymentJournalError('Zahlungsjournal oder Stornobasis geändert. Bitte neu laden und bewusst bestätigen.', 409, 'PAYMENT_STATE_CHANGED', ledgerSummary(invoice), paymentLedgerVersion(invoice));
  }
  if (!original.paidAt || input.actionDate < original.paidAt.toISOString().slice(0, 10) || input.actionDate > today()) throw new PaymentJournalError('Datum muss zwischen ursprünglichem Zahlungstag und heute liegen.');
  const basis = input.kind === 'CUSTOMER_REFUND' ? cancellationBasis(invoice) : null;
  if (input.kind === 'CUSTOMER_REFUND' && (!basis || basis.id !== input.cancellationInvoiceId)) fail('Erstattung erfordert den passenden vollständig ausgestellten Stornobeleg.', 'REFUND_BASIS_REQUIRED');
  const payoutEvidenceIdentity = input.kind === 'CUSTOMER_REFUND' ? payoutIdentity(reference) : null;
  if (payoutEvidenceIdentity && await tx.paymentAdjustment.findUnique({ where: { userId_payoutEvidenceIdentity: { userId, payoutEvidenceIdentity } } })) fail('Dieser Auszahlungsnachweis wurde bereits verwendet.', 'DUPLICATE_PAYOUT_EVIDENCE');
  const accountingEffectiveOn = input.kind === 'PAYMENT_CORRECTION' ? original.paidAt : actionDate;
  const basisSnapshot = basis ? cancellationBasisSnapshot(invoice, basis) : null;
  const semanticFingerprint = adjustmentFingerprint({ kind: input.kind, amountCents, actionDate, accountingEffectiveOn, reason, reference }, original, basisSnapshot);
  const evidence = { originalPaymentId: original.id, kind: input.kind, amountCents };
  const reduction = reducePaymentLedger(invoice.totalAmount!, invoice.paymentJournalEvents, [...invoice.paymentAdjustments, evidence], invoice.status);
  await tx.paymentOperation.create({ data: { userId, idempotencyKey, kind: input.kind } });
  const adjustment = await tx.paymentAdjustment.create({ data: { userId, invoiceId, originalPaymentId: original.id,
    kind: input.kind, amountCents, currency: 'EUR', actionDate, accountingEffectiveOn, reason, reference,
    payoutEvidenceIdentity, cancellationInvoiceId: basis?.id ?? null, basisSnapshot: basisSnapshot ?? Prisma.DbNull,
    idempotencyKey, semanticFingerprint, contractVersion: 2 } });
  if (invoice.status !== 'CANCELLED') await tx.invoice.update({ where: { id: invoiceId, userId }, data: {
    status: reduction.summary.paid ? 'PAID' : 'SENT', paidAt: reduction.settlementDate, issuanceState: 'ISSUED',
  } });
  await createFinancialAuditLog({ userId, action: input.kind, entityType: 'Invoice', entityId: invoiceId,
    entityName: invoice.invoiceNumber ?? undefined,
    newValues: { paymentAdjustmentId: adjustment.id, originalPaymentId: original.id, kind: input.kind, amountCents, actionDate, accountingEffectiveOn,
      reason, reference, cancellationInvoiceId: basis?.id ?? null, fiscalMappingStatus: 'UNREVIEWED', contractVersion: 2 },
    metadata: { actorId: userId, tenantId: userId, operation: `invoice.${input.kind.toLowerCase()}`, originalReference: original.reference, reason },
  }, tx);
  const refreshed = await ownedInvoice(tx, userId, invoiceId);
  ledgerSummary(refreshed);
  return { adjustment: { ...adjustment, fiscalMappingStatus: 'UNREVIEWED' as const }, ...reducePaymentLedger(refreshed.totalAmount!, refreshed.paymentJournalEvents, refreshed.paymentAdjustments, refreshed.status), ledgerVersion: paymentLedgerVersion(refreshed), replayed: false };
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
