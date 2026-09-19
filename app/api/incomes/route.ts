import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { BusinessDateError, parseBusinessDate } from '@/lib/business-date';
import {
  createManualIncome,
  deleteManualIncome,
  IncomeMutationError,
  updateManualIncome,
} from '@/lib/income-service';

function mutationErrorResponse(error: unknown) {
  if (error instanceof IncomeMutationError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return null;
}

function parseIncomeId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new IncomeMutationError(400, 'VALIDATION_ERROR', 'Ungültige Einnahme-ID');
  return id;
}

function parseIncomeAmount(value: unknown, required: boolean): number | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) throw new IncomeMutationError(400, 'VALIDATION_ERROR', 'Ein gültiger Betrag ist erforderlich');
    return undefined;
  }
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new IncomeMutationError(400, 'VALIDATION_ERROR', 'Ungültiger Betrag');
  }
  if (typeof value === 'string' && value.trim().length === 0) {
    throw new IncomeMutationError(400, 'VALIDATION_ERROR', 'Ungültiger Betrag');
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new IncomeMutationError(400, 'VALIDATION_ERROR', 'Ungültiger Betrag');
  return amount;
}

function parseIncomeCustomerId(value: unknown, present: boolean): number | null | undefined {
  if (!present) return undefined;
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') throw new IncomeMutationError(400, 'VALIDATION_ERROR', 'Ungültiger Kunde');
  if (typeof value === 'string' && value.trim().length === 0) return null;
  const id = Number(value);
  if ((typeof value === 'string' && !/^[1-9]\d*$/.test(value)) || !Number.isSafeInteger(id) || id <= 0) {
    throw new IncomeMutationError(400, 'VALIDATION_ERROR', 'Ungültiger Kunde');
  }
  return id;
}

function parseIncomeTaxRelevant(value: unknown, present: boolean): boolean | undefined {
  if (!present) return undefined;
  if (typeof value !== 'boolean') throw new IncomeMutationError(400, 'VALIDATION_ERROR', 'taxRelevant muss boolesch sein');
  return value;
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json();
    const { description, amount, customerId, taxRelevant, date } = body;
    if (typeof description !== 'string' || description.trim().length === 0) {
      return NextResponse.json({ error: 'Beschreibung ist erforderlich', field: 'description' }, { status: 400 });
    }

    const parsedAmount = parseIncomeAmount(amount, true)!;
    const parsedCustomerId = parseIncomeCustomerId(customerId, Object.prototype.hasOwnProperty.call(body, 'customerId')) ?? null;
    const parsedTaxRelevant = parseIncomeTaxRelevant(taxRelevant, Object.prototype.hasOwnProperty.call(body, 'taxRelevant')) ?? true;
    let parsedDate: Date;
    try {
      parsedDate = parseBusinessDate(date);
    } catch (error) {
      if (error instanceof BusinessDateError) {
        return NextResponse.json({ error: 'Zahlungsdatum muss als YYYY-MM-DD angegeben werden', field: 'date' }, { status: 400 });
      }
      throw error;
    }

    const income = await createManualIncome(userId, {
      description: description.trim(),
      amount: parsedAmount,
      date: parsedDate,
      customerId: parsedCustomerId,
      taxRelevant: parsedTaxRelevant,
    });

    return NextResponse.json(income);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    const response = mutationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20')));
    const skip = (page - 1) * pageSize;

    // Filters
    const search = url.searchParams.get('search') || '';
    const customer = url.searchParams.get('customer') || '';
    const taxRelevant = url.searchParams.get('taxRelevant'); // 'yes' | 'no' | null
    const dateRange = url.searchParams.get('dateRange') as 'all' | 'thisMonth' | 'lastMonth' | 'thisYear' | null;

    const where: Prisma.IncomeWhereInput = { userId };

    if (customer) {
      where.customer = { name: customer };
    }
    if (taxRelevant === 'yes') where.taxRelevant = true;
    if (taxRelevant === 'no') where.taxRelevant = false;

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

    const [incomes, total] = await Promise.all([
      prisma.income.findMany({
        where,
        orderBy: { date: 'desc' },
        include: {
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              status: true,
              paidAt: true,
            },
          },
          customer: true,
        },
        skip,
        take: pageSize,
      }),
      prisma.income.count({ where }),
    ]);

    const items = incomes.map(income => ({
      ...income,
      invoiceStatus: income.invoice ? income.invoice.status : undefined,
      customerName: income.customer ? income.customer.name : undefined,
      invoice: undefined,
      customer: undefined,
    }));

    return NextResponse.json({ items, total, page, pageSize });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    throw error;
  }
}

// Neue Methode zum Aktualisieren einer Einnahme
export async function PUT(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json();
    const { id, description, amount, customerId, taxRelevant, date } = body;
    const parsedId = parseIncomeId(id);
    if (description !== undefined && (typeof description !== 'string' || description.trim().length === 0)) {
      return NextResponse.json({ error: 'Beschreibung darf nicht leer sein', field: 'description' }, { status: 400 });
    }
    const parsedAmount = parseIncomeAmount(amount, false);
    const hasCustomer = Object.prototype.hasOwnProperty.call(body, 'customerId');
    const parsedCustomerId = parseIncomeCustomerId(customerId, hasCustomer);
    const parsedTaxRelevant = parseIncomeTaxRelevant(taxRelevant, Object.prototype.hasOwnProperty.call(body, 'taxRelevant'));
    let parsedDate: Date | undefined;
    if (date !== undefined) {
      try {
        parsedDate = parseBusinessDate(date);
      } catch (error) {
        if (error instanceof BusinessDateError) {
          return NextResponse.json({ error: 'Zahlungsdatum muss als YYYY-MM-DD angegeben werden', field: 'date' }, { status: 400 });
        }
        throw error;
      }
    }

    const updatedIncome = await updateManualIncome(userId, parsedId, {
      ...(description !== undefined && { description: description.trim() }),
      ...(parsedAmount !== undefined && { amount: parsedAmount }),
      ...(parsedDate !== undefined && { date: parsedDate }),
      ...(hasCustomer && { customerId: parsedCustomerId! }),
      ...(parsedTaxRelevant !== undefined && { taxRelevant: parsedTaxRelevant }),
    });

    return NextResponse.json(updatedIncome);
  } catch (error: unknown) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    const response = mutationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

// Neue Methode zum Löschen einer Einnahme
export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID ist erforderlich' }, { status: 400 });
    }
    await deleteManualIncome(userId, parseIncomeId(id));
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    const response = mutationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
