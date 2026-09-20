import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Prisma, PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PRISMA_MONEY_COLUMNS,
  PRISMA_MONEY_FLOAT_EXCLUSIONS,
  createMoneyMigrationReport,
} from '../money-migration-report';

const fixtures: string[] = [];

afterEach(() => {
  for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function createFixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'bivaro-money-report-'));
  fixtures.push(directory);
  const databasePath = path.join(directory, 'report.db');
  const sqlite = new DatabaseSync(databasePath);
  sqlite.exec(`
    CREATE TABLE Expense (id INTEGER PRIMARY KEY, amount REAL);
    CREATE TABLE Income (id INTEGER PRIMARY KEY, amount REAL);
    CREATE TABLE Invoice (id INTEGER PRIMARY KEY, totalAmount REAL);
    CREATE TABLE RecurringExpense (id INTEGER PRIMARY KEY, amount REAL);
    CREATE TABLE Reminder (id INTEGER PRIMARY KEY, fee REAL);
    CREATE TABLE CashBook (id INTEGER PRIMARY KEY, initialBalance REAL);
    CREATE TABLE CashTransaction (id INTEGER PRIMARY KEY, amount REAL, runningBalance REAL);
    INSERT INTO Expense VALUES (1, 1.005);
    INSERT INTO Income VALUES (1, 0.10);
    INSERT INTO Invoice VALUES (1, NULL);
    INSERT INTO RecurringExpense VALUES (1, 2.005);
    INSERT INTO Reminder VALUES (1, -0.005);
    INSERT INTO CashBook VALUES (1, 100.00);
    INSERT INTO CashTransaction VALUES (1, 0.20, 100.20);
  `);
  sqlite.close();
  return { databasePath, url: `file:${databasePath}` };
}

describe('money migration report', () => {
  it('keeps the money inventory aligned with the generated Prisma DMMF', () => {
    const floatFields = Prisma.dmmf.datamodel.models.flatMap(model => model.fields
      .filter(field => field.type === 'Float')
      .map(field => `${model.name}.${field.name}`));
    const moneyFields = PRISMA_MONEY_COLUMNS.map(column => `${column.model}.${column.field}`);
    const excludedFields = PRISMA_MONEY_FLOAT_EXCLUSIONS.map(column => `${column.model}.${column.field}`);
    expect(floatFields.sort()).toEqual([...moneyFields, ...excludedFields].sort());
  });

  it('covers every Prisma money Float and reads a temporary fixture transactionally', async () => {
    const fixture = createFixture();
    // eslint-disable-next-line no-restricted-syntax -- isolated temporary fixture needs its own target.
    const client = new PrismaClient({ datasources: { db: { url: fixture.url } } });
    const before = statSync(fixture.databasePath).mtimeMs;
    const report = await createMoneyMigrationReport(client);
    const queryOnlyState = await client.$queryRawUnsafe<Array<{ query_only: number }>>('PRAGMA query_only');
    await client.$disconnect();

    expect(PRISMA_MONEY_COLUMNS.map(column => `${column.model}.${column.field}`)).toEqual([
      'Expense.amount',
      'Income.amount',
      'Invoice.totalAmount',
      'RecurringExpense.amount',
      'Reminder.fee',
      'CashBook.initialBalance',
      'CashTransaction.amount',
      'CashTransaction.runningBalance',
    ]);
    expect(report.policy.mode).toBe('read-only');
    expect(report.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: 'Expense', field: 'amount', sourceValue: '1.005', normalizedCents: '101', differenceCents: '0.5', error: null }),
      expect.objectContaining({ model: 'Invoice', field: 'totalAmount', sourceValue: null, normalizedCents: null, differenceCents: null, error: null }),
    ]));
    expect(report.totals.rows).toBe(8);
    expect(report.totals.nullValues).toBe(1);
    expect(Number(queryOnlyState[0]?.query_only)).toBe(0);
    expect(statSync(fixture.databasePath).mtimeMs).toBe(before);
  });

  it('runs the CLI only with an explicit existing target and emits JSON', () => {
    const fixture = createFixture();
    const script = path.resolve(process.cwd(), 'scripts/money-migration-report.mjs');
    const envSentinel = path.join(path.dirname(fixture.databasePath), 'env-sentinel.db');
    const output = execFileSync(process.execPath, ['--experimental-strip-types', script, '--database-url', fixture.url], {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: `file:${envSentinel}` },
    });
    const cliReport = JSON.parse(output);
    expect(cliReport.policy.mode).toBe('read-only');
    expect(cliReport.readOnlyVerification.unchanged).toBe(true);
    expect(existsSync(envSentinel)).toBe(false);
    const probeOptions = { encoding: 'utf8' as const, stdio: 'pipe' as const, env: { ...process.env, DATABASE_URL: `file:${envSentinel}` } };
    expect(() => execFileSync(process.execPath, ['--experimental-strip-types', script], probeOptions)).toThrow();
    const missing = path.join(fixture.databasePath, '..', 'must-not-be-created.db');
    expect(() => execFileSync(process.execPath, ['--experimental-strip-types', script, '--database-url', `file:${missing}`], probeOptions)).toThrow();
    expect(existsSync(missing)).toBe(false);
    expect(existsSync(envSentinel)).toBe(false);
  });

  it('blocks accidental writes and restores the connection state after failure', async () => {
    const fixture = createFixture();
    // eslint-disable-next-line no-restricted-syntax -- isolated temporary fixture needs its own target.
    const client = new PrismaClient({ datasources: { db: { url: fixture.url } } });
    const read = vi.spyOn(PRISMA_MONEY_COLUMNS[0], 'read').mockImplementation(async transaction => {
      await transaction.$executeRawUnsafe('INSERT INTO Expense VALUES (2, 999)');
      return [];
    });
    try {
      await expect(createMoneyMigrationReport(client)).rejects.toThrow(/readonly|read-only/i);
      expect(await client.expense.count()).toBe(1);
      const state = await client.$queryRawUnsafe<Array<{ query_only: number }>>('PRAGMA query_only');
      expect(Number(state[0].query_only)).toBe(0);
    } finally {
      read.mockRestore();
      await client.$disconnect();
    }
  });

  it('does not weaken an already read-only connection when Prisma cannot start its transaction', async () => {
    const fixture = createFixture();
    // eslint-disable-next-line no-restricted-syntax -- isolated temporary fixture needs its own target.
    const client = new PrismaClient({ datasources: { db: { url: fixture.url } } });
    try {
      await client.$executeRawUnsafe('PRAGMA query_only = ON');
      await expect(createMoneyMigrationReport(client)).rejects.toThrow(/readonly|read-only/i);
      const state = await client.$queryRawUnsafe<Array<{ query_only: number }>>('PRAGMA query_only');
      expect(Number(state[0].query_only)).toBe(1);
    } finally {
      await client.$disconnect();
    }
  });

  it('stops before materialising more than the configured report bound', async () => {
    const fixture = createFixture();
    // eslint-disable-next-line no-restricted-syntax -- isolated temporary fixture needs its own target.
    const client = new PrismaClient({ datasources: { db: { url: fixture.url } } });
    await expect(createMoneyMigrationReport(client, { maxRows: 1 })).rejects.toThrow(/Zeilenlimit/);
    await client.$disconnect();
  });
});
