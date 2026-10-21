import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/get-user-id';
import { protectMutation } from '@/lib/request-security';
import { expectedRevision, parseDocumentId } from '@/lib/purchase-documents/service';
import { savePurchaseReviewDraft } from '@/lib/purchase-documents/save-review-draft';
import { purchaseErrorResponse, purchaseJsonBody } from '@/lib/purchase-documents/http';
async function postHandler(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const body = await purchaseJsonBody(request);
    return NextResponse.json({ document: await savePurchaseReviewDraft(userId, parseDocumentId((await context.params).id), expectedRevision(body.expectedRevision), body.draft) });
  } catch (error) { return purchaseErrorResponse(error); }
}
export const POST = protectMutation(postHandler);
