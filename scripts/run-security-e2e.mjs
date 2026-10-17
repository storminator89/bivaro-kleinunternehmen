import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runE2eProcess } from './e2e-process.mjs';

const fixtureDirectory = await mkdtemp(path.join(tmpdir(), 'bivaro-security-e2e-'));
const databasePath = path.join(fixtureDirectory, 'test.db');
await runE2eProcess({
  args: ['test', '--config=playwright.security.config.ts'],
  env: { ...process.env, DATABASE_URL: `file:${databasePath}`, BIVARO_SECURITY_TEST_DIR: fixtureDirectory },
  prepare: () => writeFile(databasePath, ''),
  cleanup: () => rm(fixtureDirectory, { recursive: true, force: true }),
});
