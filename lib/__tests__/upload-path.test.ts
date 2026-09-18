import { describe, it, expect } from 'vitest'
import {
    deleteTenantFile,
    getTenantUploadPath,
    getUploadPath,
    isPathWithinUploadDir,
    readTenantFile,
    UPLOAD_BASE_DIR,
    writeTenantFile,
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
        expect(() => getUploadPath('../../../etc/passwd')).toThrow()
    })

    it('should extract basename from nested paths', () => {
        expect(() => getUploadPath('subdir/nested/file.pdf')).toThrow()
    })

    it('should handle filenames with special characters', () => {
        expect(() => getUploadPath('file with spaces.pdf')).toThrow()
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

describe('tenant file storage', () => {
    it('keeps equal original names in separate private tenant directories', async () => {
        const first = await writeTenantFile('tenant-a', '../../same.pdf', new Uint8Array([1, 2, 3]));
        const second = await writeTenantFile('tenant-b', '../../same.pdf', new Uint8Array([4, 5, 6]));

        expect(first).not.toBe(second);
        expect(getTenantUploadPath('tenant-a', first)).not.toBe(getTenantUploadPath('tenant-b', second));
        await expect(readTenantFile('tenant-a', first)).resolves.toEqual(Buffer.from([1, 2, 3]));
        await expect(readTenantFile('tenant-b', second)).resolves.toEqual(Buffer.from([4, 5, 6]));

        await deleteTenantFile('tenant-a', first);
        await deleteTenantFile('tenant-b', second);
    });
});
