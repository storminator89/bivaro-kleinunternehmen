import { describe, expect, it, vi } from 'vitest';
import { startRecordSearch } from '@/lib/record-search/client';
import { recordSearchPages } from '@/lib/record-search/contract';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
const result = { groups: [{ type: 'customer', page: 0, hasMore: false, items: [{ type: 'customer', id: 1, label: 'Synthetic', href: '/customers?customer=1' }] }] };

describe('disposable record search request', () => {
  it('posts a bounded page snapshot and suppresses a stale page of the same query', async () => {
    const pending = deferred<Response>(); const publish = vi.fn();
    const oldFetch = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
    const pages = { customer: 1, outbound: 0, inbound: 0 };
    const old = startRecordSearch('same', publish, oldFetch, pages);
    pages.customer = 2;
    expect(JSON.parse(oldFetch.mock.calls[0][1]!.body as string)).toEqual({ query: 'same', pages: { customer: 1, outbound: 0, inbound: 0 } });
    old.cancel();
    await startRecordSearch('same', publish, vi.fn<typeof fetch>().mockResolvedValue(Response.json(result)), recordSearchPages()).done;
    pending.resolve(Response.json(result)); await old.done;
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0].pages).toEqual(recordSearchPages());
  });
  it('retries exactly the requested page without putting pagination or terms in the URL', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('private')).mockResolvedValue(Response.json(result));
    const publish = vi.fn(); const pages = { customer: 1, outbound: 2, inbound: 3 };
    await startRecordSearch('same', publish, fetcher, pages).done;
    await startRecordSearch('same', publish, fetcher, pages).done;
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/record-search', '/api/record-search']);
    expect(fetcher.mock.calls[0][1]?.body).toEqual(fetcher.mock.calls[1][1]?.body);
    expect(publish.mock.calls.map(call => call[0].status)).toEqual(['error', 'ready']);
  });
  it('posts terms only in a no-store body and never in a URL', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result)); const publish = vi.fn();
    await startRecordSearch('SYNTHETIC-TERM', publish, fetcher).done;
    expect(fetcher.mock.calls[0][0]).toBe('/api/record-search');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', cache: 'no-store', body: JSON.stringify({ query: 'SYNTHETIC-TERM', pages: recordSearchPages() }) });
    expect(publish).toHaveBeenCalledWith({ query: 'SYNTHETIC-TERM', pages: recordSearchPages(), status: 'ready', result });
  });
  it('aborts old transports and suppresses a late response after a newer request/account/navigation/disposal', async () => {
    const pending = deferred<Response>(); const publish = vi.fn();
    const oldFetch = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
    const old = startRecordSearch('old', publish, oldFetch); old.cancel();
    await startRecordSearch('new', publish, vi.fn<typeof fetch>().mockResolvedValue(Response.json(result))).done;
    pending.resolve(Response.json({ groups: [] })); await old.done;
    expect((oldFetch.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1); expect(publish.mock.calls[0][0].query).toBe('new');
  });
  it('suppresses a response whose JSON parsing completes after cancellation', async () => {
    const json = deferred<unknown>(); const publish = vi.fn();
    const response = { ok: true, json: () => json.promise } as Response;
    const task = startRecordSearch('old', publish, vi.fn<typeof fetch>().mockResolvedValue(response));
    await Promise.resolve(); task.cancel(); json.resolve(result); await task.done;
    expect(publish).not.toHaveBeenCalled();
  });
  it.each([401, 403, 429, 500])('has a clear safe status for HTTP %s', async status => {
    const publish = vi.fn(); await startRecordSearch('term', publish, vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }))).done;
    expect(publish).toHaveBeenCalledWith({ query: 'term', pages: recordSearchPages(), status: status === 401 ? 'expired' : 'error' });
  });
  it('handles network and invalid-JSON errors without logging or publishing aborted work', async () => {
    for (const fetcher of [vi.fn<typeof fetch>().mockRejectedValue(new Error('private')), vi.fn<typeof fetch>().mockResolvedValue(new Response('bad-json'))]) {
      const publish = vi.fn(); await startRecordSearch('term', publish, fetcher).done;
      expect(publish).toHaveBeenCalledWith({ query: 'term', pages: recordSearchPages(), status: 'error' });
    }
    const publish = vi.fn(); const task = startRecordSearch('term', publish, vi.fn<typeof fetch>().mockRejectedValue(new Error('abort'))); task.cancel(); await task.done; expect(publish).not.toHaveBeenCalled();
  });
});
