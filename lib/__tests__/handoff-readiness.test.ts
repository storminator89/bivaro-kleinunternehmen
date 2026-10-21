import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { PrismaClient } from '@prisma/client';
import { isRetryableDatabaseError } from '@/lib/db-transaction';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTestDatabase } from './helpers/database';
import { HandoffTasks } from '@/components/handoff/handoff-tasks';
import { HandoffAcknowledgement } from '@/components/handoff/handoff-acknowledgement';
import { handoffWarningTarget, readHandoffReadiness, type HandoffPreview } from '@/components/handoff/handoff-model';

const state = vi.hoisted(() => ({ client: null as ReturnType<typeof createTestDatabase>['client'] | null, actor: 'readiness-owner' as string | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return { UnauthorizedError, requireUserId: async () => { if (!state.actor) throw new UnauthorizedError(); return state.actor; }, unauthorizedResponse: () => Response.json({}, { status: 401 }) };
});
let db: ReturnType<typeof createTestDatabase>;
let readinessRoute: typeof import('@/app/api/handoff-readiness/route');
let ackRoute: typeof import('@/app/api/handoff-acknowledgement/route');
let ack: typeof import('@/lib/handoff-acknowledgement');
const identity = { from: '2037-01-01', to: '2037-12-31', sourceFingerprint: 'a'.repeat(64), formatVersion: 2 };
const query = new URLSearchParams({ ...identity, formatVersion: '2' });
const ackRequest = () => new Request(`http://localhost/api/handoff-acknowledgement?${query}`);
const post = (data: unknown) => ackRoute.POST(new Request('http://localhost/api/handoff-acknowledgement', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }));
const preview: HandoffPreview = { filename: 'test.zip', manifest: { format: 'bivaro-accountant-handoff', formatVersion: 2, paymentContractVersion: 2, fiscalMappingStatus: 'UNCHANGED', generatedAt: '2037-01-01T00:00:00Z', sourceFingerprint: identity.sourceFingerprint, period: { from: identity.from, to: identity.to }, counts: { incomes: 0, expenses: 0, invoices: 0, payments: 0, adjustments: 0, cashTransactions: 0, customers: 0, cashBooks: 0, originals: 2 }, originalCounts: { included: 0, missing: 1, notAttached: 1 }, warnings: [ { code: 'PAYMENT_DATE_UNCERTAIN', recordType: 'payment', recordId: 9, message: 'Unknown' } ], warningCount: 1 } };
beforeAll(async () => {
  db = createTestDatabase(); state.client = db.client;
  await db.client.user.createMany({ data: [{ id: 'readiness-owner', email: 'readiness-owner@example.test', password: 'synthetic' }, { id: 'readiness-other', email: 'readiness-other@example.test', password: 'synthetic' }] });
  readinessRoute = await import('@/app/api/handoff-readiness/route'); ackRoute = await import('@/app/api/handoff-acknowledgement/route'); ack = await import('@/lib/handoff-acknowledgement');
}, 40_000);
beforeEach(async () => { state.actor = 'readiness-owner'; await db.client.purchaseDocument.deleteMany(); await db.client.auditLog.deleteMany(); });
afterAll(async () => { await db?.cleanup(); });
async function document(id: number, data: Record<string, unknown> = {}) {
  return db.client.purchaseDocument.create({ data: { id, userId: 'readiness-owner', originalFileName: `synthetic-${id}.pdf`, storedFileName: `${id}.pdf`, originalSha256: String(id).padStart(64, '0'), originalByteCount: 1, mediaType: 'application/pdf', uploadRequestId: `test-${id}`, uploadedAt: new Date('2037-03-01T00:00:00Z'), invoiceDate: new Date('2037-01-01T00:00:00Z'), ...data } });
}
async function readiness(year = '2037') {
  const response = await readinessRoute.GET(new Request(`http://localhost/api/handoff-readiness?year=${year}`)); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store'); return response.json();
}

