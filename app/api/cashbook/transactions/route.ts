/**
 * API Route: /api/cashbook/transactions
 * CRUD operations for CashTransaction (Kassenbuch-Buchungen)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getUserId } from '@/lib/get-user-id';
import { auditCreate, auditUpdate, auditDelete } from '@/lib/audit-log';

// Helper: Recalculate running balances for all transactions after a given date
async function recalculateRunningBalances(cashBookId: number, afterDate?: Date) {
    const cashBook = await prisma.cashBook.findUnique({
        where: { id: cashBookId }
    });

    if (!cashBook) return;

    // Get all transactions in chronological order
    const transactions = await prisma.cashTransaction.findMany({
        where: { cashBookId },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }]
    });

    let runningBalance = cashBook.initialBalance;

    for (const tx of transactions) {
        if (tx.type === 'EINNAHME') {
            runningBalance += tx.amount;
        } else {
            runningBalance -= tx.amount;
        }

        // Only update if balance changed
        if (tx.runningBalance !== runningBalance) {
            await prisma.cashTransaction.update({
                where: { id: tx.id },
                data: { runningBalance }
            });
        }
    }
}

// GET: Transaktionen abrufen (mit Pagination und Filterung)
export async function GET(request: NextRequest) {
    try {
        const userId = await getUserId();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const cashBookId = searchParams.get('cashBookId');
        const page = parseInt(searchParams.get('page') || '1');
        const pageSize = parseInt(searchParams.get('pageSize') || '50');
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
        const where: any = {
            cashBookId: parseInt(cashBookId),
            userId
        };

        if (startDate) {
            where.date = { ...where.date, gte: new Date(startDate) };
        }
        if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            where.date = { ...where.date, lte: end };
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
                orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
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

// POST: Neue Transaktion erstellen
export async function POST(request: NextRequest) {
    try {
        const userId = await getUserId();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const {
            cashBookId,
            date,
            type,
            description,
            amount,
            category,
            receiptNumber,
            taxRelevant = true,
            notes,
            expenseId,
            incomeId
        } = body;

        // Validation
        if (!cashBookId) {
            return NextResponse.json({ error: 'cashBookId ist erforderlich' }, { status: 400 });
        }
        if (!type || (type !== 'EINNAHME' && type !== 'AUSGABE')) {
            return NextResponse.json({ error: 'Typ muss EINNAHME oder AUSGABE sein' }, { status: 400 });
        }
        if (!description || description.trim().length === 0) {
            return NextResponse.json({ error: 'Beschreibung ist erforderlich' }, { status: 400 });
        }
        if (!amount || parseFloat(String(amount)) <= 0) {
            return NextResponse.json({ error: 'Betrag muss größer als 0 sein' }, { status: 400 });
        }

        // Verify cash book ownership
        const cashBook = await prisma.cashBook.findFirst({
            where: { id: parseInt(String(cashBookId)), userId }
        });

        if (!cashBook) {
            return NextResponse.json({ error: 'Kassenbuch nicht gefunden' }, { status: 404 });
        }

        // Get current balance (from last transaction or initial balance)
        const lastTransaction = await prisma.cashTransaction.findFirst({
            where: {
                cashBookId: parseInt(String(cashBookId)),
                date: { lte: date ? new Date(date) : new Date() }
            },
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }]
        });

        const currentBalance = lastTransaction?.runningBalance ?? cashBook.initialBalance;
        const transactionAmount = parseFloat(String(amount));

        // Calculate new running balance
        let newRunningBalance: number;
        if (type === 'EINNAHME') {
            newRunningBalance = currentBalance + transactionAmount;
        } else {
            newRunningBalance = currentBalance - transactionAmount;

            // Warning: Negative balance check (optional)
            if (newRunningBalance < 0) {
                // We allow negative balance but could warn the user
            }
        }

        const transaction = await prisma.cashTransaction.create({
            data: {
                date: date ? new Date(date) : new Date(),
                type,
                description: description.trim(),
                amount: transactionAmount,
                runningBalance: newRunningBalance,
                category: category?.trim() || null,
                receiptNumber: receiptNumber?.trim() || null,
                taxRelevant,
                notes: notes?.trim() || null,
                cashBookId: parseInt(String(cashBookId)),
                userId,
                expenseId: expenseId ? parseInt(String(expenseId)) : null,
                incomeId: incomeId ? parseInt(String(incomeId)) : null
            }
        });

        // Recalculate running balances for transactions after this one
        await recalculateRunningBalances(parseInt(String(cashBookId)));

        await auditCreate(userId, 'CashTransaction' as any, transaction, description);

        // Fetch the updated transaction
        const updatedTransaction = await prisma.cashTransaction.findUnique({
            where: { id: transaction.id }
        });

        return NextResponse.json(updatedTransaction, { status: 201 });
    } catch (error) {
        console.error('Error creating cash transaction:', error);
        return NextResponse.json(
            { error: 'Fehler beim Erstellen der Buchung' },
            { status: 500 }
        );
    }
}

// PUT: Transaktion aktualisieren
export async function PUT(request: NextRequest) {
    try {
        const userId = await getUserId();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { id, date, type, description, amount, category, receiptNumber, taxRelevant, notes } = body;

        if (!id) {
            return NextResponse.json({ error: 'ID ist erforderlich' }, { status: 400 });
        }

        // Check ownership
        const existing = await prisma.cashTransaction.findFirst({
            where: { id: parseInt(String(id)), userId }
        });

        if (!existing) {
            return NextResponse.json({ error: 'Buchung nicht gefunden' }, { status: 404 });
        }

        const updateData: any = {};
        if (date !== undefined) updateData.date = new Date(date);
        if (type !== undefined) updateData.type = type;
        if (description !== undefined) updateData.description = description.trim();
        if (amount !== undefined) updateData.amount = parseFloat(String(amount));
        if (category !== undefined) updateData.category = category?.trim() || null;
        if (receiptNumber !== undefined) updateData.receiptNumber = receiptNumber?.trim() || null;
        if (taxRelevant !== undefined) updateData.taxRelevant = taxRelevant;
        if (notes !== undefined) updateData.notes = notes?.trim() || null;

        await prisma.cashTransaction.update({
            where: { id: parseInt(String(id)) },
            data: updateData
        });

        // Recalculate running balances
        await recalculateRunningBalances(existing.cashBookId);

        const updated = await prisma.cashTransaction.findUnique({
            where: { id: parseInt(String(id)) }
        });

        if (updated) {
            await auditUpdate(userId, 'CashTransaction' as any, id, existing, updated, description);
        }

        return NextResponse.json(updated);
    } catch (error) {
        console.error('Error updating cash transaction:', error);
        return NextResponse.json(
            { error: 'Fehler beim Aktualisieren der Buchung' },
            { status: 500 }
        );
    }
}

// DELETE: Transaktion löschen
export async function DELETE(request: NextRequest) {
    try {
        const userId = await getUserId();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'ID ist erforderlich' }, { status: 400 });
        }

        // Check ownership
        const existing = await prisma.cashTransaction.findFirst({
            where: { id: parseInt(id), userId }
        });

        if (!existing) {
            return NextResponse.json({ error: 'Buchung nicht gefunden' }, { status: 404 });
        }

        const cashBookId = existing.cashBookId;

        await prisma.cashTransaction.delete({
            where: { id: parseInt(id) }
        });

        // Recalculate running balances
        await recalculateRunningBalances(cashBookId);

        await auditDelete(userId, 'CashTransaction' as any, existing, existing.description);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting cash transaction:', error);
        return NextResponse.json(
            { error: 'Fehler beim Löschen der Buchung' },
            { status: 500 }
        );
    }
}
