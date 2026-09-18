/**
 * API Route: /api/eur-export
 * Export EÜR (Einnahmen-Überschuss-Rechnung) in Elster-compatible format
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getUserId } from '@/lib/get-user-id';
import { auditExport, AuditEntityType } from '@/lib/audit-log';
import {
    getEURLineForCategory,
    getDefaultIncomeLineForKleinunternehmer,
    getDefaultExpenseLine,
    generateElsterCSV,
    getEURLineDefinition,
} from '@/lib/eur-line-mapping';
import { EURLineValue, EURExportData, UnmappedCategory } from '@/types/eur-export';
import {
    calculateExpenseDeductionForYear,
    getIncomeAccountingDate,
    isIncludedIncome,
} from '@/lib/accounting';

export async function GET(request: NextRequest) {
    try {
        const userId = await getUserId();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString());
        const format = searchParams.get('format') || 'csv'; // csv or json

        // Get date range for the year
        const startDate = new Date(year, 0, 1);
        const endDate = new Date(year, 11, 31, 23, 59, 59, 999);

        // Fetch the small accounting projections. Invoice parsedData is not
        // needed for an EÜR and must stay out of this query.
        const incomes = await prisma.income.findMany({
            where: {
                userId,
                taxRelevant: true,
            },
            select: {
                amount: true,
                date: true,
                taxRelevant: true,
                invoice: { select: { status: true, paidAt: true } },
            },
        });

        // Older assets can still contribute AfA in the export year, so their
        // acquisition date may precede the selected year.
        const expenses = await prisma.expense.findMany({
            where: {
                userId,
                taxRelevant: true,
            },
            select: {
                amount: true,
                date: true,
                category: true,
                taxRelevant: true,
                taxDeductiblePercentage: true,
                depreciationYears: true,
            },
        });

        // Fetch user settings for company info
        const settings = await prisma.settings.findUnique({
            where: { userId },
        });

        // Aggregate amounts by EÜR line number
        const lineAmounts = new Map<number, number>();
        const unmappedCategories = new Map<string, { amount: number; count: number }>();

        // Process incomes - for Kleinunternehmer, all goes to line 16
        const defaultIncomeLine = getDefaultIncomeLineForKleinunternehmer();
        for (const income of incomes) {
            if (!isIncludedIncome(income)) continue;
            const incomeDate = getIncomeAccountingDate(income);
            if (incomeDate < startDate || incomeDate > endDate) continue;
            const lineNumber = defaultIncomeLine;
            lineAmounts.set(lineNumber, (lineAmounts.get(lineNumber) || 0) + income.amount);
        }

        // Process expenses - map categories to EÜR lines
        for (const expense of expenses) {
            const category = expense.category || 'Sonstiges';
            let lineNumber = getEURLineForCategory(category);

            const deductibleAmount = calculateExpenseDeductionForYear(expense, year);
            if ((expense.depreciationYears ?? 0) > 0 && deductibleAmount !== 0) {
                lineNumber = 31; // AfA line
            }

            if (deductibleAmount > 0) {
                if (lineNumber) {
                    lineAmounts.set(lineNumber, (lineAmounts.get(lineNumber) || 0) + deductibleAmount);
                } else {
                    // Track unmapped categories
                    const existing = unmappedCategories.get(category) || { amount: 0, count: 0 };
                    unmappedCategories.set(category, {
                        amount: existing.amount + deductibleAmount,
                        count: existing.count + 1,
                    });

                    // Add to default expense line (72)
                    const defaultLine = getDefaultExpenseLine();
                    lineAmounts.set(defaultLine, (lineAmounts.get(defaultLine) || 0) + deductibleAmount);
                }
            }
        }

        // Build EÜR line values
        const eurLines: EURLineValue[] = [];
        let totalIncome = 0;
        let totalExpense = 0;

        for (const [lineNumber, amount] of lineAmounts) {
            const lineDef = getEURLineDefinition(lineNumber);
            if (lineDef) {
                eurLines.push({
                    lineNumber,
                    name: lineDef.name,
                    amount: Math.round(amount * 100) / 100, // Round to 2 decimals
                    type: lineDef.type,
                });

                if (lineDef.type === 'income') {
                    totalIncome += amount;
                } else if (lineDef.type === 'expense') {
                    totalExpense += amount;
                }
            }
        }

        // Sort by line number
        eurLines.sort((a, b) => a.lineNumber - b.lineNumber);

        // Calculate profit
        const profit = totalIncome - totalExpense;

        // Add result line (87)
        eurLines.push({
            lineNumber: 87,
            name: 'Gewinn / Verlust',
            amount: Math.round(profit * 100) / 100,
            type: 'result',
        });

        const exportData: EURExportData = {
            year,
            companyName: settings?.companyName || undefined,
            taxNumber: settings?.taxNumber || undefined,
            lines: eurLines,
            totalIncome: Math.round(totalIncome * 100) / 100,
            totalExpense: Math.round(totalExpense * 100) / 100,
            profit: Math.round(profit * 100) / 100,
            generatedAt: new Date().toISOString(),
        };

        // Convert unmapped categories to array
        const unmappedCategoriesArray: UnmappedCategory[] = Array.from(unmappedCategories.entries()).map(
            ([category, data]) => ({
                category,
                amount: data.amount,
                count: data.count,
            })
        );

        // Generate warnings
        const warnings: string[] = [];
        if (unmappedCategoriesArray.length > 0) {
            warnings.push(`${unmappedCategoriesArray.length} Kategorien ohne EÜR-Zuordnung (wurden zu Zeile 72 hinzugefügt)`);
        }

        // Audit log
        await auditExport(userId, 'EURExport' as AuditEntityType, {
            year,
            format,
            totalIncome,
            totalExpense,
            profit,
            lineCount: eurLines.length,
            unmappedCategories: unmappedCategoriesArray.length,
        });

        if (format === 'json') {
            return NextResponse.json({
                data: exportData,
                unmappedCategories: unmappedCategoriesArray,
                warnings,
            });
        }

        // Generate CSV
        const csvContent = generateElsterCSV(
            eurLines,
            year,
            settings?.companyName || undefined,
            settings?.taxNumber || undefined
        );

        const filename = `Anlage-EUER-${year}.csv`;

        return new NextResponse(csvContent, {
            status: 200,
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="${filename}"`,
            },
        });
    } catch (error) {
        console.error('Error exporting EÜR:', error);
        return NextResponse.json(
            { error: 'Fehler beim Export der EÜR' },
            { status: 500 }
        );
    }
}
