import { NextResponse, NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { createFinancialAuditLog } from '@/lib/audit-log';
import { inTransaction } from '@/lib/db-transaction';
import { deleteTenantFile, writeTenantFile } from '@/lib/upload-path';
import {
  isFiniteNumber,
  isRequestBodyWithinLimit,
  readRequestBodyWithinLimit,
  requestWithBody,
  RequestBodyLimitError,
  MAX_RECEIPT_UPLOAD_BYTES,
  MAX_JSON_REQUEST_BYTES,
} from '@/lib/resource-limits';

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUserId();
    if (!isRequestBodyWithinLimit(request, MAX_RECEIPT_UPLOAD_BYTES + 128 * 1024)) {
      return NextResponse.json({ error: 'Anfrage ist zu groß' }, { status: 413 });
    }
    // Prüfen, ob es sich um einen multipart/form-data-Request handelt
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      // Formular mit Datei verarbeiten
      const boundedBody = await readRequestBodyWithinLimit(request, MAX_RECEIPT_UPLOAD_BYTES + 128 * 1024);
      const formData = await requestWithBody(request, boundedBody).formData();
      const description = formData.get('description') as string;
      const amount = formData.get('amount') as string;
      const category = formData.get('category') as string;
      const taxRelevant = formData.get('taxRelevant') === 'true';
      const receiptValue = formData.get('receipt');
      if (receiptValue !== null && !(receiptValue instanceof File)) {
        return NextResponse.json({ error: 'Ungültiger Beleg' }, { status: 400 });
      }
      const receipt = receiptValue as File | null;
      const dateStr = formData.get('date') as string;

      if (!description || !amount) {
        return NextResponse.json({ error: 'Fehlende Pflichtfelder' }, { status: 400 });
      }

      const parsedAmount = Number(amount);
      if (!isFiniteNumber(parsedAmount)) {
        return NextResponse.json({ error: 'Ungültiger Betrag' }, { status: 400 });
      }
      const deductibleValue = formData.get('taxDeductiblePercentage');
      const parsedDeductible = deductibleValue === null || deductibleValue === ''
        ? 100
        : Number(deductibleValue);
      if (!isFiniteNumber(parsedDeductible) || parsedDeductible < 0 || parsedDeductible > 100) {
        return NextResponse.json({ error: 'Ungültiger Abzugsanteil' }, { status: 400 });
      }
      const depreciationValue = formData.get('depreciationYears');
      const parsedDepreciation = depreciationValue === null || depreciationValue === ''
        ? null
        : Number(depreciationValue);
      if (parsedDepreciation !== null && (!isFiniteNumber(parsedDepreciation) || !Number.isInteger(parsedDepreciation) || parsedDepreciation <= 0)) {
        return NextResponse.json({ error: 'Ungültige Abschreibungsdauer' }, { status: 400 });
      }

      let receiptFileName = null;
      let storedReceiptFileName = null;

      // Wenn eine Datei hochgeladen wurde, speichern wir sie
      if (receipt) {
        if (receipt.size > MAX_RECEIPT_UPLOAD_BYTES) {
          return NextResponse.json({ error: 'Beleg ist zu groß' }, { status: 413 });
        }
        // Dateityp prüfen
        const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
        if (!validTypes.includes(receipt.type)) {
          return NextResponse.json(
            { error: 'Nur PDF, JPG und PNG-Dateien werden unterstützt' },
            { status: 400 }
          );
        }

        const bytes = await receipt.arrayBuffer();
        const buffer = Buffer.from(bytes);
        if (buffer.byteLength > MAX_RECEIPT_UPLOAD_BYTES) {
          return NextResponse.json({ error: 'Beleg ist zu groß' }, { status: 413 });
        }

        // The original name is metadata; writeTenantFile generates the path.
        receiptFileName = receipt.name;
        storedReceiptFileName = await writeTenantFile(userId, receipt.name, buffer);
      }

      // Ausgabe in der Datenbank speichern
      const parsedDate = dateStr ? new Date(dateStr) : new Date();
      if (Number.isNaN(parsedDate.getTime())) {
        if (storedReceiptFileName) {
          try { await deleteTenantFile(userId, storedReceiptFileName); } catch { /* best-effort orphan cleanup */ }
        }
        return NextResponse.json({ error: 'Ungültiges Datum' }, { status: 400 });
      }
      try {
        const expense = await inTransaction(async tx => {
          const created = await tx.expense.create({
            data: {
              description,
              amount: parsedAmount,
              date: parsedDate,
              category: category || null,
              taxRelevant,
              taxDeductiblePercentage: parsedDeductible,
              receiptFileName,
              storedReceiptFileName,
              depreciationYears: parsedDepreciation,
              userId,
            },
          });
          await createFinancialAuditLog({
            userId,
            action: 'CREATE',
            entityType: 'Expense',
            entityId: created.id,
            entityName: created.description,
            newValues: created,
            metadata: {
              actorId: userId,
              tenantId: userId,
              operation: 'expense.create',
              originalReference: `expense:${created.id}`,
              reason: 'Expense created',
            },
          }, tx);
          return created;
        });

        return NextResponse.json(expense);
      } catch (error) {
        if (storedReceiptFileName) {
          try { await deleteTenantFile(userId, storedReceiptFileName); } catch { /* best-effort orphan cleanup */ }
        }
        throw error;
      }
    } else {
      // Verarbeite regulären JSON-Request ohne Datei
      const jsonBody = await readRequestBodyWithinLimit(request, MAX_JSON_REQUEST_BYTES);
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(new TextDecoder().decode(jsonBody)) as Record<string, unknown>;
      } catch {
        return NextResponse.json({ error: 'Ungültiges JSON' }, { status: 400 });
      }
      const { description, amount, category, taxRelevant, taxDeductiblePercentage, depreciationYears, date } = input;

      const descriptionText = typeof description === 'string' ? description.trim() : '';
      if (!descriptionText || amount === undefined || amount === null || amount === '') {
        return NextResponse.json({ error: 'Fehlende Pflichtfelder' }, { status: 400 });
      }

      const parsedAmount = Number(amount);
      const parsedDeductible = taxDeductiblePercentage === undefined || taxDeductiblePercentage === null
        ? 100
        : Number(taxDeductiblePercentage);
      const parsedDepreciation = depreciationYears === undefined || depreciationYears === null
        ? null
        : Number(depreciationYears);
      if (!isFiniteNumber(parsedAmount) || !isFiniteNumber(parsedDeductible) || parsedDeductible < 0 || parsedDeductible > 100) {
        return NextResponse.json({ error: 'Ungültiger Betrag oder Abzugsanteil' }, { status: 400 });
      }
      if (parsedDepreciation !== null && (!isFiniteNumber(parsedDepreciation) || !Number.isInteger(parsedDepreciation) || parsedDepreciation <= 0)) {
        return NextResponse.json({ error: 'Ungültige Abschreibungsdauer' }, { status: 400 });
      }
      const categoryText = category === undefined || category === null
        ? null
        : typeof category === 'string' ? category : null;
      if (category !== undefined && category !== null && categoryText === null) {
        return NextResponse.json({ error: 'Ungültige Kategorie' }, { status: 400 });
      }
      const parsedTaxRelevant = taxRelevant === undefined ? true : taxRelevant;
      if (typeof parsedTaxRelevant !== 'boolean') {
        return NextResponse.json({ error: 'Ungültige Steuerrelevanz' }, { status: 400 });
      }
      const dateValue = date === undefined || date === null || date === ''
        ? undefined
        : typeof date === 'string' || typeof date === 'number' ? date : null;
      if (dateValue === null) {
        return NextResponse.json({ error: 'Ungültiges Datum' }, { status: 400 });
      }
      const parsedDate = dateValue === undefined ? new Date() : new Date(dateValue);
      if (Number.isNaN(parsedDate.getTime())) {
        return NextResponse.json({ error: 'Ungültiges Datum' }, { status: 400 });
      }

      const expense = await inTransaction(async tx => {
        const created = await tx.expense.create({
          data: {
            description: descriptionText,
            amount: parsedAmount,
            date: parsedDate,
            category: categoryText,
            taxRelevant: parsedTaxRelevant,
            taxDeductiblePercentage: parsedDeductible,
            depreciationYears: parsedDepreciation,
            userId,
          },
        });
        await createFinancialAuditLog({
          userId,
          action: 'CREATE',
          entityType: 'Expense',
          entityId: created.id,
          entityName: created.description,
          newValues: created,
          metadata: {
            actorId: userId,
            tenantId: userId,
            operation: 'expense.create',
            originalReference: `expense:${created.id}`,
            reason: 'Expense created',
          },
        }, tx);
        return created;
      });

      return NextResponse.json(expense);
    }
  } catch (error: unknown) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    if (error instanceof RequestBodyLimitError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
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
    const jsonBody = await readRequestBodyWithinLimit(request, MAX_JSON_REQUEST_BYTES);
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(new TextDecoder().decode(jsonBody)) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Ungültiges JSON' }, { status: 400 });
    }
    const { id, description, amount, category, taxRelevant, taxDeductiblePercentage, receiptUrl, depreciationYears, date } = input;

    const parsedId = Number(id);
    const descriptionText = typeof description === 'string' ? description.trim() : '';
    if (!Number.isSafeInteger(parsedId) || parsedId <= 0 || !descriptionText || amount === undefined || amount === null || amount === '') {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const parsedAmount = Number(amount);
    const parsedDeductible = taxDeductiblePercentage === undefined || taxDeductiblePercentage === null
      ? 100
      : Number(taxDeductiblePercentage);
    const parsedDepreciation = depreciationYears === undefined || depreciationYears === null
      ? null
      : Number(depreciationYears);
    if (!isFiniteNumber(parsedAmount) || !isFiniteNumber(parsedDeductible) || parsedDeductible < 0 || parsedDeductible > 100) {
      return NextResponse.json({ error: 'Ungültiger Betrag oder Abzugsanteil' }, { status: 400 });
    }
    if (parsedDepreciation !== null && (!isFiniteNumber(parsedDepreciation) || !Number.isInteger(parsedDepreciation) || parsedDepreciation <= 0)) {
      return NextResponse.json({ error: 'Ungültige Abschreibungsdauer' }, { status: 400 });
    }
    const categoryText = category === undefined || category === null
      ? null
      : typeof category === 'string' ? category : null;
    if (category !== undefined && category !== null && categoryText === null) {
      return NextResponse.json({ error: 'Ungültige Kategorie' }, { status: 400 });
    }
    const parsedTaxRelevant = taxRelevant === undefined ? true : taxRelevant;
    if (typeof parsedTaxRelevant !== 'boolean') {
      return NextResponse.json({ error: 'Ungültige Steuerrelevanz' }, { status: 400 });
    }
    const receiptUrlText = receiptUrl === undefined || receiptUrl === null
      ? null
      : typeof receiptUrl === 'string' ? receiptUrl : null;
    if (receiptUrl !== undefined && receiptUrl !== null && receiptUrlText === null) {
      return NextResponse.json({ error: 'Ungültige Beleg-URL' }, { status: 400 });
    }
    const dateValue = date === undefined || date === null || date === ''
      ? undefined
      : typeof date === 'string' || typeof date === 'number' ? date : null;
    if (dateValue === null) {
      return NextResponse.json({ error: 'Ungültiges Datum' }, { status: 400 });
    }
    const parsedDate = dateValue === undefined ? undefined : new Date(dateValue);
    if (parsedDate && Number.isNaN(parsedDate.getTime())) {
      return NextResponse.json({ error: 'Ungültiges Datum' }, { status: 400 });
    }

    const result = await inTransaction(async (tx) => {
      const current = await tx.expense.findFirst({ where: { id: parsedId, userId }, include: { cashTransaction: true } });
      if (!current) throw new Error('Ausgabe nicht gefunden');
      if (current.cashTransaction) throw new Error('Mit dem Kassenbuch verknüpfte Ausgaben müssen dort geändert werden');
      const updated = await tx.expense.update({
        where: { id: parsedId, userId },
        data: {
          description: descriptionText,
          amount: parsedAmount,
          date: parsedDate,
          category: categoryText,
          taxRelevant: parsedTaxRelevant,
          taxDeductiblePercentage: parsedDeductible,
          receiptUrl: receiptUrlText,
          depreciationYears: parsedDepreciation,
        },
      });
      await createFinancialAuditLog({
        userId,
        action: 'UPDATE',
        entityType: 'Expense',
        entityId: updated.id,
        entityName: updated.description,
        oldValues: current,
        newValues: updated,
        metadata: {
          actorId: userId,
          tenantId: userId,
          operation: 'expense.update',
          originalReference: `expense:${updated.id}`,
          reason: 'Expense updated',
        },
      }, tx);
      return updated;
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    if (error instanceof RequestBodyLimitError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && error.message === 'Ausgabe nicht gefunden') {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof Error && error.message.startsWith('Mit dem Kassenbuch')) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('Fehler beim Aktualisieren der Ausgabe:', error);
    return NextResponse.json({ error: 'Fehler beim Aktualisieren der Ausgabe' }, { status: 500 });
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

    const parsedId = Number(id);
    if (!Number.isSafeInteger(parsedId) || parsedId <= 0) {
      return NextResponse.json({ error: 'Ungültige ID' }, { status: 400 });
    }

    await inTransaction(async (tx) => {
      const current = await tx.expense.findFirst({ where: { id: parsedId, userId }, include: { cashTransaction: true } });
      if (!current) throw new Error('Ausgabe nicht gefunden');
      if (current.cashTransaction) throw new Error('Mit dem Kassenbuch verknüpfte Ausgaben müssen dort gelöscht werden');
      await tx.expense.delete({ where: { id: parsedId, userId } });
      await createFinancialAuditLog({
        userId,
        action: 'DELETE',
        entityType: 'Expense',
        entityId: current.id,
        entityName: current.description,
        oldValues: current,
        metadata: {
          actorId: userId,
          tenantId: userId,
          operation: 'expense.delete',
          originalReference: `expense:${current.id}`,
          reason: 'Expense deleted',
        },
      }, tx);
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    if (error instanceof Error && error.message === 'Ausgabe nicht gefunden') {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof Error && error.message.startsWith('Mit dem Kassenbuch')) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('Fehler beim Löschen der Ausgabe:', error);
    return NextResponse.json({ error: 'Fehler beim Löschen der Ausgabe' }, { status: 500 });
  }
}
