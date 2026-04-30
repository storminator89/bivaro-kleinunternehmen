import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const searchParams = request.nextUrl.searchParams;
    const number = searchParams.get('number');

    if (!number) {
      return NextResponse.json({ error: 'Invoice number is required' }, { status: 400 });
    }

    const invoice = await prisma.invoice.findFirst({
      where: {
        invoiceNumber: number,
        userId,
      },
      select: {
        id: true,
      },
    });

    return NextResponse.json({ exists: !!invoice });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Error checking invoice number:', error);
    return NextResponse.json({ error: 'Failed to check invoice number' }, { status: 500 });
  }
}
