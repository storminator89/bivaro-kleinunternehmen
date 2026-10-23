import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { loadBankAllocationPreflight, loadBankReallocationPreflight, readBankAllocationPreflight, readBankAllocationRowEnvelope, resolveBankPayment, resolveBankReallocation } from '@/lib/bank-allocation-client';
import type { BankAllocationRowEnvelope, BankAllocationPreflight, BankPaymentOperationReceipt, BankRecordPaymentInput, BankReallocationInput, BankReallocationOperationReceipt } from '@/lib/bank-allocation-contract';
const rowKey = randomUUID(), bindingKey = randomUUID(), changeKey = randomUUID();
const invoice = (invoiceId = 1) => ({ invoiceId, invoiceNumber: `RE-${invoiceId}`, customerName: 'Synthetisch', ledgerVersion: 'a'.repeat(64), totalCents: '12000', paidCents: '4000', openCents: '8000' });
function row(assigned = true): BankAllocationRowEnvelope { return { rowStableKey: rowKey, assignmentState: assigned ? 'ASSIGNED' : 'UNASSIGNED', bindingStableKey: assigned ? bindingKey : null, assignmentReviewReason: null, rowEvidenceHash: 'b'.repeat(64), evidence: { rowNumber: 2, date: '2026-10-20', amountCents: '4000', currency: 'EUR', counterparty: 'Private bank party', reference: 'Private bank memo', externalId: 'Private bank ID', errors: [], warnings: [], duplicateWarnings: [], duplicate: false, priorMatches: { external: 0, content: 0, dayAmount: 0 } }, assignment: assigned ? { bindingStableKey: bindingKey, originalPaymentId: 9, originInvoiceId: 1, originInvoiceNumber: 'RE-1', allocatedInvoice: invoice(2), allocationRevision: 1, allocationChangeStableKey: changeKey, amountCents: '4000', currency: 'EUR', paidAt: '2026-10-20T00:00:00.000Z', canReallocate: true, reallocationReviewReason: null } : null }; }
const initial = (): BankRecordPaymentInput => ({ invoiceId: 1, idempotencyKey: randomUUID(), expectedLedgerVersion: 'a'.repeat(64), expectedRowEvidenceHash: 'b'.repeat(64), reviewed: true, receiptConfirmed: true });
const move = (): BankReallocationInput => ({ invoiceId: 2, idempotencyKey: randomUUID(), expectedAllocationRevision: 0, expectedSourceLedgerVersion: 'a'.repeat(64), expectedTargetLedgerVersion: 'b'.repeat(64), actionDate: '2026-10-22', reason: 'Falsche Rechnung.', cashNeutralReviewed: true });
function paymentOperation(input: BankRecordPaymentInput): BankPaymentOperationReceipt { return { kind: 'BANK_PAYMENT_RECORDED', idempotencyKey: input.idempotencyKey, bindingStableKey: bindingKey, rowStableKey: rowKey, originalPaymentId: 9, originInvoiceId: 1, originInvoiceNumber: 'RE-1', amountCents: '4000', currency: 'EUR', paidAt: '2026-10-20T00:00:00.000Z', recordedAt: '2026-10-21T00:00:00.000Z', expectedLedgerVersion: input.expectedLedgerVersion, expectedRowEvidenceHash: input.expectedRowEvidenceHash }; }
function moveOperation(input: BankReallocationInput): BankReallocationOperationReceipt { return { kind: 'PAYMENT_ALLOCATION_CHANGED', idempotencyKey: input.idempotencyKey, bindingStableKey: bindingKey, changeStableKey: changeKey, revision: 1, fromInvoiceId: 1, fromInvoiceNumber: 'RE-1', toInvoiceId: 2, toInvoiceNumber: 'RE-2', amountCents: '4000', currency: 'EUR', actionDate: input.actionDate, reason: input.reason, recordedAt: '2026-10-22T00:00:00.000Z', expectedSourceLedgerVersion: input.expectedSourceLedgerVersion, expectedTargetLedgerVersion: input.expectedTargetLedgerVersion }; }
function preflight(): BankAllocationPreflight { return { version: 1, row: row(false), invoices: [invoice(1)], nextCursor: null, selection: invoice(1), canConfirm: true, reviewReasons: [], afterOpenCents: '4000', sourceAfterOpenCents: null }; }
const signal = () => new AbortController().signal;
describe('bank allocation live envelope and recovery client', () => {
  it('keeps the full bank memo in immutable evidence and current assignment outside it', () => { const value = readBankAllocationRowEnvelope(row()); expect(value.evidence.reference).toBe('Private bank memo'); expect(value.evidence).not.toHaveProperty('assignment'); expect(value.assignment).toMatchObject({ originInvoiceId: 1, allocatedInvoice: { invoiceId: 2 }, allocationRevision: 1 }); });
  it('retains bounded immutable CSV text exactly rather than applying command-text rules to historical evidence', () => { const value = row(false); value.evidence.reference = 'Synthetic\u0081memo'; expect(readBankAllocationRowEnvelope(value).evidence.reference).toBe(value.evidence.reference); });
  it('accepts a cancelled current invoice without incorrectly treating its zero collectible open as a v2 total equation', () => { const value = row(); value.assignment!.allocatedInvoice.openCents = '0'; expect(readBankAllocationRowEnvelope(value)).toEqual(value); });
  it.each([
    () => ({ ...row(), rowStableKey: 'private memo' }),
    () => ({ ...row(), assignmentState: undefined }),
    () => ({ ...row(), assignmentState: 'UNASSIGNED' }),
    () => ({ ...row(), assignmentState: 'REVIEW_REQUIRED', assignment: null }),
    () => ({ ...row(), rowEvidenceHash: 'bad' }),
    () => ({ ...row(), assignment: { ...row().assignment!, amountCents: '9007199254740992' } }),
    () => ({ ...row(), assignment: { ...row().assignment!, allocatedInvoice: { ...invoice(), openCents: '12001' } } }),
    () => ({ ...row(), assignment: { ...row().assignment!, allocationRevision: 0 } }),
    () => ({ ...row(), assignment: { ...row().assignment!, currency: 'USD' } }),
    () => ({ ...row(), assignment: { ...row().assignment!, canReallocate: false } }),
    () => ({ ...row(), evidence: { ...row().evidence, bindingStableKey: bindingKey } }),
  ])('fails closed on forged envelope/closed evidence', mutate => { expect(() => readBankAllocationRowEnvelope(mutate())).toThrow(); });
  it('keeps inconsistent existing assignments explicitly review-only, not unassigned/bookable', () => { const value = { ...row(), assignmentState: 'REVIEW_REQUIRED', assignment: null, assignmentReviewReason: 'Bitte die bestehende Zuordnung prüfen.' }; expect(readBankAllocationRowEnvelope(value).assignmentState).toBe('REVIEW_REQUIRED'); expect(() => readBankAllocationPreflight({ ...preflight(), row: value })).toThrow(); });
  it('bounds and checks preflight instead of casting money/action authority', () => { expect(readBankAllocationPreflight(preflight())).toEqual(preflight()); expect(() => readBankAllocationPreflight({ ...preflight(), reviewReasons: ['Prüfen'] })).toThrow(); expect(() => readBankAllocationPreflight({ ...preflight(), invoices: Array(21).fill(invoice()) })).toThrow(); });
  it('keeps free-text manual search in a read-only POST body, without cash or operation payload', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(preflight()));
    await loadBankAllocationPreflight(rowKey, { search: 'RE-OLD', invoiceId: 5000 }, signal(), fetcher);
    expect(fetcher.mock.calls[0][0]).toBe(`/api/bank-imports/rows/${rowKey}/allocation/preflight`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { 'X-Bivaro-Payment-Contract': '3' } });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ search: 'RE-OLD', cursor: 0, invoiceId: 5000 });
    await loadBankReallocationPreflight(bindingKey, { cursor: 20 }, signal(), fetcher);
    expect(fetcher.mock.calls[1][0]).toBe(`/api/bank-allocations/${bindingKey}/preflight`);
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('Private bank');
  });
  it('recovers original success after a later move and truthfully returns current assignment with no POST', async () => {
    const input = initial(), operation = paymentOperation(input), current = row(), fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ operation, row: current }));
    const result = await resolveBankPayment(rowKey, input, true, signal(), fetcher);
    expect(result).toMatchObject({ replayed: true, operation: { originInvoiceId: 1 }, row: { assignment: { allocatedInvoice: { invoiceId: 2 } } } });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][1]?.method).toBe('GET'); expect(fetcher.mock.calls[0][0]).toBe(`/api/bank-imports/rows/${rowKey}/allocation?idempotencyKey=${input.idempotencyKey}`);
  });
  it('retries an unchanged initial key/payload only after recovery proved no operation', async () => {
    const input = initial(), fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ operation: null, row: row(false) })).mockResolvedValueOnce(Response.json({ operation: paymentOperation(input), row: row(), replayed: false }));
    await resolveBankPayment(rowKey, input, true, signal(), fetcher);
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'POST']); expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual(input);
  });
  it('does not accept a reused initial key with different historical version tokens during GET recovery', async () => {
    const input = initial(), fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ operation: paymentOperation(input), row: row() }));
    await expect(resolveBankPayment(rowKey, { ...input, expectedLedgerVersion: 'c'.repeat(64) }, true, signal(), fetcher)).rejects.toMatchObject({ code: 'BANK_ALLOCATION_RESPONSE_INVALID' }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('never POSTs after failed recovery or a mismatched operation/row', async () => {
    const input = initial(), fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ operation: paymentOperation({ ...input, idempotencyKey: randomUUID() }), row: row() }));
    await expect(resolveBankPayment(rowKey, input, true, signal(), fetcher)).rejects.toMatchObject({ code: 'BANK_ALLOCATION_RESPONSE_INVALID' }); expect(fetcher).toHaveBeenCalledTimes(1);
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new Error('Synthetic network failure'));
    await expect(resolveBankPayment(rowKey, input, true, signal(), offline)).rejects.toThrow('network'); expect(offline).toHaveBeenCalledTimes(1);
  });
  it('recovers a historical move independently of later current assignment', async () => {
    const input = move(), current = row(); current.assignment!.allocationRevision = 2; current.assignment!.allocatedInvoice = invoice(3); current.assignment!.allocationChangeStableKey = randomUUID();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ operation: moveOperation(input), row: current }));
    const result = await resolveBankReallocation(bindingKey, input, true, signal(), fetcher);
    expect(result).toMatchObject({ operation: { toInvoiceId: 2, revision: 1 }, row: { assignment: { allocatedInvoice: { invoiceId: 3 }, allocationRevision: 2 } }, replayed: true }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not accept a reused move key with altered target token during recovery', async () => {
    const input = move(), fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ operation: moveOperation(input), row: row() }));
    await expect(resolveBankReallocation(bindingKey, { ...input, expectedTargetLedgerVersion: 'c'.repeat(64) }, true, signal(), fetcher)).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not treat same key/different move as success or submit again', async () => { const input = move(), fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ operation: { ...moveOperation(input), reason: 'Anders' }, row: row() })); await expect(resolveBankReallocation(bindingKey, input, true, signal(), fetcher)).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1); });
  it('rejects non-opaque recovery paths before fetching', async () => { const input = initial(), fetcher = vi.fn<typeof fetch>(); await expect(resolveBankPayment('private bank memo', input, true, signal(), fetcher)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled(); });
});
