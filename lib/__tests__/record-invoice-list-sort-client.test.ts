import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import type { FilterState } from '@/types/dashboard';

const state = vi.hoisted(() => ({ query: null as null | { queryKey: unknown[]; queryFn: (context: { signal: AbortSignal }) => Promise<unknown> } }));
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: typeof state.query) => { state.query = options; return {}; } }));
vi.mock('@/components/record-search/record-list-search-provider', () => ({ useRecordListSearch: () => ({ revision: 7, query: 'SYNTHETIC-PALETTE-TERM' }) }));
import { useRecordInvoiceList } from '@/hooks/use-record-invoice-list';

afterEach(() => { vi.unstubAllGlobals(); state.query = null; });

it('posts only explicit sort fields from the wider dashboard filters and keeps the palette term out of cache keys/URLs', async () => {
  const filters: FilterState['invoices'] = { searchTerm: 'SYNTHETIC-HIDDEN-SEARCH', paidStatus: 'paid', dateRange: 'thisYear', sortBy: 'amount', sortOrder: 'asc' };
  function Capture() { useRecordInvoiceList(true, 10, filters); return null; }
  renderToStaticMarkup(createElement(Capture));
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ items: [], total: 0, page: 1, pageSize: 10 }));
  vi.stubGlobal('fetch', fetcher);
  const signal = new AbortController().signal;
  await state.query!.queryFn({ signal });
  expect(fetcher.mock.calls[0][0]).toBe('/api/invoices/search');
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', cache: 'no-store', signal });
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({ page: 1, pageSize: 10, sortBy: 'amount', sortOrder: 'asc', query: 'SYNTHETIC-PALETTE-TERM' });
  expect(JSON.stringify(state.query!.queryKey)).not.toMatch(/SYNTHETIC|paid|thisYear|searchTerm/);
  expect(state.query!.queryKey).toContain('amount');
  expect(state.query!.queryKey).toContain('asc');
});
