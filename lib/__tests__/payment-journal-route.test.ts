import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { generateApiKey } from '@/lib/api-auth';
import { PUT as putV1Invoice } from '@/app/api/v1/invoices/route';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, userId: 'route-payment-owner' as string | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return { requireUserId: async () => { if (!state.userId) throw new UnauthorizedError(); return state.userId; }, UnauthorizedError,
    unauthorizedResponse: () => new Response(null, { status: 401 }) };
});
import { GET, POST } from '@/app/api/invoices/[id]/payments/route';
import { PUT } from '@/app/api/invoices/route';
let database: ReturnType<typeof createTestDatabase>;
let key = 0;
let bearerKey: string;
const context = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
function request(body: unknown, origin = 'http://localhost:3000') {
  return new Request('http://localhost:3000/api/invoices/1/payments', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
}
async function invoice() {
  return database.client.invoice.create({ data: { userId: 'route-payment-owner', fileName: 'invoice.pdf', storedFileName: 'invoice.pdf', parsedData: {}, totalAmount: 25, status: 'SENT' } });
}
function payment() { return { amount: '25.00', paidAt: '2026-10-19', currency: 'EUR', source: 'MANUAL', reference: 'Bank statement', idempotencyKey: `route-${++key}` }; }
beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  await database.client.user.createMany({ data: ['route-payment-owner', 'route-payment-other'].map(id => ({ id, email: `${id}@test.invalid`, password: 'fixture' })) });
  const generated = generateApiKey(); bearerKey = generated.key;
  await database.client.apiKey.create({ data: { userId: 'route-payment-owner', name: 'Payment regression fixture', keyHash: generated.keyHash, keyPrefix: generated.keyPrefix, scopes: JSON.stringify(['write']) } });
}, 40_000);
afterAll(async () => { await database?.cleanup(); });

describe('payment API boundaries', () => {
  it('books calendar payment, returns authoritative summary and replays with 200', async () => {
    const source = await invoice(); const body = payment();
    const created = await POST(request(body), context(source.id)); expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ event: { amountCents: '2500', paidAt: '2026-10-19T00:00:00.000Z' }, summary: { paid: true, openCents: '0' }, replayed: false });
    const replayed = await POST(request(body), context(source.id)); expect(replayed.status).toBe(200);
    expect(await replayed.json()).toMatchObject({ replayed: true });
    const read = await GET(new Request('http://localhost:3000'), context(source.id));
    expect(await read.json()).toMatchObject({ summary: { paidCents: '2500' }, legacyAdoptionRequired: false });
  });
  it('requires auth on reads and writes', async () => {
    const source = await invoice(); state.userId = null;
    try {
      expect((await POST(request(payment()), context(source.id))).status).toBe(401);
      expect((await GET(new Request('http://localhost:3000'), context(source.id))).status).toBe(401);
    } finally { state.userId = 'route-payment-owner'; }
  });
  it('blocks cross-origin requests before mutations', async () => {
    const source = await invoice(); expect((await POST(request(payment(), 'https://hostile.invalid'), context(source.id))).status).toBe(403);
    expect(await database.client.paymentJournalEvent.count({ where: { invoiceId: source.id } })).toBe(0);
  });
  it('returns 404 for other tenants', async () => {
    const source = await invoice(); state.userId = 'route-payment-other';
    try {
      expect((await POST(request(payment()), context(source.id))).status).toBe(404);
      expect((await GET(new Request('http://localhost:3000'), context(source.id))).status).toBe(404);
    } finally { state.userId = 'route-payment-owner'; }
  });
  it.each([{ source: 'LEGACY_STATUS' }, { amount: '20' }, { currency: 'USD' }, { amount: null }, { paidAt: '2026-10-19T00:00:00Z' }, { refund: true }])('rejects unsupported input %j without writing', async changes => {
    const source = await invoice(); const response = await POST(request({ ...payment(), ...changes }), context(source.id));
    expect(response.status).toBe(400); expect(await response.json()).toHaveProperty('code');
    expect(await database.client.paymentJournalEvent.count({ where: { invoiceId: source.id } })).toBe(0);
  });
  it('rejects malformed JSON, arrays and oversized bodies', async () => {
    const source = await invoice();
    expect((await POST(new Request('http://localhost:3000', { method: 'POST', body: '{' }), context(source.id))).status).toBe(400);
    expect((await POST(request([]), context(source.id))).status).toBe(400);
    expect((await POST(request({ padding: 'a'.repeat(1024 * 1024) }), context(source.id))).status).toBe(413);
  });
  it('preflight rejects foreign currency and invalid IDs without suggesting an EUR payment', async () => {
    const source = await invoice();
    await database.client.invoice.update({ where: { id: source.id }, data: { parsedData: { currency: 'USD' } } });
    const response = await GET(new Request('http://localhost:3000'), context(source.id));
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'UNSUPPORTED_CURRENCY' });
    expect((await GET(new Request('http://localhost:3000'), context(-1))).status).toBe(400);
  });
  it('preflight marks unadopted legacy PAID without falsely presenting it as open', async () => {
    const source = await invoice(); await database.client.invoice.update({ where: { id: source.id }, data: { status: 'PAID' } });
    const response = await GET(new Request('http://localhost:3000'), context(source.id));
    expect(await response.json()).toMatchObject({ currency: 'EUR', summary: null, legacyAdoptionRequired: true, canRecordPayment: false });
  });
  it('legacy PAID status without date returns actionable structured error', async () => {
    const source = await invoice();
    const response = await PUT(new Request('http://localhost:3000/api/invoices', { method: 'PUT', body: JSON.stringify({ id: source.id, status: 'PAID' }), headers: { 'content-type': 'application/json' } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'PAYMENT_DETAILS_REQUIRED' });
    expect(await database.client.income.count({ where: { invoiceId: source.id } })).toBe(0);
  });
  it('legacy import is explicit and forbids invented historical fields', async () => {
    const source = await invoice(); await database.client.invoice.update({ where: { id: source.id }, data: { status: 'PAID' } });
    expect((await POST(request({ kind: 'LEGACY_IMPORT', paidAt: '2020-01-01' }), context(source.id))).status).toBe(400);
    const response = await POST(request({ kind: 'LEGACY_IMPORT' }), context(source.id));
    expect(await response.json()).toMatchObject({ event: { paidAt: null, incomeId: null, dateCertainty: 'UNKNOWN' } });
  });
});

