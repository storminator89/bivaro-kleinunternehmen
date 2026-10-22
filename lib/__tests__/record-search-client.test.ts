import { describe, expect, it, vi } from 'vitest';
import { startRecordSearch } from '@/lib/record-search/client';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
const result = { groups: [{ type: 'customer', hasMore: false, items: [{ type: 'customer', id: 1, label: 'Synthetic', href: '/customers?customer=1' }] }] };

describe('disposable record search request', () => {
  it('posts terms only in a no-store body and never in a URL', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result)); const publish = vi.fn();
    await startRecordSearch('SYNTHETIC-TERM', publish, fetcher).done;
    expect(fetcher.mock.calls[0][0]).toBe('/api/record-search');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', cache: 'no-store', body: '{"query":"SYNTHETIC-TERM"}' });
    expect(publish).toHaveBeenCalledWith({ query: 'SYNTHETIC-TERM', status: 'ready', result });
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
    expect(publish).toHaveBeenCalledWith({ query: 'term', status: status === 401 ? 'expired' : 'error' });
  });
  it('handles network and invalid-JSON errors without logging or publishing aborted work', async () => {
    for (const fetcher of [vi.fn<typeof fetch>().mockRejectedValue(new Error('private')), vi.fn<typeof fetch>().mockResolvedValue(new Response('bad-json'))]) {
      const publish = vi.fn(); await startRecordSearch('term', publish, fetcher).done;
      expect(publish).toHaveBeenCalledWith({ query: 'term', status: 'error' });
    }
    const publish = vi.fn(); const task = startRecordSearch('term', publish, vi.fn<typeof fetch>().mockRejectedValue(new Error('abort'))); task.cancel(); await task.done; expect(publish).not.toHaveBeenCalled();
  });
});
