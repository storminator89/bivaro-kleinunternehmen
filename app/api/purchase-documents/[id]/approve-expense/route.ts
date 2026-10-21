import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/get-user-id';
import { protectMutation } from '@/lib/request-security';
import { approvePurchaseExpense } from '@/lib/purchase-documents/approval';
import { parseDocumentId } from '@/lib/purchase-documents/service';
import { purchaseErrorResponse, purchaseJsonBody } from '@/lib/purchase-documents/http';
async function postHandler(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { const userId = await requireUserId(); return NextResponse.json(await approvePurchaseExpense(userId, parseDocumentId((await context.params).id), await purchaseJsonBody(request))); }
  catch (error) { return purchaseErrorResponse(error); }
}
export const POST = protectMutation(postHandler);
