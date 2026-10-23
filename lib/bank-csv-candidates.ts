import { readPaymentPreflight } from '@/lib/full-payment-form';
import { readPaymentAdjustmentPreflight } from '@/lib/payment-adjustment-form';
import type { BankInvoiceCandidate } from '@/lib/bank-csv';

export const BANK_CSV_INVOICE_LIMIT = 100;
export type BankCandidateResult = { invoices: BankInvoiceCandidate[]; reviewInvoices: { id: number; invoiceNumber: string }[]; checked: number; unavailable: number; truncated: boolean };
type InvoiceIdentity = { id: number; invoiceNumber: string; customerName: string };

/** Only identities come from the list. Money always comes from the checked journal. */
function readIdentities(value: unknown): { invoices: InvoiceIdentity[]; truncated: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Die Rechnungsliste ist unvollständig. Bitte erneut versuchen.');
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.items) || data.items.length > BANK_CSV_INVOICE_LIMIT || typeof data.total !== 'number' || !Number.isSafeInteger(data.total) || data.total < data.items.length) throw new Error('Die Rechnungsliste ist unvollständig. Bitte erneut versuchen.');
  const seen = new Set<number>();
  const invoices: InvoiceIdentity[] = [];
  for (const value of data.items) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Die Rechnungsliste ist unvollständig. Bitte erneut versuchen.');
    const row = value as Record<string, unknown>;
    if (typeof row.id !== 'number' || !Number.isSafeInteger(row.id) || row.id <= 0 || seen.has(row.id)) throw new Error('Die Rechnungsliste ist unvollständig. Bitte erneut versuchen.');
    seen.add(row.id);
    if (row.type !== 'INVOICE' || typeof row.invoiceNumber !== 'string' || !row.invoiceNumber.trim() || row.invoiceNumber.length > 255) continue;
    const customer = row.customer && typeof row.customer === 'object' && !Array.isArray(row.customer) ? row.customer as Record<string, unknown> : null;
    invoices.push({ id: row.id, invoiceNumber: row.invoiceNumber, customerName: typeof customer?.name === 'string' ? customer.name.slice(0, 255) : '' });
  }
  return { invoices, truncated: data.total > data.items.length };
}

/**
 * Read-only: CSV contents never leave this browser. The shared v2/v3 parsers
 * validate the authoritative projection. Historical v2 adjusted hints stay review-only;
 * original MANUAL events are not proof that corrected money really arrived.
 * Suggestions are bounded hints only; saved-row preflight/confirmation performs
 * complete own selection/ambiguity checks independently of this latest-100 list.
 */
export async function loadBankInvoiceCandidates(signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<BankCandidateResult> {
  const response = await fetcher(`/api/invoices?page=1&pageSize=${BANK_CSV_INVOICE_LIMIT}`, { method: 'GET', headers: { 'X-Bivaro-Payment-Contract': '3' }, cache: 'no-store', credentials: 'same-origin', signal });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Die Sitzung ist abgelaufen. Bitte erneut anmelden; die CSV wurde nicht gespeichert.' : 'Rechnungen sind gerade nicht erreichbar. Die Vorschau bleibt erhalten.');
  const identities = readIdentities(await response.json());
  const invoices: BankInvoiceCandidate[] = [];
  const reviewInvoices: BankCandidateResult['reviewInvoices'] = [];
  let cursor = 0;
  let unavailable = 0;
  async function worker() {
    while (cursor < identities.invoices.length) {
      if (signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');
      const identity = identities.invoices[cursor++];
      try {
        const ledgerResponse = await fetcher(`/api/invoices/${identity.id}/payments`, { method: 'GET', headers: { 'X-Bivaro-Payment-Contract': '3' }, cache: 'no-store', credentials: 'same-origin', signal });
        if (ledgerResponse.status === 401 || ledgerResponse.status === 403) throw new Error('SESSION_EXPIRED');
        if (!ledgerResponse.ok) { unavailable++; continue; }
        const payload: unknown = await ledgerResponse.json();
        const adjustment = readPaymentAdjustmentPreflight(payload, identity.id);
        const ledger = readPaymentPreflight(payload);
        // A wrong invoice projection must not create a plausible suggestion.
        if (ledger.events.some(event => event.invoiceId !== identity.id)) { unavailable++; continue; }
        if (ledger.ledger?.version === 3) {
          // Incoming effective roots are allocation evidence; origin events which
          // moved away must never masquerade as this invoice's current payment.
          invoices.push({ ...identity, currency: 'EUR', openCents: ledger.summary.openCents, canRecordPayment: ledger.canRecordPayment, paymentReviewRequired: false, existingPayments: adjustment.effectivePayments!.filter(root => root.validReceivedCents !== '0').map(root => ({ amountCents: root.validReceivedCents, paidAt: root.paidAt, reference: null, source: root.source })) });
          continue;
        }
        if (adjustment.adjustments.length > 0) { reviewInvoices.push({ id: identity.id, invoiceNumber: identity.invoiceNumber }); continue; }
        invoices.push({ ...identity, currency: 'EUR', openCents: ledger.summary.openCents, canRecordPayment: ledger.canRecordPayment, paymentReviewRequired: false, existingPayments: ledger.events.map(event => ({ amountCents: event.amountCents, paidAt: event.paidAt, reference: event.reference, source: event.source })) });
      } catch (error) {
        if (signal.aborted || (error instanceof Error && error.message === 'SESSION_EXPIRED')) throw error;
        unavailable++;
      }
    }
  }
  try { await Promise.all(Array.from({ length: Math.min(4, identities.invoices.length) }, worker)); }
  catch (error) {
    if (error instanceof Error && error.message === 'SESSION_EXPIRED') throw new Error('Die Sitzung ist abgelaufen. Bitte erneut anmelden; die CSV wurde nicht gespeichert.');
    throw error;
  }
  if (identities.invoices.length && !invoices.length && !reviewInvoices.length) throw new Error('Zahlungsdaten konnten nicht sicher geprüft werden. Die Vorschau bleibt erhalten. Bitte erneut versuchen oder die Rechnungen einzeln prüfen.');
  return { invoices: invoices.sort((a, b) => a.id - b.id), reviewInvoices: reviewInvoices.sort((a, b) => a.id - b.id), checked: invoices.length + reviewInvoices.length, unavailable, truncated: identities.truncated };
}
