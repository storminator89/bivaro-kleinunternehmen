import { NextResponse, NextRequest } from 'next/server';
import path from 'path';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { writeTenantFile } from '@/lib/upload-path';
import {
  isRequestBodyWithinLimit,
  readRequestBodyWithinLimit,
  requestWithBody,
  RequestBodyLimitError,
  MAX_LOGO_UPLOAD_BYTES,
} from '@/lib/resource-limits';

// Maximum file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    // Authentication check
    const userId = await requireUserId();
    if (!isRequestBodyWithinLimit(request, MAX_LOGO_UPLOAD_BYTES + 128 * 1024)) {
      return NextResponse.json({ error: 'Anfrage ist zu groß' }, { status: 413 });
    }

    const boundedBody = await readRequestBodyWithinLimit(request, MAX_LOGO_UPLOAD_BYTES + 128 * 1024);
    const formData = await requestWithBody(request, boundedBody).formData();
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

    if (file.size > MAX_LOGO_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: 'Datei ist zu groß' },
        { status: 413 }
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

    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > MAX_LOGO_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'Datei ist zu groß' }, { status: 413 });
    }
    const storedFileName = await writeTenantFile(userId, file.name, new Uint8Array(bytes));

    // Return API URL for serving logo (not direct file path)
    const logoUrl = `/api/files/logo?file=${encodeURIComponent(storedFileName)}`;
    return NextResponse.json({ url: logoUrl });

  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    if (error instanceof RequestBodyLimitError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Fehler beim Hochladen des Logos:', error);
    return NextResponse.json(
      { error: 'Fehler beim Hochladen des Logos' },
      { status: 500 }
    );
  }
}
