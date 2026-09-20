import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from './helpers/database';
import { createBackupPreview } from '@/lib/backup-preview';

const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));

import { BackupValidationError, restoreBackupData, validateBackupForRestore } from '@/lib/backup-restore';

let database: ReturnType<typeof createTestDatabase>;

beforeAll(async () => {
  database = createTestDatabase();
  state.client = database.client;
  await database.client.user.create({ data: { id: 'bv031-owner', email: 'bv031@example.test', password: 'fixture' } });
}, 40_000);

afterAll(async () => { await database?.cleanup(); });

function backup(data: Record<string, unknown>) {
  return { version: '2.0', data };
}

function paidMismatchBackup() {
  return backup({
    invoices: [{ id: 1, fileName: 'invoice.pdf', storedFileName: 'invoice.pdf', status: 'PAID', totalAmount: 100, parsedData: {} }],
    incomes: [{ id: 2, description: 'Payment', amount: 90, invoiceId: 1, date: '2026-01-02T00:00:00.000Z' }],
  });
}

describe('BV031 restore domain invariants', () => {
  it('uses the same paid invoice amount check in preview and commit', async () => {
    const candidate = paidMismatchBackup();
    expect(() => createBackupPreview(candidate)).toThrow(BackupValidationError);
    expect(() => validateBackupForRestore(candidate)).toThrowError(/bezahlt/u);
    await expect(restoreBackupData({ userId: 'bv031-owner', overwrite: true, backup: candidate })).rejects.toMatchObject({
      name: 'BackupValidationError',
      issues: [{ path: 'incomes[0].amount' }],
    });
    expect(await database.client.invoice.count({ where: { userId: 'bv031-owner' } })).toBe(0);
    expect(await database.client.income.count({ where: { userId: 'bv031-owner' } })).toBe(0);
  });

  it('rejects invalid recurring intervals before any import', async () => {
    const candidate = backup({
      recurringExpenses: [{ id: 1, description: 'Monthly', amount: 10, interval: 'WEEKLY', dayOfMonth: 1, startDate: '2026-01-01T00:00:00.000Z', nextExecution: '2026-02-01T00:00:00.000Z' }],
    });
    await expect(restoreBackupData({ userId: 'bv031-owner', overwrite: true, backup: candidate })).rejects.toMatchObject({
      issues: [{ path: 'recurringExpenses[0].interval' }],
    });
    expect(await database.client.recurringExpense.count({ where: { userId: 'bv031-owner' } })).toBe(0);
  });

  it('rejects a negative chronological cash balance before overwrite', async () => {
    const existing = await database.client.cashBook.create({ data: { userId: 'bv031-owner', name: 'Existing', initialBalance: 25 } });
    const candidate = backup({
      cashBooks: [{ id: 1, name: 'Imported', initialBalance: 0 }],
      cashTransactions: [{ id: 1, cashBookId: 1, type: 'AUSGABE', description: 'Overdraw', amount: 1, date: '2026-01-01T00:00:00.000Z' }],
    });
    await expect(restoreBackupData({ userId: 'bv031-owner', overwrite: true, backup: candidate })).rejects.toMatchObject({
      issues: [{ path: 'cashTransactions[0].runningBalance' }],
    });
    expect(await database.client.cashBook.findUnique({ where: { id: existing.id } })).toEqual(existing);
    expect(await database.client.cashTransaction.count({ where: { userId: 'bv031-owner' } })).toBe(0);
  });

  it.each([
    ['negative fractional opening balance', { id: 1, name: 'Invalid', initialBalance: -0.001 }, null, 'cashBooks[0].initialBalance'],
    ['missing business date', { id: 1, name: 'Invalid', initialBalance: 0 }, { id: 1, cashBookId: 1, type: 'EINNAHME', description: 'Undated', amount: 1 }, 'cashTransactions[0].date'],
  ])('rejects %s before import', async (_label, cashBook, transaction, path) => {
    const candidate = backup({ cashBooks: [cashBook], ...(transaction ? { cashTransactions: [transaction] } : {}) });
    await expect(restoreBackupData({ userId: 'bv031-owner', overwrite: true, backup: candidate })).rejects.toMatchObject({ issues: [{ path }] });
  });

  it('keeps source id chronology stable when same-date cash rows arrive unsorted', async () => {
    const candidate = backup({
      cashBooks: [{ id: 1, name: 'Ordered', initialBalance: 10 }],
      cashTransactions: [
        { id: 2, cashBookId: 1, type: 'AUSGABE', description: 'Withdrawal', amount: 7, date: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T01:00:00.000Z' },
        { id: 1, cashBookId: 1, type: 'EINNAHME', description: 'Deposit', amount: 5, date: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T01:00:00.000Z' },
      ],
    });
    await expect(restoreBackupData({ userId: 'bv031-owner', overwrite: true, backup: candidate })).resolves.toMatchObject({ cashTransactions: { imported: 2 } });
    const rows = await database.client.cashTransaction.findMany({ where: { userId: 'bv031-owner' }, orderBy: { id: 'asc' } });
    expect(rows.map((row) => [row.type, row.runningBalance])).toEqual([['EINNAHME', 15], ['AUSGABE', 8]]);
  });

  it('returns at most 25 safe object path issues without values or secrets', () => {
    const candidate = backup({
      recurringExpenses: Array.from({ length: 30 }, (_, index) => ({
        id: index + 1,
        description: `Schedule ${index}`,
        amount: 10,
        interval: 'WEEKLY',
        dayOfMonth: 1,
        startDate: '2026-01-01T00:00:00.000Z',
        nextExecution: '2026-02-01T00:00:00.000Z',
        secretToken: 'must-not-appear',
      })),
    });
    try {
      validateBackupForRestore(candidate);
      throw new Error('expected validation error');
    } catch (error) {
      expect(error).toBeInstanceOf(BackupValidationError);
      const validation = error as BackupValidationError;
      expect(validation.issues).toHaveLength(25);
      expect(validation.truncated).toBe(true);
      expect(JSON.stringify(validation.issues)).not.toContain('must-not-appear');
      expect(validation.issues.every((issue) => /^recurringExpenses\[\d+\]\.interval$/u.test(issue.path))).toBe(true);
    }
  });
});
