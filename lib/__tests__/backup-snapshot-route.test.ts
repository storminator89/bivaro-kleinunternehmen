import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createTestDatabase } from './helpers/database';

const control = vi.hoisted(() => ({
  userId: 'snapshot-route-source',
  gateEnabled: false,
  entered: null as Promise<void> | null,
  signalEntered: null as (() => void) | null,
  release: null as (() => void) | null,
  driftPath: null as string | null,
  driftEnabled: false,
}));
const state = vi.hoisted(() => ({ client: null as ReturnType<typeof createTestDatabase>['client'] | null }));

vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({
  requireUserId: async () => control.userId,
  UnauthorizedError: class extends Error {},
  unauthorizedResponse: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/audit-log', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/audit-log')>(),
  auditBackup: vi.fn(),
  auditSecurityEvent: vi.fn(),
}));
vi.mock('@/lib/backup-snapshot', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/backup-snapshot')>();
  return {
    ...actual,
    getBackupFileVersion: async (filePath: string) => {
      if (control.driftEnabled && control.driftPath === filePath) {
        control.driftEnabled = false;
        await writeFile(filePath, Buffer.from('changed-during-final-check'));
      }
      return actual.getBackupFileVersion(filePath);
    },
  };
});
vi.mock('jszip', async importOriginal => {
  const actual = await importOriginal<typeof import('jszip')>();
  // `jszip` is declared with `export = JSZip`; Vitest exposes that CommonJS
  // export through `default` at runtime even though TypeScript's dynamic
  // import type does not declare the property.
  const BaseZip = (actual as unknown as { default: typeof import('jszip') }).default;
  type ZipInstance = InstanceType<typeof BaseZip>;
  const originalGenerateAsync = BaseZip.prototype.generateAsync;
  class GatedZip extends BaseZip {
    override generateAsync = (async (...args: Parameters<ZipInstance['generateAsync']>) => {
      if (control.gateEnabled) {
        control.gateEnabled = false;
        control.signalEntered?.();
        await new Promise<void>((resolve) => { control.release = resolve; });
      }
      return Reflect.apply(originalGenerateAsync, this, args);
    }) as ZipInstance['generateAsync'];
  }
  return { ...actual, default: GatedZip };
});

let database: ReturnType<typeof createTestDatabase>;
let directory: string;
let storage: typeof import('@/lib/upload-path');
let exportFull: typeof import('@/app/api/backup/full/route');
let restoreFull: typeof import('@/app/api/backup/full/restore/route');

