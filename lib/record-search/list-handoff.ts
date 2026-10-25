import { recordSearchQuery, RECORD_SEARCH_MIN_LENGTH, type RecordSearchType } from './contract';

/** Only these existing list workspaces may consume an in-memory palette term. */
export function recordListScope(type: RecordSearchType, location: string): boolean {
  const url = new URL(location, 'https://bivaro.invalid');
  if (type === 'customer') return url.pathname === '/customers' && !url.searchParams.has('customer');
  if (type === 'outbound') return url.pathname === '/dashboard' && url.searchParams.get('tab') === 'invoices' && !url.searchParams.has('document');
  return url.pathname === '/purchases';
}

export function recordListTerm(value: unknown): string {
  const term = recordSearchQuery(value);
  if (term.length < RECORD_SEARCH_MIN_LENGTH) throw new Error('INVALID_QUERY');
  return term;
}

/** Privacy-safe read transport: neither the term nor pagination enters a URL. */
export class RecordListReadError extends Error {
  constructor(readonly status: number) {
    super(status === 401 ? 'Sitzung abgelaufen. Bitte erneut anmelden.' : 'Suchtreffer konnten nicht geladen werden. Bitte erneut versuchen.');
  }
}

export async function fetchRecordList<T>(type: RecordSearchType, query: string, options: Record<string, string | number> = {}, signal?: AbortSignal): Promise<T> {
  const path = type === 'customer' ? 'customers' : type === 'outbound' ? 'invoices' : 'purchase-documents';
  try {
    const response = await fetch(`/api/${path}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(type === 'outbound' ? { 'X-Bivaro-Payment-Contract': '3' } : {}) },
      body: JSON.stringify({ ...options, query: recordListTerm(query) }),
      cache: 'no-store', signal,
    });
    if (!response.ok) throw new RecordListReadError(response.status);
    return await response.json();
  } catch (error) {
    // JSON/network exceptions can contain body excerpts. Never display or log
    // them, even when an intermediary returned something other than our API.
    throw error instanceof RecordListReadError ? error : new RecordListReadError(0);
  }
}
