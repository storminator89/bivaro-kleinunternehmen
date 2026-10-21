import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';
import { recordFullPayment, readInvoicePaymentJournal } from '@/lib/payment-journal/service';
import { recordPaymentAdjustment } from '@/lib/payment-journal/adjustment-service';
import { NextRequest } from 'next/server';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, userId: 'timeline-owner' as string | null, previewPath: '' }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/upload-ownership', () => ({ findOwnedUploadedFile: vi.fn(async () => state.previewPath) }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return { requireUserId: async () => { if (!state.userId) throw new UnauthorizedError(); return state.userId; }, UnauthorizedError,
    unauthorizedResponse: () => new Response(null, { status: 401 }) };
});
import { GET } from '@/app/api/customers/[id]/timeline/route';
import { CUSTOMER_TIMELINE_PAGE_SIZE, readCustomerTimeline, timelineBalance, CUSTOMER_TIMELINE_EVIDENCE_LIMIT } from '@/lib/customer-timeline';
import type { CustomerTimelinePage } from '@/lib/customer-timeline-contract';
import { ownedInvoice } from '@/lib/payment-journal/service';
import { GET as getQuotePreview } from '@/app/api/quotes/download/route';

let db: ReturnType<typeof createTestDatabase>, next = 0;
const owner = 'timeline-owner';
const when = new Date('2026-10-20T12:00:00.000Z');
const context = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
async function customer(name = 'Gleichnamige Testkundin', userId = owner) {
  return db.client.customer.create({ data: { userId, name } });
}
async function document(customerId: number | null, changes: Record<string, unknown> = {}) {
  return db.client.invoice.create({ data: { userId: owner, customerId, invoiceNumber: `TL-${++next}`, fileName: 'synthetic.pdf', storedFileName: 'synthetic.pdf',
    parsedData: { currency: 'EUR', taxMode: 'small-business', taxAmount: 0, buyerInfo: { name: 'Alter historischer Name' } },
    totalAmount: 100, status: 'SENT', issuanceState: 'ISSUED', invoiceDate: new Date('2026-10-01'), uploadedAt: when, ...changes } });
}
async function page(id: number, cursor: string | null = null) {
  const response = await GET(new Request(`http://localhost/api/customers/${id}/timeline${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`), context(id));
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  return await response.json() as CustomerTimelinePage;
}
async function financialCounts() {
  return Promise.all([db.client.invoice.count(), db.client.paymentJournalEvent.count(), db.client.paymentAdjustment.count(), db.client.income.count(), db.client.auditLog.count(), db.client.emailOutbox.count()]);
}
beforeAll(async () => {
  db = createTestDatabase(); state.client = db.client;
  await db.client.user.createMany({ data: [owner, 'timeline-foreign'].map(id => ({ id, email: `${id}@example.test`, password: 'synthetic-only' })) });
}, 40_000);
afterAll(async () => { await db?.cleanup(); });

