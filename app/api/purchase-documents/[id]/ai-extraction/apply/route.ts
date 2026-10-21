import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/get-user-id';
import { protectMutation } from '@/lib/request-security';
import { expectedRevision, parseDocumentId } from '@/lib/purchase-documents/service';
import { applyPurchaseAiSuggestions } from '@/lib/purchase-documents/ai-extraction';
import { purchaseErrorResponse, purchaseJsonBody } from '@/lib/purchase-documents/http';
import { PurchaseDocumentError } from '@/lib/purchase-documents/errors';
async function postHandler(request:NextRequest,context:{params:Promise<{id:string}>}) {
  try {
    const userId=await requireUserId(),body=await purchaseJsonBody(request);
    if(Object.keys(body).some(key=>!['expectedRevision','jobId'].includes(key)) || typeof body.jobId!=='string' || !/^[0-9a-f-]{36}$/.test(body.jobId)) throw new PurchaseDocumentError('KI-Vorschlag und aktuelle Belegrevision sind erforderlich.');
    return NextResponse.json(await applyPurchaseAiSuggestions(userId,parseDocumentId((await context.params).id),expectedRevision(body.expectedRevision),body.jobId));
  }catch(error){return purchaseErrorResponse(error);}
}
export const POST=protectMutation(postHandler);
