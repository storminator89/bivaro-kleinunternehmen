import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import JSZip from 'jszip';
import { promises as fs } from 'fs';
import { extname, basename } from 'path';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { findUploadedFile } from '@/lib/upload-path';

type DateRangeParam = 'all' | 'thisMonth' | 'lastMonth' | 'thisYear' | null;

function parseFilters(url: URL) {
  const search = url.searchParams.get('search') || '';
  const category = url.searchParams.get('category') || '';
  const taxRelevant = url.searchParams.get('taxRelevant');
  const hasReceipt = url.searchParams.get('hasReceipt');
  const dateRange = url.searchParams.get('dateRange') as DateRangeParam;

  const where: Prisma.ExpenseWhereInput = {};

  if (category) {
    where.category = category;
  }

  if (taxRelevant === 'yes') {
    where.taxRelevant = true;
  } else if (taxRelevant === 'no') {
    where.taxRelevant = false;
  }

  if (hasReceipt === 'yes') {
    where.storedReceiptFileName = { not: null };
  } else if (hasReceipt === 'no') {
    where.storedReceiptFileName = null;
  }

  if (dateRange && dateRange !== 'all') {
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    if (dateRange === 'thisMonth') {
      const start = new Date(thisYear, thisMonth, 1);
      const end = new Date(thisYear, thisMonth + 1, 0, 23, 59, 59, 999);
      where.date = { gte: start, lte: end };
    } else if (dateRange === 'lastMonth') {
      const prevMonth = thisMonth === 0 ? 11 : thisMonth - 1;
      const prevYear = thisMonth === 0 ? thisYear - 1 : thisYear;
      const start = new Date(prevYear, prevMonth, 1);
      const end = new Date(prevYear, prevMonth + 1, 0, 23, 59, 59, 999);
      where.date = { gte: start, lte: end };
    } else if (dateRange === 'thisYear') {
      const start = new Date(thisYear, 0, 1);
      const end = new Date(thisYear, 11, 31, 23, 59, 59, 999);
      where.date = { gte: start, lte: end };
    }
  }

  if (search) {
    where.OR = [
      { description: { contains: search } },
      { category: { contains: search } },
    ];
  }

  return where;
}

function createSafeFilename(original: string, fallback: string, existing: Set<string>) {
  const source = (original || fallback).normalize('NFKD').replace(/[^\w.\- ()]/g, '_');
  const ext = extname(source);
  const base = basename(source, ext);
  let candidate = source || fallback;
  let counter = 1;

  while (existing.has(candidate)) {
    const suffix = ` (${counter})`;
    candidate = `${base}${suffix}${ext}`;
    counter += 1;
  }

  existing.add(candidate);
  return candidate;
}

function formatCurrency(value: number) {
  return value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sanitizeCsvField(value: string) {
  return value.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""');
}

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const where = parseFilters(url);
    where.userId = userId;

    // Sicherstellen, dass nur Einträge mit Belegen exportiert werden
    if (!Object.prototype.hasOwnProperty.call(where, 'storedReceiptFileName')) {
      where.storedReceiptFileName = { not: null };
    }

    const expenses = await prisma.expense.findMany({
      where,
      orderBy: { date: 'desc' },
    });

    if (!expenses.length) {
      return NextResponse.json(
        { error: 'Keine passenden Belege gefunden.' },
        { status: 404 }
      );
    }

    const zip = new JSZip();
    const usedFilenames = new Set<string>();
    const metadataLines: string[] = ['"ID";"Datum";"Beschreibung";"Kategorie";"Betrag";"Dateiname"'];
    const missingFiles: string[] = [];
    let filesAdded = 0;

    for (const expense of expenses) {
      if (!expense.storedReceiptFileName) {
        continue;
      }

      const filePath = findUploadedFile(expense.storedReceiptFileName);

      if (!filePath) {
        missingFiles.push(`${expense.id}: ${expense.storedReceiptFileName}`);
        continue;
      }

      try {
        const fileBuffer = await fs.readFile(filePath);
        const filename = createSafeFilename(
          expense.receiptFileName || '',
          `${expense.id}_${expense.storedReceiptFileName}`,
          usedFilenames
        );
        zip.file(filename, fileBuffer);
        filesAdded += 1;

        metadataLines.push([
          String(expense.id),
          expense.date.toISOString().split('T')[0],
          `"${sanitizeCsvField(expense.description || '')}"`,
          expense.category ? `"${sanitizeCsvField(expense.category)}"` : '""',
          formatCurrency(expense.amount),
          `"${filename}"`,
        ].join(';'));
      } catch (_error) {
        console.error(`Fehler beim Lesen der Datei ${filePath}:`, _error);
        missingFiles.push(`${expense.id}: ${expense.storedReceiptFileName}`);
      }
    }

    if (!filesAdded) {
      return NextResponse.json(
        { error: 'Für die Auswahl wurden keine Belegdateien gefunden.' },
        { status: 404 }
      );
    }

    if (metadataLines.length > 1) {
      zip.file('belege-metadata.csv', metadataLines.join('\n'));
    }

    if (missingFiles.length) {
      zip.file('fehlende-dateien.txt', missingFiles.join('\n'));
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const dateStamp = new Date().toISOString().split('T')[0];
    const fileName = `belege-${dateStamp}.zip`;

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Fehler beim Export der Belege:', error);
    return NextResponse.json(
      { error: 'Fehler beim Export der Belege: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}
