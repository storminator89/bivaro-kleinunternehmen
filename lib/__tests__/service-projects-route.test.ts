import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from './helpers/database';
import { durationToQuantity } from '@/lib/service-duration';
import { claimBillingNotesForInvoice } from '@/lib/billing-notes';
import { randomUUID } from 'node:crypto';
import { serviceCaptureFingerprint } from '@/lib/service-capture';

const state = vi.hoisted(() => ({ client: null as unknown, userId: 'project-owner' }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({
  requireUserId: async () => state.userId,
  UnauthorizedError: class extends Error {},
  unauthorizedResponse: () => new Response(null, { status: 401 }),
}));

import { GET, POST, PATCH } from '@/app/api/service-projects/route';
import { GET as getNotes, POST as postNote, DELETE as deleteNote } from '@/app/api/billing-notes/route';

let db: ReturnType<typeof createTestDatabase>;
let customerId: number;
let otherCustomerId: number;
let foreignCustomerId: number;

function request(path: string, method: string, data: unknown) {
  return new Request(`http://localhost/api/${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
}
const noteData = (projectId: number | null = null) => ({ customerId, projectId, description: 'Manuelle Wartung', serviceDate: '2026-10-21', duration: '00:01' });

beforeAll(async () => {
  db = createTestDatabase(); state.client = db.client;
  await db.client.user.createMany({ data: [
    { id: 'project-owner', email: 'owner@projects.test', password: 'fixture' },
    { id: 'project-foreign', email: 'foreign@projects.test', password: 'fixture' },
  ] });
  customerId = (await db.client.customer.create({ data: { userId: state.userId, name: 'Projektkunde' } })).id;
  otherCustomerId = (await db.client.customer.create({ data: { userId: state.userId, name: 'Anderer eigener Kunde' } })).id;
  foreignCustomerId = (await db.client.customer.create({ data: { userId: 'project-foreign', name: 'Fremder Kunde' } })).id;
}, 40_000);
afterAll(async () => { await db?.cleanup(); });

describe('customer-scoped service projects', () => {
  it('does not expose another tenant and rejects owner changes or malformed input', async () => {
    expect((await POST(request('service-projects', 'POST', { customerId: foreignCustomerId, name: 'Fremd' }))).status).toBe(404);
    expect((await GET(new Request(`http://localhost/api/service-projects?customerId=${foreignCustomerId}`))).status).toBe(404);
    expect((await POST(request('service-projects', 'POST', { customerId, name: ' ' }))).status).toBe(400);
    expect((await POST(request('service-projects', 'POST', { customerId, name: 'x'.repeat(121) }))).status).toBe(400);
    expect((await PATCH(request('service-projects', 'PATCH', { id: 1, customerId: otherCustomerId }))).status).toBe(400);
    expect((await PATCH(request('service-projects', 'PATCH', { id: 1, archived: 'true' }))).status).toBe(400);
    const hostile = request('service-projects', 'POST', { customerId, name: 'Hostile' });
    hostile.headers.set('origin', 'https://evil.test');
    expect((await POST(hostile)).status).toBe(403);
    expect(await db.client.serviceProject.count()).toBe(0);
  });

  it('preserves historical project links through rename/archive and refuses new archived or cross-customer notes', async () => {
    const created = await POST(request('service-projects', 'POST', { customerId, name: '  Website  ' }));
    expect(created.status).toBe(201);
    const project = await created.json();
    expect(project.name).toBe('Website'); expect(project.userId).toBeUndefined();
    const mismatched = await postNote(request('billing-notes', 'POST', { ...noteData(project.id), customerId: otherCustomerId }));
    expect(mismatched.status).toBe(404);
    const saved = await postNote(request('billing-notes', 'POST', noteData(project.id)));
    expect(saved.status).toBe(201);
    const note = await saved.json();
    expect(note).toMatchObject({ durationMinutes: 1, quantity: durationToQuantity(1), unit: 'Stunde', projectId: project.id });
    expect((await PATCH(request('service-projects', 'PATCH', { id: project.id, name: 'Website neu', archived: true }))).status).toBe(200);
    expect(await (await GET(new Request(`http://localhost/api/service-projects?customerId=${customerId}`))).json()).toEqual([]);
    expect(await (await GET(new Request(`http://localhost/api/service-projects?customerId=${customerId}&includeArchived=true`))).json()).toEqual([expect.objectContaining({ id: project.id, name: 'Website neu' })]);
    expect((await postNote(request('billing-notes', 'POST', noteData(project.id)))).status).toBe(409);
    const notes = await (await getNotes(new Request(`http://localhost/api/billing-notes?customerId=${customerId}&projectId=${project.id}`))).json();
    expect(notes).toEqual([expect.objectContaining({ id: note.id, durationMinutes: 1, project: expect.objectContaining({ id: project.id, name: 'Website neu' }) })]);
    await expect(db.client.serviceProject.delete({ where: { id: project.id } })).rejects.toThrow();
    await expect(db.client.serviceProject.update({ where: { id: project.id }, data: { customerId: otherCustomerId } })).rejects.toThrow();
    expect((await PATCH(request('service-projects', 'PATCH', { id: project.id, archived: false }))).status).toBe(200);
    state.userId = 'project-foreign';
    expect((await PATCH(request('service-projects', 'PATCH', { id: project.id, name: 'Stolen' }))).status).toBe(404);
    expect((await getNotes(new Request(`http://localhost/api/billing-notes?projectId=${project.id}`))).status).toBe(404);
    state.userId = 'project-owner';
  });

  it('filters by date/project/status without interpreting legacy quantity as minutes', async () => {
    const response = await postNote(request('billing-notes', 'POST', { customerId, serviceDate: '2026-10-20', description: 'Freie Menge', quantity: 1.5, unit: 'Stunde' }));
    expect(response.status).toBe(201);
    const legacy = await response.json(); expect(legacy.durationMinutes).toBeNull();
    const filtered = await getNotes(new Request(`http://localhost/api/billing-notes?customerId=${customerId}&projectId=none&from=2026-10-20&to=2026-10-20&status=open`));
    expect(await filtered.json()).toEqual([expect.objectContaining({ id: legacy.id, durationMinutes: null, quantity: 1.5 })]);
    expect((await getNotes(new Request('http://localhost/api/billing-notes?from=2026-02-30'))).status).toBe(400);
    expect((await getNotes(new Request('http://localhost/api/billing-notes?from=2026-10-21&to=2026-10-20'))).status).toBe(400);
  });

  it('keeps claimed minute sources immutable and atomically rejects repeated claims', async () => {
    const saved = await postNote(request('billing-notes', 'POST', noteData()));
    const note = await saved.json();
    const line = { positionNumber: '1', description: note.description, details: null, quantity: note.quantity, unit: note.unit, unitPrice: 95, baseQuantity: 1, baseUnit: 'Stunde', amount: 1.58, taxRate: 0, taxCategory: null, exemptionReason: null, charges: [], allowances: [] };
    const createClaim = () => db.client.$transaction(async tx => {
      const invoice = await tx.invoice.create({ data: { userId: state.userId, customerId, fileName: 'time.xml', storedFileName: 'time.xml', parsedData: {}, issuanceState: 'UNISSUED' } });
      await claimBillingNotesForInvoice(tx, { userId: state.userId, customerId, invoiceId: invoice.id, billingNoteIds: [note.id], lineItems: [line] });
      return invoice;
    });
    const results = await Promise.allSettled([createClaim(), createClaim()]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.client.invoice.count()).toBe(1);
    const linked = await db.client.billingNote.findUniqueOrThrow({ where: { id: note.id } });
    expect(linked.invoiceId).not.toBeNull();
    await expect(db.client.billingNote.update({ where: { id: note.id }, data: { durationMinutes: 60, quantity: 1 } })).rejects.toThrow();
    await expect(db.client.billingNote.update({ where: { id: note.id }, data: { description: 'Neue Quelle' } })).rejects.toThrow();
    expect((await deleteNote(new Request(`http://localhost/api/billing-notes?id=${note.id}`, { method: 'DELETE' }))).status).toBe(409);
    const linkedList = await (await getNotes(new Request(`http://localhost/api/billing-notes?customerId=${customerId}&status=linked`))).json();
    expect(linkedList).toEqual([expect.objectContaining({ id: note.id, invoiceId: linked.invoiceId })]);
  });

  it('enforces matching project tenant/customer and canonical duration even at direct database boundary', async () => {
    const project = await db.client.serviceProject.findFirstOrThrow({ where: { userId: state.userId } });
    const base = { userId: state.userId, customerId, serviceDate: new Date('2026-10-21T00:00:00Z'), description: 'DB boundary' };
    await expect(db.client.billingNote.create({ data: { ...base, customerId: otherCustomerId, projectId: project.id } })).rejects.toThrow();
    await expect(db.client.billingNote.create({ data: { ...base, durationMinutes: 90, quantity: 90, unit: 'Stunde' } })).rejects.toThrow();
    for (const minutes of [1, 59, 60, 61, 60000]) {
      await expect(db.client.billingNote.create({ data: { ...base, durationMinutes: minutes, quantity: durationToQuantity(minutes), unit: 'Stunde' } })).resolves.toMatchObject({ durationMinutes: minutes });
    }
  });

  it('replays concurrent captures once, audits once, and replays after a later claim and archive', async () => {
    const project = await db.client.serviceProject.findFirstOrThrow({ where: { userId: state.userId } });
    const command = { ...noteData(project.id), captureKey: randomUUID(), description: 'Idempotente Quelle' };
    const responses = await Promise.all([postNote(request('billing-notes', 'POST', command)), postNote(request('billing-notes', 'POST', command))]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 201]);
    const notes = await Promise.all(responses.map(response => response.json()));
    expect(notes[0].id).toBe(notes[1].id);
    const stored = await db.client.billingNote.findUniqueOrThrow({ where: { id: notes[0].id } });
    expect(stored.captureFingerprint).toBe(serviceCaptureFingerprint(stored));
    expect(await db.client.auditLog.count({ where: { userId: state.userId, action: 'CREATE', entityType: 'BillingNote', entityId: String(stored.id) } })).toBe(1);
    const invoice = await db.client.invoice.create({ data: { userId: state.userId, customerId, fileName: 'replay.xml', storedFileName: 'replay.xml', parsedData: {} } });
    await db.client.billingNote.update({ where: { id: stored.id }, data: { invoiceId: invoice.id } });
    await db.client.serviceProject.update({ where: { id: project.id }, data: { name: 'Später umbenannt', archivedAt: new Date() } });
    const replay = await postNote(request('billing-notes', 'POST', command));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ id: stored.id, invoiceId: invoice.id, captureKey: command.captureKey });
    expect((await postNote(request('billing-notes', 'POST', { ...command, description: 'Anderer Inhalt' }))).status).toBe(409);
    expect(await db.client.billingNote.count({ where: { userId: state.userId, captureKey: command.captureKey } })).toBe(1);
    await expect(db.client.billingNote.update({ where: { id: stored.id }, data: { captureKey: randomUUID() } })).rejects.toThrow();
    expect((await postNote(request('billing-notes', 'POST', { ...noteData(), captureKey: 'not-a-uuid' }))).status).toBe(400);
  });

  it('removes captured open notes without losing their receipt or allowing delete/retry resurrection', async () => {
    const command = { ...noteData(), captureKey: randomUUID(), description: 'Entfernter Erfassungsnachweis' };
    const response = await postNote(request('billing-notes', 'POST', command));
    expect(response.status).toBe(201);
    const note = await response.json();
    const remove = () => deleteNote(new Request(`http://localhost/api/billing-notes?id=${note.id}`, { method: 'DELETE' }));
    expect((await remove()).status).toBe(200);
    expect((await remove()).status).toBe(200);
    const removed = await db.client.billingNote.findUniqueOrThrow({ where: { id: note.id } });
    expect(removed.deletedAt).toBeInstanceOf(Date);
    expect(removed.captureKey).toBe(command.captureKey);
    expect(await db.client.auditLog.count({ where: { userId: state.userId, action: 'DELETE', entityType: 'BillingNote', entityId: String(note.id) } })).toBe(1);
    const all = await (await getNotes(new Request(`http://localhost/api/billing-notes?customerId=${customerId}&includeLinked=true&status=all`))).json();
    expect(all.some((row: { id: number }) => row.id === note.id)).toBe(false);
    const replay = await postNote(request('billing-notes', 'POST', command));
    expect(replay.status).toBe(409); expect(await replay.json()).toMatchObject({ code: 'CAPTURE_REMOVED' });
    await expect(db.client.billingNote.update({ where: { id: note.id }, data: { deletedAt: null } })).rejects.toThrow();
    const before = await db.client.invoice.count();
    await expect(db.client.$transaction(async tx => {
      const invoice = await tx.invoice.create({ data: { userId: state.userId, customerId, fileName: 'removed.xml', storedFileName: 'removed.xml', parsedData: {} } });
      await claimBillingNotesForInvoice(tx, { userId: state.userId, customerId, invoiceId: invoice.id, billingNoteIds: [note.id], lineItems: [] });
    })).rejects.toMatchObject({ status: 404 });
    expect(await db.client.invoice.count()).toBe(before);
  });

  it('serializes claim versus remove without ever claiming a removed capture', async () => {
    const command = { ...noteData(), captureKey: randomUUID(), description: 'Konkurrierende Erfassung' };
    const response = await postNote(request('billing-notes', 'POST', command)); const note = await response.json();
    const line = { positionNumber: '1', description: note.description, details: null, quantity: note.quantity, unit: note.unit, unitPrice: 0, baseQuantity: 1, baseUnit: 'Stunde', amount: 0, taxRate: 0, taxCategory: null, exemptionReason: null, charges: [], allowances: [] };
    const before = await db.client.invoice.count();
    const claim = db.client.$transaction(async tx => {
      const invoice = await tx.invoice.create({ data: { userId: state.userId, customerId, fileName: 'racing.xml', storedFileName: 'racing.xml', parsedData: {} } });
      await claimBillingNotesForInvoice(tx, { userId: state.userId, customerId, invoiceId: invoice.id, billingNoteIds: [note.id], lineItems: [line] });
    });
    const results = await Promise.allSettled([claim, deleteNote(new Request(`http://localhost/api/billing-notes?id=${note.id}`, { method: 'DELETE' }))]);
    const current = await db.client.billingNote.findUniqueOrThrow({ where: { id: note.id } });
    expect(Boolean(current.invoiceId) !== Boolean(current.deletedAt)).toBe(true);
    expect(await db.client.invoice.count()).toBe(before + (current.invoiceId === null ? 0 : 1));
    expect(results.some(result => result.status === 'fulfilled')).toBe(true);
  });

  it('preserves capture replay after backup owner remap and after tombstone merge', async () => {
    const { readBackupSnapshot } = await import('@/lib/backup-snapshot');
    const { createBackupManifest } = await import('@/lib/backup-manifest');
    const { restoreBackupData } = await import('@/lib/backup-restore');
    const previous = state.userId;
    const source = `capture-source-${randomUUID()}`; const target = `capture-target-${randomUUID()}`;
    await db.client.user.createMany({ data: [source, target].map(id => ({ id, email: `${id}@restore.test`, password: 'fixture' })) });
    state.userId = source;
    try {
      const customer = await db.client.customer.create({ data: { userId: source, name: 'Replay customer' } });
      const project = await db.client.serviceProject.create({ data: { userId: source, customerId: customer.id, name: 'Replay project' } });
      const command = { customerId: customer.id, projectId: project.id, serviceDate: '2026-10-21', description: 'Restore replay', duration: '01:01', captureKey: randomUUID() };
      expect((await postNote(request('billing-notes', 'POST', command))).status).toBe(201);
      const snapshot = await readBackupSnapshot(source);
      const backup = { version: '3.0', type: 'full', exportedAt: snapshot.info.endedAt, data: snapshot.data, manifest: createBackupManifest({ sourceUserId: source, generatedAt: snapshot.info.endedAt, data: snapshot.data, snapshot: snapshot.info }) };
      await restoreBackupData({ userId: target, overwrite: false, backup });
      state.userId = target;
      const mapped = await db.client.billingNote.findFirstOrThrow({ where: { userId: target } });
      const mappedCommand = { ...command, customerId: mapped.customerId, projectId: mapped.projectId };
      expect((await postNote(request('billing-notes', 'POST', mappedCommand))).status).toBe(200);
      expect((await postNote(request('billing-notes', 'POST', command))).status).toBe(409);
      expect((await deleteNote(new Request(`http://localhost/api/billing-notes?id=${mapped.id}`, { method: 'DELETE' }))).status).toBe(200);
      await restoreBackupData({ userId: target, overwrite: false, backup });
      expect((await postNote(request('billing-notes', 'POST', mappedCommand))).status).toBe(409);
      expect(await db.client.billingNote.count({ where: { userId: target } })).toBe(1);
      expect((await db.client.billingNote.findUniqueOrThrow({ where: { id: mapped.id } })).deletedAt).not.toBeNull();
    } finally { state.userId = previous; }
  });
});
