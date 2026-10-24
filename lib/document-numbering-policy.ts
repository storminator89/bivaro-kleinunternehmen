/** Bounded display formats, not programmable templates. Revision zero is the legacy format. */
export const DOCUMENT_TYPES = ['INVOICE', 'QUOTE', 'CREDIT_NOTE'] as const;
export type DocumentType = typeof DOCUMENT_TYPES[number];
export const MAX_DOCUMENT_SEQUENCE = 2_147_483_647;
export const MAX_NUMBERING_REVISIONS = 100;
export type NumberingFormat = { formatVersion: 1; prefix: string; includeYear: boolean; sequenceWidth: number; startSequence: number; effectiveYear: number };
export type NumberingPolicy = NumberingFormat & { type: DocumentType; revision: number };
export type DocumentNumberSelection = { version: 1; type: DocumentType; revision: number; year: number; number: string; automatic: boolean };
export class DocumentNumberingError extends Error {
  constructor(message: string, readonly status = 409, readonly code = 'NUMBERING_CONFLICT') { super(message); }
}
export function isDocumentType(value: unknown): value is DocumentType { return DOCUMENT_TYPES.includes(value as DocumentType); }
export function isNumberingYear(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= 1900 && value <= 9999; }
export function defaultNumberingPolicy(type: DocumentType, year: number): NumberingPolicy {
  return { type, revision: 0, formatVersion: 1, prefix: type === 'QUOTE' ? 'AN-' : type === 'CREDIT_NOTE' ? 'GS-' : '', includeYear: true, sequenceWidth: 2, startSequence: 1, effectiveYear: year };
}
export function validateNumberingFormat(input: unknown): NumberingFormat {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DocumentNumberingError('Ungültiges Nummernformat.', 400);
  const row = input as Record<string, unknown>;
  if (row.formatVersion !== 1 || typeof row.prefix !== 'string' || (row.prefix !== '' && !/^[A-Z][A-Z0-9_-]{0,15}$/.test(row.prefix)) || typeof row.includeYear !== 'boolean' || typeof row.sequenceWidth !== 'number' || !Number.isInteger(row.sequenceWidth) || row.sequenceWidth < 1 || row.sequenceWidth > 10 || typeof row.startSequence !== 'number' || !Number.isInteger(row.startSequence) || row.startSequence < 1 || row.startSequence > MAX_DOCUMENT_SEQUENCE || !isNumberingYear(row.effectiveYear)) {
    throw new DocumentNumberingError('Präfix: leer oder 1–16 Großbuchstaben/Ziffern/-/_, beginnend mit Buchstabe. Breite: 1–10. Startwert: 1–2147483647.', 400);
  }
  return { formatVersion: 1, prefix: row.prefix, includeYear: row.includeYear, sequenceWidth: row.sequenceWidth, startSequence: row.startSequence, effectiveYear: row.effectiveYear };
}
export function numberingPrefix(format: Pick<NumberingFormat, 'prefix' | 'includeYear'>, year: number): string { return `${format.prefix}${format.includeYear ? `${year}-` : ''}`; }
export function formatDocumentNumber(format: NumberingFormat, year: number, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > MAX_DOCUMENT_SEQUENCE) throw new DocumentNumberingError('Nummernzähler ausgeschöpft. Es wurde keine Nummer vergeben.', 422, 'NUMBERING_OVERFLOW');
  return `${numberingPrefix(format, year)}${String(sequence).padStart(format.sequenceWidth, '0')}`;
}
/** Only exact registered formats are understood. Never infer sequences from arbitrary legacy text. */
export function matchDocumentNumber(number: string, format: NumberingFormat): { year: number | null; value: number } | null {
  if (!number.startsWith(format.prefix)) return null;
  let suffix = number.slice(format.prefix.length);
  let year: number | null = null;
  if (format.includeYear) {
    const match = /^(\d{4})-(\d+)$/.exec(suffix);
    if (!match || !isNumberingYear(Number(match[1]))) return null;
    year = Number(match[1]); suffix = match[2];
  }
  if (!/^\d+$/.test(suffix)) return null;
  const significant = suffix.replace(/^0+/, '');
  if (significant.length > 10 || Number(significant) > MAX_DOCUMENT_SEQUENCE) throw new DocumentNumberingError('Ein vorhandener Nummernzähler überschreitet die unterstützte Grenze. Es wurde keine Nummer vergeben.', 422, 'NUMBERING_OVERFLOW');
  const value = Number(significant);
  if (value < 1) return null;
  // Padding is a minimum width, never a truncation. Legacy extra zero padding is safe to recognise.
  return { year, value };
}
export function knownNumberingFormats(type: DocumentType, policies: NumberingPolicy[]): NumberingPolicy[] { return [defaultNumberingPolicy(type, 2000), ...policies.filter(row => row.type === type)]; }
export function documentNumberCounterFloors(invoices: Array<{ type: string; invoiceNumber: string | null }>, policies: NumberingPolicy[]): Array<{ type: DocumentType; year: number; value: number }> {
  const floors = new Map<string, { type: DocumentType; year: number; value: number }>();
  for (const invoice of invoices) {
    if (!isDocumentType(invoice.type) || !invoice.invoiceNumber) continue;
    for (const format of knownNumberingFormats(invoice.type, policies)) {
      const match = matchDocumentNumber(invoice.invoiceNumber, format);
      if (!match) continue;
      // Non-year formats retain a high-water mark under their existing effective-year identity.
      const year = match.year ?? format.effectiveYear;
      const key = `${invoice.type}:${year}`;
      floors.set(key, { type: invoice.type, year, value: Math.max(match.value, floors.get(key)?.value ?? 0) });
    }
  }
  return [...floors.values()];
}

/** Conservative namespace check across the tenant-wide unique document-number key. */
export function numberingNamespacesOverlap(left: NumberingFormat, right: NumberingFormat): boolean {
  if (left.includeYear && right.includeYear) return left.prefix === right.prefix;
  if (!left.includeYear && !right.includeYear) return [left.prefix.slice(right.prefix.length), right.prefix.slice(left.prefix.length)].some((suffix, index) => (index === 0 ? left.prefix.startsWith(right.prefix) : right.prefix.startsWith(left.prefix)) && /^\d*$/.test(suffix));
  const annual = left.includeYear ? left : right;
  const continuous = left.includeYear ? right : left;
  return continuous.prefix.startsWith(annual.prefix) && /^\d{4}-\d*$/.test(continuous.prefix.slice(annual.prefix.length));
}
