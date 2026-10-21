import type { PaymentSummary as LedgerPaymentSummary } from '@/lib/payment-journal/contract';
import { parseBusinessDate } from '@/lib/business-date';
import { parseMoneyEUR } from '@/lib/money';

export type PaymentSummary = Pick<LedgerPaymentSummary, 'totalCents' | 'paidCents' | 'openCents' | 'paid' | 'paymentState'>;
export type PaymentDraft = { amount: string; amountCents: string; expectedPaidCents: string; expectedLedgerVersion?: string; paidAt: string; reference: string; idempotencyKey: string; fingerprint: string };
export type PaymentHistoryEvent = { id: number; invoiceId: number; amountCents: string; currency: 'EUR'; paidAt: string | null; source: string; dateCertainty: string; reference: string | null; idempotencyKey: string };
export type ConfirmedPayment = { amountCents: string; currency: 'EUR'; paidAt: string; reference: string; id: number; summary: PaymentSummary };
export type PaymentLedger = { version: 2; documentState?: string; originalReceivedCents: string; correctedCents: string; validReceivedCents: string; refundedCents: string; netRetainedCents: string; collectibleOpenCents: string; refundDueCents: string };
export type PaymentPreflight = { amount: string; amountCents: string; summary: PaymentSummary; events: PaymentHistoryEvent[]; canRecordPayment: boolean; ledger?: PaymentLedger; ledgerVersion?: string };
const reviewMessage = 'Der Rechnungsbetrag oder die Zahlungsdaten sind nicht eindeutig. Bitte Rechnungsdaten und Zahlungsnachweise prüfen. Es wurde keine Zahlung gebucht.';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(reviewMessage);
  return value as Record<string, unknown>;
}
function cents(value: unknown, positive = false): bigint {
  if (typeof value !== 'string' || !(positive ? /^[1-9]\d{0,15}$/u : /^(?:0|[1-9]\d{0,15})$/u).test(value)) throw new Error(reviewMessage);
  const result = BigInt(value);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(reviewMessage);
  return result;
}
export function paymentAmountInput(amountCents: string): string {
  const value = cents(amountCents);
  return `${value / BigInt(100)}.${(value % BigInt(100)).toString().padStart(2, '0')}`;
}
export function readPaymentLedger(value: unknown): PaymentLedger {
  const data = record(value);
  if (data.version !== 2 || (data.documentState !== undefined && !['DRAFT','SENT','PAID','CANCELLED'].includes(String(data.documentState)))) throw new Error(reviewMessage);
  const original = cents(data.originalReceivedCents), corrected = cents(data.correctedCents), valid = cents(data.validReceivedCents);
  const refunded = cents(data.refundedCents), retained = cents(data.netRetainedCents), open = cents(data.collectibleOpenCents), due = cents(data.refundDueCents);
  if (corrected + valid !== original || refunded + retained !== valid || due > retained) throw new Error(reviewMessage);
  if (data.documentState === 'CANCELLED' ? open !== BigInt(0) || due !== retained : data.documentState !== undefined && (due !== BigInt(0) || refunded !== BigInt(0))) throw new Error(reviewMessage);
  return { version: 2, ...(data.documentState === undefined ? {} : { documentState: String(data.documentState) }), originalReceivedCents: original.toString(), correctedCents: corrected.toString(), validReceivedCents: valid.toString(), refundedCents: refunded.toString(), netRetainedCents: retained.toString(), collectibleOpenCents: open.toString(), refundDueCents: due.toString() };
}
export function readPaymentSummary(value: unknown, ledger?: PaymentLedger): PaymentSummary {
  const data = record(value);
  const total = cents(data.totalCents, true), paid = cents(data.paidCents), open = cents(data.openCents);
  const paymentState = paid === total ? 'PAID' : paid > BigInt(0) ? 'PARTIAL' : 'OPEN';
  if (paid > total || (ledger ? paid.toString() !== ledger.validReceivedCents || open.toString() !== ledger.collectibleOpenCents || paid + open > total : paid + open !== total)
    || (ledger?.documentState !== undefined && ledger.documentState !== 'CANCELLED' && paid + open !== total)
    || (ledger?.documentState === 'PAID' && paid !== total) || (ledger?.documentState === 'SENT' && paid === total) || (ledger?.documentState === 'DRAFT' && paid !== BigInt(0))
    || data.paid !== (paid === total) || data.paymentState !== paymentState) throw new Error(reviewMessage);
  return { totalCents: total.toString(), paidCents: paid.toString(), openCents: open.toString(), paid: data.paid as boolean, paymentState };
}
export function readPaymentEvents(value: unknown): PaymentHistoryEvent[] {
  const data = record(value);
  if (!Array.isArray(data.events)) throw new Error(reviewMessage);
  return data.events.map(value => {
    const event = record(value);
    cents(event.amountCents, true);
    if (typeof event.id !== 'number' || !Number.isSafeInteger(event.id) || event.id <= 0
      || typeof event.invoiceId !== 'number' || !Number.isSafeInteger(event.invoiceId) || event.invoiceId <= 0 || event.currency !== 'EUR' || typeof event.source !== 'string'
      || typeof event.dateCertainty !== 'string' || typeof event.idempotencyKey !== 'string'
      || (event.reference !== null && typeof event.reference !== 'string')
      || (event.paidAt !== null && (typeof event.paidAt !== 'string' || !Number.isFinite(Date.parse(event.paidAt))))) throw new Error(reviewMessage);
    return event as PaymentHistoryEvent;
  });
}
/** Only server-derived exact cents determine the editable amount and balance. */
export function readPaymentPreflight(value: unknown): PaymentPreflight {
  const data = record(value);
  if (data.legacyAdoptionRequired) throw new Error('Historische Zahlungsdaten müssen gesondert geprüft werden; hier wird keine weitere Zahlung gebucht.');
  if (data.reviewRequired) throw new Error(reviewMessage);
  if (data.currency !== 'EUR') throw new Error('Nur eindeutig geprüfte EUR-Rechnungen werden unterstützt. Bitte Rechnungswährung prüfen.');
  const ledger = data.ledger === undefined ? undefined : readPaymentLedger(data.ledger);
  const summary = readPaymentSummary(data.summary, ledger);
  const events = readPaymentEvents(data);
  if (events.reduce((sum, event) => sum + cents(event.amountCents, true), BigInt(0)).toString() !== (ledger?.originalReceivedCents ?? summary.paidCents)) throw new Error(reviewMessage);
  if (ledger && (typeof data.ledgerVersion !== 'string' || !/^[a-f0-9]{64}$/u.test(data.ledgerVersion))) throw new Error(reviewMessage);
  return { amount: paymentAmountInput(summary.openCents), amountCents: summary.openCents, summary, events, canRecordPayment: data.canRecordPayment === true && !summary.paid && summary.openCents !== '0', ...(ledger ? { ledger, ledgerVersion: data.ledgerVersion as string } : {}) };
}
export function validatePaymentFields(paidAt: string, reference: string): string | null {
  try { parseBusinessDate(paidAt); } catch { return 'Bitte das tatsächliche Zahlungsdatum vollständig angeben.'; }
  if (!reference.trim() || reference.length > 255 || /[\u0000-\u001f]/u.test(reference)) return 'Bitte eine Zahlungsreferenz mit 1 bis 255 Zeichen angeben.';
  return null;
}
/** Accept common German decimal input, but never round sub-cent values. */
export function paymentInputCents(amount: string): string {
  if (!/^\d+(?:[.,]\d{1,2})?$/u.test(amount.trim())) throw new Error('Bitte einen positiven, centgenauen EUR-Betrag eingeben (z. B. 40,00).');
  const value = parseMoneyEUR(amount.trim().replace(',', '.'));
  if (value <= BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Bitte einen positiven, sicher buchbaren EUR-Betrag eingeben.');
  return value.toString();
}
/** Ledger baseline distinguishes later intentionally identical allocations. */
export function paymentAttempt(previous: PaymentDraft | null, invoiceId: number, amount: string, paidAt: string, reference: string, uuid: () => string, expectedPaidCents = '0', expectedLedgerVersion?: string): PaymentDraft {
  cents(expectedPaidCents);
  const amountCents = paymentInputCents(amount);
  const normalizedAmount = paymentAmountInput(amountCents);
  const fingerprint = JSON.stringify([invoiceId, normalizedAmount, 'EUR', paidAt, reference.trim(), expectedPaidCents, expectedLedgerVersion ?? null]);
  return { amount: normalizedAmount, amountCents, expectedPaidCents, ...(expectedLedgerVersion ? { expectedLedgerVersion } : {}), paidAt, reference, fingerprint, idempotencyKey: previous?.fingerprint === fingerprint ? previous.idempotencyKey : uuid() };
}
export function readConfirmedPayment(value: unknown, draft: PaymentDraft, invoiceId: number, amountCents = draft.amountCents): ConfirmedPayment {
  const data = record(value), event = record(data.event);
  const summary = readPaymentSummary(data.summary, data.ledger === undefined ? undefined : readPaymentLedger(data.ledger));
  if (validatePaymentFields(draft.paidAt, draft.reference) !== null
    || typeof event.id !== 'number' || !Number.isSafeInteger(event.id) || event.id <= 0 || event.invoiceId !== invoiceId
    || event.amountCents !== amountCents || event.currency !== 'EUR' || event.dateCertainty !== 'ACTUAL'
    || event.source !== 'MANUAL' || event.idempotencyKey !== draft.idempotencyKey || event.reference !== draft.reference.trim()
    || event.paidAt !== `${draft.paidAt}T00:00:00.000Z` || BigInt(summary.paidCents) < cents(draft.expectedPaidCents) + cents(amountCents, true)) {
    throw new Error('Die Speicherbestätigung ist unvollständig. Bitte unverändert erneut versuchen oder den Zahlungsnachweis prüfen; nicht als neue Zahlung erfassen.');
  }
  return { id: event.id, amountCents, currency: 'EUR', paidAt: event.paidAt as string, reference: event.reference as string, summary };
}
/** Existing/latest events are NOT success evidence; only the known pending key is. */
export function recoverConfirmedPayment(value: unknown, invoiceId: number, pendingKey?: string | null, pendingDraft?: PaymentDraft | null): ConfirmedPayment | null {
  if (!pendingKey) return null;
  const events = readPaymentEvents(value);
  const event = events.find(event => event.idempotencyKey === pendingKey);
  if (!event || event.source !== 'MANUAL' || event.dateCertainty !== 'ACTUAL' || !event.paidAt || !event.reference) return null;
  const draft = pendingDraft ?? paymentAttempt(null, invoiceId, paymentAmountInput(event.amountCents), event.paidAt.slice(0, 10), event.reference, () => pendingKey);
  return readConfirmedPayment({ ...record(value), event }, draft, invoiceId);
}
/** Persistent storage contains opaque identity only, never bank references or amounts. */
export function paymentPendingStorageKey(tenantId: string, invoiceId: number): string {
  return `bivaro:payment-pending:${encodeURIComponent(tenantId)}:${invoiceId}`;
}
export async function paymentIdentityStorageKey(tenantId: string, invoiceId: number, fingerprint: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
  const digest = Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
  return `bivaro:payment-attempt:${encodeURIComponent(tenantId)}:${invoiceId}:${digest}`;
}
export function paymentFailure(value: unknown): string {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (data.code === 'IDEMPOTENCY_CONFLICT') return 'Diese Anfragekennung gehört zu anderen Zahlungsdaten. Bitte Zahlungsnachweis prüfen; keine zweite Zahlung erfassen.';
  if (data.code === 'PAYMENT_STATE_CHANGED') return 'Der Zahlungssaldo hat sich zwischenzeitlich geändert. Ihre Eingaben bleiben erhalten. Bitte den aktualisierten Restbetrag prüfen und erst danach bewusst erneut bestätigen.';
  if (data.code === 'PAYMENT_EXCEEDS_OPEN') return 'Der Betrag übersteigt den offenen Restbetrag. Es wurde nichts gebucht. Bitte Betrag und aktuellen Saldo prüfen.';
  if (data.code === 'PAYMENT_ALREADY_EXISTS') return 'Es besteht bereits ein Zahlungsnachweis. Bitte den vorhandenen Zahlungseingang prüfen.';
  if (data.code === 'FULL_PAYMENT_REQUIRED') return 'Bitte den aktuellen offenen Rechnungsbetrag und die Zahlungsnachweise neu laden.';
  return typeof data.error === 'string' && data.error ? data.error : 'Die Zahlung wurde nicht bestätigt. Bitte unverändert erneut versuchen; Ihre Eingaben bleiben erhalten.';
}
export function displayPaymentAmount(cents: string): string {
  const amount = BigInt(cents);
  const whole = (amount / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  return `${whole},${(amount % BigInt(100)).toString().padStart(2, '0')} €`;
}
