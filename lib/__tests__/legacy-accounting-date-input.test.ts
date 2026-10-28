import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { parseLegacyAccountingDate } from '@/lib/business-date';

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), write: vi.fn(), transaction: vi.fn() }));
// Validation probes must never fall through to the configured application database.
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('@/lib/get-user-id', () => ({
  requireUserId: async () => 'date-owner',
  UnauthorizedError: class extends Error {},
  unauthorizedResponse: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/expense-service', async () => ({ ...(await vi.importActual<typeof import('@/lib/expense-service')>('@/lib/expense-service')), createManualExpense: mocks.create, updateManualExpense: mocks.update, deleteManualExpense: vi.fn() }));
vi.mock('@/lib/api-auth', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api-auth')>('@/lib/api-auth')),
  withApiAuth: async (_request: NextRequest, handler: (auth: { userId: string }) => unknown) => handler({ userId: 'date-owner' }),
}));
vi.mock('@/lib/upload-path', () => ({ writeTenantFile: mocks.write, deleteTenantFile: vi.fn() }));

import { POST as apiPost, PUT as apiPut } from '@/app/api/v1/expenses/route';
import { POST, PUT } from '@/app/api/expenses/route';
import { createCashTransaction, updateCashTransaction } from '@/lib/cashbook-service';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockRejectedValue(new Error('Unexpected database access in date validation test'));
  mocks.create.mockImplementation(async (_owner, input) => ({ id: 1, ...input }));
  mocks.update.mockImplementation(async (_owner, id, input) => ({ id, ...input }));
  mocks.write.mockResolvedValue('synthetic-receipt.pdf');
});
const request = (method: string, data: object) => new NextRequest('http://localhost/api/expenses', {
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
});

describe('legacy accounting calendar input', () => {
  it.each(['2026-02-30', '2025-02-29', '2026-04-31', '2026-02-30T12:00:00Z', '2026-02-30 12:00:00', ' 2026-02-30 ', '2026-2-30', '0000-01-01'])('rejects impossible calendar value %s', date => {
    expect(() => parseLegacyAccountingDate(date)).toThrow();
  });

  it.each([
    ['web create', async (date: string) => POST(request('POST', { description: 'Calendar fixture', amount: 12, date }))],
    ['web update', async (date: string) => PUT(request('PUT', { id: 1, description: 'Calendar fixture', amount: 12, date }))],
    ['v1 create', async (date: string) => apiPost(request('POST', { description: 'Calendar fixture', amount: 12, date }))],
    ['v1 update', async (date: string) => apiPut(new NextRequest('http://localhost/api/v1/expenses?id=1', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ description: 'Calendar fixture', amount: 12, date }),
    }))],
  ] as const)('%s rejects an impossible day before mutation', async (_name, mutate) => {
    expect((await mutate('2026-02-30')).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    ['create', (date: string) => createCashTransaction('date-owner', { description: 'Calendar fixture', amount: 12, date, cashBookId: 1, type: 'EINNAHME' })],
    ['update', (date: string) => updateCashTransaction('date-owner', 1, { date })],
  ] as const)('cashbook %s rejects an impossible day before opening a transaction', async (_name, mutate) => {
    await expect(mutate('2026-02-30')).rejects.toMatchObject({ status: 400 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects multipart dates before writing a receipt', async () => {
    const form = new FormData();
    form.set('description', 'Invalid receipt date');
    form.set('amount', '12');
    form.set('date', '2026-02-30');
    form.set('receipt', new File(['%PDF'], 'receipt.pdf', { type: 'application/pdf' }));
    const response = await POST(new NextRequest('http://localhost/api/expenses', { method: 'POST', body: form }));
    expect(response.status).toBe(400);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('accepts a real leap day through the expense route', async () => {
    const response = await POST(request('POST', { description: 'Leap-day expense', amount: 12, date: '2024-02-29' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ description: 'Leap-day expense', amount: 12, date: '2024-02-29T00:00:00.000Z' });
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it('retains leap days and legacy ISO/timestamp inputs', () => {
    expect(parseLegacyAccountingDate('2024-02-29').toISOString()).toBe('2024-02-29T00:00:00.000Z');
    expect(parseLegacyAccountingDate('2026-10-28T12:15:00+01:00').toISOString()).toBe('2026-10-28T11:15:00.000Z');
    expect(parseLegacyAccountingDate(0).toISOString()).toBe('1970-01-01T00:00:00.000Z');
  });
});
