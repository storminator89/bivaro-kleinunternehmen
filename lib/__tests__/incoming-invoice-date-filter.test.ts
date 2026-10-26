import { describe, expect, it } from 'vitest';
import { EMPTY_INVOICE_DATE_FILTER, incomingInvoiceDateBounds, incomingInvoiceDateFilterFromParams, parseIncomingInvoiceDateFilter } from '@/lib/purchase-documents/invoice-date-filter';
import { purchaseListSearchInput } from '@/lib/record-search/list-contract';
import { createIncomingListQueryIntents } from '@/components/purchases/incoming-list-query-intents';
import { createReviewNavigationIntents } from '@/components/purchases/incoming-review-history';

describe('incoming source invoice-date filters (pure calendar contracts)', () => {
  it('defaults to no restriction, keeping unknown dates included', () => {
    expect(parseIncomingInvoiceDateFilter({})).toEqual(EMPTY_INVOICE_DATE_FILTER);
    expect(incomingInvoiceDateBounds(EMPTY_INVOICE_DATE_FILTER)).toEqual({});
  });
  it.each(['0001-01-01', '0099-12-31', '2024-02-29', '2026-12-31', '9999-12-31'])('keeps exact calendar day %s without a timezone rollover', day => {
    const filter = parseIncomingInvoiceDateFilter({ invoiceDateFrom: day, invoiceDateTo: day });
    const bounds = incomingInvoiceDateBounds(filter);
    expect(bounds.gte?.toISOString()).toBe(`${day}T00:00:00.000Z`);
    expect(bounds.lte?.toISOString()).toBe(`${day}T23:59:59.999Z`);
  });
  it.each(['2026-02-29', '2024-02-30', '2026-04-31', '0000-01-01', '10000-01-01', '2026-1-01', ' 2026-01-01', '2026-01-01T00:00:00Z', "2026-01-01' OR 1=1", null, 20260101, [], {}])('rejects invalid or unbounded source date %j', value => {
    expect(() => parseIncomingInvoiceDateFilter({ invoiceDateFrom: value })).toThrow();
    expect(() => parseIncomingInvoiceDateFilter({ invoiceDateTo: value })).toThrow();
  });
  it('accepts each open endpoint, but rejects reversed ranges and contradictory missing-date filters', () => {
    expect(incomingInvoiceDateBounds(parseIncomingInvoiceDateFilter({ invoiceDateFrom: '2026-01-01' })).lte).toBeUndefined();
    expect(incomingInvoiceDateBounds(parseIncomingInvoiceDateFilter({ invoiceDateTo: '2026-12-31' })).gte).toBeUndefined();
    expect(parseIncomingInvoiceDateFilter({ invoiceDateMissing: 'only' })).toEqual({ ...EMPTY_INVOICE_DATE_FILTER, invoiceDateMissing: 'only' });
    expect(() => parseIncomingInvoiceDateFilter({ invoiceDateFrom: '2026-02-01', invoiceDateTo: '2026-01-31' })).toThrow(/Von-Datum/);
    for (const invoiceDateMissing of [null, '', true, [], 'include', 'ONLY']) expect(() => parseIncomingInvoiceDateFilter({ invoiceDateMissing })).toThrow();
    for (const key of ['invoiceDateFrom', 'invoiceDateTo']) expect(() => parseIncomingInvoiceDateFilter({ invoiceDateMissing: 'only', [key]: '2026-01-01' })).toThrow(/kein Datumsbereich/);
  });
  it('rejects repeated URL date selectors instead of choosing an ambiguous value', () => {
    for (const [key, value] of [['invoiceDateFrom', '2026-01-01'], ['invoiceDateTo', '2026-12-31'], ['invoiceDateMissing', 'only']]) {
      const params = new URLSearchParams(); params.append(key, value); params.append(key, value);
      expect(() => incomingInvoiceDateFilterFromParams(params)).toThrow(/nur einmal/);
    }
  });
  it('uses exactly the same date contract for the body-only palette continuation', () => {
    const dates = { invoiceDateFrom: '2026-01-01', invoiceDateTo: '2026-12-31', invoiceDateMissing: 'any' };
    expect(purchaseListSearchInput({ query: 'PRIVATE-TERM', ...dates })).toMatchObject(dates);
    expect(purchaseListSearchInput({ query: 'PRIVATE-TERM', invoiceDateMissing: 'only' })).toMatchObject({ invoiceDateMissing: 'only' });
    expect(() => purchaseListSearchInput({ query: 'PRIVATE-TERM', ...dates, invoiceDateTo: '2026-02-30' })).toThrow();
    expect(() => purchaseListSearchInput({ query: 'PRIVATE-TERM', ...dates, invoiceDateMissing: 'only' })).toThrow();
    expect(() => purchaseListSearchInput({ query: 'PRIVATE-TERM', ...dates, userId: 'foreign-owner' })).toThrow();
  });
  it('preserves dates through detail open/close and clears only dates on explicit reset', () => {
    const query = createIncomingListQueryIntents();
    const base = 'https://bivaro.invalid/purchases?reviewStatus=ALL&taskKind=CLARIFY&search=invoice&page=3';
    const dates = { invoiceDateFrom: '2026-01-01', invoiceDateTo: '2026-12-31', page: null, document: null };
    const applied = query.compose(base, '/purchases', dates)!;
    expect(query.compose(base, '/purchases', { document: '17' })).toBe(`${applied}&document=17`);
    expect(query.compose(base, '/purchases', { document: null })).toBe(applied);
    const reset = query.compose(base, '/purchases', { invoiceDateFrom: null, invoiceDateTo: null, invoiceDateMissing: null, page: null })!;
    expect(reset).toBe('/purchases?reviewStatus=ALL&taskKind=CLARIFY&search=invoice');
  });
  it('never commits a cancelled/superseded filter intent or an intent from an older session/location', () => {
    const base = 'https://bivaro.invalid/purchases?document=17'; let current = true, location = base;
    const apply = () => query.compose(location, '/purchases', { invoiceDateFrom: '2026-01-01', document: null, page: null });
    const query = createIncomingListQueryIntents(), intents = createReviewNavigationIntents(() => location, () => current);
    const cancelled = intents.prepare(apply); cancelled.stay(); cancelled.proceed();
    const superseded = intents.prepare(apply); intents.prepare(() => {}).stay(); superseded.proceed();
    const moved = intents.prepare(apply); location = 'https://bivaro.invalid/customers'; moved.proceed();
    location = base; const signedOut = intents.prepare(apply); current = false; signedOut.proceed();
    expect(query.compose(base, '/purchases', { page: '2' })).toBe('/purchases?document=17&page=2');
  });
});
