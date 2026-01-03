import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
    hashApiKey,
    generateApiKey,
    checkRateLimit,
    extractApiKey,
} from '../api-auth'
import { NextRequest } from 'next/server'

describe('hashApiKey', () => {
    it('should return SHA-256 hash', () => {
        const hash = hashApiKey('test_key')
        // SHA-256 produces 64 hex characters
        expect(hash).toHaveLength(64)
        expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('should produce consistent hashes', () => {
        const hash1 = hashApiKey('same_key')
        const hash2 = hashApiKey('same_key')
        expect(hash1).toBe(hash2)
    })

    it('should produce different hashes for different keys', () => {
        const hash1 = hashApiKey('key_1')
        const hash2 = hashApiKey('key_2')
        expect(hash1).not.toBe(hash2)
    })
})

describe('generateApiKey', () => {
    it('should generate key with biv_sk_ prefix', () => {
        const { key } = generateApiKey()
        expect(key).toMatch(/^biv_sk_/)
    })

    it('should return keyHash as SHA-256 of key', () => {
        const { key, keyHash } = generateApiKey()
        const expectedHash = hashApiKey(key)
        expect(keyHash).toBe(expectedHash)
    })

    it('should return truncated keyPrefix', () => {
        const { key, keyPrefix } = generateApiKey()
        expect(keyPrefix).toBe(key.substring(0, 12) + '...')
        expect(keyPrefix).toMatch(/^biv_sk_[a-f0-9]{5}\.\.\./)
    })

    it('should generate unique keys', () => {
        const key1 = generateApiKey()
        const key2 = generateApiKey()
        expect(key1.key).not.toBe(key2.key)
        expect(key1.keyHash).not.toBe(key2.keyHash)
    })
})

describe('checkRateLimit', () => {
    beforeEach(() => {
        // Reset time mocking
        vi.useFakeTimers()
    })

    it('should allow first request', () => {
        const result = checkRateLimit(999) // Use unique ID to avoid conflicts
        expect(result.allowed).toBe(true)
        expect(result.remaining).toBe(99) // 100 - 1
    })

    it('should track multiple requests', () => {
        const apiKeyId = 1000
        checkRateLimit(apiKeyId)
        checkRateLimit(apiKeyId)
        const third = checkRateLimit(apiKeyId)
        expect(third.remaining).toBe(97) // 100 - 3
    })

    it('should block after limit exceeded', () => {
        const apiKeyId = 1001
        // Exhaust the limit
        for (let i = 0; i < 100; i++) {
            checkRateLimit(apiKeyId)
        }
        const result = checkRateLimit(apiKeyId)
        expect(result.allowed).toBe(false)
        expect(result.remaining).toBe(0)
    })

    it('should reset after window expires', () => {
        const apiKeyId = 1002
        // Use up some requests
        for (let i = 0; i < 50; i++) {
            checkRateLimit(apiKeyId)
        }

        // Advance time past the window (1 minute + 1 second)
        vi.advanceTimersByTime(61 * 1000)

        const result = checkRateLimit(apiKeyId)
        expect(result.allowed).toBe(true)
        expect(result.remaining).toBe(99) // Reset to fresh window
    })
})

describe('extractApiKey', () => {
    it('should extract from Authorization: Bearer header', () => {
        const request = new NextRequest('http://localhost:3000/api/test', {
            headers: {
                'Authorization': 'Bearer biv_sk_testkey123'
            }
        })
        expect(extractApiKey(request)).toBe('biv_sk_testkey123')
    })

    it('should extract from X-API-Key header', () => {
        const request = new NextRequest('http://localhost:3000/api/test', {
            headers: {
                'X-API-Key': 'biv_sk_anotherkey456'
            }
        })
        expect(extractApiKey(request)).toBe('biv_sk_anotherkey456')
    })

    it('should prefer Authorization header over X-API-Key', () => {
        const request = new NextRequest('http://localhost:3000/api/test', {
            headers: {
                'Authorization': 'Bearer biv_sk_bearer_key',
                'X-API-Key': 'biv_sk_header_key'
            }
        })
        expect(extractApiKey(request)).toBe('biv_sk_bearer_key')
    })

    it('should return null when no API key is present', () => {
        const request = new NextRequest('http://localhost:3000/api/test')
        expect(extractApiKey(request)).toBeNull()
    })

    it('should not extract non-Bearer Authorization headers', () => {
        const request = new NextRequest('http://localhost:3000/api/test', {
            headers: {
                'Authorization': 'Basic dXNlcjpwYXNz'
            }
        })
        expect(extractApiKey(request)).toBeNull()
    })
})
