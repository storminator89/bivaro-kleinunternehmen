import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { inspectBackupFiles, BackupFileInspectionError } from '@/lib/backup-file-preview';
import { BackupFileInspectionSummary } from '@/components/settings/backup-file-inspection';
import { createZipReadBudget, loadZipWithinLimits, readZipEntryWithinLimit, ZipResourceLimitError } from '@/lib/zip-limits';
import type { BackupFileManifestEntry } from '@/lib/backup-manifest';
import { createBackupPreview } from '@/lib/backup-preview';
import { createBackupManifest } from './helpers/backup';
import { isUnrenderedServiceBillingDraft } from '@/lib/service-billing';

// This suite only parses tiny in-memory archives. Any accidental database
// access is a failure; there is no database, fixture directory, or app server.
vi.mock('@/lib/prisma', () => ({ prisma: new Proxy({}, { get() { throw new Error('Database access is forbidden in the archive inspection suite'); } }) }));

const original = Buffer.from('%PDF-synthetic-only');
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function manifest(overrides: Partial<BackupFileManifestEntry> = {}): BackupFileManifestEntry {
  return { kind: 'invoice', sourceName: 'invoice.pdf', zipPath: 'invoices/invoice.pdf', bytes: original.length, sha256: hash(original), ...overrides };
}
async function archive(files: Record<string, Uint8Array | string>) {
  const source = new JSZip();
  source.file('backup.json', '{}');
  for (const [path, bytes] of Object.entries(files)) source.file(path, bytes);
  const bytes = await source.generateAsync({ type: 'uint8array', compression: 'STORE' });
  expect(bytes.byteLength).toBeLessThan(10 * 1024);
  return loadZipWithinLimits(bytes);
}
const invoiceData = { invoices: [{ id: 1, storedFileName: 'invoice.pdf' }] };

