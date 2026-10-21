import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { HistoryInputError, parseHistoryQuery, readInvoiceHistory } from '@/lib/invoice-history';

/** Read-only, owner-scoped invoice/correction view; not the administrative audit API. */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const query = parseHistoryQuery(new URL(request.url).searchParams);
    const result = await readInvoiceHistory(userId, query);
    return NextResponse.json(result ?? { error: 'Dokument nicht gefunden.' }, { status: result ? 200 : 404, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    if (error instanceof HistoryInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Invoice history read failed');
    return NextResponse.json({ error: 'Historie konnte nicht geladen werden. Bitte erneut versuchen.' }, { status: 500 });
  }
}
