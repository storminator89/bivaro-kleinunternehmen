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
    expect(workflow).toContain('limit = 10 * 1024 * 1024');
    expect(workflow).toContain('per_file_input_limit = 5 * 1024 * 1024');
    expect(workflow).toContain('total > 16 * 1024 * 1024');
    expect(workflow).toContain('handle.read(per_file_input_limit + 1)');
    expect(workflow).toContain('recompress_png(data)');
    expect(workflow).toContain('combined read size exceeds 10 MiB');
    expect(workflow).toContain("'payment-adjustment-confirmation-desktop-1440.png'");
    const allowlist = workflow.match(/allowed = \{([\s\S]*?)\n\s*\}/u)?.[1] ?? '';
    const screenshots = [...allowlist.matchAll(/'([^']+\.png)'/gu)].map(match => match[1]);
    expect(screenshots).toHaveLength(87); // 59 baseline + 20 customer/import + eight settings views.
    expect(new Set(screenshots).size).toBe(87);
    for (const name of ['settings-redesign-light-1440.png', 'settings-redesign-light-375.png', 'settings-redesign-dark-1440.png', 'settings-redesign-dark-375.png', 'settings-redesign-backup-light-1440.png', 'settings-redesign-backup-dark-375.png', 'settings-redesign-company-saving-light-1440.png', 'settings-redesign-company-error-dark-375.png']) expect(screenshots).toContain(name);
    for (const theme of ['light', 'dark']) for (const width of [1440, 390]) expect(screenshots).toContain(`dashboard-overview-${theme}-${width}.png`);
    expect(screenshots).toContain('customer-redesign-directory-light-1440.png');
    expect(screenshots).toContain('csv-redesign-customer-preview-light-1440.png');
    expect(screenshots).toContain('csv-redesign-article-preview-light-1440.png');
    expect(screenshots).toContain('customer-redesign-directory-light-375.png');
    expect(screenshots).toContain('csv-redesign-customer-preview-light-375.png');
    expect(screenshots).toContain('csv-redesign-article-preview-light-375.png');
    expect(screenshots).toContain('customer-redesign-directory-dark-1440.png');
    expect(screenshots).toContain('csv-redesign-customer-preview-dark-1440.png');
    expect(screenshots).toContain('csv-redesign-article-preview-dark-1440.png');
    expect(screenshots).toContain('customer-redesign-directory-dark-375.png');
    expect(screenshots).toContain('csv-redesign-customer-preview-dark-375.png');
    expect(screenshots).toContain('csv-redesign-article-preview-dark-375.png');
    expect(screenshots).toContain('customer-redesign-edit-light-1440.png');
    expect(screenshots).toContain('customer-redesign-edit-bottom-light-1440.png');
    expect(screenshots).toContain('customer-redesign-edit-top-light-375.png');
    expect(screenshots).toContain('customer-redesign-edit-bottom-light-375.png');
    expect(screenshots).toContain('csv-redesign-article-setup-light-1440.png');
    expect(screenshots).toContain('csv-redesign-customer-mapping-light-375.png');
    expect(screenshots).toContain('csv-redesign-article-mapping-dark-1440.png');
    expect(screenshots).toContain('csv-redesign-result-dark-375.png');
    for (const name of ['bank-allocation-confirmation-1440.png', 'bank-allocation-move-390.png', 'bank-allocation-current-origin-360.png']) expect(screenshots).toContain(name);
  });
});
