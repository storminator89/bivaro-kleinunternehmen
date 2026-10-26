import { beforeEach, describe, expect, it, vi } from 'vitest';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';

const mocks = vi.hoisted(() => ({ open: vi.fn(), realpath: vi.fn(), ensure: vi.fn(), path: '/synthetic/owner/00000001-1111-4111-8111-111111111111.pdf', directory: '/synthetic/owner' }));
vi.mock('node:fs/promises', () => ({ open: mocks.open, realpath: mocks.realpath }));
vi.mock('@/lib/upload-path', () => ({ getTenantUploadPath: vi.fn(() => mocks.path), ensureTenantUploadDir: mocks.ensure }));
import { QuoteReleaseOriginalError, readQuoteReleaseOriginal, stageQuoteReleaseOriginal } from '@/lib/quote-release-original';

const bytes = Buffer.from('%PDF-SYNTHETIC');
const binding = { originalArchiveName: '00000001-1111-4111-8111-111111111111.pdf', originalSha256: createHash('sha256').update(bytes).digest('hex'), originalBytes: bytes.byteLength };
const stat = (extra = {}) => ({ dev: 1, ino: 2, size: bytes.byteLength, mtimeMs: 10, ctimeMs: 10, isFile: () => true, ...extra });
function readHandle() { return { stat: vi.fn().mockResolvedValue(stat()), read: vi.fn(async (buffer: Buffer, offset: number, length: number, position: number) => { const chunk = bytes.subarray(position, position + length); chunk.copy(buffer, offset); return { bytesRead: chunk.byteLength, buffer }; }), close: vi.fn().mockResolvedValue(undefined) }; }
beforeEach(() => { vi.resetAllMocks(); mocks.realpath.mockImplementation(async path => path); mocks.ensure.mockResolvedValue(mocks.directory); });

describe('quote original safety, mocked filesystem only', () => {
  it('reads only stable owned no-follow bytes with exact hash/size', async () => {
    const handle = readHandle(); mocks.open.mockResolvedValue(handle);
    expect((await readQuoteReleaseOriginal('synthetic-owner', binding)).bytes).toEqual(bytes);
    expect(mocks.open).toHaveBeenCalledWith(mocks.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    expect(handle.close).toHaveBeenCalledOnce();
  });
  it('rejects symlink paths before opening', async () => {
    mocks.realpath.mockResolvedValue('/outside/tenant.pdf');
    await expect(readQuoteReleaseOriginal('synthetic-owner', binding)).rejects.toBeInstanceOf(QuoteReleaseOriginalError);
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it('rejects mutation and mismatched original hash without exposing raw detail', async () => {
    const handle = readHandle(); handle.stat.mockResolvedValueOnce(stat()).mockResolvedValueOnce(stat({ ctimeMs: 11 })); mocks.open.mockResolvedValue(handle);
    await expect(readQuoteReleaseOriginal('synthetic-owner', binding)).rejects.toThrow('unveränderliche');
    const changed = readHandle(); mocks.open.mockResolvedValue(changed);
    await expect(readQuoteReleaseOriginal('synthetic-owner', { ...binding, originalSha256: 'a'.repeat(64) })).rejects.toBeInstanceOf(QuoteReleaseOriginalError);
    expect(changed.close).toHaveBeenCalledOnce();
  });
  it('rejects size/non-regular files before reading', async () => {
    for (const state of [stat({ size: bytes.byteLength + 1 }), stat({ isFile: () => false })]) {
      const handle = readHandle(); handle.stat.mockResolvedValue(state); mocks.open.mockResolvedValue(handle);
      await expect(readQuoteReleaseOriginal('synthetic-owner', binding)).rejects.toBeInstanceOf(QuoteReleaseOriginalError);
      expect(handle.read).not.toHaveBeenCalled();
    }
  });
  it('does not write or create a directory for wrong backup bytes', async () => {
    await expect(stageQuoteReleaseOriginal('synthetic-owner', binding, Buffer.from('wrong'), vi.fn())).rejects.toBeInstanceOf(QuoteReleaseOriginalError);
    expect(mocks.ensure).not.toHaveBeenCalled(); expect(mocks.open).not.toHaveBeenCalled();
  });
  it('exclusive path collision never adopts, overwrites or retries the existing file', async () => {
    const created = vi.fn(); mocks.open.mockRejectedValue(Object.assign(new Error('existing path'), { code: 'EEXIST' }));
    await expect(stageQuoteReleaseOriginal('synthetic-owner', binding, bytes, created)).rejects.toBeInstanceOf(QuoteReleaseOriginalError);
    expect(mocks.open).toHaveBeenCalledOnce(); expect(created).not.toHaveBeenCalled();
  });
  it('registers exclusive stages before failure; uncertain cleanup is left to caller', async () => {
    const created = vi.fn(), handle = { writeFile: vi.fn().mockRejectedValue(new Error('synthetic disk failure')), close: vi.fn().mockResolvedValue(undefined) };
    mocks.open.mockResolvedValue(handle);
    await expect(stageQuoteReleaseOriginal('synthetic-owner', binding, bytes, created)).rejects.toBeInstanceOf(QuoteReleaseOriginalError);
    expect(created).toHaveBeenCalledWith(binding.originalArchiveName); expect(handle.close).toHaveBeenCalledOnce();
    expect(mocks.open.mock.calls[0][1]).toBe(constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW);
    expect(mocks.open.mock.calls[0][2]).toBe(0o400);
  });
  it('flushes file and directory before readback of a new immutable original', async () => {
    const file = { writeFile: vi.fn().mockResolvedValue(undefined), sync: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
    const directory = { sync: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
    mocks.open.mockResolvedValueOnce(file).mockResolvedValueOnce(directory).mockResolvedValueOnce(readHandle());
    const created = vi.fn(); const result = await stageQuoteReleaseOriginal('synthetic-owner', binding, bytes, created);
    expect(result.bytes).toEqual(bytes); expect(file.sync).toHaveBeenCalledOnce(); expect(directory.sync).toHaveBeenCalledOnce();
    expect(file.sync.mock.invocationCallOrder[0]).toBeLessThan(directory.sync.mock.invocationCallOrder[0]);
    expect(created.mock.invocationCallOrder[0]).toBeLessThan(file.writeFile.mock.invocationCallOrder[0]);
  });
});
