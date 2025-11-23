import { NextResponse, NextRequest } from 'next/server';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'Keine Datei hochgeladen' }, { status: 400 });
    }

    // Dateityp prüfen (nur Bilder)
    const validTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (!validTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Nur JPG und PNG-Dateien werden unterstützt' },
        { status: 400 }
      );
    }

    // Datei in temporäres Verzeichnis speichern
    const tempDir = os.tmpdir();
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const filePath = join(tempDir, file.name);
    await writeFile(filePath, buffer);

    // Generiere einen eindeutigen Dateinamen für die dauerhafte Speicherung
    const uniqueFileName = `logo_${uuidv4()}${path.extname(file.name)}`;
    const uploadDir = path.join(process.cwd(), 'public/uploads');
    const permanentFilePath = path.join(uploadDir, uniqueFileName);

    // Stelle sicher, dass das Verzeichnis existiert
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Kopiere die Datei in das dauerhafte Verzeichnis
    fs.copyFileSync(filePath, permanentFilePath);

    // Bereinigen (temporäre Datei löschen)
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      console.error('Fehler beim Löschen der temporären Datei:', error);
    }

    // Rückgabe der URL
    const logoUrl = `/uploads/${uniqueFileName}`;
    return NextResponse.json({ url: logoUrl });

  } catch (error) {
    console.error('Fehler beim Hochladen des Logos:', error);
    return NextResponse.json(
      { error: 'Fehler beim Hochladen des Logos: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}
