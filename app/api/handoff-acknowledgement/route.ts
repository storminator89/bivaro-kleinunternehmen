import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { AccountantExportError } from '@/lib/accountant-export';
import { parseHandoffAcknowledgement, readHandoffAcknowledgement, recordHandoffAcknowledgement } from '@/lib/handoff-acknowledgement';
import { protectMutation } from '@/lib/request-security';

const headers = { 'Cache-Control': 'private, no-store' };
function failure(error: unknown) {
  if (error instanceof UnauthorizedError) return unauthorizedResponse();
  if (error instanceof AccountantExportError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  return NextResponse.json({ error: 'Empfangsnotiz ist nicht verfügbar. Es wurde keine erfolgreiche Speicherung bestätigt.' }, { status: 500, headers });
}
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => params.getAll(key).length !== 1)) throw new AccountantExportError('Ungültiger Paketstand.');
    const identity = parseHandoffAcknowledgement({ ...Object.fromEntries(params), formatVersion: params.get('formatVersion') === '2' ? 2 : null });
    return NextResponse.json(await readHandoffAcknowledgement(userId, identity), { headers });
  } catch (error) { return failure(error); }
}
export const POST = protectMutation(async (request: Request) => {
  try {
    const userId = await requireUserId();
    let data: unknown;
    try { data = await request.json(); } catch { throw new AccountantExportError('Ungültige Empfangsnotiz.'); }
    if (!data || typeof data !== 'object' || Array.isArray(data) || (data as Record<string, unknown>).selfRecorded !== true) throw new AccountantExportError('Bitte die manuelle Empfangsprüfung ausdrücklich bestätigen.');
    const { selfRecorded: _selfRecorded, ...identity } = data as Record<string, unknown>;
    const result = await recordHandoffAcknowledgement(userId, parseHandoffAcknowledgement(identity));
    return NextResponse.json(result, { status: result.replayed ? 200 : 201, headers });
  } catch (error) { return failure(error); }
}, { maxBodyBytes: 2048 });
