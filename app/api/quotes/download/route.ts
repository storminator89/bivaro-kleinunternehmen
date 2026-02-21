import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { readFile } from 'fs/promises';
import { basename } from 'path';
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
            return NextResponse.json({ error: 'ID ist erforderlich' }, { status: 400 });
        }

        const quote = await prisma.invoice.findUnique({
            where: { id: Number(id), userId },
        });

        if (!quote || quote.type !== 'QUOTE') {
            return NextResponse.json({ error: 'Angebot nicht gefunden' }, { status: 404 });
        }

        const sanitizedFileName = basename(quote.storedFileName);
        const filePath = findUploadedFile(sanitizedFileName);

        if (!filePath) {
            return NextResponse.json({ error: 'Datei nicht gefunden' }, { status: 404 });
        }

        const fileBuffer = await readFile(filePath);

        const headers: HeadersInit = {
            'Content-Type': 'application/pdf',
            'X-Frame-Options': 'SAMEORIGIN',
            'Content-Disposition': download
                ? `attachment; filename="${quote.fileName}"`
                : `inline; filename="${quote.fileName}"`,
        };

        return new NextResponse(new Uint8Array(fileBuffer), { status: 200, headers });
    } catch (error) {
        if (error instanceof UnauthorizedError) return unauthorizedResponse();
        console.error('Fehler beim Herunterladen des Angebots:', error);
        return NextResponse.json({ error: 'Fehler beim Herunterladen' }, { status: 500 });
    }
}
