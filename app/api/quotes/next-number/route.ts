import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';

const prisma = new PrismaClient();

export async function GET() {
    try {
        const userId = await requireUserId();
        const currentYear = new Date().getFullYear();
        const prefix = `AN-${currentYear}-`;

        const latestQuote = await prisma.invoice.findFirst({
            where: {
                userId,
                type: 'QUOTE',
                invoiceNumber: {
                    startsWith: prefix,
                },
            },
            orderBy: {
                invoiceNumber: 'desc',
            },
        });

        let nextNumber = 1;

        if (latestQuote && latestQuote.invoiceNumber) {
            const parts = latestQuote.invoiceNumber.split('-');
            if (parts.length === 3) {
                const numberPart = parseInt(parts[2], 10);
                if (!isNaN(numberPart)) {
                    nextNumber = numberPart + 1;
                }
            }
        }

        const formattedNumber = `AN-${currentYear}-${nextNumber.toString().padStart(2, '0')}`;

        return NextResponse.json({ nextQuoteNumber: formattedNumber });
    } catch (error) {
        if (error instanceof UnauthorizedError) return unauthorizedResponse();
        console.error('Error generating next quote number:', error);
        return NextResponse.json({ error: 'Failed to generate quote number' }, { status: 500 });
    }
}
