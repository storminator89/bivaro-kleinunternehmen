import { formatMoneyEUR, parseMoneyEUR } from '@/lib/money';
import { PurchaseDocumentError } from './errors';
import type { PurchaseReviewDraft } from './types';

export const EMPTY_REVIEW_DRAFT: PurchaseReviewDraft = { supplierName: '', invoiceNumber: '', invoiceDate: '', paymentDate: '', amount: '', note: '' };
/** Draft data is never an approval payload; no attestations or ledger identifiers are accepted. */
export function parsePurchaseReviewDraft(value: unknown): PurchaseReviewDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PurchaseDocumentError('Prüfentwurf ist ungültig.');
  const input = value as Record<string, unknown>;
  const limits = { supplierName: 1000, invoiceNumber: 255, invoiceDate: 10, paymentDate: 10, amount: 32, note: 2000 };
  if (Object.keys(input).some(key => !Object.hasOwn(limits, key))) throw new PurchaseDocumentError('Prüfentwurf enthält nicht unterstützte Felder.');
  const draft = { ...EMPTY_REVIEW_DRAFT };
  for (const key of Object.keys(limits) as Array<keyof PurchaseReviewDraft>) {
    if (typeof input[key] !== 'string' || input[key].length > limits[key] || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(input[key])) throw new PurchaseDocumentError('Prüfentwurf enthält ungültige oder zu lange Angaben.');
    draft[key] = input[key].trim();
  }
  for (const key of ['invoiceDate', 'paymentDate'] as const) {
    const date = draft[key];
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '1900-01-01' || date > '9999-12-31' || !Number.isFinite(new Date(date).getTime()) || new Date(date).toISOString().slice(0, 10) !== date)) throw new PurchaseDocumentError('Bitte ein gültiges Datum im Prüfentwurf angeben.');
  }
  if (draft.amount) {
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(draft.amount)) throw new PurchaseDocumentError('Entwurfsbetrag muss ein positiver EUR-Betrag mit höchstens zwei Nachkommastellen sein.');
    try {
      const cents = parseMoneyEUR(draft.amount.replace(',', '.'), { mode: 'strict' });
      if (cents <= BigInt(0) || cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error();
      draft.amount = formatMoneyEUR(cents);
    } catch { throw new PurchaseDocumentError('Entwurfsbetrag ist nicht sicher darstellbar.'); }
  }
  return draft;
}
