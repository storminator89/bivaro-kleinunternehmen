import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as unknown, userId: '', writes: 0 }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({ requireUserId: async () => state.userId, UnauthorizedError: class extends Error {}, unauthorizedResponse: () => new Response(null, { status: 401 }) }));
vi.mock('@/lib/upload-path', () => ({ writeTenantFile: vi.fn(async () => `synthetic-service-boundary-${++state.writes}.xml`), deleteTenantFile: vi.fn(async () => {}) }));

import { generateApiKey } from '@/lib/api-auth';
import { previewReminder, recordReminder } from '@/lib/reminder-workbench';
import { POST as previewReminderRoute } from '@/app/api/reminders/preview/route';
import { POST as downloadReminderRoute } from '@/app/api/reminders/download/route';
import { createServiceBillingPlan, reviewServiceBillingPeriod } from '@/lib/service-billing-service';
import { serviceBillingDraftToken } from '@/lib/server/service-billing-draft';
import { GET as getKpis } from '@/app/api/dashboard/kpis/route';
import { GET as getInvoices } from '@/app/api/invoices/route';
import { POST as upload } from '@/app/api/invoices/upload/route';
import { GET as getWebReminders, POST as postWebReminder } from '@/app/api/reminders/route';
import { GET as getApiReminders, POST as postApiReminder } from '@/app/api/v1/reminders/route';

let database: ReturnType<typeof createTestDatabase>;
let customerId: number;
let apiKey: string;
beforeAll(() => { database = createTestDatabase(); state.client = database.client; }, 40_000);
beforeEach(async () => {
  state.userId = `service-financial-${randomUUID()}`;
  await database.client.user.create({ data: { id: state.userId, email: `${state.userId}@example.invalid`, password: 'unused fixture' } });
  customerId = (await database.client.customer.create({ data: { userId: state.userId, name: 'Synthetic service boundary customer' } })).id;
  const generated = generateApiKey(); apiKey = generated.key;
  await database.client.apiKey.create({ data: { userId: state.userId, name: 'Synthetic test-only key', keyHash: generated.keyHash, keyPrefix: generated.keyPrefix, scopes: '["read","write"]' } });
});
afterAll(async () => { await database?.cleanup(); });

