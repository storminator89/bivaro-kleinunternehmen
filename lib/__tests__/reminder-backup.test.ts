import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestDatabase } from './helpers/database';
import { createBackupManifest, COMBINED_PHOTO_ANNUAL_SCHEMA_VERSION } from '@/lib/backup-manifest';
import { readBackupSnapshot } from '@/lib/backup-snapshot';
import { recordFullPayment } from '@/lib/payment-journal/service';
import { previewReminder, recordReminder } from '@/lib/reminder-workbench';
import { restoredReminderKey, validateReminderBackupFields } from '@/lib/reminder-backup';

const state = vi.hoisted(() => ({ client: null as ReturnType<typeof createTestDatabase>['client'] | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
let db: ReturnType<typeof createTestDatabase>;
let directory: string;
let restore: typeof import('@/lib/backup-restore');
const owner = 'reminder-backup-source';
const target = 'reminder-backup-target';
beforeAll(async () => {
  db = createTestDatabase(); state.client = db.client;
  directory = await mkdtemp(path.join(tmpdir(), 'bivaro-reminder-backup-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
  try { restore = await import('@/lib/backup-restore'); } finally { cwd.mockRestore(); }
  await db.client.user.createMany({ data: [owner, target].map(id => ({ id, email: `${id}@example.invalid`, password: 'fixture' })) });
}, 40_000);
afterAll(async () => { await db?.cleanup(); if (directory) await rm(directory, { recursive: true, force: true }); });
const backupOf = async (userId: string) => {
  const { data } = await readBackupSnapshot(userId);
  return { version: '3.0', type: 'full', exportedAt: '2026-10-21T12:00:00.000Z', data, manifest: createBackupManifest({ sourceUserId: userId, generatedAt: '2026-10-21T12:00:00.000Z', data }) };
};

describe('confirmed reminder backup evidence and tenant remap', () => {
  it('round trips the frozen snapshot and rekeys commands, replaying a merge without duplicates', async () => {
    const invoice = await db.client.invoice.create({ data: { userId: owner, fileName: 'balance.pdf', storedFileName: 'balance.pdf', invoiceNumber: 'BALANCE-BACKUP-120', totalAmount: 120, type: 'INVOICE', status: 'SENT', parsedData: { currency: 'EUR' } } });
    await recordFullPayment(owner, invoice.id, { amount: '40', currency: 'EUR', paidAt: '2026-10-01', source: 'MANUAL', reference: 'Source bank reference', expectedPaidCents: '0', idempotencyKey: 'backup-real-payment' });
    const preview = await previewReminder(owner, invoice.id);
    const reminder = await recordReminder(owner, invoice.id, { expectedBalanceVersion: preview.balanceVersion, idempotencyKey: 'source-reminder-command' });
    const backup = await backupOf(owner);
    expect(() => restore.validateBackupForRestore(backup)).not.toThrow();
    const own = await restore.restoreBackupData({ userId: owner, backup, overwrite: false, resolveFile: async () => new Uint8Array([37, 80, 68, 70]) });
    expect(own.reminders).toEqual({ imported: 0, skipped: 1 });
    expect(await db.client.reminder.count({ where: { userId: owner } })).toBe(1);
    const apply = () => restore.restoreBackupData({ userId: target, backup, overwrite: false, resolveFile: async () => new Uint8Array([37, 80, 68, 70]) });
    expect((await apply()).reminders).toEqual({ imported: 1, skipped: 0 });
    const restored = await db.client.reminder.findFirstOrThrow({ where: { userId: target }, include: { invoice: true } });
    expect(restored.balanceSnapshot).toEqual(reminder.balanceSnapshot);
    expect(restored.invoiceId).not.toBe(invoice.id); expect(restored.invoice.userId).toBe(target);
    expect(restored.idempotencyKey).toMatch(/^restored:[a-f0-9]{64}$/u); expect(restored.idempotencyKey).not.toBe(reminder.idempotencyKey);
    expect((await apply()).reminders).toEqual({ imported: 0, skipped: 1 });
    const later = { ...backup, exportedAt: '2026-10-22T12:00:00.000Z', manifest: createBackupManifest({ sourceUserId: owner, generatedAt: '2026-10-22T12:00:00.000Z', data: backup.data }) };
    expect(later.manifest.backupId).not.toBe(backup.manifest.backupId);
    const laterResult = await restore.restoreBackupData({ userId: target, backup: later, overwrite: false, resolveFile: async () => new Uint8Array([37, 80, 68, 70]) });
    expect(laterResult.reminders).toEqual({ imported: 0, skipped: 1 });
    expect(await db.client.reminder.count({ where: { userId: target } })).toBe(1);
    // A normal re-export after restore must carry the same portable source identity.
    const reexport = await backupOf(target);
    const returned = await restore.restoreBackupData({ userId: owner, backup: reexport, overwrite: false, resolveFile: async () => new Uint8Array([37, 80, 68, 70]) });
    expect(returned.reminders).toEqual({ imported: 0, skipped: 1 });
    expect(await db.client.reminder.count({ where: { userId: owner } })).toBe(1);
    expect((await restore.restoreBackupData({ userId: target, backup: reexport, overwrite: false, resolveFile: async () => new Uint8Array([37, 80, 68, 70]) })).reminders).toEqual({ imported: 0, skipped: 1 });
    const changedData = structuredClone(backup.data);
    (changedData.reminders as Record<string, unknown>[])[0].fee = 7;
    const changed = { ...backup, data: changedData, manifest: createBackupManifest({ sourceUserId: owner, generatedAt: '2026-10-24T12:00:00.000Z', data: changedData }) };
    await expect(restore.restoreBackupData({ userId: target, backup: changed, overwrite: false, resolveFile: async () => new Uint8Array([37, 80, 68, 70]) })).rejects.toThrow(/widerspricht bestehender Restbetragsbestätigung/u);
    expect(await db.client.reminder.count({ where: { userId: target } })).toBe(1);
    // Historical source version is retained, never accepted as a new destination confirmation.
    await expect(recordReminder(target, restored.invoiceId, { expectedBalanceVersion: preview.balanceVersion, idempotencyKey: 'new-target-command' })).rejects.toMatchObject({ code: 'PAYMENT_STATE_CHANGED' });
  });
  it('deduplicates historical confirmed keyless rows across identical and later exports', async () => {
    const sourceTenant = 'historical-keyless-source'; const targetTenant = 'historical-keyless-target';
    await db.client.user.createMany({ data: [sourceTenant, targetTenant].map(id => ({ id, email: `${id}@example.invalid`, password: 'fixture' })) });
    const invoice = await db.client.invoice.create({ data: { userId: sourceTenant, fileName: 'keyless.pdf', storedFileName: 'keyless.pdf', invoiceNumber: 'KEYLESS-120', totalAmount: 120, type: 'INVOICE', status: 'SENT', parsedData: { currency: 'EUR' } } });
    const preview = await previewReminder(sourceTenant, invoice.id);
    // Valid historical233279 shape: confirmed zero-payment row without a command key.
    await db.client.reminder.create({ data: { userId: sourceTenant, invoiceId: invoice.id, dueDate: new Date('2026-11-01T00:00:00.000Z'), fee: 5, balanceSnapshot: { version: 1, balanceVersion: preview.balanceVersion, totalCents: '12000', paidCents: '0', openCents: '12000', paymentHistory: [], dueDays: 14 } } });
    const backup = await backupOf(sourceTenant);
    expect((await restore.restoreBackupData({ userId: sourceTenant, backup, overwrite: false, resolveFile: async () => new Uint8Array([37, 80, 68, 70]) })).reminders).toEqual({ imported: 0, skipped: 1 });
    expect(await db.client.reminder.count({ where: { userId: sourceTenant } })).toBe(1);
    const apply = (backup: unknown, overwrite = false) => restore.restoreBackupData({ userId: targetTenant, backup, overwrite, resolveFile: async () => new Uint8Array([37, 80, 68, 70]) });
    expect((await apply(backup, true)).reminders).toEqual({ imported: 1, skipped: 0 });
    expect((await apply(backup)).reminders).toEqual({ imported: 0, skipped: 1 });
    const later = { ...backup, manifest: createBackupManifest({ sourceUserId: sourceTenant, generatedAt: '2026-10-23T12:00:00.000Z', data: backup.data }) };
    expect((await apply(later)).reminders).toEqual({ imported: 0, skipped: 1 });
    const records = await db.client.reminder.findMany({ where: { userId: targetTenant } });
    expect(records).toHaveLength(1); expect(records[0].idempotencyKey).toMatch(/^restored:[a-f0-9]{64}$/u); expect(records[0].fee).toBe(5);
    await expect(apply(later, true)).rejects.toThrow(/bestätigte Mahn-Restbeträge/u);
  });
  it('fails closed on pre-existing ambiguous aliases instead of deleting immutable history', async () => {
    const tenant = 'ambiguous-reminder-target';
    await db.client.user.create({ data: { id: tenant, email: `${tenant}@example.invalid`, password: 'fixture' } });
    const invoice = await db.client.invoice.create({ data: { userId: tenant, fileName: 'ambiguous.pdf', storedFileName: 'ambiguous.pdf', invoiceNumber: 'AMBIGUOUS-120', totalAmount: 120, status: 'SENT', parsedData: { currency: 'EUR' } } });
    const preview = await previewReminder(tenant, invoice.id);
    const original = await recordReminder(tenant, invoice.id, { expectedBalanceVersion: preview.balanceVersion, idempotencyKey: 'original-alias-command', fee: 5 });
    await db.client.reminder.create({ data: { userId: tenant, invoiceId: invoice.id, reminderLevel: original.reminderLevel, fee: original.fee, notes: original.notes, dueDate: original.dueDate, createdAt: original.createdAt, sentAt: original.sentAt, balanceSnapshot: original.balanceSnapshot!, idempotencyKey: restoredReminderKey(original.idempotencyKey, tenant, original.id) } });
    const backup = await backupOf(tenant);
    await expect(restore.restoreBackupData({ userId: tenant, backup, overwrite: false, resolveFile: async () => new Uint8Array([37, 80, 68, 70]) })).rejects.toThrow(/mehrdeutige Quellidentitäten/u);
    const retained = await db.client.reminder.findMany({ where: { userId: tenant } });
    expect(retained).toHaveLength(2); expect(retained.reduce((sum, row) => sum + row.fee, 0)).toBe(10);
  });
  it('refuses older schema evidence and prevents overwrite from erasing confirmed history', async () => {
    const backup = await backupOf(owner);
    const downgraded = structuredClone(backup); downgraded.manifest.schemaVersion = COMBINED_PHOTO_ANNUAL_SCHEMA_VERSION;
    expect(() => restore.validateBackupForRestore(downgraded)).toThrow(/Restbetragsbestätigung/u);
    const legacyData = { ...backup.data, reminders: [] };
    const old = { version: '3.0', data: legacyData, manifest: createBackupManifest({ sourceUserId: owner, generatedAt: '2026-10-21T12:00:00.000Z', data: legacyData }) };
    old.manifest.schemaVersion = COMBINED_PHOTO_ANNUAL_SCHEMA_VERSION;
    old.manifest.modelCoverage = old.manifest.modelCoverage.filter(entry => !['AiProviderSettings', 'ServiceArticle', 'DataImportBatch'].includes(entry.model));
    await expect(restore.restoreBackupData({ userId: target, backup: old, overwrite: true, resolveFile: async () => null })).rejects.toThrow(/bestätigte Mahn-Restbeträge/u);
    expect(await db.client.reminder.count({ where: { userId: target } })).toBe(1);
  });
  it('fails closed for unknown fields, arithmetic mismatch and uncertain history', () => {
    const snapshot = { version: 1, balanceVersion: 'a'.repeat(64), totalCents: '12000', paidCents: '4000', openCents: '8000', dueDays: 14, paymentHistory: [{ amountCents: '4000', paidAt: '2026-10-01T00:00:00.000Z', reference: 'bank' }] };
    expect(() => validateReminderBackupFields({ id: 10, balanceSnapshot: snapshot, idempotencyKey: 'valid-command-key' }, true, 'fixture')).not.toThrow();
    for (const invalid of [{ ...snapshot, openCents: '9000' }, { ...snapshot, paymentHistory: [] }, { ...snapshot, futureFeeEvidence: 'do not discard' }]) expect(() => validateReminderBackupFields({ id: 10, balanceSnapshot: invalid }, true, 'fixture')).toThrow();
    expect(() => validateReminderBackupFields({ futureReminderEvidence: true }, true, 'fixture')).toThrow(/Daten verlieren/u);
    expect(() => validateReminderBackupFields({ idempotencyKey: 'without-snapshot' }, true, 'fixture')).toThrow(/ohne bestätigten/u);
    expect(() => validateReminderBackupFields({ balanceSnapshot: snapshot }, true, 'fixture')).toThrow(/stabile Quell-ID/u);
    expect(() => restoredReminderKey(null, undefined, 10)).toThrow(/Quellherkunft/u);
    expect(() => restoredReminderKey(null, owner, 0)).toThrow(/Quellherkunft/u);
    expect(() => restoredReminderKey('restored:not-portable', owner, 10)).toThrow(/Wiederherstellungs-Identität/u);
  });
});
