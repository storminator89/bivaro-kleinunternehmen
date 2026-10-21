import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';

const state = vi.hoisted(() => ({ timeRange: 'thisYear', setTimeRange: vi.fn(), tab: 'eur', createAction: vi.fn(), summary: null as Record<string, unknown> | null, summaryFetching: false, summaryFailed: false, reloadSummary: vi.fn() }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const useState = (initial: unknown) => initial === 'thisYear'
    ? [state.timeRange, state.setTimeRange]
    : [typeof initial === 'function' ? initial() : initial, vi.fn()];
  const useMemo = (factory: () => unknown) => factory();
  const useRef = (current: unknown) => ({ current });
  return { ...actual, default: { ...actual, useMemo, useState, useRef }, useState, useRef, useEffect: vi.fn() };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(`tab=${state.tab}`),
}));
vi.mock('@/hooks/use-dashboard-data', () => ({ useDashboardData: () => ({
  expenses: [], incomes: [], invoices: [], customers: [], quotes: [], assetExpenses: [],
  uniqueCategories: [], uniqueCustomers: [], summary: state.summary,
  summaryIsFetching: state.summaryFetching, summaryIsError: state.summaryFailed, reloadSummary: state.reloadSummary,
}) }));
vi.mock('@/hooks/use-dashboard-create-action', () => ({ useDashboardCreateAction: state.createAction }));
vi.mock('@/components/dashboard/dashboard-client', () => ({ DashboardClient: () => null }));
vi.mock('@/components/dashboard/create-invoice-modal', () => ({ CreateInvoiceModal: () => null }));
vi.mock('@/components/dashboard/modals', () => ({
  EditModal: () => null, InvoiceDetailsModal: () => null, ReceiptModal: () => null,
  DeleteConfirmationModal: () => null, CreditNoteModal: () => null,
}));
vi.mock('@/components/dashboard/modals/recurring-expenses-modal', () => ({ RecurringExpensesModal: () => null }));
vi.mock('@/components/dashboard/tabs', () => ({
  EURTab: () => null, GWGTab: () => null, ExpensesTab: () => null, IncomesTab: () => null, InvoicesTab: () => null,
}));
vi.mock('@/components/dashboard/email-preview-dialog', () => ({ EmailPreviewDialog: () => null }));
import { DashboardContent } from '@/components/dashboard/dashboard-content';
import { QuotesTab, type Quote } from '@/components/dashboard/tabs/quotes-tab';

type Element = ReactElement<Record<string, unknown>>;
function findElements(node: ReactNode, predicate: (element: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap(child => findElements(child, predicate));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [
    ...(predicate(node) ? [node] : []),
    ...findElements(node.props.children as ReactNode, predicate),
    ...findElements(node.props.actions as ReactNode, predicate),
  ];
}

beforeEach(() => {
  state.tab = 'eur'; state.timeRange = 'thisYear';
  state.setTimeRange.mockReset(); state.createAction.mockReset();
  state.summary = null; state.summaryFetching = false; state.summaryFailed = false; state.reloadSummary.mockReset();
});

describe('fresh guarded EÜR client export and cached-value suppression', () => {
  const fresh = { timeRange: 'thisYear', totalIncome: 120, totalExpense: 20, profit: 100, expenseCategories: [{ category: 'Fresh category', amount: 20 }], monthlyData: [], depreciationDetails: [] };
  function exportHandler() {
    const report = findElements(DashboardContent(), element => typeof element.props.onExport === 'function' && 'totalIncome' in element.props)[0];
    expect(report).toBeDefined();
    return report.props.onExport as () => Promise<void>;
  }
  it('fetches once for repeated clicks and downloads only the newly guarded values, never cached totals/categories', async () => {
    state.summary = { ...fresh, totalIncome: 999, expenseCategories: [{ category: 'Cached category', amount: 999 }] };
    let resolve!: (value: unknown) => void;
    state.reloadSummary.mockReturnValue(new Promise(value => { resolve = value; }));
    const onExport = exportHandler(), click = vi.fn();
    let blob: Blob | undefined;
    vi.stubGlobal('document', { createElement: () => ({ href: '', download: '', click, remove: vi.fn() }), body: { appendChild: vi.fn() } });
    vi.stubGlobal('URL', { createObjectURL: vi.fn((value: Blob) => { blob = value; return 'blob:synthetic'; }), revokeObjectURL: vi.fn() });
    vi.useFakeTimers();
    try {
      const first = onExport(), repeated = onExport();
      expect(state.reloadSummary).toHaveBeenCalledTimes(1); expect(click).not.toHaveBeenCalled();
      resolve(fresh); await first; await repeated;
      expect(click).toHaveBeenCalledTimes(1);
      const csv = await blob!.text();
      expect(csv).toContain('120,00'); expect(csv).toContain('Fresh category;20,00');
      expect(csv).not.toContain('999,00'); expect(csv).not.toContain('Cached category');
    } finally { vi.runOnlyPendingTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); }
  });
  it('does not create a CSV download when the fresh authoritative summary rejects a guarded adjustment', async () => {
    state.summary = fresh;
    state.reloadSummary.mockRejectedValue(new Error('409: Zahlungszuordnung fachlich prüfen.'));
    const onExport = exportHandler(), createObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL });
    try { await onExport(); expect(state.reloadSummary).toHaveBeenCalledTimes(1); expect(createObjectURL).not.toHaveBeenCalled(); }
    finally { vi.unstubAllGlobals(); }
  });
  it.each(['fetching', 'failed'])('does not render cached fiscal totals or export actions while summary is %s', mode => {
    state.summary = fresh; state.summaryFetching = mode === 'fetching'; state.summaryFailed = mode === 'failed';
    const reports = findElements(DashboardContent(), element => typeof element.props.onExport === 'function' && 'totalIncome' in element.props);
    expect(reports).toHaveLength(0);
  });
});

