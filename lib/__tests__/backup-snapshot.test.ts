import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createTestDatabase } from './helpers/database';
import { BackupFileSizeError, getBackupFileVersion, readBackupSnapshot, readStableBackupFile } from '@/lib/backup-snapshot';
import { createBackupManifest, validateBackupManifest } from '@/lib/backup-manifest';

const state = vi.hoisted(() => ({ client: null as ReturnType<typeof createTestDatabase>['client'] | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));

let database: ReturnType<typeof createTestDatabase>;
let directory: string;

beforeAll(async () => {
  database = createTestDatabase();
  state.client = database.client;
  directory = await mkdtemp(path.join(tmpdir(), 'bivaro-snapshot-'));
}, 40_000);

afterAll(async () => {
  await database?.cleanup();
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('consistent backup snapshots', () => {
  it('observes a payment and counter either before or after the atomic transaction', async () => {
    await database.client.user.create({ data: { id: 'snapshot-owner', email: 'snapshot@test', password: 'fixture' } });
    const invoice = await database.client.invoice.create({ data: {
      userId: 'snapshot-owner',
      fileName: 'payment.pdf',
      storedFileName: 'payment.pdf',
      invoiceNumber: '2026-10',
      parsedData: {},
      totalAmount: 25,
      status: 'DRAFT',
    } });
    await database.client.invoiceNumberCounter.create({ data: { userId: 'snapshot-owner', type: 'INVOICE', year: 2026, value: 10 } });

    const payment = database.client.$transaction(async (tx) => {
      await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'PAID', paidAt: new Date('2026-01-02T00:00:00.000Z') } });
      await tx.income.create({ data: { userId: 'snapshot-owner', description: 'Payment', amount: 25, date: new Date('2026-01-02T00:00:00.000Z'), invoiceId: invoice.id } });
      await tx.invoiceNumberCounter.update({ where: { userId_type_year: { userId: 'snapshot-owner', type: 'INVOICE', year: 2026 } }, data: { value: 11 } });
    });
    const [snapshot] = await Promise.all([readBackupSnapshot('snapshot-owner'), payment]);
    const invoices = snapshot.data.invoices as Array<{ id: number; status: string }>;
    const incomes = snapshot.data.incomes as Array<{ invoiceId: number | null }>;
    const counters = snapshot.data.invoiceNumberCounters as Array<{ value: number }>;
    const observedPaid = invoices.some((item) => item.id === invoice.id && item.status === 'PAID');
    const observedIncome = incomes.some((item) => item.invoiceId === invoice.id);
    expect(observedIncome).toBe(observedPaid);
    expect(counters[0]?.value).toBe(observedPaid ? 11 : 10);
    expect(snapshot.info.consistency).toBe('single-read-transaction');
    expect(Date.parse(snapshot.info.endedAt)).toBeGreaterThanOrEqual(Date.parse(snapshot.info.startedAt));
    expect(snapshot.info.id).toMatch(/^[a-f0-9]{64}$/u);
    const manifest = createBackupManifest({ sourceUserId: 'snapshot-owner', generatedAt: snapshot.info.endedAt, data: snapshot.data, snapshot: snapshot.info });
    expect(validateBackupManifest(manifest, snapshot.data).snapshot?.id).toBe(snapshot.info.id);
  });

  it('releases the database transaction before file packing and detects version drift', async () => {
    const filePath = path.join(directory, 'immutable.pdf');
    await writeFile(filePath, Buffer.from('before'));
    const stable = await readStableBackupFile(filePath);
    expect(stable?.bytes.toString()).toBe('before');
    expect(stable?.sourceVersion).toBe(await getBackupFileVersion(filePath));

    await writeFile(filePath, Buffer.from('after'));
    expect(await getBackupFileVersion(filePath)).not.toBe(stable?.sourceVersion);
    const current = await readStableBackupFile(filePath);
    expect(current?.bytes.toString()).toBe('after');
    expect(current?.sha256).not.toBe(stable?.sha256);

    await writeFile(filePath, Buffer.from('too-large'));
    await expect(readStableBackupFile(filePath, 3)).rejects.toBeInstanceOf(BackupFileSizeError);

    await database.client.invoice.updateMany({ where: { userId: 'snapshot-owner' }, data: { status: 'CANCELLED' } });
    expect(await database.client.invoice.count({ where: { userId: 'snapshot-owner', status: 'CANCELLED' } })).toBe(1);
  });
});
