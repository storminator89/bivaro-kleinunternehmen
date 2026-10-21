import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/get-user-id';
import { protectMutation } from '@/lib/request-security';
import { MAX_INVOICE_UPLOAD_BYTES, readRequestBodyWithinLimit, requestWithBody } from '@/lib/resource-limits';
import { detectPurchaseContainer } from '@/lib/purchase-documents/original';
import { intakePurchaseDocument, listPurchaseDocuments, parseUploadRequestId } from '@/lib/purchase-documents/service';
import { purchaseErrorResponse } from '@/lib/purchase-documents/http';
import { withProcessingSlot } from '@/lib/processing-limit';
import { PurchaseDocumentError } from '@/lib/purchase-documents/errors';

export async function GET(request: NextRequest) {
  try { return NextResponse.json(await listPurchaseDocuments(await requireUserId(), new URL(request.url).searchParams)); }
  catch (error) { return purchaseErrorResponse(error); }
}
async function postHandler(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = await readRequestBodyWithinLimit(request, MAX_INVOICE_UPLOAD_BYTES + 128 * 1024);
    let form: FormData;
    try { form = await requestWithBody(request, body).formData(); }
    catch { throw new PurchaseDocumentError('Ungültiger Datei-Upload.'); }
    const file = form.get('file');
    if (!(file instanceof File) || form.getAll('file').length !== 1 || form.getAll('uploadRequestId').length !== 1) throw new PurchaseDocumentError('Genau eine Datei und ein Uploadschlüssel sind erforderlich.');
    const requestId = parseUploadRequestId(form.get('uploadRequestId'));
    // Only an explicit opt-out is accepted; an upload cannot grant provider consent.
    const analysisModes = form.getAll('analysisMode');
    if (analysisModes.length > 1 || (analysisModes.length === 1 && analysisModes[0] !== 'manual')) throw new PurchaseDocumentError('Ungültiger Auswertungsmodus.');
    if (file.size > MAX_INVOICE_UPLOAD_BYTES) throw new PurchaseDocumentError('Datei überschreitet das Größenlimit.', 413, 'FILE_SIZE');
    const bytes = Buffer.from(await file.arrayBuffer());
    const mediaType = await withProcessingSlot(userId, () => detectPurchaseContainer(file, bytes), requestId);
    const result = await intakePurchaseDocument({ userId, requestId, originalFileName: file.name, mediaType, bytes, ...(analysisModes.length === 1 ? { analysisMode: 'manual' as const } : {}) });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) { return purchaseErrorResponse(error); }
}
export const POST = protectMutation(postHandler);
