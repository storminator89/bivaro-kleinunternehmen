import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, userId: 'revenue-basis-a', authenticated: true }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return { UnauthorizedError, requireUserId: vi.fn(async () => { if (!state.authenticated) throw new UnauthorizedError(); return state.userId; }), unauthorizedResponse: () => new Response('{}', { status: 401 }) };
});
import { GET as getKpis } from '@/app/api/dashboard/kpis/route';
import { GET as getTaxSummary } from '@/app/api/tax-summary/route';
import { NextRequest } from 'next/server';
let database: ReturnType<typeof createTestDatabase>;
const request = (url = '/dashboard/kpis') => new NextRequest(`http://localhost/api${url}`);
const context = { contextYear: 2026, effectiveFrom: '2026-01-01', foundingYear: 2020, previousYearTurnoverCents: '2400000', previousYearExternalTurnoverCents: '1000000', completeness: 'COMPLETE', sourceNote: 'Synthetic prior-year records' };

beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-21T08:00:00.000Z'));
  await database.client.user.createMany({ data: ['revenue-basis-a', 'revenue-basis-b'].map(id => ({ id, email: `${id}@example.test`, password: 'unused' })) });
  await database.client.income.createMany({ data: [
    { userId: state.userId, description: 'Prior-year income', amount: 12000, date: new Date('2025-01-15T12:00:00Z') },
    { userId: state.userId, description: 'Current income', amount: 1000, date: new Date('2026-01-15T12:00:00Z') },
    { userId: state.userId, description: 'Future current-year income', amount: 999, date: new Date('2026-12-15T12:00:00Z') },
    { userId: state.userId, description: 'Private income', amount: 777, date: new Date('2026-01-15T12:00:00Z'), taxRelevant: false },
    { userId: 'revenue-basis-b', description: 'Other tenant', amount: 999999, date: new Date('2026-01-15T12:00:00Z') },
  ] });
  const paid = await database.client.invoice.create({ data: { userId: state.userId, fileName: 'paid.pdf', storedFileName: 'paid.pdf', parsedData: {}, totalAmount: 250, status: 'PAID', paidAt: new Date('2026-02-15T12:00:00Z') } });
  const unpaid = await database.client.invoice.create({ data: { userId: state.userId, fileName: 'sent.pdf', storedFileName: 'sent.pdf', parsedData: {}, totalAmount: 100, status: 'SENT' } });
  await database.client.income.createMany({ data: [
    { userId: state.userId, description: 'Paid in following year', amount: 250, date: new Date('2025-12-15T12:00:00Z'), invoiceId: paid.id },
    { userId: state.userId, description: 'Unpaid invoice', amount: 100, date: new Date('2026-02-15T12:00:00Z'), invoiceId: unpaid.id },
  ] });
  await database.client.annualBusinessContextRevision.create({ data: { userId: 'revenue-basis-b', revision: 1, ...context, sourceNote: 'Foreign source must not leak' } });
}, 40_000);
afterAll(async () => { vi.useRealTimers(); await database?.cleanup(); });

async function financialSnapshot() {
  return { users: await database.client.user.findMany({ orderBy: { id: 'asc' } }), incomes: await database.client.income.findMany({ orderBy: { id: 'asc' } }), expenses: await database.client.expense.findMany(), invoices: await database.client.invoice.findMany({ orderBy: { id: 'asc' } }), settings: await database.client.settings.findMany(), payments: await database.client.paymentJournalEvent.findMany() };
}

describe('tenant-scoped read-only annual-context dashboard basis', () => {
  it('requires authentication before loading context', async () => {
    state.authenticated = false;
    expect((await getKpis(request())).status).toBe(401);
    state.authenticated = true;
  });
  it('retains receipt-year cash selectors and distinguishes known in-app zero from unknown business total', async () => {
    const response = await getKpis(request()); const data = await response.json();
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(data.revenueBasis).toMatchObject({ year: 2026, previousYear: 2025, inAppRevenue: 1250, previousYearInAppRevenue: 12000, externalRevenue: null, businessTotal: null, context: null });
    expect(data.revenueThisYear).toBe(2249); // existing all-year KPI unchanged
    expect(data.yearComparison.revenueThisYearToDate).toBe(1250);
    const historical = await (await getKpis(request('/dashboard/kpis?year=2025'))).json();
    expect(historical.yearComparison.revenueThisYearToDate).toBe(12000);
    expect(historical.revenueBasis).toEqual(data.revenueBasis); // selector belongs only to comparison chart
  });
  it('selects effective corrections, excludes future context and never changes financial data or tax summary totals', async () => {
    const before = await financialSnapshot();
    const baseline = await (await getTaxSummary(request('/tax-summary?year=2026&timeRange=thisYear'))).json();
    await database.client.annualBusinessContextRevision.createMany({ data: [
      { userId: state.userId, revision: 1, ...context },
      { userId: state.userId, revision: 2, ...context, effectiveFrom: '2026-10-21', previousYearTurnoverCents: null, completeness: 'PARTIAL', sourceNote: 'Corrected unknown total' },
      { userId: state.userId, revision: 3, ...context, effectiveFrom: '2026-12-01', sourceNote: 'Not yet effective' },
    ] });
    const data = await (await getKpis(request())).json();
    expect(data.revenueBasis).toMatchObject({ context: { revision: 2, previousYearTurnoverCents: null, previousYearExternalTurnoverCents: '1000000', provenance: 'USER_DECLARED' }, pendingRevision: 3, inAppRevenue: 1250, businessTotal: null });
    expect(JSON.stringify(data)).not.toContain('Foreign source');
    const afterSummary = await (await getTaxSummary(request('/tax-summary?year=2026&timeRange=thisYear'))).json();
    expect(afterSummary).toMatchObject({ inputScope: 'IN_APP_ONLY', externalDataIncluded: false, totalIncome: baseline.totalIncome, totalExpenses: baseline.totalExpenses, profit: baseline.profit });
    expect(afterSummary.warnings.join(' ')).toContain('nicht die Vollständigkeit Ihrer Unternehmensdaten');
    expect(await financialSnapshot()).toEqual(before);
  });
});
