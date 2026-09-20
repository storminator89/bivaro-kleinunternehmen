import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as unknown, userId: 'expense-audit-user' }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({
  requireUserId: vi.fn(async () => state.userId),
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/api-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth')>('@/lib/api-auth');
  return {
    ...actual,
    withApiAuth: async (_request: NextRequest, handler: Parameters<typeof actual.withApiAuth>[1]) =>
      handler({ userId: state.userId, apiKeyId: 1, scopes: ['read', 'write', 'delete'] }),
  };
});

import { executeRecurringExpenses } from '@/lib/recurring-expenses-service';

let database: ReturnType<typeof createTestDatabase>;
let fixtureRoot: string;
let postWebExpense: typeof import('@/app/api/expenses/route').POST;
let putWebExpense: typeof import('@/app/api/expenses/route').PUT;
let deleteWebExpense: typeof import('@/app/api/expenses/route').DELETE;
let postApiExpense: typeof import('@/app/api/v1/expenses/route').POST;
let putApiExpense: typeof import('@/app/api/v1/expenses/route').PUT;
let deleteApiExpense: typeof import('@/app/api/v1/expenses/route').DELETE;
let tenantUploadDir: typeof import('@/lib/upload-path').tenantUploadDir;

beforeAll(async () => {
  database = createTestDatabase();
  state.client = database.client;
  await database.client.user.create({ data: { id: state.userId, email: 'expense-audit@test.invalid', password: 'unused' } });
  fixtureRoot = await mkdtemp(path.join(tmpdir(), 'bivaro-expense-files-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(fixtureRoot);
  try {
    const webRoute = await import('@/app/api/expenses/route');
    const apiRoute = await import('@/app/api/v1/expenses/route');
    const uploadPath = await import('@/lib/upload-path');
    postWebExpense = webRoute.POST;
    putWebExpense = webRoute.PUT;
    deleteWebExpense = webRoute.DELETE;
    postApiExpense = apiRoute.POST;
    putApiExpense = apiRoute.PUT;
    deleteApiExpense = apiRoute.DELETE;
    tenantUploadDir = uploadPath.tenantUploadDir;
  } finally {
    cwd.mockRestore();
  }
}, 40_000);

afterAll(async () => {
  await database?.cleanup();
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

function webRequest(method: string, body?: object, url = 'http://localhost/api/expenses') {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function apiRequest(method: string, body?: object) {
  return new NextRequest('http://localhost/api/v1/expenses', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function storedExpenseFiles(): Promise<string[]> {
  try {
    return (await readdir(tenantUploadDir(state.userId))).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

describe('expense financial audit transaction boundary', () => {
  it('persists the web mutation and its typed audit before returning', async () => {
    const response = await postWebExpense(webRequest('POST', {
      description: 'Audited web expense', amount: 12.5, date: '2026-05-01',
    }));
    expect(response.status).toBe(200);
    const expense = await response.json();
    const audit = await database.client.auditLog.findFirstOrThrow({
      where: { entityType: 'Expense', entityId: String(expense.id), action: 'CREATE' },
    });
    expect(JSON.parse(audit.metadata!)).toMatchObject({
      actorId: state.userId,
      tenantId: state.userId,
      operation: 'expense.create',
      originalReference: `expense:${expense.id}`,
      reason: 'Expense created',
    });
  });

  it('rolls back a web create when the financial audit insert fails', async () => {
    await database.client.$executeRawUnsafe(`CREATE TRIGGER "expense_audit_failure_create" BEFORE INSERT ON "AuditLog" WHEN NEW.entityType = 'Expense' BEGIN SELECT RAISE(ABORT, 'synthetic expense audit failure'); END;`);
    try {
      const response = await postWebExpense(webRequest('POST', { description: 'must roll back', amount: 4 }));
      expect(response.status).toBe(500);
    } finally {
      await database.client.$executeRawUnsafe('DROP TRIGGER "expense_audit_failure_create"');
    }
    expect(await database.client.expense.count({ where: { userId: state.userId, description: 'must roll back' } })).toBe(0);
  });

  it('cleans up a multipart receipt when its financial audit insert fails', async () => {
    const filesBefore = await storedExpenseFiles();
    const form = new FormData();
    form.append('description', 'multipart must roll back');
    form.append('amount', '6');
    form.append('receipt', new File([new Uint8Array([37, 80, 68, 70])], 'receipt.pdf', { type: 'application/pdf' }));
    await database.client.$executeRawUnsafe(`CREATE TRIGGER "expense_audit_failure_multipart" BEFORE INSERT ON "AuditLog" WHEN NEW.entityType = 'Expense' BEGIN SELECT RAISE(ABORT, 'synthetic multipart audit failure'); END;`);
    try {
      const response = await postWebExpense(new NextRequest('http://localhost/api/expenses', { method: 'POST', body: form }));
      expect(response.status).toBe(500);
    } finally {
      await database.client.$executeRawUnsafe('DROP TRIGGER "expense_audit_failure_multipart"');
    }
    expect(await database.client.expense.count({ where: { userId: state.userId, description: 'multipart must roll back' } })).toBe(0);
    expect(await storedExpenseFiles()).toEqual(filesBefore);
  });

  it('rolls back update and delete when their financial audit insert fails', async () => {
    const created = await database.client.expense.create({ data: { userId: state.userId, description: 'transactional target', amount: 8 } });
    await database.client.$executeRawUnsafe(`CREATE TRIGGER "expense_audit_failure_update" BEFORE INSERT ON "AuditLog" WHEN NEW.entityType = 'Expense' BEGIN SELECT RAISE(ABORT, 'synthetic expense audit failure'); END;`);
    try {
      const updateResponse = await putWebExpense(webRequest('PUT', {
        id: created.id, description: 'must not update', amount: 99,
      }));
      expect(updateResponse.status).toBe(500);
    } finally {
      await database.client.$executeRawUnsafe('DROP TRIGGER "expense_audit_failure_update"');
    }
    expect(await database.client.expense.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ description: 'transactional target', amount: 8 });

    await database.client.$executeRawUnsafe(`CREATE TRIGGER "expense_audit_failure_delete" BEFORE INSERT ON "AuditLog" WHEN NEW.entityType = 'Expense' BEGIN SELECT RAISE(ABORT, 'synthetic expense audit failure'); END;`);
    try {
      const deleteResponse = await deleteWebExpense(webRequest('DELETE', undefined, `http://localhost/api/expenses?id=${created.id}`));
      expect(deleteResponse.status).toBe(500);
    } finally {
      await database.client.$executeRawUnsafe('DROP TRIGGER "expense_audit_failure_delete"');
    }
    expect(await database.client.expense.findUnique({ where: { id: created.id } })).not.toBeNull();
  });

  it('uses the same atomic boundary for API v1 creates and does not disclose another owner', async () => {
    const response = await postApiExpense(apiRequest('POST', { description: 'API expense', amount: 3 }));
    expect(response.status).toBe(201);
    const body = await response.json();
    const audit = await database.client.auditLog.findFirstOrThrow({ where: { entityType: 'Expense', entityId: String(body.data.id), action: 'CREATE' } });
    expect(JSON.parse(audit.metadata!)).toMatchObject({ operation: 'expense.create', tenantId: state.userId });

    await database.client.user.create({ data: { id: 'foreign-expense-owner', email: 'foreign-expense@test.invalid', password: 'unused' } });
    const foreign = await database.client.expense.create({ data: { userId: 'foreign-expense-owner', description: 'private expense', amount: 10 } });
    const responseForForeign = await putWebExpense(webRequest('PUT', { id: foreign.id, description: 'must stay private', amount: 11 }));
    expect(responseForForeign.status).toBe(404);
    expect(await database.client.expense.findUniqueOrThrow({ where: { id: foreign.id } })).toMatchObject({ description: 'private expense', amount: 10 });
  });

  it('rolls back API v1 update and delete when their financial audit insert fails', async () => {
    const created = await database.client.expense.create({ data: { userId: state.userId, description: 'v1 transactional target', amount: 21 } });
    await database.client.$executeRawUnsafe(`CREATE TRIGGER "expense_audit_failure_v1_update" BEFORE INSERT ON "AuditLog" WHEN NEW.entityType = 'Expense' BEGIN SELECT RAISE(ABORT, 'synthetic v1 audit failure'); END;`);
    try {
      await expect(putApiExpense(new NextRequest(`http://localhost/api/v1/expenses?id=${created.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: 'v1 must not update' }),
      }))).rejects.toThrow();
    } finally {
      await database.client.$executeRawUnsafe('DROP TRIGGER "expense_audit_failure_v1_update"');
    }
    expect(await database.client.expense.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ description: 'v1 transactional target', amount: 21 });

    await database.client.$executeRawUnsafe(`CREATE TRIGGER "expense_audit_failure_v1_delete" BEFORE INSERT ON "AuditLog" WHEN NEW.entityType = 'Expense' BEGIN SELECT RAISE(ABORT, 'synthetic v1 audit failure'); END;`);
    try {
      await expect(deleteApiExpense(new NextRequest(`http://localhost/api/v1/expenses?id=${created.id}`, { method: 'DELETE' }))).rejects.toThrow();
    } finally {
      await database.client.$executeRawUnsafe('DROP TRIGGER "expense_audit_failure_v1_delete"');
    }
    expect(await database.client.expense.findUnique({ where: { id: created.id } })).not.toBeNull();
  });

  it('rolls back recurring expense creation with its schedule when audit insertion fails', async () => {
    const nextExecution = new Date('2026-06-01T00:00:00.000Z');
    const recurring = await database.client.recurringExpense.create({ data: {
      userId: state.userId,
      description: 'Recurring rollback',
      amount: 17,
      interval: 'MONTHLY',
      nextExecution,
    } });
    await database.client.$executeRawUnsafe(`CREATE TRIGGER "recurring_expense_audit_failure" BEFORE INSERT ON "AuditLog" WHEN NEW.entityType = 'Expense' BEGIN SELECT RAISE(ABORT, 'synthetic recurring audit failure'); END;`);
    try {
      await expect(executeRecurringExpenses(state.userId, recurring.id, new Date('2026-06-02T00:00:00.000Z'))).rejects.toThrow();
    } finally {
      await database.client.$executeRawUnsafe('DROP TRIGGER "recurring_expense_audit_failure"');
    }
    expect(await database.client.expense.count({ where: { recurringExpenseId: recurring.id } })).toBe(0);
    expect(await database.client.recurringExpense.findUniqueOrThrow({ where: { id: recurring.id } })).toMatchObject({ nextExecution });
  });

  it('serializes parallel recurring executions into one expense and one audit', async () => {
    const nextExecution = new Date('2026-07-01T00:00:00.000Z');
    const recurring = await database.client.recurringExpense.create({ data: {
      userId: state.userId,
      description: 'Recurring parallel',
      amount: 19,
      interval: 'MONTHLY',
      nextExecution,
    } });
    await Promise.all([
      executeRecurringExpenses(state.userId, recurring.id, new Date('2026-07-02T00:00:00.000Z')),
      executeRecurringExpenses(state.userId, recurring.id, new Date('2026-07-02T00:00:00.000Z')),
    ]);
    const expenses = await database.client.expense.findMany({ where: { recurringExpenseId: recurring.id } });
    expect(expenses).toHaveLength(1);
    expect(await database.client.auditLog.count({ where: { entityType: 'Expense', entityId: String(expenses[0].id), action: 'CREATE' } })).toBe(1);
  });
});
