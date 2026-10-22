import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, actor: 'terms-owner' as string | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    requireUserId: async () => { if (!state.actor) throw new UnauthorizedError(); return state.actor; },
    unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  };
});
// Exercise the actual parser, routes and database transactions without touching
// repository/production upload storage. All business records use a fresh DB.
vi.mock('@/lib/upload-path', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/upload-path')>(),
  writeTenantFile: vi.fn(async () => 'synthetic-payment-term.xml'),
  deleteTenantFile: vi.fn(async () => undefined),
}));

import { GET as getSettings, POST as saveSettings } from '@/app/api/settings/route';
import { GET as getCustomers, POST as createCustomer, PUT as updateCustomer } from '@/app/api/customers/route';
import { GET as getHistory } from '@/app/api/change-history/route';
import { POST as importInvoice } from '@/app/api/invoices/route';
import { POST as createQuote } from '@/app/api/quotes/route';
import { POST as uploadInvoice } from '@/app/api/invoices/upload/route';
import { createServiceBillingPlan, reviewServiceBillingPeriod } from '@/lib/service-billing-service';
import { writeTenantFile } from '@/lib/upload-path';

let database: ReturnType<typeof createTestDatabase>;
const owner = 'terms-owner';
const other = 'terms-other';
const invoiceDate = '2026-09-18';

function jsonRequest(url: string, body: unknown, method = 'POST') {
  return new Request(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
}
const settings = (body: unknown) => saveSettings(jsonRequest('/api/settings', body));
const customer = (body: unknown) => createCustomer(jsonRequest('/api/customers', body));
const editCustomer = (body: unknown) => updateCustomer(jsonRequest('/api/customers', body, 'PUT'));

type Selection = { version: number; source: string; days: number | null; invoiceDate: string; dueDate: string | null; customerId: number | null };
function selection(overrides: Partial<Selection> = {}): Selection {
  return { version: 1, source: 'FALLBACK', days: 14, invoiceDate, dueDate: '2026-10-02', customerId: null, ...overrides };
}
function sourceXml(number: string, dueDate: string | null = '2026-10-02', name?: string) {
  return `<Invoice><ID>${number}</ID><IssueDate>${invoiceDate}</IssueDate>${dueDate ? `<DueDate>${dueDate}</DueDate>` : ''}<DocumentCurrencyCode>EUR</DocumentCurrencyCode>${name ? `<AccountingCustomerParty><Party><PartyName><Name>${name}</Name></PartyName></Party></AccountingCustomerParty>` : ''}<LegalMonetaryTotal><TaxInclusiveAmount currencyID="EUR">25</TaxInclusiveAmount><PayableAmount currencyID="EUR">25</PayableAmount></LegalMonetaryTotal></Invoice>`;
}
function uploadRequest(options: { number?: string; dueDate?: string | null; name?: string; requestId?: string | null; customerId?: number; term?: unknown; rawTerm?: string; extra?: Record<string, string> } = {}) {
  const form = new FormData();
  form.append('file', new File([sourceXml(options.number ?? `TERMS-${randomUUID()}`, options.dueDate === undefined ? '2026-10-02' : options.dueDate, options.name)], 'synthetic.xml', { type: 'application/xml' }));
  if (options.requestId !== null) form.append('generatedRequestId', options.requestId ?? randomUUID());
  if (options.customerId !== undefined) form.append('selectedCustomerId', String(options.customerId));
  if (options.term !== undefined) form.append('paymentTermSelection', JSON.stringify(options.term));
  if (options.rawTerm !== undefined) form.append('paymentTermSelection', options.rawTerm);
  for (const [key, value] of Object.entries(options.extra ?? {})) form.append(key, value);
  return new NextRequest('http://localhost/api/invoices/upload', { method: 'POST', body: form });
}

beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  await database.client.user.createMany({ data: [owner, other].map(id => ({ id, email: `${id}@test.invalid`, password: 'synthetic-unused' })) });
}, 40_000);
beforeEach(async () => {
  state.actor = owner;
  await database.client.settings.upsert({ where: { userId: owner }, create: { userId: owner }, update: { paymentTermDays: null } });
});
afterAll(async () => { await database?.cleanup(); });

