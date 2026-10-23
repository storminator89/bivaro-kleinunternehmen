import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { inferBankCsvMapping, parseBankCsv, MAX_BANK_CSV_BYTES } from '@/lib/bank-csv';
import { bankImportOriginalBase64, resolveBankImportReceipt, saveBankImport, loadBankImportReceipt } from '@/lib/bank-import-client';
import { BankImportReceiptSummary } from '@/components/bank-csv/bank-import-panel';
import { BANK_IMPORT_MAPPING_VERSION, BANK_IMPORT_PARSER_VERSION, type BankImportReceipt } from '@/lib/bank-import-contract';

const source = 'Datum;Betrag;Währung\n22.10.2026;0,01;EUR';
const mapping = { ...inferBankCsvMapping(parseBankCsv(source).headers), accountAlias: 'Synthetisches Konto' };
function request() { return { requestId: randomUUID(), originalBase64: Buffer.from(source).toString('base64'), delimiter: ';' as const, mapping }; }
function receipt(): BankImportReceipt { return { version: 1, id: randomUUID(), requestId: randomUUID(), savedAt: '2026-10-22T00:00:00.000Z', accountAlias: '<script>synthetisch</script>', sourceSha256: 'a'.repeat(64), sourceBytes: 100, parserVersion: BANK_IMPORT_PARSER_VERSION, mappingVersion: BANK_IMPORT_MAPPING_VERSION, counts: { total: 1, valid: 1, invalid: 0, incoming: 1, outgoing: 0, duplicates: 0, overlapRows: 0 }, totals: { incomingCents: '1', outgoingCents: '0', netCents: '1' }, period: { from: '2026-10-22', to: '2026-10-22' }, evidenceSha256: 'b'.repeat(64), sameFilePreviouslySaved: false }; }
describe('bank confirmation recovery contract', () => {
  it('sends actual bytes, strict versions/mapping and explicit consent only to same-origin endpoint', async () => {
    const input = request(), value = receipt(), fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ receipt: value, replayed: false }));
    expect(await saveBankImport(input, new AbortController().signal, fetcher)).toEqual({ receipt: value, replayed: false });
    expect(fetcher).toHaveBeenCalledTimes(1); const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('/api/bank-imports'); expect(init).toMatchObject({ method: 'POST', cache: 'no-store', credentials: 'same-origin' });
    expect(JSON.parse(String(init?.body))).toEqual({ ...input, reviewed: true, parserVersion: BANK_IMPORT_PARSER_VERSION, mappingVersion: BANK_IMPORT_MAPPING_VERSION });
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('rows'); expect(JSON.parse(String(init?.body))).not.toHaveProperty('totals');
  });
  it('recovers an unknown response by UUID with no second POST when the transaction committed', async () => {
    const input = request(), value = receipt(), fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ receipt: value }));
    expect(await resolveBankImportReceipt(input, true, new AbortController().signal, fetcher)).toEqual(value);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][0]).toBe(`/api/bank-imports?requestId=${input.requestId}`);
    expect(fetcher.mock.calls[0][1]?.method).toBe('GET');
  });
  it('uncommitted unknown result retries identical UUID/payload only after recovery returned null', async () => {
    const input = request(), value = receipt();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ receipt: null })).mockResolvedValueOnce(Response.json({ receipt: value, replayed: false }));
    expect(await resolveBankImportReceipt(input, true, new AbortController().signal, fetcher)).toEqual(value);
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'POST']);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).requestId).toBe(input.requestId);
  });
  it('fresh UUID same payload opens the already saved owned receipt instead of starting a new import/error loop', async () => {
    const input = request(), value = receipt();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ error: 'Bereits gespeichert', existingReceiptId: value.id }, { status: 409 })).mockResolvedValueOnce(Response.json({ receipt: value, rows: [], page: 0, pages: 1 }));
    expect(await resolveBankImportReceipt(input, false, new AbortController().signal, fetcher)).toEqual(value);
    expect(fetcher.mock.calls[1][0]).toBe(`/api/bank-imports/${value.id}?page=0`);
  });
  it('does not POST after failed recovery or silently replace a reused-key conflict', async () => {
    const failed = vi.fn<typeof fetch>().mockRejectedValue(new Error('synthetic transport failure'));
    await expect(resolveBankImportReceipt(request(), true, new AbortController().signal, failed)).rejects.toThrow('synthetic'); expect(failed).toHaveBeenCalledTimes(1);
    const conflict = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'Andere Auswahl' }, { status: 409 }));
    await expect(resolveBankImportReceipt(request(), false, new AbortController().signal, conflict)).rejects.toMatchObject({ status: 409 }); expect(conflict).toHaveBeenCalledTimes(1);
  });
  it('validates outer row envelopes without confusing JSON insertion order with changed immutable evidence', async () => {
    const value = receipt(), evidence = { rowNumber: 2, date: '2026-10-22', amountCents: '1', currency: 'EUR', reference: 'Synthetic\u0081memo', counterparty: '', externalId: '', errors: [], warnings: [], duplicateWarnings: [], duplicate: false, priorMatches: { external: 0, content: 0, dayAmount: 0 } };
    const row = { rowStableKey: randomUUID(), rowEvidenceHash: 'c'.repeat(64), evidence, assignmentState: 'UNASSIGNED', bindingStableKey: null, assignmentReviewReason: null, assignment: null };
    const detail = { receipt: value, rows: [Object.fromEntries(Object.entries(evidence).reverse())], rowEnvelopes: [row], assignmentCount: 0, page: 0, pages: 1 };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(detail));
    expect((await loadBankImportReceipt(value.id, 0, new AbortController().signal, fetcher)).rowEnvelopes![0].evidence).toEqual(evidence);
    const forged = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...detail, rows: [{ ...evidence, amountCents: '2' }] }));
    await expect(loadBankImportReceipt(value.id, 0, new AbortController().signal, forged)).rejects.toThrow();
    const duplicate = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...detail, rows: [evidence, evidence], rowEnvelopes: [row, row] }));
    await expect(loadBankImportReceipt(value.id, 0, new AbortController().signal, duplicate)).rejects.toThrow();
  });
  it('encodes the full bounded original without spread/Unicode corruption', () => {
    const bytes = new Uint8Array(MAX_BANK_CSV_BYTES); bytes[0] = 0xef; bytes[1] = 0xbb; bytes[2] = 0xbf; bytes[bytes.length - 1] = 0xff;
    expect(Buffer.from(bankImportOriginalBase64(bytes), 'base64').equals(Buffer.from(bytes))).toBe(true);
  });
  it('receipt UI is read-only, escapes source content and makes unallocated outcome explicit', () => {
    const html = renderToStaticMarkup(createElement(BankImportReceiptSummary, { receipt: receipt() }));
    expect(html).toContain('Import gespeichert, noch keine Zahlungen zugeordnet'); expect(html).toContain('0,01 €');
    expect(html).toContain('Dateihash (SHA-256)'); expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
    expect(html).not.toContain('<button'); expect(html).not.toContain('Zahlung erfassen');
  });
});
