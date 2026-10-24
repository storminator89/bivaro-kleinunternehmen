import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase } from './helpers/database';
import { quoteCreateFingerprintForInvoice, quoteCreatePdfSha256 } from '@/lib/quote-create-request';
import { quoteCreateReceiptsFromBackup, preflightQuoteCreateReceipts, restoreQuoteCreateReceipts, type QuoteCreateReceiptBackup } from '@/lib/quote-create-receipt-backup';
let database: ReturnType<typeof createTestDatabase>;
let index = 0;
const when = '2026-10-24T09:00:00.000Z';
const requestId = 'a4388852-9a2f-497b-bddd-cb95ce6ce3e1';
function source() { const row = { id: 1, type: 'QUOTE', fileName: 'quote.pdf', invoiceNumber: 'MANUAL-1', invoiceDate: '2026-10-24T00:00:00.000Z', validUntil: null, totalAmount: 42, parsedData: { createdBy: 'bivaro', items: [] } }; return { ...row, quoteCreateRequestId: requestId, quoteCreateFingerprint: quoteCreateFingerprintForInvoice(row) }; }
function receipt(invoiceId: number | null = 1): QuoteCreateReceiptBackup { return { requestId, fingerprint: source().quoteCreateFingerprint, pdfSha256: quoteCreatePdfSha256(new TextEncoder().encode('%PDF-original')), invoiceId, createdAt: when }; }
async function owner() { const id = `receipt-${++index}`; await database.client.user.create({ data: { id, email: `${id}@test.invalid`, password: 'unused' } }); return id; }
async function invoice(userId: string) { const { id: _id, ...data } = source(); return database.client.invoice.create({ data: { ...data, userId, invoiceDate: new Date(data.invoiceDate), storedFileName: 'original.pdf' } }); }
async function existing() { const userId = await owner(); const document = await invoice(userId); const row = receipt(document.id); await database.client.quoteCreateReceipt.create({ data: { userId, ...row, invoiceUserId: userId, createdAt: new Date(when) } }); return { userId, document, row }; }
beforeAll(() => { database = createTestDatabase(); }, 40_000);
afterAll(async () => database?.cleanup());
describe('portable quote receipt validation', () => {
  it('requires independent receipt coverage for new schemas, rejecting even an empty legacy array', () => { expect(() => quoteCreateReceiptsFromBackup({}, true)).toThrow(); expect(() => quoteCreateReceiptsFromBackup({ quoteCreateReceipts: [] }, false)).toThrow('Älteres'); expect(quoteCreateReceiptsFromBackup({}, false)).toEqual([]); });
  it('accepts exact source links and live Date snapshots', () => { expect(quoteCreateReceiptsFromBackup({ invoices: [source()], quoteCreateReceipts: [{ ...receipt(), createdAt: new Date(when) }] }, true)).toEqual([receipt()]); });
  it('retains independent tombstones after deleted documents leave the source', () => { expect(quoteCreateReceiptsFromBackup({ invoices: [], quoteCreateReceipts: [receipt(null)] }, true)).toEqual([receipt(null)]); });
  it('rejects tombstone/active contradictions and missing backing receipts', () => { expect(() => quoteCreateReceiptsFromBackup({ invoices: [source()], quoteCreateReceipts: [receipt(null)] }, true)).toThrow(); expect(() => quoteCreateReceiptsFromBackup({ invoices: [source()], quoteCreateReceipts: [] }, true)).toThrow(); expect(() => quoteCreateReceiptsFromBackup({ invoices: [], quoteCreateReceipts: [receipt()] }, true)).toThrow(); });
  it('does not trust source fingerprints after document content changes', () => { expect(() => quoteCreateReceiptsFromBackup({ invoices: [{ ...source(), totalAmount: 99 }], quoteCreateReceipts: [receipt()] }, true)).toThrow('Prüfsumme'); });
  it('rejects duplicate UUIDs and non-unique active invoice links', () => { expect(() => quoteCreateReceiptsFromBackup({ invoices: [source()], quoteCreateReceipts: [receipt(), receipt()] }, true)).toThrow('Doppelte'); expect(() => quoteCreateReceiptsFromBackup({ invoices: [source()], quoteCreateReceipts: [receipt(), { ...receipt(), requestId: crypto.randomUUID() }] }, true)).toThrow('Mehrere'); });
  it.each([{ userId: 'forbidden' }, { pdfSha256: 'not-a-hash' }, { invoiceId: 0 }, { createdAt: '2026-02-30T00:00:00.000Z' }, { requestId: requestId.toUpperCase() }])('rejects nonportable/invalid receipt fields %j', change => { expect(() => quoteCreateReceiptsFromBackup({ invoices: [], quoteCreateReceipts: [{ ...receipt(null), ...change }] }, true)).toThrow(); });
});
describe('quote receipt restore authority', () => {
  it('maps new receipt links into the authenticated target only', async () => {
    const userId = await owner(), document = await invoice(userId), rows = [receipt()];
    await database.client.$transaction(async tx => { const previous = await preflightQuoteCreateReceipts(tx, userId, rows); expect(await restoreQuoteCreateReceipts(tx, userId, rows, new Map([[1, document.id]]), previous)).toEqual({ imported: 1, skipped: 0 }); });
    expect(await database.client.quoteCreateReceipt.findUniqueOrThrow({ where: { userId_requestId: { userId, requestId } } })).toMatchObject({ userId, invoiceUserId: userId, invoiceId: document.id, fingerprint: receipt().fingerprint });
  });
  it('rejects cross-tenant invoice-map substitution', async () => {
    const userId = await owner(), other = await owner(), document = await invoice(other);
    await expect(database.client.$transaction(tx => restoreQuoteCreateReceipts(tx, userId, [receipt()], new Map([[1, document.id]]), []))).rejects.toThrow('gehört nicht');
    expect(await database.client.quoteCreateReceipt.count({ where: { userId } })).toBe(0);
  });
  it('keeps original target tombstones authoritative against older linked source data', async () => {
    const { userId, document, row } = await existing(); await database.client.invoice.delete({ where: { id: document.id } });
    await expect(database.client.$transaction(tx => preflightQuoteCreateReceipts(tx, userId, [row]))).rejects.toThrow('gelöschtes');
    expect((await database.client.quoteCreateReceipt.findUniqueOrThrow({ where: { userId_requestId: { userId, requestId } } })).invoiceId).toBeNull();
  });
  it('relinks only an initially active receipt after authorised overwrite deletion', async () => {
    const { userId, document, row } = await existing();
    const restored = await database.client.$transaction(async tx => {
      const previous = await preflightQuoteCreateReceipts(tx, userId, [row]); await tx.invoice.delete({ where: { id: document.id } });
      const { id: _id, quoteCreateReceipts: _receipts, ...data } = { ...document, quoteCreateReceipts: [] };
      const next = await tx.invoice.create({ data: { ...data, parsedData: source().parsedData } }); await restoreQuoteCreateReceipts(tx, userId, [row], new Map([[document.id, next.id]]), previous); return next;
    });
    const retained = await database.client.quoteCreateReceipt.findUniqueOrThrow({ where: { userId_requestId: { userId, requestId } } });
    expect(retained.invoiceId).toBe(restored.id); expect(retained.fingerprint).toBe(row.fingerprint); expect(retained.pdfSha256).toBe(row.pdfSha256); expect(retained.createdAt.toISOString()).toBe(when);
  });
  it('never retires a current live target merely from an incoming tombstone during merge', async () => {
    const { userId, document, row } = await existing(); const incoming = [{ ...row, invoiceId: null }];
    await database.client.$transaction(async tx => { const previous = await preflightQuoteCreateReceipts(tx, userId, incoming); await restoreQuoteCreateReceipts(tx, userId, incoming, new Map(), previous); });
    expect((await database.client.quoteCreateReceipt.findUniqueOrThrow({ where: { userId_requestId: { userId, requestId } } })).invoiceId).toBe(document.id);
  });
  it('keeps omitted identities as tombstones after legacy overwrite, never deleting receipt history', async () => {
    const { userId, document } = await existing();
    await database.client.$transaction(async tx => { const previous = await preflightQuoteCreateReceipts(tx, userId, []); await tx.invoice.delete({ where: { id: document.id } }); await restoreQuoteCreateReceipts(tx, userId, [], new Map(), previous); });
    expect((await database.client.quoteCreateReceipt.findUniqueOrThrow({ where: { userId_requestId: { userId, requestId } } })).invoiceId).toBeNull();
  });
  it('rejects immutable receipt divergence before overwrite can delete documents', async () => {
    const { userId, document, row } = await existing();
    for (const change of [{ fingerprint: 'a'.repeat(64) }, { pdfSha256: 'b'.repeat(64) }, { createdAt: '2026-10-24T09:00:01.000Z' }]) await expect(database.client.$transaction(tx => preflightQuoteCreateReceipts(tx, userId, [{ ...row, ...change }]))).rejects.toThrow('weicht');
    expect(await database.client.invoice.findUnique({ where: { id: document.id } })).not.toBeNull();
  });
});
