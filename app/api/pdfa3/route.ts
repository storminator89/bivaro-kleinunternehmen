import { protectMutation } from '@/lib/request-security';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createPdfA3Invoice, ForeignPdfError } from '@/lib/server/pdfa3-converter';
import { ProcessingCapacityError } from '@/lib/processing-limit';
import {
  isRequestBodyWithinLimit,
  readRequestBodyWithinLimit,
  requestWithBody,
  RequestBodyLimitError,
  MAX_PDF_INPUT_BYTES,
  MAX_PDF_XML_COMBINED_BYTES,
  MAX_XML_INPUT_BYTES,
} from '@/lib/resource-limits';

export const runtime = 'nodejs';

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function readRequiredFile(formData: FormData, fieldName: string): Promise<File | null> {
  const value = formData.get(fieldName);
  return value instanceof File ? value : null;
}

async function postHandler(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !['ADMIN', 'USER'].includes(session.user.role)) {
    return jsonError('Unauthorized', 401);
  }

  if (!isRequestBodyWithinLimit(request, MAX_PDF_XML_COMBINED_BYTES + 128 * 1024)) {
    return jsonError('Die Anfrage ist zu groß.', 413);
  }

  let formData: FormData;
  try {
    const boundedBody = await readRequestBodyWithinLimit(request, MAX_PDF_XML_COMBINED_BYTES + 128 * 1024);
    formData = await requestWithBody(request, boundedBody).formData();
  } catch (error) {
    if (error instanceof RequestBodyLimitError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('Die Formulardaten konnten nicht gelesen werden.', 400);
  }
  const pdfFile = await readRequiredFile(formData, 'pdf');
  const xmlFile = await readRequiredFile(formData, 'xml');
  const invoiceNumber = formData.get('invoiceNumber');

  if (!pdfFile || pdfFile.type !== 'application/pdf') {
    return jsonError('Eine PDF-Datei ist erforderlich.', 400);
  }

  if (!xmlFile || !['text/xml', 'application/xml'].includes(xmlFile.type)) {
    return jsonError('Eine Factur-X-/ZUGFeRD-XML-Datei ist erforderlich.', 400);
  }

  if (pdfFile.size > MAX_PDF_INPUT_BYTES || xmlFile.size > MAX_XML_INPUT_BYTES) {
    return jsonError('PDF oder XML ist zu groß.', 413);
  }
  if (pdfFile.size + xmlFile.size > MAX_PDF_XML_COMBINED_BYTES) {
    return jsonError('Die kombinierte PDF-/XML-Anfrage ist zu groß.', 413);
  }

  if (typeof invoiceNumber !== 'string' || invoiceNumber.trim().length === 0 || invoiceNumber.length > 200) {
    return jsonError('Eine Rechnungsnummer ist erforderlich.', 400);
  }

  try {
    const pdfBytes = new Uint8Array(await pdfFile.arrayBuffer());
    const xmlBytes = new Uint8Array(await xmlFile.arrayBuffer());
    if (pdfBytes.byteLength > MAX_PDF_INPUT_BYTES || xmlBytes.byteLength > MAX_XML_INPUT_BYTES) {
      return jsonError('PDF oder XML ist zu groß.', 413);
    }
    if (pdfBytes.byteLength + xmlBytes.byteLength > MAX_PDF_XML_COMBINED_BYTES) {
      return jsonError('Die kombinierte PDF-/XML-Anfrage ist zu groß.', 413);
    }
    let xmlContent: string;
    try { xmlContent = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(xmlBytes); }
    catch { return NextResponse.json({ error: 'Die XML-Datei muss gültiges UTF-8 enthalten.', code: 'PDF_XML_INVALID' }, { status: 422 }); }
    const pdfA3Bytes = await createPdfA3Invoice({
      basePdfBytes: pdfBytes,
      xmlContent,
      invoiceNumber: invoiceNumber.trim(),
      userId: session.user.id,
    });

    return new Response(pdfA3Bytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof RequestBodyLimitError) {
      return jsonError(error.message, error.status);
    }
    if (error instanceof ProcessingCapacityError) {
      const response = jsonError(error.message, error.status);
      response.headers.set('Retry-After', '1');
      return response;
    }
    if (error instanceof ForeignPdfError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: 'Die sichere PDF-Verarbeitung ist derzeit nicht verfügbar. Bitte später erneut versuchen. Es wurde keine Datei erstellt oder archiviert.', code: 'PDF_PROCESSING_UNAVAILABLE' }, { status: 503 });
  }
}

export const POST = protectMutation(postHandler);
