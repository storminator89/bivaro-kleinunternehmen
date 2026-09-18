import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { auditCreate, auditUpdate, auditDelete } from '@/lib/audit-log';

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const { description, amount, customerId, taxRelevant } = await request.json();

    if (!description || !amount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount)) {
      return NextResponse.json({ error: 'Ungültiger Betrag' }, { status: 400 });
    }
    const parsedCustomerId = customerId === undefined || customerId === null || customerId === ''
      ? null
      : Number(customerId);
    if (parsedCustomerId !== null && (!Number.isInteger(parsedCustomerId) || parsedCustomerId <= 0)) {
      return NextResponse.json({ error: 'Ungültiger Kunde' }, { status: 400 });
    }
    if (parsedCustomerId !== null) {
      const customer = await prisma.customer.findFirst({ where: { id: parsedCustomerId, userId } });
      if (!customer) return NextResponse.json({ error: 'Kunde nicht gefunden' }, { status: 404 });
    }

    const income = await prisma.income.create({
      data: {
        description,
        amount: parsedAmount,
        customerId: parsedCustomerId,
        taxRelevant: taxRelevant !== undefined ? taxRelevant : true,
        userId,
      },
    });

    // Audit log
    await auditCreate(userId, 'Income', income, income.description);

    return NextResponse.json(income);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
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
    const { id, description, amount, customerId, taxRelevant, date } = await request.json();

    if (!id || !description || !amount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount)) {
      return NextResponse.json({ error: 'Ungültiger Betrag' }, { status: 400 });
    }
    const parsedCustomerId = customerId === undefined || customerId === null || customerId === ''
      ? null
      : Number(customerId);
    if (parsedCustomerId !== null && (!Number.isInteger(parsedCustomerId) || parsedCustomerId <= 0)) {
      return NextResponse.json({ error: 'Ungültiger Kunde' }, { status: 400 });
    }
    if (parsedCustomerId !== null) {
      const customer = await prisma.customer.findFirst({ where: { id: parsedCustomerId, userId } });
      if (!customer) return NextResponse.json({ error: 'Kunde nicht gefunden' }, { status: 404 });
    }
    const parsedDate = date ? new Date(date) : undefined;
    if (parsedDate && Number.isNaN(parsedDate.getTime())) {
      return NextResponse.json({ error: 'Ungültiges Datum' }, { status: 400 });
    }

    // Get old values for audit - verify ownership first
    const oldIncome = await prisma.income.findFirst({
      where: { id: Number(id), userId },
      include: { invoice: true, cashTransaction: true },
    });

    if (!oldIncome) {
      return NextResponse.json({ error: 'Einnahme nicht gefunden' }, { status: 404 });
    }
    if (oldIncome.invoice || oldIncome.cashTransaction) {
      return NextResponse.json({ error: 'Verknüpfte Einnahmen müssen über Rechnung oder Kassenbuch geändert werden' }, { status: 409 });
    }

    const updatedIncome = await prisma.$transaction(async (tx) => {
      const current = await tx.income.findFirst({ where: { id: Number(id), userId }, include: { invoice: true, cashTransaction: true } });
      if (!current) throw new Error('Einnahme nicht gefunden');
      if (current.invoice || current.cashTransaction) throw new Error('Verknüpfte Einnahmen müssen über Rechnung oder Kassenbuch geändert werden');
      return tx.income.update({
        where: { id: Number(id), userId },
        data: {
          description,
          amount: parsedAmount,
          customer: parsedCustomerId ? { connect: { id: parsedCustomerId } } : { disconnect: true },
          taxRelevant: taxRelevant !== undefined ? taxRelevant : true,
          ...(parsedDate && { date: parsedDate }),
        },
      });
    });

    // Audit log
    if (oldIncome) {
      await auditUpdate(userId, 'Income', id, oldIncome, updatedIncome, updatedIncome.description);
    }

    return NextResponse.json(updatedIncome);
  } catch (_error: unknown) {
    if (_error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    if (_error instanceof Error && _error.message.startsWith('Verknüpfte Einnahmen')) {
      return NextResponse.json({ error: _error.message }, { status: 409 });
    }
    return NextResponse.json({ error: 'Einnahme nicht gefunden' }, { status: 404 });
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

    // Prüfen, ob eine mit dieser Einnahme verknüpfte Rechnung existiert
    const income = await prisma.income.findUnique({
      where: { id: Number(id), userId },
      include: { invoice: true, cashTransaction: true },
    });

    if (!income) {
      return NextResponse.json({ error: 'Einnahme nicht gefunden' }, { status: 404 });
    }
    if (income.invoice || income.cashTransaction) {
      return NextResponse.json({ error: 'Verknüpfte Einnahmen müssen über Rechnung oder Kassenbuch gelöscht werden' }, { status: 409 });
    }

    await prisma.$transaction(async (tx) => {
      const current = await tx.income.findFirst({ where: { id: Number(id), userId }, include: { invoice: true, cashTransaction: true } });
      if (!current) throw new Error('Einnahme nicht gefunden');
      if (current.invoice || current.cashTransaction) throw new Error('Verknüpfte Einnahmen müssen über Rechnung oder Kassenbuch gelöscht werden');
      await tx.income.delete({ where: { id: Number(id), userId } });
    });

    // Audit log
    if (income) {
      await auditDelete(userId, 'Income', income, income.description);
    }

    return NextResponse.json({ success: true });
  } catch (_error: unknown) {
    if (_error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    if (_error instanceof Error && _error.message.startsWith('Verknüpfte Einnahmen')) {
      return NextResponse.json({ error: _error.message }, { status: 409 });
    }
    return NextResponse.json({ error: 'Einnahme nicht gefunden' }, { status: 404 });
  }
}
