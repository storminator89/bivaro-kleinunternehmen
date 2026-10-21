import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestDatabase } from './helpers/database';
const state = vi.hoisted(() => ({ client: null as unknown, userId: 'purchase-owner', failAudit: false, failAuditEntity: '' }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => { class UnauthorizedError extends Error {} return { requireUserId: async () => state.userId, getUserId: async () => state.userId, UnauthorizedError, unauthorizedResponse: () => new Response(null, { status: 401 }) }; });
vi.mock('@/lib/api-auth', () => ({ withApiAuth: async (_request: Request, handler: (value: { userId: string }) => unknown) => handler({ userId: state.userId }), apiError: (error: string, status: number, code: string) => Response.json({ error, code }, { status }), apiSuccess: (value: unknown) => Response.json(value), corsHeaders: () => ({}), handleCors: () => new Response(null) }));
vi.mock('@/lib/audit-log', async importOriginal => { const actual = await importOriginal<typeof import('@/lib/audit-log')>(); return { ...actual, createFinancialAuditLog: async (...args: Parameters<typeof actual.createFinancialAuditLog>) => { if (state.failAudit && (!state.failAuditEntity || args[0].entityType === state.failAuditEntity) && args[0].metadata.operation === 'purchase-document.approve-expense') throw new Error('synthetic audit failure'); return actual.createFinancialAuditLog(...args); } }; });
let database: ReturnType<typeof createTestDatabase>, storage: string;
let service: typeof import('@/lib/purchase-documents/service'), approval: typeof import('@/lib/purchase-documents/approval'), suppliers: typeof import('@/lib/suppliers');
let route: typeof import('@/app/api/purchase-documents/[id]/approve-expense/route'), expenses: typeof import('@/app/api/expenses/route'), v1: typeof import('@/app/api/v1/expenses/route'), detail: typeof import('@/app/api/expenses/[id]/route'), download: typeof import('@/app/api/expenses/download/route'), receiptExport: typeof import('@/app/api/expenses/export/route');
let supplierId: number;
const queryLog: string[] = [];
const xml = (number: string, amount = '119.00', currency = 'EUR', extra = '', root = 'Invoice') => `<${root}><ID>${number}</ID><IssueDate>2026-10-20</IssueDate><DocumentCurrencyCode>${currency}</DocumentCurrencyCode><AccountingSupplierParty><Party><PartyName><Name>Source Seller</Name></PartyName></Party></AccountingSupplierParty><AccountingCustomerParty><Party><PartyName><Name>Unverified Buyer</Name></PartyName></Party></AccountingCustomerParty><LegalMonetaryTotal><TaxInclusiveAmount>${amount}</TaxInclusiveAmount><PayableAmount>${amount}</PayableAmount>${extra}</LegalMonetaryTotal></${root}>`;
const body = (revision: number) => ({ approvalRequestId: randomUUID(), expectedRevision: revision, description: 'Reviewed supplies', amount: '119.00', expenseDate: '2026-10-19', category: 'Büromaterial', taxRelevant: true, taxDeductiblePercentage: '75', depreciationYears: null, confirmPaymentDate: true, confirmReviewedOriginal: true, confirmBuyerBelongsToBusiness: true, acknowledgedDuplicates: [] });
const request = (url: string, method: string, payload?: unknown) => new NextRequest(`http://localhost${url}`, { method, ...(payload ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {}) });
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
async function source(name: string, bytes = xml(name), assign = true) {
  let result = await service.intakePurchaseDocument({ userId: state.userId, requestId: randomUUID(), originalFileName: `${name}.xml`, mediaType: 'application/xml', bytes: Buffer.from(bytes) });
  if (assign) result = { ...result, document: await approval.selectPurchaseSupplier(state.userId, result.document.id, result.document.revision, supplierId) };
  return result.document;
}
async function approve(id: number, payload: Record<string, unknown>) { return route.POST(request(`/api/purchase-documents/${id}/approve-expense`, 'POST', payload), ctx(id)); }
beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  database.client.$on('query', event => { queryLog.push(event.query); });
  storage = await mkdtemp(path.join(tmpdir(), 'bivaro-purchase-booking-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(storage);
  try {
    await database.client.user.createMany({ data: [{ id: state.userId, email: 'purchase@test.invalid', password: 'synthetic' }, { id: 'purchase-other', email: 'other@test.invalid', password: 'synthetic' }] });
    service = await import('@/lib/purchase-documents/service'); approval = await import('@/lib/purchase-documents/approval'); suppliers = await import('@/lib/suppliers');
    route = await import('@/app/api/purchase-documents/[id]/approve-expense/route'); expenses = await import('@/app/api/expenses/route'); v1 = await import('@/app/api/v1/expenses/route'); detail = await import('@/app/api/expenses/[id]/route'); download = await import('@/app/api/expenses/download/route'); receiptExport = await import('@/app/api/expenses/export/route');
    supplierId = (await suppliers.createSupplier(state.userId, { name: 'Deliberately selected supplier', city: 'Berlin' })).id;
  } finally { cwd.mockRestore(); }
}, 40_000);
afterAll(async () => { await database?.cleanup(); if (storage) await rm(storage, { recursive: true, force: true }); });
describe('explicit purchase-side contacts', () => {
  it('keeps equal-name contacts distinct, bounded scalar lists and contact ownership', async () => {
    const a = await suppliers.createSupplier(state.userId, { name: 'Same name' }), b = await suppliers.createSupplier(state.userId, { name: 'Same name' }); expect(a.id).not.toBe(b.id);
    const list = await suppliers.listSuppliers(state.userId, new URLSearchParams('search=Same&limit=1')); expect(list.items).toHaveLength(1); expect(list.total).toBe(2); expect(list.items[0]).not.toHaveProperty('userId'); expect(list.items[0]).not.toHaveProperty('purchaseDocuments');
    await expect(suppliers.listSuppliers(state.userId, new URLSearchParams('limit=10000'))).rejects.toThrow();
    const doc = await source('SUPPLIER-OWNER', undefined, false); await expect(approval.selectPurchaseSupplier('purchase-other', doc.id, doc.revision, a.id)).rejects.toMatchObject({ status: 404 });
    await expect(suppliers.updateSupplier('purchase-other', a.id, { name: 'Changed', expectedRevision: 0 })).rejects.toMatchObject({ status: 404 });
    expect(await database.client.customer.count()).toBe(0);
  });
  it('preserves both original parties and selected historical contact snapshot, protects referenced delete', async () => {
    const doc = await source('SNAPSHOT'); const selected = doc.selectedSupplierSnapshot;
    expect(selected?.name).toBe('Deliberately selected supplier'); expect(doc.supplierCandidate?.name).toBe('Source Seller'); expect(doc.buyerCandidate?.name).toBe('Unverified Buyer');
    await suppliers.updateSupplier(state.userId, supplierId, { name: 'Changed supplier master', expectedRevision: 0 });
    const again = await service.purchaseDocumentDetail(state.userId, doc.id); expect(again.selectedSupplierSnapshot).toEqual(selected); expect(again.supplierCandidate).toEqual(doc.supplierCandidate); expect(again.buyerCandidate).toEqual(doc.buyerCandidate);
    await expect(suppliers.deleteSupplier(state.userId, supplierId, 1)).rejects.toMatchObject({ code: 'SUPPLIER_REFERENCED' });
  });
});
describe('transactional exactly-once confirmed expense', () => {
  it.each([
    ['missing date', { expenseDate: undefined }], ['invalid date', { expenseDate: '2026-02-30' }], ['timestamp', { expenseDate: '2026-10-19T00:00:00Z' }], ['unpaid', { confirmPaymentDate: false }], ['wrong buyer', { confirmBuyerBelongsToBusiness: false }], ['unreviewed', { confirmReviewedOriginal: false }], ['empty category', { category: '' }], ['implicit deductibility', { taxDeductiblePercentage: undefined }], ['implicit tax', { taxRelevant: undefined }], ['subcent', { amount: '119.001' }], ['Number amount', { amount: 119 }], ['mismatched gross', { amount: '118.00' }], ['implicit depreciation', { depreciationYears: undefined }],
  ])('rejects %s without writing a financial row', async (_name, changes) => {
    const doc = await source(`INVALID-${randomUUID()}`), before = await database.client.expense.count();
    const response = await approve(doc.id, { ...body(doc.revision), ...changes }); expect(response.status).toBe(400); expect(await database.client.expense.count()).toBe(before); expect((await service.purchaseDocumentDetail(state.userId, doc.id)).reviewState).toBe('REVIEW');
  });
  it('does not trust cached or restored approvalSupported', async () => {
    for (const [index, bytes] of [xml('FOREIGN', '119.00', 'USD'), xml('CREDIT', '119.00', 'EUR', '', 'CreditNote'), xml('SUBCENT', '119.000000000000000001'), xml('PREPAID', '119.00', 'EUR', '<PrepaidAmount>0.000000000000000001</PrepaidAmount>')].entries()) {
      const doc = await source(`UNSUPPORTED-${index}`, bytes); const cached = await database.client.purchaseDocument.findUniqueOrThrow({ where: { id: doc.id } });
      await database.client.purchaseDocument.update({ where: { id: doc.id }, data: { parsedData: { ...(cached.parsedData as object), approvalSupported: true, currency: 'EUR', grossAmount: '119.00' } } });
      const response = await approve(doc.id, body(doc.revision)); expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'UNSUPPORTED_APPROVAL' });
    }
  });
  it('requires selected supplier and rejects stale revisions', async () => {
    const doc = await source('NO-SELECT', undefined, false); expect((await approve(doc.id, body(doc.revision))).status).toBe(409);
    const selected = await approval.selectPurchaseSupplier(state.userId, doc.id, doc.revision, supplierId); expect((await approve(selected.id, body(selected.revision - 1))).status).toBe(409);
  });
  it.each(['PENDING', 'FAILED', 'OLD_VERSION'])('requires explicit preview recovery for %s before any booking', async parseState => {
    const doc = await source(`RECOVERY-${parseState}`), before = await database.client.expense.count();
    await database.client.purchaseDocument.update({ where: { id: doc.id }, data: parseState === 'OLD_VERSION' ? { parserVersion: 'purchase-preview-v1' } : { parseStatus: parseState, parsedData: (await import('@prisma/client')).Prisma.DbNull, parserVersion: null } });
    const response = await approve(doc.id, body(doc.revision)); expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'REPARSE_REQUIRED' }); expect(await database.client.expense.count()).toBe(before);
    const recovered = await service.retryPurchaseParse(state.userId, doc.id, doc.revision); expect(recovered.parseStatus).toBe('PARSED'); expect((await approve(doc.id, body(recovered.revision))).status).toBe(200);
  });
  it('creates one Expense with actual payment date, both audits, no Income/Invoice/Customer/cash', async () => {
    const doc = await source('SUCCESS'), payload = body(doc.revision), before = await database.client.expense.count();
    const response = await approve(doc.id, payload); expect(response.status).toBe(200); const result = await response.json();
    expect(result).toMatchObject({ replayed: false, document: { reviewState: 'BOOKED', revision: doc.revision + 1 }, expense: { amount: 119, date: '2026-10-19T00:00:00.000Z', taxDeductiblePercentage: 75 } }); expect(result.document.linkedExpenseId).toBe(result.expense.id);
    expect(await database.client.expense.count()).toBe(before + 1); expect(await database.client.income.count()).toBe(0); expect(await database.client.invoice.count()).toBe(0); expect(await database.client.customer.count()).toBe(0); expect(await database.client.cashTransaction.count()).toBe(0);
    const audits = await database.client.auditLog.findMany({ where: { userId: state.userId, entityType: { in: ['Expense', 'PurchaseDocument'] } } }); expect(audits.filter(audit => audit.metadata?.includes('purchase-document.approve-expense') && ((audit.entityType === 'PurchaseDocument' && audit.entityId === String(doc.id)) || (audit.entityType === 'Expense' && audit.entityId === String(result.expense.id))))).toHaveLength(2);
    const replay = await approve(doc.id, payload); expect(replay.status).toBe(200); expect(await replay.json()).toMatchObject({ replayed: true, expense: { id: result.expense.id } });
    expect((await approve(doc.id, { ...payload, description: 'Changed' })).status).toBe(409); expect((await approve(doc.id, { ...payload, approvalRequestId: randomUUID() })).status).toBe(409); expect(await database.client.expense.count()).toBe(before + 1);
    expect((await detail.GET(request(`/api/expenses/${result.expense.id}`, 'GET'), ctx(result.expense.id))).status).toBe(200);
    state.userId = 'purchase-other'; expect((await detail.GET(request(`/api/expenses/${result.expense.id}`, 'GET'), ctx(result.expense.id))).status).toBe(404); expect((await approve(doc.id, payload)).status).toBe(404); state.userId = 'purchase-owner';
  });
  it('rolls back Expense and source claim when mandatory audit fails', async () => {
    const doc = await source('AUDIT-ROLLBACK'), before = await database.client.expense.count(); state.failAudit = true;
    try { expect((await approve(doc.id, body(doc.revision))).status).toBe(500); } finally { state.failAudit = false; }
    expect(await database.client.expense.count()).toBe(before); expect((await service.purchaseDocumentDetail(state.userId, doc.id)).reviewState).toBe('REVIEW');
  });
  it('rolls back both financial objects when document audit or conditional claim fails', async () => {
    const doc = await source('SECOND-AUDIT-ROLLBACK'), before = await database.client.expense.count(); state.failAudit = true; state.failAuditEntity = 'PurchaseDocument';
    try { expect((await approve(doc.id, body(doc.revision))).status).toBe(500); } finally { state.failAudit = false; state.failAuditEntity = ''; }
    expect(await database.client.expense.count()).toBe(before); expect((await service.purchaseDocumentDetail(state.userId, doc.id)).reviewState).toBe('REVIEW');
    const claim = await source('CONDITIONAL-CLAIM-ROLLBACK');
    await database.client.$executeRawUnsafe(`CREATE TRIGGER synthetic_skip_purchase_claim BEFORE UPDATE ON PurchaseDocument WHEN OLD.id = ${claim.id} AND NEW.reviewStatus = 'BOOKED' BEGIN SELECT RAISE(IGNORE); END`);
    try { expect((await approve(claim.id, body(claim.revision))).status).toBe(409); } finally { await database.client.$executeRawUnsafe('DROP TRIGGER synthetic_skip_purchase_claim'); }
    expect(await database.client.expense.count()).toBe(before); expect((await service.purchaseDocumentDetail(state.userId, claim.id)).reviewState).toBe('REVIEW');
  });
  it('same-key concurrent retries return one linked Expense; different-key race cannot double post', async () => {
    const doc = await source('RACE-SAME'), payload = body(doc.revision), before = await database.client.expense.count();
    const results = await Promise.all([approve(doc.id, payload), approve(doc.id, payload)]); expect(results.map(result => result.status)).toEqual([200, 200]); const parsed = await Promise.all(results.map(result => result.json())); expect(parsed[0].expense.id).toBe(parsed[1].expense.id); expect(parsed.map(result => result.replayed).sort()).toEqual([false, true]); expect(await database.client.expense.count()).toBe(before + 1);
    const other = await source('RACE-DIFFERENT'), a = body(other.revision), b = { ...a, approvalRequestId: randomUUID() }; const competing = await Promise.all([approve(other.id, a), approve(other.id, b)]); expect(competing.filter(result => result.status === 200)).toHaveLength(1); expect(competing.some(result => [409, 429].includes(result.status))).toBe(true); expect(await database.client.expense.count()).toBe(before + 2);
  });
  it('requires exact current duplicate candidate revisions, including candidate booked after review', async () => {
    const doc = await source('DUPLICATE-A', xml('BUSINESS-SAME')); const other = await source('DUPLICATE-B', xml('BUSINESS-SAME') + '\n');
    const payload = { ...body(doc.revision), acknowledgedDuplicates: [{ id: other.id, revision: other.revision }] };
    expect((await approve(doc.id, body(doc.revision))).status).toBe(409);
    await service.changePurchaseReview(state.userId, other.id, other.revision, 'dismiss', 'synthetic duplicate');
    expect((await approve(doc.id, payload)).status).toBe(409);
    payload.acknowledgedDuplicates[0].revision += 1; expect((await approve(doc.id, payload)).status).toBe(200);
  });
  it('lists bounded source-link flags, locks malformed/foreign relations and never exposes foreign source IDs or preview JSON', async () => {
    const doc = await source('LIST-LINK-FLAGS'), result = await (await approve(doc.id, { ...body(doc.revision), description: 'LIST-CONTROL source' })).json();
    const manual = await database.client.expense.create({ data: { userId: state.userId, description: 'LIST-CONTROL manual', amount: 3 } });
    const list = async () => { const response = await expenses.GET(request('/api/expenses?search=LIST-CONTROL', 'GET')); expect(response.status).toBe(200); return (await response.json()).items as Array<{ id: number; sourceLinked: boolean; sourceDocumentId: number | null }>; };
    queryLog.length = 0;
    const ordinary = await list();
    expect(ordinary.find(item => item.id === manual.id)).toMatchObject({ sourceLinked: false, sourceDocumentId: null });
    expect(ordinary.find(item => item.id === result.expense.id)).toMatchObject({ sourceLinked: true, sourceDocumentId: doc.id });
    expect(queryLog.join('\n')).not.toContain('parsedData'); expect(queryLog.join('\n')).not.toContain('selectedSupplierSnapshot');
    for (const item of ordinary) { expect(item).not.toHaveProperty('purchaseDocument'); expect(item).not.toHaveProperty('parsedData'); }
    try {
      await database.client.purchaseDocument.update({ where: { id: doc.id }, data: { userId: 'purchase-other' } });
      expect((await list()).find(item => item.id === result.expense.id)).toMatchObject({ sourceLinked: true, sourceDocumentId: null });
      await database.client.purchaseDocument.update({ where: { id: doc.id }, data: { userId: state.userId, reviewStatus: 'REVIEW' } });
      expect((await list()).find(item => item.id === result.expense.id)).toMatchObject({ sourceLinked: true, sourceDocumentId: null });
      await database.client.purchaseDocument.update({ where: { id: doc.id }, data: { reviewStatus: 'BOOKED', storedFileName: 'incorrect-private-ref.xml' } });
      expect((await list()).find(item => item.id === result.expense.id)).toMatchObject({ sourceLinked: true, sourceDocumentId: null });
    } finally { const persisted = await database.client.expense.findUniqueOrThrow({ where: { id: result.expense.id } }); await database.client.purchaseDocument.update({ where: { id: doc.id }, data: { userId: state.userId, reviewStatus: 'BOOKED', storedFileName: persisted.storedReceiptFileName! } }); }
  });
  it('blocks session/v1 generic edits/deletes, cash link, and keeps XML receipt safe/downloadable', async () => {
    const doc = await source('IMMUTABLE'), result = await (await approve(doc.id, body(doc.revision))).json(), id = result.expense.id;
    expect((await expenses.PUT(request('/api/expenses', 'PUT', { id, description: 'Changed', amount: 1 }))).status).toBe(409);
    expect((await expenses.DELETE(request(`/api/expenses?id=${id}`, 'DELETE'))).status).toBe(409);
    expect((await v1.PUT(request(`/api/v1/expenses?id=${id}`, 'PUT', { description: 'Changed' }))).status).toBe(409);
    expect((await v1.DELETE(request(`/api/v1/expenses?id=${id}`, 'DELETE'))).status).toBe(409);
    const book = await database.client.cashBook.create({ data: { userId: state.userId, name: 'synthetic cash', initialBalance: 500 } });
    const cash = await import('@/lib/cashbook-service'); await expect(cash.createCashTransaction(state.userId, { cashBookId: book.id, expenseId: id, type: 'AUSGABE', amount: 119, date: '2026-10-19', description: 'No cash linking' })).rejects.toMatchObject({ status: 409 });
    const receipt = await download.GET(request(`/api/expenses/download?id=${id}`, 'GET')); expect(receipt.status).toBe(200); expect(receipt.headers.get('content-type')).toContain('application/xml'); expect(receipt.headers.get('content-disposition')).toContain('attachment'); expect(receipt.headers.get('x-content-type-options')).toBe('nosniff'); expect(await receipt.text()).toBe(xml('IMMUTABLE'));
    const zip = await receiptExport.GET(request('/api/expenses/export?search=Reviewed', 'GET')); expect(zip.status).toBe(200); const JSZip = (await import('jszip')).default; const archive = await JSZip.loadAsync(await zip.arrayBuffer()); expect(await archive.file('belege-metadata.csv')!.async('string')).toContain(doc.originalRef.sha256);
  });
  it('preserves real approval replay after full-backup supplier/source/expense ID remapping', async () => {
    const oldOwner = state.userId, oldSupplier = supplierId;
    try {
      state.userId = 'actual-replay-source';
      await database.client.user.createMany({ data: [{ id: state.userId, email: 'actual-source@test.invalid', password: 'synthetic' }, { id: 'actual-replay-target', email: 'actual-target@test.invalid', password: 'synthetic' }] });
      supplierId = (await suppliers.createSupplier(state.userId, { name: 'Restorable chosen supplier', city: 'Berlin' })).id;
      const doc = await source('ACTUAL-REPLAY', xml('RESTORE-DUPLICATE')), duplicate = await source('ACTUAL-DUPLICATE', xml('RESTORE-DUPLICATE') + '\n');
      const payload = { ...body(doc.revision), acknowledgedDuplicates: [{ id: duplicate.id, revision: duplicate.revision }] };
      const original = await approve(doc.id, payload); expect(original.status).toBe(200); const originalExpenseId = (await original.json()).expense.id;
      const full = await (await import('@/app/api/backup/full/route')).GET(); expect(full.status).toBe(200);
      const JSZip = (await import('jszip')).default, zip = await JSZip.loadAsync(await full.arrayBuffer()), backup = JSON.parse(await zip.file('backup.json')!.async('string'));
      await (await import('@/lib/backup-restore')).restoreBackupData({ userId: 'actual-replay-target', backup, overwrite: false, resolveFile: async (kind, sourceName) => { const entry = backup.manifest.fileManifest.find((entry: { kind: string; sourceName: string }) => entry.kind === kind && entry.sourceName === sourceName); return entry?.zipPath ? zip.file(entry.zipPath)!.async('uint8array') : null; } });
      state.userId = 'actual-replay-target';
      const restored = await database.client.purchaseDocument.findFirstOrThrow({ where: { userId: state.userId, originalSha256: doc.originalRef.sha256 } }), restoredDuplicate = await database.client.purchaseDocument.findFirstOrThrow({ where: { userId: state.userId, originalSha256: duplicate.originalRef.sha256 } });
      expect(restored.supplierId).not.toBe(supplierId); expect(restored.id).not.toBe(doc.id); expect(restored.expenseId).not.toBe(originalExpenseId);
      const before = await database.client.expense.count({ where: { userId: state.userId } });
      const replay = await approve(restored.id, { ...payload, acknowledgedDuplicates: [{ id: restoredDuplicate.id, revision: duplicate.revision }] }); expect(replay.status).toBe(200); expect(await replay.json()).toMatchObject({ replayed: true, expense: { id: restored.expenseId } }); expect(await database.client.expense.count({ where: { userId: state.userId } })).toBe(before);
    } finally { state.userId = oldOwner; supplierId = oldSupplier; }
  });
  it('rejects corrupted recurring-source replay and both template delete paths without disconnecting provenance', async () => {
    const doc = await source('RECURRING-GUARD'), result = await (await approve(doc.id, body(doc.revision))).json();
    const scheduled = new Date('2026-10-01T00:00:00.000Z'), recurring = await database.client.recurringExpense.create({ data: { userId: state.userId, description: 'Synthetic malformed source link', amount: 119, interval: 'MONTHLY', startDate: scheduled, nextExecution: scheduled, endDate: scheduled } });
    await database.client.expense.update({ where: { id: result.expense.id }, data: { recurringExpenseId: recurring.id, scheduledDate: scheduled } });
    try {
      const execute = await import('@/app/api/recurring-expenses/execute/route'), session = await import('@/app/api/recurring-expenses/route'), bearer = await import('@/app/api/v1/recurring-expenses/route');
      expect((await execute.POST(request('/api/recurring-expenses/execute', 'POST', { id: recurring.id }))).status).toBe(409);
      expect((await session.DELETE(request(`/api/recurring-expenses?id=${recurring.id}`, 'DELETE'))).status).toBe(409);
      expect((await bearer.DELETE(request(`/api/v1/recurring-expenses?id=${recurring.id}`, 'DELETE'))).status).toBe(409);
      expect(await database.client.purchaseDocument.findUniqueOrThrow({ where: { id: doc.id } })).toMatchObject({ expenseId: result.expense.id, reviewStatus: 'BOOKED' });
      expect(await database.client.recurringExpense.findUniqueOrThrow({ where: { id: recurring.id } })).toMatchObject({ nextExecution: scheduled });
    } finally { await database.client.expense.update({ where: { id: result.expense.id }, data: { recurringExpenseId: null, scheduledDate: null } }); await database.client.recurringExpense.delete({ where: { id: recurring.id } }); }
  });
  it('blocks booked-source tampering in replay and existing receipt downloads/exports', async () => {
    const doc = await source('BOOKED-TAMPER'), payload = body(doc.revision), result = await (await approve(doc.id, payload)).json();
    const row = await database.client.purchaseDocument.findUniqueOrThrow({ where: { id: doc.id } }), paths = await import('@/lib/upload-path');
    await writeFile(paths.getTenantUploadPath(state.userId, row.storedFileName), Buffer.from(xml('BOOKED-TAMPER').replace('119.00', '118.00')));
    const response = await approve(doc.id, payload); expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'ORIGINAL_INTEGRITY' });
    expect((await download.GET(request(`/api/expenses/download?id=${result.expense.id}`, 'GET'))).status).toBe(409);
    expect((await receiptExport.GET(request('/api/expenses/export?search=Reviewed', 'GET'))).status).toBe(409);
  });
  it('blocks tampered original before Expense or replay, and generic receipt export reports integrity failure', async () => {
    const doc = await source('TAMPERED'), row = await database.client.purchaseDocument.findUniqueOrThrow({ where: { id: doc.id } }), paths = await import('@/lib/upload-path');
    await writeFile(paths.getTenantUploadPath(state.userId, row.storedFileName), Buffer.from(xml('TAMPERED').replace('119.00', '118.00')));
    const before = await database.client.expense.count(), response = await approve(doc.id, body(doc.revision)); expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'ORIGINAL_INTEGRITY' }); expect(await database.client.expense.count()).toBe(before);
  });
});

