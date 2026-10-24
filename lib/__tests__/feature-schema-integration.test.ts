import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from './helpers/database';
import { BACKUP_MODEL_COVERAGE, createBackupManifest, validateBackupManifest } from '@/lib/backup-manifest';
import { readBackupSnapshot } from '@/lib/backup-snapshot';
import { restoreBackupData } from '@/lib/backup-restore';
import { saveBankMappingProfile, deleteBankMappingProfile } from '@/lib/bank-mapping-profile-service';
import { createBankMappingProfileConfiguration } from '@/lib/bank-mapping-profile-contract';
import { inferBankCsvMapping, parseBankCsv } from '@/lib/bank-csv';
import { getNextDocumentNumber, previewDocumentNumber } from '@/lib/invoice-numbers';

const state = vi.hoisted(() => ({ client: null as ReturnType<typeof createTestDatabase>['client'] | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
let database: ReturnType<typeof createTestDatabase>;
const source = 'combined-feature-source', target = 'combined-feature-target', foreign = 'combined-feature-foreign';
const profileId = randomUUID(), tombstoneId = randomUUID(), requestId = randomUUID();
let backup: { version: string; data: Record<string, unknown>; manifest: ReturnType<typeof createBackupManifest> };

beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  await database.client.user.createMany({ data: [source, target, foreign].map(id => ({ id, email: `${id}@synthetic.test`, password: 'fixture-only' })) });
  const parsed = parseBankCsv('Datum;Betrag;Währung\n24.10.2026;1,00;EUR');
  const configuration = await createBankMappingProfileConfiguration('Synthetisches Profil', { ...inferBankCsvMapping(parsed.headers), accountAlias: 'Synthetisches Konto' }, parsed);
  await saveBankMappingProfile(source, { id: profileId, mutationId: randomUUID(), expectedRevision: 0, configuration });
  await saveBankMappingProfile(source, { id: profileId, mutationId: randomUUID(), expectedRevision: 1, configuration: { ...configuration, name: 'Unveränderliche zweite Revision' } });
  await saveBankMappingProfile(source, { id: tombstoneId, mutationId: randomUUID(), expectedRevision: 0, configuration });
  await deleteBankMappingProfile(source, { id: tombstoneId, mutationId: randomUUID(), expectedRevision: 1 });
  await database.client.documentNumberingPolicy.create({ data: { userId: source, type: 'INVOICE', revision: 1, formatVersion: 1, prefix: 'BIV-', includeYear: false, sequenceWidth: 4, startSequence: 300, effectiveYear: 2026 } });
  await database.client.quoteCreateReceipt.create({ data: { userId: source, requestId, fingerprint: '1'.repeat(64), pdfSha256: '2'.repeat(64) } });
  const snapshot = await readBackupSnapshot(source);
  backup = { version: '3.0', data: snapshot.data, manifest: createBackupManifest({ sourceUserId: source, generatedAt: snapshot.info.endedAt, data: snapshot.data }) };
}, 40_000);
afterAll(async () => database?.cleanup());

describe('combined feature schema and real temporary SQLite restore', () => {
  it('accounts for every generated tenant/host model and preserves all four new collections across owners', async () => {
    expect(BACKUP_MODEL_COVERAGE.map(row => row.model).sort()).toEqual(Prisma.dmmf.datamodel.models.map(row => row.name).sort());
    expect(() => validateBackupManifest(backup.manifest, backup.data)).not.toThrow();
    const result = await restoreBackupData({ userId: target, backup, overwrite: false });
    expect(result.bankMappingProfiles).toEqual({ imported: 2, skipped: 0 });
    expect(result.bankMappingProfileRevisions).toEqual({ imported: 3, skipped: 0 });
    expect(result.documentNumberingPolicies).toEqual({ imported: 1, skipped: 0 });
    expect(result.quoteCreateReceipts).toEqual({ imported: 1, skipped: 0 });
    expect(await database.client.bankMappingProfile.count({ where: { id: profileId } })).toBe(2);
    expect(await database.client.bankMappingProfileRevision.count({ where: { userId: target, profileId } })).toBe(2);
    expect(await database.client.bankMappingProfile.findUnique({ where: { userId_id: { userId: target, id: tombstoneId } } })).toHaveProperty('deletedAt', expect.any(Date));
    expect(await database.client.quoteCreateReceipt.findUnique({ where: { userId_requestId: { userId: target, requestId } } })).toMatchObject({ invoiceId: null, invoiceUserId: null });
    const snapshot = await readBackupSnapshot(target);
    for (const key of ['bankMappingProfiles', 'bankMappingProfileRevisions', 'documentNumberingPolicies', 'quoteCreateReceipts']) expect(snapshot.data[key]).toEqual(backup.data[key]);
    expect((await previewDocumentNumber(database.client, target, 'INVOICE', 2026)).number).toBe('BIV-0300');
  });
  it('retains counters, revisions and independent tombstones under repeated overwrite, without foreign revision links', async () => {
    expect(await database.client.$transaction(tx => getNextDocumentNumber(tx, target, 'INVOICE', 2026))).toBe('BIV-0300');
    await restoreBackupData({ userId: target, backup, overwrite: true });
    expect((await previewDocumentNumber(database.client, target, 'INVOICE', 2027)).number).toBe('BIV-0301');
    expect(await database.client.bankMappingProfileRevision.count({ where: { userId: target } })).toBe(3);
    expect(await database.client.quoteCreateReceipt.count({ where: { userId: target, requestId, invoiceId: null } })).toBe(1);
    const sourceRevision = await database.client.bankMappingProfileRevision.findFirstOrThrow({ where: { userId: source, profileId } });
    await expect(database.client.bankMappingProfileRevision.create({ data: { userId: foreign, profileId, revision: 1, mutationId: randomUUID(), configuration: sourceRevision.configuration as Prisma.InputJsonValue } })).rejects.toThrow(/Foreign key/);
    expect(await database.client.bankMappingProfileRevision.count({ where: { userId: foreign } })).toBe(0);
  });
  it('includes all new tenant models in user deletion/reset cascades without touching the source owner', async () => {
    await database.client.user.delete({ where: { id: target } });
    expect(await database.client.bankMappingProfile.count({ where: { userId: target } })).toBe(0);
    expect(await database.client.bankMappingProfileRevision.count({ where: { userId: target } })).toBe(0);
    expect(await database.client.documentNumberingPolicy.count({ where: { userId: target } })).toBe(0);
    expect(await database.client.quoteCreateReceipt.count({ where: { userId: target } })).toBe(0);
    expect(await database.client.bankMappingProfile.count({ where: { userId: source } })).toBe(2);
    expect(await database.client.quoteCreateReceipt.count({ where: { userId: source } })).toBe(1);
  });
});
