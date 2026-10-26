import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

// No Prisma client, database, filesystem fixture, server, or real API is used.
const state = vi.hoisted(() => ({ transaction: vi.fn(), count: vi.fn(), findMany: vi.fn(), query: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: state.transaction } }));
import { listPurchaseDocuments } from '@/lib/purchase-documents/service';

beforeEach(() => {
  vi.clearAllMocks(); state.count.mockResolvedValue(7); state.findMany.mockResolvedValue([]);
  state.query.mockImplementation(async (sql: Prisma.Sql) => /count\(\*\)/.test(sql.sql) ? [{ total: 7 }] : [{ id: 17 }]);
  state.transaction.mockImplementation(async callback => callback({ purchaseDocument: { count: state.count, findMany: state.findMany }, $queryRaw: state.query }));
});
const dates = { invoiceDateFrom: '2026-01-01', invoiceDateTo: '2026-12-31' };
const expectedBounds = { gte: new Date('2026-01-01T00:00:00.000Z'), lte: new Date('2026-12-31T23:59:59.999Z') };
describe('invoice date filtering reaches bounded owner queries (mocked data access only)', () => {
  it('applies the same source-date predicate to ordinary count and pagination before materializing metadata', async () => {
    const result = await listPurchaseDocuments('synthetic-owner', new URLSearchParams({ ...dates, page: '3', limit: '25', reviewStatus: 'REVIEW', search: 'supplier' }));
    const where = state.count.mock.calls[0][0].where;
    expect(where).toMatchObject({ userId: 'synthetic-owner', reviewStatus: 'REVIEW', invoiceDate: expectedBounds });
    expect(where.OR).toHaveLength(4);
    expect(state.findMany.mock.calls[0][0]).toMatchObject({ where, skip: 50, take: 25 });
    expect(result).toMatchObject({ documents: [], total: 7, page: 3, limit: 25 });
    expect(state.query).not.toHaveBeenCalled();
  });
  it('uses IS NULL only when explicitly requested, never a draft/upload-date fallback', async () => {
    await listPurchaseDocuments('synthetic-owner', new URLSearchParams({ invoiceDateMissing: 'only' }));
    expect(state.count.mock.calls[0][0].where).toEqual({ userId: 'synthetic-owner', invoiceDate: null });
    expect(JSON.stringify(state.count.mock.calls)).not.toMatch(/reviewDraft|uploadedAt|reviewedSourceSnapshot/);
  });
  it('keeps ordinary requests unchanged when no dates are selected', async () => {
    await listPurchaseDocuments('synthetic-owner', new URLSearchParams());
    expect(state.count.mock.calls[0][0].where).toEqual({ userId: 'synthetic-owner' });
  });
  it('binds source-date endpoints in both palette count and page queries, retaining tenant and scalar-only term scope', async () => {
    const term = "' OR 1=1 -- 東京";
    await listPurchaseDocuments('synthetic-owner', new URLSearchParams({ ...dates, page: '2', limit: '10' }), term);
    expect(state.count).not.toHaveBeenCalled(); expect(state.query).toHaveBeenCalledTimes(2);
    for (const [sql] of state.query.mock.calls as [Prisma.Sql][]) {
      expect(sql.sql).toContain('"userId" = ?'); expect(sql.sql).toContain('AND "invoiceDate" >= ?'); expect(sql.sql).toContain('AND "invoiceDate" <= ?');
      expect(sql.sql).not.toContain(term); expect(sql.sql).not.toMatch(/reviewDraft|parsedData|uploadedAt.*WHERE/);
      expect(sql.values.slice(0, 5)).toEqual(['synthetic-owner', term, term, expectedBounds.gte, expectedBounds.lte]);
    }
    expect(state.query.mock.calls[0][0].values.slice(-2)).toEqual([10, 10]);
    expect(state.findMany.mock.calls[0][0]).toMatchObject({ where: { AND: [{ userId: 'synthetic-owner', invoiceDate: expectedBounds }, { id: { in: [17] } }] }, take: 10 });
    expect(state.findMany.mock.calls[0][0]).not.toHaveProperty('skip');
  });
  it('keeps missing dates and active task scope conjunctive with the owner predicate for palette reads', async () => {
    await listPurchaseDocuments('synthetic-owner', new URLSearchParams({ invoiceDateMissing: 'only', taskKind: 'CLARIFY', taskDue: 'undated' }), 'invoice');
    for (const [sql] of state.query.mock.calls as [Prisma.Sql][]) {
      expect(sql.sql).toContain('"userId" = ?'); expect(sql.sql).toContain('AND "invoiceDate" IS NULL');
      expect(sql.sql).toContain('AND "supplierTaskFollowUpDate" IS NULL'); expect(sql.values).toContain('CLARIFY');
    }
  });
  it.each(['invoiceDateFrom=2026-02-30', 'invoiceDateFrom=2026-12-31&invoiceDateTo=2026-01-01', 'invoiceDateMissing=only&invoiceDateTo=2026-12-31', 'invoiceDateTo=2026-12-31&invoiceDateTo=2026-12-31'])('rejects invalid input before data access: %s', async query => {
    await expect(listPurchaseDocuments('synthetic-owner', new URLSearchParams(query))).rejects.toMatchObject({ status: 400, code: 'INVALID_DATE_FILTER' });
    expect(state.transaction).not.toHaveBeenCalled();
  });
});
