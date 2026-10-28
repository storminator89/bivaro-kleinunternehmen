import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  incomeFind: vi.fn(async () => []),
  expenseFind: vi.fn(async () => []),
}));
vi.mock('@/lib/get-user-id', () => ({
  requireUserId: async () => 'calendar-user',
  UnauthorizedError: class extends Error {},
  unauthorizedResponse: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/prisma', () => {
  const client = {
    income: { findMany: mocks.incomeFind, count: async () => 0 },
    expense: { findMany: mocks.expenseFind, count: async () => 0 },
    $transaction: async (callback: (tx: unknown) => unknown) => callback(client),
  };
  return { prisma: client };
});
vi.mock('@/lib/payment-journal/consumer-guard', () => ({ assertPositiveOnlySnapshot: async () => {}, PaymentAdjustmentConsumerError: class extends Error {} }));
vi.mock('@/lib/payment-journal/allocation-ledger', () => ({ loadInvoicePaymentStates: async () => new Map() }));

import { GET as incomes } from '@/app/api/incomes/route';
import { GET as expenses } from '@/app/api/expenses/route';
import { GET as incomeExport } from '@/app/api/incomes/export/route';
import { GET as expenseExport } from '@/app/api/expenses/export/route';

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('ledger list and export calendar filters', () => {
  it.each([
    ['incomes', incomes, mocks.incomeFind, 200],
    ['expenses', expenses, mocks.expenseFind, 200],
    ['incomes/export', incomeExport, mocks.incomeFind, 404],
    ['expenses/export', expenseExport, mocks.expenseFind, 404],
  ] as const)('%s queries the same tenant-scoped UTC month', async (path, handler, find, status) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-15T12:00:00Z'));
    const response = await handler(new NextRequest(`http://localhost/api/${path}?dateRange=thisMonth`));
    expect(response.status).toBe(status);
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      userId: 'calendar-user',
      date: { gte: new Date('2026-12-01T00:00:00Z'), lt: new Date('2027-01-01T00:00:00Z') },
    }) }));
  });
});
