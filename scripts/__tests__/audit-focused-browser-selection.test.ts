import { existsSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { FOCUSED_SPECS, selectFocusedBrowser, validFocusedSelection } from '../focused-browser-selection.mjs';

const invoiceSpec = 'e2e/invoice-list-sorting.spec.ts';
const calendarMarker = 'lib/__tests__/ledger-calendar-boundaries.test.ts';
const keyMarker = 'lib/__tests__/mcp-access-keys.test.ts';
const logoMarker = 'lib/__tests__/logo-upload-validation.test.ts';
const invoiceSources = ['app/api/invoices/route.ts', 'lib/server/invoice-list.ts', 'lib/invoice-list-sort.ts',
  'lib/record-search/list-contract.ts', 'hooks/use-dashboard-data.ts', 'hooks/use-record-invoice-list.ts',
  'components/dashboard/dashboard-content.tsx'];
const financialSources = ['lib/business-date.ts', 'lib/accounting.ts', 'lib/cashbook-service.ts', 'lib/tax-summary.ts',
  'app/api/incomes/route.ts', 'app/api/incomes/export/route.ts', 'app/api/expenses/route.ts',
  'app/api/expenses/export/route.ts', 'app/api/v1/expenses/route.ts'];
const invoiceContracts = ['lib/__tests__/invoice-list-sorting.test.ts', 'lib/__tests__/record-invoice-list-sort-client.test.ts',
  'lib/__tests__/invoice-list-calendar-boundaries.test.ts', 'lib/__tests__/helpers/database.ts',
  'scripts/e2e-fixture.mjs', 'scripts/run-e2e.mjs', 'playwright.config.ts', 'e2e/helpers/synthetic-login.ts',
  'focused-e2e/core.spec.ts', '.github/workflows/ci.yml'];
const financialContracts = [calendarMarker, 'lib/__tests__/ledger-date-filter-routes.test.ts',
  'lib/__tests__/legacy-accounting-date-input.test.ts', 'lib/__tests__/income-business-date.test.ts',
  'lib/__tests__/accounting.test.ts', 'lib/__tests__/tax-summary.test.ts', 'lib/__tests__/cashbook-nonnegative.test.ts',
  'lib/__tests__/eur-export-accounting.test.ts', 'lib/__tests__/api-boundaries.test.ts',
  'lib/__tests__/helpers/database.ts', 'vitest.config.mts', '.github/workflows/ci.yml'];

describe('reviewed October audit packets', () => {
  it('binds the exact invoice title to its authored test and rejects wildcard or extra titles', () => {
    const ast = ts.createSourceFile(invoiceSpec, readFileSync(invoiceSpec, 'utf8'), ts.ScriptTarget.Latest, true);
    const titles: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'test' &&
        node.arguments[0] && ts.isStringLiteral(node.arguments[0])) titles.push(node.arguments[0].text);
      ts.forEachChild(node, visit);
    }
    visit(ast);
    expect(titles).toEqual(FOCUSED_SPECS[invoiceSpec]);
    expect(titles).toHaveLength(1);
    const selection = selectFocusedBrowser([invoiceSpec], existsSync);
    expect(validFocusedSelection(selection)).toBe(true);
    for (const changed of [[], ['.*'], [...titles, 'unreviewed case']]) {
      expect(validFocusedSelection({ ...selection, specs: [{ file: invoiceSpec, titles: changed }] })).toBe(false);
    }
  });

  it('maps exact sorting sources and retains both existing shared dashboard journeys', () => {
    for (const source of invoiceSources) {
      const selected = selectFocusedBrowser([invoiceSpec, source], existsSync);
      expect(selected.criticalMappingRequired).toBe(false);
      expect(selected.unmappedSourceCount).toBe(0);
      expect(selected.specs.map(item => item.file)).toEqual(source === 'components/dashboard/dashboard-content.tsx'
        ? [invoiceSpec, 'e2e/manual-entry-submission.spec.ts', 'e2e/quote-release-owner-surface.spec.ts'].sort()
        : [invoiceSpec]);
    }
    // Test one packet per missing dependency instead of repeating the same
    // check per source. The exact blocked count still catches a single source
    // accidentally bypassing a required guard.
    for (const missing of [invoiceSpec, ...invoiceContracts]) {
      const blocked = selectFocusedBrowser([invoiceSpec, ...invoiceSources], file => file !== missing);
      expect(blocked.unknownCriticalCount, missing).toBe(invoiceSources.length + 1);
      expect(blocked.criticalMappingRequired, missing).toBe(true);
    }
    expect(selectFocusedBrowser(['lib/server/invoice-list.ts']).criticalMappingRequired).toBe(true);
  });

  it('requires calendar/input and existing financial contracts without claiming browser certification', () => {
    for (const source of financialSources) {
      const selected = selectFocusedBrowser([calendarMarker, source], existsSync);
      expect(selected.criticalMappingRequired).toBe(false);
      expect(selected.unmappedSourceCount).toBe(0);
      expect(selected.core).toBe(true);
      expect(selected.specs).toEqual([]);
    }
    for (const missing of financialContracts) {
      const blocked = selectFocusedBrowser([calendarMarker, ...financialSources], file => file !== missing);
      expect(blocked.unknownCriticalCount, missing).toBe(financialSources.length);
      expect(blocked.criticalMappingRequired, missing).toBe(true);
    }
    expect(selectFocusedBrowser(['lib/accounting.ts']).criticalMappingRequired).toBe(true);
  });

  it('retains MCP key and file security contracts for exact validation packets', () => {
    const key = 'app/api/api-keys/route.ts';
    const logo = 'app/api/settings/upload-logo/route.ts';
    const keySelection = selectFocusedBrowser([keyMarker, key], existsSync);
    expect(keySelection.criticalMappingRequired).toBe(false);
    expect(keySelection.specs.map(item => item.file)).toEqual(['e2e/mcp-access.spec.ts']);
    const logoSelection = selectFocusedBrowser([logoMarker, logo], existsSync);
    expect(logoSelection.criticalMappingRequired).toBe(false);
    expect(logoSelection.specs).toEqual([]);
    const keyContracts = [keyMarker, 'e2e/mcp-access.spec.ts', 'lib/__tests__/mcp.test.ts',
      'lib/__tests__/mcp-auth.test.ts', 'lib/__tests__/api-auth.test.ts', 'lib/__tests__/helpers/database.ts',
      'scripts/e2e-fixture.mjs', 'scripts/run-e2e.mjs', 'scripts/mcp-browser-env.mjs',
      'playwright.focused.config.ts', 'focused-e2e/core.spec.ts', '.github/workflows/ci.yml', 'playwright.security.config.ts'];
    const logoContracts = [logoMarker, 'lib/__tests__/file-security-integration.test.ts', 'lib/__tests__/upload-path.test.ts',
      'lib/__tests__/private-upload-routing.test.ts', 'lib/__tests__/request-security.test.ts',
      'lib/__tests__/resource-limits.test.ts', 'lib/__tests__/helpers/database.ts', '.github/workflows/ci.yml', 'playwright.security.config.ts'];
    for (const missing of keyContracts) expect(selectFocusedBrowser([keyMarker, key], file => file !== missing).criticalMappingRequired).toBe(true);
    for (const missing of logoContracts) expect(selectFocusedBrowser([logoMarker, logo], file => file !== missing).criticalMappingRequired).toBe(true);
    expect(selectFocusedBrowser([key]).criticalMappingRequired).toBe(true);
    expect(selectFocusedBrowser([logo]).criticalMappingRequired).toBe(true);
  });

  it('unions reviewed evidence while unrelated critical sources remain blocked', () => {
    const packet = [invoiceSpec, calendarMarker, keyMarker, logoMarker, ...invoiceSources, ...financialSources,
      'app/api/api-keys/route.ts', 'app/api/settings/upload-logo/route.ts'];
    const selected = selectFocusedBrowser(packet, existsSync);
    expect(validFocusedSelection(selected)).toBe(true);
    expect(selected.unknownCriticalCount).toBe(0);
    expect(selected.unmappedSourceCount).toBe(0);
    expect(selected.specs.map(item => item.file)).toEqual([invoiceSpec, 'e2e/manual-entry-submission.spec.ts',
      'e2e/mcp-access.spec.ts', 'e2e/quote-release-owner-surface.spec.ts'].sort());
    for (const source of ['lib/api-auth.ts', 'app/api/backup/restore/route.ts', 'app/api/unreviewed/route.ts',
      'lib/payment-journal/service.ts', 'lib/unreviewed-accounting.ts']) {
      expect(selectFocusedBrowser([...packet, source], existsSync).unknownCriticalCount).toBe(1);
    }
  });
});
