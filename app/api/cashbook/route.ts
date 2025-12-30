/**
 * API Route: /api/cashbook
 * CRUD operations for CashBook (Kassenbuch)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getUserId } from '@/lib/get-user-id';
import { auditCreate, auditUpdate, auditDelete } from '@/lib/audit-log';

// GET: Liste aller Kassenbücher des Benutzers
export async function GET(request: NextRequest) {
    try {
        const userId = await getUserId();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const cashBooks = await prisma.cashBook.findMany({
            where: { userId },
            include: {
                _count: {
                    select: { transactions: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Calculate current balance for each cash book
        const cashBooksWithBalance = await Promise.all(
            cashBooks.map(async (cashBook) => {
                const lastTransaction = await prisma.cashTransaction.findFirst({
                    where: { cashBookId: cashBook.id },
                    orderBy: { date: 'desc' }
                });

                return {
                    ...cashBook,
                    currentBalance: lastTransaction?.runningBalance ?? cashBook.initialBalance,
                    transactionCount: cashBook._count.transactions
                };
            })
        );

        return NextResponse.json(cashBooksWithBalance);
    } catch (error) {
        console.error('Error fetching cash books:', error);
        return NextResponse.json(
            { error: 'Fehler beim Laden der Kassenbücher' },
            { status: 500 }
        );
    }
}

// POST: Neues Kassenbuch erstellen
export async function POST(request: NextRequest) {
    try {
        const userId = await getUserId();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { name, description, initialBalance = 0, currency = 'EUR' } = body;

        if (!name || name.trim().length === 0) {
            return NextResponse.json(
                { error: 'Name ist erforderlich' },
                { status: 400 }
            );
        }

        const cashBook = await prisma.cashBook.create({
            data: {
                name: name.trim(),
                description: description?.trim() || null,
                initialBalance: parseFloat(String(initialBalance)) || 0,
                currency,
                userId
            }
        });

        await auditCreate(userId, 'CashBook' as any, cashBook, cashBook.name);

        return NextResponse.json(cashBook, { status: 201 });
    } catch (error) {
        console.error('Error creating cash book:', error);
        return NextResponse.json(
            { error: 'Fehler beim Erstellen des Kassenbuchs' },
            { status: 500 }
        );
    }
}

// PUT: Kassenbuch aktualisieren
export async function PUT(request: NextRequest) {
    try {
        const userId = await getUserId();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { id, name, description, initialBalance, currency, isActive } = body;

        if (!id) {
            return NextResponse.json(
                { error: 'Kassenbuch-ID ist erforderlich' },
                { status: 400 }
            );
        }

        // Check ownership
        const existing = await prisma.cashBook.findFirst({
            where: { id: parseInt(String(id)), userId }
        });

        if (!existing) {
            return NextResponse.json(
                { error: 'Kassenbuch nicht gefunden' },
                { status: 404 }
            );
        }

        const updateData: any = {};
        if (name !== undefined) updateData.name = name.trim();
        if (description !== undefined) updateData.description = description?.trim() || null;
        if (initialBalance !== undefined) updateData.initialBalance = parseFloat(String(initialBalance));
        if (currency !== undefined) updateData.currency = currency;
        if (isActive !== undefined) updateData.isActive = isActive;

        const cashBook = await prisma.cashBook.update({
            where: { id: parseInt(String(id)) },
            data: updateData
        });

        await auditUpdate(userId, 'CashBook' as any, id, existing, cashBook, cashBook.name);

        return NextResponse.json(cashBook);
    } catch (error) {
        console.error('Error updating cash book:', error);
        return NextResponse.json(
            { error: 'Fehler beim Aktualisieren des Kassenbuchs' },
            { status: 500 }
        );
    }
}

// DELETE: Kassenbuch löschen
export async function DELETE(request: NextRequest) {
    try {
        const userId = await getUserId();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json(
                { error: 'Kassenbuch-ID ist erforderlich' },
                { status: 400 }
            );
        }

        // Check ownership
        const existing = await prisma.cashBook.findFirst({
            where: { id: parseInt(id), userId },
            include: {
                _count: { select: { transactions: true } }
            }
        });

        if (!existing) {
            return NextResponse.json(
                { error: 'Kassenbuch nicht gefunden' },
                { status: 404 }
            );
        }

        // Check if there are transactions (optional: prevent deletion)
        if (existing._count.transactions > 0) {
            return NextResponse.json(
                { error: `Kassenbuch enthält ${existing._count.transactions} Buchungen. Löschen Sie zuerst alle Buchungen.` },
                { status: 400 }
            );
        }

        await prisma.cashBook.delete({
            where: { id: parseInt(id) }
        });

        await auditDelete(userId, 'CashBook' as any, existing, existing.name);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting cash book:', error);
        return NextResponse.json(
            { error: 'Fehler beim Löschen des Kassenbuchs' },
            { status: 500 }
        );
    }
}
