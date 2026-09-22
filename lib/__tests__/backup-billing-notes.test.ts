import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';
import { createBackupManifest, PRE_BILLING_NOTES_SCHEMA_VERSION } from '@/lib/backup-manifest';
import { readBackupSnapshot } from '@/lib/backup-snapshot';
import { createBackupPreview } from '@/lib/backup-preview';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));

let database: ReturnType<typeof createTestDatabase>;
let restore: typeof import('@/lib/backup-restore');

beforeAll(async () => {
  database = createTestDatabase();
  state.client = database.client;
  restore = await import('@/lib/backup-restore');
}, 40_000);

afterAll(async () => { await database?.cleanup(); });

function makeBackup(options: { sourceUserId?: string; mismatchedInvoiceCustomer?: boolean; unassignedNote?: boolean; duplicateNote?: boolean } = {}) {
  const sourceUserId = options.sourceUserId ?? 'billing-source';
  const data = {
    user: { id: sourceUserId, email: `${sourceUserId}@backup.test`, name: 'Source' },
    customers: [
      { id: 10, name: 'Billing customer', internalNote: 'Call after 10:00', noteVisibility: 'EDITOR', createdAt: '2026-01-01T00:00:00.000Z' },
      ...(options.mismatchedInvoiceCustomer ? [{ id: 11, name: 'Other customer', createdAt: '2026-01-01T00:00:00.000Z' }] : []),
    ],
    invoices: [{
      id: 20,
      type: 'INVOICE',
      fileName: 'invoice.pdf',
      storedFileName: 'invoice.pdf',
      invoiceNumber: '2026-99',
      uploadedAt: '2026-01-01T00:00:00.000Z',
      invoiceDate: '2026-01-01T00:00:00.000Z',
      parsedData: {},
      status: 'DRAFT',
      issuanceState: 'UNKNOWN',
      customerId: options.mismatchedInvoiceCustomer ? 11 : 10,
    }],
    billingNotes: [{
      id: 30,
      customerId: 10,
      invoiceId: options.unassignedNote ? null : 20,
      serviceDate: '2026-01-02T00:00:00.000Z',
      description: 'Beratung',
      quantity: 2.5,
      unit: 'Stunde',
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    }, ...(options.duplicateNote ? [{
      id: 31,
      customerId: 10,
      invoiceId: options.unassignedNote ? null : 20,
      serviceDate: '2026-01-02T00:00:00.000Z',
      description: 'Beratung',
      quantity: 2.5,
      unit: 'Stunde',
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    }] : [])],
    incomes: [],
    auditLogs: [],
    invoiceNumberCounters: [],
  };
  return {
    version: '3.0',
    type: 'full',
    exportedAt: '2026-01-03T00:00:00.000Z',
    manifest: createBackupManifest({ sourceUserId, generatedAt: '2026-01-03T00:00:00.000Z', data }),
    data,
  };
}

