import { NextResponse } from 'next/server';
import { UnauthorizedError } from '@/lib/get-user-id';
import { protectMutation } from '@/lib/request-security';
import { readRequestBodyWithinLimit, RequestBodyLimitError } from '@/lib/resource-limits';
import { PaymentJournalError } from '@/lib/payment-journal/contract';
import { PurchaseDocumentError } from '@/lib/purchase-documents/errors';
import { FilteredListInputError } from './list-contract';

const MAX_FILTERED_LIST_BODY_BYTES = 2048;
export function filteredListReply(body: unknown, status = 200): Response {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
}
/** Terms belong only in the bounded JSON body, never URL parameters. */
export async function filteredListBody(request: Request): Promise<unknown> {
  if (new URL(request.url).search || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new FilteredListInputError();
  const bytes = await readRequestBodyWithinLimit(request, MAX_FILTERED_LIST_BODY_BYTES);
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new FilteredListInputError(); }
}
/** Deliberately static: no term, DB exception, private field or parser message. */
export function filteredListError(error: unknown): Response {
  if (error instanceof UnauthorizedError) return filteredListReply({ error: 'Sitzung abgelaufen. Bitte erneut anmelden.' }, 401);
  if (error instanceof RequestBodyLimitError) return filteredListReply({ error: 'Suchanfrage ist zu groß.' }, 413);
  if (error instanceof FilteredListInputError) return filteredListReply({ error: 'Bitte einen Suchtext mit 3 bis 100 Zeichen und gültige Listenfilter angeben.' }, 400);
  if (error instanceof PaymentJournalError && error.code === 'SOURCE_LIMIT') return filteredListReply({ error: 'Zu viele Rechnungen. Bitte die Auswahl eingrenzen.', code: 'SOURCE_LIMIT' }, 413);
  if (error instanceof PurchaseDocumentError && error.status === 400) return filteredListReply({ error: 'Ungültige Listenfilter.' }, 400);
  return filteredListReply({ error: 'Gefilterte Liste konnte nicht geladen werden.' }, 500);
}
/** POST reads receive the existing same-origin guard, including no-store on guard failures. */
export function protectFilteredListSearch(handler: (request: Request) => Promise<Response>) {
  const guarded = protectMutation(handler);
  return async (request: Request): Promise<Response> => {
    const response = await guarded(request);
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Vary', 'Cookie');
    return response;
  };
}
