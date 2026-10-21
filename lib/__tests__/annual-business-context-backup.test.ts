import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';
import { createBackupManifest, CURRENT_SCHEMA_VERSION, ANNUAL_CONTEXT_SCHEMA_VERSION, PRE_ANNUAL_CONTEXT_SCHEMA_VERSION, validateBackupManifest } from '@/lib/backup-manifest';
import { readBackupSnapshot } from '@/lib/backup-snapshot';
import { createBackupPreview } from '@/lib/backup-preview';
const state = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
import { restoreBackupData, validateBackupForRestore } from '@/lib/backup-restore';
let database: ReturnType<typeof createTestDatabase>;
const context = { contextYear: 2026, effectiveFrom: '2026-01-01', foundingYear: 2020, previousYearTurnoverCents: '0', previousYearExternalTurnoverCents: null, completeness: 'PARTIAL', sourceNote: 'Synthetic own records', revision: 1, declaredAt: new Date('2026-10-21T01:02:03.004Z') };
const pack = (data: Record<string, unknown>) => ({ version: '3.0', data, manifest: createBackupManifest({ sourceUserId: 'context-source', generatedAt: '2026-10-21T01:02:03.004Z', data }) });
beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  await database.client.user.createMany({ data: ['source', 'target', 'divergent', 'empty', 'standalone'].map(name => ({ id: `context-${name}`, email: `context-${name}@test.invalid`, password: 'unused' })) });
  await database.client.settings.create({ data: { userId: 'context-source', companyName: 'Source minimal settings' } });
  await database.client.annualBusinessContextRevision.create({ data: { userId: 'context-source', ...context } });
}, 40_000);
afterAll(async () => { await database?.cleanup(); });
async function snapshot() { return pack(JSON.parse(JSON.stringify((await readBackupSnapshot('context-source')).data))); }

describe('annual context backup history cannot be erased or reinterpreted', () => {
  it('roundtrips exact year/null/zero/provenance/revision/timestamp into target ownership', async () => {
    const backup = await snapshot();
    expect(backup.manifest.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(createBackupPreview(backup).counts.annualBusinessContextRevisions).toBe(1);
    await restoreBackupData({ userId: 'context-target', overwrite: true, backup });
    const rows = await database.client.annualBusinessContextRevision.findMany({ where: { userId: 'context-target' } });
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ ...context, userId: 'context-target' });
    expect(await database.client.annualBusinessContextRevision.count({ where: { userId: 'context-source' } })).toBe(1);
    await restoreBackupData({ userId: 'context-target', overwrite: false, backup });
    await restoreBackupData({ userId: 'context-target', overwrite: true, backup });
    expect(await database.client.annualBusinessContextRevision.count({ where: { userId: 'context-target' } })).toBe(1);
  });
  it('imports genuine standalone 070000 history with its original non-photo capability', async () => {
    const backup = await snapshot(); backup.manifest.schemaVersion = ANNUAL_CONTEXT_SCHEMA_VERSION;
    expect(() => validateBackupForRestore(backup)).not.toThrow();
    const result = await restoreBackupData({ userId: 'context-standalone', overwrite: false, backup });
    expect(result.annualBusinessContextRevisions.imported).toBe(1);
    expect(await database.client.annualBusinessContextRevision.findFirstOrThrow({ where: { userId: 'context-standalone' } })).toMatchObject({ ...context, userId: 'context-standalone' });
  });
  it('appends only a compatible full prefix, preserving newer target history', async () => {
    const prior = await snapshot();
    await database.client.annualBusinessContextRevision.create({ data: { userId: 'context-source', ...context, revision: 2, sourceNote: 'Corrected own source', previousYearTurnoverCents: null } });
    const newer = await snapshot();
    await restoreBackupData({ userId: 'context-target', overwrite: false, backup: newer });
    expect(await database.client.annualBusinessContextRevision.count({ where: { userId: 'context-target' } })).toBe(2);
    const result = await restoreBackupData({ userId: 'context-target', overwrite: true, backup: prior });
    expect(result.warnings.join(' ')).toContain('Jahreskontexthistorie wurde bewahrt');
    expect(await database.client.annualBusinessContextRevision.count({ where: { userId: 'context-target' } })).toBe(2);
  });
  it('legacy and pre-context snapshots never erase or falsely reconfirm an existing history', async () => {
    const backup = await snapshot(); delete backup.data.annualBusinessContextRevisions;
    const old = pack(backup.data); old.manifest.schemaVersion = PRE_ANNUAL_CONTEXT_SCHEMA_VERSION;
    expect(() => validateBackupForRestore(old)).not.toThrow();
    const before = await database.client.annualBusinessContextRevision.findMany({ where: { userId: 'context-target' } });
    for (const candidate of [old, { version: '2.0', data: old.data }]) {
      await restoreBackupData({ userId: 'context-target', overwrite: true, backup: candidate });
      expect(await database.client.annualBusinessContextRevision.findMany({ where: { userId: 'context-target' } })).toEqual(before);
    }
    await restoreBackupData({ userId: 'context-empty', overwrite: true, backup: old });
    expect(await database.client.annualBusinessContextRevision.count({ where: { userId: 'context-empty' } })).toBe(0);
  });
  it('fails divergent merge/overwrite before changing existing settings or declarations', async () => {
    await database.client.settings.create({ data: { userId: 'context-divergent', companyName: 'Do not overwrite' } });
    await database.client.annualBusinessContextRevision.create({ data: { userId: 'context-divergent', ...context, sourceNote: 'Different owner declaration' } });
    const before = await database.client.settings.findUniqueOrThrow({ where: { userId: 'context-divergent' } });
    for (const overwrite of [false, true]) await expect(restoreBackupData({ userId: 'context-divergent', overwrite, backup: await snapshot() })).rejects.toThrow(/Jahreskontext-Konflikt/);
    expect(await database.client.settings.findUniqueOrThrow({ where: { userId: 'context-divergent' } })).toEqual(before);
  });
  it('rejects tampered, verified, gapped or version-laundered annual data before restore', async () => {
    for (const change of [{ provenance: 'VERIFIED' }, { revision: 3 }, { completeness: 'COMPLETE', previousYearTurnoverCents: null }, { previousYearTurnoverCents: '0', previousYearExternalTurnoverCents: '1' }]) {
      const backup = await snapshot();
      (backup.data.annualBusinessContextRevisions as Record<string, unknown>[])[0] = { ...(backup.data.annualBusinessContextRevisions as Record<string, unknown>[])[0], ...change };
      const updated = pack(backup.data);
      expect(() => validateBackupForRestore(updated)).toThrow();
    }
    const backup = await snapshot(); backup.manifest.schemaVersion = PRE_ANNUAL_CONTEXT_SCHEMA_VERSION;
    expect(() => validateBackupManifest(backup.manifest, backup.data)).toThrow(/Jahreskontexthistorie/);
    const photoIdentity = await snapshot(); photoIdentity.manifest.schemaVersion = '20261021061000_add_manual_photo_approval';
    expect(() => validateBackupForRestore(photoIdentity)).toThrow(/Jahreskontexthistorie/);
  });
});
