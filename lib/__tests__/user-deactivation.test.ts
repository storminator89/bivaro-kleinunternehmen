import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({
  client: null as ReturnType<typeof createTestDatabase>['client'] | null,
  session: null as { user: { id: string; role: string; sessionVersion: number }; expires: string } | null,
}));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('next-auth', () => ({ getServerSession: async () => state.session }));
vi.mock('next-auth/jwt', () => ({ getToken: async () => state.session?.user }));

import { DELETE, PATCH } from '@/app/api/users/[id]/route';
import { authOptions } from '@/lib/auth';
import { getValidatedSession } from '@/lib/get-user-id';
import { generateApiKey, validateApiKey } from '@/lib/api-auth';
import { proxy } from '@/proxy';

let database: ReturnType<typeof createTestDatabase>;
function session(id: string, role = 'ADMIN') {
  state.session = { user: { id, role, sessionVersion: 0 }, expires: '2099-01-01T00:00:00Z' };
}
function remove(id: string) {
  return DELETE(new Request('http://localhost/api/users/' + id, { method: 'DELETE' }), { params: Promise.resolve({ id }) });
}
beforeAll(async () => {
  database = createTestDatabase();
  state.client = database.client;
  await database.client.user.create({ data: { id: 'operator', email: 'operator@test.invalid', password: 'unused', role: 'ADMIN' } });
}, 40_000);
afterAll(async () => { await database?.cleanup(); });

describe('account deactivation preserves financial history', () => {
  it('preserves records, revokes credentials and records one atomic transition', async () => {
    const db = database.client;
    await db.user.create({ data: { id: 'former', email: 'former@test.invalid', password: 'unused' } });
    const invoice = await db.invoice.create({ data: { userId: 'former', fileName: 'invoice.pdf', storedFileName: 'original.pdf', parsedData: {}, status: 'PAID', paidAt: new Date('2026-01-01'), totalAmount: 100 } });
    await db.income.create({ data: { userId: 'former', description: 'Payment', amount: 100, invoiceId: invoice.id } });
    await db.expense.create({ data: { userId: 'former', description: 'Expense', amount: 25 } });
    await db.auditLog.create({ data: { userId: 'former', action: 'CREATE', entityType: 'Invoice', entityId: String(invoice.id) } });
    const key = generateApiKey();
    await db.apiKey.create({ data: { userId: 'former', name: 'old key', keyHash: key.keyHash, keyPrefix: key.keyPrefix } });
    const readHistory = async () => ({ invoices: await db.invoice.findMany({ where: { userId: 'former' } }), incomes: await db.income.findMany({ where: { userId: 'former' } }), expenses: await db.expense.findMany({ where: { userId: 'former' } }), audits: await db.auditLog.findMany({ where: { userId: 'former' } }) });
    const before = await readHistory();
    expect((await validateApiKey(key.key)).valid).toBe(true);
    session('operator');
    expect((await remove('former')).status).toBe(204);
    expect(await readHistory()).toEqual(before);
    const user = await db.user.findUniqueOrThrow({ where: { id: 'former' } });
    expect(user.deactivatedAt).toBeInstanceOf(Date);
    expect(user.sessionVersion).toBe(1);
    expect((await validateApiKey(key.key)).valid).toBe(false);
    // Owner state must still block a key that was re-enabled independently.
    await db.apiKey.updateMany({ where: { userId: 'former' }, data: { isActive: true } });
    expect((await validateApiKey(key.key)).valid).toBe(false);
    expect((await remove('former')).status).toBe(204);
    expect(await db.auditLog.count({ where: { userId: 'operator', entityId: 'former', action: 'UPDATE' } })).toBe(1);
    const edit = await PATCH(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ role: 'ADMIN' }) }), { params: Promise.resolve({ id: 'former' }) });
    expect(edit.status).toBe(409);
    session('former', 'USER');
    expect(await getValidatedSession()).toBeNull();
    const jwt = authOptions.callbacks!.jwt!;
    const token = await jwt({ token: { id: 'former', role: 'USER', sessionVersion: 0 }, user: undefined } as never);
    expect(token.revoked).toBe(true);
    expect((await proxy(new NextRequest('http://localhost/dashboard'))).headers.get('location')).toContain('/login');
  });

  it('rejects non-admin, self and anonymous requests', async () => {
    session('operator');
    expect((await remove('operator')).status).toBe(400);
    await database.client.user.create({ data: { id: 'ordinary', email: 'ordinary@test.invalid', password: 'unused' } });
    session('ordinary', 'USER');
    expect((await remove('operator')).status).toBe(403);
    state.session = null;
    expect((await remove('operator')).status).toBe(401);
  });

  it('rolls back access and API keys when the required audit cannot be written', async () => {
    const db = database.client;
    await db.user.create({ data: { id: 'rollback', email: 'rollback@test.invalid', password: 'unused' } });
    const key = generateApiKey();
    await db.apiKey.create({ data: { userId: 'rollback', name: 'key', keyHash: key.keyHash, keyPrefix: key.keyPrefix } });
    session('operator');
    await db.$executeRawUnsafe(`CREATE TRIGGER deny_deactivation BEFORE INSERT ON "AuditLog" WHEN NEW."entityId" = 'rollback' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`);
    try {
      expect((await remove('rollback')).status).toBe(500);
      const user = await db.user.findUniqueOrThrow({ where: { id: 'rollback' } });
      expect(user.deactivatedAt).toBeNull();
      expect(user.sessionVersion).toBe(0);
      expect((await validateApiKey(key.key)).valid).toBe(true);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER deny_deactivation');
    }
  });

  it('does not count deactivated administrators as a last-admin fallback', async () => {
    await database.client.user.create({ data: { id: 'inactive-admin', email: 'inactive@test.invalid', password: 'unused', role: 'ADMIN', deactivatedAt: new Date() } });
    session('operator');
    const response = await PATCH(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ role: 'USER' }) }), { params: Promise.resolve({ id: 'operator' }) });
    expect(response.status).toBe(400);
    expect((await database.client.user.findUniqueOrThrow({ where: { id: 'operator' } })).role).toBe('ADMIN');
  });

  it('keeps an active administrator when two admins concurrently deactivate each other', async () => {
    const db = database.client;
    await db.user.update({ where: { id: 'operator' }, data: { role: 'USER' } });
    for (const id of ['admin-a', 'admin-b']) {
      await db.user.create({ data: { id, email: `${id}@test.invalid`, password: 'unused', role: 'ADMIN' } });
    }
    session('admin-a');
    const first = remove('admin-b');
    session('admin-b');
    const second = remove('admin-a');
    const responses = await Promise.all([first, second]);
    expect(responses.filter(response => response.status === 204)).toHaveLength(1);
    expect(responses.filter(response => response.status === 401)).toHaveLength(1);
    expect(await db.user.count({ where: { role: 'ADMIN', deactivatedAt: null } })).toBe(1);
  });
});