beforeAll(async () => {
  database = createTestDatabase();
  state.client = database.client;
  directory = await mkdtemp(path.join(tmpdir(), 'bivaro-snapshot-route-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
  try {
    storage = await import('@/lib/upload-path');
    exportFull = await import('@/app/api/backup/full/route');
    restoreFull = await import('@/app/api/backup/full/restore/route');
  } finally {
    cwd.mockRestore();
  }
}, 40_000);

afterAll(async () => {
  control.gateEnabled = false;
  control.release?.();
  await database?.cleanup();
  if (directory) await rm(directory, { recursive: true, force: true });
});

function armGenerateGate(): Promise<void> {
  control.gateEnabled = true;
  control.release = null;
  control.entered = new Promise<void>((resolve) => { control.signalEntered = resolve; });
  return control.entered;
}

async function createSourceFixture(userId: string, fileBytes: Uint8Array) {
  await database.client.user.create({ data: { id: userId, email: `${userId}@backup.test`, password: 'fixture' } });
  const storedFileName = await storage.writeTenantFile(userId, 'payment.pdf', fileBytes);
  const invoice = await database.client.invoice.create({ data: {
    userId,
    fileName: 'payment.pdf',
    storedFileName,
    invoiceNumber: '2026-20',
    parsedData: {},
    totalAmount: 20,
    status: 'DRAFT',
  } });
  await database.client.invoiceNumberCounter.create({ data: { userId, type: 'INVOICE', year: 2026, value: 20 } });
  await database.client.auditLog.create({ data: {
    userId,
    action: 'CREATE',
    entityType: 'Invoice',
    entityId: String(invoice.id),
    entityName: invoice.invoiceNumber,
    newValues: JSON.stringify({ status: 'DRAFT' }),
  } });
  return { invoice, storedFileName };
}

async function applyPayment(userId: string, invoiceId: number) {
  await database.client.$transaction(async (tx) => {
    const paidAt = new Date('2026-01-02T00:00:00.000Z');
    await tx.invoice.update({ where: { id: invoiceId, userId }, data: { status: 'PAID', paidAt } });
    await tx.income.create({ data: { userId, description: 'Payment', amount: 20, date: paidAt, invoiceId } });
    await tx.invoiceNumberCounter.update({ where: { userId_type_year: { userId, type: 'INVOICE', year: 2026 } }, data: { value: 21 } });
    await tx.auditLog.create({ data: {
      userId,
      action: 'PAYMENT_RECEIVED',
      entityType: 'Invoice',
      entityId: String(invoiceId),
      entityName: '2026-20',
      newValues: JSON.stringify({ status: 'PAID', amount: 20 }),
    } });
  });
}

async function restoreZipAs(userId: string, zipBytes: ArrayBuffer): Promise<Response> {
  control.userId = userId;
  const form = new FormData();
  form.append('file', new File([zipBytes], 'snapshot.zip', { type: 'application/zip' }));
  return restoreFull.POST(new NextRequest('http://localhost/api/backup/full/restore', { method: 'POST', body: form }));
}

describe('full backup snapshot route', () => {
  it('exports a complete pre-payment snapshot while payment commits during ZIP packing', async () => {
    const source = await createSourceFixture(control.userId, new Uint8Array([1, 2, 3, 4]));
    await database.client.user.create({ data: { id: 'snapshot-route-target', email: 'target@backup.test', password: 'fixture' } });

    const entered = armGenerateGate();
    let exportPromise: Promise<Response> | undefined;
    try {
      exportPromise = exportFull.GET();
      await Promise.race([
        entered,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('ZIP-Gate wurde nicht erreicht')), 5_000)),
      ]);
      await applyPayment(control.userId, source.invoice.id);
      const sourceAfter = await database.client.invoice.findUniqueOrThrow({ where: { id: source.invoice.id }, include: { income: true } });
      expect(sourceAfter.status).toBe('PAID');
      expect(sourceAfter.income?.amount).toBe(20);
      expect((await database.client.invoiceNumberCounter.findUniqueOrThrow({ where: { userId_type_year: { userId: control.userId, type: 'INVOICE', year: 2026 } } })).value).toBe(21);
      control.release?.();
      const response = await exportPromise;
      expect(response.status).toBe(200);
      const zipBytes = await response.arrayBuffer();

      const restoreResponse = await restoreZipAs('snapshot-route-target', zipBytes);
      expect(restoreResponse.status).toBe(200);
      const targetInvoice = await database.client.invoice.findFirstOrThrow({ where: { userId: 'snapshot-route-target' } });
      expect(targetInvoice.status).toBe('DRAFT');
      expect(await database.client.income.count({ where: { userId: 'snapshot-route-target' } })).toBe(0);
      expect((await database.client.invoiceNumberCounter.findUniqueOrThrow({ where: { userId_type_year: { userId: 'snapshot-route-target', type: 'INVOICE', year: 2026 } } })).value).toBe(20);
      const importedAudits = await database.client.auditLog.findMany({ where: { userId: 'snapshot-route-target' } });
      expect(importedAudits.some((audit) => audit.action === 'PAYMENT_RECEIVED')).toBe(false);
      expect(importedAudits.some((audit) => audit.action === 'RESTORE')).toBe(true);
    } finally {
      control.gateEnabled = false;
      control.release?.();
      if (exportPromise) await exportPromise.catch(() => undefined);
    }
  }, 40_000);

  it('returns 409 when a referenced file drifts during the final version check', async () => {
    const sourceUserId = 'snapshot-route-drift';
    const source = await createSourceFixture(sourceUserId, new Uint8Array([9, 8, 7]));
    control.userId = sourceUserId;
    control.driftPath = storage.getTenantUploadPath(sourceUserId, source.storedFileName);
    control.driftEnabled = true;
    try {
      const response = await exportFull.GET();
      expect(response.status).toBe(409);
      expect(await readFile(control.driftPath, 'utf8')).toBe('changed-during-final-check');
    } finally {
      control.driftEnabled = false;
      control.driftPath = null;
    }
  }, 40_000);
});