describe('read-only directly linked customer timeline', () => {
  it('owns the customer and every linked source; never matches names or historical buyer fields', async () => {
    const own = await customer(); const foreign = await customer(undefined, 'timeline-foreign');
    const unlinked = await document(null); const source = await document(own.id);
    await document(foreign.id, { userId: 'timeline-foreign' });
    // SQLite's ordinary Invoice relation cannot enforce tenant pairs. A mixed
    // legacy graph must not turn a foreign invoice into a readable source.
    await document(own.id, { userId: 'timeline-foreign' });
    const first = await page(own.id);
    expect(first.entries.map(entry => entry.document.id)).toEqual([source.id]);
    expect(first.entries.some(entry => entry.document.id === unlinked.id)).toBe(false);
    expect((await GET(new Request('http://localhost'), context(foreign.id))).status).toBe(404);
    state.userId = null;
    try { expect((await GET(new Request('http://localhost'), context(own.id))).status).toBe(401); }
    finally { state.userId = owner; }
  });

  it('keeps quote, draft, zero, unknown, legacy paid and cancellation distinct from debt', async () => {
    const own = await customer();
    const quote = await document(own.id, { type: 'QUOTE', status: 'ACCEPTED' });
    const draft = await document(own.id, { status: 'DRAFT', issuanceState: 'UNISSUED' });
    const zero = await document(own.id, { totalAmount: 0 });
    const unknown = await document(own.id, { totalAmount: null });
    const legacy = await document(own.id, { status: 'PAID' });
    const cancelled = await document(own.id, { status: 'CANCELLED' });
    const usd = await document(own.id, { parsedData: { currency: 'USD' } });
    const result = await page(own.id); const byId = new Map(result.entries.map(entry => [entry.document.id, entry]));
    expect(byId.get(quote.id)).toMatchObject({ statusLabel: 'Angebot angenommen', balance: { state: 'NOT_APPLICABLE', openCents: null }, document: { href: `/api/quotes/download?id=${quote.id}` } });
    expect(byId.get(draft.id)).toMatchObject({ balance: { state: 'NOT_APPLICABLE', openCents: null } });
    for (const id of [zero.id, unknown.id, legacy.id, usd.id]) expect(byId.get(id)?.balance).toEqual({ state: 'REVIEW', openCents: null });
    expect(byId.get(cancelled.id)).toMatchObject({ statusLabel: 'Rechnung storniert · keine Forderung', balance: { state: 'KNOWN', openCents: '0' } });
    expect(result).not.toHaveProperty('total'); expect(result).not.toHaveProperty('balance');
  });

  it('links quotes to the existing quote-specific owned PDF preview, which rejects invoice and foreign IDs', async () => {
    const own = await customer(); const quote = await document(own.id, { type: 'QUOTE', status: 'ACCEPTED' });
    const invoice = await document(own.id);
    const foreign = await customer(undefined, 'timeline-foreign');
    const foreignQuote = await document(foreign.id, { userId: 'timeline-foreign', type: 'QUOTE' });
    const pdf = '%PDF-1.4\n% synthetic quote preview fixture\n%%EOF\n';
    state.previewPath = path.join(path.dirname(db.url.slice('file:'.length)), 'synthetic-quote-preview.pdf');
    await writeFile(state.previewPath, pdf);
    const result = await page(own.id); const href = result.entries.find(entry => entry.document.id === quote.id)!.document.href;
    expect(href).toBe(`/api/quotes/download?id=${quote.id}`);
    const response = await getQuotePreview(new NextRequest(`http://localhost${href}`));
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe(`inline; filename="${quote.fileName}"`);
    expect(await response.text()).toBe(pdf);
    expect((await getQuotePreview(new NextRequest(`http://localhost/api/quotes/download?id=${invoice.id}`))).status).toBe(404);
    expect((await getQuotePreview(new NextRequest(`http://localhost/api/quotes/download?id=${foreignQuote.id}`))).status).toBe(404);
  });

  it('labels a fully corrected receipt as open rather than partially paid, using the central net payment state', async () => {
    const own = await customer(); const source = await document(own.id);
    const payment = await recordFullPayment(owner, source.id, { amount: '40.00', paidAt: '2026-10-02', currency: 'EUR', source: 'MANUAL', reference: 'Synthetic fully corrected receipt', idempotencyKey: `timeline-full-correction-root-${++next}`, expectedPaidCents: '0' });
    await recordPaymentAdjustment(owner, source.id, { kind: 'PAYMENT_CORRECTION', originalPaymentId: payment.event.id, amount: '40.00', actionDate: '2026-10-03', reason: 'Synthetic receipt never arrived', reference: 'Synthetic full correction', idempotencyKey: `timeline-full-correction-${++next}`, expectedLedgerVersion: (await readInvoicePaymentJournal(owner, source.id)).ledgerVersion, declarationNeverReceived: true });
    const journal = await readInvoicePaymentJournal(owner, source.id);
    expect(journal.summary).toMatchObject({ paymentState: 'OPEN', paidCents: '0', openCents: '10000' });
    const result = await page(own.id);
    expect(result.entries.find(entry => entry.kind === 'DOCUMENT')).toMatchObject({ statusLabel: 'Rechnung offen', balance: { state: 'KNOWN', openCents: '10000' } });
    expect(result.entries.find(entry => entry.kind === 'PAYMENT')?.statusLabel).toBe('Zahlung erfasst · später angepasst');
  });

  it('distinguishes accepted quotes from an authorized conversion and never links a mixed-tenant conversion', async () => {
    const own = await customer();
    const quote = await document(own.id, { type: 'QUOTE', status: 'ACCEPTED' });
    const accepted = await document(own.id, { type: 'QUOTE', status: 'ACCEPTED' });
    const expired = await document(own.id, { type: 'QUOTE', status: 'EXPIRED' });
    const converted = await document(own.id, { convertedFromQuoteId: quote.id });
    const corrupted = await document(own.id, { type: 'QUOTE', status: 'ACCEPTED' });
    const foreign = await customer(undefined, 'timeline-foreign');
    const foreignInvoice = await document(foreign.id, { userId: 'timeline-foreign', convertedFromQuoteId: corrupted.id });
    const result = await page(own.id);
    expect(result.entries.find(entry => entry.document.id === quote.id)).toMatchObject({ statusLabel: 'In Rechnung übernommen', document: { convertedInvoice: { id: converted.id, href: `/history?invoiceId=${converted.id}` } } });
    expect(result.entries.find(entry => entry.document.id === accepted.id)?.statusLabel).toBe('Angebot angenommen');
    expect(result.entries.find(entry => entry.document.id === expired.id)?.statusLabel).toBe('Angebot abgelaufen');
    expect(result.entries.find(entry => entry.document.id === corrupted.id)).toMatchObject({ statusLabel: 'Angebotsübernahme prüfen' });
    expect(result.entries.find(entry => entry.document.id === corrupted.id)?.document).not.toHaveProperty('convertedInvoice');
    expect(result.entries.some(entry => entry.document.id === foreignInvoice.id)).toBe(false);
  });

  it('uses shared payment and correction semantics without double counting Income or inventing event dates', async () => {
    const own = await customer(); const source = await document(own.id);
    const payment = await recordFullPayment(owner, source.id, { amount: '40.00', paidAt: '2026-10-02', currency: 'EUR', source: 'MANUAL', reference: 'Synthetic statement', idempotencyKey: `timeline-payment-${++next}`, expectedPaidCents: '0' });
    const before = await page(own.id);
    expect(before.entries.find(entry => entry.kind === 'DOCUMENT')?.balance).toEqual({ state: 'KNOWN', openCents: '6000' });
    expect(before.entries.find(entry => entry.kind === 'PAYMENT')).toMatchObject({ amountCents: '4000', businessDate: '2026-10-02T00:00:00.000Z', dateCertainty: 'ACTUAL', statusLabel: 'Zahlung bestätigt' });
    const ledger = await readInvoicePaymentJournal(owner, source.id);
    await recordPaymentAdjustment(owner, source.id, { kind: 'PAYMENT_CORRECTION', originalPaymentId: payment.event.id, amount: '10.00', actionDate: '2026-10-03', reason: 'Synthetic portion never received', reference: 'Synthetic correction', idempotencyKey: `timeline-correction-${++next}`, expectedLedgerVersion: ledger.ledgerVersion, declarationNeverReceived: true });
    const counts = await financialCounts();
    const after = await page(own.id); const again = await page(own.id);
    expect(after).toEqual(again);
    expect(after.entries).toHaveLength(3);
    expect(after.entries.find(entry => entry.kind === 'DOCUMENT')).toMatchObject({ statusLabel: 'Teilweise bezahlt', balance: { state: 'KNOWN', openCents: '7000' } });
    expect(after.entries.find(entry => entry.kind === 'PAYMENT')).toMatchObject({ amountCents: '4000', statusLabel: 'Zahlung erfasst · später angepasst' });
    expect(after.entries.find(entry => entry.kind === 'ADJUSTMENT')).toMatchObject({ amountCents: '1000', statusLabel: 'Zahlungskorrektur · fachlich ungeprüft' });
    expect(await financialCounts()).toEqual(counts);
  });

  it('pages identical dates without duplicate or missing keys, excludes later backdated inserts and refreshes current statuses', async () => {
    const own = await customer();
    const sources: Array<Awaited<ReturnType<typeof document>>> = [];
    for (let index = 0; index < CUSTOMER_TIMELINE_PAGE_SIZE + 5; index++) sources.push(await document(own.id));
    const first = await page(own.id);
    expect(first.entries).toHaveLength(CUSTOMER_TIMELINE_PAGE_SIZE); expect(first.nextCursor).not.toBeNull();
    const added = await document(own.id, { uploadedAt: new Date('2020-01-01') });
    await db.client.invoice.update({ where: { id: sources[0].id }, data: { status: 'CANCELLED' } });
    const second = await page(own.id, first.nextCursor);
    const keys = [...first.entries, ...second.entries].map(entry => entry.key);
    expect(new Set(keys).size).toBe(sources.length); expect(second.nextCursor).toBeNull();
    expect(second.entries.some(entry => entry.document.id === added.id)).toBe(false);
    expect(second.entries.find(entry => entry.document.id === sources[0].id)?.document.status).toBe('CANCELLED');
    const refreshed = await readCustomerTimeline(owner, own.id, null);
    const refreshedSecond = await readCustomerTimeline(owner, own.id, refreshed.nextCursor);
    expect(refreshedSecond.entries.some(entry => entry.document.id === added.id)).toBe(true);
    const other = await customer();
    expect((await GET(new Request(`http://localhost/?cursor=${first.nextCursor}`), context(other.id))).status).toBe(400);
  });

  it('preserves old document snapshots after rename, and returns empty/deleted customer states', async () => {
    const own = await customer(); const empty = await customer('Empty');
    expect((await page(empty.id)).entries).toEqual([]);
    await db.client.customer.delete({ where: { id: empty.id } });
    expect((await GET(new Request('http://localhost'), context(empty.id))).status).toBe(404);
    const source = await document(own.id);
    const original = await db.client.invoice.findUniqueOrThrow({ where: { id: source.id } });
    await db.client.customer.update({ where: { id: own.id }, data: { name: 'Neuer aktueller Name' } });
    expect((await page(own.id)).customer.name).toBe('Neuer aktueller Name');
    expect((await db.client.invoice.findUniqueOrThrow({ where: { id: source.id } })).parsedData).toEqual(original.parsedData);
  });

  it('uses a total order across document and payment streams at the same instant', async () => {
    const own = await customer(); const ids: number[] = [];
    for (let index = 0; index < 13; index++) {
      const source = await document(own.id); ids.push(source.id);
      const income = await db.client.income.create({ data: { userId: owner, customerId: own.id, invoiceId: source.id, amount: 10, date: new Date('2026-10-02'), description: 'Synthetic payment' } });
      await db.client.paymentJournalEvent.create({ data: { userId: owner, invoiceId: source.id, incomeId: income.id, amountCents: '1000', currency: 'EUR', paidAt: income.date, dateCertainty: 'ACTUAL', source: 'MANUAL', reference: 'Synthetic statement', idempotencyKey: `timeline-tie-${++next}`, createdAt: when } });
    }
    const first = await page(own.id); const second = await page(own.id, first.nextCursor);
    expect(first.entries).toHaveLength(20); expect(second.entries).toHaveLength(6);
    expect(first.entries.slice(0, 13).every(entry => entry.kind === 'PAYMENT')).toBe(true);
    const all = [...first.entries, ...second.entries];
    expect(new Set(all.map(entry => entry.key)).size).toBe(26);
    expect(all.filter(entry => entry.kind === 'DOCUMENT').map(entry => entry.document.id)).toEqual([...ids].reverse());
    expect(all.every(entry => entry.balance.openCents === '9000')).toBe(true);
  });

  it('does not reopen a cancelled debt when a confirmed refund is recorded', async () => {
    const own = await customer(); const source = await document(own.id);
    const payment = await recordFullPayment(owner, source.id, { amount: '100.00', paidAt: '2026-10-02', currency: 'EUR', source: 'MANUAL', reference: 'Synthetic cancellation receipt', idempotencyKey: `timeline-refund-root-${++next}`, expectedPaidCents: '0' });
    const basis = await document(own.id, { type: 'CREDIT_NOTE', originalInvoiceId: source.id, totalAmount: -100, invoiceDate: new Date('2026-10-03'), cancellationReason: 'Synthetic cancellation' });
    await db.client.invoice.update({ where: { id: source.id }, data: { status: 'CANCELLED', cancellationReason: 'Synthetic cancellation' } });
    await recordPaymentAdjustment(owner, source.id, { kind: 'CUSTOMER_REFUND', originalPaymentId: payment.event.id, amount: '25.00', actionDate: '2026-10-04', reason: 'Synthetic partial refund', reference: `Synthetic refund ${++next}`, idempotencyKey: `timeline-refund-${next}`, expectedLedgerVersion: (await readInvoicePaymentJournal(owner, source.id)).ledgerVersion, cancellationInvoiceId: basis.id });
    const result = await page(own.id);
    expect(result.entries.find(entry => entry.kind === 'ADJUSTMENT')).toMatchObject({ statusLabel: 'Erstattungsnachweis · fachlich ungeprüft', amountCents: '2500', balance: { state: 'KNOWN', openCents: '0' } });
    expect(result.entries.find(entry => entry.kind === 'DOCUMENT' && entry.document.id === source.id)).toMatchObject({ statusLabel: 'Rechnung storniert · keine Forderung', balance: { state: 'KNOWN', openCents: '0' } });
    expect(result.entries.find(entry => entry.document.id === basis.id)?.balance.state).toBe('NOT_APPLICABLE');
  });

  it('fails closed for mixed related evidence and capped evidence, without exposing private fields', async () => {
    const own = await customer(); const source = await document(own.id);
    await db.client.income.create({ data: { userId: 'timeline-foreign', invoiceId: source.id, customerId: own.id, amount: 100, description: 'FOREIGN SECRET' } });
    const result = await page(own.id);
    expect(result.entries[0].balance).toEqual({ state: 'REVIEW', openCents: null });
    expect(JSON.stringify(result)).not.toContain('FOREIGN SECRET');
    const invoice = await db.client.$transaction(tx => ownedInvoice(tx, owner, source.id));
    invoice.incomes = Array.from({ length: CUSTOMER_TIMELINE_EVIDENCE_LIMIT + 1 }, () => invoice.incomes[0]);
    expect(await timelineBalance(invoice)).toEqual({ state: 'REVIEW', openCents: null });
    expect(Object.keys(result.entries[0].document).sort()).toEqual(['href', 'id', 'number', 'status', 'type']);
  });

  it('retains the selected payment date/certainty even outside the bounded full-ledger evidence', async () => {
    const own = await customer(); const source = await document(own.id);
    const eventIds: number[] = [];
    for (let index = 0; index < CUSTOMER_TIMELINE_EVIDENCE_LIMIT + 2; index++) {
      const income = await db.client.income.create({ data: { userId: owner, customerId: own.id, invoiceId: source.id, amount: 0.01, date: new Date('2026-10-02'), description: 'Synthetic oversized ledger evidence' } });
      const event = await db.client.paymentJournalEvent.create({ data: { userId: owner, invoiceId: source.id, incomeId: income.id, amountCents: '1', paidAt: income.date, dateCertainty: 'ACTUAL', source: 'MANUAL', reference: 'Synthetic oversized ledger evidence', idempotencyKey: `timeline-large-${++next}`, createdAt: when } });
      eventIds.push(event.id);
    }
    const result = await page(own.id);
    expect(result.entries[0]).toMatchObject({ key: `1:${eventIds.at(-1)}`, businessDate: '2026-10-02T00:00:00.000Z', dateCertainty: 'ACTUAL', amountCents: null, balance: { state: 'REVIEW', openCents: null } });
  });

  it('bounds and validates queries, and returns a sanitized retriable server error', async () => {
    const own = await customer();
    for (const id of ['NaN', '0', '-1', '1.5', '999999999999999999999']) expect((await GET(new Request('http://localhost'), context(id))).status).toBe(400);
    for (const suffix of ['?cursor=', '?cursor=garbage', '?cursor=a&cursor=b', '?limit=1000000', `?cursor=${'a'.repeat(1100)}`]) {
      expect((await GET(new Request(`http://localhost/${suffix}`), context(own.id))).status).toBe(400);
    }
    const broken = vi.spyOn(db.client, '$transaction').mockRejectedValueOnce(new Error('SECRET SQL PATH'));
    try {
      const response = await GET(new Request('http://localhost'), context(own.id));
      expect(response.status).toBe(500); expect(await response.text()).not.toContain('SECRET');
    } finally { broken.mockRestore(); }
    expect((await page(own.id)).entries).toEqual([]);
  });
});
