import { createBackupManifest } from './helpers/backup';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestDatabase } from './helpers/database';
import { CUSTOMER_FIELD_LIMITS } from '@/lib/customer-field-contract';
import { autoMapColumns, parseImportCsv } from '@/lib/data-import-contract';
import { confirmDataImport, previewDataImport, type ImportRequest } from '@/lib/data-import-service';
import { readBackupSnapshot } from '@/lib/backup-snapshot';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
let db: ReturnType<typeof createTestDatabase>;
let storageRoot: string;
let restore: typeof import('@/lib/backup-restore');
let preview: typeof import('@/lib/backup-preview');
const stamp = '2026-10-21T06:55:00.000Z';
function envelope(data: Record<string, unknown>, owner: string) { return { version: '3.0', data, manifest: createBackupManifest({ sourceUserId: owner, generatedAt: stamp, data }) }; }
function input(csv: string): ImportRequest { return { kind: 'customers', csv, mapping: autoMapColumns('customers', parseImportCsv(csv).headers) }; }
async function importCustomers(owner: string, request: ImportRequest, requestId: string) { const reviewed = await previewDataImport(owner, request); return confirmDataImport(owner, request, requestId, reviewed.fingerprint); }
const fields = Object.keys(CUSTOMER_FIELD_LIMITS) as (keyof typeof CUSTOMER_FIELD_LIMITS)[];
const boundary = Object.fromEntries(fields.map(field => [field, field === 'email' ? `${'e'.repeat(CUSTOMER_FIELD_LIMITS.email - '@example.test'.length)}@example.test` : (field === 'phone' || field === 'zipCode' ? '1' : 'x').repeat(CUSTOMER_FIELD_LIMITS[field])])) as Record<keyof typeof CUSTOMER_FIELD_LIMITS, string>;
const boundaryCsv = (rows: typeof boundary[]) => fields.join(';') + '\n' + rows.map(row => fields.map(field => row[field]).join(';')).join('\n');
beforeAll(async () => {
  db = createTestDatabase(); state.client = db.client;
  await db.client.user.createMany({ data: ['boundary-source', 'boundary-target', 'identity-source', 'identity-empty', 'identity-one', 'identity-ambiguous', 'identity-collision', 'identity-source-ambiguous'].map(id => ({ id, email: `${id}@test.invalid`, password: 'fixture' })) });
  storageRoot = await mkdtemp(path.join(tmpdir(), 'bivaro-csv-boundaries-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(storageRoot);
  try { restore = await import('@/lib/backup-restore'); preview = await import('@/lib/backup-preview'); } finally { cwd.mockRestore(); }
}, 40_000);
afterAll(async () => { await db?.cleanup(); if (storageRoot) await rm(storageRoot, { recursive: true, force: true }); });

describe('backup-safe authoritative customer field boundaries', () => {
  it('imports every exact field boundary and restores it byte-for-byte; overlong fields remain invalid review rows', async () => {
    const invalid = fields.map((field, index) => ({ ...boundary, name: `Invalid field ${index}`, [field]: boundary[field] + 'x' }));
    const request = input(boundaryCsv([boundary, ...invalid]));
    const reviewed = await previewDataImport('boundary-source', request);
    expect(reviewed.counts).toEqual({ ready: 1, invalid: 8, duplicate: 0 });
    for (const row of reviewed.rows.slice(1)) expect(row.errors).toEqual(expect.arrayContaining([expect.stringMatching(/höchstens \d+ Zeichen/)]));
    const imported = await confirmDataImport('boundary-source', request, 'customer-boundary-requests', reviewed.fingerprint);
    expect(imported).toMatchObject({ imported: 1, skipped: 8 });
    const snapshot = await readBackupSnapshot('boundary-source');
    const backup = envelope(snapshot.data, 'boundary-source');
    expect(preview.createBackupPreview(backup).counts.customers).toBe(1);
    expect((await restore.restoreBackupData({ userId: 'boundary-target', backup, overwrite: false })).customers.imported).toBe(1);
    const restored = await db.client.customer.findFirstOrThrow({ where: { userId: 'boundary-target' } });
    expect(Object.fromEntries(fields.map(field => [field, restored[field]]))).toEqual(boundary);
  });
  it.each(fields)('rejects inherited overlong %s during backup preview, before restore writes or file staging', async field => {
    const snapshot = await readBackupSnapshot('boundary-source');
    const data = structuredClone(snapshot.data);
    (data.customers as Record<string, unknown>[])[0][field] = boundary[field] + 'x';
    const backup = envelope(data, 'boundary-source');
    const resolveFile = vi.fn(async () => new Uint8Array([37, 80, 68, 70]));
    const before = await db.client.customer.findMany({ where: { userId: 'boundary-target' } });
    expect(() => preview.createBackupPreview(backup)).toThrow(new RegExp(`customers\\[0\\].${field}`));
    await expect(restore.restoreBackupData({ userId: 'boundary-target', backup, overwrite: true, resolveFile })).rejects.toThrow(new RegExp(`customers\\[0\\].${field}`));
    expect(resolveFile).not.toHaveBeenCalled();
    expect(await db.client.customer.findMany({ where: { userId: 'boundary-target' } })).toEqual(before);
  });
});

let identityBackup: ReturnType<typeof envelope>;
const fileBytes = async () => new Uint8Array([37, 80, 68, 70]);
async function assertRelations(owner: string) {
  const customers = await db.client.customer.findMany({ where: { userId: owner }, orderBy: { address: 'asc' } });
  expect(customers.map(customer => customer.address)).toEqual(['Weg 1', 'Weg 2']);
  expect(customers[0].id).not.toBe(customers[1].id);
  const invoices = await db.client.invoice.findMany({ where: { userId: owner }, include: { customer: true }, orderBy: { invoiceNumber: 'asc' } });
  expect(invoices.map(invoice => invoice.customer?.address)).toEqual(['Weg 1', 'Weg 2']);
  const notes = await db.client.billingNote.findMany({ where: { userId: owner }, include: { customer: true, invoice: true }, orderBy: { description: 'asc' } });
  expect(notes.map(note => note.customer.address)).toEqual(['Weg 1', 'Weg 2']);
  expect(notes.every(note => note.invoice?.customerId === note.customerId)).toBe(true);
}
describe('same-name customer identity survives CSV and backup merge', () => {
  it('imports Muster at Weg 1 and Weg 2, then preserves both source IDs and invoice/note mappings in an empty restore', async () => {
    const request = input('Name;Straße;PLZ;Stadt\nMuster;Weg 1;12345;Bonn\nMuster;Weg 2;12345;Bonn');
    const imported = await importCustomers('identity-source', request, 'customer-identity-source');
    expect(imported.imported).toBe(2);
    for (const [index, customerId] of imported.createdIds.entries()) {
      const invoice = await db.client.invoice.create({ data: { userId: 'identity-source', customerId, fileName: `synthetic-${index}.pdf`, storedFileName: `synthetic-${index}.pdf`, invoiceNumber: `2026-80${index + 1}`, parsedData: {}, status: 'DRAFT', issuanceState: 'UNISSUED' } });
      await db.client.billingNote.create({ data: { userId: 'identity-source', customerId, invoiceId: invoice.id, serviceDate: new Date('2026-10-21T00:00:00.000Z'), description: `Notiz ${index + 1}`, quantity: 1, unit: 'Stunde' } });
    }
    identityBackup = envelope((await readBackupSnapshot('identity-source')).data, 'identity-source');
    expect(preview.createBackupPreview(identityBackup).counts.customers).toBe(2);
    expect((await restore.restoreBackupData({ userId: 'identity-empty', backup: identityBackup, overwrite: false, resolveFile: fileBytes })).customers).toEqual({ imported: 2, skipped: 0 });
    await assertRelations('identity-empty');
  });
  it('repeated merge keeps two distinct customers and their invoice/note relations', async () => {
    const restored = await restore.restoreBackupData({ userId: 'identity-empty', backup: identityBackup, overwrite: false, resolveFile: fileBytes });
    expect(restored.customers).toEqual({ imported: 0, skipped: 2 });
    expect(restored.invoices).toEqual({ imported: 0, skipped: 2 });
    expect(restored.billingNotes).toEqual({ imported: 0, skipped: 2 });
    await assertRelations('identity-empty');
  });
  it('a target containing only Weg 1 gets the distinct Weg 2 record, not a name-only collapse', async () => {
    const existing = await db.client.customer.create({ data: { userId: 'identity-one', name: 'Muster', address: 'Weg 1', zipCode: '12345', city: 'Bonn' } });
    const result = await restore.restoreBackupData({ userId: 'identity-one', backup: identityBackup, overwrite: false, resolveFile: fileBytes });
    expect(result.customers).toEqual({ imported: 1, skipped: 1 });
    expect(await db.client.customer.findUnique({ where: { id: existing.id } })).toMatchObject({ address: 'Weg 1' });
    await assertRelations('identity-one');
    expect((await restore.restoreBackupData({ userId: 'identity-one', backup: identityBackup, overwrite: false, resolveFile: fileBytes })).customers).toEqual({ imported: 0, skipped: 2 });
    await assertRelations('identity-one');
  });
  it('ambiguous target identity fails before any business write or file resolver call', async () => {
    await db.client.customer.createMany({ data: [1, 2].map(() => ({ userId: 'identity-ambiguous', name: 'Muster', address: 'Weg 1', zipCode: '12345', city: 'Bonn' })) });
    const before = await db.client.customer.findMany({ where: { userId: 'identity-ambiguous' } });
    const resolveFile = vi.fn(fileBytes);
    await expect(restore.restoreBackupData({ userId: 'identity-ambiguous', backup: identityBackup, overwrite: false, resolveFile })).rejects.toThrow(/Mehrdeutige Kundenidentität/);
    expect(resolveFile).not.toHaveBeenCalled();
    expect(await db.client.customer.findMany({ where: { userId: 'identity-ambiguous' } })).toEqual(before);
    expect(await db.client.invoice.count({ where: { userId: 'identity-ambiguous' } })).toBe(0);
    expect(await db.client.billingNote.count({ where: { userId: 'identity-ambiguous' } })).toBe(0);
    expect(await db.client.auditLog.count({ where: { userId: 'identity-ambiguous' } })).toBe(0);
  });
  it('multiple source IDs cannot reuse one exact target identity', async () => {
    await db.client.customer.create({ data: { userId: 'identity-source-ambiguous', name: 'Muster', address: 'Weg 1', zipCode: '12345', city: 'Bonn' } });
    const data = structuredClone(identityBackup.data);
    (data.customers as Record<string, unknown>[])[1].address = 'Weg 1';
    const backup = envelope(data, 'identity-source');
    const resolveFile = vi.fn(fileBytes);
    await expect(restore.restoreBackupData({ userId: 'identity-source-ambiguous', backup, overwrite: false, resolveFile })).rejects.toThrow(/Mehrdeutige Kundenidentität/);
    expect(resolveFile).not.toHaveBeenCalled();
    expect(await db.client.customer.count({ where: { userId: 'identity-source-ambiguous' } })).toBe(1);
    expect(await db.client.invoice.count({ where: { userId: 'identity-source-ambiguous' } })).toBe(0);
    expect(await db.client.auditLog.count({ where: { userId: 'identity-source-ambiguous' } })).toBe(0);
  });
  it('an existing invoice for the wrong same-name customer fails before writes or file staging', async () => {
    const customer = await db.client.customer.create({ data: { userId: 'identity-collision', name: 'Muster', address: 'Weg 1', zipCode: '12345', city: 'Bonn' } });
    const existing = await db.client.invoice.create({ data: { userId: 'identity-collision', customerId: customer.id, fileName: 'existing.pdf', storedFileName: 'existing.pdf', invoiceNumber: '2026-802', parsedData: {} } });
    const resolveFile = vi.fn(fileBytes);
    await expect(restore.restoreBackupData({ userId: 'identity-collision', backup: identityBackup, overwrite: false, resolveFile })).rejects.toThrow(/anderen.*Kunden/);
    expect(resolveFile).not.toHaveBeenCalled();
    expect(await db.client.customer.count({ where: { userId: 'identity-collision' } })).toBe(1);
    expect(await db.client.invoice.findUnique({ where: { id: existing.id } })).toEqual(existing);
    expect(await db.client.billingNote.count({ where: { userId: 'identity-collision' } })).toBe(0);
    expect(await db.client.auditLog.count({ where: { userId: 'identity-collision' } })).toBe(0);
  });
});
