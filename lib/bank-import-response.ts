import { NextResponse } from 'next/server';
import { UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { BankCsvError } from '@/lib/bank-csv';
import { BankAllocationError } from '@/lib/bank-allocation-contract';
import { PaymentJournalError } from '@/lib/payment-journal/contract';
import { BankImportError } from '@/lib/bank-import-contract';
const headers = { 'Cache-Control': 'private, no-store' };
export function bankImportResponseError(error: unknown) {
  if (error instanceof UnauthorizedError) return unauthorizedResponse();
  if (error instanceof BankAllocationError || error instanceof PaymentJournalError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers });
  if (error instanceof BankImportError) return NextResponse.json({ error: error.message, ...(error.existingReceiptId ? { existingReceiptId: error.existingReceiptId } : {}) }, { status: error.status, headers });
  if (error instanceof BankCsvError) return NextResponse.json({ error: error.message }, { status: 400, headers });
  console.error('Bank import operation failed'); // No file bytes, alias, transaction data, request body or error object.
  return NextResponse.json({ error: 'Das Ergebnis ist noch unklar. Bitte mit derselben Importkennung erneut prüfen; keine neue Datei beginnen.' }, { status: 500, headers });
}

/** Financial lost-response recovery uses the action key, not a fresh import or manual payment. */
export function bankAllocationResponseError(error: unknown, options: { readOnly?: boolean } = {}) {
  if (error instanceof UnauthorizedError || error instanceof BankImportError || error instanceof PaymentJournalError || error instanceof BankCsvError) return bankImportResponseError(error);
  console.error('Bank allocation operation failed'); // Deliberately no error object, body, memo or bank identifiers.
  return NextResponse.json({ error: options.readOnly
    ? 'Die Zuordnungsprüfung kann gerade nicht geladen werden. Die Vorschau hat keine Finanzaktion ausgelöst.'
    : 'Das Ergebnis ist noch unklar. Bitte zuerst mit unverändertem Aktionsschlüssel den Stand prüfen; keine weitere Zahlung erfassen.',
    code: options.readOnly ? 'BANK_ALLOCATION_PREFLIGHT_UNAVAILABLE' : 'PAYMENT_OUTCOME_UNKNOWN' }, { status: 500, headers });
}
