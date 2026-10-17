import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runE2eProcess } from './e2e-process.mjs';

const fixtureDirectory = await mkdtemp(path.join(await realpath(tmpdir()), 'bivaro-e2e-'));
await runE2eProcess({
  args: ['test', ...process.argv.slice(2)],
  env: { ...process.env, DATABASE_URL: `file:${path.join(fixtureDirectory, 'test.db')}`, BIVARO_E2E_TEST_DIR: fixtureDirectory },
  cleanup: () => rm(fixtureDirectory, { recursive: true, force: true }),
});
