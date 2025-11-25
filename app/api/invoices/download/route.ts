import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { readFile } from 'fs/promises';
import { join } from 'path';
import * as fs from 'fs';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';

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

    // Rechnung mit dem angegebenen ID abrufen
    const invoice = await prisma.invoice.findUnique({
      where: { id: Number(id), userId },
    });

    if (!invoice) {
      return NextResponse.json(
        { error: 'Rechnung nicht gefunden' },
        { status: 404 }
      );
    }

    // Pfad zur gespeicherten Datei
    const filePath = join(process.cwd(), 'public/uploads', invoice.storedFileName);

    // Prüfen, ob die Datei existiert
    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: 'Datei nicht gefunden' },
        { status: 404 }
      );
    }

    // Datei einlesen
    const fileBuffer = await readFile(filePath);
    
    // Bestimmen des Content-Types - bei Rechnungen sollte es immer PDF sein
    const contentType = 'application/pdf';

    // Header für die Response
    const headers: HeadersInit = {
      'Content-Type': contentType,
    };
    
    // Wenn download=true übergeben wurde, setze den Content-Disposition Header für Download
    if (download) {
      headers['Content-Disposition'] = `attachment; filename="${invoice.fileName}"`;
    } else {
      // Für Vorschau im Browser: inline statt attachment
      headers['Content-Disposition'] = `inline; filename="${invoice.fileName}"`;
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
    console.error('Fehler beim Herunterladen der Rechnung:', error);
    return NextResponse.json(
      { error: 'Fehler beim Herunterladen der Rechnung: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}