import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { withProcessingSlot } from '@/lib/processing-limit';
import JSZip from 'jszip';
import { NextRequest } from 'next/server';
import { createTestDatabase } from './helpers/database';
import { createBackupManifest, hashBytes, CURRENT_SCHEMA_VERSION, ANNUAL_CONTEXT_SCHEMA_VERSION, PRE_ANNUAL_CONTEXT_SCHEMA_VERSION, PRE_PURCHASE_REVIEW_DRAFTS_SCHEMA_VERSION, PRE_PAYMENT_JOURNAL_SCHEMA_VERSION, PRE_SUPPLIERS_SCHEMA_VERSION, PRE_PURCHASE_DOCUMENTS_SCHEMA_VERSION, validateBackupManifest } from '@/lib/backup-manifest';
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
  const supplier = await database.client.supplier.create({ data: { userId: id, name: 'Explicit chosen supplier', address: 'Historical street 1', postalCode: '12345', city: 'Berlin', country: 'DE', email: 'chosen@supplier.test', phone: '0123456', taxId: 'tax-17', vatId: 'DE123', createdAt: at, updatedAt: at } });
  const { userId: _owner, createdAt: _created, updatedAt: _updated, ...selectedSupplierSnapshot } = supplier;
  void _owner; void _created; void _updated;
  // Master contact changes after approval never rewrite the selected snapshot.
  await database.client.supplier.update({ where: { id: supplier.id }, data: { name: 'Current supplier name', address: 'Current street 2', revision: 1, updatedAt: at } });
  await database.client.supplier.create({ data: { userId: id, name: 'Current supplier name', createdAt: at, updatedAt: at } });
  await database.client.auditLog.create({ data: { userId: id, action: 'CREATE', entityType: 'Supplier', entityId: String(supplier.id), createdAt: at } });
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
      ...(expense ? { supplierId: supplier.id, selectedSupplierSnapshot, approvalRequestId: randomUUID(), approvalFingerprint: 'a'.repeat(64), approvedAt: at } : {}),
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
  it('rejects relabeled manual source evidence and future metadata before reading files or mutating tenants', async () => {
    const sourceUser = 'unsupported-evidence-source', targetUser = 'unsupported-evidence-target';
    await sources(sourceUser); await user(targetUser);
    await database.client.settings.create({ data: { userId: targetUser, companyName: 'Preserve target settings' } });
    await database.client.annualBusinessContextRevision.create({ data: { userId: targetUser, revision: 1, contextYear: 2026, effectiveFrom: '2026-01-01', foundingYear: null, previousYearTurnoverCents: null, previousYearExternalTurnoverCents: null, completeness: 'UNKNOWN', sourceNote: 'Preserve target declaration' } });
    const { backup: original } = await exported(sourceUser);
    const sourceBefore = await database.client.purchaseDocument.findMany({ where: { userId: sourceUser }, orderBy: { id: 'asc' } });
    const targetBefore = await readBackupSnapshot(targetUser);
    const sourceFiles = await Promise.all(sourceBefore.map(async document => [document.storedFileName, await readFile(storage.getTenantUploadPath(sourceUser, document.storedFileName))] as const));
    const resolver = vi.fn(async () => { throw new Error('Preflight must reject before resolving originals'); });
    for (const schemaVersion of [ANNUAL_CONTEXT_SCHEMA_VERSION, PRE_ANNUAL_CONTEXT_SCHEMA_VERSION]) {
      for (const [mediaType, reviewStatus] of [['image/png', 'REVIEW'], ['image/jpeg', 'DISMISSED'], ['application/pdf', 'REVIEW'], ['application/xml', 'DISMISSED'], ['application/pdf', 'BOOKED'], ['application/xml', 'BOOKED']] as const) {
        const backup = structuredClone(original);
        delete backup.data.annualBusinessContextRevisions;
        const document = backup.data.purchaseDocuments.find((document: { reviewStatus: string }) => document.reviewStatus === reviewStatus);
        expect(document).toBeTruthy();
        const previousName = document.storedFileName;
        document.mediaType = mediaType;
        document.storedFileName = `${randomUUID()}.${mediaType === 'image/jpeg' ? 'jpg' : mediaType === 'image/png' ? 'png' : mediaType === 'application/xml' ? 'xml' : 'pdf'}`;
        document.originalFileName = `synthetic.${document.storedFileName.split('.').at(-1)}`;
        if (mediaType.startsWith('image/')) { document.parseStatus = 'FAILED'; document.parseErrorCode = 'PHOTO_MANUAL_REVIEW'; document.parsedData = null; }
        else { document.parseStatus = 'PARSED'; document.parseErrorCode = null; document.parsedData = preview(); }
        for (const entry of backup.manifest.fileManifest) if (entry.sourceName === previousName) entry.sourceName = document.storedFileName;
        for (const expense of backup.data.expenses) if (expense.storedReceiptFileName === previousName) expense.storedReceiptFileName = document.storedFileName;
        refreshManifest(backup); backup.manifest.schemaVersion = schemaVersion;
        // The same metadata graph without unsupported evidence is admissible;
        // rejection below is not an unrelated invalid relationship/media state.
        expect(() => createBackupPreview(backup)).not.toThrow();
        document.reviewedSourceSnapshot = { provenance: 'MANUAL_PHOTO_REVIEW', originalSha256: document.originalSha256, snapshotVersion: 1 };
        refreshManifest(backup); backup.manifest.schemaVersion = schemaVersion;
        expect(() => validateBackupManifest(backup.manifest, backup.data)).toThrow(/reviewedSourceSnapshot/);
        expect(() => createBackupPreview(backup)).toThrow(/reviewedSourceSnapshot/);
        for (const overwrite of [false, true]) await expect(restore.restoreBackupData({ userId: targetUser, backup, overwrite, resolveFile: resolver })).rejects.toThrow(/reviewedSourceSnapshot/);
      }
    }
    for (const field of ['reviewedSourceSnapshotAt', 'reviewedSourceSnapshotRevision', 'futureApprovalEvidence']) {
      const backup = structuredClone(original); backup.data.purchaseDocuments[0][field] = { retained: 'must not be silently lost' }; refreshManifest(backup);
      expect(() => createBackupPreview(backup)).toThrow(/Nicht unterstütztes Eingangsbelegfeld/);
    }
    // Legacy v2 bypasses manifest checks but must still reject the same evidence.
    const legacy = structuredClone(original); legacy.data.purchaseDocuments[0].reviewedSourceSnapshot = { provenance: 'MANUAL_PHOTO_REVIEW' };
    expect(() => restore.validateBackupForRestore({ version: '2.0', type: 'full', data: legacy.data })).toThrow();
    // Explicit null and absent evidence carry no information to discard.
    const emptySnapshot = structuredClone(original); emptySnapshot.data.purchaseDocuments[0].reviewedSourceSnapshot = null; refreshManifest(emptySnapshot);
    expect(() => createBackupPreview(emptySnapshot)).not.toThrow();
    expect(resolver).not.toHaveBeenCalled();
    expect(await database.client.purchaseDocument.findMany({ where: { userId: sourceUser }, orderBy: { id: 'asc' } })).toEqual(sourceBefore);
    expect((await readBackupSnapshot(targetUser)).data).toEqual(targetBefore.data);
    expect(await database.client.purchaseDocument.count({ where: { userId: targetUser } })).toBe(0);
    expect(await readdir(path.join(root, 'data', 'uploads', targetUser)).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).toEqual([]);
    for (const [name, bytes] of sourceFiles) expect(await readFile(storage.getTenantUploadPath(sourceUser, name))).toEqual(bytes);
  });

  it('roundtrips actual JPG/PNG intake and explicit saved drafts with target ownership and zero ledger effects', async () => {
    const sourceUser = 'photo-draft-source', targetUser = 'photo-draft-target';
    await user(sourceUser); await user(targetUser); state.userId = sourceUser;
    const draftRoute = await import('@/app/api/purchase-documents/[id]/review-draft/route');
    const originals = [];
    const draft = { supplierName: 'Photo supplier', invoiceNumber: 'PHOTO-1', invoiceDate: '2026-10-20', paymentDate: '2026-10-21', amount: '0.29', note: 'Synthetic photo draft only' };
    for (const format of ['jpeg', 'png'] as const) {
      const bytes = await sharp({ create: { width: 390, height: 600, channels: 3, background: '#faf8f3' } })[format]().toBuffer();
      const form = new FormData(); form.append('file', new File([bytes], `receipt.${format === 'jpeg' ? 'jpg' : 'png'}`, { type: `image/${format}` })); form.append('uploadRequestId', randomUUID());
      const intake = await incoming.POST(new NextRequest('http://localhost/api/purchase-documents', { method: 'POST', body: form })); expect(intake.status).toBe(201);
      const document = (await intake.json()).document;
      const saved = await draftRoute.POST(new NextRequest(`http://localhost/api/purchase-documents/${document.id}/review-draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: document.revision, draft }) }), { params: Promise.resolve({ id: String(document.id) }) });
      expect(saved.status).toBe(200); originals.push({ bytes, document: (await saved.json()).document });
    }
    const archive = await exported(sourceUser);
    expect(archive.backup.manifest.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(createBackupPreview(archive.backup).counts.purchaseDocuments).toBe(2);
    expect((await restoreZip(targetUser, archive.bytes)).status).toBe(200);
    const restored = await database.client.purchaseDocument.findMany({ where: { userId: targetUser }, orderBy: { id: 'asc' } });
    expect(restored).toHaveLength(2);
    for (const [index, record] of restored.entries()) {
      expect(record).toMatchObject({ userId: targetUser, reviewStatus: 'REVIEW', parseStatus: 'FAILED', parseErrorCode: 'PHOTO_MANUAL_REVIEW', expenseId: null, reviewDraft: draft, supplierName: null, invoiceDate: null, totalAmount: null });
      expect(record.reviewDraftSavedAt?.toISOString()).toBe(originals[index].document.reviewDraftSavedAt);
      expect(record.storedFileName).not.toBe(archive.backup.data.purchaseDocuments[index].storedFileName);
      expect(record.reviewDraftSearch).toBe('Photo supplier · PHOTO-1');
      expect(await readFile(storage.getTenantUploadPath(targetUser, record.storedFileName))).toEqual(originals[index].bytes);
      expect(record.originalSha256).toBe(hashBytes(originals[index].bytes));
    }
    expect(await database.client.expense.count({ where: { userId: targetUser } })).toBe(0);
    expect(await database.client.income.count({ where: { userId: targetUser } })).toBe(0);
    expect(await database.client.cashTransaction.count({ where: { userId: targetUser } })).toBe(0);
    const old = structuredClone(archive.backup); old.manifest.schemaVersion = PRE_PURCHASE_REVIEW_DRAFTS_SCHEMA_VERSION;
    expect(() => createBackupPreview(old)).toThrow(/Älteres Backupschema/);
    for (const mutate of [
      (doc: Record<string, unknown>) => { doc.reviewDraft = { ...draft, confirmPaymentDate: true }; },
      (doc: Record<string, unknown>) => { doc.reviewDraftSavedAt = null; },
      (doc: Record<string, unknown>) => { doc.reviewDraft = { ...draft, amount: '1.001' }; },
      (doc: Record<string, unknown>) => { doc.parseStatus = 'PARSED'; },
    ]) {
      const invalid = structuredClone(archive.backup); mutate(invalid.data.purchaseDocuments[0]); refreshManifest(invalid);
      expect(() => createBackupPreview(invalid)).toThrow();
    }
    const corruptTarget = 'photo-corrupt-target'; await user(corruptTarget);
    const corrupt = structuredClone(archive.backup); const badBytes = Buffer.from([255, 216, 255, 0]);
    const corruptDocument = corrupt.data.purchaseDocuments[0]; corruptDocument.originalByteCount = badBytes.length; corruptDocument.originalSha256 = hashBytes(badBytes);
    const corruptEntry = corrupt.manifest.fileManifest.find((file: { sourceName: string }) => file.sourceName === corruptDocument.storedFileName);
    corruptEntry.bytes = badBytes.length; corruptEntry.sha256 = hashBytes(badBytes); refreshManifest(corrupt);
    // Even a self-consistent manifest cannot bypass decoding / dimension budgets during restore.
    await expect(restore.restoreBackupData({ userId: corruptTarget, backup: corrupt, overwrite: false, resolveFile: async (_kind, sourceName) => {
      if (sourceName === corruptDocument.storedFileName) return badBytes;
      const entry = corrupt.manifest.fileManifest.find((file: { sourceName: string }) => file.sourceName === sourceName);
      return archive.zip.file(entry.zipPath)!.async('uint8array');
    } })).rejects.toThrow(/Foto-Original/);
    expect(await database.client.purchaseDocument.count({ where: { userId: corruptTarget } })).toBe(0);
    expect(await database.client.expense.count({ where: { userId: corruptTarget } })).toBe(0);
    // Draft differences are component conflicts, not a quiet skip of newer work.
    const changed = structuredClone(archive.backup); changed.data.purchaseDocuments[0].reviewDraft.note = 'Different saved work'; refreshManifest(changed);
    await expect(restore.restoreBackupData({ userId: targetUser, backup: changed, overwrite: false, resolveFile: async (_kind, sourceName) => {
      const entry = changed.manifest.fileManifest.find((file: { sourceName: string }) => file.sourceName === sourceName);
      return archive.zip.file(entry.zipPath)!.async('uint8array');
    } })).rejects.toThrow(/unterschiedlich|Konflikt|abweich|abweichen|nicht eindeutig|unterschied|Zustand/i);
    const untouched = await database.client.purchaseDocument.findMany({ where: { userId: targetUser } }); expect(untouched.every(record => (record.reviewDraft as { note: string }).note === draft.note)).toBe(true);
  });

  it('returns retryable 429 for a valid photo restore under occupied processing capacity, without corruption claims or mutation', async () => {
    const source = 'capacity-photo-source', target = 'capacity-photo-target'; await user(source); await user(target); state.userId = source;
    const bytes = await sharp({ create: { width: 40, height: 80, channels: 3, background: '#faf8f3' } }).png().toBuffer();
    const form = new FormData(); form.append('file', new File([bytes], 'valid-capacity.png', { type: 'image/png' })); form.append('uploadRequestId', randomUUID());
    const intake = await incoming.POST(new NextRequest('http://localhost/api/purchase-documents', { method: 'POST', body: form })); expect(intake.status).toBe(201);
    const archive = await exported(source);
    let release!: () => void;
    const occupied = withProcessingSlot(target, () => new Promise<void>(resolve => { release = resolve; }));
    try {
      const response = await restoreZip(target, archive.bytes);
      expect(response.status).toBe(429); expect(response.headers.get('retry-after')).toBe('1');
      const body = await response.json(); expect(body).toMatchObject({ code: 'PROCESSING_BUSY' });
      expect(body.error).toContain('ausgelastet'); expect(body.error).not.toMatch(/beschädigt|Bildgrenzen|Integrität/i);
      expect(await database.client.purchaseDocument.count({ where: { userId: target } })).toBe(0);
      expect(await database.client.expense.count({ where: { userId: target } })).toBe(0);
      expect(await database.client.auditLog.count({ where: { userId: target } })).toBe(0);
      const directory = path.join(root, 'data/uploads', target);
      expect(await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).toEqual([]);
    } finally { release(); await occupied; }
    const retry = await restoreZip(target, archive.bytes); expect(retry.status).toBe(200);
    const restored = await database.client.purchaseDocument.findFirstOrThrow({ where: { userId: target } });
    expect(await readFile(storage.getTenantUploadPath(target, restored.storedFileName))).toEqual(bytes);
    expect(await database.client.expense.count({ where: { userId: target } })).toBe(0);
  });

  it('accepts a genuine prior partial-payment schema with no photo/draft injection', async () => {
    const source = 'prior-photo-source', target = 'prior-photo-target'; await sources(source); await user(target);
    const archive = await exported(source);
    for (const document of archive.backup.data.purchaseDocuments) { delete document.reviewDraft; delete document.reviewDraftSavedAt; delete document.reviewDraftSearch; }
    // Build a genuine historical fixture, not a relabeled current snapshot.
    delete archive.backup.data.annualBusinessContextRevisions;
    refreshManifest(archive.backup); archive.backup.manifest.schemaVersion = PRE_PURCHASE_REVIEW_DRAFTS_SCHEMA_VERSION;
    expect(createBackupPreview(archive.backup).counts.purchaseDocuments).toBe(3);
    await restore.restoreBackupData({ userId: target, backup: archive.backup, overwrite: false, resolveFile: async (kind, sourceName) => {
      const entry = archive.backup.manifest.fileManifest.find((file: { kind: string; sourceName: string }) => file.kind === kind && file.sourceName === sourceName);
      return archive.zip.file(entry.zipPath)!.async('uint8array');
    } });
    const restored = await database.client.purchaseDocument.findMany({ where: { userId: target } }); expect(restored).toHaveLength(3); expect(restored.every(record => record.reviewDraft === null && record.reviewDraftSavedAt === null)).toBe(true);
  });

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
    expect(backup.stats.suppliers).toBe(2);
    expect(createBackupPreview(backup).counts.suppliers).toBe(2);
    expect(backup.manifest.modelCoverage.find((entry: { model: string }) => entry.model === 'Supplier')).toMatchObject({ key: 'suppliers', count: 2 });
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
        expect(record.supplierId).not.toBe(source[index].supplierId);
        expect(record.selectedSupplierSnapshot).toEqual({ ...(source[index].selectedSupplierSnapshot as object), id: record.supplierId });
        const supplier = await database.client.supplier.findUniqueOrThrow({ where: { id: record.supplierId! } });
        expect(supplier).toMatchObject({ userId: 'incoming-backup-target', name: 'Current supplier name', address: 'Current street 2', revision: 1 });
        expect(record.parsedData).toEqual(source[index].parsedData);
        expect(record.expense.userId).toBe('incoming-backup-target');
        expect(record.expense.id).not.toBe(source[index].expenseId);
        expect(record.expense.storedReceiptFileName).toBe(record.storedFileName);
      }
    }
    expect(await database.client.expense.count({ where: { userId: 'incoming-backup-target' } })).toBe(1);
    expect(await database.client.invoice.count({ where: { userId: 'incoming-backup-target' } })).toBe(0);
    expect(await database.client.income.count({ where: { userId: 'incoming-backup-target' } })).toBe(0);
    expect(await database.client.customer.count({ where: { userId: 'incoming-backup-target' } })).toBe(0);
    expect(await database.client.supplier.count({ where: { userId: 'incoming-backup-target' } })).toBe(2);
    const supplierAudit = await database.client.auditLog.findFirstOrThrow({ where: { userId: 'incoming-backup-target', action: 'CREATE', entityType: 'Supplier' } });
    expect(supplierAudit.entityId).toBe(String(restored[2].supplierId));
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
    expect(results.suppliers).toEqual({ imported: 0, skipped: 2 });
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
      (value: typeof backup) => { value.data.suppliers[0].userId = 'another-tenant'; },
      (value: typeof backup) => { value.data.suppliers[0].revision = -1; },
      (value: typeof backup) => { value.data.suppliers[0].createdAt = '2026-02-30T00:00:00.000Z'; },
      (value: typeof backup) => { value.data.purchaseDocuments[2].supplierId = 999999; },
      (value: typeof backup) => { value.data.purchaseDocuments[2].selectedSupplierSnapshot.id = value.data.suppliers[1].id; },
      (value: typeof backup) => { value.data.purchaseDocuments[2].selectedSupplierSnapshot.revision = -1; },
      (value: typeof backup) => { value.data.purchaseDocuments[2].selectedSupplierSnapshot = null; },
      (value: typeof backup) => { value.data.purchaseDocuments[2].supplierId = null; },
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

  it('rejects source-linked recurring/scheduled/cash expense components before any restore mutation', async () => {
    const { backup } = await exported('incoming-backup-source');
    for (const mutate of [
      (value: typeof backup) => { value.data.expenses[0].scheduledDate = at.toISOString(); },
      (value: typeof backup) => {
        value.data.recurringExpenses = [{ id: 777, description: 'Recurring', amount: 119, interval: 'MONTHLY', dayOfMonth: 20, startDate: at.toISOString(), nextExecution: at.toISOString(), isActive: true }];
        value.data.expenses[0].recurringExpenseId = 777;
      },
      (value: typeof backup) => {
        value.data.cashBooks = [{ id: 888, name: 'Cash', initialBalance: 200 }];
        value.data.cashTransactions = [{ id: 889, cashBookId: 888, expenseId: value.data.expenses[0].id, type: 'EXPENSE', amount: 119, description: 'Cash payment', date: at.toISOString(), runningBalance: 81 }];
      },
    ]) {
      const invalid = structuredClone(backup); mutate(invalid); refreshManifest(invalid);
      expect(() => createBackupPreview(invalid)).toThrow(/Wiederholung, Ausführungstermin oder Kassenbuchung/u);
      await expect(restore.restoreBackupData({ userId: 'incoming-backup-target', overwrite: true, backup: invalid, resolveFile: async (_kind, name) => readFile(storage.getTenantUploadPath('incoming-backup-source', name)) })).rejects.toThrow(/Wiederholung, Ausführungstermin oder Kassenbuchung/u);
    }
    expect(await database.client.expense.count({ where: { userId: 'incoming-backup-target' } })).toBe(1);
  });

  it('rejects differing selected historical snapshots and identity-mapped supplier edits without duplicate expenses', async () => {
    const { backup } = await exported('incoming-backup-source');
    const resolver = async (_kind: string, name: string) => readFile(storage.getTenantUploadPath('incoming-backup-source', name));
    const changedSnapshot = structuredClone(backup);
    changedSnapshot.data.purchaseDocuments[2].selectedSupplierSnapshot.address = 'Different historical contact';
    refreshManifest(changedSnapshot);
    await expect(restore.restoreBackupData({ userId: 'incoming-backup-target', overwrite: false, backup: changedSnapshot, resolveFile: resolver })).rejects.toThrow(/Kollision/u);
    const changedMaster = structuredClone(backup);
    changedMaster.data.suppliers[0].name = 'Changed source master';
    refreshManifest(changedMaster);
    await expect(restore.restoreBackupData({ userId: 'incoming-backup-target', overwrite: false, backup: changedMaster, resolveFile: resolver })).rejects.toThrow(/Lieferanten-Kollision/u);
    expect(await database.client.expense.count({ where: { userId: 'incoming-backup-target' } })).toBe(1);
    expect(await database.client.supplier.count({ where: { userId: 'incoming-backup-target' } })).toBe(2);
  });

  it('does not merge supplier identities by equal name or colliding source numeric ID across tenants', async () => {
    await user('incoming-supplier-collision-target');
    const existing = await database.client.supplier.create({ data: { userId: 'incoming-supplier-collision-target', name: 'Current supplier name' } });
    const { backup } = await exported('incoming-backup-source');
    const originalSupplierId = backup.data.suppliers[0].id;
    // An independent source database can reuse a target's numeric ID.
    backup.data.suppliers[0].id = existing.id;
    const sourceDocument = backup.data.purchaseDocuments.find((record: { supplierId: number }) => record.supplierId === originalSupplierId);
    sourceDocument.supplierId = existing.id;
    sourceDocument.selectedSupplierSnapshot.id = existing.id;
    backup.data.auditLogs.filter((record: { entityType: string; entityId: string }) => record.entityType === 'Supplier' && record.entityId === String(originalSupplierId)).forEach((record: { entityId: string }) => { record.entityId = String(existing.id); });
    refreshManifest(backup);
    await restore.restoreBackupData({ userId: 'incoming-supplier-collision-target', overwrite: false, backup, resolveFile: async (_kind, name) => readFile(storage.getTenantUploadPath('incoming-backup-source', name)) });
    const suppliers = await database.client.supplier.findMany({ where: { userId: 'incoming-supplier-collision-target' } });
    expect(suppliers).toHaveLength(3);
    const booked = await database.client.purchaseDocument.findFirstOrThrow({ where: { userId: 'incoming-supplier-collision-target', reviewStatus: 'BOOKED' } });
    expect(booked.supplierId).not.toBe(existing.id);
  });

  it('overwrites supplier/source/expense components in dependency order while preserving selected history', async () => {
    const { backup } = await exported('incoming-backup-source');
    const result = await restore.restoreBackupData({ userId: 'incoming-backup-target', overwrite: true, backup, resolveFile: async (_kind, name) => readFile(storage.getTenantUploadPath('incoming-backup-source', name)) });
    expect(result.suppliers).toEqual({ imported: 2, skipped: 0 });
    expect(result.purchaseDocuments).toEqual({ imported: 3, skipped: 0 });
    expect(result.expenses).toEqual({ imported: 1, skipped: 0 });
    const booked = await database.client.purchaseDocument.findFirstOrThrow({ where: { userId: 'incoming-backup-target', reviewStatus: 'BOOKED' } });
    expect(booked.selectedSupplierSnapshot).toMatchObject({ id: booked.supplierId, name: 'Explicit chosen supplier', address: 'Historical street 1', revision: 0 });
    const merged = await restore.restoreBackupData({ userId: 'incoming-backup-target', overwrite: false, backup, resolveFile: async (_kind, name) => readFile(storage.getTenantUploadPath('incoming-backup-source', name)) });
    expect(merged.suppliers).toEqual({ imported: 0, skipped: 2 });
    expect(merged.purchaseDocuments).toEqual({ imported: 0, skipped: 3 });
    expect(merged.expenses).toEqual({ imported: 0, skipped: 1 });
  });

  it('restores supplier-only JSON backups without originals or financial effects', async () => {
    const { backup } = await exported('incoming-backup-source');
    backup.type = 'json'; backup.data.purchaseDocuments = []; backup.data.expenses = [];
    refreshManifest(backup);
    await user('incoming-supplier-json-target');
    const result = await restore.restoreBackupData({ userId: 'incoming-supplier-json-target', overwrite: false, backup });
    expect(result.suppliers).toEqual({ imported: 2, skipped: 0 });
    expect(await database.client.supplier.count({ where: { userId: 'incoming-supplier-json-target' } })).toBe(2);
    expect(await database.client.expense.count({ where: { userId: 'incoming-supplier-json-target' } })).toBe(0);
    expect(await database.client.purchaseDocument.count({ where: { userId: 'incoming-supplier-json-target' } })).toBe(0);
  });

  it('roundtrips the combined supplier, booked source, immutable payment and every original through full ZIP routes', async () => {
    const sourceId = 'integrated-source', targetId = 'integrated-target';
    const originals = await sources(sourceId);
    await user(targetId);
    const invoiceBytes = Buffer.from('%PDF-1.7\ncombined payment original\n%%EOF');
    const storedFileName = await storage.writeTenantFile(sourceId, 'paid-original.pdf', invoiceBytes);
    const invoice = await database.client.invoice.create({ data: {
      userId: sourceId, fileName: 'paid-original.pdf', storedFileName, type: 'INVOICE',
      invoiceNumber: '2026-COMBINED', invoiceDate: at, uploadedAt: at, paidAt: at,
      totalAmount: 25.01, status: 'PAID', issuanceState: 'ISSUED', parsedData: { currency: 'EUR' },
    } });
    const income = await database.client.income.create({ data: {
      userId: sourceId, invoiceId: invoice.id, amount: 25.01, date: at, description: 'Combined payment', taxRelevant: true,
    } });
    const event = await database.client.paymentJournalEvent.create({ data: {
      userId: sourceId, invoiceId: invoice.id, incomeId: income.id, amountCents: '2501', currency: 'EUR',
      paidAt: at, dateCertainty: 'ACTUAL', source: 'MANUAL', reference: 'combined reference', idempotencyKey: 'combined-payment', createdAt: at,
    } });
    const archive = await exported(sourceId);
    expect(archive.backup.manifest.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(archive.backup.stats).toMatchObject({ suppliers: 2, purchaseDocuments: 3, expenses: 1, paymentJournalEvents: 1, invoices: 1, incomes: 1 });
    expect(createBackupPreview(archive.backup).counts).toMatchObject(archive.backup.stats);
    for (const [model, key, count] of [['Supplier', 'suppliers', 2], ['PurchaseDocument', 'purchaseDocuments', 3], ['PaymentJournalEvent', 'paymentJournalEvents', 1]] as const) {
      expect(archive.backup.manifest.modelCoverage.find((entry: { model: string }) => entry.model === model)).toMatchObject({ key, count });
    }
    const firstResponse = await restoreZip(targetId, archive.bytes);
    expect(firstResponse.status, await firstResponse.clone().text()).toBe(200);
    expect((await firstResponse.json()).results).toMatchObject({
      suppliers: { imported: 2 }, purchaseDocuments: { imported: 3 }, expenses: { imported: 1 },
      paymentJournalEvents: { imported: 1 }, invoices: { imported: 1 }, incomes: { imported: 1 }, files: { imported: 4 },
    });
    const restoredSource = await database.client.purchaseDocument.findFirstOrThrow({ where: { userId: targetId, reviewStatus: 'BOOKED' }, include: { supplier: true, expense: true } });
    expect(restoredSource.supplierId).not.toBe(originals[2].supplierId);
    expect(restoredSource.supplier?.userId).toBe(targetId);
    expect(restoredSource.selectedSupplierSnapshot).toEqual({ ...(originals[2].selectedSupplierSnapshot as object), id: restoredSource.supplierId });
    expect(restoredSource.approvalFingerprint).toBe(originals[2].approvalFingerprint);
    expect(restoredSource.expense).toMatchObject({ userId: targetId, amount: 119, storedReceiptFileName: restoredSource.storedFileName });
    expect(restoredSource.expenseId).not.toBe(originals[2].expenseId);
    expect(await readFile(storage.getTenantUploadPath(targetId, restoredSource.storedFileName))).toEqual(originals[2].bytes);
    const restoredEvent = await database.client.paymentJournalEvent.findFirstOrThrow({ where: { userId: targetId }, include: { invoice: true, income: true } });
    expect(restoredEvent.id).not.toBe(event.id);
    expect(restoredEvent.invoiceId).not.toBe(invoice.id);
    expect(restoredEvent.incomeId).not.toBe(income.id);
    expect(restoredEvent.invoice).toMatchObject({ userId: targetId, status: 'PAID', paidAt: at });
    expect(restoredEvent.income).toMatchObject({ userId: targetId, invoiceId: restoredEvent.invoiceId, amount: 25.01, date: at });
    expect(await readFile(storage.getTenantUploadPath(targetId, restoredEvent.invoice.storedFileName))).toEqual(invoiceBytes);
    const repeated = await restoreZip(targetId, archive.bytes);
    expect(repeated.status, await repeated.clone().text()).toBe(200);
    expect((await repeated.json()).results).toMatchObject({
      suppliers: { imported: 0, skipped: 2 }, purchaseDocuments: { imported: 0, skipped: 3 },
      expenses: { imported: 0, skipped: 1 }, paymentJournalEvents: { imported: 0, skipped: 1 },
    });
    const again = await exported(targetId);
    const { auditLogs: sourceAuditCount, ...businessCounts } = archive.backup.stats;
    expect(again.backup.stats).toMatchObject(businessCounts);
    expect(again.backup.stats.auditLogs).toBeGreaterThan(sourceAuditCount);
    expect(again.backup.data.purchaseDocuments.find((row: { reviewStatus: string }) => row.reviewStatus === 'BOOKED')).toMatchObject({ expenseId: restoredSource.expenseId, supplierId: restoredSource.supplierId });
    expect(again.backup.data.paymentJournalEvents[0]).toMatchObject({ invoiceId: restoredEvent.invoiceId, incomeId: restoredEvent.incomeId, amountCents: '2501' });
    const json = await jsonExport.GET();
    expect((await json.json()).stats).toMatchObject(businessCounts);
    const beforeFiles = (await readdir(storage.tenantUploadDir(targetId))).sort();
    await expect(restore.restoreBackupData({ userId: targetId, backup: archive.backup, overwrite: true, resolveFile: async (_kind, name) => readFile(storage.getTenantUploadPath(sourceId, name)) })).rejects.toThrow(/unveränderliche Zahlungsereignisse/u);
    expect((await readdir(storage.tenantUploadDir(targetId))).sort()).toEqual(beforeFiles);
    expect(await database.client.paymentJournalEvent.findUniqueOrThrow({ where: { id: restoredEvent.id } })).toMatchObject({ invoiceId: restoredEvent.invoiceId, incomeId: restoredEvent.incomeId });
  });

  it.each([
    [PRE_PAYMENT_JOURNAL_SCHEMA_VERSION, ['PaymentJournalEvent'], 2, 3, 1],
    [PRE_SUPPLIERS_SCHEMA_VERSION, ['PaymentJournalEvent', 'Supplier'], 0, 1, 0],
    [PRE_PURCHASE_DOCUMENTS_SCHEMA_VERSION, ['PaymentJournalEvent', 'Supplier', 'PurchaseDocument'], 0, 0, 0],
  ] as const)('restores the exact intermediate schema %s with truthful model coverage', async (schemaVersion, excludedModels, supplierCount, documentCount, expenseCount) => {
    const sourceId = `intermediate-source-${supplierCount}-${documentCount}`;
    const targetId = `intermediate-target-${supplierCount}-${documentCount}`;
    await sources(sourceId); await user(targetId);
    const { backup } = await exported(sourceId);
    if (!supplierCount) { delete backup.data.suppliers; backup.data.expenses = []; }
    if (documentCount === 1) backup.data.purchaseDocuments = backup.data.purchaseDocuments.filter((row: { reviewStatus: string }) => row.reviewStatus === 'REVIEW');
    if (!documentCount) delete backup.data.purchaseDocuments;
    delete backup.data.paymentJournalEvents;
    delete backup.data.annualBusinessContextRevisions;
    refreshManifest(backup);
    backup.manifest.schemaVersion = schemaVersion;
    backup.manifest.modelCoverage = backup.manifest.modelCoverage.filter((entry: { model: string }) => !(excludedModels as readonly string[]).includes(entry.model));
    expect(createBackupPreview(backup).counts).toMatchObject({ suppliers: supplierCount, purchaseDocuments: documentCount, expenses: expenseCount, paymentJournalEvents: 0 });
    const result = await restore.restoreBackupData({ userId: targetId, backup, overwrite: false, resolveFile: async (_kind, name) => readFile(storage.getTenantUploadPath(sourceId, name)) });
    expect(result).toMatchObject({ suppliers: { imported: supplierCount }, purchaseDocuments: { imported: documentCount }, expenses: { imported: expenseCount }, paymentJournalEvents: { imported: 0 } });
    expect(await database.client.supplier.count({ where: { userId: targetId } })).toBe(supplierCount);
    expect(await database.client.purchaseDocument.count({ where: { userId: targetId } })).toBe(documentCount);
  });

  it.each(['suppliers', 'purchaseDocuments', 'paymentJournalEvents'])('rejects a missing required current section %s even with recomputed zero-count manifest', async (key) => {
    const { backup } = await exported('integrated-source');
    delete backup.data[key];
    refreshManifest(backup);
    expect(() => createBackupPreview(backup)).toThrow(new RegExp(`erforderlichen Abschnitt: ${key}`, 'u'));
  });

  it('accepts pre-supplier incoming REVIEW sources without synthesizing contacts and rejects unbound supplier additions', async () => {
    const { backup } = await exported('incoming-backup-source');
    backup.data.purchaseDocuments = [backup.data.purchaseDocuments[0]];
    backup.data.expenses = [];
    delete backup.data.suppliers;
    delete backup.data.annualBusinessContextRevisions;
    refreshManifest(backup);
    backup.manifest.schemaVersion = PRE_SUPPLIERS_SCHEMA_VERSION;
    backup.manifest.modelCoverage = backup.manifest.modelCoverage.filter((entry: { model: string }) => entry.model !== 'Supplier' && entry.model !== 'PaymentJournalEvent');
    expect(createBackupPreview(backup).counts).toMatchObject({ suppliers: 0, purchaseDocuments: 1 });
    await user('incoming-pre-supplier-target');
    const result = await restore.restoreBackupData({ userId: 'incoming-pre-supplier-target', overwrite: false, backup, resolveFile: async (_kind, name) => readFile(storage.getTenantUploadPath('incoming-backup-source', name)) });
    expect(result.suppliers.imported).toBe(0);
    expect(result.purchaseDocuments.imported).toBe(1);
    backup.data.suppliers = [{ id: 17 }];
    expect(() => restore.validateBackupForRestore(backup)).toThrow(/ungebundenen Lieferanten/u);
    const { backup: oldBooked } = await exported('incoming-backup-source');
    delete oldBooked.data.suppliers;
    oldBooked.data.purchaseDocuments.forEach((record: Record<string, unknown>) => { delete record.supplierId; delete record.selectedSupplierSnapshot; });
    delete oldBooked.data.annualBusinessContextRevisions;
    refreshManifest(oldBooked);
    oldBooked.manifest.schemaVersion = PRE_SUPPLIERS_SCHEMA_VERSION;
    oldBooked.manifest.modelCoverage = oldBooked.manifest.modelCoverage.filter((entry: { model: string }) => entry.model !== 'Supplier' && entry.model !== 'PaymentJournalEvent');
    expect(() => restore.validateBackupForRestore(oldBooked)).toThrow(/ausdrücklich ausgewählten Lieferanten/u);
  });

  it('accepts genuine pre-inbox v3 manifests as an empty collection but rejects injected unbound sources', async () => {
    const data: Record<string, unknown> = { user: { id: 'old-source' }, auditLogs: [], invoiceNumberCounters: [] };
    const manifest = createBackupManifest({ sourceUserId: 'old-source', generatedAt: at.toISOString(), data });
    manifest.schemaVersion = PRE_PURCHASE_DOCUMENTS_SCHEMA_VERSION;
    manifest.modelCoverage = manifest.modelCoverage.filter((entry) => entry.model !== 'PurchaseDocument' && entry.model !== 'Supplier' && entry.model !== 'PaymentJournalEvent');
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
