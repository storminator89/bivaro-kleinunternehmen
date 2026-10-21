import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';
const state = vi.hoisted(() => ({ client: null as PrismaClient | null, userId: 'payment-list-owner' }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({ requireUserId: async () => state.userId, UnauthorizedError: class extends Error {}, unauthorizedResponse: () => new Response(null, { status: 401 }) }));
import { GET } from '@/app/api/invoices/route';
import { recordFullPayment } from '@/lib/payment-journal/service';
let database: ReturnType<typeof createTestDatabase>;
let sequence = 0;
const read = async (query = '') => {
  const response = await GET(new Request(`http://localhost:3000/api/invoices?${query}`));
  expect(response.status).toBe(200);
  return response.json();
};
beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  await database.client.user.createMany({ data: ['payment-list-owner', 'payment-list-other'].map(id => ({ id, email: `${id}@test.invalid`, password: 'fixture' })) });
}, 40_000);
afterAll(async () => { await database?.cleanup(); });
const invoice = async (prefix: string, userId = state.userId) => database.client.invoice.create({ data: { userId, fileName: 'fixture.pdf', storedFileName: 'fixture.pdf', invoiceNumber: `${prefix}-${++sequence}`, totalAmount: 120, parsedData: { currency: 'EUR' } } });
const pay = async (id: number, amount: string, expectedPaidCents: string, paidAt = '2026-10-19') => recordFullPayment(state.userId, id, { amount, expectedPaidCents, currency: 'EUR', source: 'MANUAL', reference: 'Synthetic bank evidence', paidAt, idempotencyKey: `list-${++sequence}` });

describe('server-derived invoice balances and pre-pagination filtering', () => {
  it('includes partials in unpaid, excludes them from paid and counts partial-only before slicing', async () => {
    const first = await invoice('FILTER'), second = await invoice('FILTER'), paid = await invoice('FILTER'), open = await invoice('FILTER');
    await pay(first.id, '40', '0'); await pay(second.id, '60', '0'); await pay(paid.id, '120', '0');
    const partialPage1 = await read('search=FILTER&paidStatus=partial&page=1&pageSize=1');
    const partialPage2 = await read('search=FILTER&paidStatus=partial&page=2&pageSize=1');
    expect(partialPage1.total).toBe(2); expect(partialPage2.total).toBe(2);
    expect(new Set([partialPage1.items[0].id, partialPage2.items[0].id])).toEqual(new Set([first.id, second.id]));
    const paidList = await read('search=FILTER&paidStatus=paid&pageSize=100');
    expect(paidList.total).toBe(1); expect(paidList.items[0].id).toBe(paid.id);
    const unpaid = await read('search=FILTER&paidStatus=unpaid&pageSize=100');
    expect(unpaid.total).toBe(3); expect(new Set(unpaid.items.map((row: { id: number }) => row.id))).toEqual(new Set([first.id, second.id, open.id]));
    expect(unpaid.items.find((row: { id: number }) => row.id === first.id)).toMatchObject({ status: 'SENT', canRecordPayment: true, paymentSummary: { totalCents: '12000', paidCents: '4000', openCents: '8000', paymentState: 'PARTIAL' }, incomes: [{ amount: 40 }] });
    await pay(first.id, '80', '4000', '2026-10-20');
    const settled = await read(`search=${first.invoiceNumber}`);
    expect(settled.items[0]).toMatchObject({ status: 'PAID', canRecordPayment: false, paymentSummary: { paidCents: '12000', openCents: '0', paymentState: 'PAID' }, incomes: [{ amount: 40 }, { amount: 80 }] });
    expect((await read('search=FILTER&paidStatus=partial')).total).toBe(1);
  });
  it('keeps explicit nullable quote scalars in the invoice ledger DTO without listing private quote responses', async () => {
    const own = await invoice('DTO-SCALARS');
    await database.client.invoice.create({ data: { userId: state.userId, type: 'QUOTE', fileName: 'synthetic-quote.pdf', storedFileName: 'synthetic-quote.pdf', invoiceNumber: 'DTO-SCALARS-QUOTE', parsedData: {}, quoteFollowUpOn: '2026-12-31', quoteResponseNote: 'Synthetic private quote response' } });
    const list = await read('search=DTO-SCALARS');
    expect(list.total).toBe(1);
    expect(list.items).toMatchObject([{ id: own.id, type: 'INVOICE', quoteFollowUpOn: null, quoteResponseNote: null, paymentReviewRequired: false, canRecordPayment: true, paymentSummary: { totalCents: '12000', paidCents: '0', openCents: '12000' } }]);
    expect(JSON.stringify(list)).not.toContain('Synthetic private quote response');
  });
  it('does not invent unpaid balances for historical or inconsistent financial evidence', async () => {
    const historical = await invoice('REVIEW');
    await database.client.invoice.update({ where: { id: historical.id }, data: { status: 'PAID' } });
    const evidence = await invoice('REVIEW');
    await database.client.income.create({ data: { userId: state.userId, invoiceId: evidence.id, description: 'Unexplained historical income', amount: 40, date: new Date('2024-01-01') } });
    const all = await read('search=REVIEW');
    expect(all.items).toHaveLength(2);
    for (const row of all.items) expect(row).toMatchObject({ paymentSummary: null, paymentReviewRequired: true, canRecordPayment: false });
    expect((await read('search=REVIEW&paidStatus=unpaid')).total).toBe(0);
  });
  it('keeps tenant/search/date boundaries and never exposes another tenant through financial filters', async () => {
    await invoice('ISOLATED', 'payment-list-other');
    expect((await read('search=ISOLATED&paidStatus=unpaid')).total).toBe(0);
    const own = await invoice('DATE');
    await database.client.invoice.update({ where: { id: own.id }, data: { invoiceDate: new Date('2020-01-01') } });
    expect((await read('search=DATE&dateRange=thisYear')).total).toBe(0);
  });
});
