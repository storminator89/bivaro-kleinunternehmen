import { NextResponse, type NextRequest } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { protectMutation } from '@/lib/request-security';
import { getManualFinancialRecord, mutateManualFinancialRecord, parseManualFinancialRecordMutation, ManualFinancialRecordError } from '@/lib/manual-financial-record-service';

function failure(error: unknown) {
  if (error instanceof UnauthorizedError) return unauthorizedResponse();
  if (error instanceof ManualFinancialRecordError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  // Never expose database internals or file paths. A client must GET history after unknown response.
  console.error('Manual financial record request failed');
  return NextResponse.json({ error: 'Vorgangsergebnis unklar. Bitte den aktuellen Verlauf laden, bevor Sie einen neuen Vorgang beginnen.', code: 'MANUAL_RECORD_UNKNOWN_RESPONSE' }, { status: 500 });
}
export async function GET(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const kind = request.nextUrl.searchParams.get('kind');
    const id = request.nextUrl.searchParams.get('id');
    if ((kind !== 'income' && kind !== 'expense') || !id || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return NextResponse.json({ error: 'Ungültiger Eintragsbezug.', code: 'VALIDATION_ERROR' }, { status: 400 });
    return NextResponse.json({ record: await getManualFinancialRecord(userId, kind, Number(id)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
async function postHandler(request: NextRequest) {
  try {
    const userId = await requireUserId();
    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Ungültiges JSON.', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    return NextResponse.json(await mutateManualFinancialRecord(userId, parseManualFinancialRecordMutation(body)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
// Web sessions only. No API-key privilege is introduced.
export const POST = protectMutation(postHandler, { maxBodyBytes: 16 * 1024 });
