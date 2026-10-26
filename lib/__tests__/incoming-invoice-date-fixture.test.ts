// Authored for separately authorized isolated acceptance. NOT run locally.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';
import { EMPTY_REVIEW_DRAFT } from '@/lib/purchase-documents/review-draft';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, userId: 'date-owner', authenticated: true }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return { requireUserId: async () => { if (!state.authenticated) throw new UnauthorizedError(); return state.userId; }, UnauthorizedError,
    unauthorizedResponse: () => new Response(null, { status: 401 }) };
});
import { GET as ordinary } from '@/app/api/purchase-documents/route';
import { POST as palette } from '@/app/api/purchase-documents/search/route';

let database: ReturnType<typeof createTestDatabase>, baseline: Awaited<ReturnType<typeof snapshot>>;
const ids: Record<string, number> = {};
const ownerIds = ['date-owner', 'date-foreign'];
async function snapshot() {
  const where = { userId: { in: ownerIds } }, orderBy = { id: 'asc' as const }, client = database.client;
  return client.$transaction([
    client.user.findMany({ where: { id: { in: ownerIds } }, orderBy }), client.purchaseDocument.findMany({ where, orderBy }),
    client.invoice.findMany({ where, orderBy }), client.income.findMany({ where, orderBy }), client.expense.findMany({ where, orderBy }),
    client.cashTransaction.findMany({ where, orderBy }), client.paymentJournalEvent.findMany({ where, orderBy }),
    client.paymentOperation.findMany({ where, orderBy }), client.paymentAdjustment.findMany({ where, orderBy }),
    client.paymentAllocationChange.findMany({ where, orderBy }), client.invoiceNumberCounter.findMany({ where, orderBy: [{ userId: 'asc' }, { type: 'asc' }, { year: 'asc' }] }),
    client.documentNumberingPolicy.findMany({ where, orderBy: [{ userId: 'asc' }, { type: 'asc' }, { revision: 'asc' }] }), client.emailOutbox.findMany({ where, orderBy }), client.auditLog.findMany({ where, orderBy }),
  ]);
}
async function source(label: string, invoiceDate: string | null, userId = ownerIds[0]) {
  const row = await database.client.purchaseDocument.create({ data: {
    userId, invoiceNumber: `DATE-FIXTURE-${label}`, originalFileName: `DATE-FIXTURE-${label}.xml`, storedFileName: `synthetic-${randomUUID()}.xml`,
    originalSha256: randomUUID().replaceAll('-', '').repeat(2), originalByteCount: 100, mediaType: 'application/xml', uploadRequestId: randomUUID(),
    invoiceDate: invoiceDate ? new Date(invoiceDate) : null, uploadedAt: new Date('2026-06-15T12:00:00.000Z'),
    ...(label === 'missing' ? { reviewDraft: { ...EMPTY_REVIEW_DRAFT, invoiceDate: '2026-06-15', note: 'A draft is not the extracted source date.' }, reviewDraftSavedAt: new Date('2026-06-15T12:00:00.000Z') } : {}),
    ...(label === 'middle' ? { supplierTaskKind: 'CLARIFY', supplierTaskFollowUpDate: null } : {}),
  } });
  ids[label] = row.id;
}
async function read(options: Record<string, string | number> = {}, throughPalette = false) {
  const response = throughPalette
    ? await palette(new Request('http://localhost/api/purchase-documents/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'DATE-FIXTURE', ...options }) }))
    : await ordinary(new NextRequest(`http://localhost/api/purchase-documents?${new URLSearchParams(Object.entries(options).map(([key, value]) => [key, String(value)]))}`));
  return { response, body: await response.json() as { total: number; documents: { id: number; invoiceDate: string | null }[]; error?: string } };
}
beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  expect(database.url).toMatch(/^file:.*\/bivaro-test-[^/]+\/test\.db$/);
  await database.client.user.createMany({ data: ownerIds.map(id => ({ id, email: `${id}@synthetic.invalid`, password: 'unused-synthetic-hash' })) });
  await source('lower', '2026-01-01T00:00:00.000Z'); await source('middle', '2026-06-15T00:00:00.000Z');
  await source('upper', '2026-12-31T23:59:59.999Z'); await source('before', '2025-12-31T23:59:59.999Z');
  await source('after', '2027-01-01T00:00:00.000Z'); await source('missing', null); await source('foreign', '2026-06-15T00:00:00.000Z', ownerIds[1]);
  baseline = await snapshot();
}, 40_000);
beforeEach(() => { state.userId = ownerIds[0]; state.authenticated = true; });
afterEach(async () => { expect(await snapshot()).toEqual(baseline); });
afterAll(async () => { await database?.cleanup(); });

