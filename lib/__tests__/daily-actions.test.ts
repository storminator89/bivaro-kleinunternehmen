import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { createTestDatabase } from './helpers/database';
import { readDailyActions } from '@/lib/daily-actions/service';
import { recordFullPayment } from '@/lib/payment-journal/service';
import { parseBusinessDate } from '@/lib/business-date';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, userId: 'daily-owner', authenticated: true }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return { requireUserId: async () => { if (!state.authenticated) throw new UnauthorizedError(); return state.userId; }, UnauthorizedError, unauthorizedResponse: () => new Response(null, { status: 401 }) };
});
import { GET } from '@/app/api/daily-actions/route';
import { GET as invoiceList } from '@/app/api/invoices/route';
import { GET as quoteList } from '@/app/api/quotes/route';

let db: ReturnType<typeof createTestDatabase>;
const now = new Date('2026-10-21T10:00:00.000Z');
let sequence = 0;
async function tenant() {
  const id = `daily-${++sequence}`;
  await db.client.user.create({ data: { id, email: `${id}@synthetic.invalid`, password: 'unused' } });
  return id;
}
async function invoice(userId: string, overrides: Partial<Prisma.InvoiceUncheckedCreateInput> = {}) {
  return db.client.invoice.create({ data: { userId, fileName: 'synthetic-daily.pdf', storedFileName: 'synthetic-daily.pdf', invoiceNumber: `SYNTHETIC-${++sequence}`, parsedData: { currency: 'EUR' }, totalAmount: 120, status: 'SENT', issuanceState: 'ISSUED', dueDate: parseBusinessDate('2026-10-20'), ...overrides } });
}
async function receipt(userId: string, overrides: Partial<Prisma.PurchaseDocumentUncheckedCreateInput> = {}) {
  return db.client.purchaseDocument.create({ data: { userId, originalFileName: 'synthetic-receipt.png', storedFileName: 'synthetic-receipt.png', originalSha256: randomUUID().replaceAll('-', '').padEnd(64, 'a'), originalByteCount: 20, mediaType: 'image/png', uploadRequestId: randomUUID(), uploadedAt: new Date('2026-10-20T22:30:00Z'), parseStatus: 'FAILED', ...overrides } });
}
beforeAll(async () => { db = createTestDatabase(); state.client = db.client; }, 40_000);
afterAll(async () => { await db?.cleanup(); });

