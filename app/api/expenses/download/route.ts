import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { readFile } from 'fs/promises';
import { join } from 'path';
import * as fs from 'fs';
import path from 'path';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { findUploadedFile } from '@/lib/upload-path';

const prisma = new PrismaClient();

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

    // Sanitize filename - prevent path traversal
    const sanitizedFileName = path.basename(expense.storedReceiptFileName);
    
    // Find file in new or legacy location
    const filePath = findUploadedFile(sanitizedFileName);
    
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
    const downloadFilename = expense.receiptFileName || expense.storedReceiptFileName;

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

    const response = new NextResponse(fileBuffer, {
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