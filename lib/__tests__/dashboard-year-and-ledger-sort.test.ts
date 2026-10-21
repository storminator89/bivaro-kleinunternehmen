import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, userId: 'year-sort-alice', authenticated: true }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    requireUserId: vi.fn(async () => {
      if (!state.authenticated) throw new UnauthorizedError();
      return state.userId;
    }),
    unauthorizedResponse: () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
  };
});

import { GET as getKpis } from '@/app/api/dashboard/kpis/route';
import { GET as getIncomes } from '@/app/api/incomes/route';
import { GET as getExpenses } from '@/app/api/expenses/route';

let database: ReturnType<typeof createTestDatabase>;
const alice = 'year-sort-alice';
const bob = 'year-sort-bob';
const request = (resource: string, query = '') => new NextRequest(`http://localhost/api/${resource}?${query}`);

beforeAll(async () => {
  database = createTestDatabase();
  state.client = database.client;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-18T12:00:00Z'));
  await database.client.user.createMany({ data: [alice, bob].map(id => ({ id, email: `${id}@example.test`, password: 'unused' })) });
  const customer = await database.client.customer.create({ data: { name: 'Sort Customer', userId: alice } });
  const amounts = [100, 2, 0.2, 100, 10];
  const descriptions = ['Delta', 'Bravo', 'Echo', 'Charlie', 'Alpha'];
  for (let index = 0; index < amounts.length; index++) {
    const common = { userId: alice, description: `Ledger ${descriptions[index]}`, amount: amounts[index], date: new Date(`2026-0${index + 1}-10T12:00:00Z`), taxRelevant: index !== 2 };
    await database.client.income.create({ data: { ...common, customerId: customer.id } });
    await database.client.expense.create({ data: { ...common, category: index === 4 ? 'Other' : 'Office' } });
  }
  await database.client.income.createMany({ data: [
    { userId: alice, description: 'Historical January', amount: 100, date: new Date('2024-01-10T12:00:00Z') },
    { userId: alice, description: 'Historical December', amount: 200, date: new Date('2024-12-31T12:00:00Z') },
    { userId: alice, description: 'Correction', amount: -25, date: new Date('2024-02-10T12:00:00Z') },
    { userId: alice, description: 'Previous December', amount: 50, date: new Date('2023-12-31T12:00:00Z') },
    { userId: alice, description: 'Private income', amount: 777, date: new Date('2024-06-10T12:00:00Z'), taxRelevant: false },
    { userId: bob, description: 'Ledger Another tenant', amount: 999999, date: new Date('2024-08-10T12:00:00Z') },
  ] });
  await database.client.expense.createMany({ data: [
    { userId: alice, description: 'Historical expense', amount: 80, date: new Date('2024-01-10T12:00:00Z') },
    { userId: alice, description: 'December expense', amount: 20, date: new Date('2024-12-31T12:00:00Z') },
    { userId: alice, description: 'Previous expense', amount: 10, date: new Date('2023-12-31T12:00:00Z') },
    { userId: bob, description: 'Ledger Another tenant', amount: 888888, date: new Date('2024-08-10T12:00:00Z') },
  ] });
  for (const status of ['PAID', 'SENT']) {
    const invoice = await database.client.invoice.create({ data: {
      userId: alice, fileName: `${status}.pdf`, storedFileName: `${status}.pdf`, parsedData: {},
      totalAmount: 40, status, paidAt: status === 'PAID' ? new Date('2025-01-10T12:00:00Z') : null,
    } });
    await database.client.income.create({ data: { userId: alice, invoiceId: invoice.id, description: status, amount: 40, date: new Date('2024-04-10T12:00:00Z') } });
  }
}, 40_000);

afterEach(() => { state.userId = alice; state.authenticated = true; });
afterAll(async () => { vi.useRealTimers(); await database?.cleanup(); });

