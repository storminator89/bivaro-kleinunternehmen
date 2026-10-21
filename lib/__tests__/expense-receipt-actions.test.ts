import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ExpenseReceiptActions, isXmlExpenseReceipt } from '@/components/dashboard/expense-receipt-actions';

const expense = { id: 71, description: 'Lieferantenrechnung', receiptFileName: 'rechnung.xml', storedReceiptFileName: 'opaque.xml' };
function render(overrides: Partial<typeof expense> = {}, compact = false) {
  return renderToStaticMarkup(createElement(TooltipProvider, null, createElement(ExpenseReceiptActions, { expense: { ...expense, ...overrides }, onViewReceipt: vi.fn(), compact })));
}
describe('expense receipt action contract', () => {
  it.each([false, true])('offers exactly one explicit XML-original download, never iframe preview (compact=%s)', compact => {
    const html = render({}, compact);
    expect(html).toContain('aria-label="XML-Original zu Lieferantenrechnung herunterladen"');
    expect(html).toContain('href="/api/expenses/download?id=71&amp;download=true"');
    expect(html).toContain('download=""');
    expect(html.match(/href=/g)).toHaveLength(1);
    expect(html).not.toContain('anzeigen'); expect(html).not.toContain('Beleg ansehen'); expect(html).not.toContain('<iframe');
    if (!compact) expect(html).toContain('XML-Original herunterladen');
  });
  it('recognizes XML case-insensitively from either existing receipt metadata field', () => {
    expect(isXmlExpenseReceipt({ ...expense, receiptFileName: 'RECHNUNG.XML', storedReceiptFileName: 'opaque' })).toBe(true);
    expect(isXmlExpenseReceipt({ ...expense, receiptFileName: 'Rechnung', storedReceiptFileName: 'opaque.XML' })).toBe(true);
    expect(isXmlExpenseReceipt({ ...expense, receiptFileName: 'Rechnung.pdf', storedReceiptFileName: 'opaque.pdf' })).toBe(false);
    expect(isXmlExpenseReceipt({ id: 1, description: 'Ohne Datei' })).toBe(false);
  });
  it.each(['pdf', 'png', 'jpg'])('preserves %s preview on mobile and preview plus download on desktop', extension => {
    const files = { receiptFileName: `rechnung.${extension}`, storedReceiptFileName: `opaque.${extension}` };
    const mobile = render(files);
    expect(mobile).toContain('aria-label="Beleg zu Lieferantenrechnung anzeigen"'); expect(mobile).toContain('Beleg ansehen'); expect(mobile).not.toContain('href=');
    const desktop = render(files, true);
    expect(desktop).toContain('aria-label="Beleg zu Lieferantenrechnung anzeigen"');
    expect(desktop).toContain('aria-label="Beleg zu Lieferantenrechnung herunterladen"');
    expect(desktop.match(/href=/g)).toHaveLength(1);
  });
  it('renders no receipt action without the actual stored receipt reference', () => {
    expect(render({ storedReceiptFileName: '' })).toBe('');
  });
  it('uses the same file-aware action in both expense-list layouts without redundant legacy preview/download actions', () => {
    const list = readFileSync('components/dashboard/tabs/expenses-tab.tsx', 'utf8');
    expect(list.match(/<ExpenseRowActions /g)).toHaveLength(2);
    const source = readFileSync('components/dashboard/expense-row-actions.tsx', 'utf8');
    expect(source).toContain('<ExpenseReceiptActions ');
    expect(source).not.toContain('onViewReceipt(`/api/expenses/download');
    expect(source).not.toContain("'Beleg Download'");
  });
});
