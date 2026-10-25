import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';
import type { IncomingDocumentList } from '@/lib/purchase-documents/types';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, userId: 'supplier-task-owner' as string | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return { requireUserId: async () => { if (!state.userId) throw new UnauthorizedError(); return state.userId; }, UnauthorizedError, unauthorizedResponse: () => new Response(null, { status: 401 }) };
});
// Deliberately do not mock financial audit: rollback test aborts its real REVIEW insert.
let database: ReturnType<typeof createTestDatabase>;
let route: typeof import('@/app/api/purchase-documents/[id]/supplier-task/route');
let list: typeof import('@/app/api/purchase-documents/route');
let service: typeof import('@/lib/purchase-documents/service');
const queryLog: string[] = [];
const owner = 'supplier-task-owner', other = 'supplier-task-other';
const request = (id: number, body: unknown, origin?: string) => new NextRequest(`http://localhost/api/purchase-documents/${id}/supplier-task`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const save = (id: number, revision: number, task: unknown) => route.POST(request(id, { expectedRevision: revision, task }), ctx(id));
async function source(userId = owner, name: string = randomUUID()) {
  return database.client.purchaseDocument.create({ data: {
    userId, originalFileName: `${name}.pdf`, storedFileName: `${randomUUID()}.pdf`, originalSha256: randomUUID().replaceAll('-', '').repeat(2),
    originalByteCount: 17, mediaType: 'application/pdf', uploadRequestId: randomUUID(), parseStatus: 'FAILED', parseErrorCode: 'NO_EMBEDDED_XML',
    reviewDraft: { supplierName: 'unverified', invoiceNumber: '', invoiceDate: '', paymentDate: '2026-10-20', amount: '', note: 'untouched' }, reviewDraftSavedAt: new Date(),
  } });
}
async function financialState(userId: string) {
  return Promise.all([
    database.client.income.findMany({ where: { userId }, orderBy: { id: 'asc' } }), database.client.expense.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    database.client.cashBook.findMany({ where: { userId }, orderBy: { id: 'asc' } }), database.client.cashTransaction.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    database.client.paymentJournalEvent.findMany({ where: { userId }, orderBy: { id: 'asc' } }), database.client.paymentAdjustment.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    database.client.paymentOperation.findMany({ where: { userId }, orderBy: { id: 'asc' } }), database.client.invoice.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    database.client.invoiceNumberCounter.findMany({ where: { userId }, orderBy: [{ type: 'asc' }, { year: 'asc' }] }),
    database.client.emailOutbox.findMany({ where: { userId }, orderBy: { id: 'asc' } }), database.client.emailOutboxAttempt.findMany({ where: { outbox: { userId } }, orderBy: { id: 'asc' } }),
  ]);
}
async function listing(query: string): Promise<IncomingDocumentList> {
  const response = await list.GET(new NextRequest(`http://localhost/api/purchase-documents?${query}`));
  expect(response.status).toBe(200); return response.json();
}
beforeAll(async () => {
  vi.stubEnv('NEXTAUTH_URL', 'http://localhost');
  database = createTestDatabase(); state.client = database.client;
  database.client.$on('query', event => queryLog.push(event.query));
  await database.client.user.createMany({ data: [owner, other].map(id => ({ id, email: `${id}@fixture.invalid`, password: 'synthetic' })) });
  route = await import('@/app/api/purchase-documents/[id]/supplier-task/route');
  list = await import('@/app/api/purchase-documents/route'); service = await import('@/lib/purchase-documents/service');
}, 40_000);
afterAll(async () => { state.userId = owner; await database?.cleanup(); vi.unstubAllEnvs(); });

describe('tenant-bound internal supplier task API', () => {
  it('sets/changes/removes explicit tasks without changing source, draft payment date or any financial/outbox state', async () => {
    state.userId = owner; const doc = await source(); const before = await financialState(owner);
    expect((await service.purchaseDocumentDetail(owner, doc.id)).supplierTask).toBeNull();
    for (const [index, task] of [{ kind: 'PAYMENT_CHECK', followUpDate: '2024-02-29' }, { kind: 'DIRECT_DEBIT_WAIT', followUpDate: null }, { kind: 'CLARIFY', followUpDate: '2026-11-01' }, null].entries()) {
      const response = await save(doc.id, doc.revision + index, task); expect(response.status).toBe(200);
      const dto = (await response.json()).document;
      expect(dto.supplierTask).toEqual(task ? { ...task, confirmationRequired: false } : null);
      expect(dto.reviewDraft.paymentDate).toBe('2026-10-20'); expect(dto.reviewState).toBe('REVIEW'); expect(dto.linkedExpenseId).toBeNull();
      expect((await service.purchaseDocumentDetail(owner, doc.id)).supplierTask).toEqual(dto.supplierTask);
    }
    const after = await database.client.purchaseDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect({ ...after, revision: doc.revision, updatedAt: doc.updatedAt }).toEqual(doc);
    expect(await financialState(owner)).toEqual(before);
    const audit = await database.client.auditLog.findMany({ where: { userId: owner, entityType: 'PurchaseDocument', entityId: String(doc.id), action: 'REVIEW' } });
    expect(audit).toHaveLength(4);
    for (const entry of audit) expect(JSON.parse(entry.metadata!)).toMatchObject({ actorId: owner, tenantId: owner, operation: 'purchase-document.supplier-task', originalReference: doc.originalSha256 });
  });
  it('rejects missing auth, cross-origin, foreign source, invalid calendar days and unexpected fields before writes', async () => {
    const doc = await source(); const before = await database.client.purchaseDocument.findUniqueOrThrow({ where: { id: doc.id } });
    state.userId = null; expect((await save(doc.id, doc.revision, null)).status).toBe(401);
    state.userId = other; expect((await save(doc.id, doc.revision, null)).status).toBe(404);
    state.userId = owner;
    expect((await route.POST(request(doc.id, { expectedRevision: 0, task: null }, 'https://attacker.invalid'), ctx(doc.id))).status).toBe(403);
    for (const body of [
      { expectedRevision: 0, task: { kind: 'CLARIFY', followUpDate: '2026-02-30' } }, { expectedRevision: 0, task: { kind: 'PAID', followUpDate: null } },
      { expectedRevision: 0, task: { kind: 'CLARIFY', followUpDate: null, userId: other } }, { expectedRevision: 0, task: null, expenseId: 1 },
      { expectedRevision: -1, task: null }, { task: null }, { expectedRevision: 0 },
    ]) expect((await route.POST(request(doc.id, body), ctx(doc.id))).status).toBe(400);
    expect(await database.client.purchaseDocument.findUniqueOrThrow({ where: { id: doc.id } })).toEqual(before);
  });
  it('compare-and-swaps two tabs and requires explicit reconfirm/discard after reopening, preserving inactive history', async () => {
    const doc = await source();
    const results = await Promise.all([save(doc.id, 0, { kind: 'PAYMENT_CHECK', followUpDate: null }), save(doc.id, 0, { kind: 'CLARIFY', followUpDate: null })]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    const saved = await service.purchaseDocumentDetail(owner, doc.id);
    const dismissed = await service.changePurchaseReview(owner, doc.id, saved.revision, 'dismiss', 'synthetic inactive history');
    expect(dismissed.supplierTask).toEqual(saved.supplierTask);
    expect((await save(doc.id, dismissed.revision, null)).status).toBe(409);
    const reopened = await service.changePurchaseReview(owner, doc.id, dismissed.revision, 'reopen');
    expect(reopened.supplierTask).toEqual({ ...saved.supplierTask!, confirmationRequired: true });
    expect((await listing(`taskKind=any&search=${doc.originalFileName}`)).documents).toEqual([]);
    expect((await listing(`search=${doc.originalFileName}`)).documents.map(row => row.id)).toEqual([doc.id]);
    const confirmed = await save(doc.id, reopened.revision, { kind: saved.supplierTask!.kind, followUpDate: saved.supplierTask!.followUpDate }); expect(confirmed.status).toBe(200);
    expect((await listing(`taskKind=any&search=${doc.originalFileName}`)).documents.map(row => row.id)).toEqual([doc.id]);
    const confirmedDto = (await confirmed.json()).document;
    const reopenedAgain = await service.changePurchaseReview(owner, doc.id, (await service.changePurchaseReview(owner, doc.id, confirmedDto.revision, 'dismiss', 'again')).revision, 'reopen');
    expect((await save(doc.id, reopenedAgain.revision, null)).status).toBe(200);
    expect((await service.purchaseDocumentDetail(owner, doc.id)).supplierTask).toBeNull();
  });
  it('retains a booked task as inactive read-only history and leaves the explicit expense untouched', async () => {
    const doc = await source(); const saved = (await (await save(doc.id, doc.revision, { kind: 'DIRECT_DEBIT_WAIT', followUpDate: null })).json()).document;
    const supplier = await database.client.supplier.create({ data: { userId: owner, name: 'Synthetic explicit supplier' } });
    const expense = await database.client.expense.create({ data: { userId: owner, description: 'Previously explicitly approved fixture', amount: 19, date: new Date('2026-10-20T00:00:00Z') } });
    await database.client.purchaseDocument.update({ where: { id: doc.id }, data: { reviewStatus: 'BOOKED', expenseId: expense.id, supplierId: supplier.id, selectedSupplierSnapshot: { id: supplier.id, name: supplier.name, revision: supplier.revision }, approvedAt: new Date(), approvalRequestId: randomUUID(), approvalFingerprint: 'a'.repeat(64), revision: { increment: 1 } } });
    const before = await financialState(owner), booked = await service.purchaseDocumentDetail(owner, doc.id);
    expect(booked.supplierTask).toEqual(saved.supplierTask);
    expect((await listing(`taskKind=any&search=${doc.originalFileName}`)).documents).toEqual([]);
    expect((await save(doc.id, booked.revision, null)).status).toBe(409);
    await expect(service.changePurchaseReview(owner, doc.id, booked.revision, 'reopen')).rejects.toMatchObject({ status: 409 });
    expect(await financialState(owner)).toEqual(before);
  });
  it('rolls back the source and audit together when an actual REVIEW insert fails, guarded to the exact fresh isolated database', async () => {
    const doc = await source(); const before = await database.client.purchaseDocument.findUniqueOrThrow({ where: { id: doc.id } });
    const beforeFinancial = await financialState(owner), beforeAudits = await database.client.auditLog.count();
    const databases = await database.client.$queryRawUnsafe<Array<{ name: string; file: string }>>('PRAGMA database_list');
    const expectedPath = database.url.slice('file:'.length);
    expect(path.basename(expectedPath)).toBe('test.db'); expect(path.dirname(expectedPath)).toMatch(new RegExp(`^${tmpdir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/bivaro-test-[^/]+$`));
    expect(await realpath(databases.find(row => row.name === 'main')!.file)).toBe(await realpath(expectedPath));
    await database.client.$executeRawUnsafe(`CREATE TRIGGER supplier_task_review_failure BEFORE INSERT ON AuditLog WHEN NEW.userId='supplier-task-owner' AND NEW.action='REVIEW' AND NEW.entityType='PurchaseDocument' BEGIN SELECT RAISE(ABORT,'synthetic supplier task REVIEW audit failure'); END;`);
    try {
      const response = await save(doc.id, doc.revision, { kind: 'CLARIFY', followUpDate: null }); expect(response.status).toBe(500);
      expect(await database.client.purchaseDocument.findUniqueOrThrow({ where: { id: doc.id } })).toEqual(before);
      expect(await financialState(owner)).toEqual(beforeFinancial); expect(await database.client.auditLog.count()).toBe(beforeAudits);
    } finally { await database.client.$executeRawUnsafe('DROP TRIGGER IF EXISTS supplier_task_review_failure'); }
    expect((await save(doc.id, doc.revision, { kind: 'CLARIFY', followUpDate: null })).status).toBe(200);
  });
  it('queries real Berlin-day filters with bounded stable pagination, equal dates, nulls, reconfirmation and tenant isolation', async () => {
    const marker = `pages-${randomUUID()}`; const today = (await listing('limit=1')).supplierTaskToday!;
    const rows = [];
    for (const [index, date] of ['1900-01-01', today, today, '9999-12-31', null, null].entries()) {
      const doc = await source(owner, `${marker}-${index}`); rows.push(doc);
      await save(doc.id, 0, { kind: index === 3 ? 'DIRECT_DEBIT_WAIT' : 'CLARIFY', followUpDate: date });
    }
    const foreign = await source(other, `${marker}-foreign`);
    await database.client.purchaseDocument.update({ where: { id: foreign.id }, data: { supplierTaskKind: 'CLARIFY', supplierTaskFollowUpDate: today } });
    const pending = await source(owner, `${marker}-pending`);
    await database.client.purchaseDocument.update({ where: { id: pending.id }, data: { supplierTaskKind: 'CLARIFY', supplierTaskFollowUpDate: today, supplierTaskConfirmationRequired: true } });
    const first = await listing(`taskKind=any&search=${marker}&limit=2&page=1`), second = await listing(`taskKind=any&search=${marker}&limit=2&page=2`), third = await listing(`taskKind=any&search=${marker}&limit=2&page=3`);
    expect(first.total).toBe(6); expect([...first.documents, ...second.documents, ...third.documents].map(row => row.id)).toEqual(rows.map(row => row.id));
    expect((await listing(`taskKind=any&search=${marker}&taskDue=due`)).documents.map(row => row.id)).toEqual(rows.slice(0, 3).map(row => row.id));
    expect((await listing(`taskKind=any&search=${marker}&taskDue=later`)).documents.map(row => row.id)).toEqual([rows[3].id]);
    expect((await listing(`taskDue=undated&search=${marker}`)).documents.map(row => row.id)).toEqual(rows.slice(4).map(row => row.id));
    expect((await listing(`taskKind=DIRECT_DEBIT_WAIT&search=${marker}`)).documents.map(row => row.id)).toEqual([rows[3].id]);
    expect((await listing(`taskKind=any&search=${marker}&page=99`)).documents).toEqual([]);
    for (const query of ['limit=51', 'page=0', 'taskKind=PAID', 'taskDue=tomorrow', 'taskKind=any&reviewStatus=DISMISSED']) expect((await list.GET(new NextRequest(`http://localhost/api/purchase-documents?${query}`))).status).toBe(400);
    expect(queryLog.some(query => /SELECT/i.test(query) && /supplierTaskFollowUpDate/.test(query) && /LIMIT/.test(query))).toBe(true);
  });
});
