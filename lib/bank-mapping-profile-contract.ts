import { BANK_IMPORT_MAPPING_VERSION, BANK_IMPORT_PARSER_VERSION, BankImportError, bankImportUuid, parseBankImportMapping } from './bank-import-contract';
import { buildBankCsvPreview, type BankCsvDelimiter, type BankCsvMapping, type BankCsvParsed } from './bank-csv';

export const BANK_MAPPING_PROFILE_VERSION = 1;
export const BANK_MAPPING_PROFILE_LIMIT = 100;
export const BANK_MAPPING_PROFILE_REVISION_LIMIT = 200;
export const BANK_MAPPING_COLUMNS = ['date', 'amount', 'credit', 'debit', 'currency', 'counterparty', 'reference', 'externalId'] as const;
export type BankMappingProfileReference = { id: string; revision: number };
export type BankMappingProfileConfiguration = {
  version: 1; name: string; parserVersion: typeof BANK_IMPORT_PARSER_VERSION; mappingVersion: typeof BANK_IMPORT_MAPPING_VERSION;
  delimiter: BankCsvDelimiter; mapping: BankCsvMapping; headerHashes: string[];
};
export type BankMappingProfile = BankMappingProfileReference & { latestRevision: number; configuration: BankMappingProfileConfiguration };
export type BankMappingProfileSummary = BankMappingProfileReference & { name: string; accountAlias: string };
export type BankMappingProfileMutation = { id: string; mutationId: string; expectedRevision: number; configuration: BankMappingProfileConfiguration };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BankImportError('Ungültiges Zuordnungsprofil.');
  return value as Record<string, unknown>;
}
function closed(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new BankImportError('Das Profil enthält nicht unterstützte Felder. Bankdaten gehören nicht in ein Profil.');
}
export function bankMappingProfileRevision(value: unknown, allowZero = false): number {
  if (!Number.isSafeInteger(value) || Number(value) < (allowZero ? 0 : 1) || Number(value) > BANK_MAPPING_PROFILE_REVISION_LIMIT) throw new BankImportError('Ungültige Profilrevision.');
  return Number(value);
}
export function parseBankMappingProfileReference(value: unknown): BankMappingProfileReference {
  const input = object(value); closed(input, ['id', 'revision']);
  return { id: bankImportUuid(input.id), revision: bankMappingProfileRevision(input.revision) };
}
export function parseBankMappingProfileConfiguration(value: unknown): BankMappingProfileConfiguration {
  const input = object(value); closed(input, ['version', 'name', 'parserVersion', 'mappingVersion', 'delimiter', 'mapping', 'headerHashes']);
  if (input.version !== BANK_MAPPING_PROFILE_VERSION || input.parserVersion !== BANK_IMPORT_PARSER_VERSION || input.mappingVersion !== BANK_IMPORT_MAPPING_VERSION) throw new BankImportError('Diese Profilversion wird nicht unterstützt. Bitte die Zuordnung neu prüfen.', 409);
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80 || /[\u0000-\u001f\u007f]/u.test(input.name) || ![';', ',', '\t'].includes(String(input.delimiter))) throw new BankImportError('Bitte Profilname und gültigen Trenner angeben.');
  const mapping = parseBankImportMapping(input.mapping);
  if (!mapping.accountAlias) throw new BankImportError('Bitte einen Kontoalias angeben.');
  if (!Array.isArray(input.headerHashes) || input.headerHashes.length < 2 || input.headerHashes.length > 64 || input.headerHashes.some(hash => typeof hash !== 'string' || !/^[0-9a-f]{64}$/u.test(hash)) || new Set(input.headerHashes).size !== input.headerHashes.length) throw new BankImportError('Das Profil benötigt eindeutige, nicht leere Überschriften.');
  const headerHashes = input.headerHashes as string[];
  const selected = BANK_MAPPING_COLUMNS.map(key => mapping[key]).filter((value): value is number => value !== null);
  if (selected.some(index => index >= headerHashes.length) || new Set(selected).size !== selected.length || mapping.date === null || (mapping.amountMode === 'signed' ? mapping.amount === null : mapping.credit === null || mapping.debit === null) || (mapping.currency === null && mapping.defaultCurrency !== 'EUR')) throw new BankImportError('Bitte zuerst die vollständige Spaltenzuordnung und Währung prüfen.');
  return { version: 1, name: input.name.normalize('NFC').trim(), parserVersion: BANK_IMPORT_PARSER_VERSION, mappingVersion: BANK_IMPORT_MAPPING_VERSION, delimiter: input.delimiter as BankCsvDelimiter, mapping, headerHashes: [...headerHashes] };
}
export function parseBankMappingProfileMutation(value: unknown): BankMappingProfileMutation {
  const input = object(value); closed(input, ['id', 'mutationId', 'expectedRevision', 'configuration']);
  return { id: bankImportUuid(input.id), mutationId: bankImportUuid(input.mutationId), expectedRevision: bankMappingProfileRevision(input.expectedRevision, true), configuration: parseBankMappingProfileConfiguration(input.configuration) };
}
export function parseBankMappingProfileDelete(value: unknown) {
  const input = object(value); closed(input, ['id', 'mutationId', 'expectedRevision']);
  return { id: bankImportUuid(input.id), mutationId: bankImportUuid(input.mutationId), expectedRevision: bankMappingProfileRevision(input.expectedRevision) };
}
/** Only header structure is hashed. Neither transaction rows nor sample values are accepted. */
export async function bankMappingHeaderHashes(headers: string[]): Promise<string[]> {
  const normalized = headers.map(value => value.normalize('NFC').trim());
  // A headerless export's leading date/amount must never become reusable structure.
  if (normalized.length < 2 || normalized.length > 64 || normalized.some(value => !value || !/\p{L}/u.test(value) || /^\d{1,4}[.\/-]\d{1,2}[.\/-]\d{1,4}(?:\s|$)/u.test(value)) || new Set(normalized.map(value => value.toLocaleLowerCase('de-DE'))).size !== normalized.length) throw new BankImportError('Keine eindeutige Kopfzeile erkannt. Für Profile sind benannte, eindeutige Überschriften erforderlich; Dateien ohne Kopfzeile bitte nicht als Profil speichern.');
  return Promise.all(normalized.map(async value => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`bivaro-bank-header-v1:${value}`));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }));
}
export async function applyBankMappingProfile(configuration: BankMappingProfileConfiguration, parsed: BankCsvParsed): Promise<{ mapping: BankCsvMapping; matches: boolean }> {
  const config = parseBankMappingProfileConfiguration(configuration);
  let hashes: string[] = [];
  try { hashes = await bankMappingHeaderHashes(parsed.headers); } catch { /* Ambiguous or missing headers invalidate every role. */ }
  const matches = parsed.delimiter === config.delimiter && parsed.skippedLines === config.mapping.headerRow && JSON.stringify(hashes) === JSON.stringify(config.headerHashes);
  const mapping = { ...config.mapping };
  if (!matches) {
    for (const key of BANK_MAPPING_COLUMNS) mapping[key] = null;
    delete mapping.defaultCurrency;
  }
  return { mapping, matches };
}
export async function createBankMappingProfileConfiguration(name: string, mapping: BankCsvMapping, parsed: BankCsvParsed): Promise<BankMappingProfileConfiguration> {
  const preview = buildBankCsvPreview(parsed, mapping);
  if (preview.errors.length) throw new BankImportError(preview.errors.join(' '));
  return parseBankMappingProfileConfiguration({ version: 1, name, parserVersion: BANK_IMPORT_PARSER_VERSION, mappingVersion: BANK_IMPORT_MAPPING_VERSION, delimiter: parsed.delimiter, mapping, headerHashes: await bankMappingHeaderHashes(parsed.headers) });
}
