import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createPdfA3Invoice } from '@/lib/server/pdfa3-converter';

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

  const formData = await request.formData();
  const pdfFile = await readRequiredFile(formData, 'pdf');
  const xmlFile = await readRequiredFile(formData, 'xml');
  const invoiceNumber = formData.get('invoiceNumber');

  if (!pdfFile || pdfFile.type !== 'application/pdf') {
    return jsonError('Eine PDF-Datei ist erforderlich.', 400);
  }

  if (!xmlFile || !['text/xml', 'application/xml'].includes(xmlFile.type)) {
    return jsonError('Eine Factur-X-/ZUGFeRD-XML-Datei ist erforderlich.', 400);
  }

  if (typeof invoiceNumber !== 'string' || invoiceNumber.trim().length === 0) {
    return jsonError('Eine Rechnungsnummer ist erforderlich.', 400);
  }

  try {
    const pdfA3Bytes = await createPdfA3Invoice({
      basePdfBytes: new Uint8Array(await pdfFile.arrayBuffer()),
      xmlContent: await xmlFile.text(),
      invoiceNumber: invoiceNumber.trim(),
    });

    return new Response(pdfA3Bytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('PDF/A-3 conversion failed:', error);
    return jsonError('PDF/A-3-Konvertierung fehlgeschlagen. Bitte pruefen Sie die Serverinstallation von Ghostscript.', 500);
  }
}
