import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { readFile } from 'fs/promises';
import { basename } from 'path';
import { requireUserId, UnauthorizedError } from '@/lib/get-user-id';
import { findUploadedFile } from '@/lib/upload-path';

// Allow this route to be embedded in iframes (same origin only)
const FRAME_HEADERS = { 'X-Frame-Options': 'SAMEORIGIN' } as const;

function jsonResponse(body: object, status: number) {
  return NextResponse.json(body, { status, headers: FRAME_HEADERS });
}

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const download = searchParams.get('download') === 'true';

    if (!id) {
      return jsonResponse({ error: 'ID ist erforderlich' }, 400);
    }

    const quote = await prisma.invoice.findUnique({
      where: { id: Number(id), userId },
    });

    if (!quote || quote.type !== 'QUOTE') {
      return jsonResponse({ error: 'Angebot nicht gefunden' }, 404);
    }

    const sanitizedFileName = basename(quote.storedFileName);
    const filePath = findUploadedFile(sanitizedFileName);

    if (!filePath) {
      return jsonResponse({ error: 'Datei nicht gefunden' }, 404);
    }

    const fileBuffer = await readFile(filePath);

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'X-Frame-Options': 'SAMEORIGIN',
        'Content-Disposition': download
          ? `attachment; filename="${quote.fileName}"`
          : `inline; filename="${quote.fileName}"`,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    console.error('Fehler beim Herunterladen des Angebots:', error);
    return jsonResponse({ error: 'Fehler beim Herunterladen' }, 500);
  }
}
