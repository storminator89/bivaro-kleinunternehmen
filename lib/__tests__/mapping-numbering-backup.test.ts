import { randomUUID } from 'node:crypto';
import { QUOTE_RELEASE_BACKUP_SCHEMA_VERSION } from '@/lib/backup-schema-identities';
import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { BACKUP_FEATURE_CAPABILITIES, BANK_MAPPING_PROFILES_SCHEMA_VERSION, BANK_PAYMENT_ALLOCATIONS_SCHEMA_VERSION, MAPPING_NUMBERING_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION, DOCUMENT_NUMBERING_POLICIES_SCHEMA_VERSION, backupSchemaSupportsBankMappingProfiles, backupSchemaSupportsDocumentNumberingPolicies, createBackupManifest, validateBackupManifest } from '@/lib/backup-manifest';
import { bankMappingProfilesFromBackup, planBankMappingProfileRestore, restoreBankMappingProfiles } from '@/lib/bank-mapping-profile-backup';
import { BANK_IMPORT_MAPPING_VERSION, BANK_IMPORT_PARSER_VERSION, type BankImportReceipt } from '@/lib/bank-import-contract';
import { inferBankCsvMapping, parseBankCsv } from '@/lib/bank-csv';
import { bankImportEvidenceHash, bankImportRowKeys, bankImportTotals, prepareBankImport } from '@/lib/bank-import-evidence';
import { bankImportsFromBackup } from '@/lib/bank-import-backup';
import { documentNumberCounterFloors, numberingPoliciesFromBackup } from '@/lib/document-numbering-policy-backup';
import { stripEmptyBankImportsForLegacy } from './helpers/backup-schema';

const at = '2026-10-24T00:00:00.000Z';
function profileFixture() {
  const mapping = { ...inferBankCsvMapping(parseBankCsv('Datum;Betrag;Währung;Verwendungszweck\n24.10.2026;12,34;EUR;synthetisch').headers), accountAlias: 'Synthetisches Konto' };
  const id = randomUUID();
  return {
    bankMappingProfiles: [{ id, revision: 1, deletedAt: null as string | null, deleteMutationId: null as string | null, createdAt: at, updatedAt: at }],
    bankMappingProfileRevisions: [{ profileId: id, revision: 1, mutationId: randomUUID(), configuration: { version: 1 as const, name: 'Synthetisches Profil', parserVersion: BANK_IMPORT_PARSER_VERSION, mappingVersion: BANK_IMPORT_MAPPING_VERSION, delimiter: ';' as const, mapping, headerHashes: ['1', '2', '3', '4'].map(value => value.repeat(64)) }, createdAt: at }],
  };
}
function revisionTwo(input = profileFixture()) {
  const next = structuredClone(input);
  next.bankMappingProfiles[0].revision = 2;
  next.bankMappingProfiles[0].updatedAt = '2026-10-24T01:00:00.000Z';
  next.bankMappingProfileRevisions.push({ ...structuredClone(next.bankMappingProfileRevisions[0]), revision: 2, mutationId: randomUUID(), configuration: { ...next.bankMappingProfileRevisions[0].configuration, name: 'Geänderter Profilname' }, createdAt: next.bankMappingProfiles[0].updatedAt });
  return next;
}
function policyFixture() {
  return [{ type: 'INVOICE', revision: 1, formatVersion: 1, prefix: 'RE-', includeYear: true, sequenceWidth: 4, startSequence: 30, effectiveYear: 2026, createdAt: at }];
}
function dataFixture() {
  return { quoteReleaseAuthorities: [], quoteReleases: [], quoteElectronicResponses: [], user: { id: 'synthetic-source' }, manualFinancialRecordEvents: [], customers: [], serviceArticles: [], suppliers: [], purchaseDocuments: [], invoices: [], paymentJournalEvents: [], paymentAdjustments: [], paymentOperations: [], serviceProjects: [], billingNotes: [], purchaseValidationReports: [], serviceBillingPlans: [], serviceBillingPeriods: [], bankImportBatches: [], bankImportRows: [], bankPaymentBindings: [], paymentAllocationChanges: [], bankMappingProfiles: [], bankMappingProfileRevisions: [], documentNumberingPolicies: [], quoteCreateReceipts: [], auditLogs: [], invoiceNumberCounters: [] } as Record<string, unknown>;
}
function manifestFixture(data = dataFixture()) {
  return { data, manifest: createBackupManifest({ sourceUserId: 'synthetic-source', generatedAt: at, data }) };
}
function bankFixture(profiles = profileFixture()) {
  const csv = 'Datum;Betrag;Währung;Verwendungszweck\n24.10.2026;12,34;EUR;synthetisch';
  const configuration = profiles.bankMappingProfileRevisions[0].configuration, mapping = configuration.mapping;
  const requestId = randomUUID(), stableKey = randomUUID();
  const prepared = prepareBankImport({ requestId, originalBase64: Buffer.from(csv).toString('base64'), delimiter: ';', mapping, parserVersion: BANK_IMPORT_PARSER_VERSION, mappingVersion: BANK_IMPORT_MAPPING_VERSION });
  const rows = prepared.rows.map(evidence => ({ stableKey: randomUUID(), batchStableKey: stableKey, sourceRow: evidence.rowNumber, evidence, ...bankImportRowKeys(mapping.accountAlias, evidence) }));
  const receipt: BankImportReceipt & { mappingProfile: { id: string; revision: number; name: string } } = { version: 1, id: stableKey, requestId, savedAt: at, accountAlias: mapping.accountAlias, sourceSha256: prepared.sourceSha256, sourceBytes: prepared.sourceBytes, parserVersion: BANK_IMPORT_PARSER_VERSION, mappingVersion: BANK_IMPORT_MAPPING_VERSION, ...bankImportTotals(prepared.rows), evidenceSha256: bankImportEvidenceHash(rows), sameFilePreviouslySaved: false, mappingProfile: { id: profiles.bankMappingProfiles[0].id, revision: 1, name: configuration.name } };
  return { ...profiles, bankImportBatches: [{ stableKey, requestId, fingerprint: prepared.fingerprint, sourceSha256: prepared.sourceSha256, sourceBytes: prepared.sourceBytes, parserVersion: BANK_IMPORT_PARSER_VERSION, mappingVersion: BANK_IMPORT_MAPPING_VERSION, accountAlias: mapping.accountAlias, delimiter: ';', mapping: structuredClone(mapping), receipt, createdAt: at }], bankImportRows: rows };
}

