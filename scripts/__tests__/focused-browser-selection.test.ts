import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
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
  it.each([
    ['app/register/page.tsx', 'e2e/registration-status-retry.spec.ts', 'lib/__tests__/registration-status-read.test.ts'],
    ['components/dashboard/create-invoice-modal.tsx', 'e2e/invoice-number-check-freshness.spec.ts', 'lib/__tests__/invoice-number-check-freshness.test.ts'],
    ['app/users/page.tsx', 'e2e/users-list-read-retry.spec.ts', 'lib/__tests__/users-read-state.test.ts'],
  ])('keeps the existing read-only journey attached to %s, including source-only follow-ups', (source, spec, unit) => {
    for (const inventory of [[source], [spec], [source, spec, unit]]) {
      const selection = selectFocusedBrowser(inventory);
      expect(validFocusedSelection(selection)).toBe(true);
      expect(selection.core).toBe(true);
      expect(selection.criticalMappingRequired).toBe(false);
      expect(selection.specs).toEqual([{ file: spec, titles: [] }]);
    }
    const missing = selectFocusedBrowser([source], () => false);
    expect(missing.criticalMappingRequired).toBe(true);
    expect(missing.unknownCriticalCount).toBe(1);
    expect(missing.specs).toEqual([]);
  });
  it('unions only the three changed read journeys without a broad suite fallback', () => {
    const selection = selectFocusedBrowser(['app/register/page.tsx', 'components/dashboard/create-invoice-modal.tsx', 'app/users/page.tsx']);
    expect(selection.criticalMappingRequired).toBe(false);
    expect(selection.specs.map(item => item.file)).toEqual([
      'e2e/invoice-number-check-freshness.spec.ts', 'e2e/registration-status-retry.spec.ts', 'e2e/users-list-read-retry.spec.ts',
    ]);
    expect(selectFocusedBrowser(['lib/new-financial-contract.ts']).criticalMappingRequired).toBe(true);
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
  it('scopes project roots so generated standalone and dependency copies are never discovered', () => {
    const source = readFileSync('playwright.focused.config.ts', 'utf8');
    const selection = selectFocusedBrowser(['components/app-shell.tsx']);
    const exports: { default?: { testDir: string; projects: { testDir: string; testMatch: string }[] } } = {};
    const context = vm.createContext({ exports, Buffer, process: { env: { BIVARO_FOCUSED_SELECTION: JSON.stringify(selection) } }, require(name: string) {
      if (name === '@playwright/test') return { defineConfig: (value: unknown) => value, devices: { 'Desktop Chrome': {} } };
      if (name === './playwright.config') return { use: {}, webServer: { command: 'never executed in a pure config check' } };
      if (name === './scripts/focused-browser-selection.mjs') return { validFocusedSelection };
      throw Error('Unexpected pure config dependency');
    } });
    vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, context);
    const config = exports.default!;
    expect(config.testDir).toBe('./focused-e2e');
    expect(config.projects.map(project => [project.testDir, project.testMatch])).toEqual([
      ['./focused-e2e', 'core.spec.ts'], ['./e2e', 'public-help-fragments.spec.ts'],
    ]);
    const inventory = ['focused-e2e/core.spec.ts', '.next/standalone/focused-e2e/core.spec.ts', 'node_modules/copy/focused-e2e/core.spec.ts', 'e2e/public-help-fragments.spec.ts', '.next/standalone/e2e/public-help-fragments.spec.ts'];
    const collected = inventory.filter(file => config.projects.some(project => {
      const relative = path.relative(path.resolve(project.testDir), path.resolve(file));
      return !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(relative) === project.testMatch;
    }));
    expect(collected).toEqual(['focused-e2e/core.spec.ts', 'e2e/public-help-fragments.spec.ts']);
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
