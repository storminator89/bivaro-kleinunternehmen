import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ensureTenantUploadDir, getTenantUploadPath } from '@/lib/upload-path';
import { MAX_INVOICE_UPLOAD_BYTES } from '@/lib/resource-limits';

export type QuoteReleaseOriginalBinding = { originalArchiveName: string; originalSha256: string; originalBytes: number };
export type QuoteReleaseOriginalRead = { path: string; bytes: Buffer; sourceVersion: string };
export class QuoteReleaseOriginalError extends Error {
  readonly status = 409;
  constructor(cause?: unknown) {
    super('Das unveränderliche Angebotsoriginal ist nicht als exakt gebundene mandanteneigene Datei verfügbar.', { cause });
    this.name = 'QuoteReleaseOriginalError';
  }
}
function version(stat: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }): string {
  return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
}
function validBinding(binding: QuoteReleaseOriginalBinding): void {
  if (!/^[a-f0-9]{64}$/.test(binding.originalSha256) || !Number.isInteger(binding.originalBytes) || binding.originalBytes < 1 || binding.originalBytes > MAX_INVOICE_UPLOAD_BYTES) throw new QuoteReleaseOriginalError();
}

/** No legacy/root fallback; only an owned stable regular file can satisfy history. */
export async function readQuoteReleaseOriginal(userId: string, binding: QuoteReleaseOriginalBinding): Promise<QuoteReleaseOriginalRead> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    validBinding(binding);
    const path = getTenantUploadPath(userId, binding.originalArchiveName);
    if (await realpath(path) !== resolve(path)) throw new Error('symlink');
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat();
    if (!before.isFile() || before.size !== binding.originalBytes) throw new Error('file');
    // A concurrently growing file must not turn readFile into an unbounded
    // allocation. Read at most the declared bound plus one overflow byte.
    const buffer = Buffer.alloc(binding.originalBytes + 1);
    let read = 0;
    while (read < buffer.byteLength) {
      const result = await handle.read(buffer, read, buffer.byteLength - read, read);
      if (result.bytesRead === 0) break;
      read += result.bytesRead;
    }
    if (read !== binding.originalBytes) throw new Error('size');
    const bytes = buffer.subarray(0, read);
    const after = await handle.stat();
    if (version(before) !== version(after) || bytes.byteLength !== binding.originalBytes || createHash('sha256').update(bytes).digest('hex') !== binding.originalSha256) throw new Error('changed original');
    return { path, bytes, sourceVersion: version(after) };
  } catch (error) { throw error instanceof QuoteReleaseOriginalError ? error : new QuoteReleaseOriginalError(error); }
  finally { await handle?.close(); }
}

/** Final consistency check, not a promise of filesystem-wide atomicity. */
export async function quoteReleaseOriginalVersion(userId: string, archiveName: string): Promise<string> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const path = getTenantUploadPath(userId, archiveName);
    if (await realpath(path) !== resolve(path)) throw new Error('symlink');
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('not regular');
    return version(stat);
  } catch (error) { throw new QuoteReleaseOriginalError(error); }
  finally { await handle?.close(); }
}

/** Preserve immutable archive basename. Never adopt/overwrite an existing path.
 * Register exclusive creation before any later failure so caller's checked
 * cleanup can retain uncertain or referenced stages rather than deleting proof. */
export async function stageQuoteReleaseOriginal(userId: string, binding: QuoteReleaseOriginalBinding, bytes: Uint8Array, onCreated: (name: string) => void): Promise<QuoteReleaseOriginalRead> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let directoryHandle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    validBinding(binding);
    const path = getTenantUploadPath(userId, binding.originalArchiveName);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== binding.originalBytes || createHash('sha256').update(bytes).digest('hex') !== binding.originalSha256) throw new Error('hash');
    const directory = await ensureTenantUploadDir(userId);
    if (await realpath(directory) !== resolve(directory)) throw new Error('directory symlink');
    handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o400);
    onCreated(binding.originalArchiveName);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close(); handle = undefined;
    directoryHandle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    await directoryHandle.sync();
    await directoryHandle.close(); directoryHandle = undefined;
    return await readQuoteReleaseOriginal(userId, binding);
  } catch (error) { throw error instanceof QuoteReleaseOriginalError ? error : new QuoteReleaseOriginalError(error); }
  finally { await handle?.close(); await directoryHandle?.close(); }
}
