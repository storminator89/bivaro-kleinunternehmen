import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { FOCUSED_SPECS, selectFocusedBrowser, validFocusedSelection } from '../focused-browser-selection.mjs';
type FocusedSpec = keyof typeof FOCUSED_SPECS;

describe('risk-based browser scope, not full acceptance', () => {
  it('binds only the ten reviewed CORS cleanup routes to required ordinary-CI contracts and core smoke', () => {
    const routes = ['cashbook', 'customers', 'documentation', 'expenses', 'incomes',
      'invoices', 'invoices/upload', 'recurring-expenses', 'reminders', 'settings']
      .map(route => `app/api/v1/${route}/route.ts`);
    for (const inventory of [...routes.map(route => [route]), routes]) {
      const selection = selectFocusedBrowser(inventory);
      expect(validFocusedSelection(selection)).toBe(true);
      expect(selection.core).toBe(true);
      expect(selection.criticalMappingRequired).toBe(false);
      expect(selection.specs).toEqual([]);
      for (const missing of ['lib/__tests__/api-boundaries.test.ts', 'lib/__tests__/helpers/database.ts',
        'vitest.config.mts', '.github/workflows/ci.yml']) {
        const blocked = selectFocusedBrowser(inventory, file => file !== missing);
        expect(blocked.criticalMappingRequired).toBe(true);
        expect(blocked.unknownCriticalCount).toBe(inventory.length);
      }
    }
    for (const source of ['app/api/v1/new-resource/route.ts', 'app/api/v1/invoices/export/route.ts', 'lib/api-auth.ts']) {
      expect(selectFocusedBrowser([source]).criticalMappingRequired).toBe(true);
    }
  });
  it('maps only the reviewed owner-version sources to all four bounded cases and retains shared manual-entry coverage', () => {
    const spec = 'e2e/quote-release-owner-surface.spec.ts';
    const sources = ['app/api/quotes/[id]/releases/route.ts', 'app/dashboard/page.tsx',
      'components/dashboard/dashboard-content.tsx', 'components/dashboard/tabs/quotes-tab.tsx',
      'components/dashboard/quote-release-versions-dialog.tsx', 'lib/quote-release-owner-access.ts',
      'lib/quote-release-owner-capture.ts', 'lib/quote-release-owner-client.ts',
      'lib/quote-release-owner-contract.ts', 'lib/quote-release-owner-state.ts', 'e2e/helpers/quote-release-owner-fixture.ts'];
    const titles = [
      'owner versions stay hidden and unwritable when the gate is absent',
      'owned quote opens the internal version view without public access',
      'unobserved committed capture stays blocked after close reopen and reload',
      'owner version 401 removes private draft and history immediately',
    ];
    expect(FOCUSED_SPECS[spec]).toEqual(titles);
    for (const source of [...sources, spec]) {
      const selection = selectFocusedBrowser([source]);
      const expected = [spec, ...(source === 'components/dashboard/dashboard-content.tsx' ? ['e2e/manual-entry-submission.spec.ts'] : [])].sort();
      expect(validFocusedSelection(selection)).toBe(true); expect(selection.criticalMappingRequired).toBe(false);
      expect(selection.specs).toEqual(expected.map(file => ({ file, titles: FOCUSED_SPECS[file as FocusedSpec] })));
    }
    for (const missing of [spec, 'e2e/helpers/quote-release-owner-fixture.ts',
      'lib/__tests__/quote-release-owner-capture.test.ts', 'lib/__tests__/quote-release-owner-state.test.ts',
      'lib/__tests__/quote-release-owner-route.test.ts', 'lib/__tests__/quote-release-owner-client.test.ts']) {
      for (const inventory of [sources, [spec]]) {
        expect(selectFocusedBrowser(inventory, file => file !== missing).criticalMappingRequired).toBe(true);
      }
    }
    for (const unreviewed of ['app/api/quotes/[id]/tokens/route.ts', 'lib/quote-release-public-capability.ts']) {
      expect(selectFocusedBrowser([unreviewed]).criticalMappingRequired).toBe(true);
    }
  });
  it('binds the owner registry to four real serial test declarations, not a wildcard or all-suite fallback', () => {
    const source = readFileSync('e2e/quote-release-owner-surface.spec.ts', 'utf8');
    const ast = ts.createSourceFile('owner.spec.ts', source, ts.ScriptTarget.Latest, true);
    const titles: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'test'
        && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) titles.push(node.arguments[0].text);
      ts.forEachChild(node, visit);
    }
    visit(ast);
    expect(titles).toEqual(FOCUSED_SPECS['e2e/quote-release-owner-surface.spec.ts']);
    expect(source).toContain("test.describe.configure({ mode: 'serial', retries: 0 })");
    expect(source).not.toMatch(/test\.(?:skip|fixme)|screenshot|setViewportSize/);
  });
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
  it.each([
    { spec: 'e2e/audit-log-requests.spec.ts', sources: ['app/settings/audit-logs/page.tsx', 'lib/audit-log-query.ts'] },
    { spec: 'e2e/manual-entry-submission.spec.ts', sources: ['components/dashboard/dashboard-content.tsx', 'components/dashboard/manual-entry-submit-feedback.tsx',
      'components/dashboard/modals/edit-modal.tsx', 'components/dashboard/tabs/expenses-tab.tsx', 'components/dashboard/tabs/incomes-tab.tsx',
      'hooks/use-manual-entry-submission.ts', 'lib/manual-entry-submission.ts'] },
    { spec: 'e2e/dashboard-owner-boundary.spec.ts', sources: ['components/dashboard/dashboard-query-provider.tsx', 'lib/dashboard-query-lifecycle.ts'] },
    { spec: 'e2e/service-article-picker-freshness.spec.ts', sources: ['components/dashboard/service-article-picker-state.ts', 'components/dashboard/service-article-picker.tsx'] },
  ])('maps only the existing own scope for $spec and fails closed if it is absent', ({ spec, sources }) => {
    for (const paths of [...sources.map(source => [source]), [spec], [...sources, spec]]) {
      const selection = selectFocusedBrowser(paths);
      expect(validFocusedSelection(selection)).toBe(true);
      expect(selection.core).toBe(true);
      expect(selection.criticalMappingRequired).toBe(false);
      const expected = [spec, ...(paths.includes('components/dashboard/dashboard-content.tsx') ? ['e2e/quote-release-owner-surface.spec.ts'] : [])].sort();
      expect(selection.specs).toEqual(expected.map(file => ({ file, titles: FOCUSED_SPECS[file as FocusedSpec] })));
    }
    const missing = selectFocusedBrowser(sources, () => false);
    expect(missing.criticalMappingRequired).toBe(true);
    expect(missing.specs).toEqual([]);
  });
  it('retains financial-submit/owner cases and the required owner-version journey for their shared dashboard source', () => {
    const selection = selectFocusedBrowser([
      'components/dashboard/dashboard-query-provider.tsx', 'docs/testing/dashboard-owner-boundary.md', 'e2e/dashboard-owner-boundary.spec.ts',
      'lib/__tests__/dashboard-owner-boundary.test.ts', 'lib/dashboard-query-lifecycle.ts', 'components/dashboard/dashboard-content.tsx',
      'components/dashboard/manual-entry-submit-feedback.tsx', 'components/dashboard/modals/edit-modal.tsx', 'components/dashboard/tabs/expenses-tab.tsx',
      'components/dashboard/tabs/incomes-tab.tsx', 'docs/testing/manual-entry-submit-guard.md', 'e2e/manual-entry-submission.spec.ts',
      'hooks/use-manual-entry-submission.ts', 'lib/__tests__/cashflow-workspace-design.test.ts', 'lib/__tests__/manual-entry-submission.test.ts',
      'lib/manual-entry-submission.ts', 'scripts/focused-browser-selection.mjs', 'scripts/__tests__/focused-browser-selection.test.ts',
    ]);
    expect(validFocusedSelection(selection)).toBe(true);
    expect(selection.criticalMappingRequired).toBe(false);
    expect(selection.specs.map(item => item.file)).toEqual(['e2e/dashboard-owner-boundary.spec.ts', 'e2e/manual-entry-submission.spec.ts', 'e2e/quote-release-owner-surface.spec.ts']);
    expect(selectFocusedBrowser(['lib/new-owner-write-boundary.ts']).criticalMappingRequired).toBe(true);
  });
  it('selects only actual combobox and backup inspection journeys for the seven-slice packet', () => {
    const selection = selectFocusedBrowser([
      '.github/workflows/ci.yml', 'app/api/backup/full/route.ts', 'app/api/backup/route.ts', 'app/api/dashboard/filter-options/route.ts',
      'components/ui/__tests__/combobox-options.test.ts', 'components/ui/__tests__/dialog-combobox-escape.test.ts',
      'components/ui/combobox-options.ts', 'components/ui/combobox.tsx', 'components/ui/dialog.tsx',
      'e2e/auth-dashboard-invoice.spec.ts', 'e2e/combobox-accessibility.spec.ts',
      'lib/__tests__/backup-snapshot-route.test.ts', 'lib/__tests__/bank-allocation-backup.test.ts',
      'lib/__tests__/dashboard-filter-options.test.ts', 'lib/__tests__/processing-limits.test.ts',
      'lib/backup-snapshot.ts', 'lib/bank-allocation-backup.ts', 'lib/processing-limit.ts',
      'scripts/__tests__/einvoice-checker-exit.test.ts', 'scripts/__tests__/einvoice_checker_exit_cases.py', 'scripts/einvoice-validation/check-official.py',
    ]);
    expect(validFocusedSelection(selection)).toBe(true);
    expect(selection.core).toBe(true);
    expect(selection.criticalMappingRequired).toBe(false);
    expect(selection.specs.map(item => item.file)).toEqual(['e2e/backup-file-inspection.spec.ts', 'e2e/combobox-accessibility.spec.ts']);
  });
  it('retains the documentation checkbox unit contract and adds only the real loading journey for its page', () => {
    const sources = ['app/settings/documentation/page.tsx', 'lib/documentation-print-markdown.ts'];
    const unit = 'lib/__tests__/documentation-print-markdown.test.ts';
    for (const paths of [...sources.map(source => [source]), [...sources, unit]]) {
      const selection = selectFocusedBrowser(paths);
      expect(validFocusedSelection(selection)).toBe(true);
      expect(selection).toEqual({ schema: 'bivaro-focused-browser-selection-v1', core: true,
        specs: paths.includes('app/settings/documentation/page.tsx') ? [{ file: 'e2e/documentation-loading.spec.ts', titles: FOCUSED_SPECS['e2e/documentation-loading.spec.ts'] }] : [],
        criticalMappingRequired: false, unknownCriticalCount: 0, unmappedSourceCount: 0 });
    }
    const missing = selectFocusedBrowser(sources, () => false);
    expect(missing.criticalMappingRequired).toBe(true);
    expect(missing.unknownCriticalCount).toBe(2);
    expect(missing.specs).toEqual([]);
    expect(selectFocusedBrowser(['app/api/documentation/route.ts']).criticalMappingRequired).toBe(true);
    expect(selectFocusedBrowser(['lib/documentation-unknown-contract.ts']).criticalMappingRequired).toBe(true);
  });
  it('keeps JSON export limits and database grouping explicitly unit-backed, not falsely browser-covered', () => {
    const selection = selectFocusedBrowser(['app/api/backup/route.ts', 'app/api/dashboard/filter-options/route.ts', 'scripts/einvoice-validation/check-official.py']);
    expect(selection.core).toBe(true);
    expect(selection.criticalMappingRequired).toBe(false);
    expect(selection.specs).toEqual([]);
    expect(selectFocusedBrowser(['app/api/backup/route.ts'], () => false).criticalMappingRequired).toBe(true);
  });
  it('requires the backend unit contracts as well as the actual dependent backup inspection journey', () => {
    expect(selectFocusedBrowser(['lib/processing-limit.ts']).specs.map(item => item.file)).toEqual(['e2e/backup-file-inspection.spec.ts']);
    expect(selectFocusedBrowser(['lib/backup-snapshot.ts'], () => false).criticalMappingRequired).toBe(true);
    expect(selectFocusedBrowser(['lib/new-backup-financial-contract.ts']).criticalMappingRequired).toBe(true);
  });
  it('does not call unknown critical code UI-only verified or silently start every test', () => {
    const value = selectFocusedBrowser(['lib/new-financial-contract.ts']);
    expect(value.criticalMappingRequired).toBe(true); expect(value.unknownCriticalCount).toBe(1); expect(value.specs).toEqual([]);
    expect(selectFocusedBrowser(['lib/backup.ts']).criticalMappingRequired).toBe(true);
  });
  it('maps only the exact payment-preflight reader to real repeated receipts and mandatory financial contracts', () => {
    const source = 'lib/full-payment-form.ts', spec = 'e2e/partial-payments.spec.ts';
    const title = 'treats a later deliberate equal amount/date/reference as a distinct allocation';
    const contracts = ['lib/__tests__/full-payment-form.test.ts', 'lib/__tests__/payment-adjustment-form.test.ts',
      'lib/__tests__/payment-allocation-core.test.ts', 'lib/__tests__/helpers/database.ts', 'scripts/e2e-fixture.mjs', 'focused-e2e/core.spec.ts'];
    const inventories = [[source], [source, contracts[0]],
      [source, contracts[0], 'scripts/focused-browser-selection.mjs', 'scripts/__tests__/focused-browser-selection.test.ts']];
    for (const paths of inventories) {
      const selection = selectFocusedBrowser(paths);
      expect(validFocusedSelection(selection)).toBe(true);
      expect(selection).toEqual({ schema: 'bivaro-focused-browser-selection-v1', core: true,
        specs: [{ file: spec, titles: [title] }], criticalMappingRequired: false, unknownCriticalCount: 0, unmappedSourceCount: 0 });
    }
    for (const absent of [spec, ...contracts]) {
      const missing = selectFocusedBrowser([source], file => file !== absent);
      expect(missing.core).toBe(true);
      expect(missing.criticalMappingRequired).toBe(true);
      expect(missing.unknownCriticalCount).toBe(1);
      expect(missing.specs).toEqual(absent === spec ? [] : [{ file: spec, titles: [title] }]);
    }
    for (const sibling of ['lib/full-payment-form-next.ts', 'lib/payment-preflight.ts', 'lib/payment-adjustment-form.ts', 'lib/payment-journal/allocation-ledger.ts']) {
      const unknown = selectFocusedBrowser([source, sibling]);
      expect(unknown.criticalMappingRequired).toBe(true);
      expect(unknown.unknownCriticalCount).toBe(1);
      expect(unknown.specs).toEqual([{ file: spec, titles: [title] }]);
    }
    for (const file of [spec, ...contracts]) expect(() => readFileSync(file, 'utf8')).not.toThrow();
    expect(FOCUSED_SPECS[spec]).toEqual([title]);
  });
  it('maps only the independent real XML issuance case and explicit server/native invoice contracts', () => {
    const spec = 'e2e/payment-terms.spec.ts';
    const title = 'stale company default requires deliberate refresh, snapshots XML and permits a conscious manual date';
    const contracts = {
      'lib/zugferd-generator.ts': ['lib/__tests__/zugferd-generator.test.ts', 'lib/__tests__/own-invoice-source.test.ts'],
      'lib/purchase-documents/validation-xml.ts': ['lib/__tests__/purchase-validation-runtime.test.ts', '.github/workflows/ci.yml'],
      'lib/purchase-documents/validation-report-parser.ts': ['lib/__tests__/purchase-validation-report.test.ts', 'lib/__tests__/purchase-validation-runtime.test.ts', '.github/workflows/ci.yml'],
      'lib/server/own-invoice-layout.ts': ['lib/__tests__/own-invoice-layout.test.ts', 'lib/__tests__/own-invoice-renderer.test.ts', 'lib/__tests__/own-invoice-source.test.ts', 'lib/__tests__/pdfa3.test.ts', 'lib/__tests__/own-invoice-pdfa-validator.test.ts', 'lib/__tests__/own-invoice-pdfa-acceptance.test.ts', '.github/workflows/own-invoice-pdfa.yml'],
    };
    for (const [source, required] of Object.entries(contracts)) {
      const selection = selectFocusedBrowser([source]);
      expect(validFocusedSelection(selection)).toBe(true);
      expect(selection.core).toBe(true);
      expect(selection.criticalMappingRequired).toBe(false);
      expect(selection.specs).toEqual(source === 'lib/zugferd-generator.ts' ? [{ file: spec, titles: [title] }] : []);
      for (const absent of required) {
        const missing = selectFocusedBrowser([source], file => file !== absent);
        expect(missing.criticalMappingRequired).toBe(true);
        expect(missing.unknownCriticalCount).toBe(1);
      }
    }
    const selection = selectFocusedBrowser([...Object.keys(contracts), spec]);
    expect(selection.criticalMappingRequired).toBe(false);
    expect(selection.specs).toEqual([{ file: spec, titles: [title] }]);
    expect(selectFocusedBrowser(['lib/zugferd-generator.ts'], file => file !== spec).criticalMappingRequired).toBe(true);
    for (const sibling of ['lib/zugferd-generator-next.ts', 'lib/purchase-documents/validation-xml-next.ts', 'lib/purchase-documents/validation-report-parser-next.ts', 'lib/server/own-invoice-layout-next.ts']) {
      expect(selectFocusedBrowser([sibling]).criticalMappingRequired).toBe(true);
      expect(selectFocusedBrowser([...Object.keys(contracts), sibling]).criticalMappingRequired).toBe(true);
    }
  });
  it('retains the exact invoice regression titles, independent XML fixture and separate mandatory native gates', () => {
    const titles = (file: string) => {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ESNext, true);
      const values = new Set<string>();
      const isTest = (expression: ts.Expression): boolean => {
        if (ts.isIdentifier(expression)) return ['it', 'test'].includes(expression.text);
        if (ts.isCallExpression(expression)) return isTest(expression.expression);
        return ts.isPropertyAccessExpression(expression) && !['skip', 'todo', 'skipIf'].includes(expression.name.text) && isTest(expression.expression);
      };
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && isTest(node.expression) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) values.add(node.arguments[0].text);
        ts.forEachChild(node, visit);
      };
      visit(source);
      return values;
    };
    const mandatory = {
      'lib/__tests__/zugferd-generator.test.ts': ['rejects seller contact email %s before issuing XRechnung', 'rejects invalid SEPA IBAN %s before XML generation', 'normalizes a valid lowercase SEPA IBAN before validating and serializing it', 'preserves the required terminating newline of structured payment terms'],
      'lib/__tests__/purchase-validation-runtime.test.ts': ['rejects forbidden XML characters and references without claiming a completed check', 'retains legal XML whitespace, character references and supplementary Unicode', 'rejects wrong sums and a required missing field through official rules, not heuristics', 'keeps accepted informational guidance visibly distinct from an unqualified technical pass'],
      'lib/__tests__/purchase-validation-report.test.ts': ['recognizes an official XML parsing failure without inventing later validation steps', 'rejects absent checks, changed engine, foreign original and malformed/untrusted report data', 'retains bounded findings without losing a blocking error after the display cap'],
      'lib/__tests__/own-invoice-layout.test.ts': ['retains ordinary party fields and one-page geometry', 'wraps complete accepted names, streets/house numbers and cities instead of adding ellipses', 'keeps the complete wrapped seller address on every continuation page', 'explicitly rejects accepted source text that cannot fit the recipient block', 'explicitly rejects accepted seller text rather than crossing the reserved footer boundary'],
    };
    for (const [file, required] of Object.entries(mandatory)) for (const title of required) expect(titles(file).has(title), `${file}: ${title}`).toBe(true);
    const xml = readFileSync('e2e/payment-terms.spec.ts', 'utf8');
    for (const value of ["for (const staleSource of ['COMPANY', 'CUSTOMER'] as const)", 'test(`stale ${staleSource.toLowerCase()} default requires deliberate refresh, snapshots XML and permits a conscious manual date`', 'await fixture(page)', 'await createXml(page)', "pathname === '/api/invoices/upload'", "page.waitForEvent('download')", 'originalBytes.toString', 'expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`)']) expect(xml).toContain(value);
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).toContain('node scripts/einvoice-validation/install-runtime.mjs');
    expect(ci).toContain('BIVARO_EINVOICE_TEST_ASSETS: ${{ runner.temp }}/bivaro-einvoice');
    const native = readFileSync('.github/workflows/own-invoice-pdfa.yml', 'utf8');
    for (const value of ['pull_request:', "- 'lib/**'", 'runner: ubuntu-24.04', 'architecture: x64', 'runner: ubuntu-24.04-arm', 'architecture: arm64', 'node scripts/own-invoice-pdfa/install-runtime.mjs', "BIVARO_RUN_OWN_INVOICE_PDFA_ACCEPTANCE: '1'", 'npm test -- lib/__tests__/own-invoice-pdfa-acceptance.test.ts', 'm.cases.length!==10', '!m.malformedLogoPassed', '!m.overlongIdentifierPassed', '!m.overlongUnitPassed']) expect(native).toContain(value);
    const acceptance = readFileSync('lib/__tests__/own-invoice-pdfa-acceptance.test.ts', 'utf8');
    for (const name of ['small-business', 'standard-mixed-tax', 'multipage-description-notes', 'large-supported-total', 'unbroken-description-notes', 'licensed-fonts-escaped-title', 'transparent-logo-white-card', 'girocode-final-amount', 'civil-year-0001', 'civil-year-9999']) expect(acceptance).toContain(`name: '${name}'`);
  });
  it('maps exact currently reviewed PR213/214/215 path inventories without unsupported PDF/browser suites', () => {
    expect(selectFocusedBrowser(['app/api/backup/full/preview/route.ts', 'app/settings/page.tsx', 'components/settings/backup-file-inspection.tsx', 'lib/backup-file-preview.ts', 'e2e/backup-file-inspection.spec.ts']).specs.map(item => item.file)).toEqual(['e2e/backup-file-inspection.spec.ts']);
    const switching = selectFocusedBrowser(['app/help/page.tsx', 'components/public-accounting/switching-checklist.tsx', 'components/public-accounting/switching-checklist.module.css', 'lib/switching-checklist.ts', 'e2e/public-switching-checklist.spec.ts']);
    expect(switching.criticalMappingRequired).toBe(false); expect(switching.specs.map(item => item.file)).toEqual(['e2e/public-pilot-demo.spec.ts', 'e2e/public-switching-checklist.spec.ts']);
    expect(selectFocusedBrowser(['app/layout.tsx', 'components/app-shell.tsx', 'app/login/layout.tsx']).specs.map(item => item.file)).toEqual(['e2e/public-help-fragments.spec.ts']);
    expect(selectFocusedBrowser(['lib/payment-preflight.ts']).criticalMappingRequired).toBe(true);
  });
  it('maps the reviewed inactive quote foundation to its own read-only preview, never to SQL/restore certification', () => {
    const reviewed = [
    "app/api/backup/route.ts",
    "app/api/backup/full/route.ts",
    "app/api/backup/full/restore/route.ts",
    "app/api/backup/full/preview/route.ts",
    "lib/backup-manifest.ts",
    "lib/backup-preview.ts",
    "lib/backup-restore.ts",
    "lib/backup-schema-identities.ts",
    "lib/backup-snapshot.ts",
    "lib/manual-financial-record-backup.ts",
    "lib/quote-release-backup-store.ts",
    "lib/quote-release-backup.ts",
    "lib/quote-release-contract.ts",
    "lib/quote-release-original.ts",
    "lib/backup-file-preview.ts",
    "prisma/schema.prisma",
    "prisma/migrations/20261026090000_add_unactivated_quote_release_persistence/migration.sql",
    "prisma/migrations/20261026093000_add_quote_release_backup_identity/migration.sql"
];
    for (const source of reviewed) {
      const value = selectFocusedBrowser(['lib/quote-release-backup.ts', source]);
      expect(value.criticalMappingRequired).toBe(false);
      expect(value.specs).toEqual([{ file: 'e2e/backup-file-inspection.spec.ts', titles: ['ZIP inspection shows actual checks, blocks changed originals and never restores on discard or reload'] }]);
    }
    for (const source of ['prisma/schema.prisma', 'lib/backup-restore.ts', 'app/api/backup/full/restore/route.ts']) {
      expect(selectFocusedBrowser([source]).criticalMappingRequired).toBe(true);
    }
    for (const source of ['lib/quote-release-tokens.ts', 'lib/payment-preflight.ts', 'prisma/migrations/20261027000000_unreviewed/migration.sql']) {
      expect(selectFocusedBrowser(['lib/quote-release-backup.ts', source]).criticalMappingRequired).toBe(true);
    }
    const missingUnit = selectFocusedBrowser(['lib/quote-release-backup.ts'], file => file !== 'lib/__tests__/quote-release-original.test.ts');
    expect(missingUnit.criticalMappingRequired).toBe(true);
    const missing = selectFocusedBrowser(['lib/quote-release-backup.ts'], file => file !== 'e2e/backup-file-inspection.spec.ts');
    expect(missing.criticalMappingRequired).toBe(true); expect(missing.specs).toEqual([]);
  });
  it.each([
    ['lib/navigation.ts', ['e2e/ux-progressive-disclosure.spec.ts']],
    ['components/dashboard/tabs/invoices-tab.tsx', ['e2e/partial-payments.spec.ts', 'e2e/ux-progressive-disclosure.spec.ts']],
    ...['components/purchases/document-workspace.module.css', 'components/purchases/incoming-document-review.tsx', 'components/purchases/incoming-documents-workspace.tsx']
      .map(source => [source, ['e2e/manual-photo-expense.spec.ts', 'e2e/supplier-tasks.spec.ts', 'e2e/ux-progressive-disclosure.spec.ts']]),
    ['components/purchases/purchase-expense-approval.tsx', ['e2e/manual-photo-expense.spec.ts', 'e2e/ux-progressive-disclosure.spec.ts']],
  ] as [string, FocusedSpec[]][])('attaches exact real affected UX journeys to %s and fails closed on any missing journey', (source, specs) => {
    const selection = selectFocusedBrowser([source]);
    expect(validFocusedSelection(selection)).toBe(true);
    expect(selection.core).toBe(true);
    expect(selection.criticalMappingRequired).toBe(false);
    expect(selection.unmappedSourceCount).toBe(0);
    expect(selection.specs).toEqual(specs.map(file => ({ file, titles: FOCUSED_SPECS[file] })));
    for (const absent of specs) {
      const missing = selectFocusedBrowser([source], file => file !== absent);
      expect(missing.core).toBe(true);
      expect(missing.criticalMappingRequired).toBe(true);
      expect(missing.unknownCriticalCount).toBe(1);
      expect(missing.specs.map(spec => spec.file)).toEqual(specs.filter(file => file !== absent));
    }
  });
  it('unions the UX packet with existing invoice freshness and core without a broad or unit-only fallback', () => {
    const sources = ['lib/navigation.ts', 'components/dashboard/tabs/invoices-tab.tsx', 'components/dashboard/create-invoice-modal.tsx',
      'components/purchases/document-workspace.module.css', 'components/purchases/incoming-document-review.tsx',
      'components/purchases/incoming-documents-workspace.tsx', 'components/purchases/purchase-expense-approval.tsx'];
    const selection = selectFocusedBrowser(sources);
    expect(validFocusedSelection(selection)).toBe(true);
    expect(selection.core).toBe(true);
    expect(selection.criticalMappingRequired).toBe(false);
    expect(selection.specs.map(spec => spec.file)).toEqual(['e2e/invoice-number-check-freshness.spec.ts', 'e2e/manual-photo-expense.spec.ts',
      'e2e/partial-payments.spec.ts', 'e2e/supplier-tasks.spec.ts', 'e2e/ux-progressive-disclosure.spec.ts']);
    expect(selection.specs.find(spec => spec.file === 'e2e/supplier-tasks.spec.ts')?.titles).toHaveLength(3);
    expect(selection.specs.find(spec => spec.file === 'e2e/partial-payments.spec.ts')?.titles).toEqual(['treats a later deliberate equal amount/date/reference as a distinct allocation']);
    for (const source of ['lib/navigation-unknown.ts', 'components/purchases/new-approval-boundary.tsx', 'lib/purchase-documents/new-approval.ts', 'app/api/purchase-documents/new-write/route.ts']) {
      expect(selectFocusedBrowser([...sources, source]).criticalMappingRequired).toBe(true);
    }
  });
  it('adds UX journeys without suppressing the existing critical invoice-date feature packet', () => {
    const selection = selectFocusedBrowser(['components/purchases/incoming-documents-workspace.tsx', 'e2e/incoming-invoice-date-filter.spec.ts']);
    expect(validFocusedSelection(selection)).toBe(true);
    expect(selection.criticalMappingRequired).toBe(false);
    expect(selection.specs.map(spec => spec.file)).toEqual(['e2e/incoming-invoice-date-filter.spec.ts', 'e2e/manual-photo-expense.spec.ts',
      'e2e/supplier-tasks.spec.ts', 'e2e/ux-progressive-disclosure.spec.ts']);
    expect(selectFocusedBrowser(['components/purchases/incoming-documents-workspace.tsx', 'e2e/incoming-invoice-date-filter.spec.ts'],
      file => file !== 'e2e/manual-photo-expense.spec.ts').criticalMappingRequired).toBe(true);
  });
  it.each(['e2e/manual-photo-expense.spec.ts', 'e2e/partial-payments.spec.ts', 'e2e/supplier-tasks.spec.ts', 'e2e/ux-progressive-disclosure.spec.ts'] as const)('pins bounded UX selectors to real exact authored titles in %s', file => {
    const titles = FOCUSED_SPECS[file];
    expect(titles.length).toBeGreaterThan(0);
    expect(new Set(titles).size).toBe(titles.length);
    const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const authored: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) authored.push(node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(tree);
    for (const title of titles) expect(authored.filter(value => value === title)).toHaveLength(1);
    const selection = selectFocusedBrowser([file]);
    expect(selection.specs).toEqual([{ file, titles }]);
    expect(validFocusedSelection({ ...selection, specs: [{ file, titles: [] }] })).toBe(false);
    expect(validFocusedSelection({ ...selection, specs: [{ file, titles: ['.*'] }] })).toBe(false);
    expect(validFocusedSelection({ ...selection, specs: [{ file, titles: [...titles, 'unreviewed extra case'] }] })).toBe(false);
  });
  it('attaches only the real pilot and documentation cases, retains old public maps and fails closed on missing contracts', () => {
    const pilot = 'e2e/public-pilot-demo.spec.ts', documentation = 'e2e/documentation-loading.spec.ts';
    const sources = {
      'app/help/page.tsx': [pilot, 'e2e/public-help-fragments.spec.ts', 'e2e/public-switching-checklist.spec.ts'].sort(),
      'components/public-accounting/pilot-demo.tsx': [pilot, 'e2e/public-help-fragments.spec.ts'].sort(),
      'components/public-accounting/pilot-demo.module.css': [pilot, 'e2e/public-help-fragments.spec.ts'].sort(),
      'lib/pilot-demo.ts': [pilot],
      'app/settings/documentation/page.tsx': [documentation],
      [pilot]: [pilot], [documentation]: [documentation],
    };
    const required = {
      [pilot]: [pilot, 'lib/__tests__/pilot-demo.test.ts', 'e2e/helpers/public-read-only.ts', 'public/demo/bivaro-pilot-v1.txt'],
      [documentation]: [documentation, 'scripts/e2e-fixture.mjs', 'e2e/helpers/synthetic-login.ts', 'focused-e2e/core.spec.ts'],
    };
    for (const [source, specs] of Object.entries(sources)) {
      const selection = selectFocusedBrowser([source]);
      expect(validFocusedSelection(selection)).toBe(true);
      expect(selection.core).toBe(true);
      expect(selection.criticalMappingRequired).toBe(false);
      expect(selection.specs.map(item => item.file)).toEqual(specs);
      const own = specs.includes(pilot) ? pilot : documentation;
      for (const absent of required[own]) {
        const missing = selectFocusedBrowser([source], file => file !== absent);
        expect(missing.criticalMappingRequired).toBe(true);
        expect(missing.unknownCriticalCount).toBe(1);
        expect(missing.specs.some(item => item.file === own)).toBe(false);
      }
    }
    expect(selectFocusedBrowser(['app/settings/documentation/page.tsx'], file => file !== 'lib/__tests__/documentation-print-markdown.test.ts').criticalMappingRequired).toBe(true);
    const union = selectFocusedBrowser(Object.keys(sources));
    expect(union.criticalMappingRequired).toBe(false);
    expect(union.specs.map(item => item.file)).toEqual([documentation, 'e2e/public-help-fragments.spec.ts', pilot, 'e2e/public-switching-checklist.spec.ts']);
    for (const source of ['lib/pilot-demo-next.ts', 'app/api/documentation/route.ts', 'lib/documentation-unknown-contract.ts']) {
      expect(selectFocusedBrowser([source]).criticalMappingRequired).toBe(true);
      expect(selectFocusedBrowser([...Object.keys(sources), source]).criticalMappingRequired).toBe(true);
    }
  });
  it('pins exact active pilot, documentation and cashbook titles without executing their browser or database modules', () => {
    const authoredTitles = (file: string) => {
      const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const titles: string[] = [];
      const visit = (node: ts.Node, bindings: Record<string, string> = {}) => {
        if (ts.isFunctionLike(node)) return; // Helper and fixture bodies do not register cases.
        if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer) && ts.isArrayLiteralExpression(node.expression)) {
          const name = node.initializer.declarations[0]?.name;
          if (!name || !ts.isIdentifier(name)) throw Error('Unreviewed title loop');
          for (const value of node.expression.elements) {
            if (!ts.isNumericLiteral(value) && !ts.isStringLiteral(value)) throw Error('Unreviewed title value');
            visit(node.statement, { ...bindings, [name.text]: value.text });
          }
          return;
        }
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'test') {
          const title = node.arguments[0];
          if (title && ts.isStringLiteralLike(title)) titles.push(title.text);
          else if (title && ts.isTemplateExpression(title)) {
            let text = title.head.text;
            for (const span of title.templateSpans) {
              if (!ts.isIdentifier(span.expression) || !Object.hasOwn(bindings, span.expression.text)) throw Error('Unreviewed dynamic title');
              text += bindings[span.expression.text] + span.literal.text;
            }
            titles.push(text);
          }
          return; // Do not inspect or execute the browser callback body.
        }
        ts.forEachChild(node, child => visit(child, bindings));
      };
      visit(tree);
      return titles;
    };
    for (const [file, count] of [['e2e/public-pilot-demo.spec.ts', 3], ['e2e/documentation-loading.spec.ts', 6], ['e2e/cashbook-loading.spec.ts', 5]] as const) {
      const titles = FOCUSED_SPECS[file];
      expect(titles).toHaveLength(count);
      expect(authoredTitles(file)).toEqual(titles);
      expect(new Set(titles).size).toBe(count);
      const selection = selectFocusedBrowser([file]);
      expect(selection.specs).toEqual([{ file, titles }]);
      for (const replaced of [[], ['.*'], [...titles, 'unreviewed extra case']]) {
        expect(validFocusedSelection({ ...selection, specs: [{ file, titles: replaced }] })).toBe(false);
      }
    }
    const pilot = readFileSync('e2e/public-pilot-demo.spec.ts', 'utf8');
    for (const boundary of ["base.extend", "{ auto: true }", "route.abort('blockedbyclient')", 'blockedCount: 0', 'classifyPublicReadOnlyRequest']) expect(pilot).toContain(boundary);
    const documentation = readFileSync('e2e/documentation-loading.spec.ts', 'utf8');
    for (const boundary of ['expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`)', 'await isolateSyntheticLoginIpBudget()', 'await prisma.user.create', 'route.continue()', 'prisma.documentation.findUniqueOrThrow']) expect(documentation).toContain(boundary);
  });
  it('requires the bounded cashbook read journey and its contracts for the page or spec without exempting financial APIs', () => {
    const file = 'e2e/cashbook-loading.spec.ts';
    const required = [file, 'lib/__tests__/cashbook-view-regressions.test.ts', 'scripts/e2e-fixture.mjs', 'scripts/run-e2e.mjs', 'playwright.config.ts', 'e2e/helpers/synthetic-login.ts', 'focused-e2e/core.spec.ts'];
    for (const source of ['app/cashbook/page.tsx', file]) {
      const selection = selectFocusedBrowser([source]);
      expect(validFocusedSelection(selection)).toBe(true);
      expect(selection.core).toBe(true);
      expect(selection.criticalMappingRequired).toBe(false);
      expect(selection.unmappedSourceCount).toBe(0);
      expect(selection.specs).toEqual([{ file, titles: FOCUSED_SPECS[file] }]);
      for (const absent of required) {
        const missing = selectFocusedBrowser([source], candidate => candidate !== absent);
        expect(missing.criticalMappingRequired).toBe(true);
        expect(missing.unknownCriticalCount).toBe(1);
        expect(missing.specs).toEqual([]);
      }
    }
    for (const source of ['app/api/cashbook/route.ts', 'app/api/cashbook/transactions/route.ts', 'lib/cashbook-service.ts']) {
      expect(selectFocusedBrowser(['app/cashbook/page.tsx', source]).criticalMappingRequired).toBe(true);
    }
    const source = readFileSync(file, 'utf8');
    for (const boundary of ['expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`)', 'await isolateSyntheticLoginIpBudget()', 'await prisma.user.create', 'route.continue()', "await retry.press('Enter')", 'await page.reload()', 'prisma.cashTransaction.count']) expect(source).toContain(boundary);
  });
  it('selects only the real feature-backup restore case with its existing isolated fixture, never unrelated backup suites', () => {
    const file = 'e2e/feature-backup-roundtrip.spec.ts';
    const title = 'real backup endpoints remap feature histories, preserve legacy high-water marks and reject conflicts atomically';
    const selection = selectFocusedBrowser([file]);
    expect(validFocusedSelection(selection)).toBe(true);
    expect(selection.core).toBe(true);
    expect(selection.criticalMappingRequired).toBe(false);
    expect(selection.specs).toEqual([{ file, titles: [title] }]);
    for (const absent of [file, 'scripts/e2e-fixture.mjs', 'scripts/run-e2e.mjs', 'playwright.config.ts', 'focused-e2e/core.spec.ts', 'e2e/helpers/synthetic-login.ts']) {
      const missing = selectFocusedBrowser([file], source => source !== absent);
      expect(missing.criticalMappingRequired).toBe(true);
      expect(missing.unknownCriticalCount).toBe(1);
      expect(missing.specs).toEqual([]);
    }
    expect(selectFocusedBrowser(['lib/backup-restore-unreviewed.ts']).criticalMappingRequired).toBe(true);
    const source = readFileSync(file, 'utf8');
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const authored: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'test' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) authored.push(node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(tree);
    expect(authored).toEqual([title]);
    for (const boundary of ['expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`)', 'await isolateSyntheticLoginIpBudget()', 'await prisma.user.create', "page.request.get('/api/backup')", "page.request.post('/api/backup/restore'", 'await state(target.id)', 'await state(source.id)', "'20261026093000_add_quote_release_backup_identity'", "'quoteReleaseAuthorities'", "'quoteReleases'", "'quoteElectronicResponses'"]) expect(source).toContain(boundary);
    expect(source).not.toMatch(/\b(?:test\.(?:skip|fixme|todo)|page\.route)\s*\(/u);
    for (const titles of [[], ['.*'], [title, 'unreviewed case']]) expect(validFocusedSelection({ ...selection, specs: [{ file, titles }] })).toBe(false);
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
