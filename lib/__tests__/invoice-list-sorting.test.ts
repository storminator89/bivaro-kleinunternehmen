import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({ requireUserId: async () => 'invoice-sort-owner', UnauthorizedError: class extends Error {}, unauthorizedResponse: () => new Response(null, { status: 401 }) }));
import { GET } from '@/app/api/invoices/route';
import { POST } from '@/app/api/invoices/search/route';

let db: ReturnType<typeof createTestDatabase>;
const headers = { 'Content-Type': 'application/json', 'X-Bivaro-Payment-Contract': '3' };
const fixtures = [
  { invoiceNumber: 'SORT-10', totalAmount: 100, invoiceDate: new Date('2026-01-01'), uploadedAt: new Date('2026-05-01') },
  { invoiceNumber: 'SORT-2', totalAmount: 2, invoiceDate: new Date('2026-04-01'), uploadedAt: new Date('2026-04-02') },
  { invoiceNumber: 'SORT-3', totalAmount: 10, invoiceDate: null, uploadedAt: new Date('2026-03-01') },
  { invoiceNumber: 'SORT-4', totalAmount: 100, invoiceDate: new Date('2026-02-01'), uploadedAt: new Date('2026-02-02') },
];
let ids: number[];
beforeAll(async () => {
  db = createTestDatabase(); state.client = db.client;
  await db.client.user.createMany({ data: ['invoice-sort-owner', 'invoice-sort-other'].map(id => ({ id, email: `${id}@example.invalid`, password: 'unused' })) });
  ids = [];
  for (const fixture of fixtures) {
    const row = await db.client.invoice.create({ data: { ...fixture, userId: 'invoice-sort-owner', fileName: 'fixture.pdf', storedFileName: 'fixture.pdf', parsedData: { currency: 'EUR' } } });
    ids.push(row.id);
  }
  await db.client.invoice.create({ data: { ...fixtures[0], totalAmount: 999999, userId: 'invoice-sort-other', fileName: 'fixture.pdf', storedFileName: 'fixture.pdf', parsedData: {} } });
}, 40_000);
afterAll(async () => { await db?.cleanup(); });

async function read(mode: 'ordinary' | 'palette', options: Record<string, string | number>) {
  const response = mode === 'ordinary'
    ? await GET(new Request(`http://localhost/api/invoices?${new URLSearchParams({ search: 'SORT-', ...Object.fromEntries(Object.entries(options).map(([key, value]) => [key, String(value)])) })}`, { headers }))
    : await POST(new Request('http://localhost/api/invoices/search', { method: 'POST', headers, body: JSON.stringify({ query: 'SORT-', ...options }) }));
  expect(response.status).toBe(200);
  return response.json();
}

describe.each(['ordinary', 'palette'] as const)('%s invoice sorting across pagination', mode => {
  it('orders numeric amounts before slicing and gives equal amounts stable ID order', async () => {
    const first = await read(mode, { sortBy: 'amount', sortOrder: 'desc', pageSize: 2, page: 1 });
    const second = await read(mode, { sortBy: 'amount', sortOrder: 'desc', pageSize: 2, page: 2 });
    expect(first.total).toBe(4);
    expect(first.items.map((row: { id: number }) => row.id)).toEqual([ids[3], ids[0]]);
    expect(second.items.map((row: { totalAmount: number }) => row.totalAmount)).toEqual([10, 2]);
    const ascending = await read(mode, { sortBy: 'amount', sortOrder: 'asc', pageSize: 2 });
    expect(ascending.items.map((row: { totalAmount: number }) => row.totalAmount)).toEqual([2, 10]);
    expect(new Set([...first.items, ...second.items].map(row => row.id)).size).toBe(4);
  });
  it('uses invoice dates with upload-date fallback instead of sorting each upload-ordered page', async () => {
    const first = await read(mode, { sortBy: 'date', sortOrder: 'asc', pageSize: 2 });
    const second = await read(mode, { sortBy: 'date', sortOrder: 'asc', pageSize: 2, page: 2 });
    expect([...first.items, ...second.items].map(row => row.id)).toEqual([ids[0], ids[3], ids[2], ids[1]]);
  });
  it('compares invoice numbers naturally across pages', async () => {
    const first = await read(mode, { sortBy: 'invoiceNumber', sortOrder: 'asc', pageSize: 2 });
    const second = await read(mode, { sortBy: 'invoiceNumber', sortOrder: 'asc', pageSize: 2, page: 2 });
    expect([...first.items, ...second.items].map(row => row.invoiceNumber)).toEqual(['SORT-2', 'SORT-3', 'SORT-4', 'SORT-10']);
  });
  it('retains payment filtering before pagination and keeps the legacy API default', async () => {
    expect((await read(mode, { sortBy: 'amount', sortOrder: 'desc', paidStatus: 'paid', pageSize: 1 })).total).toBe(0);
    expect((await read(mode, { pageSize: 4 })).items.map((row: { id: number }) => row.id)).toEqual(ids);
  });
});

it.each<Record<string, string>>([{ sortBy: 'id' }, { sortBy: '' }, { sortOrder: 'sideways' }, { sortBy: 'amount; DROP TABLE Invoice' }])('rejects unsupported sort options through both list transports: %j', async options => {
  const ordinary = await GET(new Request(`http://localhost/api/invoices?${new URLSearchParams(options)}`, { headers }));
  const palette = await POST(new Request('http://localhost/api/invoices/search', { method: 'POST', headers, body: JSON.stringify({ query: 'SORT-', ...options }) }));
  expect(ordinary.status).toBe(400);
  expect(palette.status).toBe(400);
});
