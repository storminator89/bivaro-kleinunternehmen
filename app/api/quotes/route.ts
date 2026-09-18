import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { auditCreate, auditDelete, createAuditLog } from '@/lib/audit-log';
import { deleteTenantFile, writeTenantFile } from '@/lib/upload-path';
import {
  isFiniteNumber,
  readRequestBodyWithinLimit,
  RequestBodyLimitError,
  MAX_INVOICE_UPLOAD_BYTES,
  MAX_JSON_REQUEST_BYTES,
} from '@/lib/resource-limits';

export async function GET(request: Request) {
    try {
        const userId = await requireUserId();
        const url = new URL(request.url);
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
        const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20')));
        const skip = (page - 1) * pageSize;
        const search = url.searchParams.get('search') || '';
        const statusFilter = url.searchParams.get('status') || '';

        const where: Prisma.InvoiceWhereInput = { userId, type: 'QUOTE' };

        if (statusFilter && statusFilter !== 'all') {
            where.status = statusFilter;
        }

        if (search) {
            where.AND = [
                {
                    OR: [
                        { fileName: { contains: search } },
                        { invoiceNumber: { contains: search } },
                    ],
                },
            ];
        }

        const [items, total] = await Promise.all([
            prisma.invoice.findMany({
                where,
                orderBy: { uploadedAt: 'desc' },
                include: { customer: true },
                skip,
                take: pageSize,
            }),
            prisma.invoice.count({ where }),
        ]);

        return NextResponse.json({ items, total, page, pageSize });
    } catch (error) {
        if (error instanceof UnauthorizedError) return unauthorizedResponse();
        throw error;
    }
}

