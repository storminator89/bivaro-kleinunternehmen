import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const number = searchParams.get('number');

  if (!number) {
    return NextResponse.json({ error: 'Invoice number is required' }, { status: 400 });
  }

  try {
    const invoice = await prisma.invoice.findUnique({
      where: {
        invoiceNumber: number,
      },
      select: {
        id: true,
      },
    });

    return NextResponse.json({ exists: !!invoice });
  } catch (error) {
    console.error('Error checking invoice number:', error);
    return NextResponse.json({ error: 'Failed to check invoice number' }, { status: 500 });
  }
}
