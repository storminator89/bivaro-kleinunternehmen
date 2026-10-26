import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { QUOTE_RELEASE_BACKUP_SCHEMA_VERSION } from '@/lib/backup-schema-identities';
import { quoteReleaseGraphFromBackup } from '@/lib/quote-release-backup';
import { createQuoteReleaseSnapshot } from '@/lib/quote-release-contract';
import { preflightQuoteReleaseRestore, restoreQuoteReleaseClosedGraph } from '@/lib/quote-release-backup-store';

const uid = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const OWNER = 'synthetic-target';
const createdAt = '2026-01-01T00:00:00.000Z', recordedAt = '2026-01-02T00:00:00.000Z', expiresAt = '2099-01-01T00:00:00.000Z';
function source() {
  const snapshot = createQuoteReleaseSnapshot({ type: 'QUOTE', fileName: 'synthetic.pdf', invoiceNumber: 'SYNTHETIC', invoiceDate: createdAt, validUntil: expiresAt, totalAmount: 1, parsedData: { synthetic: true } }, Buffer.from('%PDF-SYNTHETIC'));
  return quoteReleaseGraphFromBackup({
    user: { id: 'offline-source' }, invoices: [{ id: 201, type: 'QUOTE', status: 'SENT', customerId: 101 }],
    quoteReleaseAuthorities: [{ id: uid(1), sourceInvoiceId: 201, boundCustomerId: 101, revision: 1, currentReleaseId: uid(11) }],
    quoteReleases: [{ ...snapshot, id: uid(11), authorityId: uid(1), generation: 1, previousReleaseId: null, originalArchiveName: `${uid(101)}.pdf`, sourcePayload: '{"synthetic":true}', createdAt, expiresAt, revokedAt: null, restoredAccessDisabled: 0 }],
    quoteElectronicResponses: [{ version: 1, authorityId: uid(1), requestId: uid(21), releaseId: uid(11), snapshotSha256: snapshot.snapshotSha256, decision: 'ACCEPT', comment: null, recordedAt }],
  }, QUOTE_RELEASE_BACKUP_SCHEMA_VERSION);
}
type Row = Record<string, unknown>;
/** Mocked delegate contract only: not a transaction/SQL/trigger acceptance test. */
function client(initial: ReturnType<typeof source> | null = null, live = false) {
  const state: { authorities: Row[]; releases: Row[]; responses: Row[] } = {
    authorities: initial ? initial.authorities.map(a => ({ ...a, userId: OWNER, sourceUserId: live ? OWNER : null, sourceInvoiceId: live ? 201 : null, boundCustomerId: live ? 101 : null, currentReleaseId: live ? a.currentReleaseId : null })) : [],
    releases: initial ? initial.releases.map(r => ({ ...r, userId: OWNER, restoredAccessDisabled: live ? 0 : 1 })) : [],
    responses: initial ? initial.responses.map(e => ({ ...e, userId: OWNER })) : [],
  };
  const matches = (row: Row, where: Record<string, unknown> = {}) => Object.entries(where).every(([key, value]) => value && typeof value === 'object' && 'in' in value ? (value as { in: unknown[] }).in.includes(row[key]) : row[key] === value);
  const delegate = (key: keyof typeof state) => ({
    findMany: vi.fn(async (args: { where?: Record<string, unknown>; cursor?: { id: string }; take?: number }) => state[key].filter(row => matches(row, args.where)).filter(row => !args.cursor || String(row.id) > args.cursor.id).slice(0, args.take)),
    create: vi.fn(async ({ data }: { data: Row }) => { state[key].push({ ...data }); return data; }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Row }) => {
      let count = 0;
      for (const row of state[key].filter(row => matches(row, where))) {
        if (key === 'authorities' && row.currentReleaseId !== null && data.currentReleaseId === null) {
          const release = state.releases.find(r => r.id === row.currentReleaseId)!;
          release.revokedAt = '2026-10-20T00:00:00.000Z';
        }
        Object.assign(row, data); count++;
      }
      return { count };
    }),
  });
  const api = { quoteReleaseAuthority: delegate('authorities'), quoteRelease: delegate('releases'), quoteElectronicResponse: delegate('responses'), invoice: { findMany: vi.fn(async () => [{ id: 201, userId: OWNER, type: 'QUOTE', status: 'SENT', customerId: 101, convertedFromQuoteId: null }]) } };
  return { state, api, tx: api as unknown as Prisma.TransactionClient };
}

