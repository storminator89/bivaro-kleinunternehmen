import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fetchRecordList, recordListScope, recordListTerm } from '@/lib/record-search/list-handoff';

afterEach(() => vi.unstubAllGlobals());
describe('ephemeral list handoff contract', () => {
  it('keeps the extra notice above both columns of the existing wide invoice grid', () => {
    const notice = readFileSync('components/record-search/record-list-search-notice.tsx', 'utf8');
    expect(notice).toContain('className="col-span-full ');
  });
  it('consumes a term only in the matching supported list, not an ID detail or unrelated route', () => {
    expect(recordListScope('customer', '/customers')).toBe(true);
    expect(recordListScope('customer', '/customers?customer=2')).toBe(false);
    expect(recordListScope('customer', '/customers/import')).toBe(false);
    expect(recordListScope('outbound', '/dashboard?tab=invoices')).toBe(true);
    expect(recordListScope('outbound', '/dashboard?tab=invoices&document=2')).toBe(false);
    expect(recordListScope('outbound', '/dashboard?tab=quotes')).toBe(false);
    expect(recordListScope('inbound', '/purchases?reviewStatus=ALL&page=2&document=3')).toBe(true);
    expect(recordListScope('inbound', '/dashboard?tab=expenses')).toBe(false);
  });
  it('preserves literal Unicode and bounds the selected term', () => {
    expect(recordListTerm('  東京 %_\\  ')).toBe('東京 %_\\');
    for (const query of [null, 1, '', 'ab', 'x'.repeat(101)]) expect(() => recordListTerm(query)).toThrow();
  });
  it.each([
    ['customer', '/api/customers/search'], ['outbound', '/api/invoices/search'], ['inbound', '/api/purchase-documents/search'],
  ] as const)('uses only an abortable no-store POST body for %s', async (type, path) => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [] })); vi.stubGlobal('fetch', fetcher);
    await fetchRecordList(type, 'SYN-東京 %_\\', { page: 2 }, controller.signal);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(path, expect.objectContaining({ method: 'POST', cache: 'no-store', signal: controller.signal }));
    const options = fetcher.mock.calls[0][1];
    expect(JSON.parse(options.body)).toEqual({ query: 'SYN-東京 %_\\', page: 2 });
    expect(options.headers).toEqual(expect.objectContaining({ 'Content-Type': 'application/json' }));
    if (type === 'outbound') expect(options.headers['X-Bivaro-Payment-Contract']).toBe('3');
  });
  it.each([401, 403, 500])('does not expose private response bodies for HTTP %s', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'PRIVATE-SEARCH-TERM' }, { status })));
    await expect(fetchRecordList('customer', 'Synthetic')).rejects.toThrow(status === 401 ? 'Sitzung abgelaufen' : 'Suchtreffer konnten nicht geladen');
  });
  it('never exposes JSON parser excerpts or private transport exception text', async () => {
    for (const fetcher of [vi.fn().mockResolvedValue(new Response('PRIVATE-RAW-EXCEPTION')), vi.fn().mockRejectedValue(new Error('PRIVATE-RAW-EXCEPTION'))]) {
      vi.stubGlobal('fetch', fetcher);
      await expect(fetchRecordList('customer', 'Synthetic')).rejects.toThrow(/^Suchtreffer konnten nicht geladen werden\. Bitte erneut versuchen\.$/);
    }
  });
});
