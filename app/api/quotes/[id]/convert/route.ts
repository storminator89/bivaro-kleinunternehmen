import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { auditCreate, createAuditLog } from '@/lib/audit-log';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const userId = await requireUserId();
        const { id: quoteIdStr } = await params;
        const quoteId = Number(quoteIdStr);

        // Load the quote
        const quote = await prisma.invoice.findUnique({
            where: { id: quoteId, userId },
            include: { customer: true },
        });

        if (!quote || quote.type !== 'QUOTE') {
            return NextResponse.json({ error: 'Angebot nicht gefunden' }, { status: 404 });
        }

        if (quote.status === 'CANCELLED') {
            return NextResponse.json({ error: 'Stornierte Angebote können nicht umgewandelt werden' }, { status: 400 });
        }

        // Generate next invoice number (RE-YYYY-NN)
        const currentYear = new Date().getFullYear();
        const prefix = `${currentYear}-`;
        const latestInvoice = await prisma.invoice.findFirst({
            where: {
                userId,
                type: 'INVOICE',
                invoiceNumber: { startsWith: prefix },
            },
            orderBy: { invoiceNumber: 'desc' },
        });

        let nextInvoiceNum = 1;
        if (latestInvoice?.invoiceNumber) {
            const parts = latestInvoice.invoiceNumber.split('-');
            if (parts.length === 2) {
                const n = parseInt(parts[1], 10);
                if (!isNaN(n)) nextInvoiceNum = n + 1;
            }
        }
        const invoiceNumber = `${currentYear}-${nextInvoiceNum.toString().padStart(2, '0')}`;

        // Derive invoice file name from quote file name
        const invoiceFileName = quote.fileName.replace(/^quote_\d+_/, '').replace(/angebot/i, 'rechnung');
        const invoiceStoredFileName = quote.storedFileName; // Reuse same PDF for now

        // Create the invoice
        const invoice = await prisma.invoice.create({
            data: {
                type: 'INVOICE',
                fileName: invoiceFileName || quote.fileName,
                storedFileName: invoiceStoredFileName,
                invoiceNumber,
                invoiceDate: new Date(),
                dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
                totalAmount: quote.totalAmount,
                customerId: quote.customerId,
                parsedData: (quote.parsedData ?? {}) as import('@prisma/client').Prisma.InputJsonValue,
                status: 'DRAFT',
                userId,
            },
        });

        // Create associated income entry
        const income = await prisma.income.create({
            data: {
                description: `Rechnung ${invoiceNumber}${quote.customer ? ' – ' + quote.customer.name : ''}`,
                amount: quote.totalAmount || 0,
                date: new Date(),
                customerId: quote.customerId,
                invoiceId: invoice.id,
                taxRelevant: true,
                userId,
            },
        });

        // Mark the quote as ACCEPTED
        await prisma.invoice.update({
            where: { id: quoteId, userId },
            data: { status: 'ACCEPTED' },
        });

        // Audit logs
        await auditCreate(userId, 'Invoice', invoice, invoice.invoiceNumber || invoice.fileName);
        await auditCreate(userId, 'Income', income, income.description);
        await createAuditLog({
            userId,
            action: 'CONVERTED',
            entityType: 'Quote',
            entityId: quoteId.toString(),
            entityName: quote.invoiceNumber || quote.fileName,
            metadata: { convertedToInvoiceId: invoice.id, invoiceNumber },
        });

        return NextResponse.json({
            success: true,
            invoiceId: invoice.id,
            invoiceNumber,
            incomeId: income.id,
        });
    } catch (error) {
        if (error instanceof UnauthorizedError) return unauthorizedResponse();
        console.error('Error converting quote to invoice:', error);
        return NextResponse.json({ error: 'Fehler bei der Umwandlung' }, { status: 500 });
    }
}
