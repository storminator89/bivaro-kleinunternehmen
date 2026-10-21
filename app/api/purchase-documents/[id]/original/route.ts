import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/get-user-id';
import { requirePurchaseDocument, parseDocumentId } from '@/lib/purchase-documents/service';
import { readPurchaseOriginal, safeOriginalFileName } from '@/lib/purchase-documents/original';
import { purchaseErrorResponse } from '@/lib/purchase-documents/http';
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const document = await requirePurchaseDocument(await requireUserId(), parseDocumentId((await context.params).id));
    const bytes = await readPurchaseOriginal(document);
    const fileName = safeOriginalFileName(document.originalFileName);
    const fallback = fileName.replace(/[^A-Za-z0-9._-]/g, '_');
    return new NextResponse(new Uint8Array(bytes), { headers: {
      'Content-Type': document.mediaType,
      'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)}`,
      'Content-Length': String(bytes.byteLength), 'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Frame-Options': 'DENY',
    } });
  } catch (error) { return purchaseErrorResponse(error); }
}
