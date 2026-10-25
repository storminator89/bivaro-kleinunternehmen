import { finalizedManualRecordOriginal, readManualRecordOriginalBytes, ManualFinancialRecordError } from '@/lib/manual-financial-record-service';
import { readPurchaseOriginal } from '@/lib/purchase-documents/original';
import { PurchaseDocumentError } from '@/lib/purchase-documents/errors';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { readFile } from 'fs/promises';
import path from 'path';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { findOwnedUploadedFile } from '@/lib/upload-ownership';

function safeDownloadName(value: string | null | undefined): string {
  return path.basename(value || 'beleg')
    .replace(/[\r\n]/gu, '_')
    .replace(/[^A-Za-z0-9._-]/gu, '_') || 'beleg';
}

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

    // Ausgabe mit dem angegebenen ID abrufen
    const expense = await prisma.expense.findUnique({
      where: { id: Number(id), userId },
      include: { manualRecordEvents: { where: { sequence: 1 }, select: { snapshot: true } }, purchaseDocument: { select: { userId: true, storedFileName: true, originalSha256: true, originalByteCount: true, mediaType: true, reviewStatus: true } } },
    });

    if (!expense) {
      return NextResponse.json(
        { error: 'Ausgabe nicht gefunden' },
        { status: 404 }
      );
    }

    const manualOriginal = finalizedManualRecordOriginal(expense, expense.manualRecordEvents);
    if (manualOriginal?.status === 'ARCHIVED' && !expense.storedReceiptFileName) throw new ManualFinancialRecordError(409, 'MANUAL_RECORD_ORIGINAL_UNAVAILABLE', 'Das festgeschriebene Original fehlt.');
    if (!expense.storedReceiptFileName) {
      return NextResponse.json(
        { error: 'Kein Beleg für diese Ausgabe vorhanden' },
        { status: 404 }
      );
    }

    const source = expense.purchaseDocument;
    if (source && (source.userId !== userId || source.reviewStatus !== 'BOOKED' || source.storedFileName !== expense.storedReceiptFileName)) throw new PurchaseDocumentError('Quellenverknüpfung ist inkonsistent.', 409, 'SOURCE_STATE');

    // Resolve only through the current tenant's private directory, with a
    // guarded legacy fallback that checks all DB references for ownership.
    const filePath = await findOwnedUploadedFile(userId, expense.storedReceiptFileName);

    if (!filePath && manualOriginal?.status === 'ARCHIVED') throw new ManualFinancialRecordError(409, 'MANUAL_RECORD_ORIGINAL_UNAVAILABLE', 'Das festgeschriebene Original fehlt.');
    if (!filePath && !source) {
      return NextResponse.json(
        { error: 'Datei nicht gefunden' },
        { status: 404 }
      );
    }

    // Datei einlesen
    const fileBuffer = manualOriginal?.status === 'ARCHIVED' ? (await readManualRecordOriginalBytes(userId, expense.storedReceiptFileName, manualOriginal)).bytes : source ? await readPurchaseOriginal(source) : await readFile(filePath!);

    // Content-Type bestimmen basierend auf der Dateierweiterung
    const fileExtension = path.extname(expense.storedReceiptFileName).toLowerCase();
    let contentType = 'application/octet-stream'; // Standard

    if (fileExtension === '.xml') {
      contentType = 'application/xml';
    } else if (fileExtension === '.pdf') {
      contentType = 'application/pdf';
    } else if (fileExtension === '.jpg' || fileExtension === '.jpeg') {
      contentType = 'image/jpeg';
    } else if (fileExtension === '.png') {
      contentType = 'image/png';
    }

    // Dateiname für den Download - verwende den ursprünglichen Dateinamen wenn verfügbar
    const downloadFilename = safeDownloadName(expense.receiptFileName || expense.storedReceiptFileName);

    // Response mit Datei und korrekten Headers
    const headers: HeadersInit = {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      // Allow iframe embedding for preview (SAMEORIGIN instead of DENY)
      'X-Frame-Options': 'SAMEORIGIN',
    };

    // Wenn download=true übergeben wurde, setze den Content-Disposition Header für Download
    if (download || contentType === 'application/xml') {
      headers['Content-Disposition'] = `attachment; filename="${downloadFilename}"`;
    } else {
      // Für Vorschau im Browser: inline statt attachment
      headers['Content-Disposition'] = `inline; filename="${downloadFilename}"`;
    }

    const response = new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: headers,
    });

    return response;
  } catch (error) {
    if (error instanceof ManualFinancialRecordError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof PurchaseDocumentError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Fehler beim Laden des Belegs:', error);
    return NextResponse.json(
      { error: 'Fehler beim Laden des Belegs: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}
