import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { DocumentNumberingError } from '@/lib/document-numbering-policy';
import { inTransaction } from '@/lib/db-transaction';
import { previewDocumentNumber } from '@/lib/invoice-numbers';

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const yearInput = new URL(request.url).searchParams.get('year');
    const year = yearInput === null ? new Date().getFullYear() : Number(yearInput);
    const next = await inTransaction(tx => previewDocumentNumber(tx, userId, 'QUOTE', year));
    return NextResponse.json({ nextQuoteNumber: next.number, numberingSelection: { version: 1, type: 'QUOTE', revision: next.revision, year: next.year, number: next.number, automatic: true } }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof DocumentNumberingError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    console.error('Document number preview failed:', error);
    return NextResponse.json({ error: 'Nummer konnte nicht ermittelt werden' }, { status: 500 });
  }
}
