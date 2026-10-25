export const RECORD_SEARCH_MIN_LENGTH = 3;
export const RECORD_SEARCH_MAX_LENGTH = 100;
export const RECORD_SEARCH_LIMIT = 5;
// Bound both SQL offsets and in-memory navigation; refine the term beyond this.
export const RECORD_SEARCH_MAX_PAGE = 19;
export type RecordSearchType = 'customer' | 'outbound' | 'inbound';
export type RecordSearchPages = Record<RecordSearchType, number>;
export type RecordSearchItem = { type: RecordSearchType; id: number; label: string; href: string };
export type RecordSearchGroup = { type: RecordSearchType; page: number; items: RecordSearchItem[]; hasMore: boolean };
export type RecordSearchResult = { groups: RecordSearchGroup[] };

export function recordSearchPages(value: unknown = undefined): RecordSearchPages {
  const pages: RecordSearchPages = { customer: 0, outbound: 0, inbound: 0 };
  if (value === undefined) return pages;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_PAGES');
  for (const [type, page] of Object.entries(value)) {
    if (!Object.hasOwn(pages, type) || !Number.isInteger(page) || (page as number) < 0 || (page as number) > RECORD_SEARCH_MAX_PAGE) throw new Error('INVALID_PAGES');
    pages[type as RecordSearchType] = page as number;
  }
  return pages;
}

export function sameRecordSearchPages(left: RecordSearchPages, right: RecordSearchPages): boolean {
  return left.customer === right.customer && left.outbound === right.outbound && left.inbound === right.inbound;
}

export function recordSearchQuery(value: unknown): string {
  if (typeof value !== 'string' || value.length > RECORD_SEARCH_MAX_LENGTH) throw new Error('INVALID_QUERY');
  return value.trim();
}

export const RECORD_SEARCH_GROUPS = {
  customer: { title: 'Kunden', href: '/customers', icon: 'nav-customers' },
  outbound: { title: 'Ausgangsbelege', href: '/dashboard?tab=invoices', icon: 'nav-invoices' },
  inbound: { title: 'Eingangsbelege', href: '/purchases?reviewStatus=ALL', icon: 'nav-expenses' },
} as const;
