import { createElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InvoicesTab } from '@/components/dashboard/tabs/invoices-tab';
import type { Invoice } from '@/types/dashboard';

type Props = ComponentProps<typeof InvoicesTab>;
type Element = ReactElement<Record<string, unknown>>;
const invoice: Invoice = { id: 7, invoiceNumber: 'SYNTHETIC-CACHED-7', fileName: 'synthetic.pdf', uploadedAt: '2026-10-01T00:00:00Z', totalAmount: 10, status: 'PAID', paymentSummary: { totalCents: '1000', paidCents: '1000', openCents: '0', paid: true, paymentState: 'PAID' } };

function render(overrides: Partial<Props> = {}) {
  const props: Props = {
    selectedFile: null, isUploading: false, onFileChange: vi.fn(), onFileUpload: vi.fn(), onOpenCreateModal: vi.fn(),
    filters: { searchTerm: '', paidStatus: 'all', dateRange: 'all', sortBy: 'date', sortOrder: 'desc' }, setFilters: vi.fn(),
    invoices: [], page: 1, pageSize: 10, total: 0, totalPages: 1, onPageChange: vi.fn(), onPageSizeChange: vi.fn(), loadInvoices: vi.fn().mockResolvedValue(undefined),
    onViewReceipt: vi.fn(), onOpenDetails: vi.fn(), onStatusChange: vi.fn(), onCancel: vi.fn(), onDelete: vi.fn(), isDeleting: false,
    ...overrides,
  };
  let tree: ReactNode = null;
  function Capture() { tree = InvoicesTab(props); return tree; }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, tree, props, text: html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ') };
}
function find(node: ReactNode, predicate: (element: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap(child => find(child, predicate));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(predicate(node) ? [node] : []), ...find(node.props.children as ReactNode, predicate)];
}

describe('invoice list states and page-scoped accounting display', () => {
  it.each(['loading', 'error'] as const)('suppresses cached invoice rows, counts and amounts while %s', mode => {
    const { html, text } = render({ invoices: [invoice], total: 123, isLoading: mode === 'loading', isError: mode === 'error' });
    expect(html).not.toContain(invoice.invoiceNumber);
    expect(text).toContain('Summe dieser Seite —');
    expect(text).toContain('Rechnungen im Ergebnis —');
    expect(text).toContain('Bezahlt auf dieser Seite —');
    expect(text).toContain('Offen auf dieser Seite —');
    expect(text).not.toContain('10,00');
    if (mode === 'loading') {
      expect(html).toContain('role="status"');
      expect(text).toContain('Rechnungen werden geladen…');
      expect(html).not.toContain('role="alert"');
    } else {
      expect(html).toContain('role="alert"');
      expect(text).toContain('Rechnungen konnten nicht geladen werden.');
      expect(text).not.toContain('Rechnungen werden geladen…');
    }
  });

  it('retries an errored read with the current page and page size', async () => {
    const { tree, props } = render({ isError: true, page: 3, pageSize: 20, total: 60, totalPages: 3 });
    const retry = find(tree, element => element.props.children === 'Erneut laden');
    expect(retry).toHaveLength(1);
    await (retry[0].props.onClick as () => Promise<void>)();
    expect(props.loadInvoices).toHaveBeenCalledExactlyOnceWith(3, 20);
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it('distinguishes a filtered empty result from an account with no invoices', () => {
    const empty = render();
    expect(empty.text).toContain('Ihre erste Rechnung beginnt hier');
    const filtered = render({ filters: { ...empty.props.filters, searchTerm: 'not-present' } });
    expect(filtered.text).toContain('Keine passenden Rechnungen');
    expect(filtered.text).not.toContain('Ihre erste Rechnung beginnt hier');
    expect(filtered.text).toContain('Summe dieser Seite 0,00');
  });

  it('separates whole-result count from this page sum and paid/open counts', () => {
    const open: Invoice = { ...invoice, id: 8, invoiceNumber: 'SYNTHETIC-OPEN-8', totalAmount: 20, status: 'SENT', paymentSummary: { totalCents: '2000', paidCents: '0', openCents: '2000', paid: false, paymentState: 'OPEN' } };
    const { text } = render({ invoices: [invoice, open], total: 123, totalPages: 13, page: 2 });
    expect(text).toContain('Rechnungen im Ergebnis 123');
    expect(text).toContain('Summe dieser Seite 30,00');
    expect(text).toContain('Bezahlt auf dieser Seite 1');
    expect(text).toContain('Offen auf dieser Seite 1');
    expect(text).toContain('11–20 von 123 Rechnungen');
  });
});
