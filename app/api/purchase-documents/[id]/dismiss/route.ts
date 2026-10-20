import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/get-user-id';
import { protectMutation } from '@/lib/request-security';
import { changePurchaseReview, expectedRevision, parseDocumentId } from '@/lib/purchase-documents/service';
import { purchaseErrorResponse, purchaseJsonBody } from '@/lib/purchase-documents/http';
import { PurchaseDocumentError } from '@/lib/purchase-documents/errors';
async function postHandler(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const body = await purchaseJsonBody(request);
    if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 500 || /[\u0000-\u001f\u007f]/.test(body.reason)) throw new PurchaseDocumentError('Ein Verwerfungsgrund (1–500 Zeichen) ist erforderlich.');
    return NextResponse.json({ document: await changePurchaseReview(userId, parseDocumentId((await context.params).id), expectedRevision(body.expectedRevision), 'dismiss', body.reason.trim()) });
  } catch (error) { return purchaseErrorResponse(error); }
}
export const POST = protectMutation(postHandler);
