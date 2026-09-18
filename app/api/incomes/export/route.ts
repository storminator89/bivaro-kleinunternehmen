import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import JSZip from 'jszip';
import { promises as fs } from 'fs';
import { extname, basename } from 'path';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { findOwnedUploadedFile } from '@/lib/upload-ownership';

type DateRangeParam = 'all' | 'thisMonth' | 'lastMonth' | 'thisYear' | null;

async function parseFilters(url: URL): Promise<Prisma.IncomeWhereInput> {
  const search = url.searchParams.get('search') || '';
  const customer = url.searchParams.get('customer') || '';
  const taxRelevant = url.searchParams.get('taxRelevant');
  const dateRange = url.searchParams.get('dateRange') as DateRangeParam;

  const userId = await requireUserId();
  const where: Prisma.IncomeWhereInput = { userId };

  if (customer) {
    where.customer = { name: customer };
  }

  if (taxRelevant === 'yes') {
    where.taxRelevant = true;
  } else if (taxRelevant === 'no') {
    where.taxRelevant = false;
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
      { customer: { name: { contains: search } } },
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

function sanitizeCsvField(value: string) {
  return value.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""');
}

function formatCurrency(value: number) {
  return value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export async function GET(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const where: Prisma.IncomeWhereInput = await parseFilters(url);

    const incomes = await prisma.income.findMany({
      where,
      orderBy: { date: 'desc' },
      include: {
        invoice: true,
        customer: true,
      },
    });

    const items = incomes as (Prisma.IncomeGetPayload<{
      include: { invoice: true, customer: true }
    }>)[];

    if (!items.length) {
      return NextResponse.json(
        { error: 'Keine passenden Einnahmen gefunden.' },
        { status: 404 }
      );
    }

    const zip = new JSZip();
    const usedFilenames = new Set<string>();
    const metadataLines: string[] = ['"ID";"Datum";"Beschreibung";"Kunde";"Betrag";"Rechnungsnummer";"Dateiname"'];
    const missingFiles: string[] = [];
    let filesAdded = 0;

    for (const income of items) {
      if (!income.invoice || !income.invoice.storedFileName) {
        continue;
      }

      const filePath = await findOwnedUploadedFile(userId, income.invoice.storedFileName);

      if (!filePath) {
        missingFiles.push(`${income.id}: ${income.invoice.storedFileName}`);
        continue;
      }

      try {
        const buffer = await fs.readFile(filePath);
        const filename = createSafeFilename(
          income.invoice.fileName || '',
          `${income.id}_${income.invoice.storedFileName}`,
          usedFilenames
        );
        zip.file(filename, buffer);
        filesAdded += 1;

        metadataLines.push([
          String(income.id),
          income.date.toISOString().split('T')[0],
          `"${sanitizeCsvField(income.description || '')}"`,
          income.customer?.name ? `"${sanitizeCsvField(income.customer.name)}"` : '""',
          formatCurrency(income.amount),
          income.invoice.invoiceNumber ? `"${sanitizeCsvField(income.invoice.invoiceNumber)}"` : '""',
          `"${filename}"`,
        ].join(';'));
      } catch (error) {
        console.error(`Fehler beim Lesen der Datei ${filePath}:`, error);
        missingFiles.push(`${income.id}: ${income.invoice.storedFileName}`);
      }
    }

    if (!filesAdded) {
      return NextResponse.json(
        { error: 'Für die Auswahl wurden keine Rechnungsdateien gefunden.' },
        { status: 404 }
      );
    }

    if (metadataLines.length > 1) {
      zip.file('einnahmen-metadata.csv', metadataLines.join('\n'));
    }

    if (missingFiles.length) {
      zip.file('fehlende-dateien.txt', missingFiles.join('\n'));
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const dateStamp = new Date().toISOString().split('T')[0];
    const filename = `einnahmen-${dateStamp}.zip`;

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Fehler beim Export der Einnahmen:', error);
    return NextResponse.json(
      { error: 'Fehler beim Export der Einnahmen: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}
