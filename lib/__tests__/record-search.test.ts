import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, userId: 'record-owner', authenticated: true }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return { requireUserId: async () => { if (!state.authenticated) throw new UnauthorizedError(); return state.userId; }, UnauthorizedError };
});
import { searchOwnedRecords } from '@/lib/record-search/service';
import { POST } from '@/app/api/record-search/route';
import { RECORD_SEARCH_MAX_PAGE, recordSearchPages, recordSearchQuery, sameRecordSearchPages } from '@/lib/record-search/contract';
let db: ReturnType<typeof createTestDatabase>;
let sequence = 0;
async function tenant() {
  const id = `record-${++sequence}`;
  await db.client.user.create({ data: { id, email: `${id}@synthetic.invalid`, password: 'unused' } });
  return id;
}
async function receipt(userId: string, invoiceNumber: string | null, originalFileName = 'synthetic.png') {
  return db.client.purchaseDocument.create({ data: { userId, invoiceNumber, originalFileName, storedFileName: 'private.png', originalSha256: `${++sequence}`.padStart(64, '0'), originalByteCount: 12, mediaType: 'image/png', uploadRequestId: `synthetic-${sequence}`, reviewDraftSearch: 'SECRET-NOTE-ONLY', parsedData: { secret: 'PRIVATE-PARSED-CONTENT' } } });
}
async function invoice(userId: string, invoiceNumber: string, type = 'INVOICE', customerId?: number) {
  return db.client.invoice.create({ data: { userId, invoiceNumber, type, fileName: 'NOT-SEARCHED-OUTBOUND.pdf', storedFileName: 'private.pdf', parsedData: { private: 'SECRET-NOTE-ONLY' }, customerId } });
}
function request(query: unknown, headers: Record<string, string> = {}, pages?: unknown) {
  return new Request('http://localhost/api/record-search', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ query, pages }) });
}
beforeAll(async () => { db = createTestDatabase(); state.client = db.client; }, 40_000);
afterAll(async () => { await db?.cleanup(); });