describe('closed standalone and combined backup identities', () => {
  it('preserves the historical identity and never infers capability from timestamps', () => {
    expect(MAPPING_NUMBERING_SCHEMA_VERSION).toBe('20261024030000_combine_mapping_profiles_numbering');
    expect(CURRENT_SCHEMA_VERSION).toBe(QUOTE_RELEASE_BACKUP_SCHEMA_VERSION);
    expect(BANK_MAPPING_PROFILES_SCHEMA_VERSION).toBe('20261024010000_add_bank_mapping_profiles');
    expect(DOCUMENT_NUMBERING_POLICIES_SCHEMA_VERSION).toBe('20261024020000_add_document_numbering_policy');
    expect(BACKUP_FEATURE_CAPABILITIES[BANK_PAYMENT_ALLOCATIONS_SCHEMA_VERSION]).not.toHaveProperty('bankMappingProfiles');
    expect(BACKUP_FEATURE_CAPABILITIES[BANK_PAYMENT_ALLOCATIONS_SCHEMA_VERSION]).not.toHaveProperty('documentNumberingPolicies');
    for (const [schema, mapping, numbering] of [[BANK_PAYMENT_ALLOCATIONS_SCHEMA_VERSION, false, false], [BANK_MAPPING_PROFILES_SCHEMA_VERSION, true, false], [DOCUMENT_NUMBERING_POLICIES_SCHEMA_VERSION, false, true], [MAPPING_NUMBERING_SCHEMA_VERSION, true, true], [CURRENT_SCHEMA_VERSION, true, true], ['20991231000000_unknown', false, false]] as const) {
      expect(backupSchemaSupportsBankMappingProfiles(schema)).toBe(mapping);
      expect(backupSchemaSupportsDocumentNumberingPolicies(schema)).toBe(numbering);
    }
  });
  it.each([BANK_PAYMENT_ALLOCATIONS_SCHEMA_VERSION, BANK_MAPPING_PROFILES_SCHEMA_VERSION, DOCUMENT_NUMBERING_POLICIES_SCHEMA_VERSION, MAPPING_NUMBERING_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION])('accepts exactly the sections belonging to %s', schema => {
    const backup = manifestFixture(); backup.manifest.schemaVersion = schema;
    stripEmptyBankImportsForLegacy(backup);
    expect(validateBackupManifest(backup.manifest, backup.data).schemaVersion).toBe(schema);
  });
  it.each(['bankMappingProfiles', 'bankMappingProfileRevisions', 'documentNumberingPolicies'])('requires current %s even when the collection is empty', key => {
    const data = dataFixture(); delete data[key];
    const backup = manifestFixture(data);
    expect(() => validateBackupManifest(backup.manifest, data)).toThrow();
  });
  it.each(['bankMappingProfiles', 'bankMappingProfileRevisions', 'documentNumberingPolicies'])('rejects empty future %s from historical schemas', key => {
    const backup = manifestFixture(); backup.manifest.schemaVersion = BANK_PAYMENT_ALLOCATIONS_SCHEMA_VERSION;
    stripEmptyBankImportsForLegacy(backup); backup.data[key] = [];
    expect(() => validateBackupManifest(backup.manifest, backup.data)).toThrow();
  });
});