describe('billing-note backup compatibility', () => {
  it('exports customer context and billing notes in one snapshot', async () => {
    await database.client.user.create({ data: { id: 'snapshot-billing', email: 'snapshot-billing@backup.test', password: 'fixture' } });
    const customer = await database.client.customer.create({ data: {
      userId: 'snapshot-billing',
      name: 'Snapshot customer',
      internalNote: 'Editor only',
      noteVisibility: 'EDITOR',
    } });
    await database.client.billingNote.create({ data: {
      userId: 'snapshot-billing',
      customerId: customer.id,
      serviceDate: new Date('2026-01-02T00:00:00.000Z'),
      description: 'Support',
      quantity: 1.5,
      unit: 'Stunde',
    } });
    const snapshot = await readBackupSnapshot('snapshot-billing');
    expect(snapshot.data.customers).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Snapshot customer', internalNote: 'Editor only', noteVisibility: 'EDITOR' }),
    ]));
    expect(snapshot.data.billingNotes).toEqual(expect.arrayContaining([
      expect.objectContaining({ customerId: customer.id, description: 'Support', quantity: 1.5, userId: undefined }),
    ]));
  });

  it('restores notes with mapped customer and invoice IDs and preserves customer fields', async () => {
    await database.client.user.create({ data: { id: 'billing-target', email: 'billing-target@backup.test', password: 'fixture' } });
    const result = await restore.restoreBackupData({
      userId: 'billing-target',
      overwrite: true,
      backup: makeBackup(),
      resolveFile: async () => new Uint8Array([37, 80, 68, 70]),
    });
    expect(result.billingNotes).toEqual({ imported: 1, skipped: 0 });
    const customer = await database.client.customer.findFirstOrThrow({ where: { userId: 'billing-target' } });
    expect(customer.internalNote).toBe('Call after 10:00');
    expect(customer.noteVisibility).toBe('EDITOR');
    const invoice = await database.client.invoice.findFirstOrThrow({ where: { userId: 'billing-target' } });
    const note = await database.client.billingNote.findFirstOrThrow({ where: { userId: 'billing-target' } });
    expect(note.customerId).toBe(customer.id);
    expect(note.invoiceId).toBe(invoice.id);
    expect(note.quantity).toBe(2.5);
  });

  it('reports note counts through the schema-validated preview and manifest hash', () => {
    const backup = makeBackup();
    const preview = createBackupPreview(backup);
    expect(preview.counts.billingNotes).toBe(1);
    expect(preview.manifest?.modelCoverage.find((entry) => entry.model === 'BillingNote')).toMatchObject({
      key: 'billingNotes', count: 1,
    });
  });

  it('applies the business-date and quantity input contract during restore validation', () => {
    const quantityBackup = makeBackup();
    (quantityBackup.data.billingNotes[0] as unknown as Record<string, unknown>).quantity = true;
    quantityBackup.manifest = createBackupManifest({ sourceUserId: 'billing-source', generatedAt: quantityBackup.exportedAt, data: quantityBackup.data });
    expect(() => restore.validateBackupForRestore(quantityBackup)).toThrow(/quantity|Menge/u);

    const dateBackup = makeBackup();
    (dateBackup.data.billingNotes[0] as unknown as Record<string, unknown>).serviceDate = '2026-01-02T01:00:00.000Z';
    dateBackup.manifest = createBackupManifest({ sourceUserId: 'billing-source', generatedAt: dateBackup.exportedAt, data: dateBackup.data });
    expect(() => restore.validateBackupForRestore(dateBackup)).toThrow(/Mitternacht/u);

    const quoteBackup = makeBackup();
    (quoteBackup.data.invoices[0] as unknown as Record<string, unknown>).type = 'QUOTE';
    quoteBackup.manifest = createBackupManifest({ sourceUserId: 'billing-source', generatedAt: quoteBackup.exportedAt, data: quoteBackup.data });
    expect(() => restore.validateBackupForRestore(quoteBackup)).toThrow(/Rechnung referenzieren/u);
  });

  it('maps notes through merge deduplication without using source IDs as target IDs', async () => {
    await database.client.user.create({ data: { id: 'billing-merge', email: 'billing-merge@backup.test', password: 'fixture' } });
    const customer = await database.client.customer.create({ data: { userId: 'billing-merge', name: 'Billing customer' } });
    const invoice = await database.client.invoice.create({
      data: { userId: 'billing-merge', customerId: customer.id, fileName: 'existing.pdf', storedFileName: 'existing.pdf', invoiceNumber: '2026-99', parsedData: {} },
    });
    const result = await restore.restoreBackupData({
      userId: 'billing-merge',
      overwrite: false,
      backup: makeBackup(),
      resolveFile: async () => new Uint8Array([37, 80, 68, 70]),
    });
    expect(result.customers.skipped).toBe(1);
    expect(result.invoices.skipped).toBe(1);
    const note = await database.client.billingNote.findFirstOrThrow({ where: { userId: 'billing-merge' } });
    expect(note.customerId).toBe(customer.id);
    expect(note.invoiceId).toBe(invoice.id);
    expect(note.customerId).not.toBe(10);
    expect(note.invoiceId).not.toBe(20);
  });

  it('deduplicates repeated merges by source provenance while retaining identical source rows and later claims', async () => {
    await database.client.user.create({ data: { id: 'billing-repeat', email: 'billing-repeat@backup.test', password: 'fixture' } });
    const first = await restore.restoreBackupData({
      userId: 'billing-repeat',
      overwrite: false,
      backup: makeBackup({ unassignedNote: true, duplicateNote: true }),
      resolveFile: async () => new Uint8Array([37, 80, 68, 70]),
    });
    expect(first.billingNotes).toEqual({ imported: 2, skipped: 0 });
    const targetInvoice = await database.client.invoice.findFirstOrThrow({ where: { userId: 'billing-repeat' } });
    const initialNotes = await database.client.billingNote.findMany({ where: { userId: 'billing-repeat' }, orderBy: { id: 'asc' } });
    expect(initialNotes).toHaveLength(2);
    await database.client.billingNote.update({ where: { id: initialNotes[0].id }, data: { invoiceId: targetInvoice.id } });

    const repeated = await restore.restoreBackupData({
      userId: 'billing-repeat',
      overwrite: false,
      backup: makeBackup({ unassignedNote: true, duplicateNote: true }),
      resolveFile: async () => new Uint8Array([37, 80, 68, 70]),
    });
    expect(repeated.billingNotes).toEqual({ imported: 0, skipped: 2 });
    const afterRepeat = await database.client.billingNote.findMany({ where: { userId: 'billing-repeat' }, orderBy: { id: 'asc' } });
    expect(afterRepeat).toHaveLength(2);
    expect(afterRepeat.find((note) => note.id === initialNotes[0].id)?.invoiceId).toBe(targetInvoice.id);
  });

  it('rejects mismatched source customer/invoice references before any overwrite mutation', async () => {
    await database.client.user.create({ data: { id: 'billing-reject', email: 'billing-reject@backup.test', password: 'fixture' } });
    const existing = await database.client.customer.create({ data: { userId: 'billing-reject', name: 'Keep me' } });
    await expect(restore.restoreBackupData({
      userId: 'billing-reject',
      overwrite: true,
      backup: makeBackup({ mismatchedInvoiceCustomer: true }),
      resolveFile: async () => new Uint8Array([37, 80, 68, 70]),
    })).rejects.toThrow(/Kunden-ID/u);
    expect(await database.client.customer.findUnique({ where: { id: existing.id } })).toEqual(existing);
    expect(await database.client.billingNote.count({ where: { userId: 'billing-reject' } })).toBe(0);
  });

  it('accepts old v3 manifests that predate BillingNote coverage and absent note fields', () => {
    const backup = makeBackup();
    const { billingNotes: _billingNotes, ...legacyData } = backup.data;
    const legacy = { ...backup, data: legacyData };
    legacy.manifest.modelCoverage = legacy.manifest.modelCoverage.filter((entry) => entry.model !== 'BillingNote');
    legacy.manifest.schemaVersion = PRE_BILLING_NOTES_SCHEMA_VERSION;
    expect(() => restore.validateBackupForRestore(legacy)).not.toThrow();

    const injected = makeBackup();
    injected.manifest.modelCoverage = injected.manifest.modelCoverage.filter((entry) => entry.model !== 'BillingNote');
    injected.manifest.schemaVersion = PRE_BILLING_NOTES_SCHEMA_VERSION;
    expect(() => restore.validateBackupForRestore(injected)).toThrow(/ungebundenen BillingNotes/u);
  });
});
