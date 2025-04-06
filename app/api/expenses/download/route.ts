import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { readFile } from 'fs/promises';
import { join } from 'path';
import * as fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'ID ist erforderlich' },
        { status: 400 }
      );
    }

    // Ausgabe mit dem angegebenen ID abrufen
    const expense = await prisma.expense.findUnique({
      where: { id: Number(id) },
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

    // Pfad zur gespeicherten Datei
    const filePath = join(process.cwd(), 'public/uploads', expense.storedReceiptFileName);

    // Prüfen, ob die Datei existiert
    if (!fs.existsSync(filePath)) {
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
    const response = new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${downloadFilename}"`,
      },
    });

    return response;
  } catch (error) {
    console.error('Fehler beim Herunterladen des Belegs:', error);
    return NextResponse.json(
      { error: 'Fehler beim Herunterladen des Belegs: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}