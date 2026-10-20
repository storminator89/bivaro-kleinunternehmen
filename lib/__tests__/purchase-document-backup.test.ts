import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { NextRequest } from 'next/server';
import { createTestDatabase } from './helpers/database';
import { createBackupManifest, hashBytes, PRE_PURCHASE_DOCUMENTS_SCHEMA_VERSION, validateBackupManifest } from '@/lib/backup-manifest';
import type { PurchaseParsePreview } from '@/lib/purchase-documents/types';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, userId: 'incoming-backup-source', failFinalAudit: false }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({
  requireUserId: async () => state.userId,
  UnauthorizedError: class extends Error {},
  unauthorizedResponse: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/audit-log', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/audit-log')>();
  return {
    ...actual,
    auditBackup: vi.fn(),
    auditSecurityEvent: vi.fn(),
    createFinancialAuditLog: (async (...args: Parameters<typeof actual.createFinancialAuditLog>) => {
      if (state.failFinalAudit && args[0].entityType === 'Backup') throw new Error('fixture-final-audit-failure');
      return actual.createFinancialAuditLog(...args);
    }) as typeof actual.createFinancialAuditLog,
  };
});

let database: ReturnType<typeof createTestDatabase>;
let root: string;
let storage: typeof import('@/lib/upload-path');
let restore: typeof import('@/lib/backup-restore');
let fullExport: typeof import('@/app/api/backup/full/route');
let fullRestore: typeof import('@/app/api/backup/full/restore/route');
let jsonExport: typeof import('@/app/api/backup/route');
let incoming: typeof import('@/app/api/purchase-documents/route');
let createBackupPreview: typeof import('@/lib/backup-preview')['createBackupPreview'];
let readBackupSnapshot: typeof import('@/lib/backup-snapshot')['readBackupSnapshot'];

