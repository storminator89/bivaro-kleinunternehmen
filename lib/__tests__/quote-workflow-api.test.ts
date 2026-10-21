import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';
import { quoteBusinessToday } from '@/lib/quote-workflow';
import { parseBusinessDate } from '@/lib/business-date';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, userId: 'quote-owner', auditFails: false }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({ requireUserId: async () => state.userId, UnauthorizedError: class extends Error {}, unauthorizedResponse: () => new Response(null, { status: 401 }) }));
vi.mock('@/lib/audit-log', async original => {
  const actual = await original<typeof import('@/lib/audit-log')>();
  return { ...actual, createFinancialAuditLog: async (...args: Parameters<typeof actual.createFinancialAuditLog>) => { if (state.auditFails) throw new Error('synthetic audit failure'); return actual.createFinancialAuditLog(...args); } };
});
import { PATCH } from '@/app/api/quotes/[id]/workflow/route';
import { GET } from '@/app/api/quotes/route';
let database: ReturnType<typeof createTestDatabase>;
beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  await database.client.user.createMany({ data: ['quote-owner', 'quote-other'].map(id => ({ id, email: `${id}@test.invalid`, password: 'unused' })) });
}, 40000);
afterAll(async () => database?.cleanup());
async function fixture(overrides: Record<string, unknown> = {}) {
  return database.client.invoice.create({ data: { userId: 'quote-owner', type: 'QUOTE', status: 'SENT', fileName: 'synthetic.pdf', storedFileName: 'synthetic.pdf', parsedData: { items: [{ description: 'Service', quantity: 2, unitPrice: 12.34, taxRate: 19 }], taxMode: 'STANDARD' }, totalAmount: 29.37, ...overrides } });
}
function patch(quote: Awaited<ReturnType<typeof fixture>>, change: object, expected: object = { status: quote.status, quoteFollowUpOn: quote.quoteFollowUpOn, quoteResponseNote: quote.quoteResponseNote }) {
  return PATCH(new NextRequest(`http://localhost/api/quotes/${quote.id}/workflow`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...change, expected }) }), { params: Promise.resolve({ id: String(quote.id) }) });
}
describe('owned quote workflow API', () => {
  it('persists only private workflow fields and an atomic user-declared audit; preserves source/PDF/money', async () => {
    const quote = await fixture();
    const response = await patch(quote, { status: 'ACCEPTED', quoteFollowUpOn: '2026-12-31', quoteResponseNote: '  telefonisch zugesagt  ', parsedData: {}, totalAmount: 0 });
    expect(response.status).toBe(200);
    const updated = await database.client.invoice.findUniqueOrThrow({ where: { id: quote.id } });
    expect(updated).toEqual({ ...quote, status: 'ACCEPTED', quoteFollowUpOn: '2026-12-31', quoteResponseNote: 'telefonisch zugesagt' });
    const audit = await database.client.auditLog.findFirstOrThrow({ where: { entityId: String(quote.id), entityType: 'Quote' } });
    expect(audit.metadata).toContain('user-declared response');
    expect(await database.client.income.count()).toBe(0);
  });
  it('rejects stale edits without discarding the winning response or dates', async () => {
    const quote = await fixture();
    expect((await patch(quote, { quoteFollowUpOn: '2026-11-01' })).status).toBe(200);
    expect((await patch(quote, { quoteResponseNote: 'stale' })).status).toBe(409);
    expect(await database.client.invoice.findUniqueOrThrow({ where: { id: quote.id } })).toMatchObject({ quoteFollowUpOn: '2026-11-01', quoteResponseNote: null });
  });
  it('returns 404 for other owners and non-quotes without touching them', async () => {
    for (const quote of [await fixture({ userId: 'quote-other' }), await fixture({ type: 'INVOICE' })]) {
      expect((await patch(quote, { quoteResponseNote: 'forbidden' })).status).toBe(404);
      expect(await database.client.invoice.findUniqueOrThrow({ where: { id: quote.id } })).toEqual(quote);
    }
  });
  it('rejects malformed dates/notes and rolls back on audit failure', async () => {
    const quote = await fixture();
    for (const change of [{ quoteFollowUpOn: '2026-02-30' }, { status: 'PAID' }, { quoteResponseNote: 'x'.repeat(2001) }]) expect((await patch(quote, change)).status).toBe(400);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    state.auditFails = true;
    try { expect((await patch(quote, { status: 'ACCEPTED' })).status).toBe(500); }
    finally { state.auditFails = false; spy.mockRestore(); }
    expect(await database.client.invoice.findUniqueOrThrow({ where: { id: quote.id } })).toEqual(quote);
  });
  it('filters all owned tasks before pagination; valid-until is inclusive and closed/converted records do not inflate counts', async () => {
    // Keep this independent of earlier cases and of the date on which the suite runs.
    const today = quoteBusinessToday();
    const day = parseBusinessDate(today);
    const yesterday = new Date(day.getTime() - 86400000);
    const owner = 'quote-counts';
    await database.client.user.create({ data: { id: owner, email: `${owner}@test.invalid`, password: 'unused' } });
    const task = await fixture({ userId: owner, quoteFollowUpOn: today, validUntil: yesterday });
    const dueLater = await fixture({ userId: owner, quoteFollowUpOn: '9999-12-31', validUntil: day });
    await fixture({ userId: owner, status: 'REJECTED', quoteFollowUpOn: today, validUntil: yesterday });
    const accepted = await fixture({ userId: owner, status: 'ACCEPTED' });
    const converted = await fixture({ userId: owner, status: 'ACCEPTED', quoteFollowUpOn: today });
    await fixture({ userId: owner, type: 'INVOICE', convertedFromQuoteId: converted.id });
    state.userId = owner;
    try {
      const response = await GET(new Request('http://localhost/api/quotes?status=FOLLOW_UP&pageSize=1'));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ items: [{ id: task.id }], total: 1, workflowDate: today, workflowCounts: { FOLLOW_UP: 1, NEEDS_RESPONSE: 1, READY_TO_INVOICE: 1 } });
      const ready = await (await GET(new Request('http://localhost/api/quotes?status=READY_TO_INVOICE'))).json();
      expect(ready.items.map((row: { id: number }) => row.id)).toEqual([accepted.id]);
      const ordinary = await (await GET(new Request(`http://localhost/api/quotes?search=${dueLater.fileName}`))).json();
      expect(ordinary.total).toBe(5);
    } finally { state.userId = 'quote-owner'; }
  });
});
