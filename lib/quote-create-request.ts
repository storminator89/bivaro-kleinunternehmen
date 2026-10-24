import { createHash } from 'node:crypto';
import { DocumentNumberingError } from '@/lib/document-numbering-policy';
export const QUOTE_CREATE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function quoteCreateRequestId(input: unknown): string | null {
  if (input == null || input === '') return null;
  if (typeof input !== 'string' || !QUOTE_CREATE_UUID.test(input)) throw new DocumentNumberingError('Ungültige Angebotsanfrage-ID.', 400, 'INVALID_QUOTE_REQUEST');
  return input.toLowerCase();
}
/** Identity covers semantic render inputs; a replay never replaces the original stored PDF. */
export function quoteCreateFingerprint(input: Record<string, unknown>): string {
  let nodes = 0;
  function canonical(value: unknown, depth: number): unknown {
    if (++nodes > 20_000 || depth > 32) throw new DocumentNumberingError('Angebotsdaten sind für eine sichere Wiederholung zu komplex.', 400, 'INVALID_QUOTE_REQUEST');
    if (Array.isArray(value)) return value.map(item => canonical(item, depth + 1));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => [key, canonical(item, depth + 1)]));
    return value;
  }
  return createHash('sha256').update('bivaro:quote-create:v1\0').update(JSON.stringify(canonical(input, 0))).digest('hex');
}
/** Portable source identity excludes database-local customer IDs and stored filenames. */
export function quoteCreateFingerprintForInvoice(input: Record<string, unknown>): string {
  const date = input.invoiceDate instanceof Date ? input.invoiceDate : typeof input.invoiceDate === 'string' ? new Date(input.invoiceDate) : null;
  const until = input.validUntil == null ? null : input.validUntil instanceof Date ? input.validUntil : typeof input.validUntil === 'string' ? new Date(input.validUntil) : null;
  if (typeof input.fileName !== 'string' || (input.invoiceNumber !== null && typeof input.invoiceNumber !== 'string') || !date || !Number.isFinite(date.getTime()) || (input.validUntil != null && (!until || !Number.isFinite(until.getTime()))) || (input.totalAmount !== null && (typeof input.totalAmount !== 'number' || !Number.isFinite(input.totalAmount))) || !input.parsedData || typeof input.parsedData !== 'object') throw new DocumentNumberingError('Ungültige Quelldaten der Angebotsanfrage.', 400, 'INVALID_QUOTE_REQUEST');
  return quoteCreateFingerprint({ fileName: input.fileName, quoteNumber: input.invoiceNumber, quoteDate: date.toISOString(), validUntil: until?.toISOString() ?? null, totalAmount: input.totalAmount, parsedData: input.parsedData });
}

export function quoteCreatePdfSha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
