// Authored contract coverage only: do not execute without explicit functional-test authorization.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, userId: '', authenticated: true }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return { requireUserId: async () => { if (!state.authenticated) throw new UnauthorizedError(); return state.userId; }, UnauthorizedError,
    unauthorizedResponse: () => new Response(null, { status: 401 }) };
});
import { POST as customers } from '@/app/api/customers/search/route';
import { POST as invoices } from '@/app/api/invoices/search/route';
import { POST as purchases } from '@/app/api/purchase-documents/search/route';
import { GET as ordinaryInvoices } from '@/app/api/invoices/route';
import { searchOwnedRecords } from '@/lib/record-search/service';
import { listPurchaseDocuments } from '@/lib/purchase-documents/service';

let db: ReturnType<typeof createTestDatabase>;
let sequence = 0;
async function tenant() {
  const id = `filtered-list-${++sequence}`;
  await db.client.user.create({ data: { id, email: `${id}@synthetic.invalid`, password: 'unused' } });
  return id;
}
async function invoice(userId: string, invoiceNumber: string, type = 'INVOICE') {
  return db.client.invoice.create({ data: { userId, invoiceNumber, type, fileName: 'UNSEARCHABLE-FILENAME.pdf', storedFileName: 'private.pdf', totalAmount: 120, parsedData: { currency: 'EUR', private: 'PRIVATE-CONTENT' } } });
}
async function purchase(userId: string, invoiceNumber: string | null, originalFileName = 'synthetic.png', reviewStatus = 'REVIEW') {
  return db.client.purchaseDocument.create({ data: { userId, invoiceNumber, originalFileName, reviewStatus, storedFileName: 'private.png', originalSha256: `${++sequence}`.padStart(64, '0'), originalByteCount: 12, mediaType: 'image/png', uploadRequestId: `synthetic-${sequence}`, supplierName: 'UNSEARCHABLE-SUPPLIER', reviewDraftSearch: 'PRIVATE-NOTE-ONLY', parsedData: { private: 'PRIVATE-CONTENT' } } });
}
function request(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/${path}/search`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bivaro-Payment-Contract': '3', ...headers }, body: JSON.stringify(body) });
}
async function read(handler: (request: Request) => Promise<Response>, path: string, body: unknown) {
  const response = await handler(request(path, body));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  return response.json();
}
beforeAll(async () => { db = createTestDatabase(); state.client = db.client; }, 40_000);
afterAll(async () => { await db?.cleanup(); });

describe('read-only filtered list continuation', () => {
  it('matches exactly the palette scalar contract with literal wildcard, apostrophe and Unicode semantics', async () => {
    const owner = await tenant(), foreign = await tenant(); state.userId = owner;
    for (const label of ['%_\\ special', "O'Reilly 東京", 'Ärztin München', 'plain unrelated']) {
      await db.client.customer.createMany({ data: [{ userId: owner, name: label }, { userId: foreign, name: label }] });
      await invoice(owner, label); await invoice(foreign, label);
      await purchase(owner, label); await purchase(foreign, label);
    }
    for (const term of ['%_\\', "O'Re", 'Ärz', 'ärz', 'Mün', 'MÜN', '東京x', "' OR 1=1 --"]) {
      const palette = await searchOwnedRecords(owner, term);
      const customerList = await read(customers, 'customers', { query: term });
      const invoiceList = await read(invoices, 'invoices', { query: term, pageSize: 100 });
      const purchaseList = await read(purchases, 'purchase-documents', { query: term, limit: 50 });
      expect(customerList.map((row: { id: number }) => row.id).sort()).toEqual(palette.groups[0].items.map(row => row.id).sort());
      expect(invoiceList.items.map((row: { id: number }) => row.id).sort()).toEqual(palette.groups[1].items.map(row => row.id).sort());
      expect(purchaseList.documents.map((row: { id: number }) => row.id).sort()).toEqual(palette.groups[2].items.map(row => row.id).sort());
    }
  });
  it('does not expand matching to notes, suppliers, source content, outbound filenames, quotes or unknown types', async () => {
    state.userId = await tenant();
    await db.client.customer.create({ data: { userId: state.userId, name: 'ordinary', email: 'PRIVATE-NOTE-ONLY', internalNote: 'PRIVATE-CONTENT' } });
    await invoice(state.userId, 'QUOTED-ONLY', 'QUOTE'); await invoice(state.userId, 'UNKNOWN-ONLY', 'PROFORMA');
    await invoice(state.userId, 'ordinary'); await purchase(state.userId, 'ordinary');
    for (const query of ['PRIVATE-NOTE-ONLY', 'PRIVATE-CONTENT', 'UNSEARCHABLE-SUPPLIER', 'UNSEARCHABLE-FILENAME', 'QUOTED-ONLY', 'UNKNOWN-ONLY']) {
      expect(await read(customers, 'customers', { query })).toEqual([]);
      expect((await read(invoices, 'invoices', { query })).items).toEqual([]);
      expect((await read(purchases, 'purchase-documents', { query })).documents).toEqual([]);
    }
    const inbound = await purchase(state.userId, null, 'SYN-ORIGINAL-東京.pdf', 'DISMISSED');
    expect((await read(purchases, 'purchase-documents', { query: 'ORIGINAL-東京' })).documents).toMatchObject([{ id: inbound.id }]);
    const credit = await invoice(state.userId, 'SYN-CREDIT-ONLY', 'CREDIT_NOTE');
    expect((await read(invoices, 'invoices', { query: 'CREDIT-ONLY' })).items).toMatchObject([{ id: credit.id }]);
  });
  it('retains the normal invoice ledger v3 DTO and financial/date filtering before pagination', async () => {
    state.userId = await tenant();
    const own = await invoice(state.userId, 'DTO-EQUALITY');
    const filtered = await read(invoices, 'invoices', { query: 'DTO-EQUALITY' });
    const ordinary = await ordinaryInvoices(new Request('http://localhost/api/invoices?search=DTO-EQUALITY', { headers: { 'X-Bivaro-Payment-Contract': '3' } }));
    expect(filtered).toEqual(await ordinary.json());
    expect(filtered.items).toMatchObject([{ id: own.id, paymentContractVersion: 3, paymentSummary: { totalCents: '12000', paidCents: '0', openCents: '12000' } }]);
    expect((await read(invoices, 'invoices', { query: 'DTO-EQUALITY', paidStatus: 'paid' })).total).toBe(0);
    expect((await read(invoices, 'invoices', { query: 'DTO-EQUALITY', paidStatus: 'unpaid' })).total).toBe(1);
    expect((await read(invoices, 'invoices', { query: 'DTO-EQUALITY', paidStatus: 'partial' })).total).toBe(0);
    await db.client.invoice.update({ where: { id: own.id }, data: { invoiceDate: new Date('2020-01-01') } });
    expect((await read(invoices, 'invoices', { query: 'DTO-EQUALITY', dateRange: 'thisYear' })).total).toBe(0);
  });
  it('retains normal purchase projections and task/review filters without loading full source JSON', async () => {
    state.userId = await tenant();
    const due = await purchase(state.userId, 'SYN-TASK-ONE');
    await db.client.purchaseDocument.update({ where: { id: due.id }, data: { supplierTaskKind: 'CLARIFY', supplierTaskFollowUpDate: '2020-01-01' } });
    await purchase(state.userId, 'SYN-TASK-TWO', 'synthetic.png', 'DISMISSED');
    const filtered = await read(purchases, 'purchase-documents', { query: 'SYN-TASK', taskKind: 'CLARIFY', taskDue: 'due' });
    const ordinary = await listPurchaseDocuments(state.userId, new URLSearchParams({ search: 'SYN-TASK', taskKind: 'CLARIFY', taskDue: 'due' }));
    expect(filtered).toEqual(ordinary);
    expect(filtered.documents).toMatchObject([{ id: due.id }]);
    expect(JSON.stringify(filtered)).not.toContain('PRIVATE-CONTENT');
    expect((await read(purchases, 'purchase-documents', { query: 'SYN-TASK', reviewStatus: 'DISMISSED' })).total).toBe(1);
  });
  it('continues past the palette cap with ordinary list pagination rather than replaying palette rows', async () => {
    state.userId = await tenant();
    for (let i = 0; i < 105; i++) {
      await db.client.customer.create({ data: { userId: state.userId, name: `SYN-FULL-LIST ${i}` } });
      await invoice(state.userId, `SYN-FULL-LIST-${i}`); await purchase(state.userId, `SYN-FULL-LIST-${i}`);
    }
    expect(await read(customers, 'customers', { query: 'SYN-FULL-LIST' })).toHaveLength(105);
    const outbound = await read(invoices, 'invoices', { query: 'SYN-FULL-LIST', page: 21, pageSize: 5 });
    expect(outbound).toMatchObject({ total: 105, page: 21, pageSize: 5 }); expect(outbound.items).toHaveLength(5);
    const inbound = await read(purchases, 'purchase-documents', { query: 'SYN-FULL-LIST', page: 21, limit: 5 });
    expect(inbound).toMatchObject({ total: 105, page: 21, limit: 5 }); expect(inbound.documents).toHaveLength(5);
    const empty = await read(purchases, 'purchase-documents', { query: 'SYN-FULL-LIST', page: 22, limit: 5 });
    expect(empty.total).toBe(105); expect(empty.documents).toEqual([]);
  });
  it('preserves financial, audit and record state across repeated list reads', async () => {
    state.userId = await tenant(); await invoice(state.userId, 'SYN-READ-ONLY'); await purchase(state.userId, 'SYN-READ-ONLY');
    const snapshot = async () => ({ invoices: await db.client.invoice.findMany({ where: { userId: state.userId } }), purchases: await db.client.purchaseDocument.findMany({ where: { userId: state.userId } }), audit: await db.client.auditLog.count(), events: await db.client.paymentJournalEvent.count(), expenses: await db.client.expense.count(), incomes: await db.client.income.count() });
    const before = await snapshot();
    for (let i = 0; i < 2; i++) { await read(customers, 'customers', { query: 'SYN-READ' }); await read(invoices, 'invoices', { query: 'SYN-READ' }); await read(purchases, 'purchase-documents', { query: 'SYN-READ' }); }
    expect(await snapshot()).toEqual(before);
  });
  it('authenticates, rejects cross-site/URL/unknown/body abuse and disables caching on every outcome', async () => {
    state.userId = await tenant();
    for (const [handler, path] of [[customers, 'customers'], [invoices, 'invoices'], [purchases, 'purchase-documents']] as const) {
      for (const body of [{ query: 'ab' }, { query: 'x'.repeat(101) }, { query: 'valid', userId: 'foreign' }, { query: 'valid', document: 1 }]) expect((await handler(request(path, body))).status).toBe(400);
      expect((await handler(request(path, { query: 'x'.repeat(3000) }))).status).toBe(413);
      const cross = await handler(request(path, { query: 'valid' }, { Origin: 'https://foreign.invalid', 'Sec-Fetch-Site': 'cross-site' }));
      expect(cross.status).toBe(403); expect(cross.headers.get('cache-control')).toBe('private, no-store');
      const url = new Request(`http://localhost/api/${path}/search?query=PRIVATE`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"query":"valid"}' });
      expect((await handler(url)).status).toBe(400);
      state.authenticated = false;
      try { const response = await handler(request(path, { query: 'valid' })); expect(response.status).toBe(401); expect(response.headers.get('cache-control')).toBe('private, no-store'); }
      finally { state.authenticated = true; }
    }
  });
  it('returns static errors and never logs private terms or database failures', async () => {
    state.userId = await tenant();
    const error = vi.spyOn(console, 'error'), warn = vi.spyOn(console, 'warn');
    const transaction = vi.spyOn(db.client, '$transaction').mockRejectedValue(new Error('PRIVATE SQL PARAMETERS'));
    const raw = vi.spyOn(db.client, '$queryRaw').mockRejectedValue(new Error('PRIVATE CUSTOMER SQL'));
    try {
      for (const [handler, path] of [[customers, 'customers'], [invoices, 'invoices'], [purchases, 'purchase-documents']] as const) {
        const response = await handler(request(path, { query: 'PRIVATE-SEARCH-TERM' }));
        expect(response.status).toBe(500); expect(await response.text()).not.toMatch(/PRIVATE/);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
      }
      expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
    } finally { transaction.mockRestore(); raw.mockRestore(); error.mockRestore(); warn.mockRestore(); }
  });
});
