import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as unknown, userId: 'cash-owner' }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({ getUserId: async () => state.userId }));

import { createCashTransaction, updateCashTransaction, deleteCashTransaction } from '@/lib/cashbook-service';
import { POST as createBook, PUT as updateBook } from '@/app/api/cashbook/route';
import { restoreBackupData } from '@/lib/backup-restore';
import { generateApiKey } from '@/lib/api-auth';
import { POST as webCashPost } from '@/app/api/cashbook/transactions/route';
import { POST as apiCashPost } from '@/app/api/v1/cashbook/route';

let database: ReturnType<typeof createTestDatabase>;
let apiKey: string;
beforeAll(async () => {
  database = createTestDatabase();
  state.client = database.client;
  await database.client.user.createMany({ data: ['cash-owner', 'other-owner'].map(id => ({ id, email: `${id}@cash.test`, password: 'unused' })) });
  const generated = generateApiKey();
  apiKey = generated.key;
  await database.client.apiKey.create({ data: { userId: state.userId, name: 'Cash fixture', keyHash: generated.keyHash, keyPrefix: generated.keyPrefix, scopes: '["write"]' } });
}, 40_000);
afterAll(async () => { await database?.cleanup(); });

const book = (initialBalance = 0) => database.client.cashBook.create({ data: { userId: state.userId, initialBalance } });
const entry = (cashBookId: number, type: 'EINNAHME' | 'AUSGABE', amount: number, date = '2026-05-02') =>
  createCashTransaction(state.userId, { cashBookId, type, amount, date, description: 'Synthetic cash entry' });
const rows = (cashBookId: number) => database.client.cashTransaction.findMany({
  where: { cashBookId }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
});
const json = (method: string, data: object) => new NextRequest('http://localhost/api/cashbook', { method, body: JSON.stringify(data), headers: { 'content-type': 'application/json' } });

