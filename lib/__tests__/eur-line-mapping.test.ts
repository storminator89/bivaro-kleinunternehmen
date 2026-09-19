import { describe, it, expect } from 'vitest'
import {
    getEURLineForCategory,
    getEURLineDefinition,
    getDefaultIncomeLineForKleinunternehmer,
    getDefaultExpenseLine,
    formatAmountForElster,
    getIncomeLines,
    getExpenseLines,
} from '../eur-line-mapping'

describe('getEURLineForCategory', () => {
    describe('Direct Matching', () => {
        it('should match exact category names', () => {
            expect(getEURLineForCategory('Miete', 2025)).toBe(39)
            expect(getEURLineForCategory('Bürobedarf', 2025)).toBe(51)
            expect(getEURLineForCategory('Telefon', 2025)).toBe(43)
        })
    })

    describe('Case-insensitive Matching', () => {
        it('should match regardless of case', () => {
            expect(getEURLineForCategory('MIETE', 2025)).toBe(39)
            expect(getEURLineForCategory('miete', 2025)).toBe(39)
            expect(getEURLineForCategory('Miete', 2025)).toBe(39)
        })
    })

    describe('Fuzzy/Partial Matching', () => {
        it('should match when category contains a known key', () => {
            // Free-form strings remain visible for review instead of being
            // silently mapped to a possibly wrong tax row.
            expect(getEURLineForCategory('Kfz-Kosten für Firmenwagen', 2025)).toBeNull()
            expect(getEURLineForCategory('Telefon und Fax', 2025)).toBeNull()
        })
    })

    describe('Common Categories to EÜR Lines', () => {
        const categoryMappings = [
            // Einnahmen
            { category: 'Einnahmen', expectedLine: 12 },
            { category: 'Umsatz', expectedLine: 12 },
            { category: 'Dienstleistung', expectedLine: 12 },
            // Ausgaben
            { category: 'Wareneinkauf', expectedLine: 27 },
            { category: 'Fremdleistungen', expectedLine: 29 },
            { category: 'Personal', expectedLine: 30 },
            { category: 'AfA', expectedLine: 33 },
            { category: 'Raumkosten', expectedLine: 39 },
            { category: 'Internet', expectedLine: 43 },
            { category: 'Steuerberater', expectedLine: 46 },
            { category: 'Versicherung', expectedLine: 49 },
            { category: 'Werbung', expectedLine: 54 },
            { category: 'Homeoffice', expectedLine: 66 },
            { category: 'Sonstiges', expectedLine: 60 },
        ]

        categoryMappings.forEach(({ category, expectedLine }) => {
            it(`should map "${category}" to line ${expectedLine}`, () => {
                expect(getEURLineForCategory(category)).toBe(expectedLine)
            })
        })
    })

    describe('Edge Cases', () => {
        it('should return null for unknown categories', () => {
            expect(getEURLineForCategory('XYZ Unknown Category')).toBeNull()
        })

        it('should return null for empty string', () => {
            expect(getEURLineForCategory('')).toBeNull()
        })

        it('should handle whitespace', () => {
            expect(getEURLineForCategory('  Miete  ', 2025)).toBe(39)
        })
    })
})

describe('getEURLineDefinition', () => {
    it('should return line definition for valid line numbers', () => {
        const line16 = getEURLineDefinition(16, 2025)
        expect(line16).toBeDefined()
        expect(line16?.name).toContain('steuerfreie')
        expect(line16?.type).toBe('income')
    })

    it('should return undefined for invalid line numbers', () => {
        expect(getEURLineDefinition(999)).toBeUndefined()
    })
})

describe('getDefaultIncomeLineForKleinunternehmer', () => {
    it('should return the official 2025 line 12 (§ 19 UStG)', () => {
        expect(getDefaultIncomeLineForKleinunternehmer(2025)).toBe(12)
    })
})

describe('getDefaultExpenseLine', () => {
    it('should return the official 2025 line 60 (Sonstige BA)', () => {
        expect(getDefaultExpenseLine(2025)).toBe(60)
    })
})

describe('formatAmountForElster', () => {
    it('should use comma as decimal separator', () => {
        expect(formatAmountForElster(1234.56)).toBe('1234,56')
    })

    it('should format to 2 decimal places', () => {
        expect(formatAmountForElster(1234)).toBe('1234,00')
        expect(formatAmountForElster(1234.5)).toBe('1234,50')
    })

    it('should handle large numbers', () => {
        expect(formatAmountForElster(123456.78)).toBe('123456,78')
    })

    it('should handle zero', () => {
        expect(formatAmountForElster(0)).toBe('0,00')
    })
})

describe('getIncomeLines / getExpenseLines', () => {
    it('should return only income lines for getIncomeLines', () => {
        const incomeLines = getIncomeLines(2025)
        expect(incomeLines.length).toBeGreaterThan(0)
        expect(incomeLines.every(line => line.type === 'income')).toBe(true)
    })

    it('should return only expense lines for getExpenseLines', () => {
        const expenseLines = getExpenseLines()
        expect(expenseLines.length).toBeGreaterThan(0)
        expect(expenseLines.every(line => line.type === 'expense')).toBe(true)
    })

    it('should include Kleinunternehmer line (16) in income lines', () => {
        const incomeLines = getIncomeLines()
        expect(incomeLines.some(line => line.lineNumber === 12)).toBe(true)
    })

    it('should include common expense lines', () => {
        const expenseLines = getExpenseLines(2025)
        const lineNumbers = expenseLines.map(l => l.lineNumber)
        expect(lineNumbers).toContain(27) // Waren
        expect(lineNumbers).toContain(39) // Raumkosten
        expect(lineNumbers).toContain(60) // Sonstige BA
    })
})
