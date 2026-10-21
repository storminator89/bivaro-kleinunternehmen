import { parseBusinessDate } from '@/lib/business-date';
import { formatMoneyEUR, parseMoneyEUR } from '@/lib/money';

export type PaymentDraft = { paidAt: string; reference: string; idempotencyKey: string; fingerprint: string };
export type ConfirmedPayment = { amountCents: string; currency: 'EUR'; paidAt: string; reference: string; id: number };
export type PaymentPreflight = { amount: string; amountCents: string };

const reviewMessage = 'Der Rechnungsbetrag oder die Währung ist nicht eindeutig. Bitte Rechnungsdaten prüfen und anschließend erneut laden. Es wurde keine Zahlung gebucht.';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(reviewMessage);
  return value as Record<string, unknown>;
}

/** Consume the server's checked EUR amount, never round a displayed Float. */
export function readPaymentPreflight(value: unknown): PaymentPreflight {
  const data = record(value);
  if (data.legacyAdoptionRequired) throw new Error('Diese Rechnung ist bereits als bezahlt erfasst. Historische Zahlungsdaten müssen gesondert geprüft werden; hier wird keine weitere Zahlung gebucht.');
  if (data.event) throw new Error('Für diese Rechnung besteht bereits ein Zahlungsnachweis. Bitte die Rechnungsliste aktualisieren; keine weitere Zahlung erfassen.');
  if (data.canRecordPayment !== true) throw new Error('Für diese Rechnung kann keine neue Zahlung erfasst werden. Bitte Rechnungsstatus und vorhandene Zahlungsnachweise prüfen.');
  if (data.currency !== 'EUR') throw new Error('Nur eindeutig geprüfte EUR-Rechnungen werden unterstützt. Bitte die Rechnungswährung prüfen; keine Umrechnung oder Zahlung wurde vorgenommen.');
  const summary = record(data.summary);
  if (typeof summary.totalCents !== 'string' || !/^[1-9]\d{0,15}$/u.test(summary.totalCents)) throw new Error(reviewMessage);
  const cents = BigInt(summary.totalCents);
  const amount = formatMoneyEUR(cents);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || parseMoneyEUR(Number(amount)) !== cents) throw new Error(reviewMessage);
  if (summary.paid !== false || summary.paidCents !== '0' || summary.openCents !== summary.totalCents) {
    throw new Error('Der offene Betrag stimmt nicht mit einer ersten vollständigen Zahlung überein. Bitte Zahlungsnachweise prüfen. Teilzahlungen werden hier noch nicht unterstützt.');
  }
  const [whole, fraction = ''] = amount.split('.');
  return { amount: `${whole}.${fraction.padEnd(2, '0')}`, amountCents: summary.totalCents };
}

export function validatePaymentFields(paidAt: string, reference: string): string | null {
  try { parseBusinessDate(paidAt); } catch { return 'Bitte das tatsächliche Zahlungsdatum vollständig angeben.'; }
  if (!reference.trim() || reference.length > 255 || /[\u0000-\u001f]/u.test(reference)) return 'Bitte eine Zahlungsreferenz mit 1 bis 255 Zeichen angeben.';
  return null;
}

/** Reusing a failed request is safe only when its semantic payload is unchanged. */
export function paymentAttempt(previous: PaymentDraft | null, invoiceId: number, amount: string, paidAt: string, reference: string, uuid: () => string): PaymentDraft {
  const normalizedReference = reference.trim();
  const fingerprint = JSON.stringify([invoiceId, amount, 'EUR', paidAt, normalizedReference]);
  return { paidAt, reference, fingerprint, idempotencyKey: previous?.fingerprint === fingerprint ? previous.idempotencyKey : uuid() };
}

export function readConfirmedPayment(value: unknown, draft: PaymentDraft, invoiceId: number, amountCents: string): ConfirmedPayment {
  const data = record(value);
  const event = record(data.event);
  const summary = record(data.summary);
  if (!/^[1-9]\d{0,15}$/u.test(amountCents) || BigInt(amountCents) > BigInt(Number.MAX_SAFE_INTEGER)
    || validatePaymentFields(draft.paidAt, draft.reference) !== null
    || typeof event.id !== 'number' || !Number.isSafeInteger(event.id) || event.id <= 0 || event.invoiceId !== invoiceId
    || event.amountCents !== amountCents || event.currency !== 'EUR' || event.dateCertainty !== 'ACTUAL'
    || event.source !== 'MANUAL' || event.idempotencyKey !== draft.idempotencyKey || event.reference !== draft.reference.trim()
    || typeof event.paidAt !== 'string' || event.paidAt !== `${draft.paidAt}T00:00:00.000Z`
    || summary.paid !== true || summary.totalCents !== amountCents || summary.paidCents !== amountCents || summary.openCents !== '0') {
    throw new Error('Die Speicherbestätigung ist unvollständig. Bitte unverändert erneut versuchen oder den Zahlungsnachweis prüfen; nicht als neue Zahlung erfassen.');
  }
  return { id: event.id, amountCents, currency: 'EUR', paidAt: event.paidAt, reference: event.reference as string };
}

/** A reload after a lost response may find the exact saved attempt already present. */
export function recoverConfirmedPayment(value: unknown, invoiceId: number): ConfirmedPayment | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (!data.event || typeof data.event !== 'object') return null;
  const event = data.event as Record<string, unknown>;
  if (event.source !== 'MANUAL' || event.dateCertainty !== 'ACTUAL') return null;
  if (typeof event.idempotencyKey !== 'string' || typeof event.amountCents !== 'string'
    || typeof event.reference !== 'string' || typeof event.paidAt !== 'string') throw new Error(reviewMessage);
  return readConfirmedPayment(value, { idempotencyKey: event.idempotencyKey, paidAt: event.paidAt.slice(0, 10), reference: event.reference, fingerprint: '' }, invoiceId, event.amountCents);
}

/** Storage holds only an opaque UUID, never date/reference/amount in plain text. */
export async function paymentIdentityStorageKey(tenantId: string, invoiceId: number, fingerprint: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
  const digest = Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
  return `bivaro:payment-attempt:${encodeURIComponent(tenantId)}:${invoiceId}:${digest}`;
}

export function paymentFailure(value: unknown): string {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (data.code === 'IDEMPOTENCY_CONFLICT') return 'Diese Anfragekennung gehört zu anderen Zahlungsdaten. Bitte Zahlungsnachweis prüfen und die Liste aktualisieren; keine zweite Zahlung erfassen.';
  if (data.code === 'PAYMENT_ALREADY_EXISTS') return 'Es besteht bereits ein Zahlungsnachweis. Bitte die Liste aktualisieren und den vorhandenen Zahlungseingang prüfen.';
  if (data.code === 'FULL_PAYMENT_REQUIRED') return 'Nur die erste vollständige Zahlung ist möglich. Bitte den aktuellen Rechnungsbetrag neu laden; Teil- oder Überzahlungen werden nicht gebucht.';
  return typeof data.error === 'string' && data.error ? data.error : 'Die Zahlung wurde nicht bestätigt. Bitte unverändert erneut versuchen; Ihre Eingaben bleiben erhalten.';
}

export function displayPaymentAmount(cents: string): string {
  const amount = BigInt(cents);
  const whole = (amount / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  return `${whole},${(amount % BigInt(100)).toString().padStart(2, '0')} €`;
}
