import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({ requireUserId: async () => 'invoice-calendar-owner', UnauthorizedError: class extends Error {}, unauthorizedResponse: () => new Response(null, { status: 401 }) }));
import { GET } from '@/app/api/invoices/route';
import { POST } from '@/app/api/invoices/search/route';

let db: ReturnType<typeof createTestDatabase>;
const headers = { 'Content-Type': 'application/json', 'X-Bivaro-Payment-Contract': '3' };
const days = ['2025-11-30', '2025-12-01', '2025-12-31', '2026-01-01', '2026-01-31', '2026-02-01', '2026-12-31', '2027-01-01'];
beforeAll(async () => {
  db = createTestDatabase(); state.client = db.client;
  await db.client.user.createMany({ data: ['invoice-calendar-owner', 'invoice-calendar-other'].map(id => ({ id, email: `${id}@example.invalid`, password: 'unused' })) });
  for (const day of days) {
    for (const fallback of [false, true]) {
      await db.client.invoice.create({ data: {
        userId: 'invoice-calendar-owner', fileName: `CALENDAR-${day}-${fallback}.pdf`, storedFileName: 'fixture.pdf',
        invoiceNumber: `CALENDAR-${day}-${fallback}`, totalAmount: 12, parsedData: { currency: 'EUR' },
        // Different upload date proves explicit invoice dates take precedence.
        invoiceDate: fallback ? null : new Date(`${day}T00:00:00Z`),
        uploadedAt: new Date(fallback ? `${day}T00:00:00Z` : '2030-01-01T00:00:00Z'),
      } });
    }
  }
  await db.client.invoice.create({ data: { userId: 'invoice-calendar-other', fileName: 'CALENDAR-foreign.pdf', storedFileName: 'fixture.pdf', parsedData: {}, invoiceDate: new Date('2026-01-01T00:00:00Z') } });
}, 40_000);
afterAll(async () => { await db?.cleanup(); });
afterEach(() => { vi.useRealTimers(); });

describe.each(['ordinary', 'palette'] as const)('%s invoice UTC calendar boundaries', mode => {
  it.each([
    ['thisMonth', ['2026-01-01', '2026-01-31']],
    ['lastMonth', ['2025-12-01', '2025-12-31']],
    ['thisYear', ['2026-01-01', '2026-01-31', '2026-02-01', '2026-12-31']],
  ] as const)('filters %s by invoice date or missing-date upload fallback', async (dateRange, expectedDays) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    const response = mode === 'ordinary'
      ? await GET(new Request(`http://localhost/api/invoices?search=CALENDAR-&dateRange=${dateRange}&pageSize=100`, { headers }))
      : await POST(new Request('http://localhost/api/invoices/search', { method: 'POST', headers, body: JSON.stringify({ query: 'CALENDAR-', dateRange, pageSize: 100 }) }));
    expect(response.status).toBe(200);
    const body = await response.json();
    const expected = expectedDays.flatMap(day => [false, true].map(fallback => `CALENDAR-${day}-${fallback}`));
    expect(body.total).toBe(expected.length);
    expect(body.items.map((row: { invoiceNumber: string }) => row.invoiceNumber).sort()).toEqual(expected.sort());
  });
});
