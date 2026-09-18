/**
 * API v1 - Cash Book Endpoint
 * 
 * GET    /api/v1/cashbook           - List all cash books and transactions
 * POST   /api/v1/cashbook           - Create cash transaction
 * PUT    /api/v1/cashbook?id=       - Update cash transaction
 * DELETE /api/v1/cashbook?id=       - Delete cash transaction
 */

import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { CashbookError, createCashTransaction, updateCashTransaction, deleteCashTransaction } from '@/lib/cashbook-service';
import {
    withApiAuth,
    apiSuccess,
    apiError,
    handleCors,
    corsHeaders,
} from '@/lib/api-auth';

export async function OPTIONS(request: NextRequest) {
    return handleCors(request);
}

// GET /api/v1/cashbook
export async function GET(request: NextRequest) {
    return withApiAuth(request, async ({ userId }) => {
        const url = new URL(request.url);
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
        const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
        const skip = (page - 1) * pageSize;

        // Filters
        const cashBookId = url.searchParams.get('cashBookId');
        const type = url.searchParams.get('type'); // EINNAHME or AUSGABE
        const startDate = url.searchParams.get('startDate');
        const endDate = url.searchParams.get('endDate');

        // First get all cash books for the user
        const cashBooks = await prisma.cashBook.findMany({
            where: { userId },
            select: {
                id: true,
                name: true,
                description: true,
                initialBalance: true,
                currency: true,
                isActive: true,
            },
        });

        // Build transaction filter
        const transactionWhere: Prisma.CashTransactionWhereInput = { userId };

        if (cashBookId) {
            transactionWhere.cashBookId = parseInt(cashBookId);
        }

        if (type === 'EINNAHME' || type === 'AUSGABE') {
            transactionWhere.type = type;
        }

        if (startDate || endDate) {
            transactionWhere.date = {};
            if (startDate) transactionWhere.date.gte = new Date(startDate);
            if (endDate) transactionWhere.date.lte = new Date(endDate);
        }

        const [transactions, total] = await Promise.all([
            prisma.cashTransaction.findMany({
                where: transactionWhere,
                orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
                skip,
                take: pageSize,
                select: {
                    id: true,
                    date: true,
                    type: true,
                    description: true,
                    amount: true,
                    runningBalance: true,
                    category: true,
                    receiptNumber: true,
                    taxRelevant: true,
                    notes: true,
                    cashBookId: true,
                },
            }),
            prisma.cashTransaction.count({ where: transactionWhere }),
        ]);

        const response = apiSuccess({
            cashBooks,
            transactions,
        }, {
            page,
            pageSize,
            total,
            hasMore: skip + transactions.length < total,
        });

        Object.entries(corsHeaders()).forEach(([key, value]) => {
            response.headers.set(key, value);
        });

        return response;
    }, { requiredScopes: ['read'] });
}

async function mutate(request: NextRequest, method: 'POST' | 'PUT' | 'DELETE') {
  return withApiAuth(request, async ({ userId }) => {
    try {
      const id = Number(new URL(request.url).searchParams.get('id'));
      if (method === 'DELETE') return apiSuccess(await deleteCashTransaction(userId, id));
      const body = await request.json();
      if (method === 'PUT' && ['amount', 'date', 'type', 'cashBookId', 'incomeId', 'expenseId'].some(key => key in body)) {
        return apiError('Only non-financial fields can be updated through this endpoint', 400);
      }
      const entry = method === 'POST' ? await createCashTransaction(userId, body) : await updateCashTransaction(userId, id, body);
      const response = apiSuccess(entry);
      return new Response(response.body, { status: method === 'POST' ? 201 : 200, headers: response.headers });
    } catch (error) {
      if (error instanceof CashbookError) return apiError(error.message, error.status);
      throw error;
    }
  }, { requiredScopes: [method === 'DELETE' ? 'delete' : 'write'] });
}
export async function POST(request: NextRequest) { return mutate(request, 'POST'); }
export async function PUT(request: NextRequest) { return mutate(request, 'PUT'); }
export async function DELETE(request: NextRequest) { return mutate(request, 'DELETE'); }
