import { describe, it, expect } from 'vitest'
import {
    calculateIncomeTax,
    calculateSolidaritySurcharge,
    calculateTradeTax,
    calculateChurchTax,
} from '../tax-calculator'

describe('calculateIncomeTax', () => {
    describe('Grundfreibetrag (Zone 1: 0 - 11.604€)', () => {
        it('should return 0 for income of 0€', () => {
            expect(calculateIncomeTax(0)).toBe(0)
        })

        it('should return 0 for income at Grundfreibetrag (11.604€)', () => {
            expect(calculateIncomeTax(11604)).toBe(0)
        })

        it('should return 0 for income just below Grundfreibetrag', () => {
            expect(calculateIncomeTax(11000)).toBe(0)
        })
    })

    describe('Zone 2 (11.605€ - 17.005€)', () => {
        it('should calculate tax for income at start of Zone 2', () => {
            const tax = calculateIncomeTax(11605)
            expect(tax).toBeGreaterThan(0)
            expect(tax).toBeLessThan(100)
        })

        it('should calculate tax for income at end of Zone 2', () => {
            const tax = calculateIncomeTax(17005)
            expect(tax).toBeCloseTo(1025.38, 0)
        })
    })

    describe('Zone 3 (17.006€ - 66.760€)', () => {
        it('should calculate tax for 30.000€ income', () => {
            const tax = calculateIncomeTax(30000)
            // Expected: ~4.500€ (typical for this income level)
            expect(tax).toBeGreaterThan(4000)
            expect(tax).toBeLessThan(5500)
        })

        it('should calculate tax at end of Zone 3', () => {
            const tax = calculateIncomeTax(66760)
            // Before Zone 4 starts
            expect(tax).toBeGreaterThan(15000)
            expect(tax).toBeLessThan(20000)
        })
    })

    describe('Zone 4 (66.761€ - 277.825€)', () => {
        it('should apply 42% marginal rate for 100.000€ income', () => {
            const tax = calculateIncomeTax(100000)
            // 0.42 * 100000 - 9960.28 = 32,039.72
            expect(tax).toBeCloseTo(32039.72, 0)
        })
    })

    describe('Zone 5 - Reichensteuer (>277.825€)', () => {
        it('should apply 45% marginal rate for 300.000€ income', () => {
            const tax = calculateIncomeTax(300000)
            // 0.45 * 300000 - 18295.03 = 116,704.97
            expect(tax).toBeCloseTo(116704.97, 0)
        })
    })

    describe('Abrundung auf vollen Euro', () => {
        it('should floor income to full euros before calculation', () => {
            const taxWithDecimals = calculateIncomeTax(30000.99)
            const taxWithoutDecimals = calculateIncomeTax(30000)
            expect(taxWithDecimals).toBe(taxWithoutDecimals)
        })
    })
})

describe('calculateSolidaritySurcharge', () => {
    it('should return 0 for income tax at or below 18.130€', () => {
        expect(calculateSolidaritySurcharge(18130)).toBe(0)
        expect(calculateSolidaritySurcharge(10000)).toBe(0)
    })

    it('should apply Milderungszone (18.131€ - 33.912€)', () => {
        const soli = calculateSolidaritySurcharge(20000)
        // (20000 - 18130) * 0.119 = 222.51
        expect(soli).toBeCloseTo(222.51, 1)
    })

    it('should apply full 5.5% above Milderungszone', () => {
        const soli = calculateSolidaritySurcharge(40000)
        // 40000 * 0.055 = 2200
        expect(soli).toBeCloseTo(2200, 0)
    })
})

describe('calculateTradeTax', () => {
    it('should return 0 for profit at or below Freibetrag (24.500€)', () => {
        expect(calculateTradeTax(24500, 400)).toBe(0)
        expect(calculateTradeTax(20000, 400)).toBe(0)
    })

    it('should calculate tax for profit above Freibetrag', () => {
        // Profit: 50.000€, Hebesatz: 400%
        // Taxable: 50000 - 24500 = 25500
        // Base: 25500 * 0.035 = 892.50
        // Tax: 892.50 * 4 = 3570
        const tax = calculateTradeTax(50000, 400)
        expect(tax).toBeCloseTo(3570, 0)
    })

    it('should handle different Hebesätze', () => {
        const profit = 50000
        const tax200 = calculateTradeTax(profit, 200)
        const tax400 = calculateTradeTax(profit, 400)
        expect(tax400).toBe(tax200 * 2)
    })
})

describe('calculateChurchTax', () => {
    it('should calculate 8% church tax (Bayern, Baden-Württemberg)', () => {
        const churchTax = calculateChurchTax(10000, 8)
        expect(churchTax).toBe(800)
    })

    it('should calculate 9% church tax (other states)', () => {
        const churchTax = calculateChurchTax(10000, 9)
        expect(churchTax).toBe(900)
    })
})
