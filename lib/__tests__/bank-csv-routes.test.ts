import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, userId: '' }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({ requireUserId: async () => state.userId, UnauthorizedError: class extends Error {}, unauthorizedResponse: () => new Response(null, { status: 401 }) }));

import { GET as invoiceList } from '@/app/api/invoices/route';
import { GET as paymentJournal } from '@/app/api/invoices/[id]/payments/route';
import { loadBankInvoiceCandidates } from '@/lib/bank-csv-candidates';
import { recordFullPayment, readInvoicePaymentJournal } from '@/lib/payment-journal/service';
import { recordPaymentAdjustment } from '@/lib/payment-journal/adjustment-service';

let database: ReturnType<typeof createTestDatabase>;
let sequence = 0;
beforeAll(() => { database = createTestDatabase(); state.client = database.client; }, 40_000);
beforeEach(async () => {
  state.userId = `bank-routes-${++sequence}`;
  await database.client.user.create({ data: { id: state.userId, email: `${state.userId}@example.invalid`, password: 'synthetic fixture only' } });
});
afterAll(async () => { await database?.cleanup(); });

async function invoice(adjusted = false, userId = state.userId) {
  const created = await database.client.invoice.create({ data: { userId, invoiceNumber: `RE-BANK-${++sequence}`, fileName: 'synthetic-bank.pdf', storedFileName: 'synthetic-bank.pdf', totalAmount: 120, status: 'SENT', issuanceState: 'ISSUED', invoiceDate: new Date('2026-10-01'), parsedData: { currency: 'EUR', taxMode: 'small-business', taxAmount: 0 } } });
  if (adjusted) {
    const receipt = await recordFullPayment(userId, created.id, { amount: '120.00', paidAt: '2026-10-20', currency: 'EUR', source: 'MANUAL', reference: 'Synthetic receipt', idempotencyKey: `bank-receipt-${++sequence}`, expectedPaidCents: '0' });
    const journal = await readInvoicePaymentJournal(userId, created.id);
    await recordPaymentAdjustment(userId, created.id, { kind: 'PAYMENT_CORRECTION', originalPaymentId: receipt.event.id, amount: '40.00', actionDate: '2026-10-21', reason: 'Synthetic receipt was never received', reference: 'Synthetic correction proof', declarationNeverReceived: true, expectedLedgerVersion: journal.ledgerVersion, idempotencyKey: `bank-correction-${++sequence}` });
  }
  return created;
}

/** Real Next route handlers and real isolated SQLite, not a mocked list response. */
function routeFetch(stripListCapability = false) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const headers = new Headers(init?.headers);
    if (stripListCapability && url.pathname === '/api/invoices') headers.delete('X-Bivaro-Payment-Contract');
    const request = new Request(url, { ...init, headers });
    if (url.pathname === '/api/invoices') return invoiceList(request);
    const match = /^\/api\/invoices\/([1-9]\d*)\/payments$/u.exec(url.pathname);
    if (!match) throw new Error('Unexpected bank-preview endpoint');
    return paymentJournal(request, { params: Promise.resolve({ id: match[1] }) });
  });
}
async function snapshot() {
  return { invoices: await database.client.invoice.findMany({ where: { userId: state.userId }, orderBy: { id: 'asc' } }), payments: await database.client.paymentJournalEvent.findMany({ where: { userId: state.userId }, orderBy: { id: 'asc' } }), adjustments: await database.client.paymentAdjustment.findMany({ where: { userId: state.userId }, orderBy: { id: 'asc' } }), incomes: await database.client.income.findMany({ where: { userId: state.userId }, orderBy: { id: 'asc' } }), audit: await database.client.auditLog.count({ where: { userId: state.userId } }) };
}

describe('bank candidate integration through authoritative v2 routes', () => {
  it('proves the original missing-list-header regression against the real capability gate', async () => {
    await invoice(true);
    const old = await invoiceList(new Request('http://localhost/api/invoices?page=1&pageSize=100'));
    expect(old.status).toBe(409); expect(await old.json()).toMatchObject({ code: 'PAYMENT_CAPABILITY_REQUIRED' });
    const fetcher = routeFetch(true);
    await expect(loadBankInvoiceCandidates(new AbortController().signal, fetcher)).rejects.toThrow(/Rechnungen.*nicht erreichbar/u);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('loads a mixed normal/adjusted selection using contract 2 on both list and journals, without writes', async () => {
    const normal = await invoice(), corrected = await invoice(true);
    const other = `bank-other-${++sequence}`;
    await database.client.user.create({ data: { id: other, email: `${other}@example.invalid`, password: 'synthetic fixture only' } });
    const foreign = await invoice(false, other);
    const before = await snapshot(), fetcher = routeFetch();
    const result = await loadBankInvoiceCandidates(new AbortController().signal, fetcher);
    expect(result).toMatchObject({ checked: 2, unavailable: 0, truncated: false, invoices: [{ id: normal.id, openCents: '12000', canRecordPayment: true }], reviewInvoices: [{ id: corrected.id, invoiceNumber: corrected.invoiceNumber }] });
    expect(result.invoices.some(row => row.id === foreign.id)).toBe(false);
    expect(result.reviewInvoices.some(row => row.id === foreign.id)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [, init] of fetcher.mock.calls) expect(init).toMatchObject({ method: 'GET', headers: { 'X-Bivaro-Payment-Contract': '2' }, cache: 'no-store', credentials: 'same-origin' });
    expect(await snapshot()).toEqual(before);
  });
  it('loads an adjusted-only real selection as explicit review-only, not an outage or new receipt', async () => {
    const corrected = await invoice(true), before = await snapshot();
    const result = await loadBankInvoiceCandidates(new AbortController().signal, routeFetch());
    expect(result).toEqual({ invoices: [], reviewInvoices: [{ id: corrected.id, invoiceNumber: corrected.invoiceNumber }], checked: 1, unavailable: 0, truncated: false });
    expect(await snapshot()).toEqual(before);
  });
});
