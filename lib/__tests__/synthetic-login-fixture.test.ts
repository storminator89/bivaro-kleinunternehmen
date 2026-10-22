import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { deleteMany } = vi.hoisted(() => ({ deleteMany: vi.fn().mockResolvedValue({ count: 1 }) }));
vi.mock('../prisma', () => ({ prisma: { rateLimitBucket: { deleteMany } } }));
import { isolateSyntheticLoginIpBudget } from '../../e2e/helpers/synthetic-login';

describe('synthetic login fixture isolation', () => {
  let directory: string;
  beforeEach(() => {
    deleteMany.mockClear();
    directory = mkdtempSync(path.join(realpathSync(tmpdir()), 'bivaro-e2e-'));
    vi.stubEnv('BIVARO_E2E_TEST_DIR', directory);
    vi.stubEnv('DATABASE_URL', `file:${path.join(directory, 'test.db')}`);
  });
  afterEach(() => { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });

  it('clears only the exact fallback login-IP runtime bucket in the fresh fixture', async () => {
    await isolateSyntheticLoginIpBudget();
    expect(deleteMany).toHaveBeenCalledExactlyOnceWith({ where: {
      key: createHash('sha256').update('login:ip:untrusted-proxy').digest('hex'),
    } });
  });
  it('rejects a database outside the exact runner fixture before any mutation', async () => {
    vi.stubEnv('DATABASE_URL', 'file:prisma/dev.db');
    await expect(isolateSyntheticLoginIpBudget()).rejects.toThrow('exact fresh E2E database');
    expect(deleteMany).not.toHaveBeenCalled();
  });
  it('rejects a missing runner marker before any mutation', async () => {
    vi.stubEnv('BIVARO_E2E_TEST_DIR', '');
    await expect(isolateSyntheticLoginIpBudget()).rejects.toThrow('fresh temporary database');
    expect(deleteMany).not.toHaveBeenCalled();
  });
  it('rejects a non-runner directory before any mutation', async () => {
    vi.stubEnv('BIVARO_E2E_TEST_DIR', realpathSync(tmpdir()));
    await expect(isolateSyntheticLoginIpBudget()).rejects.toThrow('fresh temporary database');
    expect(deleteMany).not.toHaveBeenCalled();
  });
  it('propagates fixture-write failure instead of bypassing login isolation', async () => {
    deleteMany.mockRejectedValueOnce(new Error('fixture unavailable'));
    await expect(isolateSyntheticLoginIpBudget()).rejects.toThrow('fixture unavailable');
  });
});
