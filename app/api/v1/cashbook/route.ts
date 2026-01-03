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
import {
    withApiAuth,
    apiSuccess,
    apiError,
    handleCors,
    corsHeaders,
} from '@/lib/api-auth';

export async function OPTIONS() {
    return handleCors();
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
                orderBy: { date: 'desc' },
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

// POST /api/v1/cashbook
export async function POST(request: NextRequest) {
    return withApiAuth(request, async ({ userId }) => {
        let body;
        try {
            body = await request.json();
        } catch {
            return apiError('Invalid JSON body', 400, 'INVALID_JSON');
        }

        const {
            cashBookId,
            type,
            description,
            amount,
            date,
            category,
            receiptNumber,
            taxRelevant,
            notes,
        } = body;

        // Validation
        if (!cashBookId) {
            return apiError('Cash book ID is required', 400, 'VALIDATION_ERROR');
        }

        if (!type || !['EINNAHME', 'AUSGABE'].includes(type)) {
            return apiError('Type must be EINNAHME or AUSGABE', 400, 'VALIDATION_ERROR');
        }

        if (!description || typeof description !== 'string' || description.trim().length === 0) {
            return apiError('Description is required', 400, 'VALIDATION_ERROR');
        }

        if (amount === undefined || amount === null || isNaN(parseFloat(amount))) {
            return apiError('Valid amount is required', 400, 'VALIDATION_ERROR');
        }

        if (parseFloat(amount) <= 0) {
            return apiError('Amount must be positive', 400, 'VALIDATION_ERROR');
        }

        // Verify cash book belongs to user
        const cashBook = await prisma.cashBook.findFirst({
            where: { id: parseInt(cashBookId), userId },
        });

        if (!cashBook) {
            return apiError('Cash book not found', 404, 'NOT_FOUND');
        }

        // Calculate running balance
        const lastTransaction = await prisma.cashTransaction.findFirst({
            where: { cashBookId: parseInt(cashBookId) },
            orderBy: { date: 'desc' },
        });

        const previousBalance = lastTransaction?.runningBalance ?? cashBook.initialBalance;
        const transactionAmount = parseFloat(amount);
        const newBalance = type === 'EINNAHME'
            ? previousBalance + transactionAmount
            : previousBalance - transactionAmount;

        const transaction = await prisma.cashTransaction.create({
            data: {
                cashBookId: parseInt(cashBookId),
                type,
                description: description.trim(),
                amount: transactionAmount,
                runningBalance: newBalance,
                date: date ? new Date(date) : new Date(),
                category: category?.trim() || null,
                receiptNumber: receiptNumber?.trim() || null,
                taxRelevant: taxRelevant !== undefined ? Boolean(taxRelevant) : true,
                notes: notes?.trim() || null,
                userId,
            },
        });

        const response = apiSuccess(transaction);
        response.headers.set('Location', `/api/v1/cashbook/${transaction.id}`);
        Object.entries(corsHeaders()).forEach(([key, value]) => {
            response.headers.set(key, value);
        });

        return new Response(response.body, {
            status: 201,
            headers: response.headers,
        });
    }, { requiredScopes: ['write'] });
}

// PUT /api/v1/cashbook?id=<id>
export async function PUT(request: NextRequest) {
    return withApiAuth(request, async ({ userId }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get('id');

        if (!id) {
            return apiError('Transaction ID is required', 400, 'MISSING_ID');
        }

        let body;
        try {
            body = await request.json();
        } catch {
            return apiError('Invalid JSON body', 400, 'INVALID_JSON');
        }

        const {
            description,
            category,
            receiptNumber,
            taxRelevant,
            notes,
        } = body;

        // Check if transaction exists and belongs to user
        const existing = await prisma.cashTransaction.findFirst({
            where: { id: parseInt(id), userId },
        });

        if (!existing) {
            return apiError('Transaction not found', 404, 'NOT_FOUND');
        }

        // Only allow updating non-financial fields (for GoBD compliance)
        const transaction = await prisma.cashTransaction.update({
            where: { id: parseInt(id) },
            data: {
                ...(description !== undefined && { description: description.trim() }),
                ...(category !== undefined && { category: category?.trim() || null }),
                ...(receiptNumber !== undefined && { receiptNumber: receiptNumber?.trim() || null }),
                ...(taxRelevant !== undefined && { taxRelevant: Boolean(taxRelevant) }),
                ...(notes !== undefined && { notes: notes?.trim() || null }),
            },
        });

        const response = apiSuccess(transaction);
        Object.entries(corsHeaders()).forEach(([key, value]) => {
            response.headers.set(key, value);
        });
        return response;
    }, { requiredScopes: ['write'] });
}

// DELETE /api/v1/cashbook?id=<id>
export async function DELETE(request: NextRequest) {
    return withApiAuth(request, async ({ userId }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get('id');

        if (!id) {
            return apiError('Transaction ID is required', 400, 'MISSING_ID');
        }

        // Check if transaction exists and belongs to user
        const existing = await prisma.cashTransaction.findFirst({
            where: { id: parseInt(id), userId },
        });

        if (!existing) {
            return apiError('Transaction not found', 404, 'NOT_FOUND');
        }

        await prisma.cashTransaction.delete({
            where: { id: parseInt(id) },
        });

        const response = apiSuccess({ deleted: true, id: parseInt(id) });
        Object.entries(corsHeaders()).forEach(([key, value]) => {
            response.headers.set(key, value);
        });
        return response;
    }, { requiredScopes: ['delete'] });
}
