import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/get-user-id';
import { protectMutation } from '@/lib/request-security';
import { expectedRevision, parseDocumentId } from '@/lib/purchase-documents/service';
import { getPurchaseAiExtraction, runPurchaseAiExtraction } from '@/lib/purchase-documents/ai-extraction';
import { purchaseErrorResponse, purchaseJsonBody } from '@/lib/purchase-documents/http';
import { PurchaseDocumentError } from '@/lib/purchase-documents/errors';
export const runtime = 'nodejs';
export const maxDuration = 90;
export async function GET(_request:NextRequest,context:{params:Promise<{id:string}>}) {
  try {return NextResponse.json({extraction:await getPurchaseAiExtraction(await requireUserId(),parseDocumentId((await context.params).id))},{headers:{'Cache-Control':'no-store'}});}
  catch(error){return purchaseErrorResponse(error);}
}
async function postHandler(request:NextRequest,context:{params:Promise<{id:string}>}) {
  try {
    const userId=await requireUserId(),body=await purchaseJsonBody(request);
    if(Object.keys(body).some(key=>!['expectedRevision','expectedConfigVersion','expectedConfigRevision','acknowledgeCost','retry'].includes(key)) || body.acknowledgeCost!==true || (body.retry!==undefined && typeof body.retry!=='boolean') || typeof body.expectedConfigVersion!=='number' || !Number.isSafeInteger(body.expectedConfigVersion) || body.expectedConfigVersion<1 || typeof body.expectedConfigRevision!=='string' || !/^[0-9a-f-]{36}$/.test(body.expectedConfigRevision)) throw new PurchaseDocumentError('Aktuelle KI-Konfiguration und ausdrückliche Kosten-/Datenübertragungsbestätigung sind erforderlich.');
    return NextResponse.json(await runPurchaseAiExtraction(userId,parseDocumentId((await context.params).id),expectedRevision(body.expectedRevision),{expectedConfigVersion:body.expectedConfigVersion,expectedConfigRevision:body.expectedConfigRevision,retry:body.retry===true}));
  }catch(error){return purchaseErrorResponse(error);}
}
export const POST=protectMutation(postHandler);
