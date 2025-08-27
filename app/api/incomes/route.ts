import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: Request) {
  const { description, amount, customerId, taxRelevant } = await request.json();

  if (!description || !amount) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const income = await prisma.income.create({
    data: {
      description,
      amount: parseFloat(amount.toString()),
      customer: customerId ? { connect: { id: customerId } } : undefined,
      taxRelevant: taxRelevant !== undefined ? taxRelevant : true,
    },
  });

  return NextResponse.json(income);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20')));
  const skip = (page - 1) * pageSize;

  // Filters
  const search = url.searchParams.get('search') || '';
  const customer = url.searchParams.get('customer') || '';
  const taxRelevant = url.searchParams.get('taxRelevant'); // 'yes' | 'no' | null
  const dateRange = url.searchParams.get('dateRange') as 'all' | 'thisMonth' | 'lastMonth' | 'thisYear' | null;

  const where: any = {};

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
      { description: { contains: search, mode: 'insensitive' } },
      { customer: { name: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [incomes, total] = await Promise.all([
    prisma.income.findMany({
      where,
      orderBy: { date: 'desc' },
      include: { invoice: true, customer: true },
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
}

// Neue Methode zum Aktualisieren einer Einnahme
export async function PUT(request: Request) {
  const { id, description, amount, customerId, taxRelevant } = await request.json();

  if (!id || !description || !amount) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  try {
    const updatedIncome = await prisma.income.update({
      where: { id: Number(id) },
      data: {
        description,
        amount: parseFloat(amount.toString()),
        customer: customerId ? { connect: { id: customerId } } : { disconnect: true },
        taxRelevant: taxRelevant !== undefined ? taxRelevant : true,
      },
    });
    return NextResponse.json(updatedIncome);
  } catch (error) {
    return NextResponse.json({ error: 'Einnahme nicht gefunden' }, { status: 404 });
  }
}

// Neue Methode zum Löschen einer Einnahme
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'ID ist erforderlich' }, { status: 400 });
  }

  try {
    // Prüfen, ob eine mit dieser Einnahme verknüpfte Rechnung existiert
    const income = await prisma.income.findUnique({
      where: { id: Number(id) },
      include: { invoice: true },
    });

    if (income && income.invoice) {
      // Update der Rechnung, um die Verknüpfung aufzuheben
      await prisma.invoice.update({
        where: { id: income.invoice.id },
        data: { income: { disconnect: true } },
      });
    }

    // Jetzt die Einnahme löschen
    await prisma.income.delete({
      where: { id: Number(id) },
    });
    
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Einnahme nicht gefunden' }, { status: 404 });
  }
}
