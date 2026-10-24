import type { BankAllocationRowEnvelope } from '@/lib/bank-allocation-contract';
import { MAX_BANK_CSV_BYTES, MAX_BANK_CSV_ROWS, type BankCsvDelimiter, type BankCsvMapping, type BankCsvPreviewRow } from '@/lib/bank-csv';

export const BANK_IMPORT_PARSER_VERSION = 'bank-csv-v1';
export const BANK_IMPORT_MAPPING_VERSION = 'bank-csv-mapping-v1';
export const BANK_IMPORT_PAGE_SIZE = 20;
export const BANK_IMPORT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const BANK_IMPORT_HASH = /^[0-9a-f]{64}$/u;
export class BankImportError extends Error {
  constructor(message: string, public readonly status = 400, public readonly existingReceiptId?: string) { super(message); this.name = 'BankImportError'; }
}
export type BankImportInput = { mappingProfile?: { id: string; revision: number }; requestId: string; originalBase64: string; delimiter: BankCsvDelimiter; mapping: BankCsvMapping; parserVersion: typeof BANK_IMPORT_PARSER_VERSION; mappingVersion: typeof BANK_IMPORT_MAPPING_VERSION };
export type BankImportEvidence = Omit<BankCsvPreviewRow, 'fingerprint'> & { priorMatches: { external: number; content: number; dayAmount: number } };
export type BankImportReceipt = {
  mappingProfile?: { id: string; revision: number; name: string };
  version: 1; id: string; requestId: string; savedAt: string; accountAlias: string;
  sourceSha256: string; sourceBytes: number; parserVersion: string; mappingVersion: string;
  counts: { total: number; valid: number; invalid: number; incoming: number; outgoing: number; duplicates: number; overlapRows: number };
  totals: { incomingCents: string; outgoingCents: string; netCents: string };
  period: { from: string | null; to: string | null };
  evidenceSha256: string; sameFilePreviouslySaved: boolean;
};
export type BankImportDetail = { receipt: BankImportReceipt; rows: BankImportEvidence[]; rowEnvelopes?: BankAllocationRowEnvelope[]; assignmentCount?: number; page: number; pages: number };
export function bankImportUuid(value: unknown): string {
  if (typeof value !== 'string' || !BANK_IMPORT_UUID.test(value)) throw new BankImportError('Ungültige Importkennung.');
  return value;
}
export function bankImportPage(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,5})$/u.test(value)) throw new BankImportError('Ungültige Seite.');
  return Number(value);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BankImportError('Ungültige Bankimport-Anfrage.');
  return value as Record<string, unknown>;
}
function closed(value: Record<string, unknown>, fields: readonly string[]) {
  if (Object.keys(value).some(key => !fields.includes(key))) throw new BankImportError('Die Bankimport-Anfrage enthält nicht unterstützte Felder.');
}
export function parseBankImportMapping(value: unknown): BankCsvMapping {
  const input = record(value);
  const columns = ['date', 'amount', 'credit', 'debit', 'currency', 'counterparty', 'reference', 'externalId'] as const;
  closed(input, ['headerRow', ...columns, 'decimalSeparator', 'accountAlias', 'defaultCurrency', 'amountMode']);
  if (!Number.isInteger(input.headerRow) || Number(input.headerRow) < 0 || Number(input.headerRow) > 50
    || ![',', '.'].includes(String(input.decimalSeparator)) || !['signed', 'credit-debit'].includes(String(input.amountMode))
    || typeof input.accountAlias !== 'string' || input.accountAlias.length > 80 || /[\u0000-\u001f\u007f]/u.test(input.accountAlias)
    || (input.defaultCurrency !== undefined && input.defaultCurrency !== 'EUR')) throw new BankImportError('Ungültige Spaltenzuordnung.');
  const mapping: BankCsvMapping = { headerRow: Number(input.headerRow), date: null, amount: null, credit: null, debit: null, currency: null, counterparty: null, reference: null, externalId: null,
    decimalSeparator: input.decimalSeparator as ',' | '.', amountMode: input.amountMode as BankCsvMapping['amountMode'], accountAlias: input.accountAlias.normalize('NFC').trim().replace(/\s+/gu, ' '), ...(input.defaultCurrency === 'EUR' ? { defaultCurrency: 'EUR' as const } : {}) };
  for (const column of columns) {
    const selected = input[column];
    if (selected !== null && (!Number.isInteger(selected) || Number(selected) < 0 || Number(selected) >= 64)) throw new BankImportError('Ungültige Spaltenzuordnung.');
    mapping[column] = selected as number | null;
  }
  return mapping;
}
export function parseBankImportInput(value: unknown): BankImportInput {
  const input = record(value);
  closed(input, ['requestId', 'originalBase64', 'delimiter', 'mapping', 'parserVersion', 'mappingVersion', 'reviewed', 'mappingProfile']);
  if (input.reviewed !== true) throw new BankImportError('Bitte die Vorschau ausdrücklich bestätigen.');
  if (input.parserVersion !== BANK_IMPORT_PARSER_VERSION || input.mappingVersion !== BANK_IMPORT_MAPPING_VERSION) throw new BankImportError('Die Vorschauversion hat sich geändert. Bitte Datei erneut prüfen.', 409);
  if (typeof input.originalBase64 !== 'string' || !input.originalBase64.length || input.originalBase64.length > Math.ceil(MAX_BANK_CSV_BYTES / 3) * 4
    || input.originalBase64.length % 4 !== 0 || (input.originalBase64.length / 4 * 3 - (input.originalBase64.endsWith('==') ? 2 : input.originalBase64.endsWith('=') ? 1 : 0)) > MAX_BANK_CSV_BYTES || /[^A-Za-z0-9+/]/u.test(input.originalBase64.replace(/={1,2}$/u, ''))) throw new BankImportError('Ungültige oder zu große Originaldatei.');
  if (![';', ',', '\t'].includes(String(input.delimiter))) throw new BankImportError('Ungültiges Trennzeichen.');
  let mappingProfile: BankImportInput['mappingProfile'];
  if (input.mappingProfile !== undefined) {
    const profile = record(input.mappingProfile); closed(profile, ['id', 'revision']);
    if (!Number.isSafeInteger(profile.revision) || Number(profile.revision) < 1 || Number(profile.revision) > 200) throw new BankImportError('Ungültige Profilrevision.');
    mappingProfile = { id: bankImportUuid(profile.id), revision: Number(profile.revision) };
  }
  return { ...(mappingProfile ? { mappingProfile } : {}), requestId: bankImportUuid(input.requestId), originalBase64: input.originalBase64, delimiter: input.delimiter as BankCsvDelimiter, mapping: parseBankImportMapping(input.mapping), parserVersion: BANK_IMPORT_PARSER_VERSION, mappingVersion: BANK_IMPORT_MAPPING_VERSION };
}
export function bankImportRowLimit(count: number) { if (!Number.isInteger(count) || count < 1 || count > MAX_BANK_CSV_ROWS) throw new BankImportError('Die Datei muss 1 bis 2.000 Umsatzzeilen enthalten.'); }
