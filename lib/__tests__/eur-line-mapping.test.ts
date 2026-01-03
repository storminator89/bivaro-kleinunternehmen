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
            expect(getEURLineForCategory('Miete')).toBe(35)
            expect(getEURLineForCategory('Bürobedarf')).toBe(64)
            expect(getEURLineForCategory('Telefon')).toBe(46)
        })
    })

    describe('Case-insensitive Matching', () => {
        it('should match regardless of case', () => {
            expect(getEURLineForCategory('MIETE')).toBe(35)
            expect(getEURLineForCategory('miete')).toBe(35)
            expect(getEURLineForCategory('Miete')).toBe(35)
        })
    })

    describe('Fuzzy/Partial Matching', () => {
        it('should match when category contains a known key', () => {
            // 'Kfz' is contained in the category name
            expect(getEURLineForCategory('Kfz-Kosten für Firmenwagen')).toBe(45)
            // 'Telefon' is contained in the category name
            expect(getEURLineForCategory('Telefon und Fax')).toBe(46)
        })
    })

    describe('Common Categories to EÜR Lines', () => {
        const categoryMappings = [
            // Einnahmen
            { category: 'Einnahmen', expectedLine: 16 },
            { category: 'Umsatz', expectedLine: 16 },
            { category: 'Dienstleistung', expectedLine: 16 },
            // Ausgaben
            { category: 'Wareneinkauf', expectedLine: 23 },
            { category: 'Fremdleistungen', expectedLine: 24 },
            { category: 'Personal', expectedLine: 27 },
            { category: 'AfA', expectedLine: 31 },
            { category: 'Raumkosten', expectedLine: 35 },
            { category: 'Internet', expectedLine: 46 },
            { category: 'Steuerberater', expectedLine: 60 },
            { category: 'Versicherung', expectedLine: 62 },
            { category: 'Werbung', expectedLine: 63 },
            { category: 'Homeoffice', expectedLine: 66 },
            { category: 'Sonstiges', expectedLine: 72 },
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
            expect(getEURLineForCategory('  Miete  ')).toBe(35)
        })
    })
})

describe('getEURLineDefinition', () => {
    it('should return line definition for valid line numbers', () => {
        const line16 = getEURLineDefinition(16)
        expect(line16).toBeDefined()
        expect(line16?.name).toContain('Kleinunternehmer')
        expect(line16?.type).toBe('income')
    })

    it('should return undefined for invalid line numbers', () => {
        expect(getEURLineDefinition(999)).toBeUndefined()
    })
})

describe('getDefaultIncomeLineForKleinunternehmer', () => {
    it('should return line 16 (§ 19 UStG)', () => {
        expect(getDefaultIncomeLineForKleinunternehmer()).toBe(16)
    })
})

describe('getDefaultExpenseLine', () => {
    it('should return line 72 (Sonstige BA)', () => {
        expect(getDefaultExpenseLine()).toBe(72)
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
        const incomeLines = getIncomeLines()
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
        expect(incomeLines.some(line => line.lineNumber === 16)).toBe(true)
    })

    it('should include common expense lines', () => {
        const expenseLines = getExpenseLines()
        const lineNumbers = expenseLines.map(l => l.lineNumber)
        expect(lineNumbers).toContain(23) // Waren
        expect(lineNumbers).toContain(35) // Raumkosten
        expect(lineNumbers).toContain(72) // Sonstige BA
    })
})
