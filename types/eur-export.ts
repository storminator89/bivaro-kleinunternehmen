/**
 * Types for EÜR (Einnahmen-Überschuss-Rechnung) Elster Export
 * Based on Anlage EÜR 2024 form structure
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

export interface EURExportData {
    year: number;
    companyName?: string;
    taxNumber?: string;
    lines: EURLineValue[];
    totalIncome: number;
    totalExpense: number;
    profit: number;
    generatedAt: string;
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
