/**
 * API Route: /api/cashbook/export
 * Export cash book as CSV
 */

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getUserId } from '@/lib/get-user-id';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { auditExport, AuditEntityType } from '@/lib/audit-log';

export async function GET(request: NextRequest) {
    try {
        const userId = await getUserId();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const cashBookId = searchParams.get('cashBookId');
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');
        const exportFormat = searchParams.get('format') || 'csv';

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

        // Get all transactions
        const transactions = await prisma.cashTransaction.findMany({
            where,
            orderBy: [{ date: 'asc' }, { createdAt: 'asc' }]
        });

        // Format currency helper
        const formatCurrency = (amount: number) => {
            return amount.toLocaleString('de-DE', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
        };

        // Generate CSV
        const csvHeader = [
            'Datum',
            'Belegnr.',
            'Beschreibung',
            'Kategorie',
            'Einnahme',
            'Ausgabe',
            'Saldo',
            'Steuerrelevant',
            'Notizen'
        ].join(';');

        const csvRows = transactions.map((tx) => {
            const row = [
                format(new Date(tx.date), 'dd.MM.yyyy', { locale: de }),
                tx.receiptNumber || '',
                `"${(tx.description || '').replace(/"/g, '""')}"`,
                tx.category || '',
                tx.type === 'EINNAHME' ? formatCurrency(tx.amount) : '',
                tx.type === 'AUSGABE' ? formatCurrency(tx.amount) : '',
                formatCurrency(tx.runningBalance),
                tx.taxRelevant ? 'Ja' : 'Nein',
                `"${(tx.notes || '').replace(/"/g, '""')}"`
            ];
            return row.join(';');
        });

        // Add summary row
        const totalIncome = transactions
            .filter((tx) => tx.type === 'EINNAHME')
            .reduce((sum, tx) => sum + tx.amount, 0);
        const totalExpense = transactions
            .filter((tx) => tx.type === 'AUSGABE')
            .reduce((sum, tx) => sum + tx.amount, 0);

        const lastBalance = transactions.length > 0
            ? transactions[transactions.length - 1].runningBalance
            : cashBook.initialBalance;

        csvRows.push(''); // Empty row
        csvRows.push(`Anfangsbestand;;;;;${formatCurrency(cashBook.initialBalance)}`);
        csvRows.push(`Summe Einnahmen;;;;${formatCurrency(totalIncome)}`);
        csvRows.push(`Summe Ausgaben;;;;;${formatCurrency(totalExpense)}`);
        csvRows.push(`Endbestand;;;;;${formatCurrency(lastBalance)}`);

        const csvContent = '\uFEFF' + [csvHeader, ...csvRows].join('\n'); // BOM for Excel

        // Generate filename
        const dateRange = startDate && endDate
            ? `_${startDate}_bis_${endDate}`
            : `_${format(new Date(), 'yyyy-MM-dd')}`;
        const filename = `Kassenbuch_${cashBook.name.replace(/[^a-zA-Z0-9]/g, '_')}${dateRange}.csv`;

        // Audit log
        await auditExport(userId, 'CashBook' as AuditEntityType, {
            cashBookId: parseInt(cashBookId),
            cashBookName: cashBook.name,
            transactionCount: transactions.length,
            startDate,
            endDate,
            format: exportFormat
        });

        return new NextResponse(csvContent, {
            status: 200,
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="${filename}"`
            }
        });
    } catch (error) {
        console.error('Error exporting cash book:', error);
        return NextResponse.json(
            { error: 'Fehler beim Export des Kassenbuchs' },
            { status: 500 }
        );
    }
}
