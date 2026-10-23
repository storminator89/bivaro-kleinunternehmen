import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/get-user-id';
import { protectMutation, MAX_API_JSON_BODY_BYTES } from '@/lib/request-security';
import { BankAllocationError } from '@/lib/bank-allocation-contract';
import { recordBankPayment, recoverBankPayment } from '@/lib/bank-allocation-service';
import { bankAllocationResponseError } from '@/lib/bank-import-response';
const headers = { 'Cache-Control': 'private, no-store' };
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const userId = await requireUserId(), { id } = await context.params;
    return NextResponse.json(await recoverBankPayment(userId, id, new URL(request.url).searchParams.get('idempotencyKey')), { headers });
  } catch (error) { return bankAllocationResponseError(error); }
}
async function postHandler(request: Request, context: Context) {
  try {
    const userId = await requireUserId(), { id } = await context.params;
    if (request.headers.get('X-Bivaro-Payment-Contract') !== '3') throw new BankAllocationError('Bitte mit Zahlungsjournal-Vertrag 3 erneut laden.', 409, 'PAYMENT_CAPABILITY_REQUIRED');
    let input: unknown; try { input = await request.json(); } catch { throw new BankAllocationError('Die Zuordnungsanfrage enthält ungültiges JSON.'); }
    const result = await recordBankPayment(userId, id, input);
    return NextResponse.json(result, { status: result.replayed ? 200 : 201, headers });
  } catch (error) { return bankAllocationResponseError(error); }
}
export const POST = protectMutation(postHandler, { maxBodyBytes: MAX_API_JSON_BODY_BYTES });
