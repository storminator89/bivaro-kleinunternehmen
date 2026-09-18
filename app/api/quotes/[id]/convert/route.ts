import { NextRequest, NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { POST as uploadInvoice } from '@/app/api/invoices/upload/route';

// A conversion must supply the newly generated invoice, never reuse the quote PDF.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUserId();
    const { id } = await params;
    if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) {
      return NextResponse.json({ error: 'Ungültige Angebots-ID' }, { status: 400 });
    }
    if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) {
      return NextResponse.json({ error: 'Die neu erzeugte Rechnung muss als PDF-/XML-Datei übergeben werden. Bitte den Rechnungseditor verwenden.' }, { status: 400 });
    }
    // Preserve upload limits: the upload handler parses and bounds the request body.
    const url = new URL(request.url);
    url.searchParams.set('fromQuoteId', id);
    return uploadInvoice(new NextRequest(url, request));
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    console.error('Quote conversion failed:', error);
    return NextResponse.json({ error: 'Umwandlung fehlgeschlagen' }, { status: 400 });
  }
}
