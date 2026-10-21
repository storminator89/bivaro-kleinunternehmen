import { stripEmptyPaymentAdjustmentsForLegacy } from './helpers/backup-schema';
import { legacyPaymentData } from './helpers/backup-schema';
import { createBackupManifest } from './helpers/backup';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';
import { autoMapColumns, parseImportCsv } from '@/lib/data-import-contract';
import { confirmDataImport, findImportResult, previewDataImport, type ImportRequest } from '@/lib/data-import-service';
import { readBackupSnapshot } from '@/lib/backup-snapshot';
import { PRE_DATA_IMPORT_SCHEMA_VERSION, validateBackupManifest } from '@/lib/backup-manifest';
import { createBackupPreview } from '@/lib/backup-preview';
import { restoreBackupData } from '@/lib/backup-restore';
import { readServiceArticle, serviceArticleNameKey } from '@/lib/service-articles';
const state = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
let db: ReturnType<typeof createTestDatabase>;
let serial = 0;
function request(csv: string, kind: ImportRequest['kind'] = 'customers'): ImportRequest { return { csv, kind, mapping: autoMapColumns(kind, parseImportCsv(csv).headers) }; }
const key = () => `csv-test-request-${++serial}`;
async function commit(owner: string, input: ImportRequest) { const preview = await previewDataImport(owner, input); return confirmDataImport(owner, input, key(), preview.fingerprint); }
beforeAll(async () => {
  db = createTestDatabase(); state.client = db.client;
  await db.client.user.createMany({ data: ['csv-owner', 'csv-other', 'csv-restore'].map(id => ({ id, email: `${id}@test.invalid`, password: 'fixture' })) });
}, 40_000);
afterAll(async () => { await db?.cleanup(); });
describe('reviewed, atomic tenant CSV import', () => {
  it('preview and cancellation create no business rows, receipts or audit', async () => {
    const counts = await Promise.all([db.client.customer.count(), db.client.dataImportBatch.count(), db.client.auditLog.count()]);
    expect(await previewDataImport('csv-owner', request('Name;E-Mail\nNur Vorschau;preview@test.invalid'))).toMatchObject({ counts: { ready: 1, invalid: 0, duplicate: 0 } });
    expect(await Promise.all([db.client.customer.count(), db.client.dataImportBatch.count(), db.client.auditLog.count()])).toEqual(counts);
  });
  it('imports valid rows, explicitly skips invalid and repeated rows, preserves unknown fields', async () => {
    const input = request('Name;E-Mail;PLZ\nWerkstatt;mail@test.invalid;00123\nWerkstatt;mail@test.invalid;00123\nKaputt;keinemail;\nOhne E-Mail;;');
    const preview = await previewDataImport('csv-owner', input);
    expect(preview.counts).toEqual({ ready: 2, invalid: 1, duplicate: 1 });
    const result = await confirmDataImport('csv-owner', input, key(), preview.fingerprint);
    expect(result).toMatchObject({ imported: 2, skipped: 2, replayed: false });
    const saved = await db.client.customer.findMany({ where: { id: { in: result.createdIds } }, orderBy: { id: 'asc' } });
    expect(saved[0]).toMatchObject({ userId: 'csv-owner', zipCode: '00123', noteVisibility: 'EDITOR' });
    expect(saved[1].email).toBeNull();
    expect(await db.client.invoice.count()).toBe(0); expect(await db.client.income.count()).toBe(0); expect(await db.client.settings.count()).toBe(0);
  });
  it('uses only own tenant records for duplicates and never overwrites', async () => {
    const input = request('Name;E-Mail\nWerkstatt;mail@test.invalid');
    expect((await previewDataImport('csv-other', input)).counts.ready).toBe(1);
    const imported = await commit('csv-other', input);
    expect((await previewDataImport('csv-other', input)).counts.duplicate).toBe(1);
    expect(await db.client.customer.findUnique({ where: { id: imported.createdIds[0] } })).toMatchObject({ userId: 'csv-other', name: 'Werkstatt' });
  });
  it('concurrent same-key submits replay one committed result; receipt has no source PII', async () => {
    const input = request('Name\nParallelkunde'); const preview = await previewDataImport('csv-owner', input); const requestId = key();
    const results = await Promise.all(Array.from({ length: 3 }, () => confirmDataImport('csv-owner', input, requestId, preview.fingerprint)));
    expect(results.filter(row => !row.replayed)).toHaveLength(1);
    expect(new Set(results.map(row => row.createdIds[0])).size).toBe(1);
    expect(await findImportResult('csv-other', requestId)).toBeNull();
    expect(await findImportResult('csv-owner', requestId)).toMatchObject({ imported: 1 });
    const batch = await db.client.dataImportBatch.findUniqueOrThrow({ where: { userId_requestId: { userId: 'csv-owner', requestId } } });
    expect(JSON.stringify(batch)).not.toContain('Parallelkunde');
    await expect(confirmDataImport('csv-owner', { ...input, csv: 'Name\nAnderer Kunde' }, requestId, preview.fingerprint)).rejects.toMatchObject({ status: 409 });
  });
  it('stale target state requires fresh review with zero surprise writes', async () => {
    const input = request('Name\nBestandsänderung'); const preview = await previewDataImport('csv-owner', input);
    await commit('csv-owner', input);
    await expect(confirmDataImport('csv-owner', input, key(), preview.fingerprint)).rejects.toMatchObject({ status: 409 });
    expect(await db.client.customer.count({ where: { userId: 'csv-owner', name: 'Bestandsänderung' } })).toBe(1);
  });
  it('exact source GROSS and explicit 0 NET prices remain distinct without fiscal inference', async () => {
    const input = request('Name;Beschreibung;Einheit;Preis;Preisbasis;Steuersatz\nService;Wartung;Stunde;119,00;GROSS;19\nKostenlos;;Stück;0;NET;0', 'articles');
    const result = await commit('csv-owner', input);
    const articles = await db.client.serviceArticle.findMany({ where: { id: { in: result.createdIds } }, orderBy: { id: 'asc' } });
    expect(articles[0]).toMatchObject({ unitPriceCents: '10000', sourcePriceCents: '11900', sourcePriceBasis: 'GROSS', taxRate: '19' });
    expect(articles[1]).toMatchObject({ unitPriceCents: '0', sourcePriceCents: '0', taxRate: '0' });
    expect(readServiceArticle(articles[0])).not.toBeNull();
    expect(serviceArticleNameKey('  S E R V I C E  ')).toBe('s e r v i c e');
    expect(await db.client.settings.count()).toBe(0);
  });
  it('catalog duplicates by normalized name skip rather than merge prices', async () => {
    const input = request('Name;Einheit;Preis;Preisbasis;Steuersatz\n  SERVICE ;Stück;999;NET;7', 'articles');
    expect((await previewDataImport('csv-owner', input)).counts).toEqual({ ready: 0, invalid: 0, duplicate: 1 });
    expect(await db.client.serviceArticle.findFirst({ where: { userId: 'csv-owner', nameKey: 'service' } })).toMatchObject({ unitPriceCents: '10000', taxRate: '19' });
  });
  it('a late database failure rolls back every row, receipt and audit', async () => {
    // DDL is constrained to this fresh temporary integration fixture.
    await db.client.$executeRawUnsafe(`CREATE TRIGGER csv_test_failure BEFORE INSERT ON ServiceArticle WHEN NEW.name = 'Scheitert' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`);
    const input = request('Name;Einheit;Preis;Preisbasis;Steuersatz\nRollback zuerst;Stück;1;NET;0\nScheitert;Stück;2;NET;0', 'articles');
    const preview = await previewDataImport('csv-owner', input); const requestId = key();
    await expect(confirmDataImport('csv-owner', input, requestId, preview.fingerprint)).rejects.toThrow();
    expect(await db.client.serviceArticle.count({ where: { name: { in: ['Rollback zuerst', 'Scheitert'] } } })).toBe(0);
    expect(await findImportResult('csv-owner', requestId)).toBeNull();
    expect(await db.client.auditLog.count({ where: { entityId: requestId } })).toBe(0);
    await db.client.$executeRawUnsafe('DROP TRIGGER csv_test_failure');
  });
});
describe('catalog backup contract', () => {
  it('exports only owned catalog, restores exact prices, and safely repeats merge', async () => {
    const snapshot = await readBackupSnapshot('csv-owner');
    const backup = { version: '3.0', data: snapshot.data, manifest: createBackupManifest({ sourceUserId: 'csv-owner', generatedAt: '2026-10-21T06:00:00.000Z', data: snapshot.data }) };
    expect((snapshot.data.serviceArticles as unknown[]).length).toBe(2);
    expect(snapshot.data.dataImportBatches).toBeUndefined();
    expect(createBackupPreview(backup).counts.serviceArticles).toBe(2);
    const restored = await restoreBackupData({ userId: 'csv-restore', backup, overwrite: false });
    expect(restored.serviceArticles).toEqual({ imported: 2, skipped: 0 });
    const repeated = await restoreBackupData({ userId: 'csv-restore', backup, overwrite: false });
    expect(repeated.serviceArticles).toEqual({ imported: 0, skipped: 2 });
    expect(await db.client.serviceArticle.findFirst({ where: { userId: 'csv-restore', nameKey: 'service' } })).toMatchObject({ unitPriceCents: '10000', sourcePriceCents: '11900', sourcePriceBasis: 'GROSS', taxRate: '19' });
  });
  it('rejects tampered exact price and ambiguous catalog merge atomically', async () => {
    const snapshot = await readBackupSnapshot('csv-owner');
    const data = structuredClone(snapshot.data); const articles = data.serviceArticles as Record<string, unknown>[];
    articles[0].unitPriceCents = '99999';
    const bad = { version: '3.0', data, manifest: createBackupManifest({ sourceUserId: 'csv-owner', generatedAt: '2026-10-21T06:00:00.000Z', data }) };
    expect(() => createBackupPreview(bad)).toThrow(/Preis/);
    articles[0].unitPriceCents = 10000;
    bad.manifest = createBackupManifest({ sourceUserId: 'csv-owner', generatedAt: '2026-10-21T06:00:00.000Z', data });
    expect(() => createBackupPreview(bad)).toThrow(/Preis/);
    const missing = { ...snapshot.data }; delete missing.serviceArticles;
    expect(() => createBackupPreview({ version: '3.0', data: missing, manifest: createBackupManifest({ sourceUserId: 'csv-owner', generatedAt: '2026-10-21T06:00:00.000Z', data: missing }) })).toThrow(/serviceArticles/);
    expect(() => createBackupPreview({ version: '2.0', data: legacyPaymentData(snapshot.data) })).toThrow(/Artikel/);
    await db.client.serviceArticle.updateMany({ where: { userId: 'csv-restore', nameKey: 'service' }, data: { description: 'Lokal verändert' } });
    const backup = { version: '3.0', data: snapshot.data, manifest: createBackupManifest({ sourceUserId: 'csv-owner', generatedAt: '2026-10-21T06:00:00.000Z', data: snapshot.data }) };
    await expect(restoreBackupData({ userId: 'csv-restore', backup, overwrite: false })).rejects.toThrow(/abweichende Daten/);
    expect(await db.client.serviceArticle.findFirst({ where: { userId: 'csv-restore', nameKey: 'service' } })).toMatchObject({ description: 'Lokal verändert' });
  });
  it('accepts predecessor manifest without catalog but rejects injected unbound catalog', async () => {
    const snapshot = await readBackupSnapshot('csv-other');
    const data = { ...snapshot.data }; delete data.serviceArticles; delete data.annualBusinessContextRevisions;
    const manifest = createBackupManifest({ sourceUserId: 'csv-other', generatedAt: '2026-10-21T06:00:00.000Z', data });
    manifest.schemaVersion = PRE_DATA_IMPORT_SCHEMA_VERSION;
    stripEmptyPaymentAdjustmentsForLegacy({ data, manifest });
    manifest.modelCoverage = manifest.modelCoverage.filter(row => !['ServiceArticle', 'DataImportBatch', 'AiProviderSettings', 'ServiceBillingPlan', 'ServiceBillingPeriod'].includes(row.model));
    expect(() => validateBackupManifest(manifest, data)).not.toThrow();
    expect(() => validateBackupManifest(manifest, { ...data, serviceArticles: [{ id: 1 }] })).toThrow(/Artikel/);
  });
});