describe('atomic nonnegative cash chronology', () => {
  it('rejects an expense at zero without a booking or audit side effect', async () => {
    const cashBook = await book();
    const auditsBefore = await database.client.auditLog.count();
    await expect(entry(cashBook.id, 'AUSGABE', 1)).rejects.toMatchObject({ status: 409 });
    expect(await rows(cashBook.id)).toEqual([]);
    expect(await database.client.auditLog.count()).toBe(auditsBefore);
  });

  it('rejects a backdated negative intermediate balance despite a positive final balance', async () => {
    const cashBook = await book();
    await entry(cashBook.id, 'EINNAHME', 100, '2026-05-03');
    const before = await rows(cashBook.id);
    await expect(entry(cashBook.id, 'AUSGABE', 20, '2026-05-01')).rejects.toMatchObject({ status: 409 });
    expect(await rows(cashBook.id)).toEqual(before);
  });

  it('commits at most one of two individually covered concurrent expenses', async () => {
    const cashBook = await book(10);
    const results = await Promise.allSettled([entry(cashBook.id, 'AUSGABE', 7), entry(cashBook.id, 'AUSGABE', 7)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const persisted = await rows(cashBook.id);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].runningBalance).toBe(3);
    expect(await database.client.auditLog.count({ where: { entityType: 'CashTransaction', entityId: String(persisted[0].id), action: 'CREATE' } })).toBe(1);
  });

  it('keeps same-day deposits and withdrawals cent-exact in stable order', async () => {
    const cashBook = await book();
    await entry(cashBook.id, 'EINNAHME', 0.1);
    await entry(cashBook.id, 'EINNAHME', 0.2);
    await entry(cashBook.id, 'AUSGABE', 0.3);
    expect((await rows(cashBook.id)).map(row => row.runningBalance)).toEqual([0.1, 0.3, 0]);
  });

  it('enforces the same overdraw boundary for simultaneous web and v1 requests', async () => {
    const cashBook = await book(10);
    const data = { cashBookId: cashBook.id, type: 'AUSGABE', amount: 7, date: '2026-05-02', description: 'API withdrawal' };
    const requests = [
      webCashPost(new NextRequest('http://localhost/api/cashbook/transactions', { method: 'POST', body: JSON.stringify(data), headers: { 'content-type': 'application/json' } })),
      apiCashPost(new NextRequest('http://localhost/api/v1/cashbook', { method: 'POST', body: JSON.stringify(data), headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` } })),
    ];
    expect((await Promise.all(requests)).map(response => response.status).sort()).toEqual([201, 409]);
    expect((await rows(cashBook.id)).map(row => row.runningBalance)).toEqual([3]);
  });

  it('rolls back deletion, amount reduction and date changes of a funding deposit', async () => {
    const cashBook = await book();
    const deposit = await entry(cashBook.id, 'EINNAHME', 10, '2026-05-01');
    await entry(cashBook.id, 'AUSGABE', 8, '2026-05-02');
    const before = await rows(cashBook.id);
    const auditsBefore = await database.client.auditLog.count();
    await expect(deleteCashTransaction(state.userId, deposit.id)).rejects.toMatchObject({ status: 409 });
    await expect(updateCashTransaction(state.userId, deposit.id, { amount: 7 })).rejects.toMatchObject({ status: 409 });
    await expect(updateCashTransaction(state.userId, deposit.id, { date: '2026-05-03' })).rejects.toMatchObject({ status: 409 });
    expect(await rows(cashBook.id)).toEqual(before);
    expect(await database.client.auditLog.count()).toBe(auditsBefore);
  });

  it('rejects negative opening balances and atomically rejects an insufficient opening-balance edit', async () => {
    for (const initialBalance of [-1, -0.001]) {
      expect((await createBook(json('POST', { name: 'Invalid', initialBalance }))).status).toBe(409);
    }
    const cashBook = await book(10);
    await entry(cashBook.id, 'AUSGABE', 8);
    const before = await rows(cashBook.id);
    expect((await updateBook(json('PUT', { id: cashBook.id, initialBalance: 7 }))).status).toBe(409);
    expect((await database.client.cashBook.findUniqueOrThrow({ where: { id: cashBook.id } })).initialBalance).toBe(10);
    expect(await rows(cashBook.id)).toEqual(before);
  });

  it('checks actual historic amounts instead of trusting an incorrect stored balance', async () => {
    const cashBook = await book();
    await database.client.cashTransaction.create({ data: {
      cashBookId: cashBook.id, userId: state.userId, type: 'AUSGABE', amount: 5,
      description: 'Invalid legacy history', date: new Date('2026-05-01'), runningBalance: 100,
    } });
    const before = await rows(cashBook.id);
    await expect(entry(cashBook.id, 'EINNAHME', 10)).rejects.toMatchObject({ status: 409 });
    expect(await rows(cashBook.id)).toEqual(before);
  });

  it('rolls back cash and recalculated balances when the financial audit fails', async () => {
    const cashBook = await book(10);
    const existing = await entry(cashBook.id, 'AUSGABE', 2, '2026-05-03');
    const before = await rows(cashBook.id);
    await database.client.$executeRawUnsafe(`CREATE TRIGGER cash_audit_failure BEFORE INSERT ON AuditLog WHEN NEW.entityType = 'CashTransaction' BEGIN SELECT RAISE(ABORT, 'synthetic cash audit failure'); END;`);
    try {
      await expect(entry(cashBook.id, 'EINNAHME', 5, '2026-05-01')).rejects.toThrow();
      await expect(updateCashTransaction(state.userId, existing.id, { amount: 1 })).rejects.toThrow();
      await expect(deleteCashTransaction(state.userId, existing.id)).rejects.toThrow();
    } finally {
      await database.client.$executeRawUnsafe('DROP TRIGGER cash_audit_failure');
    }
    expect(await rows(cashBook.id)).toEqual(before);
  });

  it('rejects a negative cash backup and preserves the target on overwrite', async () => {
    const cashBook = await database.client.cashBook.create({ data: { userId: 'other-owner', initialBalance: 25 } });
    await expect(restoreBackupData({ userId: 'other-owner', overwrite: true, backup: { version: '2.0', data: {
      cashBooks: [{ id: 1, name: 'Bad cash', initialBalance: 0 }],
      cashTransactions: [{ id: 2, cashBookId: 1, type: 'AUSGABE', description: 'Impossible expense', amount: 1, date: '2026-01-01' }],
    } } })).rejects.toMatchObject({ name: 'BackupValidationError', status: 400, message: expect.stringContaining('negativen Kassenbestand') });
    expect(await database.client.cashBook.findUniqueOrThrow({ where: { id: cashBook.id } })).toEqual(cashBook);
    expect(await database.client.cashTransaction.count({ where: { userId: 'other-owner' } })).toBe(0);
  });

  it('does not mutate a different tenant or accept an unsafe cent balance', async () => {
    const cashBook = await book(10);
    await expect(createCashTransaction('other-owner', { cashBookId: cashBook.id, type: 'AUSGABE', amount: 1, description: 'Foreign' })).rejects.toMatchObject({ status: 404 });
    const oversized = await book(1e14);
    await expect(entry(oversized.id, 'EINNAHME', 1)).rejects.toMatchObject({ status: 409 });
    expect(await rows(oversized.id)).toEqual([]);
  });
});
