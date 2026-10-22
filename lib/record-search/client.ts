import type { RecordSearchResult } from './contract';

export type RecordSearchState = { query: string; status: 'loading' | 'ready' | 'error' | 'expired'; result?: RecordSearchResult };

/** Cancellation remains authoritative even if a transport resolves after abort. */
export function startRecordSearch(query: string, publish: (state: RecordSearchState) => void, fetcher: typeof fetch = fetch) {
  const controller = new AbortController();
  const done = (async () => {
    try {
      const response = await fetcher('/api/record-search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
        cache: 'no-store', signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        publish({ query, status: response.status === 401 ? 'expired' : 'error' });
        return;
      }
      const result: RecordSearchResult = await response.json();
      if (!controller.signal.aborted) publish({ query, status: 'ready', result });
    } catch {
      if (!controller.signal.aborted) publish({ query, status: 'error' });
    }
  })();
  return { cancel: () => controller.abort(), done };
}
