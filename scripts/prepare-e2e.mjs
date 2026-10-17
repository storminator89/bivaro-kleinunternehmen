import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { e2eDatabasePath } from './e2e-fixture.mjs';

// Never reset an existing database or inherit the repository's .env target.
const databasePath = e2eDatabasePath();
writeFileSync(databasePath, '', { flag: 'wx' });
execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
  env: { ...process.env, DATABASE_URL: `file:${databasePath}` }, stdio: 'inherit',
});
