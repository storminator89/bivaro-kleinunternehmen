import { NextResponse, NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { auditCreate, auditUpdate, auditDelete } from '@/lib/audit-log';
import { UPLOAD_BASE_DIR, ensureUploadDirExists } from '@/lib/upload-path';

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUserId();
    // Prüfen, ob es sich um einen multipart/form-data-Request handelt
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      // Formular mit Datei verarbeiten
      const formData = await request.formData();
      const description = formData.get('description') as string;
      const amount = formData.get('amount') as string;
      const category = formData.get('category') as string;
      const taxRelevant = formData.get('taxRelevant') === 'true';
      const receipt = formData.get('receipt') as File | null;
      const dateStr = formData.get('date') as string;

      if (!description || !amount) {
        return NextResponse.json({ error: 'Fehlende Pflichtfelder' }, { status: 400 });
      }

      let receiptFileName = null;
      let storedReceiptFileName = null;

      // Wenn eine Datei hochgeladen wurde, speichern wir sie
      if (receipt) {
        // Dateityp prüfen
        const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
        if (!validTypes.includes(receipt.type)) {
          return NextResponse.json(
            { error: 'Nur PDF, JPG und PNG-Dateien werden unterstützt' },
            { status: 400 }
          );
        }

        // Datei in temporäres Verzeichnis speichern
        const tempDir = os.tmpdir();
        const bytes = await receipt.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const filePath = join(tempDir, receipt.name);
        await writeFile(filePath, buffer);

        // Generiere einen eindeutigen Dateinamen für die dauerhafte Speicherung
        const uniqueFileName = `${uuidv4()}_${receipt.name.replace(/\s+/g, '_')}`;
        ensureUploadDirExists();
        const permanentFilePath = path.join(UPLOAD_BASE_DIR, uniqueFileName);

        // Kopiere die Datei in das dauerhafte Verzeichnis
        fs.copyFileSync(filePath, permanentFilePath);

        // Originalname und gespeicherten Namen speichern
        receiptFileName = receipt.name;
        storedReceiptFileName = uniqueFileName;

        // Bereinigen (temporäre Datei löschen)
        try {
          fs.unlinkSync(filePath);
        } catch (error) {
          console.error('Fehler beim Löschen der temporären Datei:', error);
        }
      }

      // Ausgabe in der Datenbank speichern
      const expense = await prisma.expense.create({
        data: {
          description,
          amount: parseFloat(amount),
          date: dateStr ? new Date(dateStr) : new Date(),
          category: category || null,
          taxRelevant,
          taxDeductiblePercentage: formData.get('taxDeductiblePercentage') ? parseInt(formData.get('taxDeductiblePercentage') as string) : 100,
          receiptFileName,
          storedReceiptFileName,
          depreciationYears: formData.get('depreciationYears') ? parseInt(formData.get('depreciationYears') as string) : null,
          userId,
        },
      });

      // Audit log
      await auditCreate(userId, 'Expense', expense, expense.description);

      return NextResponse.json(expense);
    } else {
      // Verarbeite regulären JSON-Request ohne Datei
      const { description, amount, category, taxRelevant, taxDeductiblePercentage, depreciationYears, date } = await request.json();

      if (!description || !amount) {
        return NextResponse.json({ error: 'Fehlende Pflichtfelder' }, { status: 400 });
      }

      const expense = await prisma.expense.create({
        data: {
          description,
          amount: parseFloat(amount.toString()),
          date: date ? new Date(date) : new Date(),
          category: category || null,
          taxRelevant: taxRelevant !== undefined ? taxRelevant : true,
          taxDeductiblePercentage: taxDeductiblePercentage || 100,
          depreciationYears: depreciationYears || null,
          userId,
        },
      });

      // Audit log
      await auditCreate(userId, 'Expense', expense, expense.description);

      return NextResponse.json(expense);
    }
  } catch (error: unknown) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Fehler beim Erstellen der Ausgabe:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: 'Fehler beim Erstellen der Ausgabe: ' + message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20')));
    const skip = (page - 1) * pageSize;

    // Filters
    const search = url.searchParams.get('search') || '';
    const category = url.searchParams.get('category') || '';
    const taxRelevant = url.searchParams.get('taxRelevant'); // 'yes' | 'no' | null
    const hasReceipt = url.searchParams.get('hasReceipt'); // 'yes' | 'no' | null
    const dateRange = url.searchParams.get('dateRange') as 'all' | 'thisMonth' | 'lastMonth' | 'thisYear' | null;

    const where: Prisma.ExpenseWhereInput = { userId };

    if (category) {
      where.category = category;
    }

    if (taxRelevant === 'yes') where.taxRelevant = true;
    if (taxRelevant === 'no') where.taxRelevant = false;

    if (hasReceipt === 'yes') where.storedReceiptFileName = { not: null };
    if (hasReceipt === 'no') where.storedReceiptFileName = null;

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

    const [items, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        orderBy: { date: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.expense.count({ where }),
    ]);

    return NextResponse.json({ items, total, page, pageSize });
  } catch (_error: unknown) {
    if (_error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    throw _error;
  }
}

// Neue Methode zum Aktualisieren einer Ausgabe
export async function PUT(request: Request) {
  try {
    const userId = await requireUserId();
    const { id, description, amount, category, taxRelevant, taxDeductiblePercentage, receiptUrl, depreciationYears, date } = await request.json();

    if (!id || !description || !amount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get old values for audit - verify ownership first
    const oldExpense = await prisma.expense.findFirst({
      where: { id: Number(id), userId },
    });

    if (!oldExpense) {
      return NextResponse.json({ error: 'Ausgabe nicht gefunden' }, { status: 404 });
    }

    const updatedExpense = await prisma.expense.update({
      where: { id: Number(id), userId },
      data: {
        description,
        amount: parseFloat(amount.toString()),
        date: date ? new Date(date) : undefined,
        category: category || null,
        taxRelevant: taxRelevant !== undefined ? taxRelevant : true,
        taxDeductiblePercentage: taxDeductiblePercentage || 100,
        receiptUrl: receiptUrl || null,
        depreciationYears: depreciationYears || null,
      },
    });

    // Audit log
    if (oldExpense) {
      await auditUpdate(userId, 'Expense', id, oldExpense, updatedExpense, updatedExpense.description);
    }

    return NextResponse.json(updatedExpense);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    return NextResponse.json({ error: 'Ausgabe nicht gefunden' }, { status: 404 });
  }
}

// Neue Methode zum Löschen einer Ausgabe
export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID ist erforderlich' }, { status: 400 });
    }

    // Get expense for audit before deletion - verify ownership
    const expense = await prisma.expense.findFirst({
      where: { id: Number(id), userId },
    });

    if (!expense) {
      return NextResponse.json({ error: 'Ausgabe nicht gefunden' }, { status: 404 });
    }

    await prisma.expense.delete({
      where: { id: Number(id), userId },
    });

    // Audit log
    if (expense) {
      await auditDelete(userId, 'Expense', expense, expense.description);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    return NextResponse.json({ error: 'Ausgabe nicht gefunden' }, { status: 404 });
  }
}
