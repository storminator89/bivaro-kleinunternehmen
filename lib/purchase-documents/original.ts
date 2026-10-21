import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getTenantUploadPath } from '@/lib/upload-path';
import { MAX_INVOICE_UPLOAD_BYTES, MAX_XML_INPUT_BYTES, MAX_RECEIPT_UPLOAD_BYTES } from '@/lib/resource-limits';
import type { PurchaseMediaType } from './types';
import { PurchaseDocumentError } from './errors';

export function originalHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
export function originalByteLimit(mediaType: string): number {
  return mediaType === 'application/xml' ? MAX_XML_INPUT_BYTES : mediaType.startsWith('image/') ? MAX_RECEIPT_UPLOAD_BYTES : MAX_INVOICE_UPLOAD_BYTES;
}
export function purchaseOriginalName(mediaType: string): string {
  return mediaType === 'image/jpeg' ? 'original.jpg' : mediaType === 'image/png' ? 'original.png' : mediaType === 'application/pdf' ? 'original.pdf' : 'original.xml';
}
export async function detectPurchaseContainer(file: Pick<File, 'name' | 'type' | 'size'>, bytes: Buffer): Promise<PurchaseMediaType> {
  if (!file.name || file.name.length > 240 || /[\u0000-\u001f\u007f]/.test(file.name)) throw new PurchaseDocumentError('Ungültiger Originaldateiname.');
  const extension = file.name.toLowerCase().match(/\.(pdf|xml|jpg|jpeg|png)$/)?.[1];
  const mime = file.type.toLowerCase();
  const imageType = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'png' ? 'image/png' : null;
  const allowedMimes = imageType ? ['', 'application/octet-stream', imageType] : extension === 'pdf'
    ? ['', 'application/octet-stream', 'application/pdf']
    : ['', 'application/octet-stream', 'application/xml', 'text/xml'];
  if (!extension || !allowedMimes.includes(mime)) {
    throw new PurchaseDocumentError('Nur JPG-, PNG-, PDF- oder XML-Originale werden unterstützt.', 415, 'UNSUPPORTED_FILE');
  }
  const mediaType: PurchaseMediaType = imageType ?? (extension === 'pdf' ? 'application/pdf' : 'application/xml');
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
  if (imageType) {
    const signature = imageType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!signature) throw new PurchaseDocumentError('Dateiinhalt entspricht keinem unterstützten Foto.', 415, 'UNSUPPORTED_FILE');
    try {
      if (imageType === 'image/png') {
        // Reject APNG explicitly, including decoders which would otherwise expose only its first frame.
        let offset = 8; let chunks = 0;
        while (offset + 12 <= bytes.length) {
          if (++chunks > 10_000) throw new Error('chunk-limit');
          const length = bytes.readUInt32BE(offset);
          const type = bytes.toString('ascii', offset + 4, offset + 8);
          if (length > bytes.length - offset - 12 || type === 'acTL') throw new Error('animated-or-truncated');
          offset += 12 + length;
          if (type === 'IEND') break;
        }
      }
      const { default: sharp } = await import('sharp');
      const image = sharp(bytes, { limitInputPixels: 24_000_000, failOn: 'warning', sequentialRead: true });
      const metadata = await image.metadata();
      if (metadata.format !== (imageType === 'image/jpeg' ? 'jpeg' : 'png') || !metadata.width || !metadata.height || metadata.width > 12_000 || metadata.height > 12_000 || (metadata.pages ?? 1) !== 1) throw new Error('limits');
      // Decode under the same pixel budget. Output is discarded: original bytes stay immutable.
      await image.stats();
    } catch { throw new PurchaseDocumentError('Foto ist beschädigt oder überschreitet 24 Megapixel / 12.000 Pixel Kantenlänge. Nur einseitige JPG/PNG-Fotos sind möglich.', 415, 'INVALID_IMAGE'); }
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
