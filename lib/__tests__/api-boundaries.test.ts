import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
import { generateApiKey, handleCors, withApiAuth } from '@/lib/api-auth';
import { POST, PUT, DELETE } from '@/app/api/v1/customers/route';
import { POST as createIncome, PUT as updateIncome, DELETE as deleteIncome } from '@/app/api/v1/incomes/route';
import { POST as createExpense, PUT as updateExpense, DELETE as deleteExpense } from '@/app/api/v1/expenses/route';

let database: ReturnType<typeof createTestDatabase>;
let key: string;
beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  await database.client.user.create({ data: { id: 'api-fixture', email: 'api@test.invalid', password: 'unused' } });
  await database.client.settings.create({ data: { userId: 'api-fixture', allowedOrigins: JSON.stringify(['https://approved.example']) } });
  const generated = generateApiKey(); key = generated.key;
  await database.client.apiKey.create({ data: { userId: 'api-fixture', name: 'fixture', keyHash: generated.keyHash, keyPrefix: generated.keyPrefix, scopes: JSON.stringify(['read', 'write', 'delete']) } });
}, 40_000);
afterAll(async () => { await database?.cleanup(); });

function request(path: string, method: string, body?: object, origin = 'https://approved.example') {
  return new NextRequest(`http://localhost${path}`, { method,
    headers: { origin, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe('external API boundaries', () => {
  it('supports unauthenticated preflight but blocks an unapproved origin before mutation', async () => {
    const preflight = handleCors(new NextRequest('http://localhost/api/v1/customers', {
      method: 'OPTIONS', headers: { origin: 'https://approved.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' },
    }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://approved.example');
    expect(preflight.headers.has('access-control-allow-credentials')).toBe(false);
    const handler = vi.fn(async () => new Response('changed'));
    const rejected = await withApiAuth(request('/api/v1/customers', 'POST', {}, 'https://unapproved.example'), handler, { requiredScopes: ['write'] });
    expect(rejected.status).toBe(403); expect(handler).not.toHaveBeenCalled();
    const allowed = await withApiAuth(request('/api/v1/customers', 'GET'), handler, { requiredScopes: ['read'] });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://approved.example');
    expect(allowed.headers.get('vary')).toContain('Origin');
  });

  it('records CREATE, UPDATE and DELETE audit entries for API customer mutations', async () => {
    const created = await POST(request('/api/v1/customers', 'POST', { name: 'Audit fixture' }));
    expect(created.status).toBe(201);
    const { data: customer } = await created.json();
    expect((await PUT(request(`/api/v1/customers?id=${customer.id}`, 'PUT', { name: 'Renamed fixture' }))).status).toBe(200);
    expect((await DELETE(request(`/api/v1/customers?id=${customer.id}`, 'DELETE'))).status).toBe(200);
    const audit = await database.client.auditLog.findMany({ where: { userId: 'api-fixture', entityId: String(customer.id), entityType: 'Customer' }, orderBy: { id: 'asc' } });
    expect(audit.map(entry => entry.action)).toEqual(['CREATE', 'UPDATE', 'DELETE']);
    expect(JSON.parse(audit[1].oldValues!).name).toBe('Audit fixture');
    expect(JSON.parse(audit[1].newValues!).name).toBe('Renamed fixture');
  });

  it('keeps income/expense foreign keys and linked mutations tenant-safe', async () => {
    await database.client.user.create({ data: { id: 'foreign-api', email: 'foreign-api@test.invalid', password: 'unused' } });
    const foreignCustomer = await database.client.customer.create({ data: { userId: 'foreign-api', name: 'Foreign customer' } });

    const foreignIncome = await createIncome(request('/api/v1/incomes', 'POST', {
      description: 'Foreign reference', amount: 12, customerId: foreignCustomer.id,
    }));
    expect(foreignIncome.status).toBe(404);
    expect(await database.client.income.count({ where: { userId: 'api-fixture', description: 'Foreign reference' } })).toBe(0);

    const incomeResponse = await createIncome(request('/api/v1/incomes', 'POST', {
      description: 'Audit income', amount: 12, taxRelevant: false,
    }));
    expect(incomeResponse.status).toBe(201);
    const { data: income } = await incomeResponse.json();
    const incomeUpdate = await updateIncome(request(`/api/v1/incomes?id=${income.id}`, 'PUT', {
      description: 'Updated income', taxRelevant: false,
    }));
    expect(incomeUpdate.status).toBe(200);
    expect((await incomeUpdate.json()).data.description).toBe('Updated income');
    expect((await deleteIncome(request(`/api/v1/incomes?id=${income.id}`, 'DELETE'))).status).toBe(200);

    const expenseResponse = await createExpense(request('/api/v1/expenses', 'POST', {
      description: 'Audit expense', amount: 25, taxRelevant: false, taxDeductiblePercentage: 0,
    }));
    expect(expenseResponse.status).toBe(201);
    const { data: expense } = await expenseResponse.json();
    expect(expense.taxDeductiblePercentage).toBe(0);
    expect((await createExpense(request('/api/v1/expenses', 'POST', {
      description: 'Invalid boolean', amount: 1, taxRelevant: 'false',
    }))).status).toBe(400);
    expect((await updateExpense(request(`/api/v1/expenses?id=${expense.id}`, 'PUT', {
      description: 'Updated expense', taxRelevant: false, taxDeductiblePercentage: 0,
    }))).status).toBe(200);

    const cashBook = await database.client.cashBook.create({ data: { userId: 'api-fixture' } });
    await database.client.cashTransaction.create({
      data: {
        userId: 'api-fixture', cashBookId: cashBook.id, expenseId: expense.id,
        type: 'AUSGABE', description: 'Linked expense', amount: 25, runningBalance: -25,
      },
    });
    const linkedDelete = await deleteExpense(request(`/api/v1/expenses?id=${expense.id}`, 'DELETE'));
    expect(linkedDelete.status).toBe(409);

    const audit = await database.client.auditLog.findMany({ where: { userId: 'api-fixture', entityType: 'Income', entityId: String(income.id) }, orderBy: { id: 'asc' } });
    expect(audit.map(entry => entry.action)).toEqual(['CREATE', 'UPDATE', 'DELETE']);
  });
});