describe('evidence-based daily action read model', () => {
  it('orders concrete actions using journal remainder; deduplicates overlapping quote tasks and excludes closed/zero/foreign sources', async () => {
    const owner = await tenant(), other = await tenant();
    const partial = await invoice(owner);
    await recordFullPayment(owner, partial.id, { amount: '40.00', currency: 'EUR', paidAt: '2026-10-19', source: 'MANUAL', reference: 'Synthetic statement', idempotencyKey: randomUUID(), expectedPaidCents: '0' });
    const unknown = await invoice(owner, { paidAt: parseBusinessDate('2026-10-18') });
    const due = await invoice(owner, { dueDate: parseBusinessDate('2026-10-21') });
    const followUp = await invoice(owner, { type: 'QUOTE', quoteFollowUpOn: '2026-10-20', validUntil: parseBusinessDate('2026-10-19') });
    const accepted = await invoice(owner, { type: 'QUOTE', status: 'ACCEPTED', quoteFollowUpOn: '2020-01-01' });
    const draft = await receipt(owner, { reviewDraftSavedAt: now });
    for (const overrides of [{ status: 'PAID' }, { status: 'CANCELLED' }, { status: 'DRAFT', issuanceState: 'UNISSUED' }, { totalAmount: 0 }, { totalAmount: -20 }, { dueDate: parseBusinessDate('2026-10-22') }, { type: 'CREDIT_NOTE' }, { type: 'QUOTE', status: 'REJECTED', quoteFollowUpOn: '2020-01-01' }]) await invoice(owner, overrides);
    const converted = await invoice(owner, { type: 'QUOTE', status: 'ACCEPTED' });
    await invoice(owner, { convertedFromQuoteId: converted.id, dueDate: parseBusinessDate('2026-10-22') });
    await receipt(owner, { reviewStatus: 'BOOKED' }); await receipt(owner, { reviewStatus: 'DISMISSED' });
    await invoice(other); await receipt(other); await invoice(other, { type: 'QUOTE', status: 'ACCEPTED' });
    const result = await readDailyActions(owner, now);
    expect(result).toMatchObject({ businessDate: '2026-10-21', timeZone: 'Europe/Berlin', actionCount: 6, isPartial: false });
    expect(result.actions.map(row => row.id)).toEqual([partial, unknown, due, followUp, accepted, draft].map((row, index) => `${index < 3 ? 'invoice' : index < 5 ? 'quote' : 'receipt'}:${row.id}`));
    expect(result.actions[0]).toMatchObject({ amountCents: '8000', kind: 'INVOICE_OVERDUE', href: `/dashboard?tab=invoices&document=${partial.id}` });
    expect(result.actions[1]).toMatchObject({ amountCents: null, kind: 'INVOICE_REVIEW', amountLabel: 'Restbetrag ungeklärt' });
    expect(result.actions[4]).toMatchObject({ amountLabel: 'Angebotsbetrag · kein Umsatz', kind: 'QUOTE_READY' });
    expect(result.actions[5]).toMatchObject({ href: `/purchases?document=${draft.id}`, date: '2026-10-21' });
  });
  it('does not disclose foreign party names or treat unsupported-currency evidence as EUR debt', async () => {
    const owner = await tenant(), other = await tenant();
    const customer = await db.client.customer.create({ data: { userId: other, name: 'FOREIGN-SECRET-CUSTOMER' } });
    await invoice(owner, { customerId: customer.id });
    await invoice(owner, { parsedData: { currency: 'USD' } });
    await invoice(owner, { parsedData: { eInvoiceFormat: 'UBL', currency: 'EUR', prepaidAmount: 40 } });
    await invoice(owner, { parsedData: JSON.stringify({ currency: 'USD' }) });
    const result = await readDailyActions(owner, now);
    expect(result.actions).toHaveLength(4);
    expect(result.actions.every(row => row.kind === 'INVOICE_REVIEW' && row.amountCents === null && row.party === null)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(customer.name);
  });
  it('keeps AI failures and unknown/malformed evidence human-only; does not hide the saved draft or guess its money', async () => {
    const owner = await tenant();
    const hash = 'a'.repeat(64);
    const failed = await receipt(owner, { originalSha256: hash, revision: 1, reviewDraftSavedAt: now, aiExtraction: { version: 1, jobs: [{ id: randomUUID(), configVersion: 1, configRevision: randomUUID(), status: 'failed', sourceSha256: hash, sourceRevision: 1, createdAt: now.toISOString(), deadlineAt: now.toISOString(), finishedAt: now.toISOString(), errorCode: 'AI_TIMEOUT', result: null, draftApplied: false }] } });
    await receipt(owner, { aiExtraction: { unexpected: true } });
    const result = await readDailyActions(owner, now);
    expect(result.actions.every(row => row.title === 'Beleg manuell weiterprüfen' && row.amountCents === null)).toBe(true);
    expect(result.actions.find(row => row.id === `receipt:${failed.id}`)?.reason).toContain('kein automatischer Neuversuch');
  });
  it('projects exact receipt source scalars without trusting Float or materializing source/AI histories', async () => {
    const owner = await tenant();
    const hash = 'b'.repeat(64);
    const sentinel = 'SOURCE_AI_HISTORY_SENTINEL'.repeat(100_000);
    const fractional = await receipt(owner, { parseStatus: 'PARSED', currency: 'EUR', totalAmount: 100, parsedData: { grossAmount: '100.000000000000000001', lineItems: [{ description: sentinel }] } });
    const exact = await receipt(owner, { parseStatus: 'PARSED', currency: 'EUR', totalAmount: 999, parsedData: { grossAmount: '100.00' } });
    const zero = await receipt(owner, { parseStatus: 'PARSED', currency: 'EUR', totalAmount: 999, parsedData: { grossAmount: '0.00' } });
    const unsupported = await Promise.all([100, '1'.repeat(101)].map(grossAmount => receipt(owner, { parseStatus: 'PARSED', currency: 'EUR', totalAmount: 100, parsedData: { grossAmount } })));
    const ai = await receipt(owner, { originalSha256: hash, revision: 3, aiExtraction: { version: 1, jobs: [{ status: 'completed', sourceSha256: hash, sourceRevision: 1, result: { oversizedSentinel: sentinel } }] } });
    const mismatch = await receipt(owner, { originalSha256: 'c'.repeat(64), aiExtraction: { version: 1, jobs: [{ status: 'completed', sourceSha256: 'd'.repeat(64), sourceRevision: 0 }] } });
    const queries: string[] = [];
    db.client.$on('query', event => { queries.push(event.query); });
    const result = await readDailyActions(owner, now);
    expect(result.actions.find(row => row.id === `receipt:${fractional.id}`)?.amountCents).toBeNull();
    expect(result.actions.find(row => row.id === `receipt:${exact.id}`)?.amountCents).toBe('10000');
    expect(result.actions.find(row => row.id === `receipt:${zero.id}`)?.amountCents).toBe('0');
    for (const document of unsupported) expect(result.actions.find(row => row.id === `receipt:${document.id}`)?.amountCents).toBeNull();
    expect(result.actions.find(row => row.id === `receipt:${ai.id}`)).toMatchObject({ title: 'Eingangsbeleg prüfen', amountCents: null });
    expect(result.actions.find(row => row.id === `receipt:${ai.id}`)?.reason).toContain('nicht fachlich bewertet');
    expect(result.actions.find(row => row.id === `receipt:${ai.id}`)?.reason).toContain('weiterbearbeitet');
    expect(result.actions.find(row => row.id === `receipt:${mismatch.id}`)?.title).toBe('Beleg manuell weiterprüfen');
    expect(JSON.stringify(result)).not.toContain('SOURCE_AI_HISTORY_SENTINEL');
    expect(JSON.stringify(result).length).toBeLessThan(10_000);
    const receiptQueries = queries.filter(query => /SELECT/i.test(query) && /PurchaseDocument/.test(query));
    expect(receiptQueries.length).toBeGreaterThan(0);
    for (const query of receiptQueries) {
      expect(query).not.toMatch(/SELECT\s+\*/i);
      expect(query).not.toMatch(/(?:SELECT|,)\s*(?:"\w+"\.)*"(?:parsedData|aiExtraction|aiApprovedSnapshot)"(?=\s|,)/i);
      expect(query).not.toContain('lineItems'); expect(query).not.toContain('.result');
    }
    expect(queries.some(query => /\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(query))).toBe(false);
    expect(await db.client.expense.count({ where: { userId: owner } })).toBe(0);
    expect(await db.client.income.count({ where: { userId: owner } })).toBe(0);
    expect(await db.client.auditLog.count({ where: { userId: owner } })).toBe(0);
  });
  it('uses Berlin calendar boundaries and inclusive due/follow-up dates, including DST; stored dates never use host timezone', async () => {
    const owner = await tenant();
    await invoice(owner, { dueDate: parseBusinessDate('2026-10-21') });
    const early = await readDailyActions(owner, new Date('2026-10-20T21:59:59Z'));
    expect(early.businessDate).toBe('2026-10-20'); expect(early.actions).toHaveLength(0);
    const midnight = await readDailyActions(owner, new Date('2026-10-20T22:00:00Z'));
    expect(midnight.actions[0]).toMatchObject({ kind: 'INVOICE_DUE', date: '2026-10-21' });
    expect((await readDailyActions(owner, new Date('2026-10-25T23:00:00Z'))).businessDate).toBe('2026-10-26');
    await invoice(owner, { type: 'QUOTE', status: 'SENT', validUntil: parseBusinessDate('2026-10-21') });
    await invoice(owner, { type: 'QUOTE', status: 'SENT', quoteFollowUpOn: '2026-10-21' });
    await invoice(owner, { type: 'QUOTE', status: 'SENT', quoteFollowUpOn: '2000-invalid' });
    const today = await readDailyActions(owner, now);
    expect(today.actions.filter(row => row.kind.startsWith('QUOTE'))).toHaveLength(1);
  });
  it('re-reads fresh source state and performs no SQL writes or audit/financial side effects', async () => {
    const owner = await tenant();
    const source = await invoice(owner);
    const queries: string[] = [];
    db.client.$on('query', event => { queries.push(event.query); });
    expect((await readDailyActions(owner, now)).actionCount).toBe(1);
    expect(queries.some(query => /\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(query))).toBe(false);
    await db.client.invoice.update({ where: { id: source.id }, data: { status: 'CANCELLED' } });
    queries.length = 0;
    expect((await readDailyActions(owner, now)).actionCount).toBe(0);
    expect(queries.some(query => /\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(query))).toBe(false);
    expect(await db.client.income.count({ where: { userId: owner } })).toBe(0);
    expect(await db.client.expense.count({ where: { userId: owner } })).toBe(0);
    expect(await db.client.paymentJournalEvent.count({ where: { userId: owner } })).toBe(0);
    expect(await db.client.auditLog.count({ where: { userId: owner } })).toBe(0);
  });
  it('bounds source reads and returned actions with explicit partial-scope metadata', async () => {
    const owner = await tenant();
    await db.client.purchaseDocument.createMany({ data: Array.from({ length: 501 }, (_, index) => ({ userId: owner, originalFileName: `synthetic-${index}.png`, storedFileName: 'unused.png', originalSha256: String(index).padStart(64, 'a'), originalByteCount: 1, mediaType: 'image/png', uploadRequestId: randomUUID() })) });
    const result = await readDailyActions(owner, now);
    expect(result).toMatchObject({ isPartial: true, actionCount: 500 }); expect(result.actions).toHaveLength(50);
    expect((await readDailyActions(owner, now)).actions).toEqual(result.actions);
  });
  it('authenticates the GET, disables shared caches and exposes no mutation handler', async () => {
    const owner = await tenant(); state.userId = owner;
    const response = await GET();
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ actions: [], actionCount: 0 });
    state.authenticated = false;
    try { expect((await GET()).status).toBe(401); } finally { state.authenticated = true; }
    const route = await import('@/app/api/daily-actions/route');
    expect(Object.keys(route)).toEqual(['GET']);
  });
  it('returns a non-cached recoverable read error without source payloads, then succeeds on retry', async () => {
    state.userId = await tenant();
    const spy = vi.spyOn(db.client, '$transaction').mockRejectedValueOnce(new Error('SYNTHETIC-PRIVATE-DB-DETAIL'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const failed = await GET();
      expect(failed.status).toBe(500); expect(failed.headers.get('Cache-Control')).toBe('private, no-store');
      expect(await failed.json()).toEqual({ error: 'Die nächsten Schritte konnten nicht geladen werden.' });
    } finally { spy.mockRestore(); log.mockRestore(); }
    expect((await GET()).status).toBe(200);
  });
  it('resolves exact owned invoice/quote links; malformed and foreign IDs cannot broaden the target list', async () => {
    const owner = await tenant(), other = await tenant(); state.userId = owner;
    const ownInvoice = await invoice(owner), foreignInvoice = await invoice(other);
    const ownQuote = await invoice(owner, { type: 'QUOTE', status: 'ACCEPTED' });
    const foreignQuote = await invoice(other, { type: 'QUOTE', status: 'ACCEPTED' });
    for (const [handler, own, foreign, path] of [[invoiceList, ownInvoice, foreignInvoice, 'invoices'], [quoteList, ownQuote, foreignQuote, 'quotes']] as const) {
      const result = await (await handler(new Request(`http://localhost/api/${path}?document=${own.id}`))).json();
      expect(result.items.map((row: { id: number }) => row.id)).toEqual([own.id]);
      expect((await (await handler(new Request(`http://localhost/api/${path}?document=${foreign.id}`))).json()).items).toEqual([]);
      for (const id of ['', 'bad', '0', '-1', '9007199254740992']) expect((await handler(new Request(`http://localhost/api/${path}?document=${id}`))).status).toBe(400);
    }
  });
  it('redacts mismatched quote parties on exact links and cannot search another tenant party', async () => {
    const owner = await tenant(), other = await tenant(); state.userId = owner;
    const foreign = await db.client.customer.create({ data: { userId: other, name: 'FOREIGN-QUOTE-PARTY', email: 'foreign-secret@synthetic.invalid', internalNote: 'FOREIGN-PRIVATE-NOTE' } });
    const own = await db.client.customer.create({ data: { userId: owner, name: 'OWN-QUOTE-PARTY', email: 'own-private@synthetic.invalid' } });
    const mismatched = await invoice(owner, { type: 'QUOTE', status: 'ACCEPTED', customerId: foreign.id });
    const valid = await invoice(owner, { type: 'QUOTE', status: 'ACCEPTED', customerId: own.id });
    const daily = await readDailyActions(owner, now);
    expect(daily.actions.find(row => row.id === `quote:${mismatched.id}`)?.party).toBeNull();
    const response = await (await quoteList(new Request(`http://localhost/api/quotes?document=${mismatched.id}`))).json();
    expect(response.items).toHaveLength(1); expect(response.items[0].customer).toBeNull();
    expect(JSON.stringify(response)).not.toContain('FOREIGN-'); expect(JSON.stringify(response)).not.toContain(foreign.email);
    const owned = await (await quoteList(new Request(`http://localhost/api/quotes?document=${valid.id}`))).json();
    expect(owned.items[0].customer).toEqual({ id: own.id, name: own.name });
    expect(JSON.stringify(owned)).not.toContain(own.email);
    const search = await (await quoteList(new Request(`http://localhost/api/quotes?document=${mismatched.id}&search=FOREIGN-QUOTE-PARTY`))).json();
    expect(search.items).toEqual([]); expect(search.total).toBe(0);
  });
});
