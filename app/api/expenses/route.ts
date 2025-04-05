import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: Request) {
  const { description, amount, category, taxRelevant, receiptUrl } = await request.json();

  if (!description || !amount) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const expense = await prisma.expense.create({
    data: {
      description,
      amount: parseFloat(amount.toString()),
      category: category || null,
      taxRelevant: taxRelevant !== undefined ? taxRelevant : true,
      receiptUrl: receiptUrl || null,
    },
  });

  return NextResponse.json(expense);
}

export async function GET() {
  const expenses = await prisma.expense.findMany({
    orderBy: {
      date: 'desc',
    },
  });
  return NextResponse.json(expenses);
}

// Neue Methode zum Aktualisieren einer Ausgabe
export async function PUT(request: Request) {
  const { id, description, amount, category, taxRelevant, receiptUrl } = await request.json();

  if (!id || !description || !amount) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  try {
    const updatedExpense = await prisma.expense.update({
      where: { id: Number(id) },
      data: {
        description,
        amount: parseFloat(amount.toString()),
        category: category || null,
        taxRelevant: taxRelevant !== undefined ? taxRelevant : true,
        receiptUrl: receiptUrl || null,
      },
    });
    return NextResponse.json(updatedExpense);
  } catch (error) {
    return NextResponse.json({ error: 'Ausgabe nicht gefunden' }, { status: 404 });
  }
}

// Neue Methode zum Löschen einer Ausgabe
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'ID ist erforderlich' }, { status: 400 });
  }

  try {
    await prisma.expense.delete({
      where: { id: Number(id) },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Ausgabe nicht gefunden' }, { status: 404 });
  }
}