const get = (path: string) => new NextRequest(`http://localhost${path}`);
const webPost = (invoiceId: number) => new Request('http://localhost/api/reminders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invoiceId, fee: 5, dueDays: 7 }) });
const apiRequest = (method: string, query = '', invoiceId?: number) => new NextRequest(`http://localhost/api/v1/reminders${query}`, { method, headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, ...(invoiceId ? { body: JSON.stringify({ invoiceId, fee: 5, dueDays: 7 }) } : {}) });
async function draft() {
  const created = await createServiceBillingPlan(state.userId, { name: 'Synthetic recurring support', customerId, cadence: 'MONTHLY', anchorDate: '2020-01-31', taxMode: 'standard', items: [{ description: 'Synthetic support', quantity: 1, unitPrice: 100, unit: 'Pauschal', taxRate: 19 }] });
  const result = await reviewServiceBillingPeriod(state.userId, { planId: created.id, revision: 1, periodIndex: 0, action: 'GENERATE', confirmed: true }, '2026-10-21');
  return database.client.invoice.findUniqueOrThrow({ where: { id: result.invoiceId! } });
}
async function ordinaryInvoice() {
  return database.client.invoice.create({ data: { userId: state.userId, customerId, type: 'INVOICE', status: 'SENT', issuanceState: 'ISSUED', fileName: 'synthetic-issued.xml', storedFileName: 'synthetic-issued.xml', invoiceNumber: `SYNTHETIC-${randomUUID()}`, invoiceDate: new Date('2020-01-01'), dueDate: new Date('2020-01-15'), totalAmount: 25.5, parsedData: { currency: 'EUR' } } });
}
async function businessState() {
  return { invoices: await database.client.invoice.findMany({ where: { userId: state.userId }, orderBy: { id: 'asc' } }), reminders: await database.client.reminder.count({ where: { userId: state.userId } }), incomes: await database.client.income.count({ where: { userId: state.userId } }), payments: await database.client.paymentJournalEvent.count({ where: { userId: state.userId } }), audit: await database.client.auditLog.count({ where: { userId: state.userId } }) };
}
async function kpis() { const response = await getKpis(get('/api/dashboard/kpis')); expect(response.status).toBe(200); return response.json(); }

describe('planning drafts are not receivables or reminders before conscious native rendering', () => {
  it('leaves the receivable subtotal unchanged and keeps the ordinary invoice and planning record visible', async () => {
    const ordinary = await ordinaryInvoice();
    expect(await kpis()).toMatchObject({ openInvoices: 25.5, openInvoicesReviewRequired: 0 });
    const planned = await draft(); const before = await businessState();
    expect(await kpis()).toMatchObject({ openInvoices: 25.5, openInvoicesReviewRequired: 0 });
    const listing = await getInvoices(new Request('http://localhost/api/invoices?pageSize=100'));
    expect((await listing.json()).items.map((row: { id: number }) => row.id).sort()).toEqual([ordinary.id, planned.id].sort());
    expect(await businessState()).toEqual(before);
  });
  it('excludes valid and malformed planning markers from web/v1 reminders and their fee totals', async () => {
    const ordinary = await ordinaryInvoice(); const valid = await draft(); const malformed = await draft(); const legacyString = await draft();
    await database.client.invoice.update({ where: { id: malformed.id }, data: { parsedData: { _serviceBillingDraft: null }, dueDate: new Date('2020-01-15') } });
    await database.client.invoice.update({ where: { id: legacyString.id }, data: { parsedData: JSON.stringify({ _serviceBillingDraft: null }) } });
    await database.client.reminder.create({ data: { userId: state.userId, invoiceId: malformed.id, fee: 99, dueDate: new Date('2020-02-01') } });
    const before = await businessState();
    const web = await getWebReminders(new Request('http://localhost/api/reminders?includeAll=true'));
    expect(web.status).toBe(200); const webBody = await web.json();
    expect(webBody.invoices.map((row: { id: number }) => row.id)).toEqual([ordinary.id]);
    expect(webBody.stats).toMatchObject({ totalOverdue: 1, totalAmount: 25.5, totalFees: 0 });
    const api = await getApiReminders(apiRequest('GET', '?includeAll=true'));
    expect(api.status).toBe(200); const apiBody = (await api.json()).data;
    expect(apiBody.invoices.map((row: { id: number }) => row.id)).toEqual([ordinary.id]);
    expect(apiBody.stats).toMatchObject({ totalOverdue: 1, totalAmount: 25.5, totalFees: 0 });
    for (const id of [valid.id, malformed.id, legacyString.id]) {
      const one = await getApiReminders(apiRequest('GET', `?invoiceId=${id}`)); expect(one.status).toBe(200); expect((await one.json()).data.invoices).toEqual([]);
    }
    expect(await businessState()).toEqual(before);
  });
  it.each(['valid', 'null-marker', 'truncated-marker', 'json-string-marker'] as const)('rejects both reminder POSTs for %s without fee, audit or invoice mutation', async kind => {
    const planned = await draft();
    if (kind !== 'valid') await database.client.invoice.update({ where: { id: planned.id }, data: { parsedData: kind === 'json-string-marker' ? JSON.stringify({ _serviceBillingDraft: null }) : { _serviceBillingDraft: kind === 'null-marker' ? null : { version: 1 } } } });
    const before = await businessState();
    const web = await postWebReminder(webPost(planned.id)); expect(web.status).toBe(409); expect(await web.json()).toMatchObject({ code: 'SERVICE_DRAFT_NOT_RENDERED' });
    const api = await postApiReminder(apiRequest('POST', '', planned.id)); expect(api.status).toBe(409); expect((await api.json()).error.code).toBe('SERVICE_DRAFT_NOT_RENDERED');
    expect(await businessState()).toEqual(before);
  });
  it.each(['valid', 'null-marker', 'truncated-marker', 'json-string-marker'] as const)('blocks the combined reminder workbench preview, TXT and direct command for %s without writes', async kind => {
    const planned = await draft();
    if (kind !== 'valid') await database.client.invoice.update({ where: { id: planned.id }, data: { parsedData: kind === 'json-string-marker' ? JSON.stringify({ _serviceBillingDraft: null }) : { _serviceBillingDraft: kind === 'null-marker' ? null : { version: 1 } } } });
    const before = await businessState();
    await expect(previewReminder(state.userId, planned.id, { fee: 5 })).rejects.toMatchObject({ status: 409, code: 'SERVICE_DRAFT_NOT_RENDERED' });
    for (const handler of [previewReminderRoute, downloadReminderRoute]) {
      const response = await handler(webPost(planned.id));
      expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'SERVICE_DRAFT_NOT_RENDERED' });
    }
    await expect(recordReminder(state.userId, planned.id, { fee: 5 })).rejects.toMatchObject({ status: 409, code: 'SERVICE_DRAFT_NOT_RENDERED' });
    expect(await businessState()).toEqual(before);
  });
  it('preserves a prior confirmed reminder replay before fresh eligibility, but blocks new commands on later malformed marker evidence', async () => {
    const ordinary = await ordinaryInvoice();
    const preview = await previewReminder(state.userId, ordinary.id);
    const input = { expectedBalanceVersion: preview.balanceVersion, idempotencyKey: 'combined-service-prior-confirmed', fee: 0 };
    const initial = await recordReminder(state.userId, ordinary.id, input);
    await database.client.invoice.update({ where: { id: ordinary.id }, data: { parsedData: JSON.stringify({ _serviceBillingDraft: null }) } });
    const before = await businessState();
    expect(await recordReminder(state.userId, ordinary.id, input)).toMatchObject({ id: initial.id, replayed: true, balanceSnapshot: initial.balanceSnapshot });
    await expect(recordReminder(state.userId, ordinary.id, { ...input, idempotencyKey: 'combined-service-new-confirmed' })).rejects.toMatchObject({ code: 'SERVICE_DRAFT_NOT_RENDERED' });
    await expect(previewReminder(state.userId, ordinary.id)).rejects.toMatchObject({ code: 'SERVICE_DRAFT_NOT_RENDERED' });
    expect(await businessState()).toEqual(before);
  });
  it.each(['object', 'json-string'] as const)('flags a malformed %s marker for review, never as a confirmed receivable', async kind => {
    await ordinaryInvoice(); const malformed = await draft();
    await database.client.invoice.update({ where: { id: malformed.id }, data: { parsedData: kind === 'json-string' ? JSON.stringify({ _serviceBillingDraft: null }) : { _serviceBillingDraft: { version: 1 } } } });
    const before = await businessState();
    expect(await kpis()).toMatchObject({ openInvoices: 25.5, openInvoicesReviewRequired: 1 });
    expect(await businessState()).toEqual(before);
  });
  it('restores ordinary KPI and reminder behavior after native file rendering replaces the SAME invoice', async () => {
    const planned = await draft(); const requestId = randomUUID();
    const form = new FormData();
    form.append('file', new File(['<Invoice><ID>SYNTHETIC-SERVICE-BOUNDARY-RENDER</ID><IssueDate>2020-01-01</IssueDate><DueDate>2020-01-15</DueDate><DocumentCurrencyCode>EUR</DocumentCurrencyCode><AccountingCustomerParty><Party><PartyName><Name>Synthetic service boundary customer</Name></PartyName></Party></AccountingCustomerParty><LegalMonetaryTotal><TaxInclusiveAmount currencyID="EUR">119</TaxInclusiveAmount><PayableAmount currencyID="EUR">119</PayableAmount></LegalMonetaryTotal></Invoice>'], 'synthetic-render.xml', { type: 'application/xml' }));
    form.append('generatedRequestId', requestId); form.append('serviceDraftId', String(planned.id)); form.append('serviceDraftToken', serviceBillingDraftToken(planned.parsedData, planned.customerId)); form.append('selectedCustomerId', String(customerId));
    const rendered = await upload(new NextRequest('http://localhost/api/invoices/upload', { method: 'POST', body: form }));
    expect(rendered.status).toBe(200); expect(await rendered.json()).toMatchObject({ id: planned.id, status: 'DRAFT', issuanceState: 'UNKNOWN' });
    expect(await database.client.invoice.count({ where: { userId: state.userId } })).toBe(1);
    expect(await kpis()).toMatchObject({ openInvoices: 119, openInvoicesReviewRequired: 0 });
    const webList = await getWebReminders(new Request('http://localhost/api/reminders?includeAll=true'));
    expect((await webList.json()).invoices).toEqual([expect.objectContaining({ id: planned.id, canCreateReminder: true, openAmount: 119 })]);
    const apiList = await getApiReminders(apiRequest('GET', `?invoiceId=${planned.id}`));
    expect((await apiList.json()).data.invoices).toEqual([expect.objectContaining({ id: planned.id, canCreateReminder: true, openAmount: 119 })]);
    expect((await postWebReminder(webPost(planned.id))).status).toBe(200);
    expect((await postApiReminder(apiRequest('POST', '', planned.id))).status).toBe(201);
    expect(await database.client.reminder.count({ where: { userId: state.userId } })).toBe(2);
    expect(await database.client.income.count({ where: { userId: state.userId } })).toBe(0);
    expect(await database.client.paymentJournalEvent.count({ where: { userId: state.userId } })).toBe(0);
    expect(await database.client.invoice.findUniqueOrThrow({ where: { id: planned.id } })).toMatchObject({ status: 'DRAFT', issuanceState: 'UNKNOWN', paidAt: null });
  });
});
