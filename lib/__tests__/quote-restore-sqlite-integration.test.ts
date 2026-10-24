import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from './helpers/database';
import { createBackupManifest, hashBytes } from '@/lib/backup-manifest';
import { readBackupSnapshot } from '@/lib/backup-snapshot';
import { quoteCreateFingerprintForInvoice } from '@/lib/quote-create-request';

const state = vi.hoisted(() => ({ client: null as ReturnType<typeof createTestDatabase>['client'] | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
let database: ReturnType<typeof createTestDatabase>, directory: string;
let storage: typeof import('@/lib/upload-path'), restore: typeof import('@/lib/backup-restore');
let backup: { version: string; type: string; data: Record<string, unknown>; manifest: ReturnType<typeof createBackupManifest> };
const source = 'sqlite-quote-source', target = 'sqlite-quote-target', conflict = 'sqlite-quote-conflict';
const bytes = Buffer.from('%PDF-1.7\nsynthetic immutable quote original\n%%EOF');
const requestId = randomUUID(), at = new Date('2026-10-24T00:00:00.000Z');
let targetOriginal = '';
beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  directory = await mkdtemp(path.join(tmpdir(), 'bivaro-combined-quote-files-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
  try { storage = await import('@/lib/upload-path'); restore = await import('@/lib/backup-restore'); } finally { cwd.mockRestore(); }
  await database.client.user.createMany({ data: [source, target, conflict].map(id => ({ id, email: `${id}@synthetic.test`, password: 'fixture-only' })) });
  const storedFileName = await storage.writeTenantFile(source, 'synthetic.pdf', bytes);
  const fields = { type: 'QUOTE', fileName: 'synthetic.pdf', invoiceNumber: 'AN-2026-0001', invoiceDate: at, validUntil: null, totalAmount: 42, parsedData: { createdBy: 'bivaro', items: [{ description: 'Synthetic quote', quantity: 1, amount: 42 }] } };
  const fingerprint = quoteCreateFingerprintForInvoice(fields);
  const invoice = await database.client.invoice.create({ data: { userId: source, ...fields, storedFileName, quoteCreateRequestId: requestId, quoteCreateFingerprint: fingerprint } });
  await database.client.quoteCreateReceipt.create({ data: { userId: source, requestId, fingerprint, pdfSha256: hashBytes(bytes), invoiceUserId: source, invoiceId: invoice.id, createdAt: at } });
  const snapshot = await readBackupSnapshot(source);
  backup = { version: '3.0', type: 'full', data: snapshot.data, manifest: createBackupManifest({ sourceUserId: source, generatedAt: snapshot.info.endedAt, data: snapshot.data, fileManifest: [{ kind: 'invoice', sourceName: storedFileName, sha256: hashBytes(bytes), bytes: bytes.length }] }) };
}, 40_000);
afterAll(async () => { await database?.cleanup(); if (directory) await rm(directory, { recursive: true, force: true }); });

describe('real SQLite and temporary private-file quote restore seams', () => {
  it('restores across owners with new private filenames and strong tenant receipt links', async () => {
    await restore.restoreBackupData({ userId: target, backup, overwrite: false, resolveFile: async () => bytes });
    const invoice = await database.client.invoice.findFirstOrThrow({ where: { userId: target } }); targetOriginal = invoice.storedFileName;
    expect(invoice.storedFileName).not.toBe((backup.data.invoices as Array<{ storedFileName: string }>)[0].storedFileName);
    expect(await readFile(storage.getTenantUploadPath(target, invoice.storedFileName))).toEqual(bytes);
    expect(await database.client.quoteCreateReceipt.findUnique({ where: { userId_requestId: { userId: target, requestId } } })).toMatchObject({ invoiceUserId: target, invoiceId: invoice.id, pdfSha256: hashBytes(bytes) });
  });
  it('preserves exact target original bytes while real FK tombstone/relink runs during overwrite', async () => {
    const original = await database.client.invoice.findFirstOrThrow({ where: { userId: target } });
    const resolveFile = vi.fn(async () => Buffer.from('%PDF-malicious replacement'));
    await restore.restoreBackupData({ userId: target, backup, overwrite: true, resolveFile });
    const invoice = await database.client.invoice.findFirstOrThrow({ where: { userId: target } });
    expect(invoice.id).not.toBe(original.id); expect(invoice.storedFileName).toBe(targetOriginal); expect(resolveFile).not.toHaveBeenCalled();
    expect(await readFile(storage.getTenantUploadPath(target, targetOriginal))).toEqual(bytes);
    expect(await database.client.quoteCreateReceipt.findUnique({ where: { userId_requestId: { userId: target, requestId } } })).toMatchObject({ invoiceUserId: target, invoiceId: invoice.id });
    await database.client.invoice.delete({ where: { id: invoice.id } });
    await expect(restore.restoreBackupData({ userId: target, backup, overwrite: false, resolveFile: async () => bytes })).rejects.toThrow(/gelöschtes Angebot|reaktivieren/);
    expect(await database.client.invoice.count({ where: { userId: target } })).toBe(0);
    expect(await database.client.quoteCreateReceipt.findUnique({ where: { userId_requestId: { userId: target, requestId } } })).toMatchObject({ invoiceId: null, invoiceUserId: null });
  });
  it('rolls back real database writes and removes only newly staged private files on a later policy conflict', async () => {
    const policy = { type: 'INVOICE', revision: 1, formatVersion: 1, prefix: 'RE-', includeYear: true, sequenceWidth: 4, startSequence: 1, effectiveYear: 2026, createdAt: at };
    await database.client.documentNumberingPolicy.create({ data: { ...policy, userId: conflict, prefix: 'OTHER-' } });
    const incoming = structuredClone(backup); incoming.data.documentNumberingPolicies = [policy]; incoming.manifest = createBackupManifest({ sourceUserId: source, generatedAt: backup.manifest.generatedAt, data: incoming.data, fileManifest: backup.manifest.fileManifest });
    await expect(restore.restoreBackupData({ userId: conflict, backup: incoming, overwrite: false, resolveFile: async () => bytes })).rejects.toThrow(/Nummernformat-Revision weicht/);
    expect(await database.client.invoice.count({ where: { userId: conflict } })).toBe(0); expect(await database.client.quoteCreateReceipt.count({ where: { userId: conflict } })).toBe(0);
    expect(await readdir(path.join(storage.UPLOAD_BASE_DIR, conflict))).toEqual([]);
    expect(await readFile(storage.getTenantUploadPath(target, targetOriginal))).toEqual(bytes);
  });
});
