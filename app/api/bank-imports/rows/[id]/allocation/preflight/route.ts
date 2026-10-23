import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/get-user-id';
import { protectMutation, MAX_API_JSON_BODY_BYTES } from '@/lib/request-security';
import { BankAllocationError } from '@/lib/bank-allocation-contract';
import { preflightBankPayment } from '@/lib/bank-allocation-service';
import { bankAllocationResponseError } from '@/lib/bank-import-response';
/** Read-only POST: free-text invoice search never enters a URL, operation or audit. */
async function postHandler(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId(), { id } = await context.params;
    let input: unknown; try { input = await request.json(); } catch { throw new BankAllocationError('Die Suchanfrage enthält ungültiges JSON.'); }
    return NextResponse.json(await preflightBankPayment(userId, id, input), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return bankAllocationResponseError(error, { readOnly: true }); }
}
export const POST = protectMutation(postHandler, { maxBodyBytes: MAX_API_JSON_BODY_BYTES });
