import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { quoteCreateFingerprintForInvoice } from '@/lib/quote-create-request';
import { validateQuoteCreateIdentityFields } from '@/lib/document-numbering-policy-backup';
import { quoteCreateReceiptsFromBackup, type QuoteCreateReceiptBackup } from '@/lib/quote-create-receipt-backup';
import { validateQuoteCreateBackup, validateQuoteCreateRestoreTargets } from '@/lib/quote-create-backup';
import { restoreBackupData, validateBackupForRestore } from '@/lib/backup-restore';
import { readBackupSnapshot } from '@/lib/backup-snapshot';
import { BANK_MAPPING_PROFILES_SCHEMA_VERSION, hashBytes, validateBackupManifest } from '@/lib/backup-manifest';
import { createBackupManifest } from './helpers/backup';
import { stripEmptyBankImportsForLegacy } from './helpers/backup-schema';

const state = vi.hoisted(() => ({ client: null as unknown, files: new Map<string, { bytes: Uint8Array; version: string }>(), serial: 0 }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/upload-path', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/upload-path')>(),
  getTenantUploadPath: (owner: string, name: string) => `${owner}/${name}`,
  writeTenantFile: vi.fn(async (owner: string, _name: string, bytes: Uint8Array) => { const name = `restored-${++state.serial}.pdf`; state.files.set(`${owner}/${name}`, { bytes, version: 'new' }); return name; }),
  deleteTenantFile: vi.fn(async (owner: string, name: string) => { state.files.delete(`${owner}/${name}`); }),
}));
vi.mock('@/lib/backup-snapshot', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/backup-snapshot')>(),
  getBackupFileVersion: async (path: string) => state.files.get(path)?.version ?? null,
  readStableBackupFile: async (path: string) => { const file = state.files.get(path); if (!file) return null; const { createHash } = await import('node:crypto'); return { bytes: Buffer.from(file.bytes), sha256: createHash('sha256').update(file.bytes).digest('hex'), sourceVersion: file.version }; },
}));
afterEach(() => { state.files.clear(); vi.clearAllMocks(); });
const at = '2026-10-24T00:00:00.000Z', bytes = new Uint8Array([37, 80, 68, 70, 45, 49]);
type Row = Record<string, unknown>;
function quote(): Row {
  const row: Row = { id: 1, type: 'QUOTE', invoiceNumber: 'AN-2026-0001', fileName: 'synthetic-quote.pdf', storedFileName: 'synthetic-quote.pdf', invoiceDate: at, validUntil: null, totalAmount: 10, parsedData: { createdBy: 'bivaro', items: [{ description: 'Synthetische Leistung', quantity: 1, amount: 10 }] }, customerId: null, status: 'DRAFT', issuanceState: 'UNKNOWN', quoteFollowUpOn: null, quoteResponseNote: null, quoteCreateRequestId: randomUUID() };
  row.quoteCreateFingerprint = quoteCreateFingerprintForInvoice(row); return row;
}
function receipt(invoice: Row, pdf = bytes): QuoteCreateReceiptBackup { return { requestId: String(invoice.quoteCreateRequestId), fingerprint: String(invoice.quoteCreateFingerprint), pdfSha256: hashBytes(pdf), invoiceId: Number(invoice.id), createdAt: at }; }
function pack(invoices: Row[] = [], receipts = invoices.map(row => receipt(row))) {
  const data = { user: { id: 'source-owner' }, invoices, quoteCreateReceipts: receipts, customers: [] as Row[], suppliers: [], serviceArticles: [], purchaseDocuments: [], paymentJournalEvents: [], serviceProjects: [], billingNotes: [], purchaseValidationReports: [], serviceBillingPlans: [], serviceBillingPeriods: [], auditLogs: [], invoiceNumberCounters: [] };
  return { version: '3.0', type: 'json', data, manifest: createBackupManifest({ sourceUserId: 'source-owner', generatedAt: at, data }) };
}
function memoryClient(initial: { invoices?: Row[]; receipts?: Row[]; policies?: Row[]; onTransaction?: () => void } = {}) {
  const tables: Record<string, Row[]> = { invoice: structuredClone(initial.invoices ?? []), quoteCreateReceipt: structuredClone(initial.receipts ?? []), documentNumberingPolicy: structuredClone(initial.policies ?? []) };
  let next = 100;
  function matches(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([key, expected]) => {
      if (key.includes('_') && expected && typeof expected === 'object') return matches(row, expected as Row);
      if (expected && typeof expected === 'object') { const condition = expected as Row; if ('not' in condition) return row[key] !== condition.not; if ('in' in condition) return (condition.in as unknown[]).includes(row[key]); return true; }
      return row[key] === expected;
    });
  }
  const project = (row: Row, select?: Row) => select ? Object.fromEntries(Object.keys(select).filter(key => select[key] === true).map(key => [key, row[key]])) : row;
  const transaction = vi.fn(async (work: (tx: unknown) => Promise<unknown>) => { const before = structuredClone(tables); try { initial.onTransaction?.(); return await work(client); } catch (error) { for (const key of Object.keys(tables)) delete tables[key]; Object.assign(tables, before); throw error; } });
  const client = new Proxy({}, { get: (_target, model: string) => {
    if (model === '$transaction') return transaction;
    tables[model] ??= [];
    return {
      findMany: async ({ where, select, include }: { where?: Row; select?: Row; include?: Row } = {}) => tables[model].filter(row => matches(row, where)).map(row => project(model === 'quoteCreateReceipt' && include?.invoice ? { ...row, invoice: tables.invoice.find(invoice => invoice.id === row.invoiceId && invoice.userId === row.invoiceUserId) ?? null } : row, select)),
      findFirst: async ({ where, select }: { where?: Row; select?: Row }) => { const row = tables[model].find(value => matches(value, where)); return row ? project(row, select) : null; },
      findUnique: async ({ where, select }: { where?: Row; select?: Row }) => { if (model === 'user') return { id: 'target-owner' }; const row = tables[model].find(value => matches(value, where)); return row ? project(row, select) : null; },
      count: async () => 0,
      create: async ({ data }: { data: Row }) => { const row = { id: ++next, ...(model === 'quoteCreateReceipt' ? { invoiceUserId: null, invoiceId: null } : {}), ...data }; tables[model].push(row); return row; },
      update: async ({ where, data }: { where: Row; data: Row }) => { const row = tables[model].find(value => matches(value, where))!; Object.assign(row, data); return row; },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => { const rows = tables[model].filter(value => matches(value, where)); rows.forEach(row => Object.assign(row, data)); return { count: rows.length }; },
      deleteMany: async ({ where }: { where: Row }) => { const rows = tables[model].filter(row => matches(row, where)); if (model === 'invoice') for (const proof of tables.quoteCreateReceipt) if (rows.some(row => row.id === proof.invoiceId)) Object.assign(proof, { invoiceId: null, invoiceUserId: null }); tables[model] = tables[model].filter(row => !matches(row, where)); return { count: rows.length }; },
      upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => { const row = tables[model].find(value => matches(value, where)); if (row) { Object.assign(row, update); return row; } tables[model].push(create); return create; },
    };
  } });
  return { client, tables, transaction };
}
function liveTarget(incoming: Row) {
  const target = { ...incoming, id: 50, userId: 'target-owner', storedFileName: 'retained-original.pdf', invoiceDate: new Date(at) };
  const proof = { ...receipt(incoming), userId: 'target-owner', invoiceId: 50, invoiceUserId: 'target-owner', createdAt: new Date(at) };
  state.files.set('target-owner/retained-original.pdf', { bytes, version: 'original-v1' });
  return { target, proof };
}

