import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase } from './helpers/database';

let database: ReturnType<typeof createTestDatabase>;

beforeAll(async () => {
  database = createTestDatabase();
  await database.client.user.create({
    data: { id: 'income-review-user', email: 'income-review@test.invalid', password: 'unused' },
  });
}, 40_000);

afterAll(async () => {
  await database?.cleanup();
});

const migrationSql = readFileSync(
  'prisma/migrations/20260920150000_income_date_review/migration.sql',
  'utf8',
);

describe('legacy income date review migration', () => {
  it('records an unchanged review hint and remains idempotent', async () => {
    const manual = await database.client.income.create({
      data: {
        userId: 'income-review-user',
        description: 'Legacy manual income',
        amount: 42,
        date: new Date('2025-12-31T14:23:00.000Z'),
      },
    });
    const midnight = await database.client.income.create({
      data: {
        userId: 'income-review-user',
        description: 'Legacy midnight income',
        amount: 12,
        date: new Date('2025-12-31T00:00:00.000Z'),
      },
    });
    const cashBook = await database.client.cashBook.create({ data: { userId: 'income-review-user' } });
    const linked = await database.client.income.create({
      data: {
        userId: 'income-review-user',
        description: 'Cashbook income',
        amount: 7,
        date: new Date('2025-12-31T14:23:00.000Z'),
      },
    });
    await database.client.cashTransaction.create({
      data: {
        userId: 'income-review-user',
        cashBookId: cashBook.id,
        incomeId: linked.id,
        date: linked.date,
        type: 'EINNAHME',
        description: linked.description,
        amount: linked.amount,
        runningBalance: linked.amount,
      },
    });

    await database.client.$executeRawUnsafe(migrationSql);
    await database.client.$executeRawUnsafe(migrationSql);

    const reviewEntries = await database.client.auditLog.findMany({
      where: { action: 'REVIEW', entityType: 'Income' },
      orderBy: { entityId: 'asc' },
    });
    expect(reviewEntries).toHaveLength(3);
    expect(reviewEntries.map(entry => entry.entityId)).toEqual([String(manual.id), String(midnight.id), String(linked.id)]);

    const manualReview = reviewEntries.find(entry => entry.entityId === String(manual.id));
    expect(manualReview?.entityName).toBe('Prüfhinweis: Legacy manual income');
    expect(manualReview?.metadata).toContain('income.legacy-date-review');
    const manualMetadata = JSON.parse(manualReview?.metadata ?? '{}');
    expect(manualMetadata.originalDate).toBe('2025-12-31T14:23:00.000Z');
    expect(manualMetadata.originalDateRaw).toBe(new Date('2025-12-31T14:23:00.000Z').getTime());
    expect(manualReview?.metadata).toContain('"guessedDate":null');
    expect((await database.client.income.findUniqueOrThrow({ where: { id: manual.id } })).date.toISOString()).toBe('2025-12-31T14:23:00.000Z');
    expect(reviewEntries.some(entry => entry.entityId === String(linked.id))).toBe(true);
  });

  it('emits hints while upgrading a pre-upgrade database and deploys twice safely', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'bivaro-income-review-upgrade-'));
    const prismaDirectory = path.join(directory, 'prisma');
    const newMigration = '20260920150000_income_date_review';
    const sourcePrisma = path.resolve('prisma');
    try {
      mkdirSync(prismaDirectory, { recursive: true });
      cpSync(path.join(sourcePrisma, 'schema.prisma'), path.join(prismaDirectory, 'schema.prisma'));
      cpSync(path.join(sourcePrisma, 'migrations'), path.join(prismaDirectory, 'migrations'), {
        recursive: true,
        filter: source => !source.includes(path.join('migrations', newMigration)),
      });
      const databaseUrl = `file:${path.join(directory, 'pre-upgrade.db')}`;
      writeFileSync(databaseUrl.slice('file:'.length), '');
      const prismaCli = path.resolve('node_modules/prisma/build/index.js');
      const deploy = () => execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', path.join(prismaDirectory, 'schema.prisma')], {
        cwd: directory,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: 'pipe',
        timeout: 60_000,
      });
      deploy();
      // eslint-disable-next-line no-restricted-syntax -- upgrade fixture must use its explicit temporary database.
      const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      const user = await client.user.create({
        data: { id: 'pre-upgrade-income-user', email: 'pre-upgrade-income@test.invalid', password: 'unused' },
      });
      const income = await client.income.create({
        data: { userId: user.id, description: 'Pre-upgrade income', amount: 21, date: new Date('2024-08-19T16:45:00.000Z') },
      });
      await client.$disconnect();

      cpSync(path.join(sourcePrisma, 'migrations', newMigration), path.join(prismaDirectory, 'migrations', newMigration), { recursive: true });
      deploy();
      deploy();

      // eslint-disable-next-line no-restricted-syntax -- upgrade fixture must use its explicit temporary database.
      const upgraded = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      const hints = await upgraded.auditLog.findMany({ where: { action: 'REVIEW', entityType: 'Income' } });
      expect(hints).toHaveLength(1);
      expect(hints[0].entityId).toBe(String(income.id));
      const metadata = JSON.parse(hints[0].metadata ?? '{}');
      expect(metadata.originalDate).toBe('2024-08-19T16:45:00.000Z');
      expect(metadata.originalDateRaw).toBe(new Date('2024-08-19T16:45:00.000Z').getTime());
      expect((await upgraded.income.findUniqueOrThrow({ where: { id: income.id } })).date.toISOString()).toBe('2024-08-19T16:45:00.000Z');
      await upgraded.$disconnect();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
