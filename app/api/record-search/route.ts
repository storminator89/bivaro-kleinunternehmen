import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError } from '@/lib/get-user-id';
import { protectMutation } from '@/lib/request-security';
import { readRequestBodyWithinLimit, RequestBodyLimitError } from '@/lib/resource-limits';
import { recordSearchQuery } from '@/lib/record-search/contract';
import { searchOwnedRecords } from '@/lib/record-search/service';

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie' } });
}

// POST is a read-only transport: terms must not enter URLs, history or access logs.
async function search(request: Request) {
  try {
    const userId = await requireUserId();
    let query: string;
    try {
      const bytes = await readRequestBodyWithinLimit(request, 1024);
      const input: unknown = JSON.parse(new TextDecoder().decode(bytes));
      query = recordSearchQuery(input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>).query : undefined);
    } catch (error) {
      return reply({ error: 'Bitte höchstens 100 Zeichen eingeben.' }, error instanceof RequestBodyLimitError ? 413 : 400);
    }
    return reply(await searchOwnedRecords(userId, query));
  } catch (error) {
    if (error instanceof UnauthorizedError) return reply({ error: 'Sitzung abgelaufen. Bitte erneut anmelden.' }, 401);
    // Never log the request, search term, database parameters or private error.
    return reply({ error: 'Datensätze konnten nicht gesucht werden.' }, 500);
  }
}
export const POST = protectMutation(search);
