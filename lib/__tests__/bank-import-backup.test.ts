import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { inferBankCsvMapping, parseBankCsv } from '@/lib/bank-csv';
import { BANK_IMPORT_MAPPING_VERSION, BANK_IMPORT_PARSER_VERSION, type BankImportReceipt } from '@/lib/bank-import-contract';
import { bankImportEvidenceHash, bankImportRowKeys, bankImportTotals, prepareBankImport } from '@/lib/bank-import-evidence';
import { bankImportsFromBackup, type PortableBankImportBatch, type PortableBankImportRow } from '@/lib/bank-import-backup';
import { BACKUP_FEATURE_CAPABILITIES, BANK_IMPORT_EVIDENCE_SCHEMA_VERSION, PAYMENT_BANK_IMPORT_SCHEMA_VERSION, PROJECT_OUTBOX_VALIDATION_SCHEMA_VERSION, backupSchemaSupportsBankImportEvidence } from '@/lib/backup-manifest';

function fixture(csv = 'Datum;Betrag;Währung;Verwendungszweck;Umsatz-ID\n21.10.2026;12,34;EUR;synthetisch;id-a\n21.10.2026;-0,29;EUR;synthetisch;id-b\n21.10.2026;2,00;USD;synthetisch;id-c') {
  const mapping = { ...inferBankCsvMapping(parseBankCsv(csv).headers), accountAlias: 'Synthetisches Konto' };
  const requestId = randomUUID(), stableKey = randomUUID(), createdAt = '2026-10-22T00:00:00.000Z';
  const prepared = prepareBankImport({ requestId, originalBase64: Buffer.from(csv).toString('base64'), delimiter: ';', mapping, parserVersion: BANK_IMPORT_PARSER_VERSION, mappingVersion: BANK_IMPORT_MAPPING_VERSION });
  const rows: PortableBankImportRow[] = prepared.rows.map(evidence => ({ stableKey: randomUUID(), batchStableKey: stableKey, sourceRow: evidence.rowNumber, evidence, ...bankImportRowKeys(mapping.accountAlias, evidence) }));
  const receipt: BankImportReceipt = { version: 1, id: stableKey, requestId, savedAt: createdAt, accountAlias: mapping.accountAlias, sourceSha256: prepared.sourceSha256, sourceBytes: prepared.sourceBytes, parserVersion: BANK_IMPORT_PARSER_VERSION, mappingVersion: BANK_IMPORT_MAPPING_VERSION, ...bankImportTotals(prepared.rows), evidenceSha256: bankImportEvidenceHash(rows), sameFilePreviouslySaved: false };
  const batch: PortableBankImportBatch = { stableKey, requestId, fingerprint: prepared.fingerprint, sourceSha256: prepared.sourceSha256, sourceBytes: prepared.sourceBytes, parserVersion: BANK_IMPORT_PARSER_VERSION, mappingVersion: BANK_IMPORT_MAPPING_VERSION, accountAlias: mapping.accountAlias, delimiter: ';', mapping, receipt, createdAt };
  return { bankImportBatches: [batch], bankImportRows: rows };
}