describe('period readiness is a read model, not an accounting total', () => {
  it('counts only unresolved dated items within inclusive boundaries and isolates tenants', async () => {
    await document(1); await document(2, { invoiceDate: new Date('2037-12-31T23:59:59Z') });
    await document(3, { reviewStatus: 'BOOKED' }); await document(4, { reviewStatus: 'DISMISSED' });
    await document(5, { invoiceDate: new Date('2038-01-01T00:00:00Z') }); await document(6, { userId: 'readiness-other' });
    const result = await readiness(); expect(result.incoming).toMatchObject({ datedCount: 2, undatedCount: 0 });
    expect(result.incoming.datedExamples.map((r: { id: number }) => r.id)).toEqual([1, 2]);
    expect(await db.client.auditLog.count()).toBe(0);
  });
  it('keeps unknown date grouping workspace-wide instead of silently assigning upload year', async () => {
    await document(1, { invoiceDate: null }); await document(2, { invoiceDate: null, uploadedAt: new Date('2036-02-01T00:00:00Z') });
    expect((await readiness()).incoming).toMatchObject({ datedCount: 0, undatedCount: 2, undatedUploadedInPeriod: 1 });
    expect((await readiness('2042')).incoming).toMatchObject({ datedCount: 0, undatedCount: 2, undatedUploadedInPeriod: 0 });
  });
  it('bounds examples without truncating genuine counts; preserves empty unsupported years', async () => {
    for (let id = 1; id <= 7; id++) await document(id);
    const result = await readiness(); expect(result.incoming.datedCount).toBe(7); expect(result.incoming.datedExamples).toHaveLength(5);
    const empty = await readiness('2091'); expect(empty.period).toEqual({ from: '2091-01-01', to: '2091-12-31' }); expect(empty.incoming.datedCount).toBe(0);
  });
  it('rejects malformed/unbounded requests and requires authentication', async () => {
    for (const q of ['year=2037&year=2038', 'year=2037&from=2037-01-01', 'from=2037-01-01&to=2038-12-31', 'year=0000']) expect((await readinessRoute.GET(new Request(`http://localhost/api/handoff-readiness?${q}`))).status).toBe(400);
    state.actor = null; expect((await readinessRoute.GET(new Request('http://localhost/api/handoff-readiness?year=2037'))).status).toBe(401);
  });
});

