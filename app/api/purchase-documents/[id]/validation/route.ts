import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/get-user-id';
import { protectMutation } from '@/lib/request-security';
import { expectedRevision, parseDocumentId } from '@/lib/purchase-documents/service';
import { purchaseErrorResponse, purchaseJsonBody } from '@/lib/purchase-documents/http';
import { purchaseValidationHistory, validateIncomingPurchase } from '@/lib/purchase-documents/validation-service';

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const result = await purchaseValidationHistory(await requireUserId(), parseDocumentId((await context.params).id));
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return purchaseErrorResponse(error); }
}
async function postHandler(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const body = await purchaseJsonBody(request);
    const allowed = ['expectedRevision', 'expectedSha256', 'requestId', 'checkerVersion', 'rulesVersion'];
    if (Object.keys(body).length !== allowed.length || Object.keys(body).some(key => !allowed.includes(key))) return NextResponse.json({ error: 'Ungültige Prüfanfrage.', code: 'INVALID_INPUT' }, { status: 400 });
    const result = await validateIncomingPurchase(userId, parseDocumentId((await context.params).id), { expectedRevision: expectedRevision(body.expectedRevision), expectedSha256: body.expectedSha256, requestId: body.requestId, checkerVersion: body.checkerVersion, rulesVersion: body.rulesVersion });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return purchaseErrorResponse(error); }
}
export const POST = protectMutation(postHandler);
