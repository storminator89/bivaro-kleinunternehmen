import { NextResponse, NextRequest } from 'next/server';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';

// Maximum file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    // Authentication check
    const userId = await requireUserId();
    
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'Keine Datei hochgeladen' }, { status: 400 });
    }

    // File size check
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'Datei ist zu groß. Maximale Größe: 10MB' },
        { status: 400 }
      );
    }

    // Dateityp prüfen (nur Bilder) - check both MIME type and extension
    const validTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    const validExtensions = ['.jpg', '.jpeg', '.png'];
    const fileExtension = path.extname(file.name).toLowerCase();
    
    if (!validTypes.includes(file.type) || !validExtensions.includes(fileExtension)) {
      return NextResponse.json(
        { error: 'Nur JPG und PNG-Dateien werden unterstützt' },
        { status: 400 }
      );
    }

    // Sanitize filename - only allow safe characters
    const safeExtension = fileExtension.replace(/[^a-z.]/g, '');
    
    // Generiere einen eindeutigen Dateinamen für die dauerhafte Speicherung
    const uniqueFileName = `logo_${uuidv4()}${safeExtension}`;
    const uploadDir = path.join(process.cwd(), 'public/uploads');
    const permanentFilePath = path.join(uploadDir, uniqueFileName);
    
    // Verify the final path is within uploads directory (prevent path traversal)
    const resolvedPath = path.resolve(permanentFilePath);
    const resolvedUploadDir = path.resolve(uploadDir);
    if (!resolvedPath.startsWith(resolvedUploadDir)) {
      return NextResponse.json(
        { error: 'Ungültiger Dateipfad' },
        { status: 400 }
      );
    }

    // Stelle sicher, dass das Verzeichnis existiert
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Write file directly to permanent location
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(permanentFilePath, buffer);

    // Rückgabe der URL
    const logoUrl = `/uploads/${uniqueFileName}`;
    return NextResponse.json({ url: logoUrl });

  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Fehler beim Hochladen des Logos:', error);
    return NextResponse.json(
      { error: 'Fehler beim Hochladen des Logos' },
      { status: 500 }
    );
  }
}
