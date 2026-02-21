import { NextResponse } from 'next/server';
import { PrismaClient, Prisma } from '@prisma/client';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { auditCreate, auditDelete, createAuditLog } from '@/lib/audit-log';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

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
        const {
            fileName,
            quoteNumber,
            quoteDate,
            validUntil,
            totalAmount,
            customerId,
            parsedData,
            pdfBytes,
        } = await request.json();

        if (!fileName || !parsedData) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Save PDF file
        const uploadDir = path.join(process.cwd(), 'data', 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const storedFileName = `quote_${Date.now()}_${fileName}`;
        const filePath = path.join(uploadDir, storedFileName);

        if (pdfBytes) {
            const buffer = Buffer.from(pdfBytes, 'base64');
            fs.writeFileSync(filePath, buffer);
        }

        const quote = await prisma.invoice.create({
            data: {
                type: 'QUOTE',
                fileName,
                storedFileName,
                invoiceNumber: quoteNumber || null,
                invoiceDate: quoteDate ? new Date(quoteDate) : new Date(),
                validUntil: validUntil ? new Date(validUntil) : null,
                totalAmount: totalAmount ? parseFloat(totalAmount.toString()) : null,
                customerId: customerId ? parseInt(customerId.toString()) : null,
                parsedData,
                status: 'DRAFT',
                userId,
            },
        });

        await auditCreate(userId, 'Quote', quote, quote.invoiceNumber || quote.fileName);

        return NextResponse.json(quote);
    } catch (error) {
        if (error instanceof UnauthorizedError) return unauthorizedResponse();
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

        // Delete stored PDF file
        if (quote.storedFileName) {
            const filePath = path.join(process.cwd(), 'data', 'uploads', quote.storedFileName);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        await prisma.invoice.delete({ where: { id: Number(id), userId } });
        await auditDelete(userId, 'Quote', quote, quote.invoiceNumber || quote.fileName);

        return NextResponse.json({ success: true });
    } catch (error) {
        if (error instanceof UnauthorizedError) return unauthorizedResponse();
        return NextResponse.json({ error: 'Angebot nicht gefunden' }, { status: 404 });
    }
}