describe('portable immutable bank evidence boundary', () => {
  it('adds an exact capability without changing the accepted triple identity', () => {
    expect(BANK_IMPORT_EVIDENCE_SCHEMA_VERSION).toBe('20261022050000_add_bank_import_evidence');
    expect(PAYMENT_BANK_IMPORT_SCHEMA_VERSION).toBe('20261022060000_combine_payment_terms_bank_import_evidence');
    expect(backupSchemaSupportsBankImportEvidence(PAYMENT_BANK_IMPORT_SCHEMA_VERSION)).toBe(true);
    expect(backupSchemaSupportsBankImportEvidence(PROJECT_OUTBOX_VALIDATION_SCHEMA_VERSION)).toBe(false);
    expect(backupSchemaSupportsBankImportEvidence('20991231000000_unknown')).toBe(false);
    expect({ ...BACKUP_FEATURE_CAPABILITIES[BANK_IMPORT_EVIDENCE_SCHEMA_VERSION], bankImportEvidence: false }).toEqual(BACKUP_FEATURE_CAPABILITIES[PROJECT_OUTBOX_VALIDATION_SCHEMA_VERSION]);
    expect(BACKUP_FEATURE_CAPABILITIES[PROJECT_OUTBOX_VALIDATION_SCHEMA_VERSION]).toMatchObject({ projectServiceTimes: true, emailOutbox: true, purchaseValidationReports: true });
  });
  it('requires both new arrays and rejects even empty future sections in older schemas', () => {
    expect(bankImportsFromBackup({}, false)).toEqual({ batches: [], rows: [] });
    expect(() => bankImportsFromBackup({ bankImportBatches: [] }, false)).toThrow(/Backupschema/);
    expect(() => bankImportsFromBackup({ bankImportRows: [] }, false)).toThrow(/Backupschema/);
    expect(() => bankImportsFromBackup({}, true)).toThrow(/Abschnitt/);
    expect(() => bankImportsFromBackup({ bankImportBatches: [], bankImportRows: null }, true)).toThrow(/Abschnitt/);
    expect(bankImportsFromBackup({ bankImportBatches: [], bankImportRows: [] }, true)).toEqual({ batches: [], rows: [] });
  });
  it('retains exact integer EUR controls and invalid FX rows without amounts', () => {
    const input = fixture(), graph = bankImportsFromBackup(input, true);
    expect(graph.batches[0].receipt.totals).toEqual({ incomingCents: '1234', outgoingCents: '29', netCents: '1205' });
    expect(graph.batches[0].receipt.counts).toMatchObject({ total: 3, valid: 2, invalid: 1 });
    expect(graph.rows[2].evidence).toMatchObject({ amountCents: null, currency: 'USD' });
    expect(graph.batches[0].receipt.period).toEqual({ from: '2026-10-21', to: '2026-10-21' });
  });
  it('preserves two true identical transactions as separate source-position identities', () => {
    const input = fixture('Datum;Betrag;Währung;Verwendungszweck\n21.10.2026;12,34;EUR;synthetisch\n21.10.2026;12,34;EUR;synthetisch');
    const graph = bankImportsFromBackup(input, true);
    expect(graph.rows).toHaveLength(2);
    expect(new Set(graph.rows.map(row => row.stableKey)).size).toBe(2);
    expect(graph.batches[0].receipt.totals.incomingCents).toBe('2468');
    expect(graph.batches[0].receipt.counts.duplicates).toBe(2);
  });
  it.each([
    (data: ReturnType<typeof fixture>) => { data.bankImportBatches[0].sourceSha256 = '0'.repeat(64); },
    (data: ReturnType<typeof fixture>) => { data.bankImportBatches[0].receipt.totals.netCents = '1206'; },
    (data: ReturnType<typeof fixture>) => { data.bankImportBatches[0].receipt.counts.total = 2; },
    (data: ReturnType<typeof fixture>) => { data.bankImportBatches[0].receipt.period.to = '2026-10-22'; },
    (data: ReturnType<typeof fixture>) => { data.bankImportBatches[0].mapping.accountAlias = 'Anderes Konto'; },
    (data: ReturnType<typeof fixture>) => { data.bankImportRows[0].evidence.reference = 'geändert'; },
    (data: ReturnType<typeof fixture>) => { data.bankImportRows[2].evidence.amountCents = '200'; },
    (data: ReturnType<typeof fixture>) => { data.bankImportRows[0].sourceRow = 1; },
    (data: ReturnType<typeof fixture>) => { data.bankImportRows[0].batchStableKey = randomUUID(); },
    (data: ReturnType<typeof fixture>) => { data.bankImportRows[0].externalKey = 'f'.repeat(64); },
    (data: ReturnType<typeof fixture>) => { data.bankImportRows.pop(); },
    (data: ReturnType<typeof fixture>) => { data.bankImportRows.push(structuredClone(data.bankImportRows[0])); },
    (data: ReturnType<typeof fixture>) => { data.bankImportBatches.push(structuredClone(data.bankImportBatches[0])); },
    (data: ReturnType<typeof fixture>) => { (data.bankImportRows[0] as unknown as Record<string, unknown>).userId = 'another-owner'; },
    (data: ReturnType<typeof fixture>) => { (data.bankImportBatches[0] as unknown as Record<string, unknown>).originalBase64 = 'forbidden'; },
  ])('rejects graph tampering, ambiguous identities and unbounded fields %#', mutate => {
    const input = fixture(); mutate(input);
    expect(() => bankImportsFromBackup(input, true)).toThrow();
  });
  it('does not recompute import-time overlap warnings from later history', () => {
    const input = fixture();
    input.bankImportRows[0].evidence.priorMatches = { external: 7, content: 4, dayAmount: 9 };
    input.bankImportRows[0].evidence.duplicate = true;
    input.bankImportRows[0].evidence.warnings.push('Historischer synthetischer Überschneidungshinweis.');
    input.bankImportRows[0].evidence.duplicateWarnings.push('Historischer synthetischer Überschneidungshinweis.');
    input.bankImportBatches[0].receipt = { ...input.bankImportBatches[0].receipt, ...bankImportTotals(input.bankImportRows.map(row => row.evidence)), evidenceSha256: bankImportEvidenceHash(input.bankImportRows), sameFilePreviouslySaved: true };
    expect(bankImportsFromBackup(input, true).rows[0].evidence.priorMatches).toEqual({ external: 7, content: 4, dayAmount: 9 });
  });
});