describe('read-only full-backup file inspection', () => {
  it('accepts the real current-format graph validator and manifest before inspecting an original', async () => {
    const data = {
      user: { id: 'synthetic-source', email: 'source@example.test', name: 'Synthetic source' },
      customers: [], suppliers: [], serviceArticles: [], purchaseDocuments: [], serviceBillingPlans: [], serviceBillingPeriods: [],
      paymentJournalEvents: [], incomes: [], expenses: [], auditLogs: [], invoiceNumberCounters: [],
      invoices: [{ id: 1, type: 'INVOICE', fileName: 'invoice.pdf', storedFileName: 'invoice.pdf', invoiceNumber: '2026-1', uploadedAt: '2026-01-01T00:00:00.000Z', invoiceDate: '2026-01-01T00:00:00.000Z', parsedData: {}, status: 'DRAFT', issuanceState: 'UNKNOWN' }],
    };
    const backup = { version: '3.0', type: 'full', exportedAt: '2026-01-02T00:00:00.000Z', data,
      manifest: createBackupManifest({ sourceUserId: 'synthetic-source', generatedAt: '2026-01-02T00:00:00.000Z', data, fileManifest: [manifest()] }) };
    const preview = createBackupPreview(backup);
    const zip = await archive({ 'invoices/invoice.pdf': original });
    expect(await inspectBackupFiles(zip, data, preview.manifest?.fileManifest, createZipReadBudget())).toMatchObject({ status: 'MANIFEST_VERIFIED', verifiedFiles: 1 });
    const legacy = { version: '2.0', type: 'full', data: { user: data.user, customers: [], invoices: data.invoices, incomes: [], expenses: [] } };
    const oldPreview = createBackupPreview(legacy);
    expect(await inspectBackupFiles(zip, legacy.data, oldPreview.manifest?.fileManifest, createZipReadBudget())).toMatchObject({ status: 'LEGACY_UNVERIFIED', verifiedFiles: 0, checkedFiles: 1 });
  });
  it('reads actual bytes and verifies unique manifest paths without extracting any files', async () => {
    const zip = await archive({ 'invoices/invoice.pdf': original });
    const budget = createZipReadBudget();
    await readZipEntryWithinLimit(zip.file('backup.json')!, undefined, budget);
    const result = await inspectBackupFiles(zip, invoiceData, [manifest()], budget);
    expect(result).toEqual({ status: 'MANIFEST_VERIFIED', archiveFiles: 1, referencedFiles: 1, checkedFiles: 1, verifiedFiles: 1, checkedBytes: original.length, unlistedFiles: 0 });
    expect(budget.consumedBytes).toBe(2 + original.length);
  });

  it.each([
    ['missing', {}, /fehlt im ZIP/u],
    ['empty', { 'invoices/invoice.pdf': '' }, /leere Originaldatei/u],
    ['truncated', { 'invoices/invoice.pdf': original.subarray(0, -1) }, /Größe/u],
    ['tampered', { 'invoices/invoice.pdf': Buffer.from('%PDF-synthetic-fake') }, /SHA-256/u],
  ] as const)('blocks %s originals before a successful preview can be returned', async (_name, files, message) => {
    const zip = await archive(files);
    await expect(inspectBackupFiles(zip, invoiceData, [manifest()], createZipReadBudget())).rejects.toThrow(message);
  });

  it('rejects noncanonical uppercase manifest hashes rather than promising a restore-incompatible verified preview', async () => {
    const zip = await archive({ 'invoices/invoice.pdf': original });
    const uppercase = manifest({ sha256: hash(original).toUpperCase() });
    await expect(inspectBackupFiles(zip, invoiceData, [uppercase], createZipReadBudget())).rejects.toBeInstanceOf(BackupFileInspectionError);
  });

  it('blocks a model original omitted from the manifest even when a same-named payload exists', async () => {
    const zip = await archive({ 'invoices/invoice.pdf': original });
    await expect(inspectBackupFiles(zip, invoiceData, [], createZipReadBudget())).rejects.toThrow(/fehlt im Backup-Dateimanifest/u);
  });

  it('deduplicates shared incoming-original/expense payloads within the shared read budget', async () => {
    const zip = await archive({ 'purchase-documents/source.pdf': original });
    const entries = [manifest({ kind: 'purchase-document', sourceName: 'source.pdf', zipPath: 'purchase-documents/source.pdf' }), manifest({ kind: 'receipt', sourceName: 'source.pdf', zipPath: 'purchase-documents/source.pdf' })];
    const result = await inspectBackupFiles(zip, { purchaseDocuments: [{ storedFileName: 'source.pdf' }], expenses: [{ storedReceiptFileName: 'source.pdf' }] }, entries, createZipReadBudget(original.length));
    expect(result).toMatchObject({ referencedFiles: 1, checkedFiles: 1, verifiedFiles: 1, checkedBytes: original.length });
  });

  it('rejects contradictory hashes for one shared path and duplicate source identities', async () => {
    const zip = await archive({ 'invoices/invoice.pdf': original });
    await expect(inspectBackupFiles(zip, invoiceData, [manifest(), manifest({ kind: 'receipt', sha256: 'a'.repeat(64) })], createZipReadBudget())).rejects.toThrow(/widersprechen/u);
    await expect(inspectBackupFiles(zip, invoiceData, [manifest(), manifest()], createZipReadBudget())).rejects.toThrow(/doppelte Dateiquelle/u);
  });

  it('warns about unlisted payloads without reading or claiming to restore them', async () => {
    const zip = await archive({ 'invoices/invoice.pdf': original, 'extra.txt': 'not referenced' });
    const result = await inspectBackupFiles(zip, invoiceData, [manifest()], createZipReadBudget(original.length));
    expect(result).toMatchObject({ archiveFiles: 2, checkedFiles: 1, unlistedFiles: 1 });
    const html = renderToStaticMarkup(createElement(BackupFileInspectionSummary, { inspection: result }));
    expect(html).toContain('1 zusätzliche ZIP-Dateien');
    expect(html).toContain('Diese Dateien werden nicht wiederhergestellt.');
    expect(html).toContain('Prüfsummen bestätigen keine Herkunft.');
  });

  it('checks legacy availability but never claims original hashes or target compatibility', async () => {
    const zip = await archive({ 'invoices/invoice.pdf': original });
    const result = await inspectBackupFiles(zip, invoiceData, undefined, createZipReadBudget());
    expect(result).toMatchObject({ status: 'LEGACY_UNVERIFIED', checkedFiles: 1, verifiedFiles: 0, unlistedFiles: 0 });
    const html = renderToStaticMarkup(createElement(BackupFileInspectionSummary, { inspection: result }));
    expect(html).toContain('ursprüngliche Prüfsummen bleiben unbekannt');
    expect(html).toContain('kein Abgleich mit dem Zielbestand');
    expect(html).not.toContain('Dateiprüfung gegen Manifest bestanden');
    await expect(inspectBackupFiles(await archive({}), invoiceData, undefined, createZipReadBudget())).rejects.toBeInstanceOf(BackupFileInspectionError);
  });

  it('includes metadata and every unique original in one decompression budget', async () => {
    const zip = await archive({ 'invoices/invoice.pdf': original });
    const budget = createZipReadBudget(original.length + 1);
    await readZipEntryWithinLimit(zip.file('backup.json')!, undefined, budget);
    await expect(inspectBackupFiles(zip, invoiceData, [manifest()], budget)).rejects.toBeInstanceOf(ZipResourceLimitError);
  });

  it('handles default manifest paths, encoded private logos, absent expense originals and empty archives honestly', async () => {
    const zip = await archive({ 'logos/logo.png': original });
    const result = await inspectBackupFiles(zip, { settings: { logoUrl: '/api/files/logo?file=logo%2Epng' }, expenses: [{ storedReceiptFileName: null }] }, [manifest({ kind: 'logo', sourceName: 'logo.png', zipPath: undefined })], createZipReadBudget());
    expect(result).toMatchObject({ referencedFiles: 1, verifiedFiles: 1 });
    expect(await inspectBackupFiles(await archive({}), {}, [], createZipReadBudget())).toMatchObject({ status: 'MANIFEST_VERIFIED', checkedFiles: 0, verifiedFiles: 0 });
  });

  it('does not invent a missing original for a genuine unrendered service draft', async () => {
    const items = [{ description: 'Synthetic service', quantity: 1, unitPrice: 10, unit: 'Stück', taxRate: 19 }];
    const draft = { id: 1, type: 'INVOICE', status: 'DRAFT', issuanceState: 'UNISSUED', storedFileName: '', invoiceNumber: null, invoiceDate: null, dueDate: null, totalAmount: 11.9,
      parsedData: { _serviceBillingDraft: { version: 1, planStableKey: '11111111-1111-4111-8111-111111111111', periodIndex: 0, periodStart: '2026-01-01', periodEnd: '2026-01-31', taxMode: 'standard', items, customerAddress: '', notes: '' },
        currency: 'EUR', documentType: 'INVOICE', netAmount: 10, taxAmount: 1.9, grossAmount: 11.9, totalAmount: 11.9, lineItems: [{ ...items[0], positionNumber: '1', amount: 10 }] } };
    expect(isUnrenderedServiceBillingDraft(draft)).toBe(true);
    const zip = await archive({});
    expect(await inspectBackupFiles(zip, { invoices: [draft] }, [], createZipReadBudget())).toMatchObject({ referencedFiles: 0, checkedFiles: 0 });
    await expect(inspectBackupFiles(zip, { invoices: [{ ...draft, totalAmount: 12 }] }, [], createZipReadBudget())).rejects.toBeInstanceOf(BackupFileInspectionError);
  });

  it.each(['../outside.pdf', '/outside.pdf', 'nested/outside.pdf', 'bad\\name.pdf'])('rejects unsafe source names: %s', async sourceName => {
    await expect(inspectBackupFiles(await archive({}), { invoices: [{ id: 1, storedFileName: sourceName }] }, undefined, createZipReadBudget())).rejects.toBeInstanceOf(BackupFileInspectionError);
  });

  it('rejects unsafe manifest paths, encoded logo traversal and ZIP traversal before reading payloads', async () => {
    const zip = await archive({});
    await expect(inspectBackupFiles(zip, {}, [manifest({ zipPath: '../outside.pdf' })], createZipReadBudget())).rejects.toBeInstanceOf(BackupFileInspectionError);
    await expect(inspectBackupFiles(zip, { settings: { logoUrl: '/api/files/logo?file=..%2Foutside.png' } }, undefined, createZipReadBudget())).rejects.toBeInstanceOf(BackupFileInspectionError);
    await expect(archive({ '../outside.pdf': original })).rejects.toBeInstanceOf(ZipResourceLimitError);
  });
});
