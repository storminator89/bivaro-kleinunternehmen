import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { promises as fs } from 'fs';
import path from 'path';

const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  
  if (!id) {
    return NextResponse.json({ error: 'Rechnungs-ID ist erforderlich' }, { status: 400 });
  }
  
  try {
    // Rechnung aus der Datenbank abrufen
    const invoice = await prisma.invoice.findUnique({
      where: { id: Number(id) }
    });
    
    if (!invoice) {
      return NextResponse.json({ error: 'Rechnung nicht gefunden' }, { status: 404 });
    }
    
    // Pfad zur gespeicherten PDF-Datei
    const uploadDir = path.join(process.cwd(), 'public/uploads');
    const filePath = path.join(uploadDir, invoice.storedFileName);
    
    try {
      // Prüfen, ob die Datei existiert
      await fs.access(filePath);
      
      // Datei lesen
      const fileBuffer = await fs.readFile(filePath);
      
      // Erstelle Antwort mit PDF-Inhalt
      const response = new NextResponse(fileBuffer);
      
      // Setze Header für PDF-Download
      response.headers.set('Content-Type', 'application/pdf');
      response.headers.set('Content-Disposition', `attachment; filename="${invoice.fileName || `Rechnung-${invoice.invoiceNumber || id}.pdf`}"`);
      
      return response;
    } catch (fileError) {
      console.error('Fehler beim Lesen der PDF-Datei:', fileError);
      
      // Wenn die Datei nicht gefunden wurde, gib eine entsprechende Fehlermeldung zurück
      return NextResponse.json(
        { error: 'Die Original-PDF-Datei konnte nicht gefunden werden.' },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error('Fehler beim Herunterladen der Rechnung:', error);
    return NextResponse.json(
      { error: 'Fehler beim Herunterladen der Rechnung: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}