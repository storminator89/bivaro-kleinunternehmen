import { formatMoneyEUR, parseMoneyEUR, type MoneyInput } from '@/lib/money';
import { parseBusinessDate } from '@/lib/business-date';

export class PaymentJournalError extends Error {
  constructor(message: string, public status = 400, public code = 'INVALID_PAYMENT') { super(message); }
}

export type FullPaymentInput = {
  amount: MoneyInput;
  currency: string;
  paidAt: string;
  source: 'MANUAL' | 'LEGACY_STATUS';
  reference: string;
  idempotencyKey: string;
};

export function exactPaymentCents(value: unknown): bigint {
  try {
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error();
    const cents = parseMoneyEUR(value);
    if (cents <= BigInt(0) || cents > BigInt(Number.MAX_SAFE_INTEGER)
      || parseMoneyEUR(Number(formatMoneyEUR(cents))) !== cents) throw new Error();
    return cents;
  } catch {
    throw new PaymentJournalError('Der Zahlungsbetrag muss positiv, centgenau und sicher als EUR buchbar sein.');
  }
}

/** New payments are calendar dates; the old status API additionally accepts exact ISO instants. */
export function paymentDate(value: unknown, allowInstant = false): Date {
  try {
    if (typeof value !== 'string') throw new Error();
    if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return parseBusinessDate(value);
    if (!allowInstant || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) throw new Error();
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.toISOString().replace('.000Z', 'Z') !== value.replace('.000Z', 'Z')) throw new Error();
    return date;
  } catch {
    throw new PaymentJournalError('Bitte das tatsächliche Zahlungsdatum als YYYY-MM-DD angeben.', 400, 'PAYMENT_DATE_REQUIRED');
  }
}

export function paymentText(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/u.test(value)) {
    throw new PaymentJournalError(`${name} fehlt oder ist ungültig.`);
  }
  return value.trim();
}

/** One source for paid/open totals. Never add Income to its own journal projection. */
export function paymentSummary(total: MoneyInput, event?: { amountCents: string; dateCertainty: string; paidAt: Date | string | null } | null) {
  const totalCents = exactPaymentCents(total);
  if (event && (!/^[1-9][0-9]*$/u.test(event.amountCents) || event.amountCents.length > 16)) {
    throw new PaymentJournalError('Zahlungsjournal enthält keinen gültigen Centbetrag.', 409, 'PAYMENT_REVIEW_REQUIRED');
  }
  const paidCents = event ? BigInt(event.amountCents) : BigInt(0);
  if (paidCents < BigInt(0) || paidCents > totalCents) throw new PaymentJournalError('Zahlungsjournal und Rechnungsbetrag sind inkonsistent.', 409, 'PAYMENT_REVIEW_REQUIRED');
  return {
    totalCents: totalCents.toString(),
    paidCents: paidCents.toString(),
    openCents: (totalCents - paidCents).toString(),
    paid: paidCents === totalCents,
    dateCertainty: event?.dateCertainty ?? null,
    paidAt: event?.paidAt ?? null,
  };
}