beforeAll(async () => {
  database = createTestDatabase();
  state.client = database.client;
  root = await mkdtemp(path.join(tmpdir(), 'bivaro-incoming-backup-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
  try {
    storage = await import('@/lib/upload-path');
    ({ createBackupPreview } = await import('@/lib/backup-preview'));
    ({ readBackupSnapshot } = await import('@/lib/backup-snapshot'));
    restore = await import('@/lib/backup-restore');
    fullExport = await import('@/app/api/backup/full/route');
    fullRestore = await import('@/app/api/backup/full/restore/route');
    jsonExport = await import('@/app/api/backup/route');
    incoming = await import('@/app/api/purchase-documents/route');
  } finally { cwd.mockRestore(); }
}, 40_000);

afterAll(async () => {
  state.failFinalAudit = false;
  await database?.cleanup();
  if (root) await rm(root, { recursive: true, force: true });
});

const at = new Date('2026-10-20T00:00:00.000Z');
const party = (name: string) => ({ name, email: null, address: null, zipCode: null, city: null, country: null, addressLines: [] });
const preview = (): PurchaseParsePreview => ({
  extractionStatus: 'PARSED', validationStatus: 'NOT_VALIDATED', format: 'UBL', documentType: 'INVOICE', documentTypeCode: '380',
  currency: 'EUR', invoiceNumber: 'SUP-17', invoiceDate: at.toISOString(), dueDate: null,
  grossAmount: '119.00', dueAmount: '119', prepaidAmount: '0', roundingAmount: '0', netAmount: '100', taxAmount: '19',
  sellerInfo: party('Supplier'), buyerInfo: party('Buyer, not a Customer'), lineItems: [],
  parserWarnings: [{ code: 'NOT_VALIDATED', message: 'Extraction only.' }], approvalSupported: true,
});
async function user(id: string) {
  await database.client.user.create({ data: { id, email: `${id}@backup.test`, password: 'fixture' } });
}
async function sources(id: string) {
  await user(id);
  const created = [];
  for (const [index, reviewStatus] of ['REVIEW', 'DISMISSED', 'BOOKED'].entries()) {
    const bytes = Buffer.from(`%PDF-1.7\noriginal-${id}-${index}`);
    const storedFileName = await storage.writeTenantFile(id, `source-${index}.pdf`, bytes);
    const expense = reviewStatus === 'BOOKED' ? await database.client.expense.create({ data: {
      userId: id, description: 'Confirmed source expense', amount: 119, date: at, category: 'Büromaterial', taxRelevant: true,
      taxDeductiblePercentage: 100, storedReceiptFileName: storedFileName, receiptFileName: `source-${index}.pdf`,
    } }) : null;
    const document = await database.client.purchaseDocument.create({ data: {
      userId: id, originalFileName: `source-${index}.pdf`, storedFileName, originalSha256: hashBytes(bytes), originalByteCount: bytes.length,
      mediaType: 'application/pdf', uploadRequestId: randomUUID(), uploadedAt: at, updatedAt: at,
      parseStatus: reviewStatus === 'BOOKED' ? 'PARSED' : 'FAILED', parseErrorCode: reviewStatus === 'BOOKED' ? null : 'NO_EMBEDDED_XML',
      ...(reviewStatus === 'BOOKED' ? { parsedData: preview(), parserVersion: 'purchase-preview-v1', supplierName: 'Supplier', invoiceNumber: 'SUP-17', invoiceDate: at, totalAmount: 119, currency: 'EUR' } : {}),
      reviewStatus, revision: reviewStatus === 'REVIEW' ? 0 : 1,
      expenseId: expense?.id,
      ...(expense ? { approvalRequestId: randomUUID(), approvalFingerprint: 'a'.repeat(64), approvedAt: at } : {}),
      ...(reviewStatus === 'DISMISSED' ? { dismissedAt: at, dismissalReason: 'Not for ledger' } : {}),
    } });
    created.push({ ...document, bytes });
  }
  await database.client.auditLog.create({ data: { userId: id, action: 'CREATE', entityType: 'PurchaseDocument', entityId: String(created[0].id), createdAt: at } });
  return created;
}
async function exported(id: string) {
  state.userId = id;
  const response = await fullExport.GET();
  expect(response.status, response.status === 200 ? '' : await response.clone().text()).toBe(200);
  const bytes = await response.arrayBuffer();
  const zip = await JSZip.loadAsync(bytes);
  const backup = JSON.parse(await zip.file('backup.json')!.async('string'));
  return { bytes, zip, backup };
}
async function restoreZip(id: string, bytes: ArrayBuffer) {
  state.userId = id;
  const form = new FormData();
  form.append('file', new File([bytes], 'sources.zip', { type: 'application/zip' }));
  return fullRestore.POST(new NextRequest('http://localhost/api/backup/full/restore', { method: 'POST', body: form }));
}
function refreshManifest(backup: ReturnType<typeof JSON.parse>) {
  backup.manifest = createBackupManifest({ sourceUserId: backup.data.user.id, generatedAt: backup.exportedAt, data: backup.data, fileManifest: backup.manifest.fileManifest });
}

describe('incoming originals backup and restore', () => {
  it('roundtrips actual intake-generated exact/unsupported and oversized-metadata snapshots with original bytes', async () => {
    const sourceUser = 'incoming-generated-source', targetUser = 'incoming-generated-target';
    await user(sourceUser); await user(targetUser); state.userId = sourceUser;
    const originals: Array<{ id: number; bytes: Buffer; amount: string | null }> = [];
    for (const [index, amount] of ['90071992547409.91', '100.000000000000000001', null].entries()) {
      const currency = amount === null ? 'A'.repeat(3_000) : 'EUR';
      const value = amount ?? '119.00';
      const bytes = Buffer.from(`<Invoice><ID>GENERATED-${index}</ID><IssueDate>2026-10-20</IssueDate><DocumentCurrencyCode>${currency}</DocumentCurrencyCode><LegalMonetaryTotal><TaxInclusiveAmount>${value}</TaxInclusiveAmount><PayableAmount>${value}</PayableAmount></LegalMonetaryTotal></Invoice>`);
      const form = new FormData(); form.append('file', new File([bytes], `generated-${index}.xml`, { type: 'application/xml' })); form.append('uploadRequestId', randomUUID());
      const response = await incoming.POST(new NextRequest('http://localhost/api/purchase-documents', { method: 'POST', body: form }));
      expect(response.status).toBe(201); const document = (await response.json()).document;
      if (amount === null) expect(document).toMatchObject({ parseStatus: 'FAILED', parseErrorCode: 'PREVIEW_LIMIT_EXCEEDED', preview: null });
      else expect(document.preview).toMatchObject({ grossAmount: amount, dueAmount: amount, approvalSupported: false });
      originals.push({ id: document.id, bytes, amount });
    }
    const archive = await exported(sourceUser);
    expect(createBackupPreview(archive.backup).counts.purchaseDocuments).toBe(3);
    expect((await restoreZip(targetUser, archive.bytes)).status).toBe(200);
    const restored = await database.client.purchaseDocument.findMany({ where: { userId: targetUser }, orderBy: { originalFileName: 'asc' } });
    expect(restored).toHaveLength(3);
    for (const [index, record] of restored.entries()) {
      expect(await readFile(storage.getTenantUploadPath(targetUser, record.storedFileName))).toEqual(originals[index].bytes);
      expect(record.originalSha256).toBe(hashBytes(originals[index].bytes));
      if (originals[index].amount === null) expect(record).toMatchObject({ parseStatus: 'FAILED', parseErrorCode: 'PREVIEW_LIMIT_EXCEEDED', parsedData: null });
      else expect(record.parsedData).toMatchObject({ grossAmount: originals[index].amount, dueAmount: originals[index].amount, approvalSupported: false });
    }
    expect(await database.client.expense.count({ where: { userId: targetUser } })).toBe(0);
  });

  it('roundtrips failed/dismissed/booked originals losslessly with one shared receipt payload and target ownership', async () => {
    const source = await sources('incoming-backup-source');
    await user('incoming-backup-target');
    await user('incoming-backup-unrelated');
    await database.client.expense.create({ data: { userId: 'incoming-backup-unrelated', description: 'Untouched', amount: 7, date: at } });
    const { bytes, zip, backup } = await exported('incoming-backup-source');
    expect(backup.stats.purchaseDocuments).toBe(3);
    expect(createBackupPreview(backup).counts.purchaseDocuments).toBe(3);
    expect(backup.manifest.modelCoverage.find((entry: { model: string }) => entry.model === 'PurchaseDocument')).toMatchObject({ key: 'purchaseDocuments', count: 3 });
    expect(Object.values(zip.files).filter((file) => !file.dir && file.name !== 'backup.json')).toHaveLength(3);
    const originalEntry = backup.manifest.fileManifest.find((entry: { kind: string; sourceName: string }) => entry.kind === 'purchase-document' && entry.sourceName === source[2].storedFileName);
    const receiptEntry = backup.manifest.fileManifest.find((entry: { kind: string }) => entry.kind === 'receipt');
    expect(receiptEntry.zipPath).toBe(originalEntry.zipPath);

    const response = await restoreZip('incoming-backup-target', bytes);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.results.purchaseDocuments.imported).toBe(3);
    expect(result.results.files.imported).toBe(3);
    const restored = await database.client.purchaseDocument.findMany({ where: { userId: 'incoming-backup-target' }, include: { expense: true }, orderBy: { originalFileName: 'asc' } });
    expect(restored).toHaveLength(3);
    for (const [index, record] of restored.entries()) {
      expect(record.storedFileName).not.toBe(source[index].storedFileName);
      expect(record.originalSha256).toBe(source[index].originalSha256);
      expect(record.reviewStatus).toBe(source[index].reviewStatus);
      const actualBytes = await readFile(storage.getTenantUploadPath('incoming-backup-target', record.storedFileName));
      expect(actualBytes.equals(source[index].bytes)).toBe(true);
      expect(hashBytes(actualBytes)).toBe(record.originalSha256);
      if (record.expense) {
        expect(record.expense.userId).toBe('incoming-backup-target');
        expect(record.expense.id).not.toBe(source[index].expenseId);
        expect(record.expense.storedReceiptFileName).toBe(record.storedFileName);
      }
    }
    expect(await database.client.expense.count({ where: { userId: 'incoming-backup-target' } })).toBe(1);
    expect(await database.client.invoice.count({ where: { userId: 'incoming-backup-target' } })).toBe(0);
    expect(await database.client.income.count({ where: { userId: 'incoming-backup-target' } })).toBe(0);
    expect(await database.client.customer.count({ where: { userId: 'incoming-backup-target' } })).toBe(0);
    expect(await database.client.expense.count({ where: { userId: 'incoming-backup-unrelated' } })).toBe(1);
    const importedAudit = await database.client.auditLog.findFirstOrThrow({ where: { userId: 'incoming-backup-target', action: 'CREATE', entityType: 'PurchaseDocument' } });
    expect(importedAudit.entityId).toBe(String(restored[0].id));
    expect(importedAudit.metadata).toContain('incoming-backup-source');
  });

  it('retains unsupported credit/non-EUR previews and exact XML bytes without adding financial rows', async () => {
    await user('incoming-unsupported-source'); await user('incoming-unsupported-target');
    const bytes = Buffer.from('<CreditNote>unsupported original, retained unchanged</CreditNote>');
    const storedFileName = await storage.writeTenantFile('incoming-unsupported-source', 'credit.xml', bytes);
    const parsedData = { ...preview(), documentType: 'CREDIT_NOTE' as const, currency: 'USD', grossAmount: '-50.25', approvalSupported: false, invoiceDate: null,
      parserWarnings: [{ code: 'UNSUPPORTED_APPROVAL', message: 'Credit notes and non-EUR documents require manual review.' }] };
    await database.client.purchaseDocument.create({ data: {
      userId: 'incoming-unsupported-source', originalFileName: 'credit.xml', storedFileName, originalSha256: hashBytes(bytes), originalByteCount: bytes.length,
      mediaType: 'application/xml', uploadedAt: at, updatedAt: at, uploadRequestId: randomUUID(), parseStatus: 'PARSED', parsedData,
      parserVersion: 'purchase-preview-v1', supplierName: 'Supplier', currency: 'USD', totalAmount: -50.25, reviewStatus: 'REVIEW',
    } });
    const exportedSource = await exported('incoming-unsupported-source');
    expect((await restoreZip('incoming-unsupported-target', exportedSource.bytes)).status).toBe(200);
    const target = await database.client.purchaseDocument.findFirstOrThrow({ where: { userId: 'incoming-unsupported-target' } });
    expect(target.parsedData).toEqual(parsedData); expect(target.expenseId).toBeNull(); expect(target.invoiceDate).toBeNull();
    expect((await readFile(storage.getTenantUploadPath(target.userId, target.storedFileName))).equals(bytes)).toBe(true);
    expect(await database.client.expense.count({ where: { userId: target.userId } })).toBe(0);
    expect(await database.client.income.count({ where: { userId: target.userId } })).toBe(0);
  });

  it('deduplicates equivalent source/expense merge components before importing financial rows', async () => {
    const { bytes } = await exported('incoming-backup-source');
    const before = await database.client.purchaseDocument.findMany({ where: { userId: 'incoming-backup-target' } });
    const response = await restoreZip('incoming-backup-target', bytes);
    expect(response.status).toBe(200);
    const { results } = await response.json();
    expect(results.purchaseDocuments).toEqual({ imported: 0, skipped: 3 });
    expect(results.expenses).toEqual({ imported: 0, skipped: 1 });
    expect(results.files.imported).toBe(0);
    expect(await database.client.purchaseDocument.findMany({ where: { userId: 'incoming-backup-target' } })).toEqual(before);
    expect(await database.client.expense.count({ where: { userId: 'incoming-backup-target' } })).toBe(1);
  });

  it('does not treat a corrupted existing original as an equivalent merge component', async () => {
    const { backup } = await exported('incoming-backup-source');
    const target = await database.client.purchaseDocument.findFirstOrThrow({ where: { userId: 'incoming-backup-target' } });
    const originalPath = storage.getTenantUploadPath(target.userId, target.storedFileName);
    const bytes = await readFile(originalPath);
    try {
      await writeFile(originalPath, '%PDF-1.7\nchanged target');
      await expect(restore.restoreBackupData({ userId: target.userId, overwrite: false, backup, resolveFile: async (_kind, name) => readFile(storage.getTenantUploadPath('incoming-backup-source', name)) })).rejects.toThrow(/Bestehendes Eingangsbeleg-Original/u);
      expect(await database.client.expense.count({ where: { userId: target.userId } })).toBe(1);
    } finally { await writeFile(originalPath, bytes); }
  });

  it('rejects ambiguous source/expense merge and reused upload keys without importing an orphan expense', async () => {
    const { backup } = await exported('incoming-backup-source');
    backup.data.expenses[0].amount = 120;
    backup.data.expenses.push({ id: 800, description: 'Must not be imported', amount: 1, date: at.toISOString() });
    refreshManifest(backup);
    const resolver = async (_kind: string, name: string) => new Uint8Array(await readFile(storage.getTenantUploadPath('incoming-backup-source', name)));
    await expect(restore.restoreBackupData({ userId: 'incoming-backup-target', overwrite: false, backup, resolveFile: resolver })).rejects.toThrow(/Ausgaben unterscheiden/u);
    expect(await database.client.expense.count({ where: { userId: 'incoming-backup-target' } })).toBe(1);
    const { backup: requestConflict } = await exported('incoming-backup-source');
    const changed = Buffer.from('%PDF-1.7\nnew bytes with reused key');
    requestConflict.data.purchaseDocuments[0].originalSha256 = hashBytes(changed);
    requestConflict.data.purchaseDocuments[0].originalByteCount = changed.length;
    const entry = requestConflict.manifest.fileManifest.find((item: { kind: string; sourceName: string }) => item.kind === 'purchase-document' && item.sourceName === requestConflict.data.purchaseDocuments[0].storedFileName);
    entry.sha256 = hashBytes(changed); entry.bytes = changed.length;
    refreshManifest(requestConflict);
    await expect(restore.restoreBackupData({ userId: 'incoming-backup-target', overwrite: false, backup: requestConflict, resolveFile: async (kind, name) => name === requestConflict.data.purchaseDocuments[0].storedFileName ? changed : resolver(kind, name) })).rejects.toThrow(/Upload-Anfrage/u);
  });

  it('rejects tampered/missing originals before mutation and refuses corrupt source export', async () => {
    await user('incoming-backup-invalid');
    const { zip, backup } = await exported('incoming-backup-source');
    const entry = backup.manifest.fileManifest.find((item: { kind: string }) => item.kind === 'purchase-document');
    zip.file(entry.zipPath, '%PDF-1.7\ntampered');
    const tampered = await zip.generateAsync({ type: 'arraybuffer' });
    expect((await restoreZip('incoming-backup-invalid', tampered)).status).toBe(400);
    expect(await database.client.purchaseDocument.count({ where: { userId: 'incoming-backup-invalid' } })).toBe(0);
    zip.remove(entry.zipPath);
    expect((await restoreZip('incoming-backup-invalid', await zip.generateAsync({ type: 'arraybuffer' }))).status).toBe(400);
    const document = await database.client.purchaseDocument.findFirstOrThrow({ where: { userId: 'incoming-backup-source' }, orderBy: { id: 'asc' } });
    const filePath = storage.getTenantUploadPath(document.userId, document.storedFileName);
    const original = await readFile(filePath);
    try {
      await writeFile(filePath, '%PDF-1.7\ncorrupted');
      state.userId = document.userId;
      expect((await fullExport.GET()).status).toBe(409);
    } finally { await writeFile(filePath, original); }
  });

  it('warns for JSON metadata and rejects incoming JSON restore instead of inventing originals', async () => {
    state.userId = 'incoming-backup-source';
    const response = await jsonExport.GET();
    const backup = await response.json();
    expect(backup.warnings.join(' ')).toContain('ZIP');
    expect(createBackupPreview(backup).warnings.join(' ')).toContain('ZIP');
    await expect(restore.restoreBackupData({ userId: 'incoming-backup-invalid', overwrite: true, backup })).rejects.toThrow(/vollständiges ZIP/u);
    expect(await database.client.purchaseDocument.count({ where: { userId: 'incoming-backup-invalid' } })).toBe(0);
  });

  it('rejects invalid states, date rollovers, tenant claims and duplicate hashes/request keys during preview', async () => {
    const { backup } = await exported('incoming-backup-source');
    for (const mutate of [
      (value: typeof backup) => { value.data.purchaseDocuments[0].expenseId = value.data.expenses[0].id; },
      (value: typeof backup) => { value.data.purchaseDocuments[0].invoiceDate = '2026-02-30T00:00:00.000Z'; },
      (value: typeof backup) => { value.data.purchaseDocuments[0].userId = 'another-tenant'; },
      (value: typeof backup) => { value.data.purchaseDocuments[1].originalSha256 = value.data.purchaseDocuments[0].originalSha256; },
      (value: typeof backup) => { value.data.purchaseDocuments[1].storedFileName = value.data.purchaseDocuments[0].storedFileName; },
      (value: typeof backup) => { value.data.purchaseDocuments[0].storedFileName = value.data.purchaseDocuments[0].storedFileName.replace(/\.pdf$/u, '.xml'); },
      (value: typeof backup) => { value.data.purchaseDocuments[1].uploadRequestId = value.data.purchaseDocuments[0].uploadRequestId; },
      (value: typeof backup) => { value.data.expenses[0].storedReceiptFileName = value.data.purchaseDocuments[0].storedFileName; },
      (value: typeof backup) => { value.data.purchaseDocuments[0].parsedData = value.data.purchaseDocuments[2].parsedData; },
      (value: typeof backup) => { value.data.purchaseDocuments[0].parseErrorCode = null; },
      (value: typeof backup) => { value.data.purchaseDocuments[2].parseErrorCode = 'FAILED'; },
      (value: typeof backup) => { value.data.purchaseDocuments[2].parsedData.validationStatus = 'VALID'; },
    ]) {
      const invalid = structuredClone(backup); mutate(invalid); refreshManifest(invalid);
      expect(() => createBackupPreview(invalid)).toThrow();
    }
  });

  it('rolls back overwrite business rows and only removes newly staged unreferenced files on audit failure', async () => {
    const { backup } = await exported('incoming-backup-source');
    const before = await database.client.purchaseDocument.findMany({ where: { userId: 'incoming-backup-target' } });
    const beforeFiles = (await readdir(storage.tenantUploadDir('incoming-backup-target'))).sort();
    state.failFinalAudit = true;
    try {
      await expect(restore.restoreBackupData({ userId: 'incoming-backup-target', overwrite: true, backup, resolveFile: async (_kind, name) => readFile(storage.getTenantUploadPath('incoming-backup-source', name)) })).rejects.toThrow('fixture-final-audit-failure');
    } finally { state.failFinalAudit = false; }
    expect(await database.client.purchaseDocument.findMany({ where: { userId: 'incoming-backup-target' } })).toEqual(before);
    expect((await readdir(storage.tenantUploadDir('incoming-backup-target'))).sort()).toEqual(beforeFiles);
    expect(await database.client.expense.count({ where: { userId: 'incoming-backup-target' } })).toBe(1);
  });

  it('accepts genuine pre-inbox v3 manifests as an empty collection but rejects injected unbound sources', async () => {
    const data: Record<string, unknown> = { user: { id: 'old-source' }, auditLogs: [], invoiceNumberCounters: [] };
    const manifest = createBackupManifest({ sourceUserId: 'old-source', generatedAt: at.toISOString(), data });
    manifest.schemaVersion = PRE_PURCHASE_DOCUMENTS_SCHEMA_VERSION;
    manifest.modelCoverage = manifest.modelCoverage.filter((entry) => entry.model !== 'PurchaseDocument');
    expect(() => validateBackupManifest(manifest, data)).not.toThrow();
    const old = { version: '3.0', type: 'json', manifest, data };
    expect(createBackupPreview(old).counts.purchaseDocuments).toBe(0);
    data.purchaseDocuments = [{ id: 1 }];
    expect(() => restore.validateBackupForRestore({ version: '2.0', type: 'full', data })).toThrow(/ungebundenen Eingangsbelege/u);
    expect(() => restore.validateBackupForRestore(old)).toThrow(/ungebundenen Eingangsbelege/u);
    const snapshot = await readBackupSnapshot('incoming-backup-target');
    expect((snapshot.data.purchaseDocuments as unknown[]).length).toBe(3);
  });
});
