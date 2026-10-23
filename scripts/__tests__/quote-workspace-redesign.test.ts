import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Source-only regression guard: no browser, server, network or database.
// Retains the quote contracts from dafbcea015f433f5a72ac519a37fe887a8bae5d6.
const text = readFileSync(new URL('../../components/dashboard/tabs/quotes-tab.tsx', import.meta.url), 'utf8');
const source = ts.createSourceFile('quotes-tab.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const css = readFileSync(new URL('../../components/dashboard/tabs/quote-workspace.module.css', import.meta.url), 'utf8');
const expectedAttributes: Record<string, number> = {
  "onValueChange:{onStatusChange}": 1,
  "id:\"quote-next-heading\"": 1,
  "type:\"button\"": 2,
  "onClick:{() => onStatusFilterChange(statusFilter === key ? 'all' : key)}": 1,
  "onClick:{() => { if (onResetFilters) onResetFilters(); else { onSearchChange(''); onStatusFilterChange('all'); } }}": 1,
  "id:\"quote-status-filter\"": 1,
  "onChange:{(e) => onStatusFilterChange(e.target.value)}": 1,
  "id:\"quote-search\"": 1,
  "type:\"text\"": 1,
  "onChange:{(e) => onSearchChange(e.target.value)}": 1,
  "onClick:{() => onSearchChange('')}": 1,
  "onRetry:{() => loadQuotes(page, pageSize)}": 1,
  "onStatusChange:{(newStatus) => onStatusChange(quote.id, newStatus)}": 2,
  "href:{`/history?invoiceId=${quote.convertedInvoice.id}`}": 2,
  "onClick:{() => setWorkflowQuote(quote)}": 2,
  "onClick:{() => window.open(`/api/quotes/download?id=${quote.id}`, '_blank')}": 2,
  "onClick:{() => setConfirmConvert(quote)}": 2,
  "data-email-preview-return:{`quote:${quote.id}`}": 2,
  "onClick:{(event) => { emailReturnFocusRef.current = event.currentTarget; setEmailQuote(quote); }}": 2,
  "onClick:{() => window.open(`/api/quotes/download?id=${quote.id}&download=true`, '_blank')}": 2,
  "onClick:{() => setConfirmDelete(quote)}": 2,
  "name:\"nav-quotes\"": 2,
  "onClick:{onOpenCreateModal}": 2,
  "id:\"quotes-page-size\"": 1,
  "onChange:{async (e) => { const size = parseInt(e.target.value); onPageSizeChange(size); onPageChange(1); await loadQuotes(1, size); }}": 1,
  "onClick:{async () => { const p = Math.max(1, page - 1); onPageChange(p); await loadQuotes(p, pageSize); }}": 1,
  "onClick:{async () => { const p = Math.min(totalPages, page + 1); onPageChange(p); await loadQuotes(p, pageSize); }}": 1,
  "onClose:{() => setWorkflowQuote(null)}": 1,
  "onSaved:{() => loadQuotes(page, pageSize)}": 1,
  "onOpenChange:{() => setConfirmConvert(null)}": 1,
  "onClick:{() => setConfirmConvert(null)}": 1,
  "onClick:{handleConvert}": 1,
  "onOpenChange:{() => setConfirmDelete(null)}": 1,
  "onClick:{() => setConfirmDelete(null)}": 1,
  "onClick:{handleDelete}": 1,
  "onOpenChange:{(open) => !open && setEmailQuote(null)}": 1,
  "onSent:{() => loadQuotes(page, pageSize)}": 1
};
const expectedLogic: Record<string, string> = {
  "Quote": "34a205bd629c170cfb226b1409996f1b630f95b4c78f90bbf490a6c9db5d9644",
  "QuotesTabProps": "1fd603707fd29c95d2505f74ea8b4b2f11b07fb51f79c23e26a9231923529975",
  "STATUS_OPTIONS": "120bfd361c27158a9c9c3e5d643da9985997c0785d7b536e373fa6242ea581f8",
  "STATUS_LABELS": "20abc5cd31d469a40ce81f3e906341b7222db91fdd4a96145414cef66e9e1dbb",
  "handleConvert": "fc41182fc8210173efdfd1131bc7debf1be50aaa636559a8fe21676e4359878a",
  "handleDelete": "4bed761207d703126712042b56639a6145bd60b1eb46d362eadd7a3638913629"
};

function visit(callback: (node: ts.Node) => void) {
  const walk = (node: ts.Node) => { callback(node); ts.forEachChild(node, walk); };
  walk(source);
}

describe('quote workspace presentation-only redesign contract', () => {
  it('allows large desktop amounts to wrap within their fixed ledger column', () => {
    expect(css).toContain('.table .amountCell { white-space: normal; overflow-wrap: anywhere; }');
  });
  it('retains all 49 original handlers, IDs, field types, destinations and return-focus hooks', () => {
    const actual: Record<string, number> = {};
    visit(node => {
      if (!ts.isJsxAttribute(node)) return;
      const name = node.name.getText(source);
      if (!/^(on[A-Z]|id$|name$|type$|href$|data-)/.test(name)) return;
      const key = name + ':' + (node.initializer?.getText(source).replace(/\s+/g, ' ').trim() || 'true');
      actual[key] = (actual[key] || 0) + 1;
    });
    expect(actual).toEqual(expectedAttributes);
    expect(Object.values(actual).reduce((sum, count) => sum + count, 0)).toBe(49);
  });

  it('does not change the quote types, status choices, conversion or deletion logic', () => {
    const actual: Record<string, string> = {};
    visit(node => {
      if (!(ts.isTypeAliasDeclaration(node) || ts.isVariableDeclaration(node))) return;
      const name = node.name.getText(source);
      if (!(name in expectedLogic)) return;
      actual[name] = createHash('sha256').update(node.getText(source).replace(/\s+/g, ' ')).digest('hex');
    });
    expect(actual).toEqual(expectedLogic);
    expect(text.match(/quoteConversionBlockReason\(quote, workflowDate\)/g)).toHaveLength(4);
    expect(text.match(/quoteNextAction\(quote, workflowDate\)/g)).toHaveLength(4);
  });

  it('keeps both conversion and deletion confirmation descriptions verbatim', () => {
    const hashes: string[] = [];
    visit(node => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'DialogDescription') {
        hashes.push(createHash('sha256').update(node.getText(source).replace(/\s+/g, ' ')).digest('hex'));
      }
    });
    expect(hashes).toEqual(["f130bca92b7d3c4adbcc1295be68ce99c48f52acfa998c27519a6a1bbcca2b20","dad1e0699c7e76ae96e7b0fc92507642538b20f8dbe78ea72923f05dbfd85cf9"]);
  });

  it('uses the existing dataset scopes and truthful loading, empty and retry states', () => {
    expect(text).toContain('amounts={isLoading || isError ? [] : quotes.map(quote => quote.totalAmount ?? 0)}');
    expect(text).toContain('workflowCounts[key]');
    expect(text).toContain('disabled={isLoading || isError}');
    expect(text).toContain('hidden={isError}');
    expect(text).toContain('onRetry={() => loadQuotes(page, pageSize)}');
    expect(text).toContain('Keine passenden Angebote');
    expect(text).toContain('Noch keine Angebote');
    expect(text).toContain('Angebote werden geladen…');
  });

  it('keeps responsive record information, token styling and 44px controls in the quote-owned surface', () => {
    const used = new Set<string>();
    visit(node => { if (ts.isPropertyAccessExpression(node) && node.expression.getText(source) === 'styles') used.add(node.name.text); });
    for (const name of used) expect(css, name).toMatch(new RegExp('\\.' + name + '\\b'));
    expect(css).toContain('min-height: 2.75rem');
    expect(css).toContain('@media (min-width: 1280px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain(':focus-visible');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|(?:rgb|hsl|oklch)\(/i);
    expect(css).not.toContain('transition: all');
    expect(text).toContain('<StatusIcon');
    expect(text).toContain('aria-label={`Angebotsstatus:');
  });
});