describe('isolated invoice-date list/API acceptance (unrun during preparation)', () => {
  it.each([false, true])('filters owner dates inclusively before bounded count/pagination (palette=%s)', async throughPalette => {
    const options = { invoiceDateFrom: '2026-01-01', invoiceDateTo: '2026-12-31', limit: 2 };
    const first = await read(options, throughPalette), second = await read({ ...options, page: 2 }, throughPalette);
    expect(first.response.status).toBe(200); expect(second.response.status).toBe(200);
    expect(first.body.total).toBe(3); expect(second.body.total).toBe(3);
    expect(first.body.documents).toHaveLength(2); expect(second.body.documents).toHaveLength(1);
    expect([...first.body.documents, ...second.body.documents].map(row => row.id).sort((a, b) => a - b)).toEqual([ids.lower, ids.middle, ids.upper].sort((a, b) => a - b));
    if (throughPalette) expect(first.response.headers.get('cache-control')).toBe('private, no-store');
  });
  it.each([false, true])('selects NULL source dates, never substituting the matching upload/draft day (palette=%s)', async throughPalette => {
    const missing = await read({ invoiceDateMissing: 'only' }, throughPalette);
    expect(missing.response.status).toBe(200); expect(missing.body.total).toBe(1); expect(missing.body.documents).toMatchObject([{ id: ids.missing, invoiceDate: null }]);
    const day = await read({ invoiceDateFrom: '2026-06-15', invoiceDateTo: '2026-06-15' }, throughPalette);
    expect(day.body.total).toBe(1); expect(day.body.documents.map(row => row.id)).toEqual([ids.middle]);
    const all = await read({}, throughPalette); expect(all.body.total).toBe(6); expect(all.body.documents.map(row => row.id)).toContain(ids.missing);
  });
  it('combines task/date filters without broadening tenant or task scope', async () => {
    const result = await read({ invoiceDateFrom: '2026-01-01', invoiceDateTo: '2026-12-31', taskKind: 'CLARIFY', taskDue: 'undated' }, true);
    expect(result.response.status).toBe(200); expect(result.body.total).toBe(1); expect(result.body.documents.map(row => row.id)).toEqual([ids.middle]);
  });
  it('uses only the active authenticated owner and denies unauthenticated list reads', async () => {
    state.userId = ownerIds[1];
    for (const throughPalette of [false, true]) { const result = await read({ invoiceDateFrom: '2026-01-01' }, throughPalette); expect(result.body.documents.map(row => row.id)).toEqual([ids.foreign]); }
    state.authenticated = false;
    expect((await ordinary(new NextRequest('http://localhost/api/purchase-documents?invoiceDateMissing=only'))).status).toBe(401);
    expect((await read({}, true)).response.status).toBe(401);
  });
  it.each([false, true])('fails closed for invalid, reversed and contradictory dates (palette=%s)', async throughPalette => {
    const invalidOptions: Record<string, string>[] = [{ invoiceDateFrom: '2026-02-30' }, { invoiceDateFrom: '2026-12-31', invoiceDateTo: '2026-01-01' }, { invoiceDateMissing: 'only', invoiceDateTo: '2026-12-31' }, { invoiceDateFrom: "2026-01-01' OR 1=1 --" }];
    for (const options of invalidOptions) {
      const result = await read(options, throughPalette); expect(result.response.status).toBe(400); expect(result.body.error).not.toContain('OR 1=1');
    }
  });
});
