import { PrismaClient } from '@prisma/client';
import { accessSync, constants, openSync, closeSync, readSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createMoneyMigrationReport } from '../lib/money-migration-report.ts';

function usageError(message) {
  return new Error(`${message} Usage: npm run money:report -- --database-url file:/absolute/path/database.db`);
}

function parseDatabaseUrl(argv) {
  const values = argv.slice(2);
  const index = values.indexOf('--database-url');
  if (index === -1 || !values[index + 1] || values[index + 1].startsWith('--')) {
    throw usageError('Explicit --database-url is required; no environment or default database is used.');
  }
  if (values.some((value, valueIndex) => value.startsWith('--') && value !== '--database-url' && valueIndex !== index + 1)) {
    throw usageError('Unknown option.');
  }
  if (values.length !== 2 || index !== 0) {
    throw usageError('Pass exactly one --database-url option.');
  }
  const databaseUrl = values[index + 1];
  if (!databaseUrl.startsWith('file:/') || databaseUrl.includes('?') || databaseUrl.includes('#')) {
    throw usageError('Only a plain absolute SQLite file URL is accepted.');
  }
  const databasePath = databaseUrl.slice('file:'.length);
  let stat;
  try {
    stat = statSync(databasePath);
    accessSync(databasePath, constants.R_OK);
    const descriptor = openSync(databasePath, constants.O_RDONLY);
    closeSync(descriptor);
  } catch {
    throw usageError('The explicit database target must be an existing readable file.');
  }
  if (!stat.isFile()) throw usageError('The explicit database target must be a regular file.');
  return databaseUrl;
}

function fileFingerprint(databaseUrl) {
  const databasePath = databaseUrl.slice('file:'.length);
  const stat = statSync(databasePath);
  const descriptor = openSync(databasePath, constants.O_RDONLY);
  const hash = createHash('sha256');
  const chunk = Buffer.allocUnsafe(64 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = readSync(descriptor, chunk, 0, chunk.length, null);
      if (bytesRead > 0) hash.update(chunk.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    closeSync(descriptor);
  }
  return {
    sha256: hash.digest('hex'),
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  };
}

let databaseUrl;
try {
  databaseUrl = parseDatabaseUrl(process.argv);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
const before = fileFingerprint(databaseUrl);
const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let disconnected = false;
try {
  const report = await createMoneyMigrationReport(client);
  await client.$disconnect();
  disconnected = true;
  const after = fileFingerprint(databaseUrl);
  report.readOnlyVerification = {
    before,
    after,
    unchanged: before.sha256 === after.sha256 && before.mtimeMs === after.mtimeMs && before.size === after.size,
  };
  if (!report.readOnlyVerification.unchanged) {
    report.status = 'BLOCKED';
    report.migrationBlocked = true;
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.migrationBlocked) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`money migration report failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  if (!disconnected) await client.$disconnect();
}
