/**
 * Types for EÜR (Einnahmen-Überschuss-Rechnung) Elster Export
 * The application exports a CSV working paper. It does not produce the
 * authenticated ELSTER data set and therefore must not describe the file as
 * an ELSTER submission/import.
 */

export type EURLineType = 'income' | 'expense' | 'result';

export interface EURLineDefinition {
    lineNumber: number;
    name: string;
    description: string;
    type: EURLineType;
    section: string;
}

export interface EURLineValue {
    lineNumber: number;
    name: string;
    amount: number;
    type: EURLineType;
}

export interface EURCorrectionDetail {
    expenseId?: number;
    date: string;
    description?: string | null;
    category: string;
    amount: number;
    lineNumber: number | null;
    correctionReason: string;
    originalExpenseId?: number | null;
}

export interface EURControlTotals {
    incomeCount: number;
    expenseCount: number;
    correctionCount: number;
    incomeAmount: number;
    expenseAmount: number;
    profit: number;
}

export interface EURExportData {
    year: number;
    /** Version of the official form mapping used for this working paper. */
    mappingVersion: string;
    /** Always `csv-working-paper`; no ELSTER submission is performed here. */
    exportKind: 'csv-working-paper';
    companyName?: string;
    taxNumber?: string;
    lines: EURLineValue[];
    totalIncome: number;
    totalExpense: number;
    profit: number;
    generatedAt: string;
    controlTotals: EURControlTotals;
    corrections: EURCorrectionDetail[];
    sourceReferences: string[];
}

export interface CategoryEURMapping {
    category: string;
    eurLineNumber: number;
    eurLineName: string;
}

export interface UnmappedCategory {
    category: string;
    amount: number;
    count: number;
}

export interface EURExportPreview {
    data: EURExportData;
    unmappedCategories: UnmappedCategory[];
    warnings: string[];
}
