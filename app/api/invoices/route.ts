import { NextResponse } from 'next/server';
import { PrismaClient, Prisma } from '@prisma/client';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { auditCreate, auditDelete, createAuditLog } from '@/lib/audit-log';

const prisma = new PrismaClient();

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const { fileName, invoiceNumber, invoiceDate, dueDate, totalAmount, parsedData } = await request.json();

    if (!fileName || !parsedData) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const invoice = await prisma.invoice.create({
      data: {
        fileName,
        storedFileName: fileName,
        invoiceNumber: invoiceNumber || null,
        invoiceDate: invoiceDate ? new Date(invoiceDate) : null,
        dueDate: dueDate ? new Date(dueDate) : null,
        totalAmount: totalAmount ? parseFloat(totalAmount.toString()) : null,
        parsedData,
        userId,
      },
    });

    // Audit log
    await auditCreate(userId, 'Invoice', invoice, invoice.invoiceNumber || invoice.fileName);

    return NextResponse.json(invoice);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    throw error;
  }
}

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20')));
    const skip = (page - 1) * pageSize;

    // Filters
    const search = url.searchParams.get('search') || '';
    const paidStatus = url.searchParams.get('paidStatus'); // 'paid' | 'unpaid' | null
    const dateRange = url.searchParams.get('dateRange') as 'all' | 'thisMonth' | 'lastMonth' | 'thisYear' | null;

    const where: Prisma.InvoiceWhereInput = { userId, type: { not: 'QUOTE' } };

    if (paidStatus === 'paid') where.status = 'PAID';
    if (paidStatus === 'unpaid') where.status = { not: 'PAID' };

    if (dateRange && dateRange !== 'all') {
      const now = new Date();
      const thisMonth = now.getMonth();
      const thisYear = now.getFullYear();
      let start: Date | undefined;
      let end: Date | undefined;
      if (dateRange === 'thisMonth') {
        start = new Date(thisYear, thisMonth, 1);
        end = new Date(thisYear, thisMonth + 1, 0, 23, 59, 59, 999);
      } else if (dateRange === 'lastMonth') {
        const prevMonth = thisMonth === 0 ? 11 : thisMonth - 1;
        const prevYear = thisMonth === 0 ? thisYear - 1 : thisYear;
        start = new Date(prevYear, prevMonth, 1);
        end = new Date(prevYear, prevMonth + 1, 0, 23, 59, 59, 999);
      } else if (dateRange === 'thisYear') {
        start = new Date(thisYear, 0, 1);
        end = new Date(thisYear, 11, 31, 23, 59, 59, 999);
      }
      if (start && end) {
        where.OR = [
          { invoiceDate: { gte: start, lte: end } },
          { AND: [{ invoiceDate: null }, { uploadedAt: { gte: start, lte: end } }] },
        ];
      }
    }

    if (search) {
      const existingAnd = Array.isArray(where.AND) ? where.AND : (where.AND ? [where.AND] : []);
      where.AND = [
        ...existingAnd,
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
        include: { income: true },
        skip,
        take: pageSize,
      }),
      prisma.invoice.count({ where }),
    ]);

    return NextResponse.json({ items, total, page, pageSize });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    throw error;
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

    const invoice = await prisma.invoice.findUnique({
      where: { id: Number(id), userId },
      include: { income: true },
    });

    if (invoice && invoice.income) {
      await prisma.income.delete({
        where: { id: invoice.income.id },
      });
    }

    await prisma.invoice.delete({
      where: { id: Number(id), userId },
    });

    // Audit log
    if (invoice) {
      await auditDelete(userId, 'Invoice', invoice, invoice.invoiceNumber || invoice.fileName);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    return NextResponse.json({ error: 'Rechnung nicht gefunden' }, { status: 404 });
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await requireUserId();
    const { id, status } = await request.json();

    if (!id || !status) {
      return NextResponse.json({ error: 'ID und Status sind erforderlich' }, { status: 400 });
    }

    // Get old values for audit - verify ownership first
    const oldInvoice = await prisma.invoice.findFirst({
      where: { id: Number(id), userId },
    });

    if (!oldInvoice) {
      return NextResponse.json({ error: 'Rechnung nicht gefunden' }, { status: 404 });
    }

    const updatedInvoice = await prisma.invoice.update({
      where: { id: Number(id), userId },
      data: {
        status: status
      },
      include: {
        income: true,
      }
    });

    // Audit log for status change
    if (oldInvoice) {
      await createAuditLog({
        userId,
        action: 'STATUS_CHANGED',
        entityType: 'Invoice',
        entityId: id,
        entityName: updatedInvoice.invoiceNumber || updatedInvoice.fileName,
        oldValues: { status: oldInvoice.status },
        newValues: { status: updatedInvoice.status },
      });
    }

    return NextResponse.json(updatedInvoice);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    return NextResponse.json({ error: 'Rechnung nicht gefunden' }, { status: 404 });
  }
}