describe('manual acknowledgement is explicitly self-recorded, bounded and tenant-owned', () => {
  it('never derives acknowledgement from a loaded or downloaded package; saves only explicit manual action', async () => {
    expect(await (await ackRoute.GET(ackRequest())).json()).toEqual({ acknowledgedAt: null });
    expect((await post(identity)).status).toBe(400); expect((await post({ ...identity, selfRecorded: false })).status).toBe(400);
    expect((await post({ ...identity, selfRecorded: true })).status).toBe(201);
    const saved = await (await ackRoute.GET(ackRequest())).json(); expect(saved.acknowledgedAt).toMatch(/^\d{4}-/);
    const row = await db.client.auditLog.findFirstOrThrow(); expect(row).toMatchObject({ userId: 'readiness-owner', action: 'REVIEW', entityType: 'AccountantHandoff' });
    expect(JSON.parse(row.metadata!)).toEqual({ operation: 'SELF_RECORDED_RECEIPT', ...identity, acknowledgement: 'USER_RECORDED_NOT_VERIFIED' });
    state.actor = 'readiness-other'; expect(await (await ackRoute.GET(ackRequest())).json()).toEqual({ acknowledgedAt: null });
    expect(await ack.readHandoffAcknowledgement('readiness-owner', { ...identity, sourceFingerprint: 'b'.repeat(64), formatVersion: 2 })).toEqual({ acknowledgedAt: null });
    await db.client.auditLog.deleteMany(); expect(await ack.readHandoffAcknowledgement('readiness-owner', { ...identity, formatVersion: 2 })).toEqual({ acknowledgedAt: null });
  });
  it('preserves the original confirmation on identical or ambiguous-response retry', async () => {
    const first = await post({ ...identity, selfRecorded: true }); expect(first.status).toBe(201);
    const original = await first.json();
    // A lost response does not change the next request identity.
    const repeated = await post({ ...identity, selfRecorded: true }); expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual({ acknowledgedAt: original.acknowledgedAt, replayed: true });
    expect(await db.client.auditLog.count({ where: { entityType: 'AccountantHandoff' } })).toBe(1);
    expect(await (await ackRoute.GET(ackRequest())).json()).toEqual({ acknowledgedAt: original.acknowledgedAt });
  });
  it('retains historical version-1 notes without treating them as current contract acknowledgement', async () => {
    const legacy = await db.client.auditLog.create({ data: { userId: 'readiness-owner', action: 'REVIEW', entityType: 'AccountantHandoff',
      entityId: `${identity.from}:${identity.to}:${identity.sourceFingerprint}`, entityName: 'Manuelle Empfangsnotiz',
      metadata: JSON.stringify({ operation: 'SELF_RECORDED_RECEIPT', ...identity, formatVersion: 1, acknowledgement: 'USER_RECORDED_NOT_VERIFIED' }),
      createdAt: new Date('2036-01-01T00:00:00Z') } });
    expect(await (await ackRoute.GET(ackRequest())).json()).toEqual({ acknowledgedAt: null });
    expect((await ackRoute.GET(new Request(`http://localhost/api/handoff-acknowledgement?${new URLSearchParams({ ...identity, formatVersion: '1' })}`))).status).toBe(400);
    const response = await post({ ...identity, selfRecorded: true }); expect(response.status).toBe(201);
    const saved = await response.json(); expect(saved.acknowledgedAt).not.toBe(legacy.createdAt.toISOString());
    expect(await db.client.auditLog.findUnique({ where: { id: legacy.id } })).toEqual(legacy);
    const current = await db.client.auditLog.findFirstOrThrow({ where: { entityId: `v2:${identity.from}:${identity.to}:${identity.sourceFingerprint}` } });
    expect(JSON.parse(current.metadata!)).toMatchObject({ formatVersion: 2, acknowledgement: 'USER_RECORDED_NOT_VERIFIED' });
    expect(await db.client.auditLog.count()).toBe(2);
  });
  it('atomically deduplicates independent-client concurrent requests without a schema uniqueness assumption', async () => {
    // Second independent connection only to this suite's fresh temporary database.
    // eslint-disable-next-line no-restricted-syntax
    const other = new PrismaClient({ datasources: { db: { url: db.url } } });
    const run = async (client: PrismaClient) => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await client.$transaction(tx => ack.recordHandoffAcknowledgementInTransaction(tx, 'readiness-owner', { ...identity, formatVersion: 2 }), { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 20_000 });
        } catch (error) {
          if (!isRetryableDatabaseError(error) || attempt >= 7) throw error;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      }
    };
    try {
      const results = await Promise.all([run(db.client), run(other)]);
      expect(results.filter(result => !result.replayed)).toHaveLength(1);
      expect(new Set(results.map(result => result.acknowledgedAt)).size).toBe(1);
      expect(await db.client.auditLog.count({ where: { entityType: 'AccountantHandoff' } })).toBe(1);
    } finally { await other.$disconnect(); }
  }, 60_000);
  it('rejects arbitrary metadata, unsupported versions, cross-origin mutation and oversized bodies', async () => {
    for (const extra of [{ recipient: 'not-allowed' }, { formatVersion: 1 }, { formatVersion: 3 }, { formatVersion: '2' }, { sourceFingerprint: 'invalid' }, { from: '2037-02-30' }]) expect((await post({ ...identity, ...extra, selfRecorded: true })).status).toBe(400);
    expect((await ackRoute.POST(new Request('http://localhost/api/handoff-acknowledgement', { method: 'POST', headers: { Origin: 'https://evil.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ ...identity, selfRecorded: true }) }))).status).toBe(403);
    expect((await post({ text: 'x'.repeat(3000) })).status).toBe(413);
    state.actor = null; expect((await post({ ...identity, selfRecorded: true })).status).toBe(401);
  });
  it('does not acknowledge a failed required write', async () => {
    await db.client.$executeRawUnsafe("CREATE TRIGGER handoff_ack_fail BEFORE INSERT ON AuditLog BEGIN SELECT RAISE(ABORT, 'synthetic unavailable'); END;");
    try { expect((await post({ ...identity, selfRecorded: true })).status).toBe(500); }
    finally { await db.client.$executeRawUnsafe('DROP TRIGGER handoff_ack_fail'); }
    expect(await (await ackRoute.GET(ackRequest())).json()).toEqual({ acknowledgedAt: null });
  });
});

describe('actionable and honest guide rendering', () => {
  it('shows concrete counts, deep links, return/review and unknown-vs-zero explanations', async () => {
    await document(1); await document(2, { invoiceDate: null });
    const tasks = readHandoffReadiness(await readiness(), preview.manifest.period);
    const html = renderToStaticMarkup(createElement(HandoffTasks, { preview, readiness: tasks }));
    for (const text of ['1 offener Eingangsbeleg im Zeitraum', '1 offener Eingangsbeleg ohne Belegdatum', 'Jahreszuordnung unbekannt', '1 historischer Zahlungsnachweis', '2 fehlende Originaldateien', 'href="/purchases?document=1"', 'href="/purchases?document=2"', 'Original- und Banknachweisen', 'Nach Korrekturen neu laden']) {
      expect(html).toContain(text);
    }
    expect(() => readHandoffReadiness(tasks, { from: '2091-01-01', to: '2091-12-31' })).toThrow();
    expect(() => readHandoffReadiness({ ...tasks, incoming: { ...tasks.incoming, datedCount: -1 } }, preview.manifest.period)).toThrow();
  });
  it('offers exact expense targets and safe supported navigation, not fabricated invoice detail routes', () => {
    expect(handoffWarningTarget({ code: 'ORIGINAL_MISSING', recordType: 'expense', recordId: 8, message: '' })?.href).toBe('/expenses/8');
    expect(handoffWarningTarget(preview.manifest.warnings[0])?.href).toBe('/dashboard?tab=invoices');
  });
  it('separates manual receipt from download and discloses retention/restore limits', () => {
    const html = renderToStaticMarkup(createElement(HandoffAcknowledgement, { preview, downloadStarted: false }));
    for (const text of ['Download ist kein Empfangsnachweis', 'außerhalb von Bivaro geprüft', 'Ein Download allein speichert keine Empfangsnotiz', 'begrenzt aufbewahrt', 'Nicht im ZIP oder Backup', 'disabled=""']) expect(html).toContain(text);
  });
});