describe('payment-term defaults API', () => {
  it.each([null, 0, 1, 14, 365])('persists and reads exact optional calendar-day default %s in both settings and customers', async days => {
    const saved = await settings({ paymentTermDays: days });
    expect(saved.status).toBe(200); expect(await saved.json()).toMatchObject({ paymentTermDays: days });
    expect(await (await getSettings()).json()).toMatchObject({ paymentTermDays: days });
    const created = await customer({ name: `Synthetic ${days}`, paymentTermDays: days });
    expect(created.status).toBe(200); const row = await created.json();
    expect(row.paymentTermDays).toBe(days);
    const edited = await editCustomer({ id: row.id, name: row.name, paymentTermDays: days });
    expect(edited.status).toBe(200); expect(await edited.json()).toMatchObject({ paymentTermDays: days });
    const listed = await (await getCustomers()).json() as Array<{ id: number; paymentTermDays: number | null }>;
    expect(listed.find(item => item.id === row.id)?.paymentTermDays).toBe(days);
  });

  it.each([-1, 366, 1.5, '14', '', false, {}, []])('rejects invalid default %j without mutating settings or customers', async days => {
    await settings({ paymentTermDays: 30 });
    const row = await (await customer({ name: 'Synthetic preserved', paymentTermDays: 7 })).json();
    const count = await database.client.customer.count();
    expect((await settings({ paymentTermDays: days })).status).toBe(400);
    expect((await customer({ name: 'Rejected synthetic', paymentTermDays: days })).status).toBe(400);
    expect((await editCustomer({ id: row.id, name: row.name, paymentTermDays: days })).status).toBe(400);
    expect((await database.client.settings.findUniqueOrThrow({ where: { userId: owner } })).paymentTermDays).toBe(30);
    expect((await database.client.customer.findUniqueOrThrow({ where: { id: row.id } })).paymentTermDays).toBe(7);
    expect(await database.client.customer.count()).toBe(count);
  });

  it('preserves an omitted update and distinguishes explicit null from zero', async () => {
    await settings({ paymentTermDays: 0 });
    expect(await (await settings({ companyName: 'Synthetic renamed' })).json()).toMatchObject({ paymentTermDays: 0 });
    const row = await (await customer({ name: 'Synthetic zero', paymentTermDays: 0 })).json();
    expect(await (await editCustomer({ id: row.id, name: 'Synthetic renamed' })).json()).toMatchObject({ paymentTermDays: 0 });
    expect(await (await settings({ paymentTermDays: null })).json()).toMatchObject({ paymentTermDays: null });
    expect(await (await editCustomer({ id: row.id, name: 'Synthetic cleared', paymentTermDays: null })).json()).toMatchObject({ paymentTermDays: null });
    expect(await (await customer({ name: 'Synthetic unset' })).json()).toMatchObject({ paymentTermDays: null });
  });

  it('isolates tenant reads and ignores a forged owner on profile writes', async () => {
    const foreignCustomer = await database.client.customer.create({ data: { name: 'Foreign synthetic', userId: other, paymentTermDays: 90 } });
    await database.client.settings.upsert({ where: { userId: other }, create: { userId: other, paymentTermDays: 90 }, update: { paymentTermDays: 90 } });
    const foreignSettings = await database.client.settings.findUnique({ where: { userId: other } });
    expect((await editCustomer({ id: foreignCustomer.id, name: 'Attempted mutation', paymentTermDays: 0, userId: other })).status).toBe(404);
    expect((await (await getCustomers()).json() as Array<{ id: number }>).some(row => row.id === foreignCustomer.id)).toBe(false);
    expect(await (await settings({ paymentTermDays: 3, userId: other })).json()).toMatchObject({ userId: owner, paymentTermDays: 3 });
    expect(await database.client.settings.findUnique({ where: { userId: other } })).toEqual(foreignSettings);
    expect(await database.client.customer.findUnique({ where: { id: foreignCustomer.id } })).toEqual(foreignCustomer);
    state.actor = other;
    expect(await (await getSettings()).json()).toMatchObject({ userId: other, paymentTermDays: 90 });
    state.actor = null;
    expect((await getSettings()).status).toBe(401); expect((await getCustomers()).status).toBe(401);
    expect((await settings({ paymentTermDays: 1 })).status).toBe(401);
    expect((await customer({ name: 'Unauthorized', paymentTermDays: 1 })).status).toBe(401);
  });

  it('never rewrites existing issued invoice dates, parsed evidence, financial data or document history', async () => {
    const row = await database.client.customer.create({ data: { name: 'Historical synthetic', userId: owner } });
    const invoice = await database.client.invoice.create({ data: { userId: owner, customerId: row.id, fileName: 'original.xml', storedFileName: 'original.xml', invoiceNumber: 'TERMS-HISTORICAL', status: 'SENT', issuanceState: 'ISSUED', invoiceDate: new Date('2026-01-31'), dueDate: new Date('2026-02-14'), totalAmount: 25, parsedData: { rawXml: '<original/>', dueDate: '2026-02-14', paymentTermSelection: selection({ invoiceDate: '2026-01-31', dueDate: '2026-02-14', customerId: row.id }) } } });
    await database.client.auditLog.create({ data: { userId: owner, entityType: 'Invoice', entityId: String(invoice.id), action: 'CREATE', newValues: '{"status":"SENT"}' } });
    const history = () => getHistory(new Request(`http://localhost/api/change-history?invoiceId=${invoice.id}`));
    const before = await (await history()).json();
    const financialSnapshot = { incomes: await database.client.income.findMany(), payments: await database.client.paymentJournalEvent.findMany(), counters: await database.client.invoiceNumberCounter.findMany() };
    expect((await settings({ paymentTermDays: 365 })).status).toBe(200);
    expect((await editCustomer({ id: row.id, name: row.name, paymentTermDays: 0 })).status).toBe(200);
    expect(await database.client.invoice.findUnique({ where: { id: invoice.id } })).toEqual(invoice);
    expect(await (await history()).json()).toEqual(before);
    expect({ incomes: await database.client.income.findMany(), payments: await database.client.paymentJournalEvent.findMany(), counters: await database.client.invoiceNumberCounter.findMany() }).toEqual(financialSnapshot);
  });
});

