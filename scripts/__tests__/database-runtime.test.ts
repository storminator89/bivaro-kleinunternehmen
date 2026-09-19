import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  resolveDatabaseTarget,
  verifyDatabaseTarget,
} from '../database-runtime.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const schemaPath = path.join(repositoryRoot, 'prisma', 'schema.prisma');
const prismaCli = path.join(repositoryRoot, 'node_modules', 'prisma', 'build', 'index.js');
const entrypoint = path.join(repositoryRoot, 'docker-entrypoint.sh');
const upgradeScript = path.join(repositoryRoot, 'scripts', 'upgrade-database.mjs');
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createFixtureDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bivaro-runtime-fixture-'));
  temporaryDirectories.push(directory);
  fs.mkdirSync(path.join(directory, 'data'));
  return directory;
}

function databaseUrl(directory: string) {
  return `file:${path.join(directory, 'data', 'prod.db')}`;
}

function runPrisma(args: string[], url: string, options: { input?: string } = {}) {
  return execFileSync(process.execPath, [prismaCli, ...args], {
    cwd: repositoryRoot,
    env: { ...process.env, DATABASE_URL: url },
    input: options.input,
    encoding: 'utf8',
    stdio: options.input === undefined ? 'pipe' : ['pipe', 'pipe', 'pipe'],
    timeout: 120_000,
  });
}

function createMigratedFixture() {
  const directory = createFixtureDirectory();
  const url = databaseUrl(directory);
  const databasePath = path.join(directory, 'data', 'prod.db');
  fs.closeSync(fs.openSync(databasePath, 'wx', 0o600));
  runPrisma(['migrate', 'deploy', `--schema=${schemaPath}`], url);
  return { directory, url, databasePath };
}

function createReleaseSchema(directory: string, migrationSql: string) {
  const releasePrismaDirectory = path.join(directory, 'release', 'prisma');
  fs.mkdirSync(releasePrismaDirectory, { recursive: true });
  fs.copyFileSync(schemaPath, path.join(releasePrismaDirectory, 'schema.prisma'));
  fs.cpSync(path.join(repositoryRoot, 'prisma', 'migrations'), path.join(releasePrismaDirectory, 'migrations'), {
    recursive: true,
  });
  fs.copyFileSync(
    path.join(repositoryRoot, 'prisma', 'migrations', 'migration_lock.toml'),
    path.join(releasePrismaDirectory, 'migration_lock.toml'),
  );
  const releaseSchemaPath = path.join(releasePrismaDirectory, 'schema.prisma');
  const schema = fs.readFileSync(releaseSchemaPath, 'utf8').replace(
    'sessionVersion Int    @default(0)',
    'sessionVersion Int    @default(0)\n  syntheticUpgradeMarker String?',
  );
  fs.writeFileSync(releaseSchemaPath, schema);
  const migrationDirectory = path.join(releasePrismaDirectory, 'migrations', '20260919000000_synthetic_upgrade');
  fs.mkdirSync(migrationDirectory);
  fs.writeFileSync(path.join(migrationDirectory, 'migration.sql'), migrationSql);
  return releaseSchemaPath;
}

function seedFixture(url: string) {
  const userId = '00000000-0000-4000-8000-000000000001';
  const sql = `
    INSERT INTO User (id, email, password, role, sessionVersion, createdAt)
    VALUES ('${userId}', 'synthetic@example.invalid', 'synthetic-hash', 'USER', 0, '2026-01-01T00:00:00.000Z');
    INSERT INTO Customer (name, createdAt, userId)
    VALUES ('Synthetic customer', '2026-01-01T00:00:00.000Z', '${userId}');
    INSERT INTO Invoice (fileName, storedFileName, uploadedAt, parsedData, totalAmount, status, invoiceNumber, userId, customerId)
    VALUES ('synthetic.pdf', 'synthetic.pdf', '2026-01-01T00:00:00.000Z', '{}', 123.45, 'DRAFT', 'SYN-1', '${userId}', 1);
  `;
  runPrisma(['db', 'execute', '--stdin', `--url=${url}`], url, { input: sql });
}