describe('year comparison API', () => {
  it('preserves current-year defaults and keeps current KPIs unchanged when selecting a historical year', async () => {
    const baseline = await (await getKpis(new Request('http://localhost/api/dashboard/kpis'))).json();
    const selected = await (await getKpis(request('dashboard/kpis', 'year=2024'))).json();
    expect(baseline.yearComparison).toMatchObject({ currentYear: 2026, period: 'toDate', comparisonThroughMonth: 8 });
    expect(selected.yearComparison).toMatchObject({ currentYear: 2024, lastYear: 2023, period: 'fullYear', comparisonThroughMonth: 11, revenueThisYearToDate: 275, revenueLastYearToDate: 50, expensesThisYearToDate: 100, expensesLastYearToDate: 10 });
    expect(selected.yearComparison.monthlyDataThisYear).toHaveLength(12);
    expect(selected.yearComparison.monthlyDataThisYear[11]).toMatchObject({ revenue: 200, expenses: 20 });
    expect(selected.yearComparison.monthlyDataLastYear[11].revenue).toBe(50);
    const { yearComparison: _baselineComparison, operationalMovements: baselineMovements, ...baselineKpis } = baseline;
    const { yearComparison: _selectedComparison, operationalMovements: selectedMovements, ...selectedKpis } = selected;
    expect(selectedKpis).toEqual(baselineKpis);
    expect(selectedMovements.allTime).toEqual(baselineMovements.allTime);
    expect(selectedMovements.selectedYear.netMovementCents).toBe(String(Math.round(selected.yearComparison.revenueThisYearTotal * 100)));
  });

  it('keeps invoice receipts in the payment year and excludes unpaid and private income', async () => {
    const data = await (await getKpis(request('dashboard/kpis', 'year=2025'))).json();
    expect(data.yearComparison.revenueThisYearTotal).toBe(40);
    expect(data.yearComparison.revenueLastYearTotal).toBe(275);
    expect(data.yearComparison.monthlyDataThisYear[0].revenue).toBe(40);
  });

  it('returns real zero values for an empty year and exposes only this tenant’s available years', async () => {
    const empty = await (await getKpis(request('dashboard/kpis', 'year=1900'))).json();
    expect(empty.yearComparison.revenueThisYearTotal).toBe(0);
    expect(empty.yearComparison.monthlyDataThisYear.every((month: { revenue: number; expenses: number }) => month.revenue === 0 && month.expenses === 0)).toBe(true);
    state.userId = bob;
    const own = await (await getKpis(request('dashboard/kpis', 'year=2024'))).json();
    expect(own.yearComparison.revenueThisYearTotal).toBe(999999);
    expect(own.yearComparison.expensesThisYearTotal).toBe(888888);
    expect(own.yearComparison.availableYears).not.toContain(2023);
  });

  it.each(['', '2027', '1899', '2024.5', '2024x', 'NaN', '1e3'])('rejects invalid comparison year %j', async year => {
    expect((await getKpis(request('dashboard/kpis', `year=${year}`))).status).toBe(400);
  });
});

for (const resource of ['incomes', 'expenses'] as const) {
  const getList = resource === 'incomes' ? getIncomes : getExpenses;
  describe(`${resource} server ordering`, () => {
    it('sorts numeric amounts across pages before pagination and breaks ties with IDs', async () => {
      const first = await (await getList(request(resource, 'search=Ledger&sortBy=amount&sortOrder=desc&pageSize=2&page=1'))).json();
      const second = await (await getList(request(resource, 'search=Ledger&sortBy=amount&sortOrder=desc&pageSize=2&page=2'))).json();
      expect(first.total).toBe(5);
      expect(first.items.map((item: { amount: number }) => item.amount)).toEqual([100, 100]);
      expect(first.items[0].id).toBeGreaterThan(first.items[1].id);
      expect(second.items.map((item: { amount: number }) => item.amount)).toEqual([10, 2]);
      expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(4);
      const ascending = await (await getList(request(resource, 'search=Ledger&sortBy=amount&sortOrder=asc&pageSize=2'))).json();
      expect(ascending.items.map((item: { amount: number }) => item.amount)).toEqual([0.2, 2]);
    });

    it('combines search, period and tax filters with alphabetical ordering', async () => {
      const query = 'search=Ledger&dateRange=thisYear&taxRelevant=yes&sortBy=description&sortOrder=asc' + (resource === 'incomes' ? '&customer=Sort%20Customer' : '&category=Office');
      const data = await (await getList(request(resource, query))).json();
      expect(data.items.map((item: { description: string }) => item.description)).toEqual(resource === 'incomes' ? ['Ledger Alpha', 'Ledger Bravo', 'Ledger Charlie', 'Ledger Delta'] : ['Ledger Bravo', 'Ledger Charlie', 'Ledger Delta']);
      expect(data.total).toBe(resource === 'incomes' ? 4 : 3);
    });

    it('preserves default newest-first order and tenant isolation', async () => {
      const data = await (await getList(request(resource, 'search=Ledger'))).json();
      expect(data.items[0].description).toBe('Ledger Alpha');
      expect(data.items.every((item: { userId: string }) => item.userId === alice)).toBe(true);
      state.userId = bob;
      const other = await (await getList(request(resource, 'sortBy=amount&sortOrder=desc'))).json();
      expect(other.total).toBe(1);
      expect(other.items[0].userId).toBe(bob);
    });

    it.each(['sortBy=id', 'sortBy=amount&sortOrder=sideways', 'sortBy=', 'sortBy=date%3BDROP%20TABLE%20Income'])('rejects unapproved sort parameters: %s', async query => {
      expect((await getList(request(resource, query))).status).toBe(400);
    });
  });
}

it('still requires authentication before parsing comparison and sort options', async () => {
  state.authenticated = false;
  expect((await getKpis(request('dashboard/kpis', 'year=bad'))).status).toBe(401);
  expect((await getIncomes(request('incomes', 'sortBy=bad'))).status).toBe(401);
  expect((await getExpenses(request('expenses', 'sortBy=bad'))).status).toBe(401);
});
