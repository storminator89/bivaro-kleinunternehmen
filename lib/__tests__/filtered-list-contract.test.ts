import { describe, expect, it } from 'vitest';
import { customerListSearchInput, filteredListQuery, invoiceListSearchInput, purchaseListSearchInput } from '@/lib/record-search/list-contract';
import { ownedRecordMatch } from '@/lib/record-search/match';

describe('body-only filtered list contracts', () => {
  it('requires a trimmed 3..100-character term without changing literal characters', () => {
    expect(filteredListQuery('  %_\\  ')).toBe('%_\\');
    expect(filteredListQuery('  Ärz 東京  ')).toBe('Ärz 東京');
    expect(filteredListQuery('x'.repeat(100))).toHaveLength(100);
    for (const query of [null, false, 7, {}, [], '', '  ', 'ab', '  ab  ', 'x'.repeat(101)]) expect(() => filteredListQuery(query)).toThrow();
  });
  it('rejects unknown, detail-scoped and content-search fields rather than broadening a continuation', () => {
    const parsers = [customerListSearchInput, invoiceListSearchInput, purchaseListSearchInput];
    for (const parse of parsers) {
      for (const input of [null, [], 'abc', { query: 'abc', userId: 'foreign' }, { query: 'abc', ids: [1] }, { query: 'abc', document: 1 }, { query: 'abc', search: 'private' }, JSON.parse('{"query":"abc","__proto__":{}}')]) expect(() => parse(input)).toThrow();
    }
    expect(() => customerListSearchInput({ query: 'abc', page: 1 })).toThrow();
    expect(() => invoiceListSearchInput({ query: 'abc', type: 'QUOTE' })).toThrow();
    expect(() => purchaseListSearchInput({ query: 'abc', supplierName: 'abc' })).toThrow();
  });
  it('uses ordinary list defaults and page bounds, not the palette 20-page cap', () => {
    expect(invoiceListSearchInput({ query: ' abc ' })).toEqual({ query: 'abc', page: 1, pageSize: 20, paidStatus: 'all', dateRange: 'all' });
    expect(purchaseListSearchInput({ query: 'abc' })).toEqual({ query: 'abc', page: 1, limit: 25, reviewStatus: 'ALL', taskKind: 'all', taskDue: 'any' });
    expect(invoiceListSearchInput({ query: 'abc', page: 101, pageSize: 1 }).page).toBe(101);
    expect(purchaseListSearchInput({ query: 'abc', page: 100_000, limit: 50 }).page).toBe(100_000);
    for (const page of [0, -1, 1.5, '1', null, Infinity, NaN, Number.MAX_SAFE_INTEGER]) expect(() => invoiceListSearchInput({ query: 'abc', page })).toThrow();
    for (const page of [0, 100_001, '1', null]) expect(() => purchaseListSearchInput({ query: 'abc', page })).toThrow();
    for (const pageSize of [0, 101, 1.5, '20', null]) expect(() => invoiceListSearchInput({ query: 'abc', pageSize })).toThrow();
    for (const limit of [0, 51, 1.5, '25', null]) expect(() => purchaseListSearchInput({ query: 'abc', limit })).toThrow();
  });
  it('accepts only existing financial/date/review/task filters and rejects contradictory task scopes', () => {
    expect(invoiceListSearchInput({ query: 'abc', paidStatus: 'partial', dateRange: 'thisYear' }).paidStatus).toBe('partial');
    for (const input of [{ paidStatus: 'PAID' }, { dateRange: 'today' }, { paidStatus: null }, { dateRange: [] }]) expect(() => invoiceListSearchInput({ query: 'abc', ...input })).toThrow();
    for (const taskKind of ['all', 'any', 'PAYMENT_CHECK', 'DIRECT_DEBIT_WAIT', 'CLARIFY']) expect(purchaseListSearchInput({ query: 'abc', taskKind }).taskKind).toBe(taskKind);
    for (const taskDue of ['any', 'due', 'later', 'undated']) expect(purchaseListSearchInput({ query: 'abc', taskDue }).taskDue).toBe(taskDue);
    for (const input of [{ reviewStatus: 'all' }, { taskKind: 'other' }, { taskDue: 'tomorrow' }, { reviewStatus: 'BOOKED', taskKind: 'any' }, { reviewStatus: 'DISMISSED', taskDue: 'due' }]) expect(() => purchaseListSearchInput({ query: 'abc', ...input })).toThrow();
  });
  it('binds SQL punctuation and keeps the exact scalar-only palette predicate', () => {
    const term = "%_\\' OR 1=1 -- 東京";
    const customer = ownedRecordMatch('customer', 'owner', term);
    expect(customer.sql).toContain('instr(lower("name"), lower(?))');
    expect(customer.values).toEqual(['owner', term]);
    const outbound = ownedRecordMatch('outbound', 'owner', term);
    expect(outbound.sql).toContain('"type" IN (\'INVOICE\', \'CREDIT_NOTE\')');
    expect(outbound.sql).toContain('instr(lower("invoiceNumber"), lower(?))');
    const inbound = ownedRecordMatch('inbound', 'owner', term);
    expect(inbound.values).toEqual(['owner', term, term]);
    expect(inbound.sql).toContain('instr(lower("originalFileName"), lower(?))');
    for (const sql of [customer.sql, outbound.sql, inbound.sql]) {
      expect(sql).not.toContain(term);
      expect(sql).not.toMatch(/LIKE|supplierName|reviewDraft|parsedData|internalNote|fileName|JOIN/);
    }
  });
});
