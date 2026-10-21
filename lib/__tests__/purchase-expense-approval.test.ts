import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestDatabase } from './helpers/database';
const state = vi.hoisted(() => ({ client: null as unknown, userId: 'purchase-owner', failAudit: false, failAuditEntity: '' }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => { class UnauthorizedError extends Error {} return { requireUserId: async () => state.userId, UnauthorizedError, unauthorizedResponse: () => new Response(null, { status: 401 }) }; });
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
