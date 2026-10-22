import { NextResponse } from 'next/server';
import { UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { BankCsvError } from '@/lib/bank-csv';
import { BankImportError } from '@/lib/bank-import-contract';
const headers = { 'Cache-Control': 'private, no-store' };
export function bankImportResponseError(error: unknown) {
  if (error instanceof UnauthorizedError) return unauthorizedResponse();
  if (error instanceof BankImportError) return NextResponse.json({ error: error.message, ...(error.existingReceiptId ? { existingReceiptId: error.existingReceiptId } : {}) }, { status: error.status, headers });
  if (error instanceof BankCsvError) return NextResponse.json({ error: error.message }, { status: 400, headers });
  console.error('Bank import operation failed'); // No file bytes, alias, transaction data, request body or error object.
  return NextResponse.json({ error: 'Das Ergebnis ist noch unklar. Bitte mit derselben Importkennung erneut prüfen; keine neue Datei beginnen.' }, { status: 500, headers });
}
