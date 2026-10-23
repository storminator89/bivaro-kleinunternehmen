import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/get-user-id';
import { protectMutation, MAX_API_JSON_BODY_BYTES } from '@/lib/request-security';
import { BankAllocationError } from '@/lib/bank-allocation-contract';
import { preflightBankReallocation } from '@/lib/bank-allocation-service';
import { bankAllocationResponseError } from '@/lib/bank-import-response';
/** Read-only selection/comparison; no reservation and no financial write. */
async function postHandler(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId(), { id } = await context.params;
    let input: unknown; try { input = await request.json(); } catch { throw new BankAllocationError('Die Suchanfrage enthält ungültiges JSON.'); }
    return NextResponse.json(await preflightBankReallocation(userId, id, input), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return bankAllocationResponseError(error, { readOnly: true }); }
}
export const POST = protectMutation(postHandler, { maxBodyBytes: MAX_API_JSON_BODY_BYTES });
