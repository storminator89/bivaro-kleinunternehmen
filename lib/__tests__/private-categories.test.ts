import { describe, it, expect } from 'vitest'
import {
    isPrivateCategory,
    isPrivateWithdrawal,
    isPrivateDeposit,
    PRIVATE_CATEGORIES,
} from '../private-categories'

describe('PRIVATE_CATEGORIES constants', () => {
    it('should define Privatentnahme', () => {
        expect(PRIVATE_CATEGORIES.ENTNAHME).toBe('Privatentnahme')
    })

    it('should define Privateinlage', () => {
        expect(PRIVATE_CATEGORIES.EINLAGE).toBe('Privateinlage')
    })
})

describe('isPrivateCategory', () => {
    describe('Privatentnahme', () => {
        it('should return true for exact match', () => {
            expect(isPrivateCategory('Privatentnahme')).toBe(true)
        })

        it('should return true for lowercase', () => {
            expect(isPrivateCategory('privatentnahme')).toBe(true)
        })

        it('should return true for uppercase', () => {
            expect(isPrivateCategory('PRIVATENTNAHME')).toBe(true)
        })

        it('should return true with whitespace', () => {
            expect(isPrivateCategory('  Privatentnahme  ')).toBe(true)
        })
    })

    describe('Privateinlage', () => {
        it('should return true for exact match', () => {
            expect(isPrivateCategory('Privateinlage')).toBe(true)
        })

        it('should return true for lowercase', () => {
            expect(isPrivateCategory('privateinlage')).toBe(true)
        })
    })

    describe('Non-private categories', () => {
        it('should return false for normal categories', () => {
            expect(isPrivateCategory('Bürobedarf')).toBe(false)
            expect(isPrivateCategory('Miete')).toBe(false)
            expect(isPrivateCategory('Gehalt')).toBe(false)
        })

        it('should return false for null/undefined', () => {
            expect(isPrivateCategory(null)).toBe(false)
            expect(isPrivateCategory(undefined)).toBe(false)
        })

        it('should return false for empty string', () => {
            expect(isPrivateCategory('')).toBe(false)
        })
    })
})

describe('isPrivateWithdrawal', () => {
    it('should return true only for Privatentnahme', () => {
        expect(isPrivateWithdrawal('Privatentnahme')).toBe(true)
        expect(isPrivateWithdrawal('privatentnahme')).toBe(true)
    })

    it('should return false for Privateinlage', () => {
        expect(isPrivateWithdrawal('Privateinlage')).toBe(false)
    })

    it('should return false for null/undefined', () => {
        expect(isPrivateWithdrawal(null)).toBe(false)
        expect(isPrivateWithdrawal(undefined)).toBe(false)
    })
})

describe('isPrivateDeposit', () => {
    it('should return true only for Privateinlage', () => {
        expect(isPrivateDeposit('Privateinlage')).toBe(true)
        expect(isPrivateDeposit('privateinlage')).toBe(true)
    })

    it('should return false for Privatentnahme', () => {
        expect(isPrivateDeposit('Privatentnahme')).toBe(false)
    })

    it('should return false for null/undefined', () => {
        expect(isPrivateDeposit(null)).toBe(false)
        expect(isPrivateDeposit(undefined)).toBe(false)
    })
})