describe('portable durable quote-create receipts', () => {
  it('allows legacy absence but requires the separate receipt collection for the new capability', () => {
    expect(validateQuoteCreateIdentityFields({ type: 'QUOTE' }, false)).toEqual({ quoteCreateRequestId: null, quoteCreateFingerprint: null });
    expect(() => quoteCreateReceiptsFromBackup({ quoteCreateReceipts: [] }, false)).toThrow(/Älteres Backupschema/);
    const backup = pack([quote()]); backup.manifest.schemaVersion = BANK_MAPPING_PROFILES_SCHEMA_VERSION; stripEmptyBankImportsForLegacy(backup);
    expect(() => validateBackupManifest(backup.manifest, backup.data)).toThrow(/Älteres Backupschema/);
    expect(() => validateQuoteCreateBackup({ invoices: [], quoteCreateReceipts: undefined }, true)).toThrow();
  });
  it.each([(row: Row) => { row.quoteCreateRequestId = null; }, (row: Row) => { row.quoteCreateFingerprint = null; }, (row: Row) => { row.quoteCreateRequestId = 'invalid'; }, (row: Row) => { row.quoteCreateFingerprint = 'invalid'; }, (row: Row) => { row.type = 'INVOICE'; }, (row: Row) => { row.totalAmount = 20; }])('rejects malformed or altered request identity %#', mutate => {
    const row = quote(); mutate(row); expect(() => validateQuoteCreateIdentityFields(row, true)).toThrow();
  });
  it('rejects duplicate IDs, missing links and owner/raw fields in portable receipts', () => {
    const row = quote(), proof = receipt(row);
    for (const data of [{ invoices: [row], quoteCreateReceipts: [proof, proof] }, { invoices: [row], quoteCreateReceipts: [] }, { invoices: [row], quoteCreateReceipts: [{ ...proof, userId: 'foreign-owner' }] }, { invoices: [row], quoteCreateReceipts: [{ ...proof, invoiceId: null }] }]) expect(() => validateQuoteCreateBackup(data, true)).toThrow();
  });
  it('compares tenant-scoped customer business identity, not database-local IDs', async () => {
    const incoming = { ...quote(), customerId: 10 }, proof = receipt(incoming), target = { ...incoming, id: 50, customerId: 800 }, customer = { id: 10, name: 'Synthetischer Kunde', email: 'synthetic@example.test' }, reads: unknown[] = [];
    const client = { invoice: { findMany: async (query: unknown) => { reads.push(query); return [target]; } }, customer: { findFirst: async (query: unknown) => { reads.push(query); return { ...customer, id: 800 }; } } } as unknown as Pick<Prisma.TransactionClient, 'invoice' | 'customer'>;
    expect(await validateQuoteCreateRestoreTargets(client, 'target-owner', [incoming], [customer], [{ ...proof, invoiceId: 50 }], [proof])).toHaveLength(1);
    expect(reads[0]).toMatchObject({ where: { userId: 'target-owner' } }); expect(reads[1]).toMatchObject({ where: { userId: 'target-owner', id: 800 } });
  });
  it('allows legacy overwrite and retains omitted target requests as non-reactivatable tombstones', async () => {
    const incoming = quote(), { target, proof } = liveTarget(incoming), memory = memoryClient({ invoices: [target], receipts: [proof] }); state.client = memory.client;
    await restoreBackupData({ userId: 'target-owner', backup: { version: '2.0', data: {} }, overwrite: true });
    expect(memory.tables.invoice).toEqual([]); expect(memory.tables.quoteCreateReceipt[0]).toMatchObject({ invoiceId: null, invoiceUserId: null, requestId: incoming.quoteCreateRequestId });
  });
  it('never resurrects a retired target request or partially writes an older linked source', async () => {
    const incoming = quote(), memory = memoryClient({ receipts: [{ ...receipt(incoming), userId: 'target-owner', invoiceId: null, invoiceUserId: null, createdAt: new Date(at) }] }); state.client = memory.client;
    await expect(restoreBackupData({ userId: 'target-owner', backup: pack([incoming]), overwrite: false, resolveFile: async () => bytes })).rejects.toThrow(/gelöschtes Angebot|reaktivieren/);
    expect(memory.transaction).not.toHaveBeenCalled(); expect(memory.tables.invoice).toEqual([]); expect(state.files.size).toBe(0);
  });
  it('preserves the exact active target PDF during matching overwrite, ignoring malicious replacement bytes', async () => {
    const incoming = quote(), { target, proof } = liveTarget(incoming), memory = memoryClient({ invoices: [target], receipts: [proof] }); state.client = memory.client;
    const resolveFile = vi.fn(async () => new Uint8Array([99, 98, 97]));
    await restoreBackupData({ userId: 'target-owner', backup: pack([incoming]), overwrite: true, resolveFile });
    expect(resolveFile).not.toHaveBeenCalled(); expect(memory.tables.invoice).toHaveLength(1); expect(memory.tables.invoice[0].storedFileName).toBe('retained-original.pdf');
    expect(state.files.get('target-owner/retained-original.pdf')?.bytes).toEqual(bytes); expect(memory.tables.quoteCreateReceipt[0].invoiceId).toBe(memory.tables.invoice[0].id);
  });
  it('detects original-file version drift and rolls back instead of applying a partial restore', async () => {
    const incoming = quote(), { target, proof } = liveTarget(incoming), memory = memoryClient({ invoices: [target], receipts: [proof], onTransaction: () => state.files.set('target-owner/retained-original.pdf', { bytes, version: 'changed-v2' }) }); state.client = memory.client;
    await expect(restoreBackupData({ userId: 'target-owner', backup: pack([incoming]), overwrite: true, resolveFile: async () => bytes })).rejects.toThrow(/Original wurde.*verändert/);
    expect(memory.tables.invoice[0].id).toBe(50); expect(memory.tables.quoteCreateReceipt[0].invoiceId).toBe(50); expect(state.files.size).toBe(1);
  });
  it('rejects conflicting original hashes before any transaction or original replacement', async () => {
    const incoming = quote(), { target, proof } = liveTarget(incoming), memory = memoryClient({ invoices: [target], receipts: [proof] }); state.client = memory.client;
    const backup = pack([incoming], [{ ...receipt(incoming), pdfSha256: 'f'.repeat(64) }]);
    await expect(restoreBackupData({ userId: 'target-owner', backup, overwrite: true, resolveFile: async () => bytes })).rejects.toThrow(/Nachweis weicht/);
    expect(memory.transaction).not.toHaveBeenCalled(); expect(state.files.get('target-owner/retained-original.pdf')?.bytes).toEqual(bytes);
  });
  it('writes newly owned original bytes and portable receipts after a cross-tenant restore', async () => {
    const incoming = quote(), memory = memoryClient(); state.client = memory.client;
    await restoreBackupData({ userId: 'target-owner', backup: pack([incoming]), overwrite: false, resolveFile: async () => bytes });
    expect(memory.tables.invoice[0]).toMatchObject({ userId: 'target-owner', quoteCreateRequestId: incoming.quoteCreateRequestId });
    expect(memory.tables.quoteCreateReceipt[0]).toMatchObject({ userId: 'target-owner', invoiceUserId: 'target-owner', invoiceId: memory.tables.invoice[0].id, pdfSha256: hashBytes(bytes) });
    expect(state.files.get(`target-owner/${memory.tables.invoice[0].storedFileName}`)?.bytes).toEqual(bytes);
    const snapshot = await readBackupSnapshot('target-owner'); expect(snapshot.data.quoteCreateReceipts).toEqual([{ ...receipt(incoming), invoiceId: memory.tables.invoice[0].id }]);
  });
  it('rolls back and cleans staged files after a later numbering conflict without damaging target state', async () => {
    const incoming = quote(), backup = pack([incoming]); Object.assign(backup.data, { documentNumberingPolicies: [{ type: 'INVOICE', revision: 1, formatVersion: 1, prefix: 'RE-', includeYear: true, sequenceWidth: 4, startSequence: 1, effectiveYear: 2026, createdAt: at }] }); backup.manifest = createBackupManifest({ sourceUserId: 'source-owner', generatedAt: at, data: backup.data });
    const memory = memoryClient({ policies: [{ userId: 'target-owner', type: 'INVOICE', revision: 1, formatVersion: 1, prefix: 'OTHER-', includeYear: true, sequenceWidth: 4, startSequence: 1, effectiveYear: 2026, createdAt: new Date(at) }] }); state.client = memory.client;
    await expect(restoreBackupData({ userId: 'target-owner', backup, overwrite: false, resolveFile: async () => bytes })).rejects.toThrow(/Nummernformat-Revision weicht/);
    expect(memory.tables.invoice).toEqual([]); expect(memory.tables.quoteCreateReceipt).toEqual([]); expect(state.files.size).toBe(0);
  });
  it('requires the saved original hash in a complete archive manifest, while JSON remains explicitly metadata-only', () => {
    const backup = pack([quote()]);
    expect(() => validateBackupForRestore(backup)).not.toThrow();
    backup.type = 'full';
    expect(() => validateBackupForRestore(backup)).toThrow(/kein Original-PDF/);
    backup.manifest = createBackupManifest({ sourceUserId: 'source-owner', generatedAt: at, data: backup.data, fileManifest: [{ kind: 'invoice', sourceName: 'synthetic-quote.pdf', bytes: bytes.length, sha256: hashBytes(bytes) }] });
    expect(() => validateBackupForRestore(backup)).not.toThrow();
    backup.manifest.fileManifest[0].sha256 = 'f'.repeat(64);
    expect(() => validateBackupForRestore(backup)).toThrow(/Originalhash/);
  });
  it('restores and exports a consumed-request tombstone without requiring an invoice or PDF', async () => {
    const proof = { ...receipt(quote()), invoiceId: null }, memory = memoryClient(); state.client = memory.client;
    await restoreBackupData({ userId: 'target-owner', backup: pack([], [proof]), overwrite: false });
    expect(memory.tables.invoice).toEqual([]);
    expect(memory.tables.quoteCreateReceipt[0]).toMatchObject({ userId: 'target-owner', invoiceId: null, invoiceUserId: null, requestId: proof.requestId });
    const snapshot = await readBackupSnapshot('target-owner'); expect(snapshot.data.quoteCreateReceipts).toEqual([proof]);
  });
  it('preserves an existing live link when a merged source only contains a tombstone', async () => {
    const incoming = quote(), { target, proof } = liveTarget(incoming), memory = memoryClient({ invoices: [target], receipts: [proof] }); state.client = memory.client;
    await restoreBackupData({ userId: 'target-owner', backup: pack([], [{ ...receipt(incoming), invoiceId: null }]), overwrite: false });
    expect(memory.tables.quoteCreateReceipt[0].invoiceId).toBe(50); expect(memory.tables.invoice[0].storedFileName).toBe('retained-original.pdf');
  });
  it('does not allow a new linked receipt whose supplied original bytes fail its saved hash', async () => {
    const memory = memoryClient(); state.client = memory.client;
    await expect(restoreBackupData({ userId: 'target-owner', backup: pack([quote()]), overwrite: false, resolveFile: async () => new Uint8Array([1, 2, 3]) })).rejects.toThrow(/Angebots-Originals/);
    expect(memory.transaction).not.toHaveBeenCalled(); expect(memory.tables.invoice).toEqual([]); expect(state.files.size).toBe(0);
  });
});
