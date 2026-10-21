import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, userId: 'history-owner' as string | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return { requireUserId: async () => { if (!state.userId) throw new UnauthorizedError(); return state.userId; }, UnauthorizedError, unauthorizedResponse: () => new Response(null, { status: 401 }) };
});
import { GET } from '@/app/api/change-history/route';
let database: ReturnType<typeof createTestDatabase>;
let originalId: number, correctionId: number, foreignId: number, orphanId: number;
const get = (query = '') => GET(new Request(`http://localhost:3000/api/change-history?${query}`));

beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  await database.client.user.createMany({ data: [{ id: 'history-owner', email: 'history@example.test', password: 'fixture', role: 'ADMIN' }, { id: 'history-other', email: 'other@example.test', password: 'fixture' }] });
  const base = { userId: 'history-owner', fileName: 'fixture.pdf', storedFileName: 'SECRET-STORAGE-PATH', parsedData: { currency: 'EUR', taxMode: 'small-business', iban: 'SECRET-IBAN', rawXml: 'SECRET-XML' }, totalAmount: 100, status: 'CANCELLED', issuanceState: 'ISSUED', invoiceDate: new Date('2026-10-20') };
  const original = await database.client.invoice.create({ data: { ...base, invoiceNumber: 'HISTORY-ORIGINAL', cancellationReason: 'Synthetic correction reason' } }); originalId = original.id;
  const credit = await database.client.invoice.create({ data: { ...base, type: 'CREDIT_NOTE', totalAmount: -100, invoiceNumber: 'HISTORY-CORRECTION', originalInvoiceId: originalId } }); correctionId = credit.id;
  const foreign = await database.client.invoice.create({ data: { ...base, userId: 'history-other', invoiceNumber: 'FOREIGN-NUMBER' } }); foreignId = foreign.id;
  const orphan = await database.client.invoice.create({ data: { ...base, type: 'CREDIT_NOTE', invoiceNumber: 'OWN-ORPHAN', originalInvoiceId: foreignId } }); orphanId = orphan.id;
  await database.client.invoice.create({ data: { ...base, userId: 'history-other', invoiceNumber: 'FOREIGN-CORRECTION', type: 'CREDIT_NOTE', originalInvoiceId: originalId } });
  await database.client.auditLog.createMany({ data: [
    { userId: 'history-owner', entityType: 'Invoice', entityId: String(originalId), action: 'CREATE', createdAt: new Date('2026-10-20T00:00:00Z'), newValues: '{"status":"SENT","password":"SECRET-PASSWORD"}' },
    { userId: 'history-owner', entityType: 'Invoice', entityId: String(originalId), action: 'CANCELLED', createdAt: new Date('2026-10-21T23:59:59Z'), oldValues: '{"status":"SENT"}', newValues: '{"status":"CANCELLED"}', metadata: '{"actorId":"history-owner","reason":"SECRET-RAW-METADATA"}' },
    { userId: 'history-owner', entityType: 'CreditNote', entityId: String(correctionId), action: 'CREATE', createdAt: new Date('2026-10-21T23:59:59Z'), newValues: '{"totalAmount":-100}' },
    { userId: 'history-other', entityType: 'Invoice', entityId: String(originalId), action: 'UPDATE', entityName: 'SECRET-FOREIGN-EVENT' },
    { userId: 'history-owner', entityType: 'SecurityEvent', entityId: String(originalId), action: 'SECURITY_EVENT', metadata: '{"token":"SECRET-TOKEN"}' },
    { userId: 'history-owner', entityType: 'AccountantHandoff', entityId: String(originalId), action: 'REVIEW', metadata: '{"reason":"SECRET-HANDOFF"}' },
  ] });
  const income = await database.client.income.create({ data: { userId: 'history-owner', invoiceId: originalId, description: 'Synthetic payment', amount: 100, date: new Date('2026-10-20') } });
  await database.client.paymentJournalEvent.create({ data: { incomeId: income.id, userId: 'history-owner', invoiceId: originalId, amountCents: '10000', currency: 'EUR', source: 'MANUAL', dateCertainty: 'ACTUAL', paidAt: new Date('2026-10-20'), idempotencyKey: 'SECRET-PAYMENT-KEY', reference: 'SECRET-BANK-REFERENCE' } });
}, 40_000);
afterAll(async () => { await database?.cleanup(); });

