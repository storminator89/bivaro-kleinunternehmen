import { describe, it, expect } from 'vitest'
import {
    validatePassword,
    isValidEmail,
    sanitizeString,
} from '../security'

describe('validatePassword', () => {
    describe('Length Requirements', () => {
        it('should reject passwords shorter than 8 characters', () => {
            const result = validatePassword('Ab1234')
            expect(result.valid).toBe(false)
            expect(result.message).toContain('8 Zeichen')
        })

        it('should reject passwords longer than 72 UTF-8 bytes', () => {
            const longPassword = 'Aa1' + 'x'.repeat(130)
            const result = validatePassword(longPassword)
            expect(result.valid).toBe(false)
            expect(result.message).toContain('72 UTF-8-Bytes')
        })
    })

    describe('Character Requirements', () => {
        it('should require at least one uppercase letter', () => {
            const result = validatePassword('abcdefg123')
            expect(result.valid).toBe(false)
            expect(result.message).toContain('Großbuchstaben')
        })

        it('should require at least one lowercase letter', () => {
            const result = validatePassword('ABCDEFG123')
            expect(result.valid).toBe(false)
            expect(result.message).toContain('Kleinbuchstaben')
        })

        it('should require at least one digit', () => {
            const result = validatePassword('AbcdefgHij')
            expect(result.valid).toBe(false)
            expect(result.message).toContain('Zahl')
        })
    })

    describe('Valid Passwords', () => {
        it('should accept valid passwords', () => {
            expect(validatePassword('SecurePass123').valid).toBe(true)
            expect(validatePassword('MyP@ssw0rd!').valid).toBe(true)
        })
    })

    describe('Edge Cases', () => {
        it('should reject empty password', () => {
            expect(validatePassword('').valid).toBe(false)
        })

        it('should reject null/undefined', () => {
            expect(validatePassword(null as unknown as string).valid).toBe(false)
            expect(validatePassword(undefined as unknown as string).valid).toBe(false)
        })
    })
})

describe('isValidEmail', () => {
    describe('Valid Emails', () => {
        it('should accept standard email formats', () => {
            expect(isValidEmail('user@example.com')).toBe(true)
            expect(isValidEmail('user.name@example.de')).toBe(true)
            expect(isValidEmail('user+tag@example.org')).toBe(true)
        })
    })

    describe('Invalid Emails', () => {
        it('should reject emails without @', () => {
            expect(isValidEmail('userexample.com')).toBe(false)
        })

        it('should reject emails without domain', () => {
            expect(isValidEmail('user@')).toBe(false)
        })

        it('should reject empty string', () => {
            expect(isValidEmail('')).toBe(false)
        })

        it('should reject very long emails (>254 chars)', () => {
            const longEmail = 'a'.repeat(250) + '@example.com'
            expect(isValidEmail(longEmail)).toBe(false)
        })
    })
})

describe('sanitizeString', () => {
    it('should trim whitespace', () => {
        expect(sanitizeString('  hello  ')).toBe('hello')
    })

    it('should remove null bytes', () => {
        expect(sanitizeString('hello\x00world')).toBe('helloworld')
    })

    it('should remove control characters', () => {
        expect(sanitizeString('hello\x00\x01\x02world')).toBe('helloworld')
    })

    it('should limit length', () => {
        const result = sanitizeString('hello world', 5)
        expect(result).toBe('hello')
    })

    it('should preserve German umlauts', () => {
        expect(sanitizeString('Müller')).toBe('Müller')
        expect(sanitizeString('Größe')).toBe('Größe')
    })
})