function summary(url: string) {
  const script = `
    const { PrismaClient } = await import('@prisma/client');
    const p = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    const result = {
      users: await p.user.count(),
      customers: await p.customer.count(),
      invoices: await p.invoice.count(),
      amount: (await p.invoice.aggregate({ _sum: { totalAmount: true } }))._sum.totalAmount,
      foreignKeys: await p.$queryRawUnsafe('PRAGMA foreign_key_check'),
    };
    console.log(JSON.stringify(result));
    await p.$disconnect();
  `;
  return JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: repositoryRoot,
      env: { ...process.env, DATABASE_URL: url },
      encoding: 'utf8',
      timeout: 30_000,
    }),
  );
}

function userColumns(url: string) {
  const script = `
    const { PrismaClient } = await import('@prisma/client');
    const p = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    console.log(JSON.stringify((await p.$queryRawUnsafe('PRAGMA table_info("User")')).map((column) => column.name)));
    await p.$disconnect();
  `;
  return JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: repositoryRoot,
      env: { ...process.env, DATABASE_URL: url },
      encoding: 'utf8',
      timeout: 30_000,
    }),
  );
}

function runUpgrade(url: string, schema: string, backupDirectory: string) {
  return spawnSync(process.execPath, [upgradeScript], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      APP_ROOT: repositoryRoot,
      DATABASE_URL: url,
      PRISMA_SCHEMA: schema,
      DATABASE_BACKUP_DIR: backupDirectory,
    },
    encoding: 'utf8',
    timeout: 120_000,
  });
}

