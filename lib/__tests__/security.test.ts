import { describe, it, expect } from 'vitest'
import {
    validateFilePath,
    validatePassword,
    isValidEmail,
    escapeHtml,
    sanitizeString,
    validateFileSize,
    generateSecureFilename,
} from '../security'

describe('validateFilePath', () => {
    const baseDir = '/app/data/uploads'

    describe('Path Traversal Prevention', () => {
        it('should extract only basename, stripping path traversal attempts', () => {
            // The function extracts only the basename, so ../../../etc/passwd becomes 'passwd'
            // This is the expected security behavior - any path component is stripped
            const result = validateFilePath(baseDir, '../../../etc/passwd')
            expect(result).not.toBeNull()
            expect(result).toContain('passwd')
            expect(result).not.toContain('etc')
        })

        it('should block absolute paths', () => {
            expect(validateFilePath(baseDir, '/etc/passwd')).not.toContain('/etc')
        })

        it('should block null bytes', () => {
            expect(validateFilePath(baseDir, 'file.txt\x00.jpg')).toBeNull()
        })

        it('should block hidden files (starting with .)', () => {
            expect(validateFilePath(baseDir, '.htaccess')).toBeNull()
            expect(validateFilePath(baseDir, '.env')).toBeNull()
        })
    })

    describe('Valid Filenames', () => {
        it('should allow normal filenames', () => {
            const result = validateFilePath(baseDir, 'document.pdf')
            expect(result).not.toBeNull()
            expect(result).toContain('document.pdf')
        })

        it('should extract basename from nested paths', () => {
            const result = validateFilePath(baseDir, 'subdir/file.pdf')
            expect(result).not.toBeNull()
            expect(result).toContain('file.pdf')
            expect(result).not.toContain('subdir')
        })
    })

    describe('Edge Cases', () => {
        it('should return null for empty filename', () => {
            expect(validateFilePath(baseDir, '')).toBeNull()
        })

        it('should return null for null/undefined', () => {
            expect(validateFilePath(baseDir, null as unknown as string)).toBeNull()
            expect(validateFilePath(baseDir, undefined as unknown as string)).toBeNull()
        })
    })
})

describe('validatePassword', () => {
    describe('Length Requirements', () => {
        it('should reject passwords shorter than 8 characters', () => {
            const result = validatePassword('Ab1234')
            expect(result.valid).toBe(false)
            expect(result.message).toContain('8 Zeichen')
        })

        it('should reject passwords longer than 128 characters', () => {
            const longPassword = 'Aa1' + 'x'.repeat(130)
            const result = validatePassword(longPassword)
            expect(result.valid).toBe(false)
            expect(result.message).toContain('128 Zeichen')
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

describe('escapeHtml', () => {
    it('should escape < and >', () => {
        expect(escapeHtml('<script>')).toBe('&lt;script&gt;')
    })

    it('should escape quotes', () => {
        expect(escapeHtml('"test"')).toBe('&quot;test&quot;')
        expect(escapeHtml("'test'")).toBe('&#39;test&#39;')
    })

    it('should escape &', () => {
        expect(escapeHtml('a & b')).toBe('a &amp; b')
    })

    it('should handle XSS payloads', () => {
        const xss = '<script>alert("xss")</script>'
        const escaped = escapeHtml(xss)
        expect(escaped).not.toContain('<')
        expect(escaped).not.toContain('>')
    })

    it('should return empty string for null/undefined', () => {
        expect(escapeHtml(null as unknown as string)).toBe('')
        expect(escapeHtml(undefined as unknown as string)).toBe('')
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

describe('validateFileSize', () => {
    it('should accept files within limits', () => {
        expect(validateFileSize(1024, 'default')).toBe(true)
        expect(validateFileSize(5 * 1024 * 1024, 'default')).toBe(true)
    })

    it('should reject files exceeding limits', () => {
        expect(validateFileSize(6 * 1024 * 1024, 'default')).toBe(false)
        expect(validateFileSize(11 * 1024 * 1024, 'pdf')).toBe(false)
    })

    it('should reject zero or negative sizes', () => {
        expect(validateFileSize(0, 'default')).toBe(false)
        expect(validateFileSize(-1, 'default')).toBe(false)
    })
})

describe('generateSecureFilename', () => {
    it('should generate UUID-based filenames', () => {
        const result = generateSecureFilename('document.pdf')
        expect(result).toMatch(/^[a-f0-9-]{36}\.pdf$/)
    })

    it('should preserve file extension', () => {
        expect(generateSecureFilename('photo.jpg')).toContain('.jpg')
        expect(generateSecureFilename('document.PDF')).toContain('.pdf') // lowercase
    })

    it('should add prefix when provided', () => {
        const result = generateSecureFilename('file.pdf', 'receipt')
        expect(result).toMatch(/^receipt_/)
    })
})
