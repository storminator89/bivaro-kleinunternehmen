/**
 * API Route: /api/cashbook/daily-balance
 * Daily balance reporting and cash count (Kassensturz)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getUserId } from '@/lib/get-user-id';
import { startOfDay, endOfDay, format } from 'date-fns';

// GET: Tagesübersicht / Aktueller Kassenbestand
export async function GET(request: NextRequest) {
    try {
        const userId = await getUserId();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const cashBookId = searchParams.get('cashBookId');
        const dateParam = searchParams.get('date');

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

        const targetDate = dateParam ? new Date(dateParam) : new Date();
        const dayStart = startOfDay(targetDate);
        const dayEnd = endOfDay(targetDate);

        // Get last transaction before this day (for opening balance)
        const lastTransactionBeforeDay = await prisma.cashTransaction.findFirst({
            where: {
                cashBookId: parseInt(cashBookId),
                date: { lt: dayStart }
            },
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }]
        });

        const openingBalance = lastTransactionBeforeDay?.runningBalance ?? cashBook.initialBalance;

        // Get transactions for the day
        const todayTransactions = await prisma.cashTransaction.findMany({
            where: {
                cashBookId: parseInt(cashBookId),
                date: {
                    gte: dayStart,
                    lte: dayEnd
                }
            },
            orderBy: [{ date: 'asc' }, { createdAt: 'asc' }]
        });

        // Calculate totals
        let totalIncome = 0;
        let totalExpense = 0;

        for (const tx of todayTransactions) {
            if (tx.type === 'EINNAHME') {
                totalIncome += tx.amount;
            } else {
                totalExpense += tx.amount;
            }
        }

        const closingBalance = openingBalance + totalIncome - totalExpense;

        // Get current balance (latest transaction overall)
        const latestTransaction = await prisma.cashTransaction.findFirst({
            where: { cashBookId: parseInt(cashBookId) },
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }]
        });

        const currentSystemBalance = latestTransaction?.runningBalance ?? cashBook.initialBalance;

        return NextResponse.json({
            cashBook: {
                id: cashBook.id,
                name: cashBook.name,
                initialBalance: cashBook.initialBalance,
                currency: cashBook.currency
            },
            date: format(targetDate, 'yyyy-MM-dd'),
            openingBalance,
            totalIncome,
            totalExpense,
            closingBalance,
            transactionCount: todayTransactions.length,
            transactions: todayTransactions,
            currentSystemBalance,
            lastTransaction: latestTransaction || null
        });
    } catch (error) {
        console.error('Error fetching daily balance:', error);
        return NextResponse.json(
            { error: 'Fehler beim Laden der Tagesübersicht' },
            { status: 500 }
        );
    }
}

// POST: Kassensturz durchführen (Zählprotokoll)
export async function POST(request: NextRequest) {
    try {
        const userId = await getUserId();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { cashBookId, countedAmount, notes } = body;

        if (!cashBookId) {
            return NextResponse.json(
                { error: 'cashBookId ist erforderlich' },
                { status: 400 }
            );
        }

        if (countedAmount === undefined || countedAmount === null) {
            return NextResponse.json(
                { error: 'Gezählter Betrag ist erforderlich' },
                { status: 400 }
            );
        }

        // Verify ownership
        const cashBook = await prisma.cashBook.findFirst({
            where: { id: parseInt(String(cashBookId)), userId }
        });

        if (!cashBook) {
            return NextResponse.json(
                { error: 'Kassenbuch nicht gefunden' },
                { status: 404 }
            );
        }

        // Get current system balance
        const latestTransaction = await prisma.cashTransaction.findFirst({
            where: { cashBookId: parseInt(String(cashBookId)) },
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }]
        });

        const systemBalance = latestTransaction?.runningBalance ?? cashBook.initialBalance;
        const counted = parseFloat(String(countedAmount));
        const difference = counted - systemBalance;

        // If there's a difference, we can optionally create an adjustment transaction
        let adjustmentTransaction = null;

        if (Math.abs(difference) > 0.01) {
            // Create a correction transaction if there's a notable difference
            // This is optional - user should investigate the difference
            adjustmentTransaction = {
                type: difference > 0 ? 'EINNAHME' : 'AUSGABE',
                amount: Math.abs(difference),
                suggestedDescription: difference > 0
                    ? 'Kassenüberschuss (Kassensturz)'
                    : 'Kassendifferenz (Kassensturz)',
                requiresAction: true
            };
        }

        const result = {
            date: new Date().toISOString(),
            cashBookId: parseInt(String(cashBookId)),
            cashBookName: cashBook.name,
            countedAmount: counted,
            systemBalance,
            difference,
            status: Math.abs(difference) < 0.01 ? 'OK' : (difference > 0 ? 'ÜBERSCHUSS' : 'FEHLBETRAG'),
            notes: notes || null,
            adjustmentTransaction
        };

        return NextResponse.json(result);
    } catch (error) {
        console.error('Error performing cash count:', error);
        return NextResponse.json(
            { error: 'Fehler beim Kassensturz' },
            { status: 500 }
        );
    }
}
