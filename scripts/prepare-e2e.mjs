import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Fixed isolated target: never use the caller's DATABASE_URL for destructive setup.
const databasePath = path.resolve('prisma/e2e.db');
for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(databasePath + suffix, { force: true });
// Explicit creation avoids opaque SQLite schema-engine errors on a missing file.
writeFileSync(databasePath, '');
execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
  env: { ...process.env, DATABASE_URL: `file:${databasePath}` }, stdio: 'inherit',
});