function v1Request(id: number, body: object, authenticated = true) {
  return new NextRequest(`http://localhost:3000/api/v1/invoices?id=${id}`, { method: 'PUT',
    headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: `Bearer ${bearerKey}` } : {}) },
    body: JSON.stringify(body),
  });
}

describe('authenticated v1 invoice payment compatibility', () => {
  it('requires real API-key auth before the legacy payment handler', async () => {
    const source = await invoice();
    const response = await putV1Invoice(v1Request(source.id, { status: 'PAID' }, false));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'MISSING_API_KEY' } });
    expect(await database.client.income.count({ where: { invoiceId: source.id } })).toBe(0);
  });
  it('preserves actionable missing-payment-details 400 rather than mapping it to 500', async () => {
    const source = await invoice();
    const response = await putV1Invoice(v1Request(source.id, { status: 'PAID' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'PAYMENT_DETAILS_REQUIRED', message: expect.stringContaining('Zahlungsdialog') } });
    expect(await database.client.apiLog.count({ where: { userId: 'route-payment-owner', statusCode: 400 } })).toBeGreaterThan(0);
    expect(await database.client.income.count({ where: { invoiceId: source.id } })).toBe(0);
    expect(await database.client.paymentJournalEvent.count({ where: { invoiceId: source.id } })).toBe(0);
  });
  it('preserves actionable unsupported-currency 409 and its code without finance writes', async () => {
    const source = await invoice();
    await database.client.invoice.update({ where: { id: source.id }, data: { parsedData: { currency: 'USD' } } });
    const response = await putV1Invoice(v1Request(source.id, { status: 'PAID', paidAt: '2026-10-19' }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'UNSUPPORTED_CURRENCY' } });
    expect(await database.client.paymentJournalEvent.count({ where: { invoiceId: source.id } })).toBe(0);
    expect(await database.client.income.count({ where: { invoiceId: source.id } })).toBe(0);
  });
  it('still permits an explicitly dated full payment and idempotent retry with real bearer auth', async () => {
    const source = await invoice();
    const body = { status: 'PAID', paidAt: '2026-10-19' };
    const first = await putV1Invoice(v1Request(source.id, body));
    expect(first.status).toBe(200); expect(await first.json()).toMatchObject({ data: { status: 'PAID', income: { amount: 25 } } });
    expect((await putV1Invoice(v1Request(source.id, body))).status).toBe(200);
    expect(await database.client.paymentJournalEvent.count({ where: { invoiceId: source.id } })).toBe(1);
    expect(await database.client.income.count({ where: { invoiceId: source.id } })).toBe(1);
  });
});
