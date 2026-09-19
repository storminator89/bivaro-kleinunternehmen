import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  createTempDirectory,
  databaseUrlForPath,
  resolveDatabaseTarget,
  verifyDatabaseTarget,
} from './database-runtime.mjs';

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = process.env.APP_ROOT || scriptRoot;
const schema = path.resolve(process.env.PRISMA_SCHEMA || path.join(appRoot, 'prisma', 'schema.prisma'));
const prismaCli = path.resolve(
  process.env.PRISMA_CLI || path.join(appRoot, 'node_modules', 'prisma', 'build', 'index.js'),
);

function copySqliteArtifacts(source, destination) {
  fs.copyFileSync(source, destination);
  for (const suffix of ['-wal', '-shm']) {
    const sourceSidecar = `${source}${suffix}`;
    if (fs.existsSync(sourceSidecar)) {
      fs.copyFileSync(sourceSidecar, `${destination}${suffix}`);
    }
  }
}

async function snapshotSqlite(sourcePath, destinationPath) {
  const { PrismaClient } = await import('@prisma/client');
  const client = new PrismaClient({
    datasourceUrl: databaseUrlForPath(sourcePath),
    errorFormat: 'minimal',
  });
  try {
    const quotedDestination = destinationPath.replaceAll("'", "''");
    // VACUUM INTO is SQLite's consistent online snapshot operation. It also
    // includes a live WAL state, unlike copying the main file byte-for-byte.
    await client.$executeRawUnsafe(`VACUUM INTO '${quotedDestination}'`);
  } finally {
    await client.$disconnect();
  }
  fs.chmodSync(destinationPath, 0o600);
}

function backupName(databasePath) {
  const stamp = new Date().toISOString().replaceAll(/[-:.TZ]/g, '');
  const entropy = `${process.pid}-${Math.random().toString(16).slice(2, 10)}`;
  return `${path.basename(databasePath)}.${stamp}-${entropy}.pre-upgrade`;
}

function createEmptyTarget(targetPath) {
  const descriptor = fs.openSync(targetPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR, 0o600);
  fs.closeSync(descriptor);
}

function runPrisma(command, databaseUrl) {
  if (!fs.existsSync(prismaCli)) {
    throw new Error(`Prisma CLI not found at ${prismaCli}.`);
  }

  const result = spawnSync(
    process.execPath,
    [prismaCli, ...command, `--schema=${schema}`],
    {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    },
  );
  if (result.error) {
    throw new Error(`Prisma ${command.join(' ')} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Prisma ${command.join(' ')} failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

function runSchemaDiff(databaseUrl) {
  const result = spawnSync(
    process.execPath,
    [
      prismaCli,
      'migrate',
      'diff',
      `--from-url=${databaseUrl}`,
      `--to-schema-datamodel=${schema}`,
      '--exit-code',
    ],
    {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    },
  );
  if (result.error) {
    throw new Error(`Prisma migrate diff could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`physical schema compatibility check failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

async function probeSqlite(filePath) {
  const { PrismaClient } = await import('@prisma/client');
  const client = new PrismaClient({
    datasourceUrl: databaseUrlForPath(filePath),
    errorFormat: 'minimal',
  });
  try {
    const result = await client.$queryRawUnsafe('PRAGMA integrity_check');
    const check = result?.[0]?.integrity_check;
    if (check !== 'ok') {
      throw new Error(`SQLite integrity check returned ${String(check)}.`);
    }
    await client.$queryRawUnsafe('SELECT 1');
  } finally {
    await client.$disconnect();
  }
}

async function main() {
  const configuredUrl = process.env.DATABASE_URL;
  const target = resolveDatabaseTarget({ databaseUrl: configuredUrl, schema });
  const checkedTarget = verifyDatabaseTarget(target, { mode: 'upgrade' });
  const backupDirectory = path.resolve(
    process.env.DATABASE_BACKUP_DIR || path.join(target.parent, 'backups'),
  );

  console.log(`[database-upgrade] verified target=${target.path}`);
  console.log(`[database-upgrade] ${checkedTarget.owner}`);

  let backupPath;
  let canaryDirectory;
  try {
    if (checkedTarget.exists) {
      fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
      try {
        fs.chmodSync(backupDirectory, 0o700);
      } catch {
        // The subsequent access check reports the actionable UID/GID details.
      }
      fs.accessSync(backupDirectory, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);

      backupPath = path.join(backupDirectory, backupName(target.path));
      await snapshotSqlite(target.path, backupPath);
      await probeSqlite(backupPath);
      console.log(`[database-upgrade] backup and restore probe passed: ${backupPath}`);

      canaryDirectory = createTempDirectory('bivaro-upgrade-canary-');
      const canaryPath = path.join(canaryDirectory, path.basename(target.path));
      copySqliteArtifacts(backupPath, canaryPath);
      await probeSqlite(canaryPath);
      console.log('[database-upgrade] applying migrations to populated canary copy');
      runPrisma(['migrate', 'deploy'], databaseUrlForPath(canaryPath));
      runPrisma(['migrate', 'status'], databaseUrlForPath(canaryPath));
      runSchemaDiff(databaseUrlForPath(canaryPath));
      await probeSqlite(canaryPath);
      console.log('[database-upgrade] populated canary passed migration and integrity checks');
    } else {
      console.log('[database-upgrade] target is absent; initializing it with versioned migrations');
      createEmptyTarget(target.path);
    }

    console.log('[database-upgrade] applying versioned migrations to configured target');
    runPrisma(['migrate', 'deploy'], configuredUrl);
    runPrisma(['migrate', 'status'], configuredUrl);
    runSchemaDiff(configuredUrl);

    const finalTarget = verifyDatabaseTarget(target, { mode: 'startup' });
    await probeSqlite(finalTarget.path);
    console.log(`[database-upgrade] complete; target is ready: ${finalTarget.path}`);
  } catch (error) {
    const backupHint = backupPath ? ` Backup retained at ${backupPath}.` : '';
    throw new Error(`${error instanceof Error ? error.message : String(error)}${backupHint}`);
  } finally {
    if (canaryDirectory) {
      fs.rmSync(canaryDirectory, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(`ERROR: database upgrade aborted. ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
