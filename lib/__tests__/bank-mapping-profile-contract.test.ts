import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { inferBankCsvMapping, parseBankCsv, buildBankCsvPreview } from '@/lib/bank-csv';
import { BANK_IMPORT_MAPPING_VERSION, BANK_IMPORT_PARSER_VERSION, parseBankImportInput } from '@/lib/bank-import-contract';
import { applyBankMappingProfile, bankMappingHeaderHashes, createBankMappingProfileConfiguration, parseBankMappingProfileConfiguration, parseBankMappingProfileMutation } from '@/lib/bank-mapping-profile-contract';
const source = 'Datum;Betrag;Währung;Verwendungszweck\n24.10.2026;12,34;EUR;Nicht im Profil speichern';
const parsed = parseBankCsv(source);
const mapping = { ...inferBankCsvMapping(parsed.headers), accountAlias: 'Geschäftskonto' };
const configuration = () => createBankMappingProfileConfiguration('Bankexport', mapping, parsed);
describe('versioned bank mapping configuration only', () => {
  it('stores strict mapping plus ordered header digests, never headers, rows, references or file contents', async () => {
    const value = await configuration();
    expect(value).toMatchObject({ version: 1, name: 'Bankexport', parserVersion: BANK_IMPORT_PARSER_VERSION, mappingVersion: BANK_IMPORT_MAPPING_VERSION, delimiter: ';', mapping });
    expect(value.headerHashes).toHaveLength(4);
    expect(JSON.stringify(value)).not.toMatch(/Nicht im Profil|Datum|Währung|Verwendungszweck|12,34|24\.10/);
    expect(() => parseBankMappingProfileConfiguration({ ...value, rows: parsed.rows })).toThrow('Bankdaten');
    expect(() => parseBankMappingProfileConfiguration({ ...value, originalBase64: 'anything' })).toThrow();
    expect(() => parseBankMappingProfileConfiguration({ ...value, headerHashes: ['Datum', 'Betrag'] })).toThrow();
  });
  it('loads identical structure only and always recomputes amounts from new rows', async () => {
    const config = await configuration(), other = parseBankCsv(source.replace('12,34', '0,01'));
    const result = await applyBankMappingProfile(config, other);
    expect(result.matches).toBe(true); expect(result.mapping).toEqual(mapping);
    expect(buildBankCsvPreview(other, result.mapping).totals.incomingCents).toBe('1');
    expect(buildBankCsvPreview(parsed, result.mapping).totals.incomingCents).toBe('1234');
  });
  it.each([
    ['shifted', 'Betrag;Datum;Währung;Verwendungszweck\n12,34;24.10.2026;EUR;Text'],
    ['renamed', 'Buchungsdatum;Betrag;Währung;Verwendungszweck\n24.10.2026;12,34;EUR;Text'],
    ['duplicated', 'Datum;Betrag;Währung;Betrag\n24.10.2026;12,34;EUR;Text'],
    ['blank', ';Betrag;Währung;Verwendungszweck\n24.10.2026;12,34;EUR;Text'],
    ['wrong delimiter', 'Datum,Betrag,Währung,Verwendungszweck\n24.10.2026,12.34,EUR,Text'],
  ])('invalidates all roles for %s layout; no silent reordering', async (_, csv) => {
    const result = await applyBankMappingProfile(await configuration(), parseBankCsv(csv));
    expect(result.matches).toBe(false);
    for (const key of ['date', 'amount', 'credit', 'debit', 'currency', 'reference', 'counterparty', 'externalId'] as const) expect(result.mapping[key]).toBeNull();
    expect(result.mapping.defaultCurrency).toBeUndefined();
    expect(buildBankCsvPreview(parseBankCsv(csv), result.mapping).errors.length).toBeGreaterThan(0);
  });
  it('rejects no-header exports, duplicated names, empty/numeric columns and unknown parser/schema versions', async () => {
    await expect(bankMappingHeaderHashes(['24.10.2026', '12,34', 'EUR', 'Confidential data'])).rejects.toThrow('Kopfzeile');
    await expect(bankMappingHeaderHashes(['Datum', 'Datum'])).rejects.toThrow();
    await expect(bankMappingHeaderHashes(['Datum', ''])).rejects.toThrow();
    const config = await configuration();
    expect(() => parseBankMappingProfileConfiguration({ ...config, version: 2 })).toThrow();
    expect(() => parseBankMappingProfileConfiguration({ ...config, parserVersion: 'future' })).toThrow();
    expect(() => parseBankMappingProfileConfiguration({ ...config, mapping: { ...mapping, reference: 60 } })).toThrow();
  });
  it('keeps Soll/Haben roles exact and detects swapped header labels', async () => {
    const table = parseBankCsv('Datum;Haben;Soll;Währung\n24.10.2026;10,00;;EUR\n24.10.2026;;2,00;EUR');
    const roles = { ...inferBankCsvMapping(table.headers), accountAlias: 'Geschäftskonto', amountMode: 'credit-debit' as const, amount: null, credit: 1, debit: 2 };
    const config = await createBankMappingProfileConfiguration('Soll und Haben', roles, table);
    expect(buildBankCsvPreview(table, (await applyBankMappingProfile(config, table)).mapping).totals).toEqual({ incomingCents: '1000', outgoingCents: '200', netCents: '800' });
    expect((await applyBankMappingProfile(config, { ...table, headers: ['Datum', 'Soll', 'Haben', 'Währung'] })).matches).toBe(false);
  });
  it('requires explicit EUR default and distinct complete roles; freezes mutation/revision identity', async () => {
    const config = await configuration();
    expect(() => parseBankMappingProfileConfiguration({ ...config, mapping: { ...mapping, currency: null } })).toThrow();
    expect(parseBankMappingProfileConfiguration({ ...config, mapping: { ...mapping, currency: null, defaultCurrency: 'EUR' } }).mapping.defaultCurrency).toBe('EUR');
    expect(() => parseBankMappingProfileConfiguration({ ...config, mapping: { ...mapping, date: mapping.amount } })).toThrow();
    const payload = { id: randomUUID(), mutationId: randomUUID(), expectedRevision: 1, configuration: config };
    expect(parseBankMappingProfileMutation(payload)).toEqual(payload);
    expect(() => parseBankMappingProfileMutation({ ...payload, expectedRevision: -1 })).toThrow();
  });
  it('adds separate bounded profile provenance without changing import mappingVersion', () => {
    const input = { requestId: randomUUID(), originalBase64: Buffer.from(source).toString('base64'), delimiter: ';', mapping, parserVersion: BANK_IMPORT_PARSER_VERSION, mappingVersion: BANK_IMPORT_MAPPING_VERSION, reviewed: true };
    const ref = { id: randomUUID(), revision: 2 };
    expect(parseBankImportInput({ ...input, mappingProfile: ref }).mappingProfile).toEqual(ref);
    expect(parseBankImportInput(input)).not.toHaveProperty('mappingProfile');
    expect(() => parseBankImportInput({ ...input, mappingProfile: { ...ref, name: 'not trusted' } })).toThrow();
    expect(() => parseBankImportInput({ ...input, mappingProfile: { ...ref, revision: 201 } })).toThrow();
  });
});
