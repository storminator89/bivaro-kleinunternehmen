import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
    getUploadPath,
    isPathWithinUploadDir,
    UPLOAD_BASE_DIR,
} from '../upload-path'
import path from 'path'

describe('UPLOAD_BASE_DIR', () => {
    it('should be in data/uploads directory', () => {
        expect(UPLOAD_BASE_DIR).toContain('data')
        expect(UPLOAD_BASE_DIR).toContain('uploads')
    })

    it('should NOT be in public folder (security)', () => {
        expect(UPLOAD_BASE_DIR).not.toContain(path.join('public', 'uploads'))
    })
})

describe('getUploadPath', () => {
    it('should return full path for filename', () => {
        const result = getUploadPath('document.pdf')
        expect(result).toBe(path.join(UPLOAD_BASE_DIR, 'document.pdf'))
    })

    it('should sanitize path traversal attempts', () => {
        const result = getUploadPath('../../../etc/passwd')
        // Should only contain the basename, not the traversal
        expect(result).toBe(path.join(UPLOAD_BASE_DIR, 'passwd'))
        expect(result).not.toContain('..')
    })

    it('should extract basename from nested paths', () => {
        const result = getUploadPath('subdir/nested/file.pdf')
        expect(result).toBe(path.join(UPLOAD_BASE_DIR, 'file.pdf'))
    })

    it('should handle filenames with special characters', () => {
        const result = getUploadPath('file with spaces.pdf')
        expect(result).toContain('file with spaces.pdf')
    })
})

describe('isPathWithinUploadDir', () => {
    it('should return true for paths within upload directory', () => {
        const validPath = path.join(UPLOAD_BASE_DIR, 'document.pdf')
        expect(isPathWithinUploadDir(validPath)).toBe(true)
    })

    it('should return true for nested paths within upload directory', () => {
        const nestedPath = path.join(UPLOAD_BASE_DIR, 'subdir', 'file.pdf')
        expect(isPathWithinUploadDir(nestedPath)).toBe(true)
    })

    it('should return false for paths outside upload directory', () => {
        const outsidePath = path.join(process.cwd(), 'etc', 'passwd')
        expect(isPathWithinUploadDir(outsidePath)).toBe(false)
    })

    it('should return false for path traversal attempts', () => {
        const traversalPath = path.join(UPLOAD_BASE_DIR, '..', '..', 'etc', 'passwd')
        expect(isPathWithinUploadDir(traversalPath)).toBe(false)
    })

    it('should return true for the upload directory itself', () => {
        expect(isPathWithinUploadDir(UPLOAD_BASE_DIR)).toBe(true)
    })
})