function runStartupSentinel(fixture: { directory: string; url: string }) {
  const runtimeDirectory = path.join(fixture.directory, 'runtime');
  fs.mkdirSync(path.join(runtimeDirectory, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(repositoryRoot, 'scripts', 'database-runtime.mjs'), path.join(runtimeDirectory, 'scripts', 'database-runtime.mjs'));
  fs.writeFileSync(path.join(runtimeDirectory, 'server.js'), "console.log('startup-sentinel');\n");
  return spawnSync('sh', [entrypoint], {
    cwd: runtimeDirectory,
    env: {
      ...process.env,
      APP_ROOT: runtimeDirectory,
      DATABASE_URL: fixture.url,
      PRISMA_SCHEMA: schemaPath,
      PRISMA_CLI: prismaCli,
    },
    encoding: 'utf8',
    timeout: 30_000,
  });
}

describe('database runtime safety boundary', () => {
  it('accepts only absolute persistent SQLite URLs and does not echo credentials', () => {
    const fixture = createFixtureDirectory();
    const absolute = databaseUrl(fixture);
    expect(resolveDatabaseTarget({ databaseUrl: absolute, schema: schemaPath }).path).toBe(
      path.join(fixture, 'data', 'prod.db'),
    );
    expect(() => resolveDatabaseTarget({ databaseUrl: 'file:./dev.db', schema: schemaPath })).toThrow(
      /absolute file:\/\.\.\./,
    );
    expect(() => resolveDatabaseTarget({ databaseUrl: `${absolute}?mode=ro`, schema: schemaPath })).toThrow(
      /query parameters/,
    );
    expect(() => resolveDatabaseTarget({ databaseUrl: `${absolute}%20`, schema: schemaPath })).toThrow(
      /percent-encoded/,
    );
    expect(() => resolveDatabaseTarget({ databaseUrl: `file://localhost${absolute.slice('file:'.length)}`, schema: schemaPath })).toThrow(
      /authorities/,
    );
    expect(() => resolveDatabaseTarget({ databaseUrl: 'postgresql://user:secret@example.invalid/db', schema: schemaPath })).toThrow(
      /unsupported provider "postgresql"/,
    );
    try {
      resolveDatabaseTarget({ databaseUrl: 'postgresql://user:secret@example.invalid/db', schema: schemaPath });
    } catch (error) {
      expect(String(error)).not.toContain('secret');
    }
  });

  it('reports UID/GID guidance without suggesting volume deletion for permission failures', () => {
    const fixture = createFixtureDirectory();
    const databasePath = path.join(fixture, 'data', 'prod.db');
    fs.closeSync(fs.openSync(databasePath, 'wx', 0o600));
    fs.chmodSync(path.join(fixture, 'data'), 0o500);
    try {
      const target = resolveDatabaseTarget({ databaseUrl: databaseUrl(fixture), schema: schemaPath });
      expect(() => verifyDatabaseTarget(target, { mode: 'startup' })).toThrow(/UID=.*GID=.*do not delete the volume/);
    } finally {
      fs.chmodSync(path.join(fixture, 'data'), 0o700);
    }
  });

  it('blocks a physical schema drift before server startup and leaves the database unchanged', () => {
    const fixture = createMigratedFixture();
    runPrisma(['db', 'execute', '--stdin', `--url=${fixture.url}`], fixture.url, {
      input: 'ALTER TABLE User ADD COLUMN synthetic_drift_marker TEXT;',
    });
    const before = crypto.createHash('sha256').update(fs.readFileSync(fixture.databasePath)).digest('hex');
    const result = spawnSync('sh', [entrypoint], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        APP_ROOT: repositoryRoot,
        DATABASE_URL: fixture.url,
        PRISMA_SCHEMA: schemaPath,
        PRISMA_CLI: prismaCli,
      },
      encoding: 'utf8',
      timeout: 30_000,
    });
    const after = crypto.createHash('sha256').update(fs.readFileSync(fixture.databasePath)).digest('hex');
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/physical database schema differs/i);
    expect(after).toBe(before);
  }, 30_000);

  it('runs the explicit upgrade against a populated canary with a pending additive migration', () => {
    const fixture = createMigratedFixture();
    seedFixture(fixture.url);
    const before = summary(fixture.url);
    const backupDirectory = path.join(fixture.directory, 'data', 'backups');
    const releaseSchema = createReleaseSchema(
      fixture.directory,
      'ALTER TABLE "User" ADD COLUMN "syntheticUpgradeMarker" TEXT;',
    );
    const result = runUpgrade(fixture.url, releaseSchema, backupDirectory);
    const after = summary(fixture.url);
    expect(result.status).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/populated canary passed/i);
    expect(fs.readdirSync(backupDirectory)).toHaveLength(1);
    expect(after).toEqual(before);
    expect(userColumns(fixture.url)).toContain('syntheticUpgradeMarker');
  }, 30_000);

  it('fails a bad canary migration before touching the configured database', () => {
    const fixture = createMigratedFixture();
    seedFixture(fixture.url);
    const releaseSchema = createReleaseSchema(
      fixture.directory,
      'ALTER TABLE "TableThatDoesNotExist" ADD COLUMN "syntheticUpgradeMarker" TEXT;',
    );
    const backupDirectory = path.join(fixture.directory, 'data', 'backups');
    const before = crypto.createHash('sha256').update(fs.readFileSync(fixture.databasePath)).digest('hex');
    const result = runUpgrade(fixture.url, releaseSchema, backupDirectory);
    const after = crypto.createHash('sha256').update(fs.readFileSync(fixture.databasePath)).digest('hex');
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/upgrade aborted|Backup retained/i);
    expect(after).toBe(before);
    expect(fs.readdirSync(backupDirectory)).toHaveLength(1);
  }, 30_000);

  it('initializes a missing database only in upgrade and then passes startup checks', () => {
    const directory = createFixtureDirectory();
    const fixture = { directory, url: databaseUrl(directory) };
    const result = runUpgrade(fixture.url, schemaPath, path.join(directory, 'data', 'backups'));
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(directory, 'data', 'prod.db'))).toBe(true);
    const startup = runStartupSentinel(fixture);
    expect(startup.status).toBe(0);
    expect(`${startup.stdout}\n${startup.stderr}`).toContain('startup-sentinel');
  }, 30_000);

  it('keeps startup free of destructive repair commands', () => {
    const source = fs.readFileSync(entrypoint, 'utf8');
    expect(source).not.toMatch(/db push|accept-data-loss|migrate deploy|rm\s+-f|ln\s+-sf|down\s+-v/);
    expect(source).toContain('migrate diff');
    expect(source).toContain('migrate status');
  });
});
