import { stripEmptyPaymentAdjustmentsForLegacy } from './helpers/backup-schema';
import { legacyPaymentData } from './helpers/backup-schema';
import { createBackupManifest } from './helpers/backup';
import { stripCsvCatalogForLegacy } from './helpers/backup-schema';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';
import { PRE_QUOTE_FOLLOWUP_SCHEMA_VERSION } from '@/lib/backup-manifest';
import { readBackupSnapshot } from '@/lib/backup-snapshot';
const state = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
import { restoreBackupData, validateBackupForRestore } from '@/lib/backup-restore';
let database: ReturnType<typeof createTestDatabase>;
beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  await database.client.user.createMany({ data: ['source', 'target', 'old-empty'].map(id => ({ id: `quote-backup-${id}`, email: `quote-backup-${id}@test.invalid`, password: 'unused' })) });
  await database.client.invoice.create({ data: { userId: 'quote-backup-source', type: 'QUOTE', status: 'SENT', invoiceNumber: 'AN-2026-01', fileName: 'synthetic.pdf', storedFileName: 'synthetic-source.pdf', parsedData: { items: [] }, quoteFollowUpOn: '2026-12-31', quoteResponseNote: 'Telefonisch Rückfrage für Januar' } });
}, 40000);
afterAll(async () => database?.cleanup());
async function backup() {
  const snapshot = await readBackupSnapshot('quote-backup-source');
  const data = JSON.parse(JSON.stringify(snapshot.data));
  return { version: '3.0', data, manifest: createBackupManifest({ sourceUserId: 'quote-backup-source', generatedAt: '2026-10-21T00:00:00Z', data }) };
}
describe('quote workflow backup compatibility and identity', () => {
  it('roundtrips metadata on the same quote identity and a repeated merge does not duplicate it', async () => {
    const source = await backup();
    expect(source.data.invoices[0]).toMatchObject({ quoteFollowUpOn: '2026-12-31', quoteResponseNote: 'Telefonisch Rückfrage für Januar' });
    await restoreBackupData({ userId: 'quote-backup-target', overwrite: false, backup: source });
    await restoreBackupData({ userId: 'quote-backup-target', overwrite: false, backup: source });
    expect(await database.client.invoice.findMany({ where: { userId: 'quote-backup-target' } })).toMatchObject([{ invoiceNumber: 'AN-2026-01', quoteFollowUpOn: '2026-12-31', quoteResponseNote: 'Telefonisch Rückfrage für Januar' }]);
  });
  it('refuses older manifest claims containing new metadata and invalid non-quote/task dates', async () => {
    const original = await backup();
    for (const mutate of [
      (source: typeof original) => { source.manifest.schemaVersion = PRE_QUOTE_FOLLOWUP_SCHEMA_VERSION; stripEmptyPaymentAdjustmentsForLegacy(source); },
      (source: typeof original) => { source.data.invoices[0].type = 'INVOICE'; },
      (source: typeof original) => { source.data.invoices[0].quoteFollowUpOn = '2026-02-30'; },
    ]) {
      const source = structuredClone(original); mutate(source);
      if (source.manifest.schemaVersion !== PRE_QUOTE_FOLLOWUP_SCHEMA_VERSION) source.manifest = createBackupManifest({ sourceUserId: 'quote-backup-source', generatedAt: '2026-10-21T00:00:00Z', data: source.data });
      expect(() => validateBackupForRestore(source)).toThrow();
    }
  });
  it('requires explicit nullable fields for the new capability and rejects legacy relabeling or noncanonical values', async () => {
    const original = await backup();
    for (const mutate of [
      (source: typeof original) => { delete source.data.invoices[0].quoteFollowUpOn; },
      (source: typeof original) => { delete source.data.invoices[0].quoteResponseNote; },
      (source: typeof original) => { source.data.invoices[0].quoteFollowUpOn = ''; },
      (source: typeof original) => { source.data.invoices[0].quoteResponseNote = '  padded note  '; },
    ]) {
      const source = structuredClone(original); mutate(source);
      source.manifest = createBackupManifest({ sourceUserId: 'quote-backup-source', generatedAt: '2026-10-21T00:00:00Z', data: source.data });
      expect(() => validateBackupForRestore(source)).toThrow();
    }
    expect(() => validateBackupForRestore({ version: '2.0', data: legacyPaymentData(original.data) })).toThrow(/Backupformat/);
  });

  it('imports old backups into empty targets, but refuses merge/overwrite that silently erases task metadata', async () => {
    const source = await backup();
    for (const invoice of source.data.invoices) { delete invoice.quoteFollowUpOn; delete invoice.quoteResponseNote; }
    source.manifest = createBackupManifest({ sourceUserId: 'quote-backup-source', generatedAt: '2026-10-21T00:00:00Z', data: source.data });
    source.manifest.schemaVersion = PRE_QUOTE_FOLLOWUP_SCHEMA_VERSION; stripEmptyPaymentAdjustmentsForLegacy(source); stripCsvCatalogForLegacy(source);
    expect(() => validateBackupForRestore(source)).not.toThrow();
    await restoreBackupData({ userId: 'quote-backup-old-empty', overwrite: false, backup: source });
    for (const overwrite of [false, true]) await expect(restoreBackupData({ userId: 'quote-backup-target', overwrite, backup: source })).rejects.toThrow(/Wiedervorlage|Wiedervorlagen/);
    const emptyLegacy = { version: '2.0', data: { invoices: [] } };
    await expect(restoreBackupData({ userId: 'quote-backup-target', overwrite: true, backup: emptyLegacy })).rejects.toThrow(/Wiedervorlagen/);
    expect(await database.client.invoice.count({ where: { userId: 'quote-backup-target', quoteResponseNote: { not: null } } })).toBe(1);
  });
});
