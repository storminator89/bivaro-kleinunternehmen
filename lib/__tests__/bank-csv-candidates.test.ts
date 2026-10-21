import { describe, expect, it, vi } from 'vitest';
import { BANK_CSV_INVOICE_LIMIT, loadBankInvoiceCandidates } from '@/lib/bank-csv-candidates';

function identity(id: number) { return { id, type: 'INVOICE', invoiceNumber: `RE-${id}`, customer: { name: `Kunde ${id}` }, totalAmount: 999999, paymentSummary: { openCents: '99999999' }, status: 'PAID' }; }
function ledger(id: number, paidCents = '0') {
  const paid = BigInt(paidCents);
  return { currency: 'EUR', canRecordPayment: paid < BigInt(12000), legacyAdoptionRequired: false, reviewRequired: false, events: paid ? [{ id: 1, invoiceId: id, amountCents: paidCents, currency: 'EUR', paidAt: '2026-10-20T00:00:00.000Z', dateCertainty: 'ACTUAL', source: 'MANUAL', reference: `RE-${id}`, idempotencyKey: `synthetic-${id}` }] : [], ledgerVersion: 'a'.repeat(64), ledger: { version: 2, documentState: paid === BigInt(12000) ? 'PAID' : paid ? 'SENT' : 'DRAFT', originalReceivedCents: paidCents, correctedCents: '0', validReceivedCents: paidCents, refundedCents: '0', netRetainedCents: paidCents, collectibleOpenCents: (BigInt(12000) - paid).toString(), refundDueCents: '0' }, adjustments: [], adjustmentCapacities: [], canRecordAdjustment: false, adjustmentReviewReason: null, eligibleCancellationBasis: null, summary: { totalCents: '12000', paidCents, openCents: (BigInt(12000) - paid).toString(), paid: paid === BigInt(12000), paymentState: paid === BigInt(12000) ? 'PAID' : paid ? 'PARTIAL' : 'OPEN' } };
}
function adjusted(id: number, refund = false) {
  const value = ledger(id, '12000');
  return { ...value, canRecordPayment: !refund,
    ledger: { version: 2, documentState: refund ? 'CANCELLED' : 'SENT', originalReceivedCents: '12000', correctedCents: refund ? '0' : '4000', validReceivedCents: refund ? '12000' : '8000', refundedCents: refund ? '4000' : '0', netRetainedCents: '8000', collectibleOpenCents: refund ? '0' : '4000', refundDueCents: refund ? '8000' : '0' },
    summary: { totalCents: '12000', paidCents: refund ? '12000' : '8000', openCents: refund ? '0' : '4000', paid: refund, paymentState: refund ? 'PAID' : 'PARTIAL' },
    adjustments: [{ id: 9, originalPaymentId: 1, kind: refund ? 'CUSTOMER_REFUND' : 'PAYMENT_CORRECTION', amountCents: '4000', currency: 'EUR', actionDate: '2026-10-21T00:00:00.000Z', accountingEffectiveOn: refund ? '2026-10-21T00:00:00.000Z' : '2026-10-20T00:00:00.000Z', reason: 'Synthetic review', reference: 'Synthetic proof', idempotencyKey: `adjustment-${id}`, cancellationInvoiceId: refund ? 99 : null, fiscalMappingStatus: 'UNREVIEWED' }],
    adjustmentCapacities: [{ originalPaymentId: 1, correctableCents: '8000', refundableCents: refund ? '8000' : '0' }], canRecordAdjustment: true,
    eligibleCancellationBasis: refund ? { invoiceId: 99, invoiceNumber: 'ST-99' } : null,
  };
}
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
function fixture(items = [identity(1)], overrides: Record<number, () => Response | Promise<Response>> = {}, total = items.length) {
  return vi.fn<typeof fetch>(async input => {
    const url = String(input);
    if (url.startsWith('/api/invoices?')) return json({ items, total });
    const match = /^\/api\/invoices\/(\d+)\/payments$/u.exec(url);
    if (!match) throw new Error('Unexpected endpoint');
    const id = Number(match[1]);
    return overrides[id] ? overrides[id]() : json(ledger(id));
  });
}

