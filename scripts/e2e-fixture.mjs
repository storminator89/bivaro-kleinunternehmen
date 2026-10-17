import { lstatSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Both Playwright and migration setup must resolve the runner's exact fixture.
export function e2eDatabasePath(directory = process.env.BIVARO_E2E_TEST_DIR) {
  const invalidFixture = () => new Error('Run npm run test:e2e to create a fresh temporary database fixture.');
  if (!directory || path.dirname(directory) !== realpathSync(tmpdir()) || !path.basename(directory).startsWith('bivaro-e2e-')) {
    throw invalidFixture();
  }
  try {
    if (!lstatSync(directory).isDirectory() || realpathSync(directory) !== directory) throw invalidFixture();
  } catch {
    throw invalidFixture();
  }
  return path.join(directory, 'test.db');
}
