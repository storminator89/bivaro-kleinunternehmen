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
    expect(workflow).toContain('limit = 8 * 1024 * 1024');
    expect(workflow).toContain('per_file_input_limit = 5 * 1024 * 1024');
    expect(workflow).toContain('total > 16 * 1024 * 1024');
    expect(workflow).toContain('handle.read(per_file_input_limit + 1)');
    expect(workflow).toContain('recompress_png(data)');
    expect(workflow).toContain('combined read size exceeds 8 MiB');
    expect(workflow).toContain("'payment-adjustment-confirmation-desktop-1440.png'");
    const allowlist = workflow.match(/allowed = \{([\s\S]*?)\n\s*\}/u)?.[1] ?? '';
    const screenshots = [...allowlist.matchAll(/'([^']+\.png)'/gu)].map(match => match[1]);
    expect(screenshots).toHaveLength(59); // All 55 accepted images plus four populated overview views.
    expect(new Set(screenshots).size).toBe(59);
    for (const theme of ['light', 'dark']) for (const width of [1440, 390]) expect(screenshots).toContain(`dashboard-overview-${theme}-${width}.png`);
    for (const name of ['bank-allocation-confirmation-1440.png', 'bank-allocation-move-390.png', 'bank-allocation-current-origin-360.png']) expect(screenshots).toContain(name);
  });
});
