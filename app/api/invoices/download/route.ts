import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { readFile } from 'fs/promises';
import { basename, extname } from 'path';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { findUploadedFile } from '@/lib/upload-path';
import { getRawEInvoiceXml } from '@/lib/e-invoice-parser';

function sanitizeDownloadName(value: string | null | undefined): string {
  return basename(value || 'rechnung').replace(/\s+/g, '_').replace(/[^A-Za-z0-9._-]/g, '_') || 'rechnung';
}

function getStoredFileContentType(fileName: string): string {
  return extname(fileName).toLowerCase() === '.xml' ? 'application/xml; charset=utf-8' : 'application/pdf';
}

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const download = url.searchParams.get('download') === 'true';
    const format = url.searchParams.get('format');

    if (!id) {
      return NextResponse.json(
        { error: 'ID ist erforderlich' },
        { status: 400 }
      );
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: Number(id), userId },
    });

    if (!invoice) {
      return NextResponse.json(
        { error: 'Rechnung nicht gefunden' },
        { status: 404 }
      );
    }

    if (format === 'xml') {
      const rawXml = getRawEInvoiceXml(invoice.parsedData);
      if (!rawXml) {
        return NextResponse.json(
          { error: 'Für diese Rechnung ist keine E-Rechnungs-XML verfügbar' },
          { status: 404 }
        );
      }

      const baseName = sanitizeDownloadName(invoice.invoiceNumber || invoice.fileName).replace(/\.[^.]+$/, '');
      const headers: HeadersInit = {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${baseName}.xml"`,
      };

      return new NextResponse(rawXml, {
        status: 200,
        headers,
      });
    }

    const sanitizedFileName = basename(invoice.storedFileName);
    const filePath = findUploadedFile(sanitizedFileName);

    if (!filePath) {
      return NextResponse.json(
        { error: 'Datei nicht gefunden' },
        { status: 404 }
      );
    }

    const fileBuffer = await readFile(filePath);
    const contentType = getStoredFileContentType(invoice.fileName || invoice.storedFileName);

    const headers: HeadersInit = {
      'Content-Type': contentType,
      'X-Frame-Options': 'SAMEORIGIN',
    };

    if (download) {
      headers['Content-Disposition'] = `attachment; filename="${sanitizeDownloadName(invoice.fileName)}"`;
    } else {
      headers['Content-Disposition'] = `inline; filename="${sanitizeDownloadName(invoice.fileName)}"`;
    }

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Fehler beim Herunterladen der Rechnung:', error);
    return NextResponse.json(
      { error: 'Fehler beim Herunterladen der Rechnung: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}