describe('generated invoice payment-term provenance', () => {
  it('accepts fallback and explicit company/customer defaults, preserving zero-day terms', async () => {
    expect((await uploadInvoice(uploadRequest({ term: selection() }))).status).toBe(200);
    await settings({ paymentTermDays: 7 });
    expect((await uploadInvoice(uploadRequest({ dueDate: '2026-09-25', term: selection({ source: 'COMPANY', days: 7, dueDate: '2026-09-25' }) }))).status).toBe(200);
    const row = await database.client.customer.create({ data: { name: 'Zero term synthetic', userId: owner, paymentTermDays: 0 } });
    const response = await uploadInvoice(uploadRequest({ dueDate: invoiceDate, name: row.name, customerId: row.id, term: selection({ source: 'CUSTOMER', days: 0, dueDate: invoiceDate, customerId: row.id }) }));
    expect(response.status).toBe(200);
    const invoice = await response.json();
    expect(invoice).toMatchObject({ customerId: row.id, dueDate: `${invoiceDate}T00:00:00.000Z`, parsedData: { paymentTermSelection: selection({ source: 'CUSTOMER', days: 0, dueDate: invoiceDate, customerId: row.id }) } });
  });

  it('permits a consciously manual date (including no due date) despite current defaults', async () => {
    await settings({ paymentTermDays: 365 });
    for (const dueDate of ['2026-09-19', null]) {
      const response = await uploadInvoice(uploadRequest({ dueDate, term: selection({ source: 'MANUAL', days: null, dueDate }) }));
      expect(response.status).toBe(200);
    }
  });

  it('returns 409 for a stale source/default without creating an invoice', async () => {
    await settings({ paymentTermDays: 30 });
    const count = await database.client.invoice.count();
    expect((await uploadInvoice(uploadRequest({ term: selection() }))).status).toBe(409);
    expect((await uploadInvoice(uploadRequest({ dueDate: '2026-09-25', term: selection({ source: 'COMPANY', days: 7, dueDate: '2026-09-25' }) }))).status).toBe(409);
    expect(await database.client.invoice.count()).toBe(count);
  });

  it('uses current defaults in the committing transaction, not the preflight customer/profile view', async () => {
    await settings({ paymentTermDays: 14 });
    const count = await database.client.invoice.count();
    vi.mocked(writeTenantFile).mockImplementationOnce(async () => {
      await database.client.settings.update({ where: { userId: owner }, data: { paymentTermDays: 30 } });
      return 'synthetic-raced-company.xml';
    });
    expect((await uploadInvoice(uploadRequest({ term: selection({ source: 'COMPANY' }) }))).status).toBe(409);
    const row = await database.client.customer.create({ data: { name: 'Race synthetic', userId: owner, paymentTermDays: 14 } });
    vi.mocked(writeTenantFile).mockImplementationOnce(async () => {
      await database.client.customer.update({ where: { id: row.id }, data: { paymentTermDays: 0 } });
      return 'synthetic-raced-customer.xml';
    });
    expect((await uploadInvoice(uploadRequest({ name: row.name, customerId: row.id, term: selection({ source: 'CUSTOMER', customerId: row.id }) }))).status).toBe(409);
    expect(await database.client.invoice.count()).toBe(count);
  });

  it('rejects company provenance if a selected customer now overrides it and accepts cleared customer fallback', async () => {
    await settings({ paymentTermDays: 14 });
    const row = await database.client.customer.create({ data: { name: 'Precedence synthetic', userId: owner, paymentTermDays: 0 } });
    const options = { name: row.name, customerId: row.id, term: selection({ source: 'COMPANY', customerId: row.id }) };
    expect((await uploadInvoice(uploadRequest(options))).status).toBe(409);
    await database.client.customer.update({ where: { id: row.id }, data: { paymentTermDays: null } });
    const response = await uploadInvoice(uploadRequest(options)); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ parsedData: { paymentTermSelection: options.term } });
  });

  it('normalizes an auto-created buyer reference without claiming a customer-specific default', async () => {
    const response = await uploadInvoice(uploadRequest({ name: `Auto buyer ${randomUUID()}`, term: selection() }));
    expect(response.status).toBe(200); const invoice = await response.json();
    expect(invoice.customerId).toBeGreaterThan(0);
    expect(invoice.parsedData.paymentTermSelection).toEqual(selection({ customerId: invoice.customerId }));
  });

  it('replays an already committed identical upload before checking changed current defaults', async () => {
    const options = { number: 'TERMS-IDEMPOTENT', requestId: randomUUID(), term: selection() };
    const first = await uploadInvoice(uploadRequest(options)); expect(first.status).toBe(200);
    const original = await first.json();
    const saved = await database.client.invoice.findUnique({ where: { id: original.id } });
    await settings({ paymentTermDays: 30 });
    const replay = await uploadInvoice(uploadRequest(options)); expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ id: original.id, idempotent: true });
    expect(await database.client.invoice.count({ where: { invoiceNumber: options.number, userId: owner } })).toBe(1);
    expect(await database.client.invoice.findUnique({ where: { id: original.id } })).toEqual(saved);
    expect((await uploadInvoice(uploadRequest({ ...options, term: selection({ source: 'MANUAL', days: null }) }))).status).toBe(409);
  });

  it.each([
    null, [], {}, ...['CUSTOMER', 'COMPANY', 'FALLBACK', 'MANUAL'].map(source => ({ ...selection(), source: [source] })), selection({ version: 2 }), selection({ source: 'UNKNOWN' }),
    selection({ days: -1 }), selection({ days: 1.5 }), selection({ days: 366 }),
    selection({ invoiceDate: '2026-02-30' }), selection({ dueDate: '2026-09-31' }),
    selection({ customerId: -1 }), selection({ source: 'CUSTOMER' }),
    selection({ source: 'MANUAL' }), { ...selection(), extra: 'not permitted' },
  ])('rejects malformed provenance %j before committing', async term => {
    const count = await database.client.invoice.count();
    expect((await uploadInvoice(uploadRequest({ term }))).status).toBe(400);
    expect(await database.client.invoice.count()).toBe(count);
  });

  it('rejects invalid JSON, unbounded metadata, and document date/customer mismatch', async () => {
    const count = await database.client.invoice.count();
    for (const rawTerm of ['{', ' '.repeat(20_000)]) expect((await uploadInvoice(uploadRequest({ rawTerm }))).status).toBe(400);
    expect((await uploadInvoice(uploadRequest({ requestId: null, term: selection() }))).status).toBe(400);
    expect((await uploadInvoice(uploadRequest({ term: selection({ invoiceDate: '2026-09-17', dueDate: '2026-10-01' }) }))).status).toBe(400);
    expect((await uploadInvoice(uploadRequest({ dueDate: '2026-10-03', term: selection() }))).status).toBe(400);
    const row = await database.client.customer.create({ data: { name: 'Selection mismatch synthetic', userId: owner } });
    expect((await uploadInvoice(uploadRequest({ name: row.name, customerId: row.id, term: selection() }))).status).toBe(400);
    const foreign = await database.client.customer.create({ data: { name: 'Foreign upload synthetic', userId: other, paymentTermDays: 0 } });
    expect((await uploadInvoice(uploadRequest({ name: foreign.name, customerId: foreign.id, dueDate: invoiceDate, term: selection({ source: 'CUSTOMER', customerId: foreign.id, days: 0, dueDate: invoiceDate }) }))).status).toBe(404);
    expect(await database.client.invoice.count()).toBe(count);
  });

  it('rejects reserved provenance on legacy invoice/quote creation before writing bytes, without breaking null compatibility', async () => {
    const before = await database.client.invoice.count();
    const writes = vi.mocked(writeTenantFile).mock.calls.length;
    const body = { fileName: 'synthetic.pdf', pdfBytes: Buffer.from('%PDF synthetic').toString('base64'), parsedData: { paymentTermSelection: selection() } };
    expect((await importInvoice(jsonRequest('/api/invoices', body))).status).toBe(400);
    expect((await createQuote(jsonRequest('/api/quotes', body))).status).toBe(400);
    expect(await database.client.invoice.count()).toBe(before);
    expect(vi.mocked(writeTenantFile).mock.calls.length).toBe(writes);
    const compatible = { ...body, parsedData: { paymentTermSelection: null }, invoiceDate, dueDate: '2026-10-02' };
    expect((await importInvoice(jsonRequest('/api/invoices', compatible))).status).toBe(200);
    expect((await createQuote(jsonRequest('/api/quotes', compatible))).status).toBe(200);
  });

  it('keeps legacy imported/generated uploads without an optional selection compatible', async () => {
    const response = await uploadInvoice(uploadRequest()); expect(response.status).toBe(200);
    const invoice = await response.json();
    expect(invoice.parsedData).not.toHaveProperty('paymentTermSelection');
    expect(invoice.dueDate).toBe('2026-10-02T00:00:00.000Z');
  });

  it('does not add defaults, dates or provenance to a newly planned service draft', async () => {
    await settings({ paymentTermDays: 30 });
    const row = await database.client.customer.create({ data: { name: 'Service plan synthetic', userId: owner, paymentTermDays: 0 } });
    const plan = await createServiceBillingPlan(owner, { name: 'Synthetic support', customerId: row.id, cadence: 'MONTHLY', anchorDate: '2026-01-31', taxMode: 'small-business', items: [{ description: 'Support', quantity: 1, unitPrice: 25, unit: 'Pauschale', taxRate: 0 }] });
    const made = await reviewServiceBillingPeriod(owner, { planId: plan.id, revision: 1, periodIndex: 0, action: 'GENERATE', confirmed: true }, '2026-10-21');
    const draft = await database.client.invoice.findUniqueOrThrow({ where: { id: made.invoiceId! } });
    expect(draft).toMatchObject({ invoiceDate: null, dueDate: null, invoiceNumber: null, storedFileName: '', status: 'DRAFT', issuanceState: 'UNISSUED' });
    expect(draft.parsedData).not.toHaveProperty('paymentTermSelection');
    expect((await uploadInvoice(uploadRequest({ term: selection(), extra: { serviceDraftId: String(draft.id), serviceDraftToken: 'a'.repeat(64) } }))).status).toBe(400);
    expect(await database.client.invoice.findUnique({ where: { id: draft.id } })).toEqual(draft);
  });
});
