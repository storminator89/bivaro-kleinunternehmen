import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/get-user-id';
import { protectMutation } from '@/lib/request-security';
import { selectPurchaseSupplier } from '@/lib/purchase-documents/approval';
import { expectedRevision, parseDocumentId } from '@/lib/purchase-documents/service';
import { purchaseErrorResponse, purchaseJsonBody } from '@/lib/purchase-documents/http';
async function postHandler(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { const userId = await requireUserId(), body = await purchaseJsonBody(request); return NextResponse.json({ document: await selectPurchaseSupplier(userId, parseDocumentId((await context.params).id), expectedRevision(body.expectedRevision), body.supplierId) }); }
  catch (error) { return purchaseErrorResponse(error); }
}
export const POST = protectMutation(postHandler);
