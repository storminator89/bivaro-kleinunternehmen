/**
 * API Route: /api/cashbook
 * CRUD operations for CashBook (Kassenbuch)
 */

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { inTransaction } from '@/lib/db-transaction';
import { CashbookError, cashAmount, recalculateCashBalances } from '@/lib/cashbook-service';
import { getUserId } from '@/lib/get-user-id';
import { auditCreate, auditUpdate, auditDelete, AuditEntityType } from '@/lib/audit-log';

function parseId(value: unknown): number {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw new CashbookError('Ungültige Kassenbuch-ID');
    return id;
}

function parseText(value: unknown, field: string, required = false): string | null {
    if (value === undefined || value === null) {
        if (required) throw new CashbookError(`${field} ist erforderlich`);
        return null;
    }
    if (typeof value !== 'string') throw new CashbookError(`Ungültiges Feld: ${field}`);
    const text = value.trim();
    if (required && !text) throw new CashbookError(`${field} ist erforderlich`);
    if (text.length > 255) throw new CashbookError(`Ungültiges Feld: ${field}`);
    return text || null;
}

// GET: Liste aller Kassenbücher des Benutzers
export async function GET(_request: Request) {
    try {
        const userId = await getUserId();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const cashBooks = await prisma.cashBook.findMany({
            where: { userId },
            include: {
                _count: {
                    select: { transactions: { where: { userId } } }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Calculate current balance for each cash book
        const cashBooksWithBalance = await Promise.all(
            cashBooks.map(async (cashBook) => {
                const lastTransaction = await prisma.cashTransaction.findFirst({
                    where: { cashBookId: cashBook.id, userId },
                    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
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

        const parsedName = parseText(name, 'Name', true)!;
        const parsedDescription = parseText(description, 'Beschreibung');
        const parsedCurrency = parseText(currency, 'Währung', true)!;

        const cashBook = await prisma.cashBook.create({
            data: {
                name: parsedName,
                description: parsedDescription,
                initialBalance: cashAmount(initialBalance, false),
                currency: parsedCurrency,
                userId
            }
        });

        await auditCreate(userId, 'CashBook' as AuditEntityType, cashBook, cashBook.name);

        return NextResponse.json(cashBook, { status: 201 });
    } catch (error) {
        if (error instanceof CashbookError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
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
        const cashBookId = parseId(id);

        const updateData: Prisma.CashBookUpdateInput = {};
        if (name !== undefined) updateData.name = parseText(name, 'Name', true)!;
        if (description !== undefined) updateData.description = parseText(description, 'Beschreibung');
        if (initialBalance !== undefined) updateData.initialBalance = cashAmount(initialBalance, false);
        if (currency !== undefined) updateData.currency = parseText(currency, 'Währung', true)!;
        if (isActive !== undefined) {
            if (typeof isActive !== 'boolean') throw new CashbookError('Ungültiges Feld: Aktiv');
            updateData.isActive = isActive;
        }

        const result = await inTransaction(async tx => {
            const existing = await tx.cashBook.findFirst({ where: { id: cashBookId, userId } });
            if (!existing) throw new CashbookError('Kassenbuch nicht gefunden', 404);
            const updated = await tx.cashBook.update({ where: { id: cashBookId, userId }, data: updateData });
            if (initialBalance !== undefined) await recalculateCashBalances(tx, updated.id, userId);
            return { existing, updated };
        });

        await auditUpdate(userId, 'CashBook' as AuditEntityType, cashBookId, result.existing, result.updated, result.updated.name);

        return NextResponse.json(result.updated);
    } catch (error) {
        if (error instanceof CashbookError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
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

        const cashBookId = parseId(id);
        const existing = await inTransaction(async tx => {
            const current = await tx.cashBook.findFirst({
                where: { id: cashBookId, userId },
                include: { _count: { select: { transactions: true } } },
            });
            if (!current) throw new CashbookError('Kassenbuch nicht gefunden', 404);
            if (current._count.transactions > 0) {
                throw new CashbookError(`Kassenbuch enthält ${current._count.transactions} Buchungen. Löschen Sie zuerst alle Buchungen.`);
            }
            await tx.cashBook.delete({ where: { id: cashBookId, userId } });
            return current;
        });

        await auditDelete(userId, 'CashBook' as AuditEntityType, existing, existing.name);

        return NextResponse.json({ success: true });
    } catch (error) {
        if (error instanceof CashbookError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error('Error deleting cash book:', error);
        return NextResponse.json(
            { error: 'Fehler beim Löschen des Kassenbuchs' },
            { status: 500 }
        );
    }
}
