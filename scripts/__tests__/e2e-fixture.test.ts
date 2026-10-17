import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { e2eDatabasePath } from '../e2e-fixture.mjs';

const directories: string[] = [];
const temporaryRoot = realpathSync(tmpdir());
function fixture() {
  const directory = mkdtempSync(path.join(temporaryRoot, 'bivaro-e2e-'));
  directories.push(directory);
  return directory;
}
afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('E2E database fixture boundary', () => {
  it('uses the runner fixture regardless of an inherited database URL', () => {
    const directory = fixture();
    vi.stubEnv('BIVARO_E2E_TEST_DIR', directory);
    vi.stubEnv('DATABASE_URL', 'file:/inherited/database.db');
    expect(e2eDatabasePath()).toBe(path.join(directory, 'test.db'));
  });

  it('rejects missing, repository, relative and non-fixture targets', () => {
    for (const directory of ['', process.cwd(), 'prisma', temporaryRoot, path.join(temporaryRoot, 'other-fixture')]) {
      expect(() => e2eDatabasePath(directory)).toThrow('fresh temporary database');
    }
  });

  it('rejects nested paths even when the parent is a valid fixture', () => {
    const nested = path.join(fixture(), 'bivaro-e2e-nested');
    mkdirSync(nested);
    expect(() => e2eDatabasePath(nested)).toThrow('fresh temporary database');
  });

  it('rejects symlinks to another directory', () => {
    const directory = fixture();
    const link = directory + '-link';
    directories.push(link);
    symlinkSync(directory, link, 'dir');
    expect(() => e2eDatabasePath(link)).toThrow('fresh temporary database');
  });
});
