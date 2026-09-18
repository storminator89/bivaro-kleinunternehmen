import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { readFile } from 'fs/promises';
import path from 'path';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { findOwnedUploadedFile } from '@/lib/upload-ownership';

function safeDownloadName(value: string | null | undefined): string {
  return path.basename(value || 'beleg')
    .replace(/[\r\n]/gu, '_')
    .replace(/[^A-Za-z0-9._-]/gu, '_') || 'beleg';
}

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const download = url.searchParams.get('download') === 'true';

    if (!id) {
      return NextResponse.json(
        { error: 'ID ist erforderlich' },
        { status: 400 }
      );
    }

    // Ausgabe mit dem angegebenen ID abrufen
    const expense = await prisma.expense.findUnique({
      where: { id: Number(id), userId },
    });

    if (!expense) {
      return NextResponse.json(
        { error: 'Ausgabe nicht gefunden' },
        { status: 404 }
      );
    }

    if (!expense.storedReceiptFileName) {
      return NextResponse.json(
        { error: 'Kein Beleg für diese Ausgabe vorhanden' },
        { status: 404 }
      );
    }

    // Resolve only through the current tenant's private directory, with a
    // guarded legacy fallback that checks all DB references for ownership.
    const filePath = await findOwnedUploadedFile(userId, expense.storedReceiptFileName);

    if (!filePath) {
      return NextResponse.json(
        { error: 'Datei nicht gefunden' },
        { status: 404 }
      );
    }

    // Datei einlesen
    const fileBuffer = await readFile(filePath);

    // Content-Type bestimmen basierend auf der Dateierweiterung
    const fileExtension = path.extname(expense.storedReceiptFileName).toLowerCase();
    let contentType = 'application/octet-stream'; // Standard

    if (fileExtension === '.pdf') {
      contentType = 'application/pdf';
    } else if (fileExtension === '.jpg' || fileExtension === '.jpeg') {
      contentType = 'image/jpeg';
    } else if (fileExtension === '.png') {
      contentType = 'image/png';
    }

    // Dateiname für den Download - verwende den ursprünglichen Dateinamen wenn verfügbar
    const downloadFilename = safeDownloadName(expense.receiptFileName || expense.storedReceiptFileName);

    // Response mit Datei und korrekten Headers
    const headers: HeadersInit = {
      'Content-Type': contentType,
      // Allow iframe embedding for preview (SAMEORIGIN instead of DENY)
      'X-Frame-Options': 'SAMEORIGIN',
    };

    // Wenn download=true übergeben wurde, setze den Content-Disposition Header für Download
    if (download) {
      headers['Content-Disposition'] = `attachment; filename="${downloadFilename}"`;
    } else {
      // Für Vorschau im Browser: inline statt attachment
      headers['Content-Disposition'] = `inline; filename="${downloadFilename}"`;
    }

    const response = new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: headers,
    });

    return response;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Fehler beim Laden des Belegs:', error);
    return NextResponse.json(
      { error: 'Fehler beim Laden des Belegs: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}
