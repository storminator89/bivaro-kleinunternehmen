import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { createTestDatabase } from './helpers/database';
import type { IncomingDocument } from '@/lib/purchase-documents/types';

const state = vi.hoisted(() => ({ client: null as unknown, userId: 'incoming-owner' as string | null, failOperation: '' }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return { requireUserId: async () => { if (!state.userId) throw new UnauthorizedError(); return state.userId; }, UnauthorizedError, unauthorizedResponse: () => new Response(null, { status: 401 }) };
});
vi.mock('@/lib/audit-log', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/audit-log')>();
  return { ...actual, createFinancialAuditLog: async (...args: Parameters<typeof actual.createFinancialAuditLog>) => {
    if (args[0].metadata.operation === state.failOperation) throw new Error('fixture audit failure');
    return actual.createFinancialAuditLog(...args);
  } };
});
let database: ReturnType<typeof createTestDatabase>;
let storage: string;
let collection: typeof import('@/app/api/purchase-documents/route');
let detail: typeof import('@/app/api/purchase-documents/[id]/route');
let original: typeof import('@/app/api/purchase-documents/[id]/original/route');
let dismiss: typeof import('@/app/api/purchase-documents/[id]/dismiss/route');
let reopen: typeof import('@/app/api/purchase-documents/[id]/reopen/route');
let retry: typeof import('@/app/api/purchase-documents/[id]/retry-parse/route');
let draftRoute: typeof import('@/app/api/purchase-documents/[id]/review-draft/route');
let firstId: number;
const xml = (number: string, seller = 'Supplier Alpha', currency = 'EUR', root = 'Invoice', date = '2026-10-20') => `<${root}><ID>${number}</ID><IssueDate>${date}</IssueDate><DocumentCurrencyCode>${currency}</DocumentCurrencyCode><AccountingSupplierParty><Party><PartyName><Name>${seller}</Name></PartyName></Party></AccountingSupplierParty><AccountingCustomerParty><Party><PartyName><Name>Buyer Beta</Name></PartyName></Party></AccountingCustomerParty><LegalMonetaryTotal><TaxInclusiveAmount currencyID="${currency}">119.00</TaxInclusiveAmount><PayableAmount currencyID="${currency}">119.00</PayableAmount></LegalMonetaryTotal></${root}>`;
function upload(bytes: string | Uint8Array, key: string = randomUUID(), name = 'incoming.xml', type = 'application/xml') {
  const form = new FormData();
  form.append('file', new File([bytes], name, { type })); form.append('uploadRequestId', key);
  return new NextRequest('http://localhost/api/purchase-documents', { method: 'POST', body: form });
}
function json(id: number, operation: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/purchase-documents/${id}/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
function context(id: number) { return { params: Promise.resolve({ id: String(id) }) }; }
async function fetchDetail(id: number): Promise<IncomingDocument> {
  const response = await detail.GET(new NextRequest(`http://localhost/api/purchase-documents/${id}`), context(id));
  expect(response.status).toBe(200); return (await response.json()).document;
}
async function noFinancialRows() {
  expect(await database.client.customer.count()).toBe(0);
  expect(await database.client.invoice.count()).toBe(0);
  expect(await database.client.income.count()).toBe(0);
  expect(await database.client.expense.count()).toBe(0);
  expect(await database.client.cashTransaction.count()).toBe(0);
  expect(await database.client.invoiceNumberCounter.count()).toBe(0);
}
beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  await database.client.user.createMany({ data: ['incoming-owner', 'incoming-other'].map(id => ({ id, email: `${id}@test.invalid`, password: 'unused' })) });
  storage = await mkdtemp(path.join(tmpdir(), 'bivaro-incoming-files-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(storage);
  try {
    draftRoute = await import('@/app/api/purchase-documents/[id]/review-draft/route');
    collection = await import('@/app/api/purchase-documents/route');
    detail = await import('@/app/api/purchase-documents/[id]/route');
    original = await import('@/app/api/purchase-documents/[id]/original/route');
    dismiss = await import('@/app/api/purchase-documents/[id]/dismiss/route');
    reopen = await import('@/app/api/purchase-documents/[id]/reopen/route');
    retry = await import('@/app/api/purchase-documents/[id]/retry-parse/route');
  } finally { cwd.mockRestore(); }
}, 40_000);
afterAll(async () => { await database?.cleanup(); if (storage) await rm(storage, { recursive: true, force: true }); });

describe('incoming original intake without posting', () => {
  it('archives exact bytes, separates seller/buyer, exposes decimal preview and performs no financial/sales effects', async () => {
    const bytes = xml('FIRST');
    const response = await collection.POST(upload(bytes));
    expect(response.status).toBe(201);
    const body = await response.json(); const document = body.document as IncomingDocument; firstId = document.id;
    expect(body.replayed).toBe(false);
    expect(document).toMatchObject({ direction: 'INCOMING', reviewState: 'REVIEW', parseStatus: 'PARSED', validationStatus: 'NOT_VALIDATED', linkedExpenseId: null, totalAmount: '119.00', revision: 1 });
    expect(document.supplierCandidate?.name).toBe('Supplier Alpha'); expect(document.buyerCandidate?.name).toBe('Buyer Beta');
    expect(document.originalRef.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(document.preview).not.toHaveProperty('rawXml'); expect(document).not.toHaveProperty('storedFileName');
    const download = await original.GET(new NextRequest('http://localhost' + document.originalRef.downloadUrl), context(firstId));
    // Request URL is not an authority for the looked-up tenant source.
    expect(download.status).toBe(200); expect(await download.text()).toBe(bytes);
    expect(download.headers.get('content-disposition')).toContain('attachment;');
    expect(download.headers.get('x-content-type-options')).toBe('nosniff'); expect(download.headers.get('cache-control')).toBe('private, no-store');
    await noFinancialRows();
  });
  it('reuses CII extraction without moving supplier or buyer into the sales address book', async () => {
    const cii = '<CrossIndustryInvoice><ExchangedDocument><ID>CII-17</ID><TypeCode>380</TypeCode><IssueDateTime><DateTimeString format="102">20261020</DateTimeString></IssueDateTime></ExchangedDocument><SupplyChainTradeTransaction><ApplicableHeaderTradeAgreement><SellerTradeParty><Name>CII Supplier</Name></SellerTradeParty><BuyerTradeParty><Name>CII Recipient</Name></BuyerTradeParty></ApplicableHeaderTradeAgreement><ApplicableHeaderTradeSettlement><InvoiceCurrencyCode>EUR</InvoiceCurrencyCode><SpecifiedTradeSettlementHeaderMonetarySummation><GrandTotalAmount>19.95</GrandTotalAmount><DuePayableAmount>19.95</DuePayableAmount></SpecifiedTradeSettlementHeaderMonetarySummation></ApplicableHeaderTradeSettlement></SupplyChainTradeTransaction></CrossIndustryInvoice>';
    const response = await collection.POST(upload(cii)); expect(response.status).toBe(201);
    const document = (await response.json()).document;
    expect(document.preview.format).toBe('CII'); expect(document.supplierCandidate.name).toBe('CII Supplier'); expect(document.buyerCandidate.name).toBe('CII Recipient'); expect(document.totalAmount).toBe('19.95');
    await noFinancialRows();
  });
  it('replays one request, rejects key changes and same-file aliases with tenant-scoped existing ID', async () => {
    const key = randomUUID(), bytes = xml('IDEMPOTENT');
    const first = await collection.POST(upload(bytes, key)); const id = (await first.json()).document.id;
    const repeated = await collection.POST(upload(bytes, key, 'renamed.xml')); expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({ document: { id }, replayed: true });
    const changed = await collection.POST(upload(xml('CHANGED'), key)); expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ code: 'UPLOAD_REQUEST_CONFLICT' });
    const duplicate = await collection.POST(upload(bytes)); expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ code: 'EXACT_FILE_DUPLICATE', duplicateKind: 'EXACT_FILE', existingDocumentId: id });
    expect(await database.client.purchaseDocument.count({ where: { originalSha256: createHash('sha256').update(bytes).digest('hex') } })).toBe(1);
  });
  it('handles concurrent exact-file uploads with one row and one private file', async () => {
    const bytes = xml('CONCURRENT'); const key = randomUUID();
    const responses = await Promise.all([collection.POST(upload(bytes, key)), collection.POST(upload(bytes, key))]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 201]);
    const ids = (await Promise.all(responses.map(response => response.json()))).map(body => body.document.id);
    expect(new Set(ids).size).toBe(1);
    const row = await database.client.purchaseDocument.findUniqueOrThrow({ where: { id: ids[0] } });
    expect(await readFile(path.join(storage, 'data/uploads/incoming-owner', row.storedFileName), 'utf8')).toBe(bytes);
    expect((await readdir(path.join(storage, 'data/uploads/incoming-owner'))).length).toBe(await database.client.purchaseDocument.count({ where: { userId: 'incoming-owner' } }));
  });
  it('retains malformed XML, plain PDF and unsafe DTD as explicit failed unbooked sources', async () => {
    const plainPdf = Buffer.from(await (await PDFDocument.create()).save());
    for (const [bytes, name, type, code] of [
      ['<Invoice>broken', 'broken.xml', 'application/xml', 'PARSE_FAILED'],
      [plainPdf, 'plain.pdf', 'application/pdf', 'NO_EMBEDDED_XML'],
      ['<!DOCTYPE Invoice [<!ENTITY secret SYSTEM "file:///etc/passwd">]><Invoice>&secret;</Invoice>', 'unsafe.xml', 'application/xml', 'UNSAFE_XML'],
    ]) {
      const response = await collection.POST(upload(bytes as string | Uint8Array, randomUUID(), name as string, type as string)); expect(response.status).toBe(201);
      const document = (await response.json()).document; expect(document).toMatchObject({ parseStatus: 'FAILED', parseErrorCode: code, reviewState: 'REVIEW', linkedExpenseId: null });
      expect(document.parserWarnings.some((warning: { code: string }) => warning.code === 'NOT_VALIDATED')).toBe(true);
      const file = await original.GET(new NextRequest('http://localhost/original'), context(document.id)); expect(Buffer.from(await file.arrayBuffer())).toEqual(typeof bytes === 'string' ? Buffer.from(bytes) : bytes);
    }
    await noFinancialRows();
  });
  it('preserves unsupported currency and credit notes as review suggestions, never a ledger posting', async () => {
    for (const [currency, root] of [['USD', 'Invoice'], ['EUR', 'CreditNote']]) {
      const response = await collection.POST(upload(xml(`UNSUPPORTED-${currency}-${root}`, 'Supplier Alpha', currency, root)));
      expect(response.status).toBe(201); const document = (await response.json()).document;
      expect(document.parseStatus).toBe('PARSED'); expect(document.approvalSupported).toBe(false);
      expect(document.parserWarnings.some((warning: { code: string }) => warning.code === 'UNSUPPORTED_APPROVAL')).toBe(true);
    }
    await noFinancialRows();
  });
  it('never invents an invoice date when the source date is missing or impossible', async () => {
    const response = await collection.POST(upload(xml('INVALID-DATE', 'Supplier Alpha', 'EUR', 'Invoice', '2026-02-30')));
    expect(response.status).toBe(201); const document = (await response.json()).document;
    expect(document.invoiceDate).toBeNull(); expect(document.preview.invoiceDate).toBeNull(); expect(document.approvalSupported).toBe(false);
    expect(document.parserWarnings.some((warning: { code: string }) => warning.code === 'MISSING_INVOICE_DATE')).toBe(true);
  });
  it('warns on conservative same-supplier/invoice matches, not same-number/different-supplier', async () => {
    const first = await collection.POST(upload(xml('BUSINESS-DUP', 'Supplier One'))); const id = (await first.json()).document.id;
    const same = await collection.POST(upload(xml('BUSINESS-DUP', 'Supplier One') + '\n')); const sameId = (await same.json()).document.id;
    const other = await collection.POST(upload(xml('BUSINESS-DUP', 'Supplier Two'))); const otherId = (await other.json()).document.id;
    expect((await fetchDetail(sameId)).businessDuplicates.map(item => item.id)).toContain(id);
    expect((await fetchDetail(otherId)).businessDuplicates).toEqual([]);
  });
  it('dismisses idempotently, preserves the original on upload replay and requires explicit revision-checked reopen', async () => {
    const key = randomUUID(), bytes = xml('DISMISS'); const initial = await collection.POST(upload(bytes, key)); const document = (await initial.json()).document;
    const missingReason = await dismiss.POST(json(document.id, 'dismiss', { expectedRevision: document.revision }), context(document.id)); expect(missingReason.status).toBe(400);
    const discarded = await dismiss.POST(json(document.id, 'dismiss', { expectedRevision: document.revision, reason: 'Nicht für dieses Unternehmen' }), context(document.id));
    expect(discarded.status).toBe(200); const saved = (await discarded.json()).document; expect(saved.reviewState).toBe('DISMISSED');
    const repeated = await dismiss.POST(json(document.id, 'dismiss', { expectedRevision: document.revision, reason: 'Nicht für dieses Unternehmen' }), context(document.id)); expect(repeated.status).toBe(200);
    const uploadReplay = await collection.POST(upload(bytes, key)); expect((await uploadReplay.json()).document.reviewState).toBe('DISMISSED');
    const blockedParse = await retry.POST(json(document.id, 'retry-parse', { expectedRevision: saved.revision }), context(document.id)); expect(blockedParse.status).toBe(409);
    const stale = await reopen.POST(json(document.id, 'reopen', { expectedRevision: document.revision }), context(document.id)); expect(stale.status).toBe(409);
    const opened = await reopen.POST(json(document.id, 'reopen', { expectedRevision: saved.revision }), context(document.id)); expect(opened.status).toBe(200); expect((await opened.json()).document.reviewState).toBe('REVIEW');
    await noFinancialRows();
  });
  it('fails closed on altered original bytes for download and retry', async () => {
    const response = await collection.POST(upload(xml('TAMPER'))); const document = (await response.json()).document;
    const row = await database.client.purchaseDocument.findUniqueOrThrow({ where: { id: document.id } });
    await writeFile(path.join(storage, 'data/uploads/incoming-owner', row.storedFileName), 'modified');
    const download = await original.GET(new NextRequest('http://localhost/original'), context(row.id)); expect(download.status).toBe(409); expect(await download.json()).toMatchObject({ code: 'ORIGINAL_INTEGRITY' });
    const parsed = await retry.POST(json(row.id, 'retry-parse', { expectedRevision: document.revision }), context(row.id)); expect(parsed.status).toBe(409);
  });
  it('uses tenant ownership for list/detail/original and never discloses another tenant duplicate', async () => {
    state.userId = 'incoming-other';
    try {
      expect((await detail.GET(new NextRequest('http://localhost/detail'), context(firstId))).status).toBe(404);
      expect((await original.GET(new NextRequest('http://localhost/original'), context(firstId))).status).toBe(404);
      expect((await dismiss.POST(json(firstId, 'dismiss', { expectedRevision: 1, reason: 'foreign' }), context(firstId))).status).toBe(404);
      const result = await collection.GET(new NextRequest('http://localhost/api/purchase-documents')); expect((await result.json()).total).toBe(0);
      const foreignSame = await collection.POST(upload(xml('FIRST'))); expect(foreignSame.status).toBe(201);
      const listing = await collection.GET(new NextRequest('http://localhost/api/purchase-documents?limit=1')); expect((await listing.json()).total).toBe(1);
    } finally { state.userId = 'incoming-owner'; }
  });
  it('rejects unsafe containers, invalid UUID/IDs, actual oversized bodies and hostile origins', async () => {
    const before = await database.client.purchaseDocument.count();
    expect((await collection.POST(upload('active html', randomUUID(), 'evil.html', 'text/html'))).status).toBe(415);
    expect((await collection.POST(upload(xml('MIME'), randomUUID(), 'evil.pdf', 'application/xml'))).status).toBe(415);
    expect((await collection.POST(upload(xml('KEY'), 'not-a-uuid'))).status).toBe(400);
    const huge = new NextRequest('http://localhost/api/purchase-documents', { method: 'POST', headers: { 'content-length': String(30 * 1024 * 1024) }, body: 'x' }); expect((await collection.POST(huge)).status).toBe(413);
    const hostile = upload(xml('ORIGIN')); hostile.headers.set('Origin', 'https://attacker.invalid'); expect((await collection.POST(hostile)).status).toBe(403);
    expect((await collection.GET(new NextRequest('http://localhost/api/purchase-documents?limit=1000'))).status).toBe(400);
    expect((await detail.GET(new NextRequest('http://localhost/detail'), { params: Promise.resolve({ id: '../etc/passwd' }) })).status).toBe(404);
    expect(await database.client.purchaseDocument.count()).toBe(before);
    const ownerFiles = await readdir(path.join(storage, 'data/uploads/incoming-owner')); expect(ownerFiles.every(name => /^[0-9a-f-]{36}\.(pdf|xml|jpg|png)$/.test(name))).toBe(true);
  });
  it('rolls back failed intake audit and cleans only its unreferenced newly created original', async () => {
    const beforeRows = await database.client.purchaseDocument.count();
    const directory = path.join(storage, 'data/uploads/incoming-owner');
    const beforeFiles = (await readdir(directory)).sort();
    state.failOperation = 'purchase-document.intake';
    try { expect((await collection.POST(upload(xml('AUDIT-ROLLBACK')))).status).toBe(500); }
    finally { state.failOperation = ''; }
    expect(await database.client.purchaseDocument.count()).toBe(beforeRows);
    expect((await readdir(directory)).sort()).toEqual(beforeFiles);
  });
  it('retains a committed PENDING source after derived-audit interruption and recovers it by hash-checked retry', async () => {
    const key = randomUUID(); const bytes = xml('PENDING-RECOVERY');
    state.failOperation = 'purchase-document.parse';
    try { expect((await collection.POST(upload(bytes, key))).status).toBe(500); }
    finally { state.failOperation = ''; }
    const replay = await collection.POST(upload(bytes, key)); expect(replay.status).toBe(200);
    const document = (await replay.json()).document; expect(document).toMatchObject({ parseStatus: 'PENDING', reviewState: 'REVIEW', revision: 0 });
    const result = await retry.POST(json(document.id, 'retry-parse', { expectedRevision: document.revision }), context(document.id)); expect(result.status).toBe(200); expect((await result.json()).document.parseStatus).toBe('PARSED');
    const row = await database.client.purchaseDocument.findUniqueOrThrow({ where: { id: document.id } });
    expect(await readFile(path.join(storage, 'data/uploads/incoming-owner', row.storedFileName), 'utf8')).toBe(bytes);
    await noFinancialRows();
  });
  it('retains extreme derived input as bounded failed preview rather than creating an unrestorable source', async () => {
    const source = xml('BOUNDED-PREVIEW', 'S'.repeat(1_001));
    const response = await collection.POST(upload(source)); expect(response.status).toBe(201);
    const document = (await response.json()).document; expect(document).toMatchObject({ parseStatus: 'FAILED', parseErrorCode: 'PREVIEW_LIMIT_EXCEEDED', preview: null });
    const downloaded = await original.GET(new NextRequest('http://localhost/original'), context(document.id)); expect(await downloaded.text()).toBe(source);
  });
  it('never advertises cached or restored legacy-parser previews as approval-supported until explicit reparse', async () => {
    const response = await collection.POST(upload(xml('STALE-PARSER'))); expect(response.status).toBe(201);
    const initial = (await response.json()).document;
    expect(initial.approvalSupported).toBe(true);
    await database.client.purchaseDocument.update({ where: { id: initial.id }, data: { parserVersion: 'purchase-preview-v1' } });
    const stale = await fetchDetail(initial.id);
    expect(stale.preview?.approvalSupported).toBe(true); // Stored source snapshot is not silently rewritten.
    expect(stale.approvalSupported).toBe(false);
    const listing = await collection.GET(new NextRequest('http://localhost/api/purchase-documents?search=STALE-PARSER'));
    expect((await listing.json()).documents[0].approvalSupported).toBe(false);
    const reparsed = await retry.POST(json(initial.id, 'retry-parse', { expectedRevision: stale.revision }), context(initial.id));
    expect(reparsed.status).toBe(200);
    const refreshed = (await reparsed.json()).document;
    expect(refreshed.parserVersion).toBe((await import('@/lib/purchase-documents/parser')).PURCHASE_PARSER_VERSION);
    expect(refreshed.approvalSupported).toBe(true);
    await noFinancialRows();
  });
  it('archives genuine JPG/PNG bytes and saves a separate exact-money draft without posting or rewriting extracted values', async () => {
    for (const format of ['jpeg', 'png'] as const) {
      const bytes = await sharp({ create: { width: 390, height: 700, channels: 3, background: '#f7f4ed' } })[format]().toBuffer();
      const key = randomUUID();
      const response = await collection.POST(upload(bytes, key, `mobile.${format === 'jpeg' ? 'jpg' : 'png'}`, `image/${format}`));
      expect(response.status).toBe(201); const source = (await response.json()).document;
      expect(source).toMatchObject({ parseStatus: 'FAILED', parseErrorCode: 'PHOTO_MANUAL_REVIEW', preview: null, approvalSupported: false, reviewDraft: null });
      const draft = { supplierName: 'Mobile Supplier', invoiceNumber: 'PHONE-17', invoiceDate: '2026-10-20', paymentDate: '2026-10-21', amount: '123,45', note: 'Only an unposted draft' };
      const saved = await draftRoute.POST(json(source.id, 'review-draft', { expectedRevision: source.revision, draft }), context(source.id));
      expect(saved.status).toBe(200); const document = (await saved.json()).document;
      expect(document).toMatchObject({ reviewState: 'REVIEW', linkedExpenseId: null, supplierName: null, invoiceDate: null, totalAmount: null, reviewDraft: { ...draft, amount: '123.45' }, revision: source.revision + 1 });
      expect(document.reviewDraftSavedAt).toMatch(/^\d{4}-/);
      const refreshed = await fetchDetail(source.id); expect(refreshed.reviewDraft).toEqual(document.reviewDraft);
      const listing = await collection.GET(new NextRequest('http://localhost/api/purchase-documents?search=Mobile%20Supplier'));
      expect((await listing.json()).documents.some((row: IncomingDocument) => row.id === source.id && row.reviewDraftSavedAt)).toBe(true);
      const download = await original.GET(new NextRequest('http://localhost/original'), context(source.id));
      expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes); expect(download.headers.get('cache-control')).toBe('private, no-store');
      const replay = await collection.POST(upload(bytes, key, `mobile.${format === 'jpeg' ? 'jpg' : 'png'}`, `image/${format}`)); expect(replay.status).toBe(200); expect((await replay.json()).document.reviewDraft).toEqual(document.reviewDraft);
      const stale = await draftRoute.POST(json(source.id, 'review-draft', { expectedRevision: source.revision, draft }), context(source.id)); expect(stale.status).toBe(409);
      expect((await fetchDetail(source.id)).reviewDraft).toEqual(document.reviewDraft);
    }
    await noFinancialRows();
  });
  it('enforces real image decoding, media agreement, byte/dimension limits and rejects active SVG/HEIC', async () => {
    const count = await database.client.purchaseDocument.count();
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } }).png().toBuffer();
    const animationControl = Buffer.alloc(20); animationControl.writeUInt32BE(8, 0); animationControl.write('acTL', 4); animationControl.writeUInt32BE(2, 8);
    const animated = Buffer.concat([png.subarray(0, 33), animationControl, png.subarray(33)]);
    const bomb = Buffer.from(png); bomb.writeUInt32BE(7000, 16); bomb.writeUInt32BE(7000, 20);
    let crc = 0xffffffff; for (const value of bomb.subarray(12, 29)) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } bomb.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29);
    const wide = await sharp({ create: { width: 12001, height: 1, channels: 3, background: '#fff' } }).png().toBuffer();
    for (const [bytes, name, mime] of [[animated, 'animated.png', 'image/png'], [png, 'wrong.jpg', 'image/jpeg'], [bomb, 'decompression-bomb.png', 'image/png'], [wide, 'wide.png', 'image/png'], [Buffer.from([255,216,255,0]), 'corrupt.jpg', 'image/jpeg'], [Buffer.from('<svg onload="alert(1)"/>'), 'active.svg', 'image/svg+xml'], [png, 'mobile.heic', 'image/heic']] as const) {
      expect((await collection.POST(upload(bytes, randomUUID(), name, mime))).status).toBe(415);
    }
    expect((await collection.POST(upload(Buffer.alloc(10 * 1024 * 1024 + 1), randomUUID(), 'large.png', 'image/png'))).status).toBe(413);
    expect(await database.client.purchaseDocument.count()).toBe(count);
  });
  it('rejects forged draft attestations and stale/cross-tenant/dismissed writes; failed audit rolls back the draft', async () => {
    const initial = (await (await collection.POST(upload(xml('DRAFT-BOUNDARY')))).json()).document;
    const draft = { supplierName: '', invoiceNumber: '', invoiceDate: '', paymentDate: '', amount: '0.29', note: 'Pending review' };
    const send = (value: unknown) => draftRoute.POST(json(initial.id, 'review-draft', { expectedRevision: initial.revision, draft: value }), context(initial.id));
    for (const invalid of [{ ...draft, confirmPaymentDate: true }, { ...draft, amount: '1.001' }, { ...draft, amount: '90071992547409.92' }, { ...draft, paymentDate: '2026-02-30' }, { ...draft, amount: '-1' }, { ...draft, note: 'x'.repeat(2001) }]) expect((await send(invalid)).status).toBe(400);
    state.userId = 'incoming-other'; try { expect((await send(draft)).status).toBe(404); } finally { state.userId = 'incoming-owner'; }
    state.failOperation = 'purchase-document.save-review-draft'; try { expect((await send(draft)).status).toBe(500); } finally { state.failOperation = ''; }
    expect((await fetchDetail(initial.id)).reviewDraft).toBeNull(); expect((await fetchDetail(initial.id)).revision).toBe(initial.revision);
    expect((await send(draft)).status).toBe(200);
    const saved = await fetchDetail(initial.id);
    expect((await dismiss.POST(json(initial.id, 'dismiss', { expectedRevision: saved.revision, reason: 'No posting' }), context(initial.id))).status).toBe(200);
    expect((await draftRoute.POST(json(initial.id, 'review-draft', { expectedRevision: saved.revision + 1, draft }), context(initial.id))).status).toBe(409);
    expect((await fetchDetail(initial.id)).reviewDraft).toEqual(draft);
    await noFinancialRows();
  });
  it('requires authentication before data access', async () => {
    state.userId = null;
    try { expect((await draftRoute.POST(json(firstId, 'review-draft', { expectedRevision: 0, draft: {} }), context(firstId))).status).toBe(401); expect((await collection.GET(new NextRequest('http://localhost/api/purchase-documents'))).status).toBe(401); expect((await collection.POST(upload(xml('ANON')))).status).toBe(401); }
    finally { state.userId = 'incoming-owner'; }
  });
});
