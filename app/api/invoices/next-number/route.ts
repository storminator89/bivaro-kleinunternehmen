import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const userId = await requireUserId();
    const currentYear = new Date().getFullYear();
    const prefix = `${currentYear}-`;

    // Find the latest invoice for the current year
    const latestInvoice = await prisma.invoice.findFirst({
      where: {
        userId,
        invoiceNumber: {
          startsWith: prefix
        }
      },
      orderBy: {
        invoiceNumber: 'desc'
      }
    });

    let nextNumber = 1;

    if (latestInvoice && latestInvoice.invoiceNumber) {
      const parts = latestInvoice.invoiceNumber.split('-');
      if (parts.length === 2) {
        const numberPart = parseInt(parts[1], 10);
        if (!isNaN(numberPart)) {
          nextNumber = numberPart + 1;
        }
      }
    }

    // Format as YYYY-NN (2 digits)
    const formattedNumber = `${currentYear}-${nextNumber.toString().padStart(2, '0')}`;

    return NextResponse.json({ nextInvoiceNumber: formattedNumber });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Error generating next invoice number:', error);
    return NextResponse.json({ error: 'Failed to generate invoice number' }, { status: 500 });
  }
}
