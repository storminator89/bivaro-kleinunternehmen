import { recordSearchPages, type RecordSearchPages, type RecordSearchResult } from './contract';

export type RecordSearchState = { query: string; pages: RecordSearchPages; status: 'loading' | 'ready' | 'error' | 'expired'; result?: RecordSearchResult };

/** Cancellation remains authoritative even if a transport resolves after abort. */
export function startRecordSearch(query: string, publish: (state: RecordSearchState) => void, fetcher: typeof fetch = fetch, requestedPages?: RecordSearchPages) {
  // Snapshot primitives: a caller cannot mutate an in-flight request's identity.
  const pages = recordSearchPages(requestedPages);
  const controller = new AbortController();
  const done = (async () => {
    try {
      const response = await fetcher('/api/record-search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, pages }),
        cache: 'no-store', signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        publish({ query, pages, status: response.status === 401 ? 'expired' : 'error' });
        return;
      }
      const result: RecordSearchResult = await response.json();
      if (!controller.signal.aborted) publish({ query, pages, status: 'ready', result });
    } catch {
      if (!controller.signal.aborted) publish({ query, pages, status: 'error' });
    }
  })();
  return { cancel: () => controller.abort(), done };
}