describe('closed quote backup store, mocked delegates only', () => {
  it('imports only detached authority/currentNULL/access1 without copying source owner or binding', async () => {
    const c = client(), graph = source(), plan = await preflightQuoteReleaseRestore(c.tx, OWNER, graph, false);
    const result = await restoreQuoteReleaseClosedGraph(c.tx, OWNER, graph, false, plan);
    expect(result.authorities.imported).toBe(1);
    expect(c.state.authorities[0]).toMatchObject({ userId: OWNER, sourceUserId: null, sourceInvoiceId: null, boundCustomerId: null, currentReleaseId: null, revision: 1 });
    expect(c.state.releases[0]).toMatchObject({ userId: OWNER, restoredAccessDisabled: 1 });
    expect(c.state.responses[0]).toMatchObject({ userId: OWNER, recordedAt });
  });
  it('exact detached replay is no-write and keeps original identity', async () => {
    const graph = source(), c = client(graph), before = structuredClone(c.state), plan = await preflightQuoteReleaseRestore(c.tx, OWNER, graph, false);
    expect(plan.reuseReleaseIds).toEqual([uid(11)]);
    const result = await restoreQuoteReleaseClosedGraph(c.tx, OWNER, graph, false, plan);
    expect(result.releases).toEqual({ imported: 0, skipped: 1 });
    expect(c.state).toEqual(before);
    expect(c.api.quoteReleaseAuthority.create).not.toHaveBeenCalled();
    expect(c.api.quoteReleaseAuthority.updateMany).not.toHaveBeenCalled();
  });
  it('closes an existing live pointer by exact CAS before sticky disabling', async () => {
    const graph = source(), c = client(graph, true), plan = await preflightQuoteReleaseRestore(c.tx, OWNER, graph, false);
    await restoreQuoteReleaseClosedGraph(c.tx, OWNER, graph, false, plan);
    expect(c.api.quoteReleaseAuthority.updateMany).toHaveBeenCalledWith({ where: { id: uid(1), userId: OWNER, revision: 1, currentReleaseId: uid(11) }, data: { revision: 2, currentReleaseId: null } });
    expect(c.state.authorities[0]).toMatchObject({ sourceInvoiceId: 201, revision: 2, currentReleaseId: null });
    expect(c.state.releases[0].restoredAccessDisabled).toBe(1);
  });
  it('foreign UUID and diverging/missing immutable history fail before writes', async () => {
    const graph = source(), foreign = client(graph);
    for (const rows of Object.values(foreign.state)) for (const row of rows) row.userId = 'another-owner';
    await expect(preflightQuoteReleaseRestore(foreign.tx, OWNER, graph, false)).rejects.toThrow('anderen Mandanten');
    expect(foreign.api.quoteReleaseAuthority.create).not.toHaveBeenCalled();
    const divergent = client(graph); divergent.state.releases[0].sourcePayload = '{"different":true}';
    await expect(preflightQuoteReleaseRestore(divergent.tx, OWNER, graph, false)).rejects.toThrow('abweichend');
    const missing = client(graph); missing.state.responses = [];
    await expect(preflightQuoteReleaseRestore(missing.tx, OWNER, graph, false)).rejects.toThrow('abweichend');
  });
  it('overwrite and a changed authoritative preflight fail closed', async () => {
    const graph = source(), c = client(graph, true);
    await expect(preflightQuoteReleaseRestore(c.tx, OWNER, { authorities: [], releases: [], responses: [] }, true)).rejects.toThrow('Überschreiben');
    const plan = await preflightQuoteReleaseRestore(c.tx, OWNER, graph, false);
    c.state.authorities[0].revision = 2; c.state.authorities[0].currentReleaseId = null;
    c.state.releases[0].revokedAt = '2026-10-20T00:00:00.000Z';
    await expect(restoreQuoteReleaseClosedGraph(c.tx, OWNER, graph, false, plan)).rejects.toThrow('verändert');
    expect(c.api.quoteReleaseAuthority.updateMany).not.toHaveBeenCalled();
  });
  it('a lost retirement CAS cannot fall through to writes', async () => {
    const graph = source(), c = client(graph, true), plan = await preflightQuoteReleaseRestore(c.tx, OWNER, graph, false);
    c.api.quoteReleaseAuthority.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(restoreQuoteReleaseClosedGraph(c.tx, OWNER, graph, false, plan)).rejects.toThrow('CAS');
    expect(c.api.quoteRelease.updateMany).not.toHaveBeenCalled();
    expect(c.api.quoteReleaseAuthority.create).not.toHaveBeenCalled();
  });
});
