import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';
const state = vi.hoisted(() => ({ client: null as PrismaClient | null, actor: 'annual-owner' as string | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return { UnauthorizedError, requireUserId: async () => { if (!state.actor) throw new UnauthorizedError(); return state.actor; }, unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }) };
});
import { GET, POST } from '@/app/api/settings/annual-context/route';
import { GET as getSettings, POST as saveSettings } from '@/app/api/settings/route';
let database: ReturnType<typeof createTestDatabase>;
const declaration = { version: 1, expectedRevision: 0, declaration: true, contextYear: 2026, effectiveFrom: '2026-01-01', foundingYear: 2020, previousYearTurnoverCents: null, previousYearExternalTurnoverCents: '0', completeness: 'PARTIAL', sourceNote: 'Synthetic private own records' };
const save = (body: unknown, origin?: string) => POST(new Request('http://localhost/api/settings/annual-context', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) } }));
beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  await database.client.user.createMany({ data: ['owner', 'other', 'rollback', 'parallel'].map(name => ({ id: `annual-${name}`, email: `annual-${name}@test.invalid`, password: 'unused' })) });
}, 40_000);
afterAll(async () => { await database?.cleanup(); });

describe('annual context tenant API and additive migration', () => {
  it('leaves old Settings DTO and exact historical invoice content unchanged', async () => {
    const original = await database.client.invoice.create({ data: { userId: 'annual-owner', fileName: 'original.pdf', storedFileName: 'original.pdf', totalAmount: 123.45, parsedData: { rawXML: '<original bytes="unchanged"/>', taxMode: 'legacy' }, issuanceState: 'ISSUED', status: 'SENT' } });
    await saveSettings(new Request('http://localhost/api/settings', { method: 'POST', body: JSON.stringify({ companyName: 'Original company' }), headers: { 'content-type': 'application/json' } }));
    const oldDTO = await (await getSettings()).json();
    expect(await (await GET()).json()).toEqual({ version: 1, revision: 0, history: [] });
    const response = await save(declaration);
    expect(response.status).toBe(201);
    const saved = await response.json();
    expect(saved).toMatchObject({ version: 1, revision: 1, saved: { previousYearTurnoverCents: null, previousYearExternalTurnoverCents: '0', provenance: 'USER_DECLARED' } });
    expect(await (await getSettings()).json()).toEqual(oldDTO);
    expect(await database.client.invoice.findUnique({ where: { id: original.id } })).toEqual(original);
    const logs = await database.client.auditLog.findMany({ where: { entityType: 'AnnualBusinessContextRevision' } });
    expect(logs).toHaveLength(1);
    expect(logs[0].metadata).not.toContain(declaration.sourceNote);
    expect(logs[0].oldValues).toBeNull(); expect(logs[0].newValues).toBeNull();
  });
  it('appends corrections, rejects stale tabs, and reloads exact history', async () => {
    expect((await save({ ...declaration, expectedRevision: 1, previousYearTurnoverCents: '100', sourceNote: 'Corrected own records' })).status).toBe(201);
    expect((await save({ ...declaration, expectedRevision: 1 })).status).toBe(409);
    const first = await (await GET()).json();
    expect(first).toMatchObject({ revision: 2, history: [{ revision: 1, sourceNote: declaration.sourceNote }, { revision: 2, sourceNote: 'Corrected own records' }] });
    expect(await (await GET()).json()).toEqual(first);
    await expect(database.client.annualBusinessContextRevision.updateMany({ where: { userId: 'annual-owner' }, data: { sourceNote: 'rewrite' } })).rejects.toThrow();
    await expect(database.client.annualBusinessContextRevision.deleteMany({ where: { userId: 'annual-owner' } })).rejects.toThrow();
    expect(await (await GET()).json()).toEqual(first);
  });
  it('isolates tenants and refuses unauthenticated/cross-origin/bad declarations', async () => {
    state.actor = 'annual-other';
    expect(await (await GET()).json()).toEqual({ version: 1, revision: 0, history: [] });
    expect((await save({ ...declaration, userId: 'annual-owner' })).status).toBe(201);
    expect(await database.client.annualBusinessContextRevision.count({ where: { userId: 'annual-owner' } })).toBe(2);
    for (const body of [null, [], { ...declaration, expectedRevision: -1 }, { ...declaration, declaration: false }, { ...declaration, version: 2 }, { ...declaration, completeness: 'COMPLETE' }]) expect((await save(body)).status).toBe(400);
    expect((await save(declaration, 'https://attacker.invalid')).status).toBe(403);
    state.actor = null;
    expect((await GET()).status).toBe(401); expect((await save(declaration)).status).toBe(401);
  });
  it('serializes same-revision concurrent writes and keeps one atomic audit', async () => {
    state.actor = 'annual-parallel';
    const results = await Promise.all([save(declaration), save(declaration)]);
    expect(results.map(response => response.status).sort()).toEqual([201, 409]);
    expect(await database.client.annualBusinessContextRevision.count({ where: { userId: state.actor } })).toBe(1);
    expect(await database.client.auditLog.count({ where: { userId: state.actor } })).toBe(1);
  });
  it('rolls back the declaration if its audit cannot be committed, without consuming revision', async () => {
    state.actor = 'annual-rollback';
    await database.client.$executeRawUnsafe(`CREATE TRIGGER annual_audit_failure BEFORE INSERT ON AuditLog WHEN NEW.userId = 'annual-rollback' BEGIN SELECT RAISE(ABORT, 'Synthetic audit failure'); END;`);
    expect((await save(declaration)).status).toBe(500);
    expect(await database.client.annualBusinessContextRevision.count({ where: { userId: state.actor } })).toBe(0);
    await database.client.$executeRawUnsafe('DROP TRIGGER annual_audit_failure');
    expect((await save(declaration)).status).toBe(201);
  });
  it('preserves existing account deactivation behavior with immutable context children', async () => {
    await database.client.user.update({ where: { id: 'annual-owner' }, data: { deactivatedAt: new Date(), sessionVersion: { increment: 1 } } });
    expect(await database.client.annualBusinessContextRevision.count({ where: { userId: 'annual-owner' } })).toBe(2);
  });
});
