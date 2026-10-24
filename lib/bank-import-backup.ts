import { parseBankMappingProfileReference } from '@/lib/bank-mapping-profile-contract';
import type { Prisma } from '@prisma/client';
import { MAX_BANK_CSV_BYTES, MAX_BANK_CSV_FIELD_LENGTH, MAX_BANK_CSV_ROWS, type BankCsvDelimiter, type BankCsvMapping } from '@/lib/bank-csv';
import { BANK_IMPORT_HASH, BANK_IMPORT_MAPPING_VERSION, BANK_IMPORT_PARSER_VERSION, bankImportUuid, parseBankImportMapping, type BankImportEvidence, type BankImportReceipt } from '@/lib/bank-import-contract';
import { bankImportEvidenceHash, bankImportFingerprint, bankImportRowKeys, bankImportTotals } from '@/lib/bank-import-evidence';

type RecordValue = Record<string, unknown>;
export type PortableBankImportBatch = {
  stableKey: string; requestId: string; fingerprint: string; sourceSha256: string; sourceBytes: number;
  parserVersion: typeof BANK_IMPORT_PARSER_VERSION; mappingVersion: typeof BANK_IMPORT_MAPPING_VERSION;
  accountAlias: string; delimiter: BankCsvDelimiter; mapping: BankCsvMapping; receipt: BankImportReceipt; createdAt: string;
};
export type PortableBankImportRow = {
  stableKey: string; batchStableKey: string; sourceRow: number; evidence: BankImportEvidence;
  externalKey: string | null; contentKey: string | null; dayAmountKey: string | null;
};
export type BankImportBackup = { batches: PortableBankImportBatch[]; rows: PortableBankImportRow[] };
const BATCH_FIELDS = ['stableKey', 'requestId', 'fingerprint', 'sourceSha256', 'sourceBytes', 'parserVersion', 'mappingVersion', 'accountAlias', 'delimiter', 'mapping', 'receipt', 'createdAt'];
const ROW_FIELDS = ['stableKey', 'batchStableKey', 'sourceRow', 'evidence', 'externalKey', 'contentKey', 'dayAmountKey'];
const EVIDENCE_FIELDS = ['rowNumber', 'date', 'amountCents', 'currency', 'reference', 'counterparty', 'externalId', 'errors', 'warnings', 'duplicateWarnings', 'duplicate', 'priorMatches'];
const RECEIPT_FIELDS = ['version', 'id', 'requestId', 'savedAt', 'accountAlias', 'sourceSha256', 'sourceBytes', 'parserVersion', 'mappingVersion', 'counts', 'totals', 'period', 'evidenceSha256', 'sameFilePreviouslySaved'];
const MAX_BANK_BACKUP_BATCHES = 10_000;
const MAX_BANK_BACKUP_ROWS = 100_000;
function fail(message: string): never { throw new Error(`Bankimport-Backup: ${message}`); }
function record(value: unknown, fields: readonly string[], label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} muss ein Objekt sein.`);
  const row = value as RecordValue;
  if (Object.keys(row).length !== fields.length || Object.keys(row).some(field => !fields.includes(field))) fail(`${label} enthält fehlende oder unbekannte Felder.`);
  return row;
}
function integer(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail(`${label} ist ungültig.`);
  return value;
}
function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !BANK_IMPORT_HASH.test(value)) fail(`${label} ist ungültig.`);
  return value;
}
function iso(value: unknown, label: string): string {
  const text = value instanceof Date ? value.toISOString() : value;
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString() !== text) fail(`${label} ist ungültig.`);
  return text;
}
function date(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value) || value.startsWith('0000-') || !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) fail(`${label} ist ungültig.`);
  return value;
}
function text(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uFFFD]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) fail(`${label} ist ungültig.`);
  return value;
}
function messages(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string' || !item.length || item.length > 500)) fail(`${label} ist ungültig.`);
  if (new Set(value).size !== value.length) fail(`${label} enthält doppelte Hinweise.`);
  return value;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
}
function same(a: unknown, b: unknown): boolean { return canonical(a) === canonical(b); }
export function readBankImportEvidence(value: unknown): BankImportEvidence {
  const row = record(value, EVIDENCE_FIELDS, 'Zeilenbeleg');
  integer(row.rowNumber, 1, MAX_BANK_CSV_BYTES + 1, 'Quellzeile');
  date(row.date, 'Buchungsdatum');
  if (row.amountCents !== null && (typeof row.amountCents !== 'string' || !/^-?[1-9]\d{0,15}$/u.test(row.amountCents) || BigInt(row.amountCents) > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(row.amountCents) < -BigInt(Number.MAX_SAFE_INTEGER))) fail('Centbetrag ist ungültig.');
  if (row.currency !== null) text(row.currency, MAX_BANK_CSV_FIELD_LENGTH, 'Währung');
  text(row.reference, 2000, 'Referenz'); text(row.counterparty, 255, 'Gegenpartei'); text(row.externalId, 255, 'Externe ID');
  const errors = messages(row.errors, 'Fehler'), warnings = messages(row.warnings, 'Hinweise'), duplicateWarnings = messages(row.duplicateWarnings, 'Dublettenhinweise');
  if (typeof row.duplicate !== 'boolean' || duplicateWarnings.some(message => !warnings.includes(message))) fail('Dublettenhinweise sind inkonsistent.');
  const prior = record(row.priorMatches, ['external', 'content', 'dayAmount'], 'Frühere Treffer');
  for (const field of ['external', 'content', 'dayAmount']) integer(prior[field], 0, Number.MAX_SAFE_INTEGER, 'Frühere Treffer');
  if (row.duplicate !== (duplicateWarnings.length > 0) || (Object.values(prior).some(count => Number(count) > 0) && row.duplicate !== true)) fail('Dublettenstatus benötigt seinen erhaltenen Prüfhinweis.');
  if (errors.length && row.amountCents !== null) fail('Fehlerhafte Zeilen dürfen keinen bestätigten Centbetrag enthalten.');
  if (!errors.length && (!row.date || row.amountCents === null || row.currency !== 'EUR')) fail('Gültige Zeilen benötigen Datum und EUR-Centbetrag.');
  return row as unknown as BankImportEvidence;
}
export function readBankImportReceipt(value: unknown, supportsProfiles = false): BankImportReceipt {
  const hasProfile = value !== null && typeof value === 'object' && Object.hasOwn(value, 'mappingProfile');
  if (hasProfile && !supportsProfiles) fail('Dieses Backupschema unterstützt keine Profilherkunft.');
  const row = record(value, hasProfile ? [...RECEIPT_FIELDS, 'mappingProfile'] : RECEIPT_FIELDS, 'Quittung');
  if (hasProfile) {
    const profile = record(row.mappingProfile, ['id', 'revision', 'name'], 'Profilherkunft');
    parseBankMappingProfileReference({ id: profile.id, revision: profile.revision });
    if (typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > 80 || /[\u0000-\u001f\u007f]/u.test(profile.name)) fail('Historischer Profilname ist ungültig.');
  }
  if (row.version !== 1 || typeof row.sameFilePreviouslySaved !== 'boolean') fail('Quittungsversion ist ungültig.');
  bankImportUuid(row.id); bankImportUuid(row.requestId); iso(row.savedAt, 'Speicherzeit');
  hash(row.sourceSha256, 'Originalhash'); hash(row.evidenceSha256, 'Zeilenbeleghash');
  integer(row.sourceBytes, 1, MAX_BANK_CSV_BYTES, 'Originalgröße');
  text(row.accountAlias, 80, 'Kontoalias');
  if (row.parserVersion !== BANK_IMPORT_PARSER_VERSION || row.mappingVersion !== BANK_IMPORT_MAPPING_VERSION) fail('Quittung benötigt eine bekannte Parser-/Mappingversion.');
  const counts = record(row.counts, ['total', 'valid', 'invalid', 'incoming', 'outgoing', 'duplicates', 'overlapRows'], 'Anzahlkontrollen');
  for (const field of Object.keys(counts)) integer(counts[field], field === 'total' ? 1 : 0, MAX_BANK_CSV_ROWS, 'Anzahlkontrolle');
  const totals = record(row.totals, ['incomingCents', 'outgoingCents', 'netCents'], 'Kontrollsummen');
  for (const field of ['incomingCents', 'outgoingCents', 'netCents']) if (typeof totals[field] !== 'string' || !(field === 'netCents' ? /^(?:0|-?[1-9]\d{0,19})$/u : /^(?:0|[1-9]\d{0,19})$/u).test(totals[field] as string)) fail('Kontrollsumme ist ungültig.');
  const period = record(row.period, ['from', 'to'], 'Zeitraum'); date(period.from, 'Zeitraumbeginn'); date(period.to, 'Zeitraumende');
  return row as unknown as BankImportReceipt;
}

/** Structural integrity only, not a bank signature or proof that an export is authentic. */
export function bankImportsFromBackup(data: RecordValue, supported: boolean, supportsProfiles = false): BankImportBackup {
  if (!supported) {
    if (Object.hasOwn(data, 'bankImportBatches') || Object.hasOwn(data, 'bankImportRows')) fail('Dieses Backupschema unterstützt keine Bankimport-Evidenz.');
    return { batches: [], rows: [] };
  }
  if (!Array.isArray(data.bankImportBatches) || data.bankImportBatches.length > MAX_BANK_BACKUP_BATCHES || !Array.isArray(data.bankImportRows) || data.bankImportRows.length > MAX_BANK_BACKUP_ROWS) fail('Erforderlicher Bankimport-Abschnitt fehlt oder ist zu groß.');
  const stableKeys = new Set<string>(), requestIds = new Set<string>(), fingerprints = new Set<string>();
  const batches: PortableBankImportBatch[] = data.bankImportBatches.map(value => {
    const row = record(value, BATCH_FIELDS, 'Importbatch');
    const stableKey = bankImportUuid(row.stableKey), requestId = bankImportUuid(row.requestId);
    const fingerprint = hash(row.fingerprint, 'Bestätigungsfingerprint'), sourceSha256 = hash(row.sourceSha256, 'Originalhash');
    if (stableKeys.has(stableKey) || requestIds.has(requestId) || fingerprints.has(fingerprint)) fail('Doppelte Batch-, Request- oder Fingerprint-Identität.');
    stableKeys.add(stableKey); requestIds.add(requestId); fingerprints.add(fingerprint);
    integer(row.sourceBytes, 1, MAX_BANK_CSV_BYTES, 'Originalgröße');
    if (row.parserVersion !== BANK_IMPORT_PARSER_VERSION || row.mappingVersion !== BANK_IMPORT_MAPPING_VERSION || ![';', ',', '\t'].includes(String(row.delimiter))) fail('Unbekannte Parser-/Mappingversion oder Trennzeichen.');
    const mapping = parseBankImportMapping(row.mapping);
    if (!mapping.accountAlias || !same(mapping, row.mapping) || row.accountAlias !== mapping.accountAlias || /^[=+@-]/u.test(mapping.accountAlias) || /[\u0000-\u001f\u007f]/u.test(mapping.accountAlias)) fail('Kontoalias oder Mapping ist nicht kanonisch.');
    if (bankImportFingerprint({ sourceSha256, delimiter: row.delimiter as BankCsvDelimiter, mapping, parserVersion: BANK_IMPORT_PARSER_VERSION, mappingVersion: BANK_IMPORT_MAPPING_VERSION }) !== fingerprint) fail('Bestätigungsfingerprint stimmt nicht mit den Quelldaten überein.');
    const active = ['date', 'currency', 'counterparty', 'reference', 'externalId', ...(mapping.amountMode === 'signed' ? ['amount'] : ['credit', 'debit'])] as (keyof BankCsvMapping)[];
    const columns = active.map(field => mapping[field]).filter(column => column !== null);
    if (mapping.date === null || (mapping.amountMode === 'signed' ? mapping.amount === null : mapping.credit === null || mapping.debit === null) || (mapping.currency === null && mapping.defaultCurrency !== 'EUR') || new Set(columns).size !== columns.length) fail('Mapping enthält keine eindeutigen Pflichtspalten.');
    const savedAt = iso(row.createdAt, 'Batchzeit'), checkedReceipt = readBankImportReceipt(row.receipt, supportsProfiles);
    if (checkedReceipt.id !== stableKey || checkedReceipt.requestId !== requestId || checkedReceipt.savedAt !== savedAt || checkedReceipt.accountAlias !== row.accountAlias || checkedReceipt.sourceSha256 !== sourceSha256 || checkedReceipt.sourceBytes !== row.sourceBytes || checkedReceipt.parserVersion !== row.parserVersion || checkedReceipt.mappingVersion !== row.mappingVersion) fail('Quittung stimmt nicht mit ihrem Batch überein.');
    return { ...row, createdAt: savedAt } as PortableBankImportBatch;
  });
  const byBatch = new Map(batches.map(batch => [batch.stableKey, batch]));
  const rowKeys = new Set<string>(), positions = new Set<string>();
  const rows: PortableBankImportRow[] = data.bankImportRows.map(value => {
    const row = record(value, ROW_FIELDS, 'Importzeile');
    const stableKey = bankImportUuid(row.stableKey), batchStableKey = bankImportUuid(row.batchStableKey);
    const batch = byBatch.get(batchStableKey);
    if (!batch) fail('Zeile verweist nicht auf einen enthaltenen Batch.');
    const sourceRow = integer(row.sourceRow, batch.mapping.headerRow + 2, MAX_BANK_CSV_BYTES + 1, 'Quellposition'), checkedEvidence = readBankImportEvidence(row.evidence);
    const position = `${batchStableKey}:${sourceRow}`;
    if (rowKeys.has(stableKey) || positions.has(position) || checkedEvidence.rowNumber !== sourceRow) fail('Doppelte oder widersprüchliche Zeilenidentität.');
    rowKeys.add(stableKey); positions.add(position);
    const keys = bankImportRowKeys(batch.accountAlias, checkedEvidence);
    if ((!keys.externalKey && checkedEvidence.priorMatches.external > 0) || (!keys.contentKey && checkedEvidence.priorMatches.content > 0) || (!keys.dayAmountKey && checkedEvidence.priorMatches.dayAmount > 0)) fail('Frühere Treffer benötigen eine passende Zeilenidentität.');
    for (const field of ['externalKey', 'contentKey', 'dayAmountKey'] as const) {
      if (row[field] !== null) hash(row[field], 'Zeilenfingerprint');
      if (row[field] !== keys[field]) fail('Zeilenfingerprint stimmt nicht mit erhaltenem Beleg überein.');
    }
    return row as unknown as PortableBankImportRow;
  });
  const grouped = new Map<string, PortableBankImportRow[]>();
  for (const row of rows) { const group = grouped.get(row.batchStableKey) ?? []; group.push(row); grouped.set(row.batchStableKey, group); }
  for (const batch of batches) {
    const group = (grouped.get(batch.stableKey) ?? []).sort((a, b) => a.sourceRow - b.sourceRow);
    if (!group.length || group.length > MAX_BANK_CSV_ROWS) fail('Batch benötigt 1 bis 2.000 erhaltene Zeilen.');
    for (const field of ['externalKey', 'contentKey', 'dayAmountKey'] as const) {
      const keyCounts = new Map<string, number>();
      for (const row of group) if (row[field]) keyCounts.set(row[field]!, (keyCounts.get(row[field]!) ?? 0) + 1);
      for (const row of group) if (row[field] && keyCounts.get(row[field]!)! > 1 && !row.evidence.duplicate) fail('Wiederholte Zeilenidentitäten müssen sichtbar zur Prüfung markiert bleiben.');
    }
    const summary = bankImportTotals(group.map(row => row.evidence));
    if (!same(batch.receipt.counts, summary.counts) || !same(batch.receipt.totals, summary.totals) || !same(batch.receipt.period, summary.period) || bankImportEvidenceHash(group) !== batch.receipt.evidenceSha256) fail('Quittungskontrollen oder Zeilenbeleghash sind widersprüchlich.');
  }
  return { batches, rows };
}

/** Target-owned history is immutable even during overwrite; owner fields alone are remapped. */
export async function restoreBankImports(tx: Prisma.TransactionClient, userId: string, graph: BankImportBackup) {
  const counts = { batches: { imported: 0, skipped: 0 }, rows: { imported: 0, skipped: 0 } };
  const grouped = new Map<string, PortableBankImportRow[]>();
  for (const row of graph.rows) { const group = grouped.get(row.batchStableKey) ?? []; group.push(row); grouped.set(row.batchStableKey, group); }
  for (const source of graph.batches) {
    const sourceRows = (grouped.get(source.stableKey) ?? []).sort((a, b) => a.sourceRow - b.sourceRow);
    const candidates = await tx.bankImportBatch.findMany({ where: { userId, OR: [{ stableKey: source.stableKey }, { requestId: source.requestId }, { fingerprint: source.fingerprint }] } });
    const existing = candidates[0];
    if (candidates.length > 1) fail('Ziel enthält kollidierende unveränderliche Batchidentitäten.');
    if (existing) {
      const { id: _id, userId: _owner, ...target } = existing;
      void _id; void _owner;
      if (!same({ ...target, createdAt: existing.createdAt.toISOString() }, source)) fail('Batch-, Request- oder Fingerprint-ID kollidiert mit anderem unveränderlichem Inhalt.');
      const targetRows = (await tx.bankImportRow.findMany({ where: { userId, batchId: existing.id }, orderBy: { sourceRow: 'asc' } })).map(({ id: _rowId, userId: _rowOwner, batchId: _batchId, ...row }) => {
        void _rowId; void _rowOwner; void _batchId;
        return { ...row, batchStableKey: existing.stableKey };
      });
      if (!same(targetRows, sourceRows)) fail('Zeilenidentität oder unveränderlicher Zeilenbeleg kollidiert mit Zielhistorie.');
      counts.batches.skipped++; counts.rows.skipped += sourceRows.length;
      continue;
    }
    const collision = await tx.bankImportRow.count({ where: { userId, stableKey: { in: sourceRows.map(row => row.stableKey) } } });
    if (collision) fail('Zeilen-UUID kollidiert mit einer anderen gespeicherten Importquittung.');
    const { receipt: receiptValue, mapping, createdAt, ...batchValues } = source;
    const imported = await tx.bankImportBatch.create({ data: { ...batchValues, userId, createdAt: new Date(createdAt), mapping: mapping as unknown as Prisma.InputJsonValue, receipt: receiptValue as unknown as Prisma.InputJsonValue } });
    for (const row of sourceRows) {
      const { batchStableKey: _stable, evidence: evidenceValue, ...rowValues } = row; void _stable;
      await tx.bankImportRow.create({ data: { ...rowValues, userId, batchId: imported.id, evidence: evidenceValue as unknown as Prisma.InputJsonValue } });
    }
    counts.batches.imported++; counts.rows.imported += sourceRows.length;
  }
  return counts;
}
