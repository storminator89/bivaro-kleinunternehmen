import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getTenantUploadPath } from '@/lib/upload-path';
import { MAX_RECEIPT_UPLOAD_BYTES } from '@/lib/resource-limits';
import { ManualFinancialRecordError, type ManualRecordOriginalEvidence, type ManualRecordSnapshot } from '@/lib/manual-financial-record-evidence';

export async function readManualRecordOriginalBytes(userId: string, storedName: string, expected?: ManualRecordOriginalEvidence): Promise<{ evidence: ManualRecordOriginalEvidence; bytes: Buffer }> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    // No legacy-root fallback: only a tenant-owned stable regular file is proof.
    const path = getTenantUploadPath(userId, storedName);
    if (await realpath(path) !== resolve(path)) throw new Error('symlink');
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile() || before.size <= 0 || before.size > MAX_RECEIPT_UPLOAD_BYTES) throw new Error('file');
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || bytes.byteLength !== before.size) throw new Error('changed');
    const { createHash } = await import('node:crypto');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (expected && (expected.status !== 'ARCHIVED' || sha256 !== expected.sha256 || bytes.byteLength !== expected.byteCount)) throw new Error('hash');
    return { evidence: { status: 'ARCHIVED', fileName: expected?.fileName ?? null, sha256, byteCount: bytes.byteLength }, bytes };
  } catch {
    throw new ManualFinancialRecordError(409, 'MANUAL_RECORD_ORIGINAL_UNAVAILABLE', 'Das angegebene Original ist nicht als unveränderte mandanteneigene Datei verfügbar. Festschreibung/Korrektur wurde nicht vorgenommen.');
  } finally { await handle?.close(); }
}

export async function readManualRecordOriginal(userId: string, storedName: string, expected?: ManualRecordOriginalEvidence): Promise<ManualRecordOriginalEvidence> {
  return (await readManualRecordOriginalBytes(userId, storedName, expected)).evidence;
}
/** A finalized binding must exist; missing history is corruption, never implicit NONE. */
export function finalizedManualRecordOriginal(row: { manualRecordState: string }, events: Array<{ snapshot: unknown }>): ManualRecordOriginalEvidence | null {
  if (row.manualRecordState !== 'FINALIZED') return null;
  const snapshot = events[0]?.snapshot as ManualRecordSnapshot | undefined;
  if (!snapshot || snapshot.contractVersion !== 1 || !snapshot.original || !['NONE', 'ARCHIVED'].includes(snapshot.original.status)) throw new ManualFinancialRecordError(409, 'MANUAL_RECORD_ORIGINAL_UNAVAILABLE', 'Der unveränderliche Originalnachweis fehlt.');
  return snapshot.original;
}
