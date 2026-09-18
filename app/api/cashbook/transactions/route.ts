/**
 * API Route: /api/cashbook/transactions
 * CRUD operations for CashTransaction (Kassenbuch-Buchungen)
 */

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getUserId } from '@/lib/get-user-id';
import { CashbookError, createCashTransaction, updateCashTransaction, deleteCashTransaction } from '@/lib/cashbook-service';

// GET: Transaktionen abrufen (mit Pagination und Filterung)
export async function GET(request: Request) {
    try {
        const userId = await getUserId();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const cashBookId = searchParams.get('cashBookId');
        const page = Math.max(1, Number(searchParams.get('page')) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 50));
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');
        const type = searchParams.get('type');
        const category = searchParams.get('category');
        const search = searchParams.get('search');

        if (!cashBookId) {
            return NextResponse.json(
                { error: 'cashBookId ist erforderlich' },
                { status: 400 }
            );
        }

        // Verify ownership
        const cashBook = await prisma.cashBook.findFirst({
            where: { id: parseInt(cashBookId), userId }
        });

        if (!cashBook) {
            return NextResponse.json(
                { error: 'Kassenbuch nicht gefunden' },
                { status: 404 }
            );
        }

        // Build where clause
        const where: Prisma.CashTransactionWhereInput = {
            cashBookId: parseInt(cashBookId),
            userId
        };

        if (startDate || endDate) {
            const dateFilter: Prisma.DateTimeFilter = {};
            if (startDate) dateFilter.gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                dateFilter.lte = end;
            }
            where.date = dateFilter;
        }
        if (type && (type === 'EINNAHME' || type === 'AUSGABE')) {
            where.type = type;
        }
        if (category) {
            where.category = category;
        }
        if (search) {
            where.OR = [
                { description: { contains: search } },
                { receiptNumber: { contains: search } },
                { notes: { contains: search } }
            ];
        }

        const [transactions, total] = await Promise.all([
            prisma.cashTransaction.findMany({
                where,
                orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
                skip: (page - 1) * pageSize,
                take: pageSize
            }),
            prisma.cashTransaction.count({ where })
        ]);

        return NextResponse.json({
            items: transactions,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize)
        });
    } catch (error) {
        console.error('Error fetching cash transactions:', error);
        return NextResponse.json(
            { error: 'Fehler beim Laden der Buchungen' },
            { status: 500 }
        );
    }
}

async function mutate(request: NextRequest, method: 'POST' | 'PUT' | 'DELETE') {
  try {
    const userId = await getUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (method === 'DELETE') {
      return NextResponse.json(await deleteCashTransaction(userId, Number(new URL(request.url).searchParams.get('id'))));
    }
    const body = await request.json();
    const result = method === 'POST'
      ? await createCashTransaction(userId, body)
      : await updateCashTransaction(userId, Number(body.id), body);
    return NextResponse.json(result, { status: method === 'POST' ? 201 : 200 });
  } catch (error) {
    if (error instanceof CashbookError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Cash transaction failed:', error);
    return NextResponse.json({ error: 'Buchung konnte nicht gespeichert werden' }, { status: 400 });
  }
}

export async function POST(request: NextRequest) { return mutate(request, 'POST'); }
export async function PUT(request: NextRequest) { return mutate(request, 'PUT'); }
export async function DELETE(request: NextRequest) { return mutate(request, 'DELETE'); }
