import { SMALL_BUSINESS_EXEMPTION_REASON } from '@/lib/zugferd-generator';
import { calculateInvoiceAmounts, type InvoiceCalculationItem } from '@/lib/invoice-calculation';
import { parseMoneyEUR } from '@/lib/money';
import { getRawEInvoiceXml, parseEInvoiceXml, getEInvoiceImportRejection } from '@/lib/e-invoice-parser';
import { adjustmentReview } from './adjustment-contract';
import { assertOrdinaryAdjustmentInvoice, evidenceDate, financialHash } from './adjustment-evidence';
import { exactPaymentCents, paymentText } from './contract';
import { MAX_ALLOCATION_GRAPH_RECORDS } from './allocation-contract';
type Row = Record<string, unknown>;
export const allocationTaxContext = { taxMode: 'small-business', taxAmountCents: '0' } as const;
export function allocationCommercialHash(invoice: Row) {
  let parsed = invoice.parsedData;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const data = parsed as Row;
    const selection = data.paymentTermSelection;
    if (selection && typeof selection === 'object' && !Array.isArray(selection)) {
      // Only this documented, remapped local FK is excluded. All commercial content remains hashed.
      const { customerId: _localCustomerId, ...portableSelection } = selection as Row;
      parsed = { ...data, paymentTermSelection: portableSelection };
    }
  }
  return financialHash({ invoiceNumber: invoice.invoiceNumber, totalCents: exactPaymentCents(invoice.totalAmount as number).toString(), currency: 'EUR', parsedDataHash: financialHash(parsed) });
}
/** One supported cancellation-capable commercial basis, using the existing exact invoice engine. */
function cancellationCommercialBasis(invoice: Row): { currency: string; totalCents: string; taxAmountCents: string; lines: InvoiceCalculationItem[] } {
  let parsed = invoice.parsedData;
  if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { adjustmentReview(); } }
  const data = object(parsed), items = data.lineItems ?? data.items;
  const canonicalSmallBusiness = data.taxMode == null && Array.isArray(items) && items.length > 0 && items.every(value => {
    const line = value && typeof value === 'object' ? value as Row : {};
    return line.taxRate === 0 && line.taxCategory === 'E' && line.exemptionReason === SMALL_BUSINESS_EXEMPTION_REASON;
  });
  if (data.taxMode !== 'small-business' && !canonicalSmallBusiness) adjustmentReview('Der gespeicherte Beleg enthält keine ausdrückliche unterstützte Kleinunternehmer-Einordnung. Null allein beweist diese nicht.');
  // This normalization is evidence-derived only; never current settings or a zero-tax default.
  assertOrdinaryAdjustmentInvoice({ ...invoice, parsedData: { ...data, taxMode: 'small-business' } });
  if (!Number.isSafeInteger(invoice.customerId) || Number(invoice.customerId) <= 0 || typeof invoice.invoiceNumber !== 'string' || !invoice.invoiceNumber.trim()) adjustmentReview();
  const face = exactPaymentCents(invoice.totalAmount as number);
  const fail = () => adjustmentReview('Bankzuordnungen erfordern vollständige, widerspruchsfreie gewöhnliche Null-Umsatzsteuer-Positionen und Gesamtbeträge, die auch eine vollständige Stornierung erlauben.');
  if (data.taxAmount !== 0 || !Array.isArray(items) || items.length === 0 || items.length > MAX_ALLOCATION_GRAPH_RECORDS
    || ['isAdvanceInvoice', 'isFinalInvoice', 'reverseCharge'].some(flag => data[flag] !== undefined && data[flag] !== false)) fail();
  for (const key of ['grossAmount', 'totalAmount', 'netAmount', 'lineTotalAmount', 'dueAmount']) {
    if (data[key] != null && (typeof data[key] !== 'number' || parseMoneyEUR(data[key]) !== face)) fail();
  }
  for (const key of ['prepaidAmount', 'roundingAmount', 'allowanceTotalAmount', 'chargeTotalAmount']) if (data[key] != null && data[key] !== 0) fail();
  const normalized: InvoiceCalculationItem[] = (items as unknown[]).map(value => {
    const line = object(value), price = line.unitPrice ?? line.price;
    if (line.taxRate !== 0 || (line.taxCategory != null && line.taxCategory !== 'E') || typeof line.quantity !== 'number' || !Number.isFinite(line.quantity) || line.quantity <= 0
      || typeof price !== 'number' || !Number.isFinite(price) || price < 0
      || (line.baseQuantity != null && line.baseQuantity !== 1) || (line.priceBaseQuantity != null && line.priceBaseQuantity !== 1)
      || (line.allowances != null && (!Array.isArray(line.allowances) || line.allowances.length > 0))
      || (line.charges != null && (!Array.isArray(line.charges) || line.charges.length > 0))) fail();
    return { quantity: line.quantity as number, unitPrice: price as number, taxRate: 0, taxCategory: 'E' };
  });
  const calculated = calculateInvoiceAmounts(normalized);
  if (parseMoneyEUR(calculated.grossAmount) !== face || calculated.taxAmount !== 0) fail();
  (items as unknown[]).forEach((value, index) => {
    const line = object(value), expected = parseMoneyEUR(calculated.lines[index].netAmount);
    for (const key of ['amount', 'total', 'netAmount', 'totalAmount']) if (line[key] != null && (typeof line[key] !== 'number' || parseMoneyEUR(line[key]) !== expected)) fail();
  });
  const basis = { currency: 'EUR', totalCents: face.toString(), taxAmountCents: '0', lines: normalized };
  if (Array.isArray(data.items) && Array.isArray(data.lineItems)) {
    const alternative = cancellationCommercialBasis({ ...invoice, parsedData: { ...data, items: undefined, lineItems: data.items } });
    if (financialHash(basis) !== financialHash(alternative)) fail();
  }
  return basis;
}
/** Historical eligibility ignores later cancellation/projection changes, never missing commercial proof. */
export function assertAllocationInvoice(invoice: Row) {
  try { cancellationCommercialBasis(invoice); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'PAYMENT_REVIEW_REQUIRED') throw error; adjustmentReview('Bankzuordnung benötigt einen eindeutig prüfbaren vollständigen Rechnungs- und Stornobasisnachweis.'); }
}
/** Cancellation uses source XML when present. Prove the same supported basis before a new binding/move. */
export async function assertAllocationCancellationBasis(invoice: Row) {
  assertAllocationInvoice(invoice);
  const xml = getRawEInvoiceXml(invoice.parsedData);
  if (!xml) return;
  let parsed: Awaited<ReturnType<typeof parseEInvoiceXml>>;
  try { parsed = await parseEInvoiceXml(xml); } catch { adjustmentReview('Die gespeicherte Original-XML kann nicht als Stornobasis geprüft werden.'); }
  if (getEInvoiceImportRejection(parsed) || parsed.invoiceNumber !== invoice.invoiceNumber) adjustmentReview('Original-XML und gespeicherte Rechnung sind nicht eindeutig derselbe unterstützte Beleg.');
  let stored = invoice.parsedData;
  if (typeof stored === 'string') { try { stored = JSON.parse(stored); } catch { adjustmentReview(); } }
  try {
    const original = cancellationCommercialBasis(invoice);
    const normalized = cancellationCommercialBasis({ ...invoice, parsedData: { ...object(stored), ...parsed } });
    if (financialHash(original) !== financialHash(normalized)) adjustmentReview('Gespeicherte Rechnungsdaten und XML-Positionen widersprechen einander.');
  } catch { adjustmentReview('Gespeicherte Rechnung und Original-XML ergeben keine identische unterstützte vollständige Stornobasis.'); }
}
export function assertSameAllocationContext(origin: Row, target: Row) {
  assertAllocationInvoice(origin); assertAllocationInvoice(target);
  if (origin.userId !== target.userId || origin.customerId !== target.customerId) adjustmentReview('Nur Rechnungen desselben eigenen Kunden und ausdrücklich unterstützten Steuerkontexts können zugeordnet werden.');
}
function object(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) adjustmentReview();
  return value as Row;
}
export function allocationBasisSnapshot(binding: Row, row: Row, root: Row, originInvoice: Row, currentInvoice: Row, head: Row | null) {
  assertSameAllocationContext(originInvoice, currentInvoice);
  return { contractVersion: 1, bindingStableKey: String(binding.stableKey), rowStableKey: String(row.stableKey),
    originalPaymentKey: String(root.idempotencyKey), allocationRevision: Number(head?.revision ?? 0), allocationChangeStableKey: head ? String(head.stableKey) : null,
    originInvoiceNumber: String(originInvoice.invoiceNumber), currentInvoiceNumber: String(currentInvoice.invoiceNumber),
    amountCents: String(root.amountCents), currency: 'EUR', taxContext: allocationTaxContext,
    originCommercialHash: allocationCommercialHash(originInvoice), currentCommercialHash: allocationCommercialHash(currentInvoice) };
}
export type BindingBasisInput = { idempotencyKey: string; expectedLedgerVersion: string };
export function bankBindingBasisSnapshot(row: Row, invoice: Row, input: BindingBasisInput) {
  assertAllocationInvoice(invoice);
  const evidence = object(row.evidence);
  return { contractVersion: 1, rowStableKey: String(row.stableKey), rowEvidenceHash: financialHash(evidence), originalPaymentKey: input.idempotencyKey,
    originInvoiceNumber: String(invoice.invoiceNumber), amountCents: String(evidence.amountCents), currency: 'EUR', paidAt: String(evidence.date),
    expectedLedgerVersion: input.expectedLedgerVersion, receiptConfirmed: true, taxContext: allocationTaxContext, originCommercialHash: allocationCommercialHash(invoice) };
}
export type AllocationChangeBasisInput = { expectedAllocationRevision: number; expectedSourceLedgerVersion: string; expectedTargetLedgerVersion: string; actionDate: string; reason: string };
export function allocationChangeBasisSnapshot(binding: Row, root: Row, from: Row, to: Row, head: Row | null, input: AllocationChangeBasisInput) {
  assertSameAllocationContext(from, to);
  return { contractVersion: 1, bindingStableKey: String(binding.stableKey), originalPaymentKey: String(root.idempotencyKey),
    previousChangeStableKey: head ? String(head.stableKey) : null, fromInvoiceNumber: String(from.invoiceNumber), toInvoiceNumber: String(to.invoiceNumber),
    amountCents: String(root.amountCents), currency: 'EUR', expectedAllocationRevision: input.expectedAllocationRevision,
    expectedSourceLedgerVersion: input.expectedSourceLedgerVersion, expectedTargetLedgerVersion: input.expectedTargetLedgerVersion,
    actionDate: input.actionDate, reason: input.reason, cashNeutralReviewed: true, taxContext: allocationTaxContext,
    fromCommercialHash: allocationCommercialHash(from), toCommercialHash: allocationCommercialHash(to) };
}
/** Full historical graph: no command execution and no rejection just because a later refund froze it. */
export function validateAllocationChain(binding: Row, row: Row, root: Row, originInvoice: Row, changes: Row[], invoices: readonly Row[] | Map<number, Row>) {
  const byId = invoices instanceof Map ? invoices : new Map(invoices.map(invoice => [Number(invoice.id), invoice]));
  assertAllocationInvoice(originInvoice);
  const basis = object(binding.basisSnapshot), evidence = object(row.evidence);
  if (binding.contractVersion !== 1 || binding.userId !== originInvoice.userId || row.userId !== binding.userId || root.userId !== binding.userId
    || binding.bankImportRowId !== row.id || binding.paymentJournalEventId !== root.id || binding.idempotencyKey !== root.idempotencyKey
    || root.invoiceId !== originInvoice.id || root.source !== 'MANUAL' || root.dateCertainty !== 'ACTUAL' || root.currency !== 'EUR'
    || root.reference !== `bank-row:${row.stableKey}` || evidence.amountCents !== root.amountCents || evidence.currency !== 'EUR'
    || basis.contractVersion !== 1 || basis.rowStableKey !== row.stableKey || basis.rowEvidenceHash !== financialHash(evidence)
    || basis.originalPaymentKey !== root.idempotencyKey || basis.originInvoiceNumber !== originInvoice.invoiceNumber
    || basis.amountCents !== root.amountCents || basis.currency !== 'EUR' || basis.receiptConfirmed !== true
    || financialHash(basis.taxContext) !== financialHash(allocationTaxContext) || basis.originCommercialHash !== allocationCommercialHash(originInvoice)
    || typeof basis.expectedLedgerVersion !== 'string' || !/^[a-f0-9]{64}$/u.test(basis.expectedLedgerVersion)
    || binding.semanticFingerprint !== financialHash(basis) || changes.length > MAX_ALLOCATION_GRAPH_RECORDS) adjustmentReview();
  if (financialHash(basis) !== financialHash(bankBindingBasisSnapshot(row, originInvoice, { idempotencyKey: String(root.idempotencyKey), expectedLedgerVersion: String(basis.expectedLedgerVersion) }))) adjustmentReview();
  const paid = evidenceDate(root.paidAt);
  if (String(basis.paidAt).slice(0, 10) !== paid.toISOString().slice(0, 10) || evidence.date !== paid.toISOString().slice(0, 10)) adjustmentReview();
  let currentInvoice = originInvoice, head: Row | null = null;
  for (const change of [...changes].sort((a, b) => Number(a.revision) - Number(b.revision))) {
    const next = byId.get(Number(change.toInvoiceId)), snapshot = object(change.basisSnapshot);
    if (!next || change.contractVersion !== 1 || change.userId !== binding.userId || change.bindingId !== binding.id
      || change.revision !== Number(head?.revision ?? 0) + 1 || change.previousChangeId !== (head?.id ?? null)
      || change.fromInvoiceId !== currentInvoice.id || change.fromInvoiceId === change.toInvoiceId || change.amountCents !== root.amountCents || change.currency !== 'EUR'
      || snapshot.contractVersion !== 1 || snapshot.bindingStableKey !== binding.stableKey || snapshot.originalPaymentKey !== root.idempotencyKey
      || snapshot.previousChangeStableKey !== (head?.stableKey ?? null) || snapshot.expectedAllocationRevision !== Number(head?.revision ?? 0)
      || snapshot.fromInvoiceNumber !== currentInvoice.invoiceNumber || snapshot.toInvoiceNumber !== next.invoiceNumber
      || snapshot.amountCents !== root.amountCents || snapshot.currency !== 'EUR' || snapshot.cashNeutralReviewed !== true
      || snapshot.reason !== change.reason || String(snapshot.actionDate).slice(0, 10) !== evidenceDate(change.actionDate).toISOString().slice(0, 10)
      || snapshot.fromCommercialHash !== allocationCommercialHash(currentInvoice) || snapshot.toCommercialHash !== allocationCommercialHash(next)
      || financialHash(snapshot.taxContext) !== financialHash(allocationTaxContext)
      || !/^[a-f0-9]{64}$/u.test(String(snapshot.expectedSourceLedgerVersion)) || !/^[a-f0-9]{64}$/u.test(String(snapshot.expectedTargetLedgerVersion))
      || change.semanticFingerprint !== financialHash(snapshot)) adjustmentReview();
    paymentText(change.reason, 'Begründung', 1000); paymentText(change.idempotencyKey, 'Idempotenzschlüssel', 128);
    const action = evidenceDate(change.actionDate), recorded = evidenceDate(change.recordedAt);
    if (action.toISOString().slice(11) !== '00:00:00.000Z' || action.toISOString().slice(0, 10) < paid.toISOString().slice(0, 10) || action.toISOString().slice(0, 10) > recorded.toISOString().slice(0, 10)) adjustmentReview();
    assertSameAllocationContext(originInvoice, next);
    const expected = allocationChangeBasisSnapshot(binding, root, currentInvoice, next, head, {
      expectedAllocationRevision: Number(head?.revision ?? 0), expectedSourceLedgerVersion: String(snapshot.expectedSourceLedgerVersion),
      expectedTargetLedgerVersion: String(snapshot.expectedTargetLedgerVersion), actionDate: action.toISOString().slice(0, 10), reason: String(change.reason) });
    if (financialHash(snapshot) !== financialHash(expected)) adjustmentReview();
    head = change; currentInvoice = next;
  }
  return { currentInvoice, head, revision: Number(head?.revision ?? 0) };
}
