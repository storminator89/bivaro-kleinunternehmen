import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = readFileSync('components/dashboard/tabs/invoices-tab.tsx', 'utf8');
const css = readFileSync('components/dashboard/tabs/invoice-workspace.module.css', 'utf8');
const tree = ts.createSourceFile('invoices-tab.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fingerprint = (text: string) => createHash('sha256').update(text.replace(/\s+/g, ' ')).digest('hex');

// Baseline: dafbcea. These checks deliberately freeze existing contracts, not
// class names or visual markup. Changing finance/actions requires a separate review.
const frozenDeclarations: Record<string, string> = {
  canDeleteDraft: '4511c8e2e10c150a46281e57642ebc4b88df6ea2c4af0315dff96a6c7511a710',
  availableInvoiceStatuses: 'b17f7bc3b421186a973d6a02ddd72d96a570aa5a3e5a6ea5f80b6752849f06f0',
  InvoiceBalance: 'c57da60ec1a9b68319d89ec93c35e51df1a491fcb9a6a5add8ec8f62cbe6602f',
  InvoicesTabProps: '76455f1bb4c463486587a054e12a54223bc285f7024a030ba2922356d8c15f2c',
  paidCount: '4ffe8b4ee3988e2cea90367612013423a7acb50a09a1eb619a9fc98c933dacb0',
  openCount: 'd4a12d8858a98a2f3be3ac8fbda2cf48dd3a4844511dc98e45617aa41da3f8a5',
  renderInvoiceActions: '0d2bb30bce5de3b1966e55081858d80096a17274b3d5ed28e38c49584ba5ec3c',
};
const declarations: Record<string, string> = {};
const bindings: string[] = [];
const contractAttribute = /^(id|name|type|href|accept|disabled|value|on[A-Z]\w*|data-\w[\w-]*|aria-sort|aria-busy|aria-describedby|availableStatuses|paymentReturnId|paymentState|returnFocusRef|documentType|documentId)$/;
function inspect(node: ts.Node) {
  if ((ts.isFunctionDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isVariableDeclaration(node)) && node.name) {
    const name = node.name.getText(tree);
    if (name in frozenDeclarations) declarations[name] = fingerprint(node.getText(tree));
  }
  if (ts.isJsxAttribute(node) && contractAttribute.test(node.name.getText(tree))) {
    const element = node.parent.parent;
    const decorativeIconName = node.name.getText(tree) === 'name'
      && (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element))
      && element.tagName.getText(tree) === 'DashboardIcon';
    if (!decorativeIconName) bindings.push(node.getText(tree).replace(/\s+/g, ' '));
  }
  ts.forEachChild(node, inspect);
}
inspect(tree);

describe('invoice workspace presentation boundaries', () => {
  it('keeps all financial presentation, eligibility, count and action declarations unchanged', () => {
    expect(declarations).toEqual(frozenDeclarations);
  });

  it('preserves every baseline callback, field, option, route, guard and focus-return binding', () => {
    expect(bindings).toHaveLength(87);
    expect(fingerprint(bindings.sort().join('\n'))).toBe('5f0f370561baedeb0d402a70d568f654968d75d1bdb5cd53020a1a8f8557d349');
  });

  it('leads with the ledger and places utility tasks in one secondary lane', () => {
    expect(source.indexOf('className={`invoice-ledger')).toBeLessThan(source.indexOf('<aside className={styles.tools}'));
    expect(source.indexOf('className={`invoice-import')).toBeLessThan(source.indexOf('aria-label="Wiederkehrende Serviceleistungen"'));
    expect(source).not.toContain('sales-workspace.module.css');
    expect(source).toContain('import styles from "./invoice-workspace.module.css"');
  });

  it('makes search first in keyboard order and invoice identity first in the desktop ledger', () => {
    expect(source.indexOf('id="invoice-search"')).toBeLessThan(source.indexOf('<fieldset'));
    expect(source.indexOf("aria-sort={filters.sortBy === 'invoiceNumber'")).toBeLessThan(source.indexOf("aria-sort={filters.sortBy === 'date'"));
    expect(source.match(/paymentReturnId=\{invoice.id\}/g)).toHaveLength(2);
  });

  it('uses the same truthful loading and empty states in both responsive layouts', () => {
    expect(source.match(/renderEmptyState\(\)/g)).toHaveLength(2);
    expect(source.match(/renderLoadingState\(\)/g)).toHaveLength(2);
    expect(source).toContain('Rechnungen konnten nicht geladen werden.');
    expect(source).toContain('onClick={() => loadInvoices(page, pageSize)}');
    expect(source).toContain('role="status"');
    expect(source).toContain('className={styles.skeletonRows} aria-hidden="true"');
  });

  it('retains the explicit scope of count and sum labels rather than inventing metrics', () => {
    for (const label of ['Rechnungen im Ergebnis', 'Bezahlt auf dieser Seite', 'Offen auf dieser Seite']) expect(source).toContain(label);
    expect(source).toContain('<LedgerListHeading');
    expect(source).toContain('amounts={isLoading || isError ? [] : invoices.map(invoice => invoice.totalAmount ?? 0)}');
  });

  it('keeps tokens, focus, motion fallback and 44px controls local to this screen', () => {
    expect(css.startsWith('/* Hallmark')).toBe(true);
    expect(css).toContain('font-family: var(--font-body)');
    expect(css).toContain('min-height: 2.75rem');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('outline: 2px solid var(--color-focus)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|transition:\s*all|100vw|overflow-x:\s*hidden/i);
  });

  it('only opens a wide utility rail when ledger width is available, and keeps phone amounts readable', () => {
    expect(css).toContain('@media (min-width: 1600px)');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) 15rem');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toContain('@media (max-width: 639px)');
    expect(css).toContain('.recordHeading { grid-template-columns: minmax(0, 1fr); }');
    expect(css).toContain('.workspace .statusSwitch { grid-template-columns: repeat(2, minmax(0, 1fr)); }');
    expect(css).toContain('.workspace .filterBar input, .workspace .filterBar select { font-size: var(--text-base); }');
    expect(css).not.toContain('overflow: clip');
    expect(css).toContain('.workspace .desktopRecord :global(td button[aria-label^="Details zu Rechnung"]) { min-height: 2.75rem; }');
  });
});
