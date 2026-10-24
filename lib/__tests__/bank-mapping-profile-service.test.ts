import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inferBankCsvMapping, parseBankCsv } from '@/lib/bank-csv';
import { createBankMappingProfileConfiguration, type BankMappingProfileMutation } from '@/lib/bank-mapping-profile-contract';
const state = vi.hoisted(() => ({ profiles: new Map<string, Record<string, unknown>>(), revisions: new Map<string, Record<string, unknown>>(), tail: Promise.resolve() }));
const database = vi.hoisted(() => {
  function matches(item: Record<string, unknown>, where: Record<string, unknown>) { return Object.entries(where).every(([key, value]) => item[key] === value); }
  const profile = {
    findFirst: vi.fn(async ({ where }) => [...state.profiles.values()].find(item => matches(item, where)) ?? null),
    findUnique: vi.fn(async ({ where }) => state.profiles.get(`${where.userId}:${where.id}`) ?? null),
    count: vi.fn(async ({ where }) => [...state.profiles.values()].filter(item => matches(item, where)).length),
    create: vi.fn(async ({ data }) => { const item = { ...data, deletedAt: null, deleteMutationId: null }; state.profiles.set(`${data.userId}:${data.id}`, item); return item; }),
    updateMany: vi.fn(async ({ where, data }) => { const item = state.profiles.get(`${where.userId}:${where.id}`); if (!item || !matches(item, where)) return { count: 0 }; Object.assign(item, data); return { count: 1 }; }),
    findMany: vi.fn(async ({ where }) => [...state.profiles.values()].filter(item => matches(item, where)).map(item => ({ ...item, revisions: [...state.revisions.values()].filter(row => row.userId === item.userId && row.profileId === item.id).sort((a, b) => Number(b.revision) - Number(a.revision)).slice(0, 1) }))),
  };
  const revision = {
    findUnique: vi.fn(async ({ where }) => {
      if (where.userId_profileId_revision) return state.revisions.get(`${where.userId_profileId_revision.userId}:${where.userId_profileId_revision.profileId}:${where.userId_profileId_revision.revision}`) ?? null;
      const key = where.userId_profileId_mutationId;
      return [...state.revisions.values()].find(item => item.userId === key.userId && item.profileId === key.profileId && item.mutationId === key.mutationId) ?? null;
    }),
    create: vi.fn(async ({ data }) => { state.revisions.set(`${data.userId}:${data.profileId}:${data.revision}`, structuredClone(data)); return data; }),
  };
  return { bankMappingProfile: profile, bankMappingProfileRevision: revision };
});
vi.mock('@/lib/prisma', () => ({ prisma: { ...database, $transaction: async (callback: (tx: typeof database) => unknown) => callback(database) } }));
vi.mock('@/lib/db-transaction', () => ({ inTransaction: (callback: (tx: typeof database) => unknown) => {
  const result = state.tail.then(() => callback(database)); state.tail = result.then(() => {}, () => {}); return result;
} }));
import { deleteBankMappingProfile, listBankMappingProfiles, readBankMappingProfile, saveBankMappingProfile } from '@/lib/bank-mapping-profile-service';
async function input(): Promise<BankMappingProfileMutation> {
  const parsed = parseBankCsv('Datum;Betrag;Währung\n24.10.2026;0,01;EUR');
  return { id: randomUUID(), mutationId: randomUUID(), expectedRevision: 0, configuration: await createBankMappingProfileConfiguration('Bankexport', { ...inferBankCsvMapping(parsed.headers), accountAlias: 'Betriebskonto' }, parsed) };
}
beforeEach(() => { state.profiles.clear(); state.revisions.clear(); state.tail = Promise.resolve(); vi.clearAllMocks(); });
describe('bank profile service with pure scoped in-memory delegates (no database)', () => {
  it('replays the exact stable create operation without another profile or revision', async () => {
    const request = await input();
    expect(await saveBankMappingProfile('owner', request)).toEqual(await saveBankMappingProfile('owner', request));
    expect(state.profiles.size).toBe(1); expect(state.revisions.size).toBe(1);
    await expect(saveBankMappingProfile('owner', { ...request, configuration: { ...request.configuration, name: 'Other' } })).rejects.toMatchObject({ status: 409 });
    expect((await readBankMappingProfile('owner', request.id)).configuration.name).toBe('Bankexport');
  });
  it('only one of two concurrent revisions wins; stale expected revision fails without appending', async () => {
    const request = await input(); await saveBankMappingProfile('owner', request);
    const first = { ...request, mutationId: randomUUID(), expectedRevision: 1, configuration: { ...request.configuration, name: 'First edit' } };
    const second = { ...first, mutationId: randomUUID(), configuration: { ...request.configuration, name: 'Second edit' } };
    const outcomes = await Promise.allSettled([saveBankMappingProfile('owner', first), saveBankMappingProfile('owner', second)]);
    expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(value => value.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    expect(state.revisions.size).toBe(2);
    expect((await readBankMappingProfile('owner', request.id, 1)).configuration.name).toBe('Bankexport');
    expect((await readBankMappingProfile('owner', request.id)).configuration.name).toBe('First edit');
    expect(await saveBankMappingProfile('owner', first)).toMatchObject({ revision: 2, latestRevision: 2 });
    expect(await saveBankMappingProfile('owner', request)).toMatchObject({ revision: 1, latestRevision: 2 });
    expect((await listBankMappingProfiles('owner'))[0]).toMatchObject({ revision: 2, name: 'First edit' });
  });
  it('soft deletion is explicit, repeatable, revision-checked and preserves old immutable configurations', async () => {
    const request = await input(); await saveBankMappingProfile('owner', request);
    const remove = { id: request.id, mutationId: randomUUID(), expectedRevision: 1 };
    await expect(deleteBankMappingProfile('owner', { ...remove, mutationId: request.mutationId })).rejects.toMatchObject({ status: 409 });
    await expect(deleteBankMappingProfile('owner', { ...remove, expectedRevision: 2 })).rejects.toMatchObject({ status: 409 });
    expect(await deleteBankMappingProfile('owner', remove)).toEqual({ deleted: true });
    expect(await deleteBankMappingProfile('owner', remove)).toEqual({ deleted: true });
    expect(await listBankMappingProfiles('owner')).toEqual([]);
    await expect(readBankMappingProfile('owner', request.id)).rejects.toMatchObject({ status: 404 });
    await expect(saveBankMappingProfile('owner', { ...request, mutationId: randomUUID(), expectedRevision: 1 })).rejects.toMatchObject({ status: 404 });
    expect(state.revisions.size).toBe(1); expect([...state.revisions.values()][0].configuration).toEqual(request.configuration);
  });
  it('foreign IDs never allow reads, update or delete; same portable identity remains tenant-scoped', async () => {
    const request = await input(); await saveBankMappingProfile('owner', request);
    expect(await listBankMappingProfiles('stranger')).toEqual([]);
    await expect(readBankMappingProfile('stranger', request.id)).rejects.toMatchObject({ status: 404 });
    await expect(saveBankMappingProfile('stranger', { ...request, mutationId: randomUUID(), expectedRevision: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(deleteBankMappingProfile('stranger', { id: request.id, expectedRevision: 1, mutationId: randomUUID() })).rejects.toMatchObject({ status: 404 });
    expect(state.profiles.size).toBe(1); expect(state.revisions.size).toBe(1);
    const own = { ...request, mutationId: randomUUID(), configuration: { ...request.configuration, name: 'Independent tenant config' } };
    await saveBankMappingProfile('stranger', own);
    expect((await readBankMappingProfile('owner', request.id)).configuration.name).toBe('Bankexport');
    expect((await readBankMappingProfile('stranger', request.id)).configuration.name).toBe('Independent tenant config');
    expect((await listBankMappingProfiles('owner'))[0].name).toBe('Bankexport');
    expect((await listBankMappingProfiles('stranger'))[0].name).toBe('Independent tenant config');
    expect(state.profiles.size).toBe(2);
  });
});
