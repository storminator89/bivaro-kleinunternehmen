import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDatabase } from './helpers/database';
import { PURCHASE_PARSER_VERSION } from '@/lib/purchase-documents/parser';
import { getPurchaseBusinessDuplicates, listPurchaseDocuments } from '@/lib/purchase-documents/service';

const state = vi.hoisted(() => ({ client: null as ReturnType<typeof createTestDatabase>['client'] | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
let database: ReturnType<typeof createTestDatabase>;
const queries: string[] = [];
const day = new Date('2026-10-20T00:00:00.000Z');
const uploaded = new Date('2026-10-20T12:13:14.567Z');
const party = { name: 'Summary Supplier', email: null, address: null, zipCode: null, city: null, country: null, addressLines: [] };
const largeLines = Array.from({ length: 500 }, () => ({ description: 'SOURCE_LINE_SENTINEL'.repeat(200), quantity: '1', unit: null, unitPrice: '1', amount: '1', taxRate: '0' }));
async function source(userId: string, amount: string, invoiceNumber = 'SUMMARY-17', warnings = [{ code: 'UNSUPPORTED_AMOUNT', message: 'Exact source is not approved for posting.' }]) {
  return database.client.purchaseDocument.create({ data: {
    userId, originalFileName: `summary-${randomUUID()}.xml`, storedFileName: `${randomUUID()}.xml`, originalSha256: randomUUID().replaceAll('-', '').repeat(2), originalByteCount: 2_000_000,
    mediaType: 'application/xml', uploadRequestId: randomUUID(), uploadedAt: uploaded, invoiceDate: day,
    parseStatus: 'PARSED', parserVersion: PURCHASE_PARSER_VERSION, supplierName: party.name, invoiceNumber,
    currency: 'EUR', totalAmount: Number(amount),
    parsedData: { extractionStatus: 'PARSED', validationStatus: 'NOT_VALIDATED', format: 'UBL', documentType: 'INVOICE', documentTypeCode: '380', currency: 'EUR', invoiceNumber, invoiceDate: day.toISOString(), dueDate: null,
      grossAmount: amount, dueAmount: amount, prepaidAmount: null, roundingAmount: null, netAmount: null, taxAmount: null,
      sellerInfo: party, buyerInfo: { ...party, name: 'Summary Buyer' }, lineItems: largeLines, parserWarnings: warnings, approvalSupported: false },
  } });
}
beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  database.client.$on('query', event => queries.push(event.query));
  await database.client.user.createMany({ data: ['summary-owner', 'summary-other'].map(id => ({ id, email: `${id}@test.invalid`, password: 'unused' })) });
}, 40_000);
afterAll(async () => { await database?.cleanup(); });

function assertProjectedQueriesOnly() {
  const selects = queries.filter(query => /SELECT/i.test(query) && /PurchaseDocument/.test(query));
  expect(selects.length).toBeGreaterThan(0);
  for (const query of selects) {
    expect(query).not.toMatch(/SELECT\s+\*/i);
    expect(query).not.toMatch(/(?:SELECT|,)\s*(?:"\w+"\.)*(?:"parsedData")(?=\s|,)/i);
    expect(query).not.toMatch(/(?:SELECT|,)\s*(?:"\w+"\.)*(?:"aiExtraction"|"aiApprovedSnapshot")(?=\s|,)/i);
    expect(query).not.toContain('lineItems'); expect(query).not.toContain('rawXml');
  }
}
describe('bounded incoming list and duplicate projections', () => {
  it('projects metadata and exact decimal strings, preserving dates/status/filtering without loading full source JSON', async () => {
    const first = await source('summary-owner', '90071992547409.91');
    const second = await source('summary-owner', '100.000000000000000001');
    await source('summary-other', '50.00');
    await database.client.purchaseDocument.update({ where: { id: first.id }, data: { aiExtraction: { oversizedSentinel: 'AI_RESULT_SENTINEL'.repeat(100_000) }, aiApprovedSnapshot: { oversizedSentinel: 'AI_APPROVED_SENTINEL'.repeat(100_000) } } });
    queries.length = 0;
    const listing = await listPurchaseDocuments('summary-owner', new URLSearchParams({ limit: '50', reviewStatus: 'REVIEW', search: 'SUMMARY-17' }));
    expect(listing.total).toBe(2); expect(listing.documents.map(document => document.id)).toEqual([second.id, first.id]);
    expect(listing.documents.map(document => document.totalAmount)).toEqual(['100.000000000000000001', '90071992547409.91']);
    for (const document of listing.documents) {
      expect(document.invoiceDate).toBe(day.toISOString()); expect(document.originalRef.uploadedAt).toBe(uploaded.toISOString());
      expect(document).toMatchObject({ parseStatus: 'PARSED', validationStatus: 'NOT_VALIDATED', reviewState: 'REVIEW', preview: null, supplierCandidate: null, buyerCandidate: null, approvalSupported: false });
      expect(document.parserWarnings).toContainEqual({ code: 'UNSUPPORTED_AMOUNT', message: 'Exact source is not approved for posting.' });
    }
    expect(JSON.stringify(listing)).not.toContain('SOURCE_LINE_SENTINEL');
    expect(JSON.stringify(listing)).not.toContain('AI_RESULT_SENTINEL');
    expect(JSON.stringify(listing)).not.toContain('AI_APPROVED_SENTINEL');
    expect(listing.documents.every(document => document.aiApprovedSnapshot === undefined)).toBe(true);
    assertProjectedQueriesOnly();
    expect(queries.some(query => query.includes("'$.grossAmount'"))).toBe(true);
    expect(queries.some(query => query.includes("'$.parserWarnings'"))).toBe(true);
    const page = await listPurchaseDocuments('summary-owner', new URLSearchParams({ limit: '1', page: '2', search: 'SUMMARY-17' }));
    expect(page.total).toBe(2); expect(page.documents.map(document => document.id)).toEqual([first.id]);
  });
  it('projects duplicate metadata plus exact gross only, never SELECT * or whole parsedData, with tenant-bound dates and amounts', async () => {
    const document = await database.client.purchaseDocument.findFirstOrThrow({ where: { userId: 'summary-owner', originalSha256: { not: '' } }, orderBy: { id: 'asc' } });
    queries.length = 0;
    const duplicates = await getPurchaseBusinessDuplicates(document);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({ totalAmount: '100.000000000000000001', invoiceDate: day.toISOString(), reviewState: 'REVIEW', linkedExpenseId: null });
    assertProjectedQueriesOnly();
    expect(queries).toHaveLength(1); expect(queries[0]).not.toContain('parserWarnings'); expect(queries[0]).toMatch(/LIMIT 51/);
    expect(queries[0]).toContain("'$.grossAmount'");
  });
  it('caps warning fragments before returning them from SQLite and exposes a truthful limited-summary warning', async () => {
    const record = await source('summary-owner', '119.00', 'SUMMARY-LIMIT', Array.from({ length: 100 }, () => ({ code: 'SOURCE_WARNING', message: '"'.repeat(2_000) })));
    await database.client.purchaseDocument.update({ where: { id: record.id }, data: { parsedData: { grossAmount: '119.00', approvalSupported: true,
      lineItems: largeLines, parserWarnings: Array.from({ length: 100 }, () => ({ code: 'SOURCE_WARNING', message: '"'.repeat(2_000) })) } } });
    queries.length = 0;
    const listing = await listPurchaseDocuments('summary-owner', new URLSearchParams({ search: 'SUMMARY-LIMIT' }));
    expect(listing.documents[0]).toMatchObject({ id: record.id, parseStatus: 'PARSED', totalAmount: '119.00', approvalSupported: false });
    expect(listing.documents[0].parserWarnings).toContainEqual(expect.objectContaining({ code: 'PREVIEW_SUMMARY_UNAVAILABLE' }));
    expect(JSON.stringify(listing).length).toBeLessThan(3_000); assertProjectedQueriesOnly();
    expect(queries.some(query => query.includes('substr(json_extract("parsedData", \'$.parserWarnings\')'))).toBe(true);
  });
});
