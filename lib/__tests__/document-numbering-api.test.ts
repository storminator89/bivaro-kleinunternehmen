import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from './helpers/database';
const state = vi.hoisted(() => ({ client: null as unknown, userId: null as string | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return { UnauthorizedError, requireUserId: async () => { if (!state.userId) throw new UnauthorizedError(); return state.userId; }, unauthorizedResponse: () => new Response(null, { status: 401 }) };
});
import { GET, POST } from '@/app/api/settings/document-numbering/route';
import { GET as invoicePreview } from '@/app/api/invoices/next-number/route';
import { GET as quotePreview } from '@/app/api/quotes/next-number/route';
let database: ReturnType<typeof createTestDatabase>;
let index = 0;
const year = new Date().getFullYear();
const value = () => ({ version: 1, action: 'preview', type: 'INVOICE', expectedRevision: 0, formatVersion: 1, prefix: 'RE-', includeYear: true, sequenceWidth: 3, startSequence: 1, effectiveYear: year });
function request(input: unknown, origin?: string) { return new Request('http://localhost/api/settings/document-numbering', { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(input) }); }
beforeAll(async () => { database = createTestDatabase(); state.client = database.client; }, 40_000);
beforeEach(async () => { state.userId = `numbering-api-${++index}`; await database.client.user.create({ data: { id: state.userId, email: `${state.userId}@test.invalid`, password: 'unused' } }); });
afterAll(async () => { await database?.cleanup(); });
describe('numbering settings API boundary', () => {
  it('requires authentication for settings and document previews', async () => {
    state.userId = null;
    expect((await GET()).status).toBe(401);
    expect((await POST(request(value()))).status).toBe(401);
    expect((await invoicePreview(new Request('http://localhost/api/invoices/next-number'))).status).toBe(401);
  });
  it('rejects cross-origin and oversized requests before mutation', async () => {
    expect((await POST(request(value(), 'https://attacker.invalid'))).status).toBe(403);
    expect((await POST(request({ ...value(), extra: 'x'.repeat(5000) }))).status).toBe(413);
    expect(await database.client.documentNumberingPolicy.count({ where: { userId: state.userId! } })).toBe(0);
  });
  it('returns three tenant-private rows and consumes nothing on GET or preview/cancel', async () => {
    const response = await GET(); expect(response.headers.get('cache-control')).toContain('no-store');
    expect((await response.json()).rows).toHaveLength(3);
    const preview = await POST(request(value())); expect(preview.status).toBe(200); expect(await preview.json()).toMatchObject({ saved: false, nextNumber: `RE-${year}-001` });
    expect(await database.client.documentNumberingPolicy.count({ where: { userId: state.userId! } })).toBe(0);
    expect(await database.client.invoiceNumberCounter.count({ where: { userId: state.userId! } })).toBe(0);
    expect(await database.client.auditLog.count({ where: { userId: state.userId! } })).toBe(0);
  });
  it('requires confirmation and a matching checked preview to save atomically', async () => {
    expect((await POST(request({ ...value(), action: 'save' }))).status).toBe(400);
    expect((await POST(request({ ...value(), action: 'save', confirmed: true, expectedNumber: 'wrong' }))).status).toBe(409);
    const save = await POST(request({ ...value(), action: 'save', confirmed: true, expectedNumber: `RE-${year}-001` }));
    expect(save.status).toBe(201); expect(await save.json()).toMatchObject({ saved: true, revision: 1 });
    expect(await database.client.documentNumberingPolicy.count({ where: { userId: state.userId! } })).toBe(1);
    expect(await database.client.invoiceNumberCounter.count({ where: { userId: state.userId! } })).toBe(0);
    const audit = await database.client.auditLog.findFirstOrThrow({ where: { userId: state.userId! } }); expect(audit.metadata).toContain('settings.document-numbering.change'); expect(audit.metadata).not.toContain('RE-');
  });
  it('rejects repeated saves and stale settings tabs with no second audit', async () => {
    const input = { ...value(), action: 'save', confirmed: true, expectedNumber: `RE-${year}-001` };
    const outcomes = await Promise.all([POST(request(input)), POST(request(input))]);
    expect(outcomes.map(row => row.status).sort()).toEqual([201, 409]);
    expect(await database.client.documentNumberingPolicy.count({ where: { userId: state.userId! } })).toBe(1);
    expect(await database.client.auditLog.count({ where: { userId: state.userId! } })).toBe(1);
  });
  it('blocks an unrecognised legacy format before writing config or audit', async () => {
    await database.client.invoice.create({ data: { userId: state.userId!, invoiceNumber: 'EXTERNAL/123', fileName: 'old.pdf', storedFileName: 'unchanged.pdf', parsedData: {} } });
    const response = await POST(request(value())); expect(response.status).toBe(422); expect((await response.json()).code).toBe('NUMBERING_LEGACY_REVIEW');
    expect(await database.client.documentNumberingPolicy.count({ where: { userId: state.userId! } })).toBe(0);
  });
  it('includes exact configuration provenance for invoice/quote previews and validates year', async () => {
    const invoice = await invoicePreview(new Request('http://localhost/api/invoices/next-number?year=2027'));
    expect(await invoice.json()).toEqual({ nextInvoiceNumber: '2027-01', numberingSelection: { version: 1, type: 'INVOICE', revision: 0, year: 2027, number: '2027-01', automatic: true } });
    const quote = await quotePreview(new Request('http://localhost/api/quotes/next-number?year=2027')); expect((await quote.json()).nextQuoteNumber).toBe('AN-2027-01');
    expect((await invoicePreview(new Request('http://localhost/api/invoices/next-number?year=NaN'))).status).toBe(400);
    expect((await invoicePreview(new Request('http://localhost/api/invoices/next-number?year=10000'))).status).toBe(400);
    expect(await database.client.invoiceNumberCounter.count({ where: { userId: state.userId! } })).toBe(0);
  });
  it('does not expose another tenant policy', async () => {
    await POST(request({ ...value(), action: 'save', confirmed: true, expectedNumber: `RE-${year}-001` }));
    state.userId = `numbering-api-other-${index}`; await database.client.user.create({ data: { id: state.userId, email: `${state.userId}@test.invalid`, password: 'unused' } });
    const response = await GET(); const rows = (await response.json()).rows;
    expect(rows.every((row: { revision: number }) => row.revision === 0)).toBe(true);
    expect(rows.find((row: { type: string }) => row.type === 'INVOICE').nextNumber).toBe(`${year}-01`);
  });
});