describe('bounded owned record search', () => {
  it('accepts only known, finite integer pages with a bounded SQL offset', () => {
    expect(recordSearchPages()).toEqual({ customer: 0, outbound: 0, inbound: 0 });
    expect(recordSearchPages({ customer: RECORD_SEARCH_MAX_PAGE })).toEqual({ customer: RECORD_SEARCH_MAX_PAGE, outbound: 0, inbound: 0 });
    expect(sameRecordSearchPages(recordSearchPages(), recordSearchPages({ inbound: 1 }))).toBe(false);
    for (const value of [null, [], '1', { customer: -1 }, { customer: 0.5 }, { customer: '1' }, { customer: NaN }, { customer: Infinity }, { customer: RECORD_SEARCH_MAX_PAGE + 1 }, { foreign: 0 }, JSON.parse('{"__proto__":1}')]) expect(() => recordSearchPages(value)).toThrow('INVALID_PAGES');
  });
  it('continues each type independently to the sixth result and returns on back without accumulating rows', async () => {
    const owner = await tenant(), foreign = await tenant();
    for (let i = 0; i < 12; i++) {
      await db.client.customer.create({ data: { userId: owner, name: `SYN-PAGES ${String(i).padStart(2, '0')}` } });
      await invoice(owner, `SYN-PAGES-${i}`); await receipt(owner, `SYN-PAGES-${i}`);
      await db.client.customer.create({ data: { userId: foreign, name: `SYN-PAGES ${String(i).padStart(2, '0')} FOREIGN` } });
      await invoice(foreign, `SYN-PAGES-${i}`); await receipt(foreign, `SYN-PAGES-${i}`);
    }
    const first = await searchOwnedRecords(owner, 'SYN-PAGES');
    const customerPage = await searchOwnedRecords(owner, 'SYN-PAGES', recordSearchPages({ customer: 1 }));
    expect(customerPage.groups.map(group => group.page)).toEqual([1, 0, 0]);
    expect(customerPage.groups[0].items.map(item => item.label)).toEqual([5, 6, 7, 8, 9].map(i => `SYN-PAGES ${String(i).padStart(2, '0')}`));
    expect(customerPage.groups.slice(1)).toEqual(first.groups.slice(1));
    const second = await searchOwnedRecords(owner, 'SYN-PAGES', recordSearchPages({ customer: 1, outbound: 1, inbound: 1 }));
    for (let type = 0; type < 3; type++) {
      expect(second.groups[type].items).toHaveLength(5);
      expect(second.groups[type].hasMore).toBe(true);
      expect(second.groups[type].items.some(item => first.groups[type].items.some(old => old.id === item.id))).toBe(false);
      const foreignIds = (await searchOwnedRecords(foreign, 'SYN-PAGES', recordSearchPages({ customer: 1, outbound: 1, inbound: 1 }))).groups[type].items.map(item => item.id);
      expect(second.groups[type].items.some(item => foreignIds.includes(item.id))).toBe(false);
    }
    const third = await searchOwnedRecords(owner, 'SYN-PAGES', recordSearchPages({ customer: 2, outbound: 2, inbound: 2 }));
    expect(third.groups.map(group => [group.items.length, group.hasMore])).toEqual([[2, false], [2, false], [2, false]]);
    expect(await searchOwnedRecords(owner, 'SYN-PAGES')).toEqual(first);
    expect((await searchOwnedRecords(owner, 'SYN-PAGES', recordSearchPages({ customer: RECORD_SEARCH_MAX_PAGE }))).groups[0]).toMatchObject({ page: RECORD_SEARCH_MAX_PAGE, items: [], hasMore: false });
  });
  it('rechecks ownership and current data on every page; deleted later pages stay navigable rather than implying completeness', async () => {
    const owner = await tenant();
    for (let i = 0; i < 6; i++) await db.client.customer.create({ data: { userId: owner, name: `SYN-CHANGING ${i}` } });
    expect((await searchOwnedRecords(owner, 'SYN-CHANGING')).groups[0].hasMore).toBe(true);
    await db.client.customer.deleteMany({ where: { userId: owner } });
    const later = await searchOwnedRecords(owner, 'SYN-CHANGING', recordSearchPages({ customer: 1 }));
    expect(later.groups[0]).toEqual({ type: 'customer', page: 1, hasMore: false, items: [] });
    expect(JSON.stringify(later)).not.toMatch(/total|complete|count/);
  });
  it('keeps hasMore truthful at the finite navigation cap instead of claiming all matches', async () => {
    const owner = await tenant();
    await db.client.customer.createMany({ data: Array.from({ length: 101 }, (_, index) => ({ userId: owner, name: `SYN-CAP ${String(index).padStart(3, '0')}` })) });
    const last = await searchOwnedRecords(owner, 'SYN-CAP', recordSearchPages({ customer: RECORD_SEARCH_MAX_PAGE }));
    expect(last.groups[0]).toMatchObject({ page: 19, hasMore: true });
    expect(last.groups[0].items.map(item => item.label)).toEqual([95, 96, 97, 98, 99].map(index => `SYN-CAP ${String(index).padStart(3, '0')}`));
  });
  it('does not query data for empty/short values and rejects oversized/non-string terms', async () => {
    const spy = vi.spyOn(db.client, '$transaction');
    for (const term of ['', '  ', 'a', 'ab']) expect(await searchOwnedRecords('unused', term)).toEqual({ groups: [] });
    expect(spy).not.toHaveBeenCalled(); spy.mockRestore();
    for (const term of [null, 123, {}, 'x'.repeat(101)]) expect(() => recordSearchQuery(term)).toThrow('INVALID_QUERY');
  });
  it('returns at most 5/type, stable ordering and truthful truncation with minimal bounded fields', async () => {
    const owner = await tenant();
    for (let i = 0; i < 7; i++) {
      await db.client.customer.create({ data: { userId: owner, name: `SYN-BOUNDED ${i}`, email: 'PRIVATE@synthetic.invalid', internalNote: 'PRIVATE-NOTE' } });
      await invoice(owner, `SYN-BOUNDED-${i}`); await receipt(owner, `SYN-BOUNDED-${i}`);
    }
    const result = await searchOwnedRecords(owner, 'syn-bounded');
    expect(result.groups.map(group => [group.items.length, group.hasMore])).toEqual([[5, true], [5, true], [5, true]]);
    expect(result.groups[0].items.map(item => item.label)).toEqual([0, 1, 2, 3, 4].map(i => `SYN-BOUNDED ${i}`));
    expect(await searchOwnedRecords(owner, 'syn-bounded')).toEqual(result);
    for (const group of result.groups) for (const item of group.items) expect(Object.keys(item).sort()).toEqual(['href', 'id', 'label', 'type']);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|storedFileName|parsedData|userId/);
  });
  it('keeps identical numbers/names tenant-owned and does not join a cross-tenant customer', async () => {
    const owner = await tenant(), foreign = await tenant();
    const customer = await db.client.customer.create({ data: { userId: foreign, name: 'FOREIGN-SECRET-CUSTOMER' } });
    const ownCustomer = await db.client.customer.create({ data: { userId: owner, name: 'SAME-NAME' } });
    await db.client.customer.create({ data: { userId: foreign, name: 'SAME-NAME' } });
    const own = await invoice(owner, 'SAME-NUMBER', 'INVOICE', customer.id); const foreignInvoice = await invoice(foreign, 'SAME-NUMBER');
    const ownReceipt = await receipt(owner, 'SAME-NUMBER'); const foreignReceipt = await receipt(foreign, 'SAME-NUMBER');
    const result = await searchOwnedRecords(owner, 'same');
    expect(result.groups.map(group => group.items.map(item => item.id))).toEqual([[ownCustomer.id], [own.id], [ownReceipt.id]]);
    expect(JSON.stringify(result)).not.toContain('FOREIGN-SECRET');
    expect(result.groups[1].items[0].id).not.toBe(foreignInvoice.id); expect(result.groups[2].items[0].id).not.toBe(foreignReceipt.id);
  });
  it('matches literal wildcard/SQL punctuation and Unicode without fuzzy inference', async () => {
    const owner = await tenant();
    for (const name of ['%_\\ GmbH', "O'Reilly 東京", 'Ärztin München', 'plain unrelated']) await db.client.customer.create({ data: { userId: owner, name } });
    for (const [term, label] of [['%_\\', '%_\\ GmbH'], ["O'Re", "O'Reilly 東京"], ['東京', null], ['東京 ', null], ['Mün', 'Ärztin München'], ['Ärz', 'Ärztin München'], ['ärz', null], ['MÜN', null], ["' OR 1=1 --", null]]) {
      const results = (await searchOwnedRecords(owner, term!)).groups.flatMap(group => group.items);
      expect(results.map(row => row.label)).toEqual(label ? [label] : []);
    }
    expect((await searchOwnedRecords(owner, '東京x')).groups.every(group => !group.items.length)).toBe(true);
  });
  it('searches incoming filenames but never notes, source content, outbound filenames or quotes', async () => {
    const owner = await tenant();
    const own = await receipt(owner, null, 'SYN-ORIGINAL-東京.pdf');
    await invoice(owner, 'SYN-QUOTE-NUMBER', 'QUOTE');
    await invoice(owner, 'SYN-CREDIT-NUMBER', 'CREDIT_NOTE');
    expect((await searchOwnedRecords(owner, 'ORIGINAL-東京')).groups[2].items).toEqual([{ type: 'inbound', id: own.id, label: 'SYN-ORIGINAL-東京.pdf', href: `/purchases?document=${own.id}` }]);
    for (const term of ['SECRET-NOTE-ONLY', 'PRIVATE-PARSED', 'NOT-SEARCHED', 'SYN-QUOTE-NUMBER']) expect((await searchOwnedRecords(owner, term)).groups.every(group => !group.items.length)).toBe(true);
    expect((await searchOwnedRecords(owner, 'SYN-CREDIT')).groups[1].items).toHaveLength(1);
  });
  it('bounds labels in SQL and takes no more than six scalar rows per type', async () => {
    const owner = await tenant();
    await db.client.customer.create({ data: { userId: owner, name: `SYN-LONG-${'x'.repeat(3000)}`, internalNote: 'PRIVATE-LARGE-CONTENT' } });
    const queries: string[] = []; db.client.$on('query', event => { queries.push(event.query); });
    const result = await searchOwnedRecords(owner, 'SYN-LONG');
    expect(result.groups[0].items[0].label).toHaveLength(240);
    const selects = queries.filter(query => /SELECT/.test(query));
    expect(selects).toHaveLength(3);
    for (const sql of selects) { expect(sql).toContain('LIMIT'); expect(sql).toContain('substr'); expect(sql).not.toMatch(/JOIN|parsedData|internalNote|reviewDraft/); }
  });
  it('preserves financial, audit and record state on repeated reads', async () => {
    const owner = await tenant(); await invoice(owner, 'SYN-READ-ONLY'); await receipt(owner, 'SYN-READ-ONLY');
    const snapshot = async () => ({ invoices: await db.client.invoice.findMany({ where: { userId: owner } }), receipts: await db.client.purchaseDocument.findMany({ where: { userId: owner } }), audit: await db.client.auditLog.count(), payments: await db.client.paymentJournalEvent.count(), expenses: await db.client.expense.count(), incomes: await db.client.income.count() });
    const before = await snapshot(); await searchOwnedRecords(owner, 'SYN-READ'); await searchOwnedRecords(owner, 'SYN-READ'); expect(await snapshot()).toEqual(before);
  });
  it('authenticates, bounds bodies, rejects cross-site requests and disables response caching', async () => {
    state.userId = await tenant();
    const ok = await POST(request('none')); expect(ok.status).toBe(200); expect(ok.headers.get('cache-control')).toBe('private, no-store');
    expect((await POST(request('x'.repeat(101)))).status).toBe(400);
    expect((await POST(request('x'.repeat(2000)))).status).toBe(413);
    for (const pages of [null, [], { customer: -1 }, { outbound: 20 }, { inbound: '1' }, { userId: 1 }]) expect((await POST(request('none', {}, pages))).status).toBe(400);
    const next = await POST(request('none', {}, { customer: 1 }));
    expect(next.status).toBe(200); expect((await next.json()).groups.map((group: { page: number }) => group.page)).toEqual([1, 0, 0]);
    expect((await POST(new Request('http://localhost/api/record-search', { method: 'POST', body: '{' }))).status).toBe(400);
    expect((await POST(request('none', { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://foreign.invalid' }))).status).toBe(403);
    state.authenticated = false;
    try { expect((await POST(request('none', {}, { customer: 1 }))).status).toBe(401); } finally { state.authenticated = true; }
  });
  it('returns safe errors without logging search terms or private database failures', async () => {
    const error = vi.spyOn(console, 'error'); const warn = vi.spyOn(console, 'warn');
    const transaction = vi.spyOn(db.client, '$transaction').mockRejectedValueOnce(new Error('PRIVATE SQL PARAMETERS'));
    try {
      const response = await POST(request('PRIVATE-SEARCH-TERM')); expect(response.status).toBe(500);
      expect(await response.text()).not.toMatch(/PRIVATE/); expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
    } finally { transaction.mockRestore(); error.mockRestore(); warn.mockRestore(); }
  });
});
