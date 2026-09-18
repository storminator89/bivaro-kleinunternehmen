import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createPdfA3Invoice } from '@/lib/server/pdfa3-converter';
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

export async function POST(request: Request) {
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

  if (typeof invoiceNumber !== 'string' || invoiceNumber.trim().length === 0) {
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
    const pdfA3Bytes = await createPdfA3Invoice({
      basePdfBytes: pdfBytes,
      xmlContent: new TextDecoder().decode(xmlBytes),
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
    console.error('PDF/A-3 conversion failed:', error);
    return jsonError('PDF/A-3-Konvertierung fehlgeschlagen. Bitte pruefen Sie die Serverinstallation von Ghostscript.', 500);
  }
}
