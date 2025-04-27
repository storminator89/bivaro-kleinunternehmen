import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: Request) {
  const { description, amount, customer, taxRelevant } = await request.json();

  if (!description || !amount) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const income = await prisma.income.create({
    data: {
      description,
      amount: parseFloat(amount.toString()),
      customer: customer || null,
      taxRelevant: taxRelevant !== undefined ? taxRelevant : true,
    },
  });

  return NextResponse.json(income);
}

export async function GET() {
  const incomes = await prisma.income.findMany({
    orderBy: {
      date: 'desc',
    },
    include: {
      invoice: true, // Verknüpfte Rechnung einschließen
    },
  });

  // Transformiere die Daten, um invoicePaidStatus hinzuzufügen
  const incomesWithInvoiceStatus = incomes.map(income => ({
    ...income,
    invoicePaidStatus: income.invoice ? income.invoice.paidStatus : undefined,
    invoice: undefined, // Entferne das vollständige Invoice-Objekt, um die Antwort schlank zu halten
  }));

  return NextResponse.json(incomesWithInvoiceStatus);
}

// Neue Methode zum Aktualisieren einer Einnahme
export async function PUT(request: Request) {
  const { id, description, amount, customer, taxRelevant } = await request.json();

  if (!id || !description || !amount) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  try {
    const updatedIncome = await prisma.income.update({
      where: { id: Number(id) },
      data: {
        description,
        amount: parseFloat(amount.toString()),
        customer: customer || null,
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