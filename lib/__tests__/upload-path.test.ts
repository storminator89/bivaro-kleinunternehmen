import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

let directory: string
let storage: typeof import('../upload-path')
const storedName = '00000000-0000-4000-8000-000000000000.pdf'

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'bivaro-upload-path-'))
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory)
  try {
    storage = await import('../upload-path')
  } finally {
    cwd.mockRestore()
  }
})

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

describe('private upload root', () => {
  it('resolves data/uploads under the isolated fixture, outside public', () => {
    expect(storage.UPLOAD_BASE_DIR).toBe(path.join(directory, 'data', 'uploads'))
    expect(storage.UPLOAD_BASE_DIR).not.toContain(path.join('public', 'uploads'))
  })
})

describe('active legacy upload resolution', () => {
  it('resolves existing safe legacy files for backwards-compatible reads', async () => {
    await mkdir(storage.UPLOAD_BASE_DIR, { recursive: true })
    const filePath = storage.getLegacyUploadPath('document.pdf')
    expect(filePath).toBe(path.join(storage.UPLOAD_BASE_DIR, 'document.pdf'))
    await writeFile(filePath, 'legacy fixture')
    expect(storage.findUploadedFile('document.pdf')).toBe(filePath)
    expect(await readFile(filePath, 'utf8')).toBe('legacy fixture')
  })

  it.each(['../../../etc/passwd', '/etc/passwd', 'subdir/nested/file.pdf', 'subdir\\file.pdf', '.env', 'file with spaces.pdf', 'file\0.pdf'])(
    'rejects unsafe legacy reference %s',
    filename => {
      expect(() => storage.getLegacyUploadPath(filename)).toThrow()
      expect(storage.findUploadedFile(filename)).toBeNull()
    },
  )
})

describe('active tenant upload resolution', () => {
  it('resolves opaque names below the specified tenant only', () => {
    expect(storage.getTenantUploadPath('tenant-a', storedName)).toBe(
      path.join(storage.UPLOAD_BASE_DIR, 'tenant-a', storedName),
    )
  })

  it.each(['', '../tenant-a', '/tmp', 'tenant/a', 'tenant\\a'])(
    'rejects unsafe tenant ID %s',
    userId => expect(() => storage.getTenantUploadPath(userId, storedName)).toThrow(),
  )

  it.each(['../../../etc/passwd', '/etc/passwd', `nested/${storedName}`, `nested\\${storedName}`, '.env', 'document.pdf', `${storedName}\0`])(
    'rejects non-opaque stored reference %s',
    filename => expect(() => storage.getTenantUploadPath('tenant-a', filename)).toThrow(),
  )
})

describe('tenant file storage', () => {
  it('keeps equal original names in separate private tenant directories', async () => {
    const first = await storage.writeTenantFile('tenant-a', '../../same.pdf', new Uint8Array([1, 2, 3]))
    const second = await storage.writeTenantFile('tenant-b', '../../same.pdf', new Uint8Array([4, 5, 6]))

    expect(first).not.toBe(second)
    expect(storage.isSafeStoredFileName(first)).toBe(true)
    expect(storage.isSafeStoredFileName(second)).toBe(true)
    const firstPath = storage.getTenantUploadPath('tenant-a', first)
    const secondPath = storage.getTenantUploadPath('tenant-b', second)
    expect(firstPath).not.toBe(secondPath)
    expect(storage.findUploadedFile(first, 'tenant-a')).toBe(firstPath)
    expect(storage.findUploadedFile(first, 'tenant-b')).toBeNull()
    await expect(readFile(firstPath)).resolves.toEqual(Buffer.from([1, 2, 3]))
    await expect(readFile(secondPath)).resolves.toEqual(Buffer.from([4, 5, 6]))

    await storage.deleteTenantFile('tenant-a', first)
    await storage.deleteTenantFile('tenant-b', second)
    expect(storage.findUploadedFile(first, 'tenant-a')).toBeNull()
  })
})
