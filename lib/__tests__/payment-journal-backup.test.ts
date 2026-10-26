import { stripEmptyPaymentAdjustmentsForLegacy } from './helpers/backup-schema';
import { legacyPaymentData } from './helpers/backup-schema';
import { createBackupManifest } from './helpers/backup';
import { stripCsvCatalogForLegacy } from './helpers/backup-schema';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestDatabase } from './helpers/database';
import { PRE_PAYMENT_JOURNAL_SCHEMA_VERSION } from '@/lib/backup-manifest';
import { readBackupSnapshot } from '@/lib/backup-snapshot';
import { adoptLegacyPaidInvoice } from '@/lib/payment-journal/service';

const state = vi.hoisted(() => ({ client: null as ReturnType<typeof createTestDatabase>['client'] | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
let database: ReturnType<typeof createTestDatabase>;
let directory: string;
let restore: typeof import('@/lib/backup-restore');
let preview: typeof import('@/lib/backup-preview');

beforeAll(async () => {
  database = createTestDatabase();
  state.client = database.client;
  directory = await mkdtemp(path.join(tmpdir(), 'bivaro-journal-backup-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
  try {
    restore = await import('@/lib/backup-restore');
    preview = await import('@/lib/backup-preview');
  } finally { cwd.mockRestore(); }
}, 40_000);
afterAll(async () => { await database?.cleanup(); if (directory) await rm(directory, { recursive: true, force: true }); });

const paidAt = '2026-01-05T00:00:00.000Z';
const createdAt = '2026-01-08T12:00:00.000Z';
function makeBackup(unknown = false) {
  const data = {
    quoteReleaseAuthorities: [], quoteReleases: [], quoteElectronicResponses: [],
    serviceBillingPlans: [], serviceBillingPeriods: [], serviceArticles: [], suppliers: [], purchaseDocuments: [],
    user: { id: 'journal-source' }, customers: [], expenses: [], auditLogs: [], invoiceNumberCounters: [],
    invoices: [{ id: 10, type: 'INVOICE', invoiceNumber: '2026-101', fileName: 'invoice.pdf', storedFileName: 'invoice.pdf',
      totalAmount: 25.01, status: 'PAID', issuanceState: 'ISSUED', paidAt: unknown ? null : paidAt, parsedData: { currency: 'EUR' } }],
    incomes: unknown ? [] : [{ id: 20, invoiceId: 10, description: 'Rechnung 2026-101', amount: 25.01, date: paidAt, taxRelevant: true }],
    paymentJournalEvents: [{ id: 30, invoiceId: 10, incomeId: unknown ? null : 20, amountCents: '2501', currency: 'EUR',
      paidAt: unknown ? null : paidAt, dateCertainty: unknown ? 'UNKNOWN' : 'ACTUAL', source: unknown ? 'LEGACY_IMPORT' : 'MANUAL',
      reference: 'bank-reference', idempotencyKey: 'payment-once', createdAt }],
  };
  return envelope(data);
}
function envelope<T extends Record<string, unknown>>(data: T) {
  return { version: '3.0', type: 'full', exportedAt: createdAt, data,
    manifest: createBackupManifest({ sourceUserId: 'journal-source', generatedAt: createdAt, data }) };
}
async function user(id: string) {
  await database.client.user.create({ data: { id, email: `${id}@backup.invalid`, password: 'unused' } });
}
const resolveFile = async () => new Uint8Array([37, 80, 68, 70]);

describe('immutable payment journal backup', () => {
  it('validates count and hash; restores links into only the target tenant and merges exactly once', async () => {
    await user('journal-target');
    const backup = makeBackup();
    const counts = preview.createBackupPreview(backup).counts;
    expect(counts.paymentJournalEvents).toBe(1);
    const first = await restore.restoreBackupData({ userId: 'journal-target', backup, overwrite: true, resolveFile });
    expect(first.paymentJournalEvents).toEqual({ imported: 1, skipped: 0 });
    const event = await database.client.paymentJournalEvent.findFirstOrThrow({ where: { userId: 'journal-target' }, include: { invoice: true, income: true } });
    expect(event).toMatchObject({ amountCents: '2501', currency: 'EUR', paidAt: new Date(paidAt), createdAt: new Date(createdAt) });
    expect(event.invoiceId).toBe(event.income?.invoiceId);
    expect(event.invoiceId).not.toBe(10);
    expect(event.incomeId).not.toBe(20);
    expect(event.income?.userId).toBe('journal-target');
    const second = await restore.restoreBackupData({ userId: 'journal-target', backup, overwrite: false, resolveFile });
    expect(second.paymentJournalEvents).toEqual({ imported: 0, skipped: 1 });
    expect(await database.client.income.count({ where: { userId: 'journal-target' } })).toBe(1);
    expect(await database.client.paymentJournalEvent.count({ where: { userId: 'journal-target' } })).toBe(1);
    const snapshot = await readBackupSnapshot('journal-target');
    expect(snapshot.data.paymentJournalEvents).toEqual([expect.objectContaining({ amountCents: '2501', paidAt: new Date(paidAt), userId: undefined })]);
    expect(() => JSON.stringify(snapshot.data)).not.toThrow();
    const tampered = makeBackup();
    tampered.data.paymentJournalEvents[0].amountCents = '2502';
    expect(() => restore.validateBackupForRestore(tampered)).toThrow(/Hash/u);
  });

  it('preserves unknown legacy dates without manufacturing Income, including repeated merges', async () => {
    await user('journal-unknown');
    const backup = makeBackup(true);
    await restore.restoreBackupData({ userId: 'journal-unknown', backup, overwrite: true, resolveFile });
    await restore.restoreBackupData({ userId: 'journal-unknown', backup, overwrite: false, resolveFile });
    expect(await database.client.paymentJournalEvent.findFirstOrThrow({ where: { userId: 'journal-unknown' } })).toMatchObject({ paidAt: null, incomeId: null, dateCertainty: 'UNKNOWN' });
    expect(await database.client.income.count({ where: { userId: 'journal-unknown' } })).toBe(0);
  });

  it.each(['LEGACY_INCOME', 'LEGACY_INVOICE'] as const)('preserves explicit historical date evidence: %s', async (dateCertainty) => {
    const target = `journal-${dateCertainty.toLowerCase()}`;
    await user(target);
    const backup = makeBackup();
    backup.data.paymentJournalEvents[0].source = 'LEGACY_IMPORT';
    backup.data.paymentJournalEvents[0].dateCertainty = dateCertainty;
    if (dateCertainty === 'LEGACY_INCOME') backup.data.invoices[0].paidAt = null;
    else {
      backup.data.incomes = [];
      backup.data.paymentJournalEvents[0].incomeId = null;
    }
    backup.data.invoices[0].invoiceNumber = '';
    const rebuilt = envelope(backup.data);
    await restore.restoreBackupData({ userId: target, backup: rebuilt, overwrite: true, resolveFile });
    const repeated = await restore.restoreBackupData({ userId: target, backup: rebuilt, overwrite: false, resolveFile });
    expect(repeated.paymentJournalEvents).toEqual({ imported: 0, skipped: 1 });
    expect(await database.client.invoice.count({ where: { userId: target } })).toBe(1);
    const event = await database.client.paymentJournalEvent.findFirstOrThrow({ where: { userId: target } });
    expect(event).toMatchObject({ paidAt: new Date(paidAt), source: 'LEGACY_IMPORT', dateCertainty });
    expect(await database.client.income.count({ where: { userId: target } })).toBe(dateCertainty === 'LEGACY_INCOME' ? 1 : 0);
  });

  it('maps cancelled paid invoices without dropping the original realized income', async () => {
    await user('journal-cancelled');
    const backup = makeBackup();
    backup.data.invoices[0].status = 'CANCELLED';
    const rebuilt = envelope(backup.data);
    await restore.restoreBackupData({ userId: 'journal-cancelled', backup: rebuilt, overwrite: true, resolveFile });
    const event = await database.client.paymentJournalEvent.findFirstOrThrow({ where: { userId: 'journal-cancelled' }, include: { invoice: true, income: true } });
    expect(event.invoice.status).toBe('CANCELLED');
    expect(event.income?.amount).toBe(25.01);
  });

  it.each([
    { dateCertainty: 'UNKNOWN', version: '2.0' },
    { dateCertainty: 'LEGACY_INVOICE', version: '2.0' },
    { dateCertainty: 'UNKNOWN', version: '3.0' },
    { dateCertainty: 'LEGACY_INVOICE', version: '3.0' },
  ])('rejects pre-journal $version Income merge into immutable $dateCertainty null projection', async ({ dateCertainty, version }) => {
    const target = `journal-null-merge-${dateCertainty}-${version.replace('.', '-')}`;
    await user(target);
    const initial = makeBackup(dateCertainty === 'UNKNOWN');
    initial.data.incomes = [];
    Object.assign(initial.data.paymentJournalEvents[0], { incomeId: null, source: 'LEGACY_IMPORT', dateCertainty });
    await restore.restoreBackupData({ userId: target, backup: envelope(initial.data), overwrite: true, resolveFile });
    const beforeInvoice = await database.client.invoice.findFirstOrThrow({ where: { userId: target } });
    const beforeEvent = await database.client.paymentJournalEvent.findFirstOrThrow({ where: { userId: target } });
    const beforeAudits = await database.client.auditLog.count({ where: { userId: target } });
    const older = makeBackup();
    older.data.paymentJournalEvents = [];
    older.data.invoices[0].paidAt = initial.data.invoices[0].paidAt;
    const source = envelope(older.data);
    source.manifest.schemaVersion = PRE_PAYMENT_JOURNAL_SCHEMA_VERSION; stripEmptyPaymentAdjustmentsForLegacy(source); stripCsvCatalogForLegacy(source);
    source.manifest.modelCoverage = source.manifest.modelCoverage.filter(entry => entry.model !== 'PaymentJournalEvent');
    const backup = version === '2.0' ? { version, data: older.data } : source;
    expect(() => restore.validateBackupForRestore(backup)).not.toThrow();
    await expect(restore.restoreBackupData({ userId: target, backup, overwrite: false, resolveFile })).rejects.toThrow(/unveränderlichen Zahlungsereignis/u);
    expect(await database.client.income.count({ where: { userId: target } })).toBe(0);
    expect(await database.client.paymentJournalEvent.findUniqueOrThrow({ where: { id: beforeEvent.id } })).toEqual(beforeEvent);
    expect(await database.client.invoice.findUniqueOrThrow({ where: { id: beforeInvoice.id } })).toEqual(beforeInvoice);
    expect(await database.client.auditLog.count({ where: { userId: target } })).toBe(beforeAudits);
    const snapshot = await readBackupSnapshot(target);
    const exported = { version: '3.0', data: snapshot.data, manifest: createBackupManifest({ sourceUserId: target, generatedAt: createdAt, data: snapshot.data }) };
    expect(() => restore.validateBackupForRestore(exported)).not.toThrow();
  });

  it.each(['2.0', '3.0'])('rejects ambiguous pre-journal %s Income merge even when amount/date match an event', async version => {
    const target = `journal-linked-legacy-merge-${version.replace('.', '-')}`;
    await user(target);
    await restore.restoreBackupData({ userId: target, backup: makeBackup(), overwrite: true, resolveFile });
    const before = await database.client.paymentJournalEvent.findFirstOrThrow({ where: { userId: target } });
    const older = makeBackup(); older.data.paymentJournalEvents = [];
    const source = envelope(older.data);
    source.manifest.schemaVersion = PRE_PAYMENT_JOURNAL_SCHEMA_VERSION; stripEmptyPaymentAdjustmentsForLegacy(source); stripCsvCatalogForLegacy(source);
    source.manifest.modelCoverage = source.manifest.modelCoverage.filter(entry => entry.model !== 'PaymentJournalEvent');
    const backup = version === '2.0' ? { version, data: older.data } : source;
    await expect(restore.restoreBackupData({ userId: target, backup, overwrite: false, resolveFile })).rejects.toThrow(/ohne Zahlungsidentitäten/u);
    expect(await database.client.income.count({ where: { userId: target } })).toBe(1);
    expect(await database.client.paymentJournalEvent.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
    const snapshot = await readBackupSnapshot(target);
    expect(() => restore.validateBackupForRestore({ version: '3.0', data: snapshot.data,
      manifest: createBackupManifest({ sourceUserId: target, generatedAt: createdAt, data: snapshot.data }) })).not.toThrow();
  });

  it.each([
    { version: '2.0', invoiceNumber: null }, { version: '3.0', invoiceNumber: null },
  ])('rejects ambiguous unnamed pre-journal $version ($invoiceNumber) merge after explicit legacy adoption', async ({ version, invoiceNumber }) => {
    const target = `journal-unnamed-adopted-${version.replace('.', '-')}-${invoiceNumber === null ? 'null' : 'empty'}`;
    await user(target);
    const older = makeBackup();
    const data = { ...older.data, invoices: older.data.invoices.map(invoice => ({ ...invoice, invoiceNumber })), paymentJournalEvents: [] };
    const source = envelope(data);
    source.manifest.schemaVersion = PRE_PAYMENT_JOURNAL_SCHEMA_VERSION; stripEmptyPaymentAdjustmentsForLegacy(source); stripCsvCatalogForLegacy(source);
    source.manifest.modelCoverage = source.manifest.modelCoverage.filter(entry => entry.model !== 'PaymentJournalEvent');
    const backup = version === '2.0' ? { version, data } : source;
    await restore.restoreBackupData({ userId: target, backup, overwrite: true, resolveFile });
    const beforeInvoice = await database.client.invoice.findFirstOrThrow({ where: { userId: target } });
    const beforeIncome = await database.client.income.findFirstOrThrow({ where: { userId: target } });
    await adoptLegacyPaidInvoice(target, beforeInvoice.id);
    const beforeEvent = await database.client.paymentJournalEvent.findFirstOrThrow({ where: { userId: target } });
    const beforeAudits = await database.client.auditLog.count({ where: { userId: target } });
    await expect(restore.restoreBackupData({ userId: target, backup, overwrite: false, resolveFile })).rejects.toThrow(/eindeutige.*Rechnungsidentität/u);
    expect(await database.client.invoice.findMany({ where: { userId: target } })).toEqual([beforeInvoice]);
    expect(await database.client.income.findMany({ where: { userId: target } })).toEqual([beforeIncome]);
    expect(await database.client.paymentJournalEvent.findMany({ where: { userId: target } })).toEqual([beforeEvent]);
    expect(await database.client.auditLog.count({ where: { userId: target } })).toBe(beforeAudits);
  });

  it.each(['2.0', '3.0'])('rejects whitespace-only pre-journal %s identity against an adopted null-number target', async version => {
    const target = `journal-whitespace-identity-${version.replace('.', '-')}`;
    await user(target);
    const older = makeBackup();
    const data = { ...older.data, invoices: older.data.invoices.map(invoice => ({ ...invoice, invoiceNumber: null })), paymentJournalEvents: [] };
    await restore.restoreBackupData({ userId: target, backup: { version: '2.0', data: legacyPaymentData(data) }, overwrite: true, resolveFile });
    const invoice = await database.client.invoice.findFirstOrThrow({ where: { userId: target } });
    await adoptLegacyPaidInvoice(target, invoice.id);
    const before = await readBackupSnapshot(target);
    const whitespaceData = { ...data, invoices: data.invoices.map(row => ({ ...row, invoiceNumber: '   ' })) };
    const source = envelope(whitespaceData);
    source.manifest.schemaVersion = PRE_PAYMENT_JOURNAL_SCHEMA_VERSION; stripEmptyPaymentAdjustmentsForLegacy(source); stripCsvCatalogForLegacy(source);
    source.manifest.modelCoverage = source.manifest.modelCoverage.filter(entry => entry.model !== 'PaymentJournalEvent');
    const backup = version === '2.0' ? { version, data: whitespaceData } : source;
    await expect(restore.restoreBackupData({ userId: target, backup, overwrite: false, resolveFile })).rejects.toThrow(/eindeutige.*Rechnungsidentität/u);
    expect((await readBackupSnapshot(target)).data).toEqual(before.data);
    expect((await database.client.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).invoiceNumber).toBeNull();
  });

  it('preserves unrelated numbered pre-journal imports into a journal-bearing tenant', async () => {
    const target = 'journal-unrelated-numbered';
    await user(target);
    await restore.restoreBackupData({ userId: target, backup: makeBackup(), overwrite: true, resolveFile });
    const beforeEvent = await database.client.paymentJournalEvent.findFirstOrThrow({ where: { userId: target } });
    const older = makeBackup();
    older.data.invoices[0].invoiceNumber = '2026-unrelated';
    older.data.incomes[0].description = 'Unrelated invoice';
    const backup = { version: '2.0', data: legacyPaymentData({ ...older.data, paymentJournalEvents: [] }) };
    const result = await restore.restoreBackupData({ userId: target, backup, overwrite: false, resolveFile });
    expect(result.invoices).toEqual({ imported: 1, skipped: 0 });
    expect(result.incomes).toEqual({ imported: 1, skipped: 0 });
    expect(await database.client.invoice.count({ where: { userId: target } })).toBe(2);
    expect(await database.client.income.count({ where: { userId: target } })).toBe(2);
    expect(await database.client.paymentJournalEvent.findMany({ where: { userId: target } })).toEqual([beforeEvent]);
  });

  it('rejects empty-string legacy identity and rolls back earlier customer imports', async () => {
    const target = 'journal-empty-identity';
    await user(target);
    await restore.restoreBackupData({ userId: target, backup: makeBackup(), overwrite: true, resolveFile });
    const before = await readBackupSnapshot(target);
    const older = makeBackup();
    const data = { ...older.data, customers: [{ id: 55, name: 'Must roll back' }],
      invoices: older.data.invoices.map(invoice => ({ ...invoice, invoiceNumber: '' })), paymentJournalEvents: [] };
    await expect(restore.restoreBackupData({ userId: target, backup: { version: '2.0', data: legacyPaymentData(data) }, overwrite: false, resolveFile })).rejects.toThrow(/eindeutige.*Rechnungsidentität/u);
    expect((await readBackupSnapshot(target)).data).toEqual(before.data);
  });

  it('allows unnamed pre-journal merge into an empty tenant despite journal history in another tenant', async () => {
    const target = 'journal-unrelated-empty';
    await user(target);
    const older = makeBackup();
    const data = { ...older.data, invoices: older.data.invoices.map(invoice => ({ ...invoice, invoiceNumber: null })), paymentJournalEvents: [] };
    const result = await restore.restoreBackupData({ userId: target, backup: { version: '2.0', data: legacyPaymentData(data) }, overwrite: false, resolveFile });
    expect(result.invoices).toEqual({ imported: 1, skipped: 0 });
    expect(result.incomes).toEqual({ imported: 1, skipped: 0 });
    expect(await database.client.paymentJournalEvent.count({ where: { userId: target } })).toBe(0);
  });

  it('rejects destructive overwrite of journal targets, including pre-journal backup versions', async () => {
    const before = await database.client.paymentJournalEvent.findFirstOrThrow({ where: { userId: 'journal-target' } });
    const old = envelope({ quoteReleaseAuthorities: [], quoteReleases: [], quoteElectronicResponses: [], serviceBillingPlans: [], serviceBillingPeriods: [], serviceArticles: [], suppliers: [], purchaseDocuments: [], user: { id: 'journal-source' }, customers: [], expenses: [], incomes: [], invoices: [], auditLogs: [], invoiceNumberCounters: [] });
    old.manifest.schemaVersion = PRE_PAYMENT_JOURNAL_SCHEMA_VERSION; stripEmptyPaymentAdjustmentsForLegacy(old); stripCsvCatalogForLegacy(old);
    old.manifest.modelCoverage = old.manifest.modelCoverage.filter(entry => entry.model !== 'PaymentJournalEvent');
    expect(() => restore.validateBackupForRestore(old)).not.toThrow();
    for (const backup of [old, makeBackup(), { version: '2.0', data: legacyPaymentData(old.data) }]) {
      await expect(restore.restoreBackupData({ userId: 'journal-target', backup, overwrite: true, resolveFile })).rejects.toThrow(/unveränderliche Zahlungsereignisse/u);
    }
    expect(await database.client.paymentJournalEvent.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
  });

  it.each([
    { amountCents: '02501' }, { amountCents: '2501.0' }, { amountCents: '-1' }, { amountCents: '0' },
    { amountCents: '9007199254740992' }, { currency: 'USD' }, { invoiceId: 999 }, { incomeId: 999 },
    { paidAt: '2026-02-30T00:00:00.000Z' }, { source: 'BANK_IMPORT' }, { dateCertainty: 'UNKNOWN' }, { reference: '' },
  ])('rejects malformed source evidence before any write: %s', (patch) => {
    const backup = makeBackup();
    Object.assign(backup.data.paymentJournalEvents[0], patch);
    expect(() => restore.validateBackupForRestore(envelope(backup.data))).toThrow();
  });

  it('rejects duplicate event key/Income and mismatched Income without changing target state', async () => {
    const backup = makeBackup();
    backup.data.paymentJournalEvents.push({ ...backup.data.paymentJournalEvents[0], id: 31 });
    expect(() => restore.validateBackupForRestore(envelope(backup.data))).toThrow(/doppelt/u);
    const mismatch = makeBackup();
    mismatch.data.incomes[0].amount = 25;
    expect(() => restore.validateBackupForRestore(envelope(mismatch.data))).toThrow(/Zahlungsbetrag/u);
    const collision = makeBackup();
    collision.data.paymentJournalEvents[0].reference = 'different-reference';
    const before = await database.client.paymentJournalEvent.findFirstOrThrow({ where: { userId: 'journal-target' } });
    await expect(restore.restoreBackupData({ userId: 'journal-target', backup: envelope(collision.data), overwrite: false, resolveFile })).rejects.toThrow(/Kollision/u);
    expect(await database.client.paymentJournalEvent.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
    expect(await database.client.income.count({ where: { userId: 'journal-target' } })).toBe(1);
  });

  it('rejects unmanifested legacy event arrays and pre-journal manifest injection', () => {
    const backup = makeBackup();
    expect(() => restore.validateBackupForRestore({ version: '2.0', data: legacyPaymentData(backup.data) })).toThrow(/Legacy-Backups/u);
    backup.manifest.schemaVersion = PRE_PAYMENT_JOURNAL_SCHEMA_VERSION; stripEmptyPaymentAdjustmentsForLegacy(backup); stripCsvCatalogForLegacy(backup);
    backup.manifest.modelCoverage = backup.manifest.modelCoverage.filter(entry => entry.model !== 'PaymentJournalEvent');
    expect(() => restore.validateBackupForRestore(backup)).toThrow(/ungebundenen Zahlungsereignisse/u);
  });
});
