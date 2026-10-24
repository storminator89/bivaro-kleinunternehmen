import 'server-only';
import { createHash } from 'node:crypto';
import { buildBankCsvPreview, parseBankCsv, MAX_BANK_CSV_BYTES, type BankCsvMapping, type BankCsvPreviewRow } from '@/lib/bank-csv';
import { BANK_IMPORT_MAPPING_VERSION, BANK_IMPORT_PARSER_VERSION, BankImportError, bankImportRowLimit, type BankImportEvidence, type BankImportInput } from '@/lib/bank-import-contract';

/** Canonical JSON, not object-insertion order or browser-supplied totals. */
export function bankImportHash(value: unknown): string {
  function canonical(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(canonical);
    if (input !== null && typeof input === 'object') return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, item]) => [key, canonical(item)]));
    return input;
  }
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function bankImportFingerprint(input: { sourceSha256: string; delimiter: string; mapping: BankCsvMapping; parserVersion: string; mappingVersion: string }): string {
  return bankImportHash({ sourceSha256: input.sourceSha256, delimiter: input.delimiter, mapping: input.mapping, parserVersion: input.parserVersion, mappingVersion: input.mappingVersion });
}
export function bankImportRowKeys(accountAlias: string, row: BankImportEvidence) {
  // A bank ID is account-context evidence, NEVER an across-export uniqueness assertion.
  const scope = ['bank-import-row-v1', accountAlias];
  return {
    externalKey: !row.errors.length && row.externalId ? bankImportHash([...scope, 'external', row.externalId]) : null,
    contentKey: row.date && row.amountCents !== null && row.currency === 'EUR' ? bankImportHash([...scope, 'content', row.date, row.amountCents, row.currency, row.counterparty, row.reference, row.externalId]) : null,
    dayAmountKey: row.date && row.amountCents !== null && row.currency === 'EUR' ? bankImportHash([...scope, 'day-amount', row.date, row.amountCents, row.currency]) : null,
  };
}
export function bankImportEvidenceHash(rows: { sourceRow: number; evidence: BankImportEvidence; externalKey: string | null; contentKey: string | null; dayAmountKey: string | null }[]) {
  return bankImportHash(rows.map(({ sourceRow, evidence, externalKey, contentKey, dayAmountKey }) => ({ sourceRow, evidence, externalKey, contentKey, dayAmountKey })).sort((a, b) => a.sourceRow - b.sourceRow));
}
export function bankImportTotals(rows: BankImportEvidence[]) {
  let incoming = BigInt(0), outgoing = BigInt(0), incomingCount = 0, outgoingCount = 0;
  for (const row of rows) if (!row.errors.length && row.currency === 'EUR' && row.amountCents !== null) {
    const amount = BigInt(row.amountCents);
    if (amount > BigInt(0)) { incoming += amount; incomingCount++; }
    if (amount < BigInt(0)) { outgoing -= amount; outgoingCount++; }
  }
  const dates = rows.filter(row => !row.errors.length && row.date !== null).map(row => row.date!).sort();
  const valid = rows.filter(row => !row.errors.length).length;
  return {
    counts: { total: rows.length, valid, invalid: rows.length - valid, incoming: incomingCount, outgoing: outgoingCount, duplicates: rows.filter(row => row.duplicate).length, overlapRows: rows.filter(row => Object.values(row.priorMatches).some(count => count > 0)).length },
    totals: { incomingCents: incoming.toString(), outgoingCents: outgoing.toString(), netCents: (incoming - outgoing).toString() },
    period: { from: dates[0] ?? null, to: dates.at(-1) ?? null },
  };
}
function bounded(value: string, length: number) { return value.slice(0, length).replace(/[\uD800-\uDBFF]$/u, ''); }
function retained(row: BankCsvPreviewRow): BankImportEvidence {
  return { rowNumber: row.rowNumber, date: row.date, amountCents: row.errors.length ? null : row.amountCents, currency: row.currency === null ? null : bounded(row.currency, 16),
    reference: bounded(row.reference, 2000), counterparty: bounded(row.counterparty, 255), externalId: bounded(row.externalId, 255),
    errors: row.errors, warnings: row.warnings, duplicateWarnings: row.duplicateWarnings, duplicate: row.duplicate,
    priorMatches: { external: 0, content: 0, dayAmount: 0 } };
}
export function prepareBankImport(input: BankImportInput) {
  const bytes = Buffer.from(input.originalBase64, 'base64');
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_BANK_CSV_BYTES || bytes.toString('base64') !== input.originalBase64) throw new BankImportError('Ungültige oder zu große Originaldatei.');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new BankImportError('Die Originaldatei ist keine gültige UTF-8-CSV.'); }
  const parsed = parseBankCsv(text, { delimiter: input.delimiter, headerRow: input.mapping.headerRow });
  const preview = buildBankCsvPreview(parsed, input.mapping);
  if (preview.errors.length) throw new BankImportError(preview.errors.join(' '));
  bankImportRowLimit(preview.rows.length);
  const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
  const fingerprint = bankImportFingerprint({ sourceSha256, delimiter: parsed.delimiter, mapping: input.mapping, parserVersion: BANK_IMPORT_PARSER_VERSION, mappingVersion: BANK_IMPORT_MAPPING_VERSION });
  return { sourceSha256, sourceBytes: bytes.byteLength, fingerprint, parsed, rows: preview.rows.map(retained) };
}
