import { stripEmptyManualFinancialRecordsForLegacy } from './helpers/backup-schema';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { PrismaClient } from '@prisma/client';
import JSZip from 'jszip';
import { createTestDatabase } from './helpers/database';
import { createBackupManifest, CURRENT_SCHEMA_VERSION, MAPPING_NUMBERING_SCHEMA_VERSION, hashBytes, validateBackupManifest } from '@/lib/backup-manifest';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, userId: 'supplier-task-backup-source' }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({ requireUserId: async () => state.userId, UnauthorizedError: class extends Error {}, unauthorizedResponse: () => new Response(null, { status: 401 }) }));
vi.mock('@/lib/audit-log', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/audit-log')>(), auditBackup: vi.fn(), auditSecurityEvent: vi.fn() }));
let database: ReturnType<typeof createTestDatabase>, root: string;
let storage: typeof import('@/lib/upload-path');
let jsonExport: typeof import('@/app/api/backup/route'), jsonRestore: typeof import('@/app/api/backup/restore/route');
let fullExport: typeof import('@/app/api/backup/full/route'), fullRestore: typeof import('@/app/api/backup/full/restore/route');
let preview: typeof import('@/lib/backup-preview'), restore: typeof import('@/lib/backup-restore'), service: typeof import('@/lib/purchase-documents/service');
let saveSupplierTask: typeof import('@/lib/purchase-documents/save-supplier-task')['saveSupplierTask'];

beforeAll(async () => {
  vi.stubEnv('NEXTAUTH_URL', 'http://localhost'); database = createTestDatabase(); state.client = database.client;
  root = await mkdtemp(path.join(tmpdir(), 'bivaro-supplier-task-backup-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
  try {
    storage = await import('@/lib/upload-path'); jsonExport = await import('@/app/api/backup/route'); jsonRestore = await import('@/app/api/backup/restore/route');
    fullExport = await import('@/app/api/backup/full/route'); fullRestore = await import('@/app/api/backup/full/restore/route');
    preview = await import('@/lib/backup-preview'); restore = await import('@/lib/backup-restore'); service = await import('@/lib/purchase-documents/service');
    ({ saveSupplierTask } = await import('@/lib/purchase-documents/save-supplier-task'));
  } finally { cwd.mockRestore(); }
}, 40_000);
afterAll(async () => { await database?.cleanup(); if (root) await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
async function user(id: string) { await database.client.user.create({ data: { id, email: `${id}@fixture.invalid`, password: 'synthetic' } }); }
async function original(userId: string, name: string) {
  const bytes = Buffer.from(`%PDF-1.7\n% synthetic immutable original ${userId}-${name}`);
  const storedFileName = await storage.writeTenantFile(userId, `${randomUUID()}.pdf`, bytes);
  const document = await database.client.purchaseDocument.create({ data: { userId, originalFileName: `${name}.pdf`, storedFileName, originalSha256: hashBytes(bytes), originalByteCount: bytes.length,
    mediaType: 'application/pdf', uploadRequestId: randomUUID(), parseStatus: 'FAILED', parseErrorCode: 'NO_EMBEDDED_XML',
    reviewDraft: { supplierName: 'Explicit draft', invoiceNumber: 'KEEP', invoiceDate: '', paymentDate: '2026-10-20', amount: '', note: 'No payment evidence' }, reviewDraftSavedAt: new Date(),
  } });
  return { document, bytes };
}
async function financial(userId: string) {
  return Promise.all([
    database.client.income.findMany({ where: { userId } }), database.client.expense.findMany({ where: { userId } }), database.client.cashBook.findMany({ where: { userId } }), database.client.cashTransaction.findMany({ where: { userId } }),
    database.client.paymentJournalEvent.findMany({ where: { userId } }), database.client.paymentAdjustment.findMany({ where: { userId } }), database.client.paymentOperation.findMany({ where: { userId } }),
    database.client.invoice.findMany({ where: { userId } }), database.client.invoiceNumberCounter.findMany({ where: { userId } }), database.client.emailOutbox.findMany({ where: { userId } }), database.client.emailOutboxAttempt.findMany({ where: { outbox: { userId } } }),
  ]);
}
async function exportZip(userId: string) {
  state.userId = userId; const response = await fullExport.GET(); expect(response.status).toBe(200);
  const bytes = await response.arrayBuffer(), zip = await JSZip.loadAsync(bytes), backup = JSON.parse(await zip.file('backup.json')!.async('string'));
  return { bytes, zip, backup };
}
async function importZip(userId: string, bytes: ArrayBuffer | Uint8Array) {
  state.userId = userId; const form = new FormData(); form.append('file', new File([bytes as ArrayBuffer], 'supplier-tasks.zip', { type: 'application/zip' }));
  return fullRestore.POST(new NextRequest('http://localhost/api/backup/full/restore', { method: 'POST', body: form }));
}
function rehash(backup: ReturnType<typeof JSON.parse>, schemaVersion = CURRENT_SCHEMA_VERSION) {
  backup.manifest = createBackupManifest({ sourceUserId: backup.data.user.id, generatedAt: backup.exportedAt, data: backup.data, fileManifest: backup.manifest.fileManifest });
  backup.manifest.schemaVersion = schemaVersion;
}

describe('supplier task backup routes and no-effect restore', () => {
  it('JSON export retains all task states and warns originals require full ZIP; JSON restore fails safely without originals', async () => {
    const source = 'supplier-task-json-source', target = 'supplier-task-json-target'; await user(source); await user(target);
    const input = await original(source, 'json'); await saveSupplierTask(source, input.document.id, 0, { kind: 'DIRECT_DEBIT_WAIT', followUpDate: null });
    const beforeSource = await financial(source), beforeTarget = await financial(target); state.userId = source;
    const response = await jsonExport.GET(); expect(response.status).toBe(200); const backup = await response.json();
    expect(backup.manifest.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(backup.data.purchaseDocuments[0]).toMatchObject({ supplierTaskKind: 'DIRECT_DEBIT_WAIT', supplierTaskFollowUpDate: null, supplierTaskConfirmationRequired: false });
    expect(preview.createBackupPreview(backup).warnings.join(' ')).toMatch(/Original|ZIP/);
    expect(() => validateBackupManifest(backup.manifest, backup.data)).not.toThrow();
    state.userId = target;
    const imported = await jsonRestore.POST(new NextRequest('http://localhost/api/backup/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(backup) }));
    expect(imported.status).toBe(400); expect(await database.client.purchaseDocument.count({ where: { userId: target } })).toBe(0);
    expect(await financial(source)).toEqual(beforeSource); expect(await financial(target)).toEqual(beforeTarget);
  });
  it('roundtrips full ZIP original bytes, dates, inactive history and reconfirmation, without financial/number/outbox effects', async () => {
    const source = 'supplier-task-zip-source', target = 'supplier-task-zip-target'; await user(source); await user(target);
    const originals = [];
    for (const [index, task] of [{ kind: 'PAYMENT_CHECK', followUpDate: '2024-02-29' }, { kind: 'DIRECT_DEBIT_WAIT', followUpDate: null }, { kind: 'CLARIFY', followUpDate: '2026-10-25' }].entries()) {
      const input = await original(source, `state-${index}`); let dto = await saveSupplierTask(source, input.document.id, 0, task);
      if (index > 0) dto = await service.changePurchaseReview(source, dto.id, dto.revision, 'dismiss', 'Retain task history');
      if (index === 2) dto = await service.changePurchaseReview(source, dto.id, dto.revision, 'reopen');
      originals.push({ ...input, dto });
    }
    const sourceBefore = await financial(source), targetBefore = await financial(target); const archive = await exportZip(source);
    expect(archive.backup.manifest.schemaVersion).toBe(CURRENT_SCHEMA_VERSION); expect(preview.createBackupPreview(archive.backup).counts.purchaseDocuments).toBe(3);
    expect((await importZip(target, archive.bytes)).status).toBe(200);
    const restored = await database.client.purchaseDocument.findMany({ where: { userId: target }, orderBy: { id: 'asc' } }); expect(restored).toHaveLength(3);
    for (const [index, record] of restored.entries()) {
      const expected = originals[index]; expect(record.userId).toBe(target);
      expect(record.originalSha256).toBe(expected.document.originalSha256); expect(record.reviewDraft).toEqual(expected.document.reviewDraft);
      expect((await service.purchaseDocumentDetail(target, record.id)).supplierTask).toEqual(expected.dto.supplierTask);
      expect(record.reviewStatus).toBe(expected.dto.reviewState);
      expect(await readFile(storage.getTenantUploadPath(target, record.storedFileName))).toEqual(expected.bytes);
    }
    const active = await service.listPurchaseDocuments(target, new URLSearchParams('taskKind=any'));
    expect(active.documents.map(row => row.id)).toEqual([restored[0].id]);
    expect(restored[2].supplierTaskConfirmationRequired).toBe(true);
    expect(await financial(source)).toEqual(sourceBefore); expect(await financial(target)).toEqual(targetBefore);
    expect((await importZip(target, archive.bytes)).status).toBe(200); // exact merge replay retains state, no duplicate task or ledger.
    expect(await database.client.purchaseDocument.count({ where: { userId: target } })).toBe(3); expect(await financial(target)).toEqual(targetBefore);
  });
  it('rejects relabelled task fields and malformed current fields in preview/restore before resolving any original', async () => {
    const source = 'supplier-task-invalid-source', target = 'supplier-task-invalid-target'; await user(source); await user(target);
    const input = await original(source, 'invalid'); await saveSupplierTask(source, input.document.id, 0, { kind: 'CLARIFY', followUpDate: null });
    const archive = await exportZip(source), before = await financial(target), resolver = vi.fn(async () => { throw new Error('Preflight must reject before files'); });
    const cases = [];
    const old = structuredClone(archive.backup); rehash(old, MAPPING_NUMBERING_SCHEMA_VERSION); cases.push(old);
    for (const changed of [{ supplierTaskFollowUpDate: '2026-02-30' }, { supplierTaskKind: null, supplierTaskConfirmationRequired: true }, { supplierTaskConfirmationRequired: 'false' }]) {
      const bad = structuredClone(archive.backup); Object.assign(bad.data.purchaseDocuments[0], changed); rehash(bad); cases.push(bad);
    }
    const missing = structuredClone(archive.backup); delete missing.data.purchaseDocuments[0].supplierTaskFollowUpDate; rehash(missing); cases.push(missing);
    for (const backup of cases) {
      expect(() => preview.createBackupPreview(backup)).toThrow();
      await expect(restore.restoreBackupData({ userId: target, backup, overwrite: false, resolveFile: resolver })).rejects.toThrow();
    }
    expect(resolver).not.toHaveBeenCalled(); expect(await financial(target)).toEqual(before); expect(await database.client.purchaseDocument.count({ where: { userId: target } })).toBe(0);
  });
  it('restores genuine old task-free backups without inventing tasks and protects newer task history from legacy overwrite', async () => {
    const source = 'supplier-task-old-source', target = 'supplier-task-old-target'; await user(source); await user(target); const oldInput = await original(source, 'old-empty');
    const archive = await exportZip(source);
    for (const row of archive.backup.data.purchaseDocuments) { expect(row.supplierTaskKind).toBeNull(); delete row.supplierTaskKind; delete row.supplierTaskFollowUpDate; delete row.supplierTaskConfirmationRequired; }
    rehash(archive.backup, MAPPING_NUMBERING_SCHEMA_VERSION); stripEmptyManualFinancialRecordsForLegacy(archive.backup); expect(() => preview.createBackupPreview(archive.backup)).not.toThrow();
    archive.zip.file('backup.json', JSON.stringify(archive.backup)); const oldBytes = await archive.zip.generateAsync({ type: 'uint8array' });
    expect((await importZip(target, oldBytes)).status).toBe(200);
    const restored = await database.client.purchaseDocument.findFirstOrThrow({ where: { userId: target } });
    expect(restored).toMatchObject({ supplierTaskKind: null, supplierTaskFollowUpDate: null, supplierTaskConfirmationRequired: false });
    await saveSupplierTask(target, restored.id, restored.revision, { kind: 'PAYMENT_CHECK', followUpDate: null });
    const before = await database.client.purchaseDocument.findMany({ where: { userId: target } }), beforeFinancial = await financial(target);
    await expect(restore.restoreBackupData({ userId: target, backup: archive.backup, overwrite: true, resolveFile: async () => oldInput.bytes })).rejects.toThrow(/Lieferanten-Vormerkungen/);
    expect(await database.client.purchaseDocument.findMany({ where: { userId: target } })).toEqual(before); expect(await financial(target)).toEqual(beforeFinancial);
  });
});
