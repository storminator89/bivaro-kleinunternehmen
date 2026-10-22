import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createTestDatabase } from './helpers/database';
import { parseStatementRequest, MAX_STATEMENT_REQUEST_BYTES, type ServiceStatementResult } from '@/lib/service-statement';
import { durationToQuantity } from '@/lib/service-duration';

const state = vi.hoisted(() => ({ client: null as unknown, userId: 'statement-owner', authenticated: true }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return { UnauthorizedError, requireUserId: async () => { if (!state.authenticated) throw new UnauthorizedError(); return state.userId; }, unauthorizedResponse: () => new Response(null, { status: 401 }) };
});
import { POST } from '@/app/api/billing-notes/statement/route';

let db: ReturnType<typeof createTestDatabase>;
let customerId: number;
let foreignCustomerId: number;
let projectId: number;
let foreignProjectId: number;
let timed: { id: number; description: string };
let legacy: { id: number; description: string };
let foreign: { id: number; description: string };
let linked: { id: number; description: string };

const request = (body: unknown) => new Request('http://localhost/api/billing-notes/statement', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const selection = (change: Record<string, unknown> = {}) => ({ customerId, from: '2026-10-01', to: '2026-10-31', project: 'all', status: 'all', descriptionsApproved: true, notes: [timed, legacy, linked].map(({ id, description }) => ({ id, description })), ...change });
const unchanged = async () => ({ notes: await db.client.billingNote.findMany({ orderBy: { id: 'asc' } }), invoices: await db.client.invoice.findMany(), audits: await db.client.auditLog.count(), income: await db.client.income.count(), payments: await db.client.paymentJournalEvent.count(), expenses: await db.client.expense.count() });

beforeAll(async () => {
  db = createTestDatabase(); state.client = db.client;
  await db.client.user.createMany({ data: [{ id: state.userId, email: 'owner@statement.test', password: 'fixture' }, { id: 'statement-foreign', email: 'foreign@statement.test', password: 'fixture' }] });
  customerId = (await db.client.customer.create({ data: { userId: state.userId, name: 'Synthetischer Kunde', internalNote: 'INTERN NICHT AUSGEBEN' } })).id;
  foreignCustomerId = (await db.client.customer.create({ data: { userId: 'statement-foreign', name: 'Fremder Kunde' } })).id;
  projectId = (await db.client.serviceProject.create({ data: { userId: state.userId, customerId, name: 'Archiviertes Projekt', archivedAt: new Date() } })).id;
  foreignProjectId = (await db.client.serviceProject.create({ data: { userId: 'statement-foreign', customerId: foreignCustomerId, name: 'Fremdes Projekt' } })).id;
  const base = { userId: state.userId, customerId, serviceDate: new Date('2026-10-20T00:00:00Z') };
  timed = await db.client.billingNote.create({ data: { ...base, projectId, description: 'Konzept mit ÄÖÜ', durationMinutes: 90, quantity: durationToQuantity(90), unit: 'Stunde' } });
  legacy = await db.client.billingNote.create({ data: { ...base, description: 'Alte Menge', quantity: 1.5, unit: 'Stunde' } });
  const invoice = await db.client.invoice.create({ data: { userId: state.userId, customerId, fileName: 'fixture.pdf', storedFileName: 'fixture.pdf', parsedData: {}, issuanceState: 'UNISSUED' } });
  linked = await db.client.billingNote.create({ data: { ...base, description: 'Pauschaler Abschluss', quantity: 2, unit: 'Pauschal', invoiceId: invoice.id } });
  foreign = await db.client.billingNote.create({ data: { ...base, userId: 'statement-foreign', customerId: foreignCustomerId, description: 'Fremde Leistung', quantity: 1, unit: 'Tag' } });
}, 40_000);
afterAll(async () => { await db?.cleanup(); });

describe('explicit read-only service statement', () => {
  it('returns one detached server snapshot with exact source quantities, 90 minutes, unknown time, archived project and linked status', async () => {
    const before = await unchanged();
    const response = await POST(request(selection()));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const result = await response.json() as ServiceStatementResult;
    expect(result.snapshot.totals).toEqual({ durationMinutes: 90, quantityOnlyCount: 2 });
    expect(result.snapshot.rows).toEqual([
      expect.objectContaining({ id: timed.id, durationMinutes: 90, quantity: 1.5, projectName: 'Archiviertes Projekt', projectArchived: true, status: 'open' }),
      expect.objectContaining({ id: legacy.id, durationMinutes: null, quantity: 1.5, unit: 'Stunde', status: 'open' }),
      expect.objectContaining({ id: linked.id, durationMinutes: null, quantity: 2, unit: 'Pauschal', status: 'linked' }),
    ]);
    expect(JSON.stringify(result)).not.toContain('INTERN NICHT AUSGEBEN');
    expect(result.snapshot.customer).toEqual({ id: customerId, name: 'Synthetischer Kunde' });
    const pdf = await PDFDocument.load(Buffer.from(result.pdfBase64, 'base64'));
    expect(pdf.getTitle()).toBe('Leistungsaufstellung');
    expect(pdf.getSubject()).toBe('Keine Rechnung / keine Abnahmebestätigung');
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    expect(await unchanged()).toEqual(before);
  });

  it('retries and concurrent exports never claim, book, number, audit or mutate anything', async () => {
    const before = await unchanged();
    const responses = await Promise.all([POST(request(selection())), POST(request(selection())), POST(request(selection()))]);
    expect(responses.map(response => response.status)).toEqual([200, 200, 200]);
    expect(await unchanged()).toEqual(before);
  });

  it('filters archived projects and linked/none selections explicitly without recomputing quantity', async () => {
    const projectResponse = await POST(request(selection({ notes: [timed], project: String(projectId) })));
    expect(projectResponse.status).toBe(200);
    expect((await projectResponse.json()).snapshot.filters).toMatchObject({ projectName: 'Archiviertes Projekt', projectArchived: true });
    expect((await POST(request(selection({ notes: [linked], project: 'none', status: 'linked' })))).status).toBe(200);
    expect((await POST(request(selection({ notes: [linked], status: 'open' })))).status).toBe(409);
    expect((await POST(request(selection({ notes: [timed], project: 'none' })))).status).toBe(409);
    expect((await POST(request(selection({ from: '2026-10-21' })))).status).toBe(409);
  });

  it('rejects foreign customer, project, note and a cross-tenant invoice relation without disclosing contents', async () => {
    expect((await POST(request(selection({ customerId: foreignCustomerId })))).status).toBe(404);
    expect((await POST(request(selection({ project: String(foreignProjectId) })))).status).toBe(404);
    const response = await POST(request(selection({ notes: [timed, foreign] })));
    expect(response.status).toBe(409); expect(await response.text()).not.toContain('Fremde');
    const foreignInvoice = await db.client.invoice.create({ data: { userId: 'statement-foreign', customerId: foreignCustomerId, fileName: 'foreign.pdf', storedFileName: 'foreign.pdf', parsedData: {} } });
    const corrupted = await db.client.billingNote.create({ data: { userId: state.userId, customerId, invoiceId: foreignInvoice.id, serviceDate: new Date('2026-10-20'), description: 'Ungültige Verknüpfung', quantity: 1, unit: 'Tag' } });
    expect((await POST(request(selection({ notes: [corrupted] })))).status).toBe(409);
    await db.client.billingNote.delete({ where: { id: corrupted.id } });
    await db.client.invoice.delete({ where: { id: foreignInvoice.id } });
  });

  it('rejects stale approved descriptions and removed notes; a fresh selection creates a new timestamp without changing the prior file', async () => {
    const first = await (await POST(request(selection()))).json() as ServiceStatementResult;
    const original = first.pdfBase64;
    await db.client.billingNote.update({ where: { id: legacy.id }, data: { description: 'Neu geprüft' } });
    expect((await POST(request(selection()))).status).toBe(409);
    const fresh = await (await POST(request(selection({ notes: [timed, { id: legacy.id, description: 'Neu geprüft' }, linked] })))).json() as ServiceStatementResult;
    expect(fresh.snapshot.generatedAt > first.snapshot.generatedAt).toBe(true);
    expect(fresh.snapshot.rows[1].description).toBe('Neu geprüft');
    expect(first.pdfBase64).toBe(original);
    await db.client.billingNote.update({ where: { id: legacy.id }, data: { description: legacy.description } });
    const removed = await db.client.billingNote.create({ data: { userId: state.userId, customerId, serviceDate: new Date('2026-10-20'), description: 'Entfernte Leistung', quantity: 1, unit: 'Tag', captureKey: '12345678-1234-1234-1234-123456789abc', captureFingerprint: 'a'.repeat(64), deletedAt: new Date() } });
    expect((await POST(request(selection({ notes: [removed] })))).status).toBe(409);
  });

  it('fails safely for unsupported PDF text and allows a safe retry with another selection', async () => {
    const unsupported = await db.client.billingNote.create({ data: { userId: state.userId, customerId, serviceDate: new Date('2026-10-20'), description: 'Unverändert bleiben 😀', quantity: 1, unit: 'Stück' } });
    const before = await unchanged();
    expect((await POST(request(selection({ notes: [unsupported] })))).status).toBe(422);
    expect((await POST(request(selection()))).status).toBe(200);
    expect(await unchanged()).toEqual(before);
    await db.client.billingNote.delete({ where: { id: unsupported.id } });
  });

  it('enforces authentication, request bytes and origin before producing any file', async () => {
    state.authenticated = false;
    expect((await POST(request(selection()))).status).toBe(401);
    state.authenticated = true;
    const hostile = request(selection()); hostile.headers.set('origin', 'https://evil.test');
    expect((await POST(hostile)).status).toBe(403);
    expect((await POST(new Request('http://localhost/api/billing-notes/statement', { method: 'POST', body: '{' }))).status).toBe(400);
    expect((await POST(new Request('http://localhost/api/billing-notes/statement', { method: 'POST', body: 'x'.repeat(MAX_STATEMENT_REQUEST_BYTES + 1) }))).status).toBe(413);
  });

  it('handles exactly 100 selected rows across multiple PDF pages, rejects 101, and never exports an implicit full list', async () => {
    const notes = await db.client.$transaction(Array.from({ length: 100 }, (_, index) => db.client.billingNote.create({ data: { userId: state.userId, customerId, serviceDate: new Date('2026-10-20'), description: `Begrenzte Auswahl ${index} ${'Text '.repeat(80)}`, quantity: .016666666667, unit: index % 2 ? 'Tag' : 'Stunde' } })));
    const response = await POST(request(selection({ notes })));
    expect(response.status).toBe(200);
    const result = await response.json() as ServiceStatementResult;
    expect(result.snapshot.rows).toHaveLength(100);
    expect(result.snapshot.rows[0].quantity).toBe(.016666666667);
    expect((await PDFDocument.load(Buffer.from(result.pdfBase64, 'base64'))).getPageCount()).toBeGreaterThan(2);
    expect((await POST(request(selection({ notes: [...notes, timed] })))).status).toBe(400);
    await db.client.billingNote.deleteMany({ where: { id: { in: notes.map(note => note.id) } } });
  });
});

describe('bounded explicit statement request', () => {
  it.each([
    { notes: [] }, { notes: undefined }, { notes: [{ id: 0, description: 'x' }] }, { notes: [{ id: 1, description: 'x' }, { id: 1, description: 'x' }] },
    { notes: [{ id: 1, description: 'x'.repeat(501) }] }, { descriptionsApproved: false }, { from: '' }, { to: '2026-02-30' }, { from: '2026-11-01' }, { status: 'paid' }, { project: 'foreign' }, { customerId: -1 },
  ])('rejects invalid selection %j', change => {
    expect(() => parseStatementRequest({ customerId: 1, from: '2026-10-01', to: '2026-10-31', project: 'all', status: 'all', descriptionsApproved: true, notes: [{ id: 1, description: 'Test' }], ...change })).toThrow();
  });
});
