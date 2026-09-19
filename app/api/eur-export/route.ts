/**
 * CSV working paper for an Anlage-EÜR period.
 *
 * This endpoint intentionally does not claim ELSTER compatibility or perform
 * an authenticated submission. The supported year and mapping version are
 * explicit, and an unknown year is rejected instead of receiving today's
 * row numbers by accident.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getUserId } from '@/lib/get-user-id';
import { auditExport, AuditEntityType } from '@/lib/audit-log';
import {
    getEURLineForCategoryForYear,
    getDefaultIncomeLineForKleinunternehmer,
    getDefaultExpenseLineForYear,
    generateElsterCSV,
    getEURLineDefinition,
    getEURMappingVersion,
    getEURSourceReferences,
    getSupportedEURYears,
    isSupportedEURYear,
} from '@/lib/eur-line-mapping';
import { EURCorrectionDetail, EURLineValue, EURExportData, UnmappedCategory } from '@/types/eur-export';
import {
    calculateAccountingYear,
    calculateExpenseDeductionForYear,
    getBusinessDate,
    getIncomeAccountingDate,
    isIncludedIncome,
    isDateInCalendarYear,
} from '@/lib/accounting';

function parseYear(value: string | null): number | null {
    if (!value || !/^\d{4}$/.test(value)) return null;
    const year = Number(value);
    return Number.isSafeInteger(year) ? year : null;
}

export async function GET(request: NextRequest) {
    try {
        const userId = await getUserId();
        if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const year = parseYear(searchParams.get('year'));
        const format = searchParams.get('format') || 'csv';
        if (year === null) {
            return NextResponse.json({ error: 'Bitte ein gültiges vierstelliges Veranlagungsjahr angeben.' }, { status: 400 });
        }
        if (!isSupportedEURYear(year)) {
            return NextResponse.json({
                error: `Für ${year} ist keine amtlich belegte EÜR-Zuordnung hinterlegt.`,
                supportedYears: getSupportedEURYears(),
            }, { status: 400 });
        }
        if (format !== 'json' && format !== 'csv') {
            return NextResponse.json({ error: 'Format muss json oder csv sein.' }, { status: 400 });
        }

        // Read all inputs from one database snapshot so the control totals,
        // line rows and metadata cannot describe different moments in time.
        const [incomes, expenses, settings] = await prisma.$transaction(async (tx) => Promise.all([
            tx.income.findMany({
                where: { userId },
                select: {
                    id: true,
                    amount: true,
                    date: true,
                    taxRelevant: true,
                    invoice: { select: { status: true, paidAt: true } },
                },
            }),
            tx.expense.findMany({
                where: { userId },
                select: {
                    id: true,
                    description: true,
                    amount: true,
                    date: true,
                    category: true,
                    taxRelevant: true,
                    taxDeductiblePercentage: true,
                    depreciationYears: true,
                },
            }),
            tx.settings.findUnique({ where: { userId } }),
        ]));

        const lineAmounts = new Map<number, number>();
        const unmappedCategories = new Map<string, { amount: number; count: number }>();
        const corrections: EURCorrectionDetail[] = [];
        const warnings: string[] = [];
        const includedIncomes = incomes.filter((income) =>
            isIncludedIncome(income) && isDateInCalendarYear(getIncomeAccountingDate(income), year),
        );
        const includedExpenses = expenses
            .map((expense) => ({ expense, amount: calculateExpenseDeductionForYear(expense, year) }))
            .filter(({ amount }) => amount !== 0);

        const addLineAmount = (lineNumber: number, amount: number) => {
            lineAmounts.set(lineNumber, (lineAmounts.get(lineNumber) || 0) + amount);
        };

        const incomeLine = getDefaultIncomeLineForKleinunternehmer(year);
        for (const income of includedIncomes) addLineAmount(incomeLine, income.amount);

        for (const { expense, amount } of includedExpenses) {
            const category = expense.category || 'Sonstiges';
            let lineNumber = getEURLineForCategoryForYear(category, year);
            const mappedDefinition = lineNumber === null ? undefined : getEURLineDefinition(lineNumber, year);
            if (mappedDefinition?.type !== 'expense') lineNumber = null;
            if ((expense.depreciationYears ?? 0) > 0 && amount !== 0) {
                // The current data model does not distinguish land,
                // intangible and movable assets. Row 33 is therefore a
                // provisional working-paper row requiring review.
                lineNumber = 33;
                warnings.push(`AfA-Buchung ${expense.id} wurde mangels Anlageart vorläufig Zeile 33 (bewegliche Wirtschaftsgüter) zugeordnet; bitte Anlageverzeichnis prüfen.`);
            }

            if (lineNumber === null) {
                const existing = unmappedCategories.get(category) || { amount: 0, count: 0 };
                unmappedCategories.set(category, {
                    amount: existing.amount + amount,
                    count: existing.count + 1,
                });
                lineNumber = getDefaultExpenseLineForYear(year);
            }
            addLineAmount(lineNumber, amount);

            if (amount < 0) {
                corrections.push({
                    expenseId: expense.id,
                    date: getBusinessDate(expense.date),
                    description: expense.description,
                    category,
                    amount,
                    lineNumber,
                    originalExpenseId: null,
                    correctionReason: 'Negativer Ausgabenbeleg/Korrektur; Vorzeichen übernommen, Ursprungsbeleg nicht dauerhaft verknüpft',
                });
            }
        }

        const eurLines: EURLineValue[] = [];
        for (const [lineNumber, amount] of lineAmounts) {
            const lineDef = getEURLineDefinition(lineNumber, year);
            if (lineDef && amount !== 0) {
                eurLines.push({ lineNumber, name: lineDef.name, amount: roundCurrency(amount), type: lineDef.type });
            }
        }
        eurLines.sort((a, b) => a.lineNumber - b.lineNumber);

        // This is the same pure aggregation used by simulation consumers. It
        // intentionally includes signed corrections and uses UTC year fields.
        const summary = calculateAccountingYear(year, incomes, expenses);
        const totalIncome = roundCurrency(summary.totalIncome);
        const totalExpense = roundCurrency(summary.totalExpense);
        const profit = roundCurrency(summary.profit);
        const lineIncomeTotal = roundCurrency(eurLines.filter((line) => line.type === 'income').reduce((sum, line) => sum + line.amount, 0));
        const lineExpenseTotal = roundCurrency(eurLines.filter((line) => line.type === 'expense').reduce((sum, line) => sum + line.amount, 0));
        if (lineIncomeTotal !== totalIncome || lineExpenseTotal !== totalExpense) {
            warnings.push(`Kontrollsummenabweichung: Zeilen Einnahmen ${lineIncomeTotal.toFixed(2)} / ${totalIncome.toFixed(2)}, Ausgaben ${lineExpenseTotal.toFixed(2)} / ${totalExpense.toFixed(2)}. Export vor Übertragung prüfen.`);
        }
        const resultLine = getEURLineDefinition(90, year);
        eurLines.push({
            lineNumber: 90,
            name: resultLine?.name || 'Berechneter Überschuss (Übertrag)',
            amount: profit,
            type: 'result',
        });

        const unmappedCategoriesArray: UnmappedCategory[] = Array.from(unmappedCategories.entries()).map(([category, data]) => ({
            category,
            amount: roundCurrency(data.amount),
            count: data.count,
        }));
        if (unmappedCategoriesArray.length > 0) {
            warnings.push(`${unmappedCategoriesArray.length} Kategorie(n) ohne belastbare Zuordnung; vor Übertragung bitte prüfen (vorläufig Zeile 60).`);
        }
        if (corrections.length > 0) {
            warnings.push(`${corrections.length} negative Korrektur(en) wurden mit Originalvorzeichen übernommen; Erstattungsgrund und Ursprungsbeleg prüfen.`);
        }
        warnings.push('Der ausgewiesene Betrag ist ein vereinfachter Überschuss für den Übertrag in Zeile 90 (Summe/Differenz der Zeilen 76 bis 89). Die vollständige steuerpflichtige Ergebnisermittlung der späteren amtlichen Zeilen 92, 95 und 97 wird hier nicht berechnet.');

        const mappingVersion = getEURMappingVersion(year)!;
        const exportData: EURExportData = {
            year,
            mappingVersion,
            exportKind: 'csv-working-paper',
            companyName: settings?.companyName || undefined,
            taxNumber: settings?.taxNumber || undefined,
            lines: eurLines,
            totalIncome,
            totalExpense,
            profit,
            generatedAt: new Date().toISOString(),
            controlTotals: {
                incomeCount: includedIncomes.length,
                expenseCount: includedExpenses.length,
                correctionCount: corrections.length,
                incomeAmount: totalIncome,
                expenseAmount: totalExpense,
                profit,
            },
            corrections,
            sourceReferences: getEURSourceReferences(year),
        };

        await auditExport(userId, 'EURExport' as AuditEntityType, {
            year, format, mappingVersion, totalIncome, totalExpense, profit,
            lineCount: eurLines.length,
            correctionCount: corrections.length,
            unmappedCategories: unmappedCategoriesArray.length,
        });

        if (format === 'json') return NextResponse.json({ data: exportData, unmappedCategories: unmappedCategoriesArray, warnings });

        const csvContent = generateElsterCSV(eurLines, year, settings?.companyName || undefined, settings?.taxNumber || undefined, {
            mappingVersion,
            corrections,
            warnings,
        });
        return new NextResponse(csvContent, {
            status: 200,
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="Anlage-EUER-Uebertragungshilfe-${year}.csv"`,
            },
        });
    } catch (error) {
        console.error('Error exporting EÜR:', error);
        return NextResponse.json({ error: 'Fehler beim Export der EÜR' }, { status: 500 });
    }
}

function roundCurrency(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}