describe('report period arrows (#26)', () => {
  it.each(['eur', 'gwg'])('disables unsupported navigation in every %s period', tab => {
    state.tab = tab;
    for (const period of ['last3Months', 'last6Months', 'all', 'lastYear', 'thisYear']) {
      state.timeRange = period;
      const tree = DashboardContent();
      const previous = findElements(tree, element => element.props['aria-label'] === 'Vorheriges Jahr anzeigen')[0];
      const next = findElements(tree, element => element.props['aria-label'] === 'Nächstes Jahr anzeigen')[0];
      expect(previous.props.disabled, `${period}: previous`).toBe(period !== 'thisYear');
      expect(next.props.disabled, `${period}: next`).toBe(period !== 'lastYear');
    }
  });

  it('preserves previous-year and current-year transitions', () => {
    const previous = findElements(DashboardContent(), element => element.props['aria-label'] === 'Vorheriges Jahr anzeigen')[0];
    (previous.props.onClick as () => void)();
    expect(state.setTimeRange).toHaveBeenCalledWith('lastYear');
    state.timeRange = 'lastYear';
    const next = findElements(DashboardContent(), element => element.props['aria-label'] === 'Nächstes Jahr anzeigen')[0];
    (next.props.onClick as () => void)();
    expect(state.setTimeRange).toHaveBeenCalledWith('thisYear');
  });

  it('wires normalized income deep links to the entry-action hook', () => {
    state.tab = 'income';
    DashboardContent();
    expect(state.createAction).toHaveBeenCalledWith(expect.objectContaining({ requestedTab: 'incomes', activeTab: 'incomes' }));
  });
});

function quoteTree(quote: Quote) {
  return QuotesTab({
    quotes: [quote], total: 1, page: 1, pageSize: 20, totalPages: 1, statusFilter: 'all', searchTerm: '',
    onPageChange: vi.fn(), onPageSizeChange: vi.fn(), onStatusFilterChange: vi.fn(), onSearchChange: vi.fn(),
    onOpenCreateModal: vi.fn(), onStatusChange: vi.fn(), onConvertToInvoice: vi.fn(), onDelete: vi.fn(), loadQuotes: vi.fn(),
  });
}
function conversionActions(quote: Quote) {
  return findElements(quoteTree(quote), element => element.props.children === 'In Rechnung'
    || element.props['aria-label'] === 'Angebot AN-2026-01 in Rechnung umwandeln');
}
const quoteFixture: Quote = { id: 1, invoiceNumber: 'AN-2026-01', fileName: 'quote.pdf', uploadedAt: '2026-10-20', status: 'ACCEPTED' };

describe('quote conversion actions (#23)', () => {
  it.each(['DRAFT', 'SENT', 'ACCEPTED'])('permits unconverted %s quotes on mobile and desktop', status => {
    expect(conversionActions({ ...quoteFixture, status, convertedInvoice: null })).toHaveLength(2);
  });

  it.each(['DRAFT', 'SENT', 'ACCEPTED'])('hides actual converted %s quotes even if status changes', status => {
    expect(conversionActions({ ...quoteFixture, status, convertedInvoice: { id: 42 } })).toHaveLength(0);
  });

  it.each(['REJECTED', 'EXPIRED', 'CANCELLED'])('does not offer conversion for %s quotes', status => {
    expect(conversionActions({ ...quoteFixture, status })).toHaveLength(0);
  });
});

describe('quote source-linked result and response gates', () => {
  it('offers the real linked invoice history independently of the manual quote response', () => {
    const links = findElements(quoteTree({ ...quoteFixture, status: 'DRAFT', convertedInvoice: { id: 42 } }), element => element.props.href === '/history?invoiceId=42');
    expect(links).toHaveLength(2);
  });
  it('keeps the explicit response path but does not offer a new conversion for an elapsed sent offer', () => {
    const quote = { ...quoteFixture, status: 'SENT', validUntil: '2000-01-01' };
    expect(conversionActions(quote)).toHaveLength(0);
    expect(findElements(quoteTree(quote), element => element.props.children === 'Rückmeldung & Nachfassen')).toHaveLength(2);
  });
});
