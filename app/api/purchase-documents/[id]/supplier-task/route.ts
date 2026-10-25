import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/get-user-id';
import { protectMutation } from '@/lib/request-security';
import { expectedRevision, parseDocumentId } from '@/lib/purchase-documents/service';
import { saveSupplierTask } from '@/lib/purchase-documents/save-supplier-task';
import { purchaseErrorResponse, purchaseJsonBody } from '@/lib/purchase-documents/http';
import { PurchaseDocumentError } from '@/lib/purchase-documents/errors';

async function postHandler(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const body = await purchaseJsonBody(request);
    if (Object.keys(body).length !== 2 || !Object.hasOwn(body, 'expectedRevision') || !Object.hasOwn(body, 'task')) throw new PurchaseDocumentError('Vormerkung enthält nicht unterstützte Felder.');
    const document = await saveSupplierTask(userId, parseDocumentId((await context.params).id), expectedRevision(body.expectedRevision), body.task);
    return NextResponse.json({ document });
  } catch (error) { return purchaseErrorResponse(error); }
}
export const POST = protectMutation(postHandler);
