import { createHash } from 'node:crypto';
import { exactPaymentCents, paymentText } from './contract';
import { adjustmentReview } from './adjustment-contract';
type Row = Record<string, unknown>;
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Row).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export const financialHash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function evidenceDate(value: unknown): Date {
  if (!(value instanceof Date) && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))) adjustmentReview();
  const date = new Date(value as string | Date);
  if (!Number.isFinite(date.getTime()) || (typeof value === 'string' && date.toISOString() !== value)) adjustmentReview();
  return date;
}
export function payoutIdentity(reference: string) { return reference.normalize('NFKC').toLocaleLowerCase('de-DE').replace(/\s+/gu, ' '); }
export function adjustmentBasisSnapshot(invoice: Row, basis: Row) {
  return { contractVersion: 2, invoiceNumber: String(basis.invoiceNumber), originalInvoiceNumber: invoice.invoiceNumber == null ? null : String(invoice.invoiceNumber),
    totalCents: exactPaymentCents(invoice.totalAmount as number).toString(), currency: 'EUR', basisDate: evidenceDate(basis.invoiceDate).toISOString(),
    cancellationReason: String(basis.cancellationReason), parsedDataHash: financialHash(basis.parsedData), documentType: 'CREDIT_NOTE', issuanceState: 'ISSUED' };
}
export function adjustmentFingerprint(adjustment: Row, root: Row, basisSnapshot: unknown) {
  return financialHash({ kind: adjustment.kind, rootKey: root.idempotencyKey, amountCents: adjustment.amountCents,
    actionDate: evidenceDate(adjustment.actionDate), accountingEffectiveOn: evidenceDate(adjustment.accountingEffectiveOn),
    reason: adjustment.reason, reference: adjustment.reference, basisSnapshot });
}
/** Shared evidence graph checks for live projections and backup/restore. */
export function assertOrdinaryAdjustmentInvoice(invoice: Row) {
  let data = invoice.parsedData;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { adjustmentReview(); } }
  if (!data || typeof data !== 'object' || Array.isArray(data)) adjustmentReview();
  const parsed = data as Row;
  const items = parsed.items ?? parsed.lineItems;
  if (invoice.type !== 'INVOICE' || invoice.issuanceState !== 'ISSUED' || parsed.currency !== 'EUR'
    || parsed.taxMode !== 'small-business' || (parsed.documentType != null && !['380', 380, 'INVOICE', 'invoice'].includes(parsed.documentType as string))
    || parsed.isAdvanceInvoice === true || parsed.isFinalInvoice === true || parsed.reverseCharge === true
    || (parsed.taxAmount != null && parsed.taxAmount !== 0)
    || (Array.isArray(items) && items.some(item => !item || typeof item !== 'object' || Number((item as Row).taxRate ?? 0) !== 0
      || ((item as Row).taxCategory != null && (item as Row).taxCategory !== 'E')))) {
    adjustmentReview('Nur ausdrücklich belegte gewöhnliche EUR-Kleinunternehmerrechnungen ohne Umsatzsteuer sind hier unterstützt. Unklare Altbelege, Sonderfälle und Umsatzsteuerfälle benötigen fachliche Prüfung.');
  }
}
export function validateAdjustmentEvidence(invoice: Row, roots: Row[], adjustments: Row[], bases: Row[], cashLinkedIncomeIds: Set<number>) {
  if (adjustments.length) assertOrdinaryAdjustmentInvoice(invoice);
  const keys = new Set<string>(), payouts = new Set<string>();
  for (const adjustment of adjustments) {
    const root = roots.find(row => row.id === adjustment.originalPaymentId);
    if (!root || root.dateCertainty !== 'ACTUAL' || !['MANUAL', 'LEGACY_STATUS'].includes(String(root.source))
      || root.invoiceId !== invoice.id || (root.userId !== undefined && root.userId !== invoice.userId)
      || adjustment.invoiceId !== invoice.id || (adjustment.userId !== undefined && adjustment.userId !== invoice.userId)
      || adjustment.currency !== 'EUR' || adjustment.contractVersion !== 2 || cashLinkedIncomeIds.has(Number(root.incomeId))) adjustmentReview();
    if (paymentText(adjustment.reason, 'Begründung', 1000) !== adjustment.reason || paymentText(adjustment.reference, 'Nachweis', 255) !== adjustment.reference
      || paymentText(adjustment.idempotencyKey, 'Idempotenzschlüssel', 128) !== adjustment.idempotencyKey || keys.has(String(adjustment.idempotencyKey))) adjustmentReview();
    keys.add(String(adjustment.idempotencyKey));
    const action = evidenceDate(adjustment.actionDate), effective = evidenceDate(adjustment.accountingEffectiveOn), recorded = evidenceDate(adjustment.recordedAt), paid = evidenceDate(root.paidAt);
    if (action.toISOString().slice(11) !== '00:00:00.000Z' || action.toISOString().slice(0, 10) < paid.toISOString().slice(0, 10)
      || action.toISOString().slice(0, 10) > recorded.toISOString().slice(0, 10) || paid.toISOString().slice(0, 10) > recorded.toISOString().slice(0, 10)) adjustmentReview();
    let snapshot: unknown = null;
    if (adjustment.kind === 'PAYMENT_CORRECTION') {
      if (adjustment.cancellationInvoiceId != null || adjustment.basisSnapshot != null || adjustment.payoutEvidenceIdentity != null || effective.getTime() !== paid.getTime()) adjustmentReview();
    } else if (adjustment.kind === 'CUSTOMER_REFUND') {
      const basis = bases.find(row => row.id === adjustment.cancellationInvoiceId);
      const parsed = basis?.parsedData as Row | undefined;
      if (!basis || invoice.status !== 'CANCELLED' || basis.type !== 'CREDIT_NOTE' || basis.status !== 'SENT' || basis.issuanceState !== 'ISSUED'
        || basis.originalInvoiceId !== invoice.id || (basis.userId !== undefined && basis.userId !== invoice.userId) || basis.customerId !== invoice.customerId
        || basis.totalAmount !== -Number(invoice.totalAmount) || !basis.invoiceNumber || typeof basis.cancellationReason !== 'string' || !basis.cancellationReason.trim()
        || (parsed?.currency != null && parsed.currency !== 'EUR') || effective.getTime() !== action.getTime()
        || adjustment.payoutEvidenceIdentity !== payoutIdentity(String(adjustment.reference)) || payouts.has(String(adjustment.payoutEvidenceIdentity))) adjustmentReview();
      payouts.add(String(adjustment.payoutEvidenceIdentity));
      snapshot = adjustmentBasisSnapshot(invoice, basis);
      if (financialHash(adjustment.basisSnapshot) !== financialHash(snapshot)) adjustmentReview();
    } else adjustmentReview();
    if (adjustment.semanticFingerprint !== adjustmentFingerprint(adjustment, root, snapshot)) adjustmentReview();
  }
}
