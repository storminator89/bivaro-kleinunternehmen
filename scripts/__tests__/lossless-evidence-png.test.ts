import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('bounded lossless synthetic screenshot evidence', () => {
  it('verifies all filters, RGB/RGBA pixels, color metadata and malformed-input rejection without new dependencies', () => {
    const result = spawnSync('python3', ['scripts/__tests__/lossless_evidence_png_cases.py', '-v'], {
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8', timeout: 30_000, stdio: 'pipe',
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('Ran 15 tests');
    expect(result.stderr).toContain('OK');
  });
  it('preserves the exact screenshot count and aggregate limit rather than hiding evidence', () => {
    const workflow = readFileSync('.github/workflows/browser-acceptance.yml', 'utf8');
    expect(workflow).toContain('limit = 5 * 1024 * 1024');
    expect(workflow).toContain('recompress_png(data)');
    expect(workflow).toContain('combined read size exceeds 5 MiB');
    expect(workflow).toContain("'payment-adjustment-confirmation-desktop-1440.png'");
  });
});
