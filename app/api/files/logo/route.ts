/**
 * Protected Logo File Access API
 * 
 * GET /api/files/logo - Serve logo file through authenticated route
 * 
 * This ensures logos are not directly accessible via URL without authentication.
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { privateLogoUrl } from '@/lib/upload-path';
import { prisma } from '@/lib/prisma';
import { findOwnedUploadedFile } from '@/lib/upload-ownership';

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUserId();

    const url = new URL(request.url);
    const filename = url.searchParams.get('file');

    if (!filename) {
      return NextResponse.json(
        { error: 'Filename parameter required' },
        { status: 400 }
      );
    }

    const setting = await prisma.settings.findUnique({
      where: { userId }, select: { logoUrl: true },
    });
    if (!setting || privateLogoUrl(setting.logoUrl) !== `/api/files/logo?file=${encodeURIComponent(filename)}`) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Ownership is derived from the settings row and the tenant-scoped path;
    // legacy root files additionally require an exclusive DB reference.
    const filePath = await findOwnedUploadedFile(userId, filename);

    if (!filePath) {
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      );
    }

    // Read and serve the file
    const fileBuffer = await readFile(filePath);

    // Determine content type
    const ext = path.extname(filename).toLowerCase();
    let contentType = 'application/octet-stream';
    if (ext === '.png') contentType = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    else if (ext === '.gif') contentType = 'image/gif';
    else if (ext === '.webp') contentType = 'image/webp';

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    console.error('Error serving logo file:', error);
    return NextResponse.json(
      { error: 'Error serving file' },
      { status: 500 }
    );
  }
}
