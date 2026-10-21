import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as unknown, userId: '', writes: 0 }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({ requireUserId: async () => state.userId, UnauthorizedError: class extends Error {}, unauthorizedResponse: () => new Response(null, { status: 401 }) }));
vi.mock('@/lib/upload-path', () => ({ writeTenantFile: vi.fn(async () => `synthetic-daily-service-${++state.writes}.xml`), deleteTenantFile: vi.fn(async () => {}) }));

import { readDailyActions } from '@/lib/daily-actions/service';
import { createServiceBillingPlan, reviewServiceBillingPeriod } from '@/lib/service-billing-service';
import { serviceBillingDraftToken } from '@/lib/server/service-billing-draft';
import { updateInvoiceStatus } from '@/lib/invoice-payments';
import { POST as upload } from '@/app/api/invoices/upload/route';

let database: ReturnType<typeof createTestDatabase>;
let customerId: number;
const now = new Date('2026-10-21T10:00:00Z');
beforeAll(() => { database = createTestDatabase(); state.client = database.client; }, 40_000);
beforeEach(async () => {
  state.userId = `daily-service-${randomUUID()}`;
  await database.client.user.create({ data: { id: state.userId, email: `${state.userId}@example.invalid`, password: 'unused synthetic fixture' } });
  customerId = (await database.client.customer.create({ data: { userId: state.userId, name: 'Synthetic daily service customer' } })).id;
});
afterAll(async () => { await database?.cleanup(); });
async function draft() {
  const created = await createServiceBillingPlan(state.userId, { name: 'Synthetic recurring support', customerId, cadence: 'MONTHLY', anchorDate: '2020-01-31', taxMode: 'standard', items: [{ description: 'Synthetic support', quantity: 1, unitPrice: 100, unit: 'Pauschal', taxRate: 19 }] });
  const made = await reviewServiceBillingPeriod(state.userId, { planId: created.id, revision: 1, periodIndex: 0, action: 'GENERATE', confirmed: true }, '2026-10-21');
  return database.client.invoice.findUniqueOrThrow({ where: { id: made.invoiceId! } });
}
async function businessState() {
  return {
    invoices: await database.client.invoice.findMany({ where: { userId: state.userId }, orderBy: { id: 'asc' } }),
    plans: await database.client.serviceBillingPlan.findMany({ where: { userId: state.userId } }),
    periods: await database.client.serviceBillingPeriod.findMany({ where: { userId: state.userId } }),
    incomes: await database.client.income.count({ where: { userId: state.userId } }),
    payments: await database.client.paymentJournalEvent.count({ where: { userId: state.userId } }),
    reminders: await database.client.reminder.count({ where: { userId: state.userId } }),
    audits: await database.client.auditLog.count({ where: { userId: state.userId } }),
    providers: await database.client.aiProviderSettings.count({ where: { userId: state.userId } }),
  };
}

describe('daily read classifier in the recurring/balance union', () => {
  it('does not turn a valid no-file service DRAFT into debt or add an unapproved new task source', async () => {
    const planned = await draft();
    const ordinary = await database.client.invoice.create({ data: { userId: state.userId, fileName: 'synthetic-issued.xml', storedFileName: 'synthetic-issued.xml', invoiceNumber: 'SYNTHETIC-DAILY-ORDINARY', type: 'INVOICE', status: 'SENT', issuanceState: 'ISSUED', dueDate: new Date('2020-01-15'), totalAmount: 25.5, parsedData: { currency: 'EUR' } } });
    const before = await businessState(); const queries: string[] = [];
    database.client.$on('query', event => { queries.push(event.query); });
    const daily = await readDailyActions(state.userId, now);
    expect(daily.actions).toEqual([expect.objectContaining({ id: `invoice:${ordinary.id}`, kind: 'INVOICE_OVERDUE', amountCents: '2550' })]);
    expect(daily.actionCount).toBe(1); expect(daily.isPartial).toBe(false);
    expect(daily.actions.some(action => action.id === `invoice:${planned.id}`)).toBe(false);
    expect(queries.some(query => /\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(query))).toBe(false);
    expect(await businessState()).toEqual(before);
  });
  it.each(['object', 'json-string', 'zero-total'] as const)('fails closed on a malformed %s planning marker even if a stored SENT row is due', async kind => {
    const planned = await draft();
    await database.client.invoice.update({ where: { id: planned.id }, data: { status: 'SENT', dueDate: new Date('2020-01-15'), ...(kind === 'zero-total' ? { totalAmount: 0 } : {}), parsedData: kind === 'json-string' ? JSON.stringify({ _serviceBillingDraft: null }) : { _serviceBillingDraft: null } } });
    const before = await businessState();
    const result = await readDailyActions(state.userId, now);
    expect(result.actions).toEqual([expect.objectContaining({ id: `invoice:${planned.id}`, kind: 'INVOICE_REVIEW', title: 'Serviceentwurf klären', amountCents: null, amountLabel: 'Keine bestätigte Forderung', dateLabel: 'Gespeichertes Datum', href: `/dashboard?tab=invoices&document=${planned.id}` })]);
    expect(result.actions[0].reason).toContain('keine bestätigte Forderung');
    expect(result.actions[0].reason).toContain('keine Zahlung oder Mahnung');
    expect(await businessState()).toEqual(before);
  });
  it('keeps native same-ID rendered DRAFT out until explicit SENT status, then uses the ordinary exact remainder', async () => {
    const planned = await draft(); const form = new FormData();
    form.append('file', new File(['<Invoice><ID>SYNTHETIC-DAILY-SERVICE-RENDER</ID><IssueDate>2020-01-01</IssueDate><DueDate>2020-01-15</DueDate><DocumentCurrencyCode>EUR</DocumentCurrencyCode><AccountingCustomerParty><Party><PartyName><Name>Synthetic daily service customer</Name></PartyName></Party></AccountingCustomerParty><LegalMonetaryTotal><TaxInclusiveAmount currencyID="EUR">119</TaxInclusiveAmount><PayableAmount currencyID="EUR">119</PayableAmount></LegalMonetaryTotal></Invoice>'], 'synthetic-render.xml', { type: 'application/xml' }));
    form.append('generatedRequestId', randomUUID()); form.append('serviceDraftId', String(planned.id)); form.append('serviceDraftToken', serviceBillingDraftToken(planned.parsedData, planned.customerId)); form.append('selectedCustomerId', String(customerId));
    const rendered = await upload(new NextRequest('http://localhost/api/invoices/upload', { method: 'POST', body: form }));
    expect(rendered.status).toBe(200); expect(await rendered.json()).toMatchObject({ id: planned.id, status: 'DRAFT', issuanceState: 'UNKNOWN' });
    expect((await readDailyActions(state.userId, now)).actions).toEqual([]);
    // Deliberately invoke the existing explicit lifecycle path in this fixture;
    // the action-center GET itself never issues or changes a document.
    await updateInvoiceStatus(state.userId, planned.id, 'SENT');
    const before = await businessState();
    expect((await readDailyActions(state.userId, now)).actions).toEqual([expect.objectContaining({ id: `invoice:${planned.id}`, kind: 'INVOICE_OVERDUE', amountCents: '11900', amountLabel: 'Noch offen laut Journal' })]);
    expect(await database.client.invoice.count({ where: { userId: state.userId } })).toBe(1);
    expect(await businessState()).toEqual(before);
  });
});
