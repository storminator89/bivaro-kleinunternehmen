import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';
import { EMPTY_FISCAL_PROFILE } from '@/lib/fiscal-profile';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, actor: 'fiscal-owner' as string | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    requireUserId: async () => { if (!state.actor) throw new UnauthorizedError(); return state.actor; },
    unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  };
});
import { GET, POST } from '@/app/api/settings/route';

let database: ReturnType<typeof createTestDatabase>;
function save(body: unknown, origin?: string) {
  return POST(new Request('http://localhost/api/settings', {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
  }));
}
beforeAll(async () => {
  database = createTestDatabase();
  state.client = database.client;
  await database.client.user.createMany({ data: [
    { id: 'fiscal-owner', email: 'fiscal-owner@test.invalid', password: 'unused' },
    { id: 'fiscal-other', email: 'fiscal-other@test.invalid', password: 'unused' },
  ] });
}, 40_000);
beforeEach(async () => {
  state.actor = 'fiscal-owner';
  await database.client.settings.deleteMany();
  await database.client.auditLog.deleteMany();
});
afterAll(async () => { await database?.cleanup(); });

describe('pilot settings fiscal API with isolated database', () => {
  it('returns unset for new or legacy users and never infers §19 from company settings', async () => {
    expect(await (await GET()).json()).toEqual(EMPTY_FISCAL_PROFILE);
    await database.client.settings.create({ data: { userId: 'fiscal-owner', companyName: 'Legacy' } });
    expect(await (await GET()).json()).toMatchObject({ companyName: 'Legacy', ...EMPTY_FISCAL_PROFILE });
    expect((await save({ companyName: 'Kleingewerbe' })).status).toBe(200);
    expect(await (await GET()).json()).toMatchObject(EMPTY_FISCAL_PROFILE);
  });

  it('persists explicit declarations, ignores client confirmation time, and preserves them on legacy updates', async () => {
    const result = await save({ fiscalTaxRegime: 'STANDARD', fiscalEffectiveFrom: '2026-01-01', fiscalConfirmedAt: '1900-01-01T00:00:00.000Z' });
    expect(result.status).toBe(200);
    const selected = await result.json();
    expect(selected).toMatchObject({ fiscalTaxRegime: 'STANDARD', fiscalEffectiveFrom: '2026-01-01', fiscalConfirmedAt: expect.any(String) });
    expect(selected.fiscalConfirmedAt).not.toBe('1900-01-01T00:00:00.000Z');
    expect((await save({ companyName: 'Renamed' })).status).toBe(200);
    expect(await (await GET()).json()).toMatchObject({ companyName: 'Renamed', fiscalConfirmedAt: selected.fiscalConfirmedAt });
    await save({ fiscalTaxRegime: 'STANDARD', fiscalEffectiveFrom: '2026-01-01' });
    expect(await (await GET()).json()).toMatchObject({ fiscalConfirmedAt: selected.fiscalConfirmedAt });
    await save({ fiscalTaxRegime: 'UNSET', fiscalEffectiveFrom: null });
    expect(await (await GET()).json()).toMatchObject(EMPTY_FISCAL_PROFILE);
  });

  it('returns field errors for incomplete or invalid profiles without writing anything', async () => {
    for (const [body, field] of [
      [{ fiscalTaxRegime: 'AUTO', fiscalEffectiveFrom: '2026-01-01' }, 'fiscalTaxRegime'],
      [{ fiscalTaxRegime: 'SMALL_BUSINESS', fiscalEffectiveFrom: '2026-02-30' }, 'fiscalEffectiveFrom'],
      [{ fiscalTaxRegime: 'SMALL_BUSINESS' }, 'fiscalEffectiveFrom'],
      [{ fiscalEffectiveFrom: '2026-01-01' }, 'fiscalTaxRegime'],
    ] as const) {
      const response = await save(body);
      expect(response.status).toBe(400);
      expect((await response.json()).fieldErrors[field]).toEqual(expect.any(String));
    }
    for (const body of [null, [], 1]) expect((await save(body)).status).toBe(400);
    const malformed = await POST(new Request('http://localhost/api/settings', { method: 'POST', body: '{' }));
    expect(malformed.status).toBe(400);
    expect(await database.client.settings.count()).toBe(0);
    expect(await database.client.auditLog.count()).toBe(0);
  });

  it('changes only own settings, leaving original invoices and amounts unchanged', async () => {
    await database.client.settings.create({ data: {
      userId: 'fiscal-other', fiscalTaxRegime: 'STANDARD', fiscalEffectiveFrom: '2025-01-01', fiscalConfirmedAt: new Date('2025-01-01T00:00:00.000Z'),
    } });
    const invoice = await database.client.invoice.create({ data: {
      userId: 'fiscal-owner', fileName: 'original.pdf', storedFileName: 'original.pdf',
      totalAmount: 123.45, parsedData: { taxMode: 'small-business', rawXML: '<original/>' }, issuanceState: 'ISSUED', status: 'SENT',
    } });
    const foreign = await database.client.settings.findUniqueOrThrow({ where: { userId: 'fiscal-other' } });
    expect((await save({ userId: 'fiscal-other', fiscalTaxRegime: 'SMALL_BUSINESS', fiscalEffectiveFrom: '2026-01-01' })).status).toBe(200);
    expect((await save({ fiscalTaxRegime: 'STANDARD', fiscalEffectiveFrom: '2027-01-01' })).status).toBe(200);
    expect(await database.client.invoice.findUnique({ where: { id: invoice.id } })).toEqual(invoice);
    expect(await database.client.settings.findUnique({ where: { userId: 'fiscal-other' } })).toEqual(foreign);
    state.actor = 'fiscal-other';
    expect(await (await GET()).json()).toMatchObject({ fiscalEffectiveFrom: '2025-01-01', fiscalTaxRegime: 'STANDARD' });
    const logs = await database.client.auditLog.findMany();
    expect(logs.every(log => log.userId === 'fiscal-owner')).toBe(true);
    for (const log of logs) {
      expect(log.oldValues).toBeNull();
      expect(log.newValues).toBeNull();
      expect(JSON.parse(log.metadata ?? '{}').changedFields).toContain('fiscalTaxRegime');
      expect(log.metadata).not.toContain('SMALL_BUSINESS');
      expect(log.metadata).not.toContain('2027-01-01');
    }
  });

  it('preserves omitted logos and rejects unowned or unsafe logo changes before saving fiscal data', async () => {
    await database.client.settings.create({ data: { userId: 'fiscal-owner', logoUrl: '/uploads/legacy-logo.png' } });
    expect((await save({ fiscalTaxRegime: 'STANDARD', fiscalEffectiveFrom: '2026-01-01' })).status).toBe(200);
    expect((await database.client.settings.findUniqueOrThrow({ where: { userId: 'fiscal-owner' } })).logoUrl).toBe('/uploads/legacy-logo.png');
    const selection = { fiscalTaxRegime: 'SMALL_BUSINESS', fiscalEffectiveFrom: '2026-01-01' };
    expect((await save({ ...selection, logoUrl: 'https://untrusted.invalid/logo.png' })).status).toBe(400);
    expect((await save({ ...selection, logoUrl: '/uploads/not-owned.png' })).status).toBe(404);
    expect(await (await GET()).json()).toMatchObject({ fiscalTaxRegime: 'STANDARD' });
  });

  it('retains authentication and origin protections', async () => {
    state.actor = null;
    expect((await GET()).status).toBe(401);
    expect((await save({})).status).toBe(401);
    state.actor = 'fiscal-owner';
    expect((await save({}, 'https://untrusted.invalid')).status).toBe(403);
    expect(await database.client.settings.count()).toBe(0);
  });
});
