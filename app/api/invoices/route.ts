import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: Request) {
  const { fileName, invoiceNumber, invoiceDate, dueDate, totalAmount, parsedData } = await request.json();

  if (!fileName || !parsedData) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const invoice = await prisma.invoice.create({
    data: {
      fileName,
      invoiceNumber: invoiceNumber || null,
      invoiceDate: invoiceDate ? new Date(invoiceDate) : null,
      dueDate: dueDate ? new Date(dueDate) : null,
      totalAmount: totalAmount ? parseFloat(totalAmount.toString()) : null,
      parsedData,
      paidStatus: false,
    },
  });

  return NextResponse.json(invoice);
}

export async function GET() {
  const invoices = await prisma.invoice.findMany({
    orderBy: {
      uploadedAt: 'desc',
    },
    include: {
      income: true,
    },
  });
  return NextResponse.json(invoices);
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'ID ist erforderlich' }, { status: 400 });
  }

  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: Number(id) },
      include: { income: true },
    });

    if (invoice && invoice.income) {
      await prisma.income.delete({
        where: { id: invoice.income.id },
      });
    }

    await prisma.invoice.delete({
      where: { id: Number(id) },
    });
    
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Rechnung nicht gefunden' }, { status: 404 });
  }
}

// Neue Methode zum Aktualisieren des Zahlungsstatus einer Rechnung
export async function PUT(request: Request) {
  const { id, paidStatus } = await request.json();

  if (!id) {
    return NextResponse.json({ error: 'ID ist erforderlich' }, { status: 400 });
  }

  try {
    const updatedInvoice = await prisma.invoice.update({
      where: { id: Number(id) },
      data: { 
        paidStatus: paidStatus 
      },
      include: {
        income: true,
      }
    });
    
    return NextResponse.json(updatedInvoice);
  } catch (error) {
    return NextResponse.json({ error: 'Rechnung nicht gefunden' }, { status: 404 });
  }
}
