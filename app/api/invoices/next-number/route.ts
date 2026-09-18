import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { previewDocumentNumber } from '@/lib/invoice-numbers';

export async function GET() {
  try {
    const userId = await requireUserId();
    const next = await previewDocumentNumber(prisma, userId, 'INVOICE');
    return NextResponse.json({ nextInvoiceNumber: next.number });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    console.error('Document number preview failed:', error);
    return NextResponse.json({ error: 'Nummer konnte nicht ermittelt werden' }, { status: 500 });
  }
}