describe('read-only invoice history API', () => {
  it('requires an authenticated current owner and gives no cross-owner admin exception', async () => {
    state.userId = null;
    try { expect((await get()).status).toBe(401); } finally { state.userId = 'history-owner'; }
    expect((await get(`invoiceId=${foreignId}`)).status).toBe(404);
    expect((await get('userId=history-other')).status).toBe(400);
  });
  it('lists and searches owned documents only, with stable bounded pagination', async () => {
    const page1 = await (await get('limit=1')).json(), page2 = await (await get('limit=1&page=2')).json();
    expect(page1.pagination).toMatchObject({ pageSize: 1, total: 3, totalPages: 3 });
    expect(page1.documents[0].id).not.toBe(page2.documents[0].id);
    const result = await (await get('search=CORRECTION')).json();
    expect(result.documents.map((document: { id: number }) => document.id)).toEqual([correctionId]);
    expect(JSON.stringify(result)).not.toContain('FOREIGN'); expect(JSON.stringify(result)).not.toContain('SECRET');
  });
  it('resolves original and correction identically from either side without sensitive payloads', async () => {
    const response = await get(`invoiceId=${correctionId}`), body = await response.json();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body).toMatchObject({ kind: 'detail', selectedId: correctionId, originalId, missingOriginal: false, paymentCount: 1 });
    expect(body.documents.map((document: { id: number }) => document.id)).toEqual([originalId, correctionId]);
    expect(body.events).toHaveLength(3); expect(body.payments).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain('SECRET'); expect(JSON.stringify(body)).not.toContain('FOREIGN');
    expect(body.events.map((event: { id: number }) => event.id)).toEqual([...body.events.map((event: { id: number }) => event.id)].sort((a, b) => b - a));
    expect((await (await get(`invoiceId=${originalId}`)).json()).documents).toEqual(body.documents);
  });
  it('filters actions and UTC recording dates and paginates the whole owned family', async () => {
    const filtered = await (await get(`invoiceId=${originalId}&action=CANCELLED&from=2026-10-21&to=2026-10-21`)).json();
    expect(filtered.events).toHaveLength(1); expect(filtered.events[0].changes[0]).toMatchObject({ before: 'Versendet', after: 'Storniert' });
    const one = await (await get(`invoiceId=${originalId}&limit=1`)).json(), two = await (await get(`invoiceId=${originalId}&limit=1&page=2`)).json();
    expect(one.pagination).toMatchObject({ total: 3, totalPages: 3 }); expect(one.events[0].id).not.toBe(two.events[0].id);
    const empty = await (await get(`invoiceId=${originalId}&action=DELETE`)).json(); expect(empty.events).toEqual([]); expect(empty.documents).toHaveLength(2);
  });
  it('never traverses or exposes a malformed cross-owner original relationship', async () => {
    const body = await (await get(`invoiceId=${orphanId}`)).json();
    expect(body).toMatchObject({ missingOriginal: true, originalId: orphanId, documents: [{ id: orphanId, originalInvoiceId: null }] });
    expect(JSON.stringify(body)).not.toContain('FOREIGN');
  });
  it('reads never mutate document records, audit count, payment count or numbering', async () => {
    const snapshot = async () => ({ invoices: await database.client.invoice.findMany(), logs: await database.client.auditLog.count(), payments: await database.client.paymentJournalEvent.count(), counters: await database.client.invoiceNumberCounter.findMany() });
    const before = await snapshot(); await get(`invoiceId=${originalId}`); await get(`invoiceId=${correctionId}`); await get('search=HISTORY');
    expect(await snapshot()).toEqual(before);
  });
});
