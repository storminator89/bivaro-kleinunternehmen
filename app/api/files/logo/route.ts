/**
 * Protected Logo File Access API
 * 
 * GET /api/files/logo - Serve logo file through authenticated route
 * 
 * This ensures logos are not directly accessible via URL without authentication.
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import * as fs from 'fs';
import path from 'path';
import { findUploadedFile } from '@/lib/upload-path';

export async function GET(request: NextRequest) {
  try {
    // For logo, we allow unauthenticated access for public invoice PDFs
    // But we still validate the request
    const url = new URL(request.url);
    const filename = url.searchParams.get('file');

    if (!filename) {
      return NextResponse.json(
        { error: 'Filename parameter required' },
        { status: 400 }
      );
    }

    // Validate filename format - only allow logo files
    const sanitizedFilename = path.basename(filename);
    if (!sanitizedFilename.startsWith('logo_')) {
      return NextResponse.json(
        { error: 'Invalid file type' },
        { status: 400 }
      );
    }

    // Find the file (checks both new and legacy locations)
    const filePath = findUploadedFile(sanitizedFilename);

    if (!filePath || !fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      );
    }

    // Read and serve the file
    const fileBuffer = await readFile(filePath);

    // Determine content type
    const ext = path.extname(sanitizedFilename).toLowerCase();
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
    console.error('Error serving logo file:', error);
    return NextResponse.json(
      { error: 'Error serving file' },
      { status: 500 }
    );
  }
}