let photoIndex = 0;
async function photoSource(number: string, amount = '119.00', paymentDate = '2026-10-19') {
  photoIndex++;
  const bytes = await sharp({ create: { width: 120, height: 200, channels: 3, background: `#${photoIndex.toString(16).padStart(6, '0')}` } }).png().toBuffer();
  const incoming = await service.intakePurchaseDocument({ userId: state.userId, requestId: randomUUID(), originalFileName: `${number}.png`, mediaType: 'image/png', bytes });
  const saved = await (await import('@/lib/purchase-documents/save-review-draft')).savePurchaseReviewDraft(state.userId, incoming.document.id, incoming.document.revision, { supplierName: 'Source Seller', invoiceNumber: number, invoiceDate: '2025-12-31', paymentDate, amount, note: 'Synthetic manually reviewed photo' });
  return approval.selectPurchaseSupplier(state.userId, saved.id, saved.revision, supplierId);
}
function photoBody(doc: Awaited<ReturnType<typeof photoSource>>) {
  return { ...body(doc.revision), amount: doc.reviewDraft!.amount, expenseDate: doc.reviewDraft!.paymentDate, manualPhotoReview: { expectedDraft: doc.reviewDraft, expectedDraftSavedAt: doc.reviewDraftSavedAt, buyerName: 'My synthetic business', currency: 'EUR', documentType: 'INVOICE', confirmSourceOwnership: true, confirmExactDraftValues: true, confirmOrdinaryInvoice: true } };
}
function deferredPhotoRace() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
/** Pause after REAL bounded decoding, not instead of it, to overlap financial claims without capacity noise. */
async function pausePhotoApprovalsAfterDecode(keys: string[]) {
  const processing = await import('@/lib/processing-limit');
  const actual = processing.withProcessingSlot;
  const gate = deferredPhotoRace();
  const arrivals = new Map(keys.map(key => [key, deferredPhotoRace()]));
  const spy = vi.spyOn(processing, 'withProcessingSlot').mockImplementation(async function <T>(userId: string | undefined, work: () => Promise<T>, key?: string): Promise<T> {
    const result = await actual(userId, work, key);
    if (key && arrivals.has(key)) { arrivals.get(key)!.release(); await gate.promise; }
    return result;
  });
  return { arrived: (key: string) => arrivals.get(key)!.promise, release: gate.release, restore: () => spy.mockRestore() };
}
/** Pause one competing write BEFORE the real serializable transaction; all actual DB guards still run. */
async function pauseNextPhotoTransaction() {
  const transactions = await import('@/lib/db-transaction');
  const actual = transactions.inTransaction;
  const arrived = deferredPhotoRace(), gate = deferredPhotoRace();
  let first = true;
  const spy = vi.spyOn(transactions, 'inTransaction').mockImplementation(async function <T>(work: Parameters<typeof actual<T>>[0]): Promise<T> {
    if (first) { first = false; arrived.release(); await gate.promise; }
    return actual(work);
  });
  return { arrived: arrived.promise, release: gate.release, restore: () => spy.mockRestore() };
}
async function expectOnePhotoClaim(doc: Awaited<ReturnType<typeof photoSource>>, payload: ReturnType<typeof photoBody>, expenseId: number) {
  const persisted = await database.client.purchaseDocument.findUniqueOrThrow({ where: { id: doc.id }, include: { expense: true } });
  expect(persisted).toMatchObject({ reviewStatus: 'BOOKED', revision: doc.revision + 1, expenseId, approvalRequestId: payload.approvalRequestId,
    reviewedSourceSnapshot: { provenance: 'MANUAL_PHOTO_REVIEW', reviewedDocumentRevision: doc.revision, originalSha256: doc.originalRef.sha256, reviewDraftSavedAt: doc.reviewDraftSavedAt, grossAmount: doc.reviewDraft!.amount, paymentDate: doc.reviewDraft!.paymentDate } });
  expect(persisted.expense).toMatchObject({ id: expenseId, userId: state.userId, storedReceiptFileName: persisted.storedFileName });
  expect(persisted.expense!.date.toISOString()).toBe(`${doc.reviewDraft!.paymentDate}T00:00:00.000Z`);
  const logs = await database.client.auditLog.findMany({ where: { userId: state.userId, OR: [{ entityType: 'Expense', entityId: String(expenseId) }, { entityType: 'PurchaseDocument', entityId: String(doc.id) }] } });
  const approvals = logs.filter(row => JSON.parse(row.metadata ?? '{}').operation === 'purchase-document.approve-expense');
  expect(approvals).toHaveLength(2);
  const expenseAudit = approvals.filter(row => row.entityType === 'Expense' && row.action === 'CREATE');
  const sourceAudit = approvals.filter(row => row.entityType === 'PurchaseDocument' && row.action === 'REVIEW');
  expect(expenseAudit).toHaveLength(1); expect(sourceAudit).toHaveLength(1);
  const expenseEvidence = JSON.parse(expenseAudit[0].newValues!), sourceEvidence = JSON.parse(sourceAudit[0].newValues!);
  expect(expenseEvidence.sourceApproval.reviewedSourceSnapshot).toEqual(persisted.reviewedSourceSnapshot);
  expect(sourceEvidence.reviewedSourceSnapshot).toEqual(persisted.reviewedSourceSnapshot);
  expect(sourceEvidence).toMatchObject({ expenseId, approvalRequestId: payload.approvalRequestId, revision: persisted.revision });
  expect(await database.client.income.count()).toBe(0); expect(await database.client.cashTransaction.count()).toBe(0);
  return persisted;
}
describe('explicit manual photo source approval', () => {
  it('snapshots AI-origin suggestions only after explicit human review and freezes pending analyses before immutable approval', async () => {
    const doc = await photoSource('PHOTO-AI-HUMAN', '0.29', '2026-01-01');
    const { validateAiReceiptResult } = await import('@/lib/purchase-documents/ai-validation');
    const result = validateAiReceiptResult(JSON.stringify({ supplierName: 'Source Seller', invoiceNumber: 'PHOTO-AI-HUMAN', invoiceDate: '2025-12-31', currency: 'EUR', documentType: 'INVOICE', grossAmount: '0.29', netAmount: '0.24', taxAmount: '0.05', lineItems: [], lineItemsComplete: true }));
    const job = { id: randomUUID(), configVersion: 1, configRevision: randomUUID(), status: 'completed', sourceSha256: doc.originalRef.sha256, sourceRevision: doc.revision - 1, createdAt: '2026-10-21T00:00:00.000Z', deadlineAt: '2026-10-21T00:01:30.000Z', finishedAt: '2026-10-21T00:00:30.000Z', errorCode: null, result, draftApplied: true };
    const running = { ...job, id: randomUUID(), configRevision: randomUUID(), status: 'running', result: null, finishedAt: null, draftApplied: false };
    await database.client.purchaseDocument.update({ where: { id: doc.id }, data: { aiExtraction: { version: 1, jobs: [job, running] }, aiDraftProvenance: { version: 1, provenance: 'AI_USER_EDITED', jobId: job.id, configVersion: 1, configRevision: job.configRevision, originalSha256: doc.originalRef.sha256, appliedAt: job.createdAt, fields: ['supplierName', 'invoiceNumber', 'invoiceDate', 'amount'] } } });
    const response = await approve(doc.id, photoBody(doc)); expect(response.status).toBe(200); const approved = await response.json();
    expect(approved.document.aiApprovedSnapshot).toMatchObject({ version: 1, provenance: 'AI_ASSISTED_USER_REVIEW', jobId: job.id, configRevision: job.configRevision, originalSha256: doc.originalRef.sha256, confirmedDraft: doc.reviewDraft, resultSnapshot: result });
    expect(approved.document.reviewedSourceSnapshot.provenance).toBe('MANUAL_PHOTO_REVIEW');
    const stored = await database.client.purchaseDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(stored.aiExtraction).toMatchObject({ jobs: [job, { ...running, status: 'unknown', errorCode: 'AI_SOURCE_APPROVED', finishedAt: expect.any(String) }] });
    const { validateAiApprovedSnapshot } = await import('@/lib/purchase-documents/ai-provenance');
    expect(() => validateAiApprovedSnapshot(stored.aiApprovedSnapshot, stored)).not.toThrow();
    await expect(database.client.$executeRaw`UPDATE "PurchaseDocument" SET "aiExtraction" = NULL WHERE "id" = ${doc.id}`).rejects.toThrow(/immutable/);
  });

  it('binds actual saved fields, original and attestations to one readonly paid Expense, then safely replays', async () => {
    const doc = await photoSource('PHOTO-EXPLICIT', '0.29', '2026-01-01'), payload = photoBody(doc), before = await database.client.expense.count();
    const response = await approve(doc.id, payload); expect(response.status).toBe(200); const result = await response.json();
    expect(result).toMatchObject({ replayed: false, document: { reviewState: 'BOOKED', parseStatus: 'FAILED', parseErrorCode: 'PHOTO_MANUAL_REVIEW', preview: null }, expense: { amount: 0.29, date: '2026-01-01T00:00:00.000Z' } });
    expect(result.document.reviewedSourceSnapshot).toMatchObject({ provenance: 'MANUAL_PHOTO_REVIEW', ownerId: state.userId, reviewedByTenantId: state.userId, originalSha256: doc.originalRef.sha256, mediaType: 'image/png', reviewedDocumentRevision: doc.revision, invoiceDate: '2025-12-31', paymentDate: '2026-01-01', grossAmount: '0.29', buyerName: 'My synthetic business' });
    expect(result.document.totalAmount).toBeNull(); expect(result.document.supplierName).toBeNull();
    expect(await database.client.expense.count()).toBe(before + 1);
    const replay = await approve(doc.id, payload); expect(replay.status).toBe(200); expect(await replay.json()).toMatchObject({ replayed: true, expense: { id: result.expense.id } });
    expect((await approve(doc.id, { ...payload, approvalRequestId: randomUUID() })).status).toBe(409);
    expect((await expenses.PUT(request('/api/expenses', 'PUT', { id: result.expense.id, description: 'No generic edit', amount: 0.29 }))).status).toBe(409);
    expect((await expenses.DELETE(request(`/api/expenses?id=${result.expense.id}`, 'DELETE'))).status).toBe(409);
    await expect(database.client.$executeRaw`UPDATE "PurchaseDocument" SET "reviewDraftSearch" = 'No rewritten evidence' WHERE "id" = ${doc.id}`).rejects.toThrow(/immutable/);
    await expect(database.client.$executeRaw`DELETE FROM "PurchaseDocument" WHERE "id" = ${doc.id}`).rejects.toThrow(/immutable/);
    const audit = await database.client.auditLog.findMany({ where: { userId: state.userId, entityType: 'Expense', entityId: String(result.expense.id) } }); expect(audit).toHaveLength(1); expect(JSON.stringify(audit)).toContain('MANUAL_PHOTO_REVIEW');
    expect(await database.client.income.count()).toBe(0); expect(await database.client.cashTransaction.count()).toBe(0);
  });
  it('rejects missing/manual false attestations, unsupported types/currency, amount/date mismatch and foreign ownership', async () => {
    const doc = await photoSource('PHOTO-INVALID'), payload = photoBody(doc), before = await database.client.expense.count();
    const invalid = [ { ...payload, manualPhotoReview: undefined }, { ...payload, amount: '118.00' }, { ...payload, expenseDate: '2026-10-20' }, ...['confirmSourceOwnership', 'confirmExactDraftValues', 'confirmOrdinaryInvoice'].map(key => ({ ...payload, manualPhotoReview: { ...payload.manualPhotoReview, [key]: false } })), ...[{ currency: 'USD' }, { documentType: 'CREDIT_NOTE' }, { buyerName: '' }, { expenseId: 99 }].map(change => ({ ...payload, manualPhotoReview: { ...payload.manualPhotoReview, ...change } })) ];
    for (const input of invalid) expect((await approve(doc.id, input)).status).toBe(400);
    state.userId = 'purchase-other'; try { expect((await approve(doc.id, payload)).status).toBe(404); } finally { state.userId = 'purchase-owner'; }
    expect(await database.client.expense.count()).toBe(before); expect((await service.purchaseDocumentDetail(state.userId, doc.id)).reviewedSourceSnapshot).toBeNull();
  });
  it('rejects stale saved draft and incomplete source fields without inferring values', async () => {
    const doc = await photoSource('PHOTO-STALE'), payload = photoBody(doc), before = await database.client.expense.count();
    await (await import('@/lib/purchase-documents/save-review-draft')).savePurchaseReviewDraft(state.userId, doc.id, doc.revision, { ...doc.reviewDraft!, note: 'New explicit saved work' });
    expect((await approve(doc.id, payload)).status).toBe(409);
    const current = await service.purchaseDocumentDetail(state.userId, doc.id);
    await (await import('@/lib/purchase-documents/save-review-draft')).savePurchaseReviewDraft(state.userId, doc.id, current.revision, { ...doc.reviewDraft!, invoiceDate: '' });
    const incomplete = await service.purchaseDocumentDetail(state.userId, doc.id); expect((await approve(doc.id, photoBody(incomplete))).status).toBe(409);
    expect(await database.client.expense.count()).toBe(before);
  });
  it('rechecks conservative image/XML duplicate hints and freezes acknowledged revisions', async () => {
    const xmlDoc = await source('CROSS-FORMAT'), photo = await photoSource('CROSS-FORMAT');
    expect((await service.purchaseDocumentDetail(state.userId, photo.id)).businessDuplicates.map(row => row.id)).toContain(xmlDoc.id);
    expect((await service.purchaseDocumentDetail(state.userId, xmlDoc.id)).businessDuplicates.map(row => row.id)).toContain(photo.id);
    expect((await approve(photo.id, photoBody(photo))).status).toBe(409);
    const payload = { ...photoBody(photo), acknowledgedDuplicates: [{ id: xmlDoc.id, revision: xmlDoc.revision }] };
    const result = await approve(photo.id, payload); expect(result.status).toBe(200);
  });
  it('rolls back both expense and immutable snapshot if either financial audit fails', async () => {
    for (const entity of ['Expense', 'PurchaseDocument']) {
      const doc = await photoSource(`PHOTO-AUDIT-${entity}`), before = await database.client.expense.count();
      state.failAudit = true; state.failAuditEntity = entity;
      try { expect((await approve(doc.id, photoBody(doc))).status).toBe(500); } finally { state.failAudit = false; state.failAuditEntity = ''; }
      expect(await database.client.expense.count()).toBe(before);
      expect(await database.client.purchaseDocument.findUniqueOrThrow({ where: { id: doc.id } })).toMatchObject({ reviewStatus: 'REVIEW', reviewedSourceSnapshot: null, expenseId: null });
      expect((await approve(doc.id, photoBody(doc))).status).toBe(200);
    }
  });
  it('serializes concurrent photo same-key approvals into one Expense, one immutable snapshot and one audit pair', async () => {
    const doc = await photoSource('PHOTO-RACE-SAME', '0.29', '2026-01-01'), payload = photoBody(doc), before = await database.client.expense.count();
    const responses = await Promise.all([approve(doc.id, payload), approve(doc.id, payload)]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    const results = await Promise.all(responses.map(response => response.json()));
    expect(results.map(result => result.replayed).sort()).toEqual([false, true]);
    expect(results[0].expense.id).toBe(results[1].expense.id);
    expect(results[0].document.reviewedSourceSnapshot).toEqual(results[1].document.reviewedSourceSnapshot);
    expect(await database.client.expense.count()).toBe(before + 1);
    await expectOnePhotoClaim(doc, payload, results[0].expense.id);
  });
  it('rejects the losing photo key with deterministic 409 after overlapping validated financial claims', async () => {
    const doc = await photoSource('PHOTO-RACE-KEYS'), a = photoBody(doc), b = { ...a, approvalRequestId: randomUUID() }, before = await database.client.expense.count();
    const gate = await pausePhotoApprovalsAfterDecode([a.approvalRequestId, b.approvalRequestId]);
    try {
      const first = approve(doc.id, a); await gate.arrived(a.approvalRequestId);
      const second = approve(doc.id, b); await gate.arrived(b.approvalRequestId); gate.release();
      const responses = await Promise.all([first, second]); expect(responses.map(response => response.status)).toEqual([200, 409]);
      const winner = await responses[0].json(); expect(await responses[1].json()).toMatchObject({ code: 'APPROVAL_CONFLICT' });
      expect(await database.client.expense.count()).toBe(before + 1);
      const persisted = await expectOnePhotoClaim(doc, a, winner.expense.id);
      const replay = await approve(doc.id, a); expect(replay.status).toBe(200); expect(await replay.json()).toMatchObject({ replayed: true, expense: { id: persisted.expenseId } });
      expect((await approve(doc.id, b)).status).toBe(409);
      await expectOnePhotoClaim(doc, a, winner.expense.id);
    } finally { gate.release(); gate.restore(); }
  });
  it.each(['draft-save', 'supplier-select'] as const)('requires renewed photo review when %s wins against an already-started approval', async mutation => {
    const doc = await photoSource(`PHOTO-REVIEW-WINS-${mutation}`), payload = photoBody(doc), before = await database.client.expense.count();
    const replacement = mutation === 'supplier-select' ? await suppliers.createSupplier(state.userId, { name: 'Explicit replacement photo supplier', city: 'Berlin' }) : null;
    const gate = await pausePhotoApprovalsAfterDecode([payload.approvalRequestId]);
    try {
      const staleApproval = approve(doc.id, payload); await gate.arrived(payload.approvalRequestId);
      const changed = mutation === 'draft-save'
        ? await (await import('@/lib/purchase-documents/save-review-draft')).savePurchaseReviewDraft(state.userId, doc.id, doc.revision, { ...doc.reviewDraft!, amount: '0.58', paymentDate: '2026-01-02', note: 'Winning explicitly saved review' })
        : await approval.selectPurchaseSupplier(state.userId, doc.id, doc.revision, replacement!.id);
      gate.release(); const rejected = await staleApproval;
      expect(rejected.status).toBe(409); expect(await rejected.json()).toMatchObject({ code: mutation === 'draft-save' ? 'PHOTO_DRAFT_CHANGED' : 'REVISION_CONFLICT' });
      expect(await database.client.expense.count()).toBe(before);
      expect(await database.client.purchaseDocument.findUniqueOrThrow({ where: { id: doc.id } })).toMatchObject({ revision: doc.revision + 1, expenseId: null, reviewedSourceSnapshot: null, reviewStatus: 'REVIEW' });
      const approvalLogs = await database.client.auditLog.findMany({ where: { userId: state.userId, entityType: 'PurchaseDocument', entityId: String(doc.id) } });
      expect(approvalLogs.filter(row => JSON.parse(row.metadata ?? '{}').operation === 'purchase-document.approve-expense')).toHaveLength(0);
      const renewed = photoBody(changed), confirmed = await approve(doc.id, renewed); expect(confirmed.status).toBe(200); const result = await confirmed.json();
      expect(await database.client.expense.count()).toBe(before + 1);
      const persisted = await expectOnePhotoClaim(changed, renewed, result.expense.id);
      if (mutation === 'draft-save') expect(persisted.reviewDraft).toMatchObject({ amount: '0.58', paymentDate: '2026-01-02', note: 'Winning explicitly saved review' });
      else expect(persisted).toMatchObject({ supplierId: replacement!.id, selectedSupplierSnapshot: { name: replacement!.name } });
    } finally { gate.release(); gate.restore(); }
  });
  it.each(['draft-save', 'supplier-select'] as const)('keeps the photo approval immutable when an already-started %s loses', async mutation => {
    const doc = await photoSource(`PHOTO-APPROVAL-WINS-${mutation}`), payload = photoBody(doc), before = await database.client.expense.count();
    const replacement = mutation === 'supplier-select' ? await suppliers.createSupplier(state.userId, { name: 'Losing photo supplier selection' }) : null;
    const saveDraft = await import('@/lib/purchase-documents/save-review-draft');
    const gate = await pauseNextPhotoTransaction();
    try {
      const competing = (mutation === 'draft-save'
        ? saveDraft.savePurchaseReviewDraft(state.userId, doc.id, doc.revision, { ...doc.reviewDraft!, note: 'Must not overwrite approved evidence' })
        : approval.selectPurchaseSupplier(state.userId, doc.id, doc.revision, replacement!.id))
        .then(value => ({ value, error: null })).catch((error: unknown) => ({ value: null, error }));
      await gate.arrived;
      const confirmed = await approve(doc.id, payload); expect(confirmed.status).toBe(200); const result = await confirmed.json();
      const initial = await expectOnePhotoClaim(doc, payload, result.expense.id);
      gate.release(); const rejected = await competing; expect(rejected.value).toBeNull();
      expect(rejected.error).toMatchObject({ status: 409, code: mutation === 'draft-save' ? 'REVISION_CONFLICT' : 'SOURCE_LINKED' });
      expect(await database.client.expense.count()).toBe(before + 1);
      const persisted = await expectOnePhotoClaim(doc, payload, result.expense.id);
      expect(persisted.reviewedSourceSnapshot).toEqual(initial.reviewedSourceSnapshot); expect(persisted.reviewDraft).toEqual(initial.reviewDraft); expect(persisted.supplierId).toBe(doc.supplierId);
    } finally { gate.release(); gate.restore(); }
  });
  it('keeps the accepted 2026 working paper on actual paid-photo cents, independent of annual declarations', async () => {
    const oldOwner = state.userId, oldSupplier = supplierId, owner = 'photo-annual-eur-integration';
    await database.client.user.create({ data: { id: owner, email: `${owner}@test.invalid`, password: 'synthetic' } });
    try {
      state.userId = owner; supplierId = (await suppliers.createSupplier(owner, { name: 'Synthetic combined export supplier' })).id;
      const doc = await photoSource('PHOTO-ANNUAL-EUR', '0.29', '2026-01-01');
      const payload = { ...photoBody(doc), category: 'Bürobedarf', taxDeductiblePercentage: '100', taxRelevant: true };
      const approved = await approve(doc.id, payload); expect(approved.status).toBe(200);
      const { expense } = await approved.json();
      const eur = await import('@/app/api/eur-export/route');
      const read = async (year: number) => {
        const response = await eur.GET(new NextRequest(`http://localhost/api/eur-export?year=${year}&format=json`));
        expect(response.status).toBe(200); return response.json();
      };
      const priorYear = await read(2025), before = await read(2026);
      expect(priorYear.data).toMatchObject({ totalIncome: 0, totalExpense: 0, controlTotals: { incomeCount: 0, expenseCount: 0 } });
      expect(before.data).toMatchObject({ year: 2026, mappingVersion: 'anlage-euer-2026-v1', totalIncome: 0, totalExpense: 0.29, profit: -0.29, controlTotals: { incomeCount: 0, expenseCount: 1, expenseAmount: 0.29 } });
      expect(before.data.lines).toEqual([expect.objectContaining({ lineNumber: 52, amount: 0.29, type: 'expense' }), expect.objectContaining({ lineNumber: 91, amount: -0.29, type: 'result' })]);
      expect(before.unmappedCategories).toEqual([]);
      await database.client.annualBusinessContextRevision.create({ data: { userId: owner, revision: 1, contextYear: 2026, effectiveFrom: '2026-01-01', foundingYear: 2020, previousYearTurnoverCents: '90000000', previousYearExternalTurnoverCents: '80000000', completeness: 'COMPLETE', sourceNote: 'Synthetic declaration is not financial input' } });
      const after = await read(2026);
      const { generatedAt: _beforeTime, ...beforeData } = before.data;
      const { generatedAt: _afterTime, ...afterData } = after.data;
      void _beforeTime; void _afterTime;
      expect(afterData).toEqual(beforeData); expect(after.warnings).toEqual(before.warnings); expect(after.unmappedCategories).toEqual(before.unmappedCategories);
      expect(await database.client.expense.findUniqueOrThrow({ where: { id: expense.id } })).toMatchObject({ userId: owner, amount: 0.29, date: new Date('2026-01-01T00:00:00.000Z') });
      expect(await database.client.purchaseDocument.findUniqueOrThrow({ where: { id: doc.id } })).toMatchObject({ reviewedSourceSnapshot: { grossAmount: '0.29', invoiceDate: '2025-12-31', paymentDate: '2026-01-01' }, expenseId: expense.id });
      expect(await database.client.expense.count({ where: { userId: owner } })).toBe(1);
      expect(await database.client.income.count({ where: { userId: owner } })).toBe(0);
      expect(await database.client.cashTransaction.count({ where: { userId: owner } })).toBe(0);
    } finally { state.userId = oldOwner; supplierId = oldSupplier; }
  });

  it('roundtrips a real approved photo through full ZIP with remapped ownership/replay and one actual-payment original pack', async () => {
    const oldOwner = state.userId, oldSupplier = supplierId;
    const sourceOwner = 'photo-real-backup-source', targetOwner = 'photo-real-backup-target', jsonOwner = 'photo-real-json-target', divergentOwner = 'photo-real-divergent-target', rollbackOwner = 'photo-real-rollback-target';
    await database.client.user.createMany({ data: [sourceOwner, targetOwner, jsonOwner, divergentOwner, rollbackOwner].map(id => ({ id, email: `${id}@test.invalid`, password: 'synthetic' })) });
    try {
      state.userId = sourceOwner; supplierId = (await suppliers.createSupplier(sourceOwner, { name: 'Photo chosen supplier', city: 'Berlin' })).id;
      const doc = await photoSource('PHOTO-ROUNDTRIP', '0.29', '2026-01-01'), payload = photoBody(doc);
      const approved = await approve(doc.id, payload); expect(approved.status).toBe(200); const original = await approved.json();
      const context = { revision: 1, contextYear: 2026, effectiveFrom: '2026-01-01', foundingYear: 2020, previousYearTurnoverCents: '0', previousYearExternalTurnoverCents: null, completeness: 'PARTIAL', sourceNote: 'Synthetic combined source declaration', declaredAt: new Date('2026-10-21T01:02:03.004Z') };
      await database.client.annualBusinessContextRevision.create({ data: { userId: sourceOwner, ...context } });
      const sourceHistory = await database.client.annualBusinessContextRevision.findMany({ where: { userId: sourceOwner } });
      const jsonResponse = await (await import('@/app/api/backup/route')).GET(); expect(jsonResponse.status).toBe(200);
      const jsonBackup = await jsonResponse.json();
      const manifestContract = await import('@/lib/backup-manifest');
      expect(jsonBackup.manifest.schemaVersion).toBe(manifestContract.CURRENT_SCHEMA_VERSION);
      expect(jsonBackup.data.annualBusinessContextRevisions).toHaveLength(1);
      expect(jsonBackup.data.purchaseDocuments[0].reviewedSourceSnapshot).toMatchObject({ ownerId: sourceOwner, provenance: 'MANUAL_PHOTO_REVIEW', grossAmount: '0.29' });
      const exporter = await import('@/lib/accountant-export');
      const outside = await exporter.createAccountantExport(sourceOwner, exporter.parseAccountantExportPeriod(new URLSearchParams('year=2025')));
      expect(outside.counts.expenses).toBe(0);
      const pack = await exporter.createAccountantExport(sourceOwner, exporter.parseAccountantExportPeriod(new URLSearchParams('year=2026')));
      expect(pack.counts.expenses).toBe(1); expect(pack.counts.incomes).toBe(0);
      const JSZip = (await import('jszip')).default, accountant = await JSZip.loadAsync(pack.bytes);
      const records = JSON.parse(await accountant.file('records.json')!.async('string'));
      expect(records.expenses).toHaveLength(1); expect(records.expenses[0]).toMatchObject({ id: original.expense.id, amountCents: '29', sourceReviewProvenance: 'MANUAL_PHOTO_REVIEW', manualSourceReview: { invoiceDate: '2025-12-31', paymentDate: '2026-01-01', grossAmount: '0.29', provenance: 'MANUAL_PHOTO_REVIEW' } });
      const paths = await import('@/lib/upload-path'), persisted = await database.client.purchaseDocument.findUniqueOrThrow({ where: { id: doc.id } });
      const sourceBytes = await (await import('node:fs/promises')).readFile(paths.getTenantUploadPath(sourceOwner, persisted.storedFileName));
      expect(await accountant.file(`originals/expense-${original.expense.id}.png`)!.async('nodebuffer')).toEqual(sourceBytes);
      const full = await (await import('@/app/api/backup/full/route')).GET(); expect(full.status).toBe(200);
      const zip = await JSZip.loadAsync(await full.arrayBuffer()), backup = JSON.parse(await zip.file('backup.json')!.async('string'));
      const restore = await import('@/lib/backup-restore');
      const resolveFile = async (kind: string, sourceName: string) => { const entry = backup.manifest.fileManifest.find((entry: { kind: string; sourceName: string }) => entry.kind === kind && entry.sourceName === sourceName); return entry?.zipPath ? zip.file(entry.zipPath)!.async('uint8array') : null; };
      // Genuine standalone 061000 evidence remains importable, without annual history.
      const standalonePhoto = structuredClone(backup); delete standalonePhoto.data.annualBusinessContextRevisions;
      standalonePhoto.manifest = manifestContract.createBackupManifest({ sourceUserId: sourceOwner, generatedAt: standalonePhoto.exportedAt, data: standalonePhoto.data, fileManifest: standalonePhoto.manifest.fileManifest }); standalonePhoto.manifest.schemaVersion = manifestContract.MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION; standalonePhoto.manifest.modelCoverage = standalonePhoto.manifest.modelCoverage.filter((entry: { model: string }) => entry.model !== 'AiProviderSettings');
      expect(() => restore.validateBackupForRestore(standalonePhoto)).not.toThrow();
      expect(backup.manifest.schemaVersion).toBe(manifestContract.CURRENT_SCHEMA_VERSION);
      expect(backup.data.annualBusinessContextRevisions).toEqual(jsonBackup.data.annualBusinessContextRevisions);
      expect(backup.data.purchaseDocuments[0].reviewedSourceSnapshot).toEqual(jsonBackup.data.purchaseDocuments[0].reviewedSourceSnapshot);
      // JSON metadata preserves both components, but never fabricates originals.
      await expect(restore.restoreBackupData({ userId: jsonOwner, backup: jsonBackup, overwrite: false })).rejects.toThrow(/vollständiges ZIP-Backup/);
      expect(await database.client.expense.count({ where: { userId: jsonOwner } })).toBe(0);
      expect(await database.client.annualBusinessContextRevision.count({ where: { userId: jsonOwner } })).toBe(0);
      const jsonImported = await restore.restoreBackupData({ userId: jsonOwner, backup: jsonBackup, overwrite: false, resolveFile });
      expect(jsonImported.annualBusinessContextRevisions.imported).toBe(1); expect(jsonImported.purchaseDocuments.imported).toBe(1);
      const jsonSource = await database.client.purchaseDocument.findFirstOrThrow({ where: { userId: jsonOwner } });
      expect(jsonSource.reviewedSourceSnapshot).toMatchObject({ ownerId: jsonOwner, reviewedByTenantId: sourceOwner, grossAmount: '0.29' });
      expect(await (await import('node:fs/promises')).readFile(paths.getTenantUploadPath(jsonOwner, jsonSource.storedFileName))).toEqual(sourceBytes);
      // Known target conflicts fail before even invoking the original resolver.
      await database.client.annualBusinessContextRevision.create({ data: { userId: divergentOwner, ...context, sourceNote: 'A divergent immutable declaration' } });
      const divergentBefore = (await (await import('@/lib/backup-snapshot')).readBackupSnapshot(divergentOwner)).data;
      const neverResolve = vi.fn(async () => { throw new Error('must reject before resolving files'); });
      for (const overwrite of [false, true]) await expect(restore.restoreBackupData({ userId: divergentOwner, backup, overwrite, resolveFile: neverResolve })).rejects.toThrow(/Jahreskontext-Konflikt/);
      expect(neverResolve).not.toHaveBeenCalled();
      expect((await (await import('@/lib/backup-snapshot')).readBackupSnapshot(divergentOwner)).data).toEqual(divergentBefore);
      for (const schemaVersion of [manifestContract.PRE_MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION, manifestContract.MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION, manifestContract.ANNUAL_CONTEXT_SCHEMA_VERSION]) {
        const relabeled = structuredClone(backup); relabeled.manifest = manifestContract.createBackupManifest({ sourceUserId: sourceOwner, generatedAt: relabeled.exportedAt, data: relabeled.data, fileManifest: relabeled.manifest.fileManifest }); relabeled.manifest.schemaVersion = schemaVersion; relabeled.manifest.modelCoverage = relabeled.manifest.modelCoverage.filter((entry: { model: string }) => entry.model !== 'AiProviderSettings');
        expect(() => restore.validateBackupForRestore(relabeled)).toThrow(/reviewedSourceSnapshot|Jahreskontexthistorie/);
        await expect(restore.restoreBackupData({ userId: divergentOwner, backup: relabeled, overwrite: true, resolveFile: neverResolve })).rejects.toThrow(/reviewedSourceSnapshot|Jahreskontexthistorie/);
      }
      expect(neverResolve).not.toHaveBeenCalled();
      // One failed required audit rolls back annual history, source evidence,
      // financial rows and newly staged originals as one combined restore.
      const rollbackBefore = (await (await import('@/lib/backup-snapshot')).readBackupSnapshot(rollbackOwner)).data;
      await database.client.$executeRawUnsafe(`CREATE TRIGGER combined_restore_audit_failure BEFORE INSERT ON AuditLog WHEN NEW.userId = 'photo-real-rollback-target' BEGIN SELECT RAISE(ABORT, 'Synthetic combined restore audit failure'); END;`);
      try { await expect(restore.restoreBackupData({ userId: rollbackOwner, backup, overwrite: false, resolveFile })).rejects.toThrow(); }
      finally { await database.client.$executeRawUnsafe('DROP TRIGGER combined_restore_audit_failure'); }
      expect((await (await import('@/lib/backup-snapshot')).readBackupSnapshot(rollbackOwner)).data).toEqual(rollbackBefore);
      expect(await (await import('node:fs/promises')).readdir(path.dirname(paths.getTenantUploadPath(rollbackOwner, persisted.storedFileName))).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).toEqual([]);
      const imported = await restore.restoreBackupData({ userId: targetOwner, backup, overwrite: false, resolveFile }); expect(imported.purchaseDocuments.imported).toBe(1); expect(imported.expenses.imported).toBe(1);
      expect(imported.annualBusinessContextRevisions.imported).toBe(1);
      const targetHistory = await database.client.annualBusinessContextRevision.findMany({ where: { userId: targetOwner } });
      expect(targetHistory.map(({ id: _id, userId: _userId, ...row }) => { void _id; void _userId; return row; })).toEqual(sourceHistory.map(({ id: _id, userId: _userId, ...row }) => { void _id; void _userId; return row; }));
      const restored = await database.client.purchaseDocument.findFirstOrThrow({ where: { userId: targetOwner } });
      expect(restored.id).not.toBe(doc.id); expect(restored.expenseId).not.toBe(original.expense.id); expect(restored.storedFileName).not.toBe(persisted.storedFileName);
      expect(restored.reviewedSourceSnapshot).toMatchObject({ ownerId: targetOwner, reviewedByTenantId: sourceOwner, originalSha256: doc.originalRef.sha256, reviewedDocumentRevision: doc.revision });
      expect(await (await import('node:fs/promises')).readFile(paths.getTenantUploadPath(targetOwner, restored.storedFileName))).toEqual(sourceBytes);
      const merged = await restore.restoreBackupData({ userId: targetOwner, backup, overwrite: false, resolveFile }); expect(merged.purchaseDocuments.skipped).toBe(1); expect(merged.expenses.skipped).toBe(1);
      await expect(restore.restoreBackupData({ userId: targetOwner, backup, overwrite: true, resolveFile })).rejects.toThrow(/Unveränderliche manuelle Foto-Freigaben/);
      const noFiles = vi.fn(async () => { throw new Error('immutable overwrite must reject before file resolution'); });
      await expect(restore.restoreBackupData({ userId: targetOwner, backup, overwrite: true, resolveFile: noFiles })).rejects.toThrow(/Unveränderliche manuelle Foto-Freigaben/); expect(noFiles).not.toHaveBeenCalled();
      // Annual prefix appends coexist with immutable photo merge/replay.
      await database.client.annualBusinessContextRevision.create({ data: { userId: sourceOwner, ...context, revision: 2, sourceNote: 'Synthetic compatible correction', previousYearTurnoverCents: null } });
      const latest = await (await import('@/lib/backup-snapshot')).readBackupSnapshot(sourceOwner);
      const newer = { version: '3.0', type: 'json', data: JSON.parse(JSON.stringify(latest.data)), manifest: manifestContract.createBackupManifest({ sourceUserId: sourceOwner, generatedAt: latest.info.endedAt, data: latest.data }) };
      const appended = await restore.restoreBackupData({ userId: targetOwner, backup: newer, overwrite: false, resolveFile }); expect(appended.annualBusinessContextRevisions.imported).toBe(1); expect(appended.purchaseDocuments.skipped).toBe(1);
      const shorter = await restore.restoreBackupData({ userId: targetOwner, backup, overwrite: false, resolveFile }); expect(shorter.warnings.join(' ')).toContain('Jahreskontexthistorie wurde bewahrt');
      expect(await database.client.annualBusinessContextRevision.count({ where: { userId: targetOwner } })).toBe(2);
      state.userId = targetOwner;
      const replay = await approve(restored.id, payload); expect(replay.status).toBe(200); expect(await replay.json()).toMatchObject({ replayed: true, expense: { id: restored.expenseId } });
      expect(await database.client.expense.count({ where: { userId: targetOwner } })).toBe(1);
      for (const [field, value] of [['ownerId', 'wrong-owner'], ['originalSha256', 'b'.repeat(64)], ['originalByteCount', 1], ['sourceUploadRequestId', randomUUID()], ['mediaType', 'image/jpeg'], ['reviewedDocumentRevision', doc.revision + 1], ['grossAmount', '0.28'], ['paymentDate', '2025-12-31'], ['businessPurpose', 'Changed source evidence'], ['reviewDraftFingerprint', 'b'.repeat(64)], ['attestations', { sourceOwned: false }], ['unexpectedAuthority', true]] as const) {
        const invalid = structuredClone(backup); invalid.data.purchaseDocuments[0].reviewedSourceSnapshot[field] = value;
        invalid.manifest = (await import('@/lib/backup-manifest')).createBackupManifest({ sourceUserId: sourceOwner, generatedAt: invalid.exportedAt, data: invalid.data, fileManifest: invalid.manifest.fileManifest });
        expect(() => restore.validateBackupForRestore(invalid), String(field)).toThrow(/Manuelle Foto-Freigabe/);
        await expect(restore.restoreBackupData({ userId: targetOwner, backup: invalid, overwrite: false, resolveFile })).rejects.toThrow(/Manuelle Foto-Freigabe/);
        expect(await database.client.expense.count({ where: { userId: targetOwner } })).toBe(1);
        expect(await database.client.purchaseDocument.findUniqueOrThrow({ where: { id: restored.id } })).toMatchObject({ reviewedSourceSnapshot: restored.reviewedSourceSnapshot, expenseId: restored.expenseId });
      }
      const oldIdentity = structuredClone(backup); oldIdentity.manifest.schemaVersion = (await import('@/lib/backup-manifest')).PRE_MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION; oldIdentity.manifest.modelCoverage = oldIdentity.manifest.modelCoverage.filter((entry: { model: string }) => entry.model !== 'AiProviderSettings');
      expect(() => restore.validateBackupForRestore(oldIdentity)).toThrow(/Älteres Backupschema/);
      const targetExpense = await database.client.expense.findUniqueOrThrow({ where: { id: restored.expenseId! } });
      expect(targetExpense.date.toISOString()).toBe('2026-01-01T00:00:00.000Z'); expect(await database.client.income.count({ where: { userId: targetOwner } })).toBe(0); expect(await database.client.cashTransaction.count({ where: { userId: targetOwner } })).toBe(0);
    } finally { state.userId = oldOwner; supplierId = oldSupplier; }
  });

});