describe('read-only bank invoice candidate adapter', () => {
  it('uses exact checked journal cents instead of list status, amount or client sums', async () => {
    const fetcher = fixture([identity(1)], { 1: () => json(ledger(1, '4000')) });
    const value = await loadBankInvoiceCandidates(new AbortController().signal, fetcher);
    expect(value).toMatchObject({ checked: 1, unavailable: 0, truncated: false, invoices: [{ id: 1, currency: 'EUR', openCents: '8000', canRecordPayment: true, paymentReviewRequired: false, existingPayments: [{ source: 'MANUAL', amountCents: '4000', reference: 'RE-1' }] }] });
    for (const [url, init] of fetcher.mock.calls) {
      expect(String(url)).toMatch(/^\/api\/invoices(?:\?|\/)/u);
      expect(init).toMatchObject({ method: 'GET', cache: 'no-store', credentials: 'same-origin' });
      expect(init?.headers).toEqual({ 'X-Bivaro-Payment-Contract': '2' });
      expect(init?.body).toBeUndefined();
    }
    expect(fetcher.mock.calls[1][1]?.headers).toEqual({ 'X-Bivaro-Payment-Contract': '2' });
  });
  it('keeps paid journals available only as existing-payment evidence, never new capacity', async () => {
    const value = await loadBankInvoiceCandidates(new AbortController().signal, fixture([identity(1)], { 1: () => json(ledger(1, '12000')) }));
    expect(value.invoices[0]).toMatchObject({ canRecordPayment: false, openCents: '0', existingPayments: [{ amountCents: '12000' }] });
  });
  it('returns a clear empty result when there are no invoices', async () => {
    const fetcher = fixture([]);
    expect(await loadBankInvoiceCandidates(new AbortController().signal, fetcher)).toEqual({ invoices: [], reviewInvoices: [], checked: 0, unavailable: 0, truncated: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('ignores quotes, credit notes and unnumbered drafts instead of inventing invoice identities', async () => {
    const items = [identity(1), { ...identity(2), type: 'QUOTE' }, { ...identity(3), type: 'CREDIT_NOTE' }, { ...identity(4), invoiceNumber: '' }];
    const fetcher = fixture(items);
    expect((await loadBankInvoiceCandidates(new AbortController().signal, fetcher)).checked).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([null, {}, { items: [], total: '0' }, { items: [], total: -1 }, { items: [identity(1)], total: 0 }, { items: [identity(1), identity(1)], total: 2 }, { items: [{ ...identity(1), id: -1 }], total: 1 }, { items: [null], total: 1 }, { items: Array.from({ length: 101 }, (_, i) => identity(i + 1)), total: 101 }])('rejects malformed or unbounded list projections: %j', async value => {
    await expect(loadBankInvoiceCandidates(new AbortController().signal, vi.fn<typeof fetch>(async () => json(value)))).rejects.toThrow(/Rechnungsliste/u);
  });
  it.each([401, 403])('reports expired list authentication (%i) without requesting journals', async status => {
    const fetcher = vi.fn<typeof fetch>(async () => json({}, status));
    await expect(loadBankInvoiceCandidates(new AbortController().signal, fetcher)).rejects.toThrow(/Sitzung/u);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('reports an unreachable list without clearing the local preview', async () => {
    await expect(loadBankInvoiceCandidates(new AbortController().signal, vi.fn<typeof fetch>(async () => json({}, 503)))).rejects.toThrow(/Vorschau bleibt erhalten/u);
  });
  it('fails closed for unavailable v2 projections and reports incomplete comparison', async () => {
    const value = await loadBankInvoiceCandidates(new AbortController().signal, fixture([identity(1), identity(2)], { 2: () => json({ code: 'PAYMENT_CAPABILITY_REQUIRED' }, 409) }, 201));
    expect(value).toMatchObject({ checked: 1, unavailable: 1, truncated: true });
    expect(value.invoices.map(row => row.id)).toEqual([1]);
  });
  it.each([false, true])('keeps validated correction/refund history explicitly review-only (refund=%s)', async refund => {
    const value = await loadBankInvoiceCandidates(new AbortController().signal, fixture([identity(1), identity(2)], { 2: () => json(adjusted(2, refund)) }));
    expect(value).toMatchObject({ checked: 2, unavailable: 0, reviewInvoices: [{ id: 2, invoiceNumber: 'RE-2' }] });
    expect(value.invoices.map(row => row.id)).toEqual([1]);
    expect(value.invoices.some(row => row.id === 2)).toBe(false); // Raw originals cannot become new receipt evidence.
  });
  it('does not call an all-adjusted but fully checked comparison an outage or invent collectible debt', async () => {
    const value = await loadBankInvoiceCandidates(new AbortController().signal, fixture([identity(1)], { 1: () => json(adjusted(1, true)) }));
    expect(value).toEqual({ invoices: [], reviewInvoices: [{ id: 1, invoiceNumber: 'RE-1' }], checked: 1, unavailable: 0, truncated: false });
  });
  it('requires the v2 ledger and full adjustment projection rather than silently falling back to v1', async () => {
    const { ledger: _ledger, ledgerVersion: _version, ...old } = ledger(1);
    await expect(loadBankInvoiceCandidates(new AbortController().signal, fixture([identity(1)], { 1: () => json(old) }))).rejects.toThrow(/nicht sicher geprüft/u);
  });
  it.each([
    () => ({ ...ledger(2), currency: 'USD' }),
    () => ({ ...ledger(2), reviewRequired: true }),
    () => ({ ...ledger(2), legacyAdoptionRequired: true }),
    () => ({ ...ledger(2, '4000'), events: [] }),
    () => ({ ...ledger(2, '4000'), events: [{ ...ledger(2, '4000').events[0], invoiceId: 999 }] }),
    () => ({ ...ledger(2), summary: { ...ledger(2).summary, openCents: '11999' } }),
    () => ({ ...ledger(2), ledgerVersion: 'invalid' }),
    () => ({ ...ledger(2), adjustments: null }),
    () => ({ ...ledger(2), adjustmentCapacities: null }),
  ])('excludes unsupported, inconsistent or other-invoice journal data', async mutate => {
    const value = await loadBankInvoiceCandidates(new AbortController().signal, fixture([identity(1), identity(2)], { 2: () => json(mutate()) }));
    expect(value).toMatchObject({ checked: 1, unavailable: 1 });
  });
  it('keeps usable checked invoices when one journal fails, but never pretends all were checked', async () => {
    const value = await loadBankInvoiceCandidates(new AbortController().signal, fixture([identity(1), identity(2)], { 2: () => { throw new Error('offline'); } }));
    expect(value).toMatchObject({ checked: 1, unavailable: 1 });
  });
  it('gives a retryable error when no requested journal can be verified', async () => {
    await expect(loadBankInvoiceCandidates(new AbortController().signal, fixture([identity(1)], { 1: () => json({}, 409) }))).rejects.toThrow(/Vorschau bleibt erhalten/u);
  });
  it('propagates a session expiration on journal reads rather than showing an empty comparison', async () => {
    await expect(loadBankInvoiceCandidates(new AbortController().signal, fixture([identity(1)], { 1: () => json({}, 401) }))).rejects.toThrow(/Sitzung/u);
  });
  it('stops before reading journals when cancelled', async () => {
    const controller = new AbortController(); controller.abort();
    const fetcher = fixture();
    await expect(loadBankInvoiceCandidates(controller.signal, fetcher)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('bounds concurrent journal reads to four and consistently orders verified results', async () => {
    let active = 0, maximum = 0;
    const fetcher = vi.fn<typeof fetch>(async input => {
      if (String(input).includes('?')) return json({ items: Array.from({ length: 9 }, (_, i) => identity(i + 1)), total: 9 });
      const id = Number(String(input).split('/')[3]);
      maximum = Math.max(maximum, ++active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--; return json(ledger(id));
    });
    const value = await loadBankInvoiceCandidates(new AbortController().signal, fetcher);
    expect(maximum).toBe(4); expect(value.invoices.map(row => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(BANK_CSV_INVOICE_LIMIT).toBe(100);
  });
});
