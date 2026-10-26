import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { selectFocusedBrowser, validFocusedSelection } from '../focused-browser-selection.mjs';

describe('risk-based browser scope, not full acceptance', () => {
  it('skips docs-only browser work but keeps a tiny independent core for source', () => {
    expect(selectFocusedBrowser(['README.md', 'docs/backlog/TICKETSTATUS.md']).core).toBe(false);
    expect(selectFocusedBrowser(['components/app-shell.tsx']).specs.map(item => item.file)).toEqual(['e2e/public-help-fragments.spec.ts']);
    expect(selectFocusedBrowser(['focused-e2e/core.spec.ts']).core).toBe(true);
  });
  it.each(['e2e/public-switching-checklist.spec.ts', 'e2e/backup-file-inspection.spec.ts', 'e2e/incoming-invoice-date-filter.spec.ts'])('selects approved exact own-feature scope %s', file => {
    const value = selectFocusedBrowser([file]); expect(validFocusedSelection(value)).toBe(true); expect(value.criticalMappingRequired).toBe(false);
    expect(value.specs.map(item => item.file)).toEqual([file]);
  });
  it('keeps reviewed date/backup feature packets on their own critical case rather than all unrelated workspaces', () => {
    expect(selectFocusedBrowser(['components/purchases/incoming-invoice-date-filter.tsx', 'lib/purchase-documents/service.ts', 'lib/record-search/list-contract.ts']).specs.map(item => item.file)).toEqual(['e2e/incoming-invoice-date-filter.spec.ts']);
    expect(selectFocusedBrowser(['lib/backup-file-preview.ts', 'app/settings/page.tsx']).specs.map(item => item.file)).toEqual(['e2e/backup-file-inspection.spec.ts']);
  });
  it('does not call unknown critical code UI-only verified or silently start every test', () => {
    const value = selectFocusedBrowser(['lib/new-financial-contract.ts']);
    expect(value.criticalMappingRequired).toBe(true); expect(value.unknownCriticalCount).toBe(1); expect(value.specs).toEqual([]);
    expect(selectFocusedBrowser(['lib/backup.ts']).criticalMappingRequired).toBe(true);
  });
  it('maps exact currently reviewed PR213/214/215 path inventories without unsupported PDF/browser suites', () => {
    expect(selectFocusedBrowser(['app/api/backup/full/preview/route.ts', 'app/settings/page.tsx', 'components/settings/backup-file-inspection.tsx', 'lib/backup-file-preview.ts', 'e2e/backup-file-inspection.spec.ts']).specs.map(item => item.file)).toEqual(['e2e/backup-file-inspection.spec.ts']);
    const switching = selectFocusedBrowser(['app/help/page.tsx', 'components/public-accounting/switching-checklist.tsx', 'components/public-accounting/switching-checklist.module.css', 'lib/switching-checklist.ts', 'e2e/public-switching-checklist.spec.ts']);
    expect(switching.criticalMappingRequired).toBe(false); expect(switching.specs.map(item => item.file)).toEqual(['e2e/public-switching-checklist.spec.ts']);
    expect(selectFocusedBrowser(['app/layout.tsx', 'components/app-shell.tsx', 'app/login/layout.tsx']).specs.map(item => item.file)).toEqual(['e2e/public-help-fragments.spec.ts']);
    expect(selectFocusedBrowser(['lib/payment-preflight.ts']).criticalMappingRequired).toBe(true);
  });
  it('rejects arbitrary selectors, shell-looking titles and malformed paths', () => {
    const value = selectFocusedBrowser(['components/app-shell.tsx']);
    expect(validFocusedSelection({ ...value, specs: [{ file: 'e2e/public-help-fragments.spec.ts', titles: ['.*'] }] })).toBe(false);
    expect(validFocusedSelection({ ...value, specs: [{ file: '../outside.spec.ts', titles: [] }] })).toBe(false);
    expect(() => selectFocusedBrowser(['../private'])).toThrow(); expect(() => selectFocusedBrowser(['a\nsecret'])).toThrow();
    expect(selectFocusedBrowser(['lib/backup.ts'], () => false).criticalMappingRequired).toBe(true);
  });
  it('makes full image acceptance manual and retains only scoped ordinary PR work', () => {
    const full = readFileSync('.github/workflows/browser-acceptance.yml', 'utf8');
    const triggers = full.slice(full.indexOf('\non:'), full.indexOf('\npermissions:'));
    expect(triggers).toBe('\non:\n  workflow_dispatch:\n');
    const focused = readFileSync('.github/workflows/focused-browser.yml', 'utf8');
    for (const value of ['pull_request:', 'npm run test:e2e -- --config=playwright.focused.config.ts', '--retries=0', '--trace=off', '--forbid-only']) expect(focused).toContain(value);
    for (const value of ['upload-artifact', 'lossless_evidence_png', 'verapdf', 'pdftoppm', 'einvoice-validation', 'xvfb-run']) expect(focused).not.toContain(value);
    const config = readFileSync('playwright.focused.config.ts', 'utf8');
    expect(config).toContain('dependencies: [\'focused-core\']');
    const core = readFileSync('focused-e2e/core.spec.ts', 'utf8');
    expect(core).not.toMatch(/screenshot|setViewportSize|maskImage|getImageData/);
    expect(core).toContain("expect((await page.request.get('/api/users')).status()).toBe(401)");
    const baseline = readFileSync('playwright.config.ts', 'utf8');
    expect(baseline).toContain("BIVARO_SETUP_TOKEN: 'e2e-bootstrap-token-for-isolated-fixtures-only'");
    expect(core).toContain(".fill('e2e-bootstrap-token-for-isolated-fixtures-only')");
    expect(core.indexOf('expect(process.env.DATABASE_URL)')).toBeLessThan(core.indexOf('request.post('));
    expect(core).toContain("expect(process.env.GITHUB_ACTIONS).toBe('true')");
    expect(core).toContain("expect(baseURL).toBe('http://127.0.0.1:3100')");
  });
});
