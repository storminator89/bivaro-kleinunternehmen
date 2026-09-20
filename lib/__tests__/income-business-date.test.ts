import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({
  requireUserId: vi.fn(async () => 'income-date-user'),
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
}));
vi.mock('@/lib/api-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth')>('@/lib/api-auth');
  return {
    ...actual,
    withApiAuth: async (_request: NextRequest, handler: Parameters<typeof actual.withApiAuth>[1]) =>
      handler({ userId: 'income-date-user', apiKeyId: 1, scopes: ['read', 'write', 'delete'] }),
  };
});

import { POST as postWebIncome } from '@/app/api/incomes/route';
import { POST as postApiIncome } from '@/app/api/v1/incomes/route';
import { createManualIncome } from '@/lib/income-service';

let database: ReturnType<typeof createTestDatabase>;

beforeAll(async () => {
  database = createTestDatabase();
  state.client = database.client;
  await database.client.user.create({ data: { id: 'income-date-user', email: 'income-date@test.invalid', password: 'unused' } });
}, 40_000);

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await database?.cleanup();
});

function webRequest(body: object) {
  return new Request('http://localhost/api/incomes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function apiRequest(body: object) {
  return new NextRequest('http://localhost/api/v1/incomes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('manual income business dates', () => {
  it('uses the same explicit calendar date in Web and v1 when saved in January', async () => {
    // Freeze only Date so the request is evaluated in January while Prisma's
    // timers and transaction timeouts remain real.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-01-15T10:00:00.000Z'));
    const payload = { description: 'Year boundary', amount: 12, date: '2026-12-31' };
    const webResponse = await postWebIncome(webRequest(payload));
    expect(webResponse.status).toBe(200);
    const webIncome = await webResponse.json();
    expect(new Date(webIncome.date).getTime()).toBe(Date.UTC(2026, 11, 31));

    const apiResponse = await postApiIncome(apiRequest(payload));
    expect(apiResponse.status).toBe(201);
    const apiBody = await apiResponse.json();
    expect(new Date(apiBody.data.date).getTime()).toBe(Date.UTC(2026, 11, 31));

    const stored = await database.client.income.findMany({
      where: { userId: 'income-date-user', description: 'Year boundary' },
      orderBy: { id: 'asc' },
    });
    expect(stored.map(income => income.date.getTime())).toEqual([
      Date.UTC(2026, 11, 31),
      Date.UTC(2026, 11, 31),
    ]);
    vi.useRealTimers();

    const audit = await database.client.auditLog.findMany({
      where: { userId: 'income-date-user', entityType: 'Income' },
      orderBy: { id: 'asc' },
    });
    expect(audit.map(entry => entry.action)).toEqual(['CREATE', 'CREATE']);
    expect(JSON.parse(audit[0].metadata!).operation).toBe('income.create');
  });

  it('rejects missing, non-calendar and ISO dates without today fallback', async () => {
    for (const body of [
      { description: 'missing', amount: 1 },
      { description: 'invalid leap day', amount: 1, date: '2023-02-29' },
      { description: 'ISO date', amount: 1, date: '2026-12-31T00:00:00.000Z' },
    ]) {
      const webResponse = await postWebIncome(webRequest(body));
      expect(webResponse.status).toBe(400);
      const webBody = await webResponse.json();
      expect(webBody.field).toBe('date');
      const apiResponse = await postApiIncome(apiRequest(body));
      expect(apiResponse.status).toBe(400);
      const apiBody = await apiResponse.json();
      expect(apiBody.error.field).toBe('date');
    }

    expect(await database.client.income.count({ where: { userId: 'income-date-user', description: { in: ['missing', 'invalid leap day', 'ISO date'] } } })).toBe(0);
  });

  it('keeps customer ownership inside the write transaction', async () => {
    await database.client.user.create({ data: { id: 'foreign-income-user', email: 'foreign-income@test.invalid', password: 'unused' } });
    const customer = await database.client.customer.create({ data: { userId: 'foreign-income-user', name: 'Foreign customer' } });
    const response = await postWebIncome(webRequest({ description: 'foreign customer', amount: 1, date: '2026-02-01', customerId: customer.id }));
    expect(response.status).toBe(404);
    expect(await database.client.income.count({ where: { userId: 'income-date-user', description: 'foreign customer' } })).toBe(0);
  });

  it('rolls back an income when the mandatory financial audit insert fails', async () => {
    await database.client.$executeRawUnsafe(`CREATE TRIGGER "income_audit_failure" BEFORE INSERT ON "AuditLog" WHEN NEW.entityType = 'Income' BEGIN SELECT RAISE(ABORT, 'synthetic income audit failure'); END;`);
    await expect(createManualIncome('income-date-user', {
      description: 'must roll back',
      amount: 5,
      date: new Date(Date.UTC(2026, 1, 28)),
      customerId: null,
      taxRelevant: true,
    })).rejects.toThrow();
    await database.client.$executeRawUnsafe(`DROP TRIGGER "income_audit_failure"`);
    expect(await database.client.income.count({ where: { userId: 'income-date-user', description: 'must roll back' } })).toBe(0);
  });
});
