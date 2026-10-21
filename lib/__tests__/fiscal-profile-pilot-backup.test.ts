import { stripCsvCatalogForLegacy } from './helpers/backup-schema';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';
import { createBackupManifest, CURRENT_SCHEMA_VERSION, PRE_FISCAL_PROFILE_SCHEMA_VERSION } from '@/lib/backup-manifest';
import { readBackupSnapshot } from '@/lib/backup-snapshot';
import { EMPTY_FISCAL_PROFILE } from '@/lib/fiscal-profile';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
import { restoreBackupData, validateBackupForRestore } from '@/lib/backup-restore';

let database: ReturnType<typeof createTestDatabase>;
beforeAll(async () => {
  database = createTestDatabase();
  state.client = database.client;
  await database.client.user.createMany({ data: ['source', 'target', 'legacy-target'].map(name => ({
    id: `fiscal-backup-${name}`, email: `fiscal-backup-${name}@test.invalid`, password: 'unused',
  })) });
}, 40_000);
afterAll(async () => { await database?.cleanup(); });

function backup(settings: Record<string, unknown>) {
  const data = {
    user: { id: 'fiscal-backup-source' }, settings,
    serviceBillingPlans: [], serviceBillingPeriods: [], serviceArticles: [], suppliers: [], purchaseDocuments: [], paymentJournalEvents: [],
    invoices: [], incomes: [], expenses: [], customers: [], auditLogs: [], invoiceNumberCounters: [],
  };
  return { version: '3.0', data, manifest: createBackupManifest({ sourceUserId: 'fiscal-backup-source', generatedAt: '2026-10-20T00:00:00.000Z', data }) };
}

describe('pilot fiscal profile backup compatibility', () => {
  it('roundtrips a confirmed source declaration with its original server timestamp into only the target tenant', async () => {
    const declaration = {
      fiscalTaxRegime: 'SMALL_BUSINESS', fiscalEffectiveFrom: '2026-01-01', fiscalConfirmedAt: new Date('2026-10-20T12:34:56.123Z'),
    };
    await database.client.settings.create({ data: { userId: 'fiscal-backup-source', companyName: 'Source company', ...declaration } });
    const snapshot = await readBackupSnapshot('fiscal-backup-source');
    const sourceSettings = await database.client.settings.findUniqueOrThrow({ where: { userId: 'fiscal-backup-source' } });
    const data = JSON.parse(JSON.stringify(snapshot.data));
    expect(data.settings).toMatchObject({ ...declaration, fiscalConfirmedAt: declaration.fiscalConfirmedAt.toISOString() });
    const manifest = createBackupManifest({ sourceUserId: 'fiscal-backup-source', generatedAt: '2026-10-20T00:00:00.000Z', data });
    expect(manifest.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    await restoreBackupData({ userId: 'fiscal-backup-target', overwrite: true, backup: { version: '3.0', data, manifest } });
    expect(await database.client.settings.findUniqueOrThrow({ where: { userId: 'fiscal-backup-target' } })).toMatchObject({
      userId: 'fiscal-backup-target', companyName: 'Source company', ...declaration,
    });
    expect(await database.client.settings.findUniqueOrThrow({ where: { userId: 'fiscal-backup-source' } })).toEqual(sourceSettings);
  });

  it('accepts pre-profile v3 and legacy v2 settings as UNSET rather than inferring or retaining an unrelated confirmed declaration', async () => {
    const old = backup({ id: 99, companyName: 'Legacy company' });
    old.manifest.schemaVersion = PRE_FISCAL_PROFILE_SCHEMA_VERSION; stripCsvCatalogForLegacy(old);
    old.manifest.modelCoverage = old.manifest.modelCoverage.filter((entry) => entry.model !== 'PurchaseDocument' && entry.model !== 'Supplier' && entry.model !== 'PaymentJournalEvent');
    expect(() => validateBackupForRestore(old)).not.toThrow();
    await database.client.settings.create({ data: {
      userId: 'fiscal-backup-legacy-target', fiscalTaxRegime: 'STANDARD', fiscalEffectiveFrom: '2025-01-01', fiscalConfirmedAt: new Date(),
    } });
    await restoreBackupData({ userId: 'fiscal-backup-legacy-target', overwrite: false, backup: old });
    expect(await database.client.settings.findUniqueOrThrow({ where: { userId: 'fiscal-backup-legacy-target' } })).toMatchObject(EMPTY_FISCAL_PROFILE);
    await restoreBackupData({ userId: 'fiscal-backup-legacy-target', overwrite: true, backup: { version: '2.0', data: old.data } });
    expect(await database.client.settings.findUniqueOrThrow({ where: { userId: 'fiscal-backup-legacy-target' } })).toMatchObject(EMPTY_FISCAL_PROFILE);
  });

  it.each([
    { fiscalTaxRegime: 'AUTO', fiscalEffectiveFrom: '2026-01-01', fiscalConfirmedAt: '2026-10-20T00:00:00.000Z' },
    { fiscalTaxRegime: 'STANDARD', fiscalEffectiveFrom: '2026-02-30', fiscalConfirmedAt: '2026-10-20T00:00:00.000Z' },
    { fiscalTaxRegime: 'STANDARD', fiscalEffectiveFrom: '2026-01-01' },
    { fiscalTaxRegime: 'STANDARD', fiscalEffectiveFrom: '2026-01-01', fiscalConfirmedAt: '2026-02-30T00:00:00.000Z' },
    { fiscalTaxRegime: 'UNSET', fiscalEffectiveFrom: null, fiscalConfirmedAt: '2026-10-20T00:00:00.000Z' },
  ])('rejects inconsistent fiscal restore data in the preflight and leaves target unchanged: %s', async (settings) => {
    const before = await database.client.settings.findUniqueOrThrow({ where: { userId: 'fiscal-backup-target' } });
    const invalid = backup(settings);
    expect(() => validateBackupForRestore(invalid)).toThrow(/settings.fiscal/u);
    await expect(restoreBackupData({ userId: 'fiscal-backup-target', overwrite: true, backup: invalid })).rejects.toThrow(/settings.fiscal/u);
    expect(await database.client.settings.findUniqueOrThrow({ where: { userId: 'fiscal-backup-target' } })).toEqual(before);
  });
});