export async function POST(request: Request) {
    try {
        const userId = await requireUserId();
        const body = await readRequestBodyWithinLimit(request, MAX_JSON_REQUEST_BYTES);
        let input: Record<string, unknown>;
        try {
            input = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
        } catch {
            return NextResponse.json({ error: 'Ungültiges JSON' }, { status: 400 });
        }
        const {
            fileName,
            quoteNumber,
            quoteDate,
            validUntil,
            totalAmount,
            customerId,
            parsedData,
            pdfBytes,
        } = input;

        if (typeof fileName !== 'string' || fileName.trim().length === 0 || fileName.length > 255 || !parsedData || typeof parsedData !== 'object') {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const parsedCustomerId = customerId === undefined || customerId === null || customerId === ''
            ? null
            : Number(customerId);
        if (parsedCustomerId !== null && (!Number.isInteger(parsedCustomerId) || parsedCustomerId <= 0)) {
            return NextResponse.json({ error: 'Ungültiger Kunde' }, { status: 400 });
        }

        if (parsedCustomerId !== null) {
            const customer = await prisma.customer.findFirst({ where: { id: parsedCustomerId, userId } });
            if (!customer) return NextResponse.json({ error: 'Kunde nicht gefunden' }, { status: 404 });
        }

        if (
            typeof pdfBytes !== 'string'
            || pdfBytes.length === 0
            || !/^[A-Za-z0-9+/]*={0,2}$/u.test(pdfBytes)
            || pdfBytes.length % 4 === 1
        ) {
            return NextResponse.json({ error: 'Eine echte PDF-Datei ist erforderlich' }, { status: 400 });
        }
        if (Math.ceil((pdfBytes.length * 3) / 4) > MAX_INVOICE_UPLOAD_BYTES) {
            return NextResponse.json({ error: 'PDF ist zu groß' }, { status: 413 });
        }
        const pdfBuffer = Buffer.from(pdfBytes, 'base64');
        if (pdfBuffer.byteLength === 0) {
            return NextResponse.json({ error: 'Eine echte PDF-Datei ist erforderlich' }, { status: 400 });
        }
        if (pdfBuffer.byteLength > MAX_INVOICE_UPLOAD_BYTES) {
            return NextResponse.json({ error: 'PDF ist zu groß' }, { status: 413 });
        }

        const amount = totalAmount === undefined || totalAmount === null || totalAmount === ''
            ? null
            : Number(totalAmount);
        if (amount !== null && !isFiniteNumber(amount)) {
            return NextResponse.json({ error: 'Ungültiger Betrag' }, { status: 400 });
        }

        const quoteDateValue = quoteDate ? new Date(String(quoteDate)) : new Date();
        const validUntilValue = validUntil ? new Date(String(validUntil)) : null;
        if (Number.isNaN(quoteDateValue.getTime()) || (validUntilValue && Number.isNaN(validUntilValue.getTime()))) {
            return NextResponse.json({ error: 'Ungültiges Datum' }, { status: 400 });
        }

        // The stored name is always generated by the server. The original name
        // remains metadata and can never influence a filesystem path.
        const normalizedQuoteNumber = quoteNumber === undefined || quoteNumber === null || quoteNumber === ''
            ? null
            : String(quoteNumber).trim();
        let storedFileName: string | null = null;
        try {
            storedFileName = await writeTenantFile(userId, fileName, pdfBuffer);

            const quote = await prisma.invoice.create({
                data: {
                    type: 'QUOTE',
                    fileName,
                    storedFileName,
                    invoiceNumber: normalizedQuoteNumber,
                    invoiceDate: quoteDateValue,
                    validUntil: validUntilValue,
                    totalAmount: amount,
                    customerId: parsedCustomerId,
                    parsedData,
                    status: 'DRAFT',
                    userId,
                },
            });

            await auditCreate(userId, 'Quote', quote, quote.invoiceNumber || quote.fileName);

            return NextResponse.json(quote);
        } catch (error) {
            if (storedFileName) {
                try { await deleteTenantFile(userId, storedFileName); } catch { /* best-effort orphan cleanup */ }
            }
            if ((error as { code?: string }).code === 'P2002') {
                return NextResponse.json({ error: 'Die Angebotsnummer ist bereits vergeben.' }, { status: 409 });
            }
            throw error;
        }
    } catch (error) {
        if (error instanceof UnauthorizedError) return unauthorizedResponse();
        if (error instanceof RequestBodyLimitError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error('Error creating quote:', error);
        return NextResponse.json({ error: 'Failed to create quote' }, { status: 500 });
    }
}

export async function PUT(request: Request) {
    try {
        const userId = await requireUserId();
        const { id, status } = await request.json();

        if (!id || !status) {
            return NextResponse.json({ error: 'ID und Status sind erforderlich' }, { status: 400 });
        }

        const allowedStatuses = new Set(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED']);
        if (typeof status !== 'string' || !allowedStatuses.has(status)) {
            return NextResponse.json({ error: 'Ungültiger Angebotsstatus' }, { status: 400 });
        }

        const oldQuote = await prisma.invoice.findFirst({
            where: { id: Number(id), userId, type: 'QUOTE' },
        });

        if (!oldQuote) {
            return NextResponse.json({ error: 'Angebot nicht gefunden' }, { status: 404 });
        }

        const updatedQuote = await prisma.invoice.update({
            where: { id: Number(id), userId },
            data: { status },
        });

        await createAuditLog({
            userId,
            action: 'STATUS_CHANGED',
            entityType: 'Quote',
            entityId: id,
            entityName: updatedQuote.invoiceNumber || updatedQuote.fileName,
            oldValues: { status: oldQuote.status },
            newValues: { status: updatedQuote.status },
        });

        return NextResponse.json(updatedQuote);
    } catch (error) {
        if (error instanceof UnauthorizedError) return unauthorizedResponse();
        return NextResponse.json({ error: 'Angebot nicht gefunden' }, { status: 404 });
    }
}

export async function DELETE(request: Request) {
    try {
        const userId = await requireUserId();
        const url = new URL(request.url);
        const id = url.searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'ID ist erforderlich' }, { status: 400 });
        }

        const quote = await prisma.invoice.findUnique({
            where: { id: Number(id), userId },
        });

        if (!quote || quote.type !== 'QUOTE') {
            return NextResponse.json({ error: 'Angebot nicht gefunden' }, { status: 404 });
        }

        await prisma.invoice.delete({ where: { id: Number(id), userId } });
        // Remove the private file only after the database mutation succeeds;
        // a failed FK/transaction must never leave the record without its PDF.
        if (quote.storedFileName) {
            try { await deleteTenantFile(userId, quote.storedFileName); } catch { /* orphan cleanup is best effort */ }
        }
        await auditDelete(userId, 'Quote', quote, quote.invoiceNumber || quote.fileName);

        return NextResponse.json({ success: true });
    } catch (error) {
        if (error instanceof UnauthorizedError) return unauthorizedResponse();
        return NextResponse.json({ error: 'Angebot nicht gefunden' }, { status: 404 });
    }
}
