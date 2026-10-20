import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/get-user-id';
import { protectMutation } from '@/lib/request-security';
import { MAX_INVOICE_UPLOAD_BYTES, readRequestBodyWithinLimit, requestWithBody } from '@/lib/resource-limits';
import { detectPurchaseContainer } from '@/lib/purchase-documents/original';
import { intakePurchaseDocument, listPurchaseDocuments, parseUploadRequestId } from '@/lib/purchase-documents/service';
import { purchaseErrorResponse } from '@/lib/purchase-documents/http';
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
    if (file.size > MAX_INVOICE_UPLOAD_BYTES) throw new PurchaseDocumentError('Datei überschreitet das Größenlimit.', 413, 'FILE_SIZE');
    const bytes = Buffer.from(await file.arrayBuffer());
    const mediaType = detectPurchaseContainer(file, bytes);
    const result = await intakePurchaseDocument({ userId, requestId, originalFileName: file.name, mediaType, bytes });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) { return purchaseErrorResponse(error); }
}
export const POST = protectMutation(postHandler);