describe('immutable portable bank mapping profiles', () => {
  it('exports only canonical reusable configuration and retains complete history', () => {
    const graph = bankMappingProfilesFromBackup(revisionTwo(), true);
    expect(graph.profiles[0].revision).toBe(2);
    expect(graph.revisions.map(row => row.configuration.name)).toEqual(['Synthetisches Profil', 'Geänderter Profilname']);
    expect(bankMappingProfilesFromBackup({}, false)).toEqual({ profiles: [], revisions: [] });
  });
  it.each([
    (data: ReturnType<typeof profileFixture>) => { Object.assign(data.bankMappingProfiles[0], { userId: 'another-owner' }); },
    (data: ReturnType<typeof profileFixture>) => { Object.assign(data.bankMappingProfileRevisions[0].configuration, { rawRows: ['forbidden'] }); },
    (data: ReturnType<typeof profileFixture>) => { Object.assign(data.bankMappingProfileRevisions[0].configuration.mapping, { sample: 'forbidden' }); },
    (data: ReturnType<typeof profileFixture>) => { Object.assign(data.bankMappingProfileRevisions[0], { headers: ['forbidden'] }); },
    (data: ReturnType<typeof profileFixture>) => { data.bankMappingProfiles[0].revision = 2; },
    (data: ReturnType<typeof profileFixture>) => { data.bankMappingProfileRevisions.push(structuredClone(data.bankMappingProfileRevisions[0])); },
    (data: ReturnType<typeof profileFixture>) => { data.bankMappingProfileRevisions[0].profileId = randomUUID(); },
    (data: ReturnType<typeof profileFixture>) => { data.bankMappingProfiles[0].deletedAt = at; },
    (data: ReturnType<typeof profileFixture>) => { data.bankMappingProfileRevisions[0].createdAt = '2026-10-25T00:00:00.000Z'; },
  ])('rejects leaking, partial or inconsistent profile data %#', mutate => {
    const data = profileFixture(); mutate(data);
    expect(() => bankMappingProfilesFromBackup(data, true)).toThrow();
  });
  it('binds receipt provenance to its historical revision after later edits', () => {
    const source = profileFixture(), bank = bankFixture(revisionTwo(source));
    expect(bankImportsFromBackup(bank, true, true).batches[0].receipt.mappingProfile?.name).toBe('Synthetisches Profil');
    expect(bankMappingProfilesFromBackup(bank, true).revisions).toHaveLength(2);
    expect(() => bankImportsFromBackup(bank, true)).toThrow(/Profilherkunft/);
    bank.bankImportBatches[0].receipt.mappingProfile.name = 'Geänderter Profilname';
    expect(() => bankMappingProfilesFromBackup(bank, true)).toThrow(/Profilherkunft/);
  });
  it('keeps valid Unicode profile labels compatible with the feature contract', () => {
    const data = bankFixture();
    data.bankMappingProfileRevisions[0].configuration.name = 'Bank \uFFFD';
    data.bankImportBatches[0].receipt.mappingProfile.name = 'Bank \uFFFD';
    expect(() => bankImportsFromBackup(data, true, true)).not.toThrow();
    expect(() => bankMappingProfilesFromBackup(data, true)).not.toThrow();
  });
  it.each(['id', 'revision', 'name', 'configuration'])('rejects mismatched receipt provenance %s', field => {
    const data = bankFixture();
    if (field === 'id') data.bankImportBatches[0].receipt.mappingProfile.id = randomUUID();
    else if (field === 'revision') data.bankImportBatches[0].receipt.mappingProfile.revision = 2;
    else if (field === 'name') data.bankImportBatches[0].receipt.mappingProfile.name = 'Anderes Profil';
    else data.bankMappingProfileRevisions[0].configuration.mapping.accountAlias = 'Anderes Konto';
    expect(() => bankMappingProfilesFromBackup(data, true)).toThrow();
  });
  it('retains newer target revisions and appends only a compatible suffix', () => {
    const first = profileFixture(), second = revisionTwo(first), older = bankMappingProfilesFromBackup(first, true), newer = bankMappingProfilesFromBackup(second, true);
    expect(planBankMappingProfileRestore(newer, older)).toEqual({ profiles: newer.profiles, revisions: [] });
    expect(planBankMappingProfileRestore(older, newer).revisions).toEqual([newer.revisions[1]]);
    const changed = structuredClone(newer); changed.revisions[0].configuration.name = 'Divergierende Historie';
    expect(() => planBankMappingProfileRestore(older, changed)).toThrow(/unveränderliche/);
    const timeChanged = structuredClone(older); timeChanged.revisions[0].createdAt = '2026-10-24T00:00:00.001Z';
    expect(() => planBankMappingProfileRestore(older, timeChanged)).toThrow(/unveränderliche/);
  });
  it('keeps deletion tombstones and rejects resurrection or divergent deletion evidence', () => {
    const first = profileFixture(), deleted = structuredClone(first);
    Object.assign(deleted.bankMappingProfiles[0], { deletedAt: at, deleteMutationId: randomUUID() });
    const tombstone = bankMappingProfilesFromBackup(deleted, true), active = bankMappingProfilesFromBackup(first, true);
    expect(planBankMappingProfileRestore(tombstone, active).profiles).toEqual(tombstone.profiles);
    expect(planBankMappingProfileRestore(active, tombstone).profiles).toEqual(tombstone.profiles);
    expect(() => planBankMappingProfileRestore(tombstone, bankMappingProfilesFromBackup(revisionTwo(first), true))).toThrow(/Löschbeleg/);
    const divergent = structuredClone(tombstone); divergent.profiles[0].deleteMutationId = randomUUID();
    expect(() => planBankMappingProfileRestore(tombstone, divergent)).toThrow(/Löschbelege/);
  });
  it('remaps both profile and revision ownership while preserving portable identifiers', async () => {
    const graph = bankMappingProfilesFromBackup(profileFixture(), true), profileWrites: Record<string, unknown>[] = [], revisionWrites: Record<string, unknown>[] = [];
    const foreign = { userId: 'foreign-owner', ...graph.profiles[0] };
    const client = { bankMappingProfile: {
      findMany: vi.fn(async (query: { where: { userId: string } }) => { expect(query.where.userId).toBe('target-owner'); return []; }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { profileWrites.push(data); return data; }),
    }, bankMappingProfileRevision: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { revisionWrites.push(data); return data; }) } } as unknown as Prisma.TransactionClient;
    expect(await restoreBankMappingProfiles(client, 'target-owner', graph)).toEqual({ profiles: { imported: 1, skipped: 0 }, revisions: { imported: 1, skipped: 0 } });
    expect(profileWrites[0]).toMatchObject({ userId: 'target-owner', id: foreign.id });
    expect(revisionWrites[0]).toMatchObject({ userId: 'target-owner', profileId: foreign.id });
    expect(foreign.userId).toBe('foreign-owner');
  });
  it('fails closed on a raced same-tenant identifier collision without a foreign-tenant read', async () => {
    const calls: unknown[] = [];
    const client = { bankMappingProfile: { findMany: vi.fn(async (query: unknown) => { calls.push(query); return []; }), create: vi.fn(async () => { throw { code: 'P2002' }; }) } } as unknown as Prisma.TransactionClient;
    await expect(restoreBankMappingProfiles(client, 'target-owner', bankMappingProfilesFromBackup(profileFixture(), true))).rejects.toThrow('Profilkennung kann im Ziel nicht übernommen werden.');
    expect(calls).toEqual([{ where: { userId: 'target-owner' }, include: { revisions: { orderBy: { revision: 'asc' } } } }]);
  });
});

describe('numbering history floor integration', () => {
  it('retains exact annual and no-year custom sequence floors without guessing legacy text', () => {
    const policies = numberingPoliciesFromBackup({ documentNumberingPolicies: policyFixture() }, true);
    const nonYear = { ...policies[0], revision: 2, includeYear: false, prefix: 'FIX-', effectiveYear: 2027 };
    expect(documentNumberCounterFloors([{ type: 'INVOICE', invoiceNumber: 'RE-2026-0042' }, { type: 'INVOICE', invoiceNumber: 'FIX-000099' }, { type: 'INVOICE', invoiceNumber: 'unknown-999999' }], [...policies, nonYear])).toEqual([{ type: 'INVOICE', year: 2026, value: 42 }, { type: 'INVOICE', year: 2027, value: 99 }]);
  });
});
