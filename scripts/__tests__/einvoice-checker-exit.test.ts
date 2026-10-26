import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('official E-Invoice checker entrypoint', () => {
  it('propagates success, fixture failure and setup failure without running validators', () => {
    const repositoryRoot = path.resolve(import.meta.dirname, '../..');
    const cases = path.join(import.meta.dirname, 'einvoice_checker_exit_cases.py');
    const result = spawnSync('python3', ['-I', '-B', cases, '-v'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    });

    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stderr).toContain('Ran 4 tests');
  });
});
