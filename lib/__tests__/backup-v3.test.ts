import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestDatabase } from './helpers/database';
import { createBackupManifest, redactAuditLog } from '@/lib/backup-manifest';
import { createBackupPreview } from '@/lib/backup-preview';
import { getNextDocumentNumber } from '@/lib/invoice-numbers';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));

let database: ReturnType<typeof createTestDatabase>;
let restore: typeof import('@/lib/backup-restore');
let storageRoot: string;

beforeAll(async () => {
  database = createTestDatabase();
  state.client = database.client;
  storageRoot = await mkdtemp(path.join(tmpdir(), 'bivaro-backup-v3-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(storageRoot);
  try {
    restore = await import('@/lib/backup-restore');
  } finally {
    cwd.mockRestore();
  }
}, 40_000);

afterAll(async () => {
  await database?.cleanup();
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
});

function makeBackup() {
  const data = {
    user: { id: 'source-owner', email: 'source@backup.test', name: 'Source' },
    customers: [{ id: 10, name: 'Restore customer', createdAt: '2026-01-01T00:00:00.000Z' }],
    invoices: [{
      id: 20,
      type: 'INVOICE',
      fileName: 'invoice.pdf',
      storedFileName: 'invoice.pdf',
      invoiceNumber: '2026-42',
      uploadedAt: '2026-01-01T00:00:00.000Z',
      invoiceDate: '2026-01-01T00:00:00.000Z',
      parsedData: {},
      status: 'DRAFT',
      issuanceState: 'UNKNOWN',
      customerId: 10,
    }],
    incomes: [],
    apiKeys: [{ id: 30, name: 'old-key', keyPrefix: 'biv_sk_old', scopes: '["read"]', isActive: true, createdAt: '2026-01-01T00:00:00.000Z' }],
    auditLogs: [{
      id: 40,
      userId: 'source-owner',
      action: 'CREATE',
      entityType: 'Invoice',
      entityId: '20',
      entityName: '2026-42',
      oldValues: null,
      newValues: JSON.stringify({ invoiceNumber: '2026-42', keyHash: 'must-not-survive' }),
      changedFields: null,
      ipAddress: null,
      userAgent: null,
      sessionId: null,
      metadata: JSON.stringify({ source: 'fixture' }),
      createdAt: '2026-01-01T00:00:00.000Z',
    }],
    invoiceNumberCounters: [{ type: 'INVOICE', year: 2026, value: 42 }],
  };
  return {
    version: '3.0',
    type: 'full',
    exportedAt: '2026-01-02T00:00:00.000Z',
    manifest: createBackupManifest({ sourceUserId: 'source-owner', generatedAt: '2026-01-02T00:00:00.000Z', data }),
    data,
  };
}

describe('backup v3 manifest and restore', () => {
  it('roundtrips audit provenance and preserves a deleted highest counter', async () => {
    await database.client.user.create({ data: { id: 'target-owner', email: 'target-owner@backup.test', password: 'fixture' } });
    const backup = makeBackup();
    const result = await restore.restoreBackupData({
      userId: 'target-owner',
      overwrite: true,
      backup,
      resolveFile: async () => new Uint8Array([37, 80, 68, 70]),
    });

    expect(result.auditLogs.imported).toBe(1);
    expect(result.invoiceNumberCounters.imported).toBe(1);
    expect(result.warnings.some((warning) => warning.includes('API-Schlüssel'))).toBe(true);
    const counter = await database.client.invoiceNumberCounter.findUnique({ where: { userId_type_year: { userId: 'target-owner', type: 'INVOICE', year: 2026 } } });
    expect(counter?.value).toBe(42);
    const audit = await database.client.auditLog.findFirstOrThrow({ where: { userId: 'target-owner', action: 'CREATE' } });
    expect(audit.entityId).toBe(String((await database.client.invoice.findFirstOrThrow({ where: { userId: 'target-owner' } })).id));
    expect(audit.metadata).toContain('source-owner');
    expect(audit.metadata).toContain('mapped');
    expect(audit.newValues).not.toContain('keyHash');

    const next = await database.client.$transaction((tx) => getNextDocumentNumber(tx, 'target-owner', 'INVOICE', 2026));
    expect(next).toBe('2026-43');

    const repeated = await restore.restoreBackupData({
      userId: 'target-owner',
      overwrite: false,
      backup,
      resolveFile: async () => new Uint8Array([37, 80, 68, 70]),
    });
    expect(repeated.auditLogs.skipped).toBe(1);
    expect(await database.client.auditLog.count({ where: { userId: 'target-owner' } })).toBe(3);
  });

  it('keeps historical invoice years before overwrite and appends mapping events', async () => {
    await database.client.user.create({ data: { id: 'mapping-owner', email: 'mapping-owner@backup.test', password: 'fixture' } });
    await restore.restoreBackupData({
      userId: 'mapping-owner',
      overwrite: true,
      backup: makeBackup(),
      resolveFile: async () => new Uint8Array([37, 80, 68, 70]),
    });
    const originalAudit = await database.client.auditLog.findFirstOrThrow({ where: { userId: 'mapping-owner', action: 'CREATE' } });
    const originalInvoice = await database.client.invoice.findFirstOrThrow({ where: { userId: 'mapping-owner' } });

    await database.client.user.create({ data: { id: 'historical-owner', email: 'historical-owner@backup.test', password: 'fixture' } });
    await database.client.invoice.create({ data: {
      type: 'INVOICE',
      fileName: 'historical.pdf',
      storedFileName: 'historical.pdf',
      invoiceNumber: '2027-50',
      invoiceDate: new Date('2020-01-01T00:00:00.000Z'),
      parsedData: {},
      userId: 'historical-owner',
    } });
    await restore.restoreBackupData({
      userId: 'historical-owner',
      overwrite: true,
      backup: makeBackup(),
      resolveFile: async () => new Uint8Array([37, 80, 68, 70]),
    });
    const historicalCounter = await database.client.invoiceNumberCounter.findUnique({ where: { userId_type_year: { userId: 'historical-owner', type: 'INVOICE', year: 2027 } } });
    expect(historicalCounter?.value).toBe(50);
    const historicalNext = await database.client.$transaction((tx) => getNextDocumentNumber(tx, 'historical-owner', 'INVOICE', 2027));
    expect(historicalNext).toBe('2027-51');

    await restore.restoreBackupData({
      userId: 'mapping-owner',
      overwrite: true,
      backup: makeBackup(),
      resolveFile: async () => new Uint8Array([37, 80, 68, 70]),
    });
    const currentInvoice = await database.client.invoice.findFirstOrThrow({ where: { userId: 'mapping-owner' } });
    const sourceAudits = await database.client.auditLog.findMany({ where: { userId: 'mapping-owner', action: 'CREATE' } });
    const mappingAudits = await database.client.auditLog.findMany({ where: { userId: 'mapping-owner', action: 'RESTORE', entityType: 'Invoice' } });
    expect(sourceAudits).toHaveLength(1);
    expect(sourceAudits[0].id).toBe(originalAudit.id);
    expect(sourceAudits[0].entityId).toBe(String(originalInvoice.id));
    expect(mappingAudits).toHaveLength(1);
    expect(mappingAudits[0].entityId).toBe(String(currentInvoice.id));
    expect(mappingAudits[0].oldValues).toContain(String(originalInvoice.id));
    expect(mappingAudits[0].newValues).toContain(String(currentInvoice.id));
    expect(mappingAudits[0].metadata).toContain('mappingEvent');
  });

  it('never lowers an existing issuance marker and only upgrades to ISSUED', async () => {
    await database.client.user.create({ data: { id: 'issuance-owner', email: 'issuance-owner@backup.test', password: 'fixture' } });
    await database.client.invoice.create({ data: {
      type: 'INVOICE',
      fileName: 'existing.pdf',
      storedFileName: 'existing.pdf',
      invoiceNumber: '2026-42',
      parsedData: {},
      issuanceState: 'UNISSUED',
      userId: 'issuance-owner',
    } });
    await restore.restoreBackupData({ userId: 'issuance-owner', overwrite: false, backup: makeBackup(), resolveFile: async () => new Uint8Array([1]) });
    let invoice = await database.client.invoice.findFirstOrThrow({ where: { userId: 'issuance-owner' } });
    expect(invoice.issuanceState).toBe('UNKNOWN');

    const issuedBackup = makeBackup();
    issuedBackup.data.invoices[0].issuanceState = 'ISSUED';
    issuedBackup.manifest = createBackupManifest({ sourceUserId: 'source-owner', generatedAt: issuedBackup.exportedAt, data: issuedBackup.data });
    await restore.restoreBackupData({ userId: 'issuance-owner', overwrite: false, backup: issuedBackup, resolveFile: async () => new Uint8Array([1]) });
    invoice = await database.client.invoice.findFirstOrThrow({ where: { userId: 'issuance-owner' } });
    expect(invoice.issuanceState).toBe('ISSUED');
  });

  it('redacts sensitive audit fields and rejects unknown manifest models', () => {
    const redacted = redactAuditLog({ metadata: JSON.stringify({ keyHash: 'secret', nested: { token: 'secret', keep: 'ok' } }) });
    expect(redacted.metadata).not.toContain('secret');
    expect(redacted.metadata).toContain('keep');
    expect(redactAuditLog({ metadata: 'keyHash=secret' }).metadata).toBe('[REDACTED_UNPARSEABLE]');

    const backup = makeBackup();
    backup.manifest.modelCoverage.push({ model: 'FutureModel', key: 'future', mode: 'included', count: 0, sha256: 'x' } as never);
    expect(() => restore.validateBackupForRestore(backup)).toThrow(/unbekanntes|doppeltes Modell/u);
    expect(createBackupPreview({ ...makeBackup(), type: 'json' }).type).toBe('json');
  });
});
