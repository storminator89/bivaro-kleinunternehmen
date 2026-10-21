import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/get-user-id';
import { protectMutation } from '@/lib/request-security';
import { deleteSupplier, updateSupplier } from '@/lib/suppliers';
import { expectedRevision, parseDocumentId } from '@/lib/purchase-documents/service';
import { purchaseErrorResponse, purchaseJsonBody } from '@/lib/purchase-documents/http';
type Context = { params: Promise<{ id: string }> };
async function patchHandler(request: NextRequest, context: Context) {
  try { const userId = await requireUserId(); return NextResponse.json({ supplier: await updateSupplier(userId, parseDocumentId((await context.params).id), await purchaseJsonBody(request)) }); }
  catch (error) { return purchaseErrorResponse(error); }
}
async function deleteHandler(request: NextRequest, context: Context) {
  try { const userId = await requireUserId(), body = await purchaseJsonBody(request); await deleteSupplier(userId, parseDocumentId((await context.params).id), expectedRevision(body.expectedRevision)); return NextResponse.json({ deleted: true }); }
  catch (error) { return purchaseErrorResponse(error); }
}
export const PATCH = protectMutation(patchHandler);
export const DELETE = protectMutation(deleteHandler);
