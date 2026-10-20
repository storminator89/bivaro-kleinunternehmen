import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getTenantUploadPath } from '@/lib/upload-path';
import { MAX_INVOICE_UPLOAD_BYTES, MAX_XML_INPUT_BYTES } from '@/lib/resource-limits';
import { PurchaseDocumentError } from './errors';

export function originalHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
export function originalByteLimit(mediaType: string): number {
  return mediaType === 'application/xml' ? MAX_XML_INPUT_BYTES : MAX_INVOICE_UPLOAD_BYTES;
}
export function detectPurchaseContainer(file: Pick<File, 'name' | 'type' | 'size'>, bytes: Buffer): 'application/pdf' | 'application/xml' {
  if (!file.name || file.name.length > 240 || /[\u0000-\u001f\u007f]/.test(file.name)) throw new PurchaseDocumentError('Ungültiger Originaldateiname.');
  const extension = file.name.toLowerCase().match(/\.(pdf|xml)$/)?.[1];
  const mime = file.type.toLowerCase();
  const allowedMimes = extension === 'pdf'
    ? ['', 'application/octet-stream', 'application/pdf']
    : ['', 'application/octet-stream', 'application/xml', 'text/xml'];
  if (!extension || !allowedMimes.includes(mime)) {
    throw new PurchaseDocumentError('Nur PDF- oder XML-Originale werden unterstützt.', 415, 'UNSUPPORTED_FILE');
  }
  const mediaType = extension === 'pdf' ? 'application/pdf' : 'application/xml';
  if (bytes.byteLength === 0 || bytes.byteLength > originalByteLimit(mediaType) || bytes.byteLength !== file.size) {
    throw new PurchaseDocumentError('Datei ist leer oder überschreitet das Größenlimit.', bytes.byteLength === 0 ? 400 : 413, 'FILE_SIZE');
  }
  if (mediaType === 'application/pdf' && bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new PurchaseDocumentError('Dateiinhalt entspricht keinem PDF-Original.', 415, 'UNSUPPORTED_FILE');
  }
  if (mediaType === 'application/xml') {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '').trim(); }
    catch { throw new PurchaseDocumentError('XML muss UTF-8-kodiert sein.', 415, 'UNSUPPORTED_FILE'); }
    if (!text.startsWith('<')) throw new PurchaseDocumentError('Dateiinhalt entspricht keinem XML-Original.', 415, 'UNSUPPORTED_FILE');
  }
  return mediaType;
}
export function safeOriginalFileName(name: string): string {
  return Buffer.from(name, 'utf8').toString('utf8').replace(/[/\\]/g, '_').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 240) || 'Original';
}
/** Strict tenant-only bounded read: never use the legacy shared-root fallback. */
export async function readPurchaseOriginal(document: {
  userId: string; storedFileName: string; mediaType: string; originalSha256: string; originalByteCount: number;
}): Promise<Buffer> {
  const maxBytes = originalByteLimit(document.mediaType);
  if (!Number.isSafeInteger(document.originalByteCount) || document.originalByteCount < 1 || document.originalByteCount > maxBytes) {
    throw new PurchaseDocumentError('Originalintegrität konnte nicht bestätigt werden.', 409, 'ORIGINAL_INTEGRITY');
  }
  try {
    const handle = await open(getTenantUploadPath(document.userId, document.storedFileName), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size !== document.originalByteCount || before.size > maxBytes) throw new Error('integrity');
      // Read only the expected bytes plus one; a growing file cannot allocate unbounded memory.
      const bytes = Buffer.alloc(document.originalByteCount + 1);
      let offset = 0;
      while (offset < bytes.byteLength) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      const after = await handle.stat();
      const result = bytes.subarray(0, offset);
      if (offset !== document.originalByteCount || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || originalHash(result) !== document.originalSha256) throw new Error('integrity');
      return result;
    } finally { await handle.close(); }
  } catch {
    throw new PurchaseDocumentError('Original fehlt oder seine Integrität konnte nicht bestätigt werden.', 409, 'ORIGINAL_INTEGRITY');
  }
}
