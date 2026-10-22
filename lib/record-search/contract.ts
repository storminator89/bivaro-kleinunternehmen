export const RECORD_SEARCH_MIN_LENGTH = 3;
export const RECORD_SEARCH_MAX_LENGTH = 100;
export const RECORD_SEARCH_LIMIT = 5;
export type RecordSearchType = 'customer' | 'outbound' | 'inbound';
export type RecordSearchItem = { type: RecordSearchType; id: number; label: string; href: string };
export type RecordSearchGroup = { type: RecordSearchType; items: RecordSearchItem[]; hasMore: boolean };
export type RecordSearchResult = { groups: RecordSearchGroup[] };

export function recordSearchQuery(value: unknown): string {
  if (typeof value !== 'string' || value.length > RECORD_SEARCH_MAX_LENGTH) throw new Error('INVALID_QUERY');
  return value.trim();
}

export const RECORD_SEARCH_GROUPS = {
  customer: { title: 'Kunden', href: '/customers', icon: 'nav-customers' },
  outbound: { title: 'Ausgangsbelege', href: '/dashboard?tab=invoices', icon: 'nav-invoices' },
  inbound: { title: 'Eingangsbelege', href: '/purchases?reviewStatus=ALL', icon: 'nav-expenses' },
} as const;
