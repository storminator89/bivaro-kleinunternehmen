import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient, Prisma } from '@prisma/client';
import { createTestDatabase } from './helpers/database';
import { inferBankCsvMapping, parseBankCsv } from '@/lib/bank-csv';
import { confirmBankImport, readBankImport } from '@/lib/bank-import-service';
import { BANK_IMPORT_MAPPING_VERSION, BANK_IMPORT_PARSER_VERSION } from '@/lib/bank-import-contract';
import { preflightBankPayment, preflightBankReallocation, recordBankPayment, reallocateBankPayment, recoverBankPayment } from '@/lib/bank-allocation-service';
import { readInvoicePaymentJournal, recordFullPayment } from '@/lib/payment-journal/service';
import { recordPaymentAdjustment } from '@/lib/payment-journal/adjustment-service';
import type { BankAllocationPreflight, BankRecordPaymentInput, BankReallocationInput } from '@/lib/bank-allocation-contract';
import { generateZugferdXml } from '@/lib/zugferd-generator';
import { loadInvoicePaymentState } from '@/lib/payment-journal/allocation-ledger';
import { assertAllocationInvoice } from '@/lib/payment-journal/allocation-evidence';
import { parseEInvoiceXml } from '@/lib/e-invoice-parser';
import { recoverBankReallocation } from '@/lib/bank-allocation-service';
import { GET, POST } from '@/app/api/bank-imports/rows/[id]/allocation/route';
import { POST as preflightPOST } from '@/app/api/bank-imports/rows/[id]/allocation/preflight/route';
import { POST as changePOST } from '@/app/api/bank-allocations/[id]/changes/route';
const state = vi.hoisted(() => ({ client: null as PrismaClient | null, userId: null as string | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => { class UnauthorizedError extends Error {} return { UnauthorizedError, requireUserId: async () => { if (!state.userId) throw new UnauthorizedError(); return state.userId; }, unauthorizedResponse: () => new Response(null, { status: 401 }) }; });
let db: ReturnType<typeof createTestDatabase>, sequence = 0;
beforeAll(() => { db = createTestDatabase(); state.client = db.client; }, 40_000);
afterAll(async () => { await db?.cleanup(); });
async function fixture() {
  const userId = `bank-flow-${++sequence}`;
  await db.client.user.create({ data: { id: userId, email: `${userId}@test.invalid`, password: 'Synthetic fixture only' } });
  const customer = await db.client.customer.create({ data: { userId, name: 'Synthetic customer' } });
  async function invoice(name: string, extra: Record<string, unknown> = {}) {
    return db.client.invoice.create({ data: { userId, customerId: customer.id, invoiceNumber: `${userId}-${name}`, fileName: 'synthetic.pdf', storedFileName: 'synthetic.pdf', parsedData: { currency: 'EUR', taxMode: 'small-business', taxAmount: 0, items: [{ description: 'Synthetic', quantity: 1, unitPrice: 120, amount: 120, taxRate: 0, taxCategory: 'E' }] }, totalAmount: 120, status: 'SENT', issuanceState: 'ISSUED', ...extra } });
  }
  const a = await invoice('A'), b = await invoice('B'), c = await invoice('C');
  async function saved(amount = '40,00', date = '20.10.2026', memo = 'Synthetic memo', alias = 'Synthetic own account') {
    const source = `Datum;Betrag;Währung;Verwendungszweck;Umsatz-ID\n${date};${amount};EUR;${memo};${randomUUID()}`;
    const result = await confirmBankImport(userId, { requestId: randomUUID(), originalBase64: Buffer.from(source).toString('base64'), delimiter: ';', mapping: { ...inferBankCsvMapping(parseBankCsv(source).headers), accountAlias: alias }, parserVersion: BANK_IMPORT_PARSER_VERSION, mappingVersion: BANK_IMPORT_MAPPING_VERSION, reviewed: true });
    const detail = await readBankImport(userId, result.receipt.id, 0);
    return { receipt: result.receipt, row: detail.rowEnvelopes![0], detail };
  }
  async function initial(row: string, invoiceId = a.id): Promise<BankRecordPaymentInput> { const preflight = await preflightBankPayment(userId, row, { invoiceId }); return initialInput(preflight, invoiceId); }
  async function change(binding: string, invoiceId = b.id): Promise<BankReallocationInput> { const preflight = await preflightBankReallocation(userId, binding, { invoiceId }); return changeInput(preflight, invoiceId); }
  return { userId, customer, a, b, c, invoice, saved, initial, change };
}
function initialInput(preflight: BankAllocationPreflight, invoiceId: number): BankRecordPaymentInput { return { invoiceId, idempotencyKey: randomUUID(), expectedLedgerVersion: preflight.selection!.ledgerVersion, expectedRowEvidenceHash: preflight.row.rowEvidenceHash, reviewed: true, receiptConfirmed: true }; }
function changeInput(preflight: BankAllocationPreflight, invoiceId: number): BankReallocationInput { return { invoiceId, idempotencyKey: randomUUID(), expectedAllocationRevision: preflight.row.assignment!.allocationRevision, expectedSourceLedgerVersion: preflight.row.assignment!.allocatedInvoice.ledgerVersion, expectedTargetLedgerVersion: preflight.selection!.ledgerVersion, actionDate: '2026-10-22', reason: 'Synthetic wrong invoice selected.', cashNeutralReviewed: true }; }
async function counts(userId: string) { return Promise.all([db.client.income.count({ where: { userId } }), db.client.paymentJournalEvent.count({ where: { userId } }), db.client.bankPaymentBinding.count({ where: { userId } }), db.client.paymentAllocationChange.count({ where: { userId } }), db.client.paymentOperation.count({ where: { userId } }), db.client.paymentAdjustment.count({ where: { userId } }), db.client.auditLog.count({ where: { userId } })]); }
function invoiceXml(invoiceNumber: string): string {
  return generateZugferdXml({ invoiceNumber, date: new Date('2026-10-01'), dueDate: new Date('2026-10-15'), currency: 'EUR', taxMode: 'small-business',
    seller: { name: 'Synthetic seller', address: 'Example 1\n10000 Berlin', countryCode: 'DE', email: 'seller@test.invalid', taxNumber: 'synthetic', iban: 'DE89370400440532013000' },
    buyer: { name: 'Synthetic customer', address: 'Example 2', zipCode: '10000', city: 'Berlin', countryCode: 'DE', email: 'buyer@test.invalid' },
    items: [{ description: 'Synthetic service', quantity: 1, unitPrice: 120, total: 120, unit: 'Stück', taxRate: 0 }], netAmount: 120, taxAmount: 0 });
}
async function parsedInvoiceXml(invoiceNumber: string) { return JSON.parse(JSON.stringify(await parseEInvoiceXml(invoiceXml(invoiceNumber)))) as Prisma.InputJsonObject; }
async function cancel(f: Awaited<ReturnType<typeof fixture>>, invoiceId: number) {
  const source = await db.client.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const basis = await db.client.invoice.create({ data: { userId: f.userId, customerId: f.customer.id, type: 'CREDIT_NOTE', originalInvoiceId: invoiceId, invoiceNumber: `${f.userId}-STORNO-${invoiceId}`, fileName: 'synthetic-cancellation.pdf', storedFileName: 'synthetic-cancellation.pdf', parsedData: { currency: 'EUR', taxMode: 'small-business', taxAmount: 0 }, totalAmount: -source.totalAmount!, status: 'SENT', issuanceState: 'ISSUED', invoiceDate: new Date('2026-10-21'), cancellationReason: 'Synthetic full cancellation' } });
  await db.client.invoice.update({ where: { id: invoiceId }, data: { status: 'CANCELLED', cancellationReason: 'Synthetic full cancellation' } });
  return basis;
}
describe('bank recording and cash-neutral whole allocation using the shared journal', () => {
  it('import and canceled/read-only previews create no money; a confirmed 40 EUR on 120 EUR creates exactly one receipt/Income/binding', async () => {
    const f = await fixture(), saved = await f.saved('40,00', '20.10.2026', 'M'.repeat(2000)), before = await counts(f.userId);
    expect(before.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
    const preflight = await preflightBankPayment(f.userId, saved.row.rowStableKey, { invoiceId: f.a.id });
    expect(preflight).toMatchObject({ canConfirm: true, afterOpenCents: '8000', selection: { totalCents: '12000', openCents: '12000' } }); expect(await counts(f.userId)).toEqual(before);
    const input = initialInput(preflight, f.a.id), recorded = await recordBankPayment(f.userId, saved.row.rowStableKey, input);
    expect(recorded).toMatchObject({ replayed: false, operation: { kind: 'BANK_PAYMENT_RECORDED', amountCents: '4000' }, row: { assignment: { originInvoiceId: f.a.id, allocationRevision: 0, allocatedInvoice: { invoiceId: f.a.id, paidCents: '4000', openCents: '8000' } } } });
    expect((await counts(f.userId)).map((value, index) => value - before[index])).toEqual([1, 1, 1, 0, 1, 0, 1]);
    const root = await db.client.paymentJournalEvent.findFirstOrThrow({ where: { userId: f.userId } }); expect(root.reference).toBe(`bank-row:${saved.row.rowStableKey}`); expect(root.reference.length).toBeLessThanOrEqual(255); expect(root.source).toBe('MANUAL');
    const afterDetail = await readBankImport(f.userId, saved.receipt.id, 0); expect(afterDetail.assignmentCount).toBe(1); expect(afterDetail.receipt).toEqual(saved.receipt); expect(afterDetail.rows).toEqual(saved.detail.rows); expect(afterDetail.rows[0].reference).toHaveLength(2000);
    const audit = await db.client.auditLog.findFirstOrThrow({ where: { userId: f.userId, action: 'PAYMENT_RECEIVED' } }); expect(JSON.stringify(audit)).not.toContain('M'.repeat(100));
  });
  it('A -> B -> A changes versions, never cash/root dates, and old replay reports current assignment truthfully', async () => {
    const f = await fixture(), saved = await f.saved(), input = await f.initial(saved.row.rowStableKey), original = await recordBankPayment(f.userId, saved.row.rowStableKey, input), binding = original.row.assignment!.bindingStableKey;
    const root = await db.client.paymentJournalEvent.findFirstOrThrow({ where: { userId: f.userId } }), income = await db.client.income.findFirstOrThrow({ where: { userId: f.userId } }), initialVersion = original.row.assignment!.allocatedInvoice.ledgerVersion;
    const firstMoveInput = await f.change(binding), moved = await reallocateBankPayment(f.userId, binding, firstMoveInput);
    expect(moved.row.assignment).toMatchObject({ allocatedInvoice: { invoiceId: f.b.id, paidCents: '4000', openCents: '8000' }, allocationRevision: 1 });
    expect((await readInvoicePaymentJournal(f.userId, f.a.id, 3)).summary).toMatchObject({ paidCents: '0', openCents: '12000' });
    expect((await recordBankPayment(f.userId, saved.row.rowStableKey, input))).toMatchObject({ replayed: true, operation: { originInvoiceId: f.a.id }, row: { assignment: { allocatedInvoice: { invoiceId: f.b.id } } } });
    await expect(recordBankPayment(f.userId, saved.row.rowStableKey, { ...input, expectedLedgerVersion: 'c'.repeat(64) })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const back = await reallocateBankPayment(f.userId, binding, await f.change(binding, f.a.id)); expect(back.row.assignment!.allocatedInvoice.ledgerVersion).not.toBe(initialVersion); expect(back.row.assignment!.allocationRevision).toBe(2);
    expect(await db.client.paymentJournalEvent.findUnique({ where: { id: root.id } })).toEqual(root); expect(await db.client.income.findUnique({ where: { id: income.id } })).toEqual(income);
    expect((await counts(f.userId)).slice(0, 6)).toEqual([1, 1, 1, 2, 3, 0]);
    expect(await reallocateBankPayment(f.userId, binding, firstMoveInput)).toMatchObject({ replayed: true, operation: { toInvoiceId: f.b.id, revision: 1 }, row: { assignment: { allocatedInvoice: { invoiceId: f.a.id }, allocationRevision: 2 } } });
  });
  it('same-key/different-key initial races cannot duplicate cash and same-key different intent conflicts', async () => {
    const f = await fixture(), saved = await f.saved(), input = await f.initial(saved.row.rowStableKey);
    const results = await Promise.all([recordBankPayment(f.userId, saved.row.rowStableKey, input), recordBankPayment(f.userId, saved.row.rowStableKey, input)]);
    expect(results.filter(result => !result.replayed)).toHaveLength(1); expect((await counts(f.userId)).slice(0, 3)).toEqual([1, 1, 1]);
    await expect(recordBankPayment(f.userId, saved.row.rowStableKey, { ...input, invoiceId: f.b.id })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const g = await fixture(), other = await g.saved(), command = await g.initial(other.row.rowStableKey);
    const race = await Promise.allSettled([recordBankPayment(g.userId, other.row.rowStableKey, command), recordBankPayment(g.userId, other.row.rowStableKey, { ...command, idempotencyKey: randomUUID() })]);
    expect(race.filter(result => result.status === 'fulfilled')).toHaveLength(1); expect(race.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'BANK_ROW_ALREADY_BOUND' } }); expect((await counts(g.userId)).slice(0, 3)).toEqual([1, 1, 1]);
  });
  it('reserves operation-less historical manual root keys across initial/move commands and recovery', async () => {
    const f = await fixture(), historical = await f.invoice('HISTORICAL'), oldKey = randomUUID();
    const income = await db.client.income.create({ data: { userId: f.userId, customerId: f.customer.id, invoiceId: historical.id, amount: 10, date: new Date('2026-10-19'), description: 'Synthetic operation-less historical receipt' } });
    await db.client.paymentJournalEvent.create({ data: { userId: f.userId, invoiceId: historical.id, incomeId: income.id, amountCents: '1000', currency: 'EUR', paidAt: new Date('2026-10-19'), dateCertainty: 'ACTUAL', source: 'MANUAL', reference: 'Synthetic historical evidence', idempotencyKey: oldKey } });
    expect(await db.client.paymentOperation.findUnique({ where: { userId_idempotencyKey: { userId: f.userId, idempotencyKey: oldKey } } })).toBeNull();
    const saved = await f.saved(), input = await f.initial(saved.row.rowStableKey), before = await counts(f.userId);
    await expect(recordBankPayment(f.userId, saved.row.rowStableKey, { ...input, idempotencyKey: oldKey })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(recoverBankPayment(f.userId, saved.row.rowStableKey, oldKey)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' }); expect(await counts(f.userId)).toEqual(before);
    const recorded = await recordBankPayment(f.userId, saved.row.rowStableKey, input), binding = recorded.row.assignment!.bindingStableKey, move = await f.change(binding), beforeMove = await counts(f.userId);
    await expect(reallocateBankPayment(f.userId, binding, { ...move, idempotencyKey: oldKey })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(recoverBankReallocation(f.userId, binding, oldKey)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' }); expect(await counts(f.userId)).toEqual(beforeMove);
  });
  it('same-head moves serialize to one revision and loser must review PAYMENT_STATE_CHANGED', async () => {
    const f = await fixture(), saved = await f.saved(), initial = await recordBankPayment(f.userId, saved.row.rowStableKey, await f.initial(saved.row.rowStableKey)), binding = initial.row.assignment!.bindingStableKey;
    const b = await f.change(binding, f.b.id), c = await f.change(binding, f.c.id);
    const race = await Promise.allSettled([reallocateBankPayment(f.userId, binding, b), reallocateBankPayment(f.userId, binding, c)]);
    expect(race.filter(result => result.status === 'fulfilled')).toHaveLength(1); expect(race.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'PAYMENT_STATE_CHANGED' } }); expect((await counts(f.userId)).slice(0, 6)).toEqual([1, 1, 1, 1, 2, 0]);
  });
  it('unconditional ledger/row version, issued state and closed no-money inputs reject without partial writes', async () => {
    const f = await fixture(), saved = await f.saved(), input = await f.initial(saved.row.rowStableKey), before = await counts(f.userId);
    await expect(recordBankPayment(f.userId, saved.row.rowStableKey, { ...input, expectedLedgerVersion: 'c'.repeat(64) })).rejects.toMatchObject({ code: 'PAYMENT_STATE_CHANGED' });
    await expect(recordBankPayment(f.userId, saved.row.rowStableKey, { ...input, expectedRowEvidenceHash: 'c'.repeat(64) })).rejects.toMatchObject({ code: 'BANK_ROW_STATE_CHANGED' });
    await expect(recordBankPayment(f.userId, saved.row.rowStableKey, { ...input, amount: '120.00' })).rejects.toThrow();
    await db.client.invoice.update({ where: { id: f.a.id }, data: { issuanceState: 'UNISSUED', status: 'DRAFT' } });
    await expect(recordBankPayment(f.userId, saved.row.rowStableKey, input)).rejects.toThrow(); expect(await counts(f.userId)).toEqual(before);
  });
  it('current later overlap blocks a new receipt without rewriting historic evidence/hash', async () => {
    const f = await fixture(), saved = await f.saved(), original = structuredClone(saved.row.evidence), input = await f.initial(saved.row.rowStableKey);
    await f.saved('40,00', '20.10.2026', 'Another export');
    const checked = await preflightBankPayment(f.userId, saved.row.rowStableKey, { invoiceId: f.a.id }); expect(checked.canConfirm).toBe(false); expect(checked.reviewReasons.join(' ')).toContain('überschneidet');
    expect(checked.row.evidence).toEqual(original); expect(checked.row.rowEvidenceHash).toBe(saved.row.rowEvidenceHash);
    await expect(recordBankPayment(f.userId, saved.row.rowStableKey, input)).rejects.toMatchObject({ code: 'BANK_ALLOCATION_REVIEW_REQUIRED' }); expect((await counts(f.userId)).slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
  });
  it('later overlapping evidence does not erase a bound receipt or prevent its cash-neutral allocation change', async () => {
    const f = await fixture(), saved = await f.saved(), input = await f.initial(saved.row.rowStableKey), initial = await recordBankPayment(f.userId, saved.row.rowStableKey, input);
    await f.saved('40,00', '20.10.2026', 'Synthetic later overlapping export');
    expect((await recordBankPayment(f.userId, saved.row.rowStableKey, input)).replayed).toBe(true);
    const binding = initial.row.assignment!.bindingStableKey, preview = await preflightBankReallocation(f.userId, binding, { invoiceId: f.b.id });
    expect(preview).toMatchObject({ canConfirm: true, sourceAfterOpenCents: '12000', afterOpenCents: '8000' });
    const moved = await reallocateBankPayment(f.userId, binding, changeInput(preview, f.b.id)); expect(moved.row.assignment!.allocatedInvoice.invoiceId).toBe(f.b.id);
    expect((await counts(f.userId)).slice(0, 3)).toEqual([1, 1, 1]); expect(moved.row.evidence).toEqual(saved.row.evidence);
  });
  it('reports full-batch assignment count even when the bound row is on another evidence page', async () => {
    const f = await fixture(), source = 'Datum;Betrag;Währung\n' + Array.from({ length: 21 }, (_, index) => `20.10.2026;${index + 1},00;EUR`).join('\n');
    const saved = await confirmBankImport(f.userId, { requestId: randomUUID(), originalBase64: Buffer.from(source).toString('base64'), delimiter: ';', mapping: { ...inferBankCsvMapping(parseBankCsv(source).headers), accountAlias: 'Synthetic paginated account' }, parserVersion: BANK_IMPORT_PARSER_VERSION, mappingVersion: BANK_IMPORT_MAPPING_VERSION, reviewed: true });
    const secondPage = await readBankImport(f.userId, saved.receipt.id, 1), row = secondPage.rowEnvelopes![0];
    await recordBankPayment(f.userId, row.rowStableKey, await f.initial(row.rowStableKey));
    const firstPage = await readBankImport(f.userId, saved.receipt.id, 0);
    expect(firstPage.assignmentCount).toBe(1); expect(firstPage.rowEnvelopes!.every(value => value.assignmentState === 'UNASSIGNED')).toBe(true); expect(firstPage.receipt).toEqual(saved.receipt);
  });
  it('checks whole own manual history and keeps selected unbound manual receipts review-only even with different day/amount', async () => {
    const f = await fixture(), saved = await f.saved();
    await recordFullPayment(f.userId, f.c.id, { amount: '40.00', currency: 'EUR', paidAt: '2026-10-20', source: 'MANUAL', reference: 'Synthetic prior manual receipt', idempotencyKey: randomUUID(), expectedPaidCents: '0' });
    const checked = await preflightBankPayment(f.userId, saved.row.rowStableKey, { invoiceId: f.a.id }); expect(checked.canConfirm).toBe(false); expect(checked.reviewReasons.join(' ')).toContain('nicht bankgebundener');
    const g = await fixture(), other = await g.saved();
    const manual = await recordFullPayment(g.userId, g.a.id, { amount: '10.00', currency: 'EUR', paidAt: '2026-10-19', source: 'MANUAL', reference: 'Synthetic unrelated receipt', idempotencyKey: randomUUID(), expectedPaidCents: '0' });
    const journal = await readInvoicePaymentJournal(g.userId, g.a.id);
    await recordPaymentAdjustment(g.userId, g.a.id, { originalPaymentId: manual.event.id, kind: 'PAYMENT_CORRECTION', amount: '1.00', actionDate: '2026-10-21', reason: 'Synthetic mistaken recorded portion.', reference: 'Synthetic counter-evidence', idempotencyKey: randomUUID(), expectedLedgerVersion: journal.ledgerVersion, declarationNeverReceived: true });
    const unmatched = await preflightBankPayment(g.userId, other.row.rowStableKey, { invoiceId: g.a.id }); expect(unmatched.canConfirm).toBe(false); expect(unmatched.reviewReasons.join(' ')).toContain('Buchungsdatum und Teilbeträge');
    await expect(recordBankPayment(g.userId, other.row.rowStableKey, await g.initial(other.row.rowStableKey))).rejects.toMatchObject({ code: 'BANK_ALLOCATION_REVIEW_REQUIRED' });
    // The initial ambiguity limit does not disable the manual root's unrelated correction capability.
    expect((await readInvoicePaymentJournal(g.userId, g.a.id, 3)).canRecordAdjustment).toBe(true);
  });
  it('finds/chooses an owned eligible invoice outside latest-100 suggestions with bounded read-only pages', async () => {
    const f = await fixture(), saved = await f.saved();
    await db.client.invoice.createMany({ data: Array.from({ length: 105 }, (_, index) => ({ userId: f.userId, customerId: f.customer.id, invoiceNumber: `${f.userId}-MORE-${index}`, fileName: 'synthetic.pdf', storedFileName: 'synthetic.pdf', parsedData: { currency: 'EUR', taxMode: 'small-business', taxAmount: 0, items: [{ description: 'Synthetic', quantity: 1, unitPrice: 120, amount: 120, taxRate: 0, taxCategory: 'E' }] }, totalAmount: 120, status: 'SENT', issuanceState: 'ISSUED' })) });
    const before = await counts(f.userId), first = await preflightBankPayment(f.userId, saved.row.rowStableKey, {});
    expect(first.invoices).toHaveLength(20); expect(first.nextCursor).not.toBeNull();
    const search = await preflightBankPayment(f.userId, saved.row.rowStableKey, { search: f.a.invoiceNumber!, invoiceId: f.a.id }); expect(search.invoices.map(value => value.invoiceId)).toContain(f.a.id); expect(search.canConfirm).toBe(true); expect(await counts(f.userId)).toEqual(before);
  });
  it('denies other owner/customer/context and invalid or unsupported bank rows', async () => {
    const f = await fixture(), other = await fixture(), saved = await f.saved();
    await expect(preflightBankPayment(other.userId, saved.row.rowStableKey, {})).rejects.toMatchObject({ status: 404 });
    await expect(preflightBankPayment(f.userId, saved.row.rowStableKey, { invoiceId: other.a.id })).rejects.toMatchObject({ status: 404 });
    const initial = await recordBankPayment(f.userId, saved.row.rowStableKey, await f.initial(saved.row.rowStableKey)), binding = initial.row.assignment!.bindingStableKey;
    const differentCustomer = await db.client.customer.create({ data: { userId: f.userId, name: 'Other synthetic customer' } });
    const target = await f.invoice('DIFFERENT', { customerId: differentCustomer.id }); expect((await preflightBankReallocation(f.userId, binding, { invoiceId: target.id })).canConfirm).toBe(false);
    const standard = await f.invoice('STANDARD', { parsedData: { currency: 'EUR', taxMode: 'standard', taxAmount: 19 } }); expect((await preflightBankReallocation(f.userId, binding, { invoiceId: standard.id })).canConfirm).toBe(false);
    const negative = await other.saved('-40,00'); expect((await preflightBankPayment(other.userId, negative.row.rowStableKey, { invoiceId: other.a.id })).canConfirm).toBe(false);
  });
  it('accepts genuine uploaded/generated rawXML without taxMode and rejects mismatching XML before offering or executing initial/move confirmation', async () => {
    const f = await fixture();
    const aSource = await parsedInvoiceXml(f.a.invoiceNumber!), bSource = await parsedInvoiceXml(f.b.invoiceNumber!), cSource = await parsedInvoiceXml(f.c.invoiceNumber!);
    expect(aSource).not.toHaveProperty('taxMode');
    for (const [invoice, parsedData] of [[f.a, aSource], [f.b, bSource], [f.c, cSource]] as const) await db.client.invoice.update({ where: { id: invoice.id }, data: { parsedData } });
    const saved = await f.saved(), preflight = await preflightBankPayment(f.userId, saved.row.rowStableKey, { invoiceId: f.a.id }); expect(preflight.canConfirm).toBe(true);
    const initial = await recordBankPayment(f.userId, saved.row.rowStableKey, initialInput(preflight, f.a.id)), binding = initial.row.assignment!.bindingStableKey;
    const validMove = await preflightBankReallocation(f.userId, binding, { invoiceId: f.b.id }); expect(validMove.canConfirm).toBe(true);
    await reallocateBankPayment(f.userId, binding, changeInput(validMove, f.b.id));
    const other = await f.saved('35,00', '21.10.2026'), pending = await f.initial(other.row.rowStableKey, f.c.id), before = await counts(f.userId);
    const altered = { ...cSource, rawXml: invoiceXml(f.c.invoiceNumber!).replace('<ram:GrandTotalAmount>120.00</ram:GrandTotalAmount>', '<ram:GrandTotalAmount>140.00</ram:GrandTotalAmount>') };
    await db.client.invoice.update({ where: { id: f.c.id }, data: { parsedData: altered } });
    const state = await db.client.$transaction(tx => loadInvoicePaymentState(tx, f.userId, f.c.id));
    expect(() => assertAllocationInvoice(state.invoice)).not.toThrow(); expect(state.allocationReviewReason).not.toBeNull();
    const invalidInitial = await preflightBankPayment(f.userId, other.row.rowStableKey, { invoiceId: f.c.id }); expect(invalidInitial.canConfirm).toBe(false); expect(invalidInitial.selection).toBeNull();
    const invalidMove = await preflightBankReallocation(f.userId, binding, { invoiceId: f.c.id }); expect(invalidMove.canConfirm).toBe(false); expect(invalidMove.invoices.map(invoice => invoice.invoiceId)).not.toContain(f.c.id);
    await expect(recordBankPayment(f.userId, other.row.rowStableKey, pending)).rejects.toMatchObject({ code: 'BANK_ALLOCATION_REVIEW_REQUIRED' });
    const current = (await recoverBankPayment(f.userId, saved.row.rowStableKey, null)).row.assignment!;
    await expect(reallocateBankPayment(f.userId, binding, { ...changeInput(validMove, f.c.id), idempotencyKey: randomUUID(), expectedAllocationRevision: current.allocationRevision, expectedSourceLedgerVersion: current.allocatedInvoice.ledgerVersion, expectedTargetLedgerVersion: state.ledgerVersion })).rejects.toMatchObject({ code: 'BANK_ALLOCATION_REVIEW_REQUIRED' });
    expect(await counts(f.userId)).toEqual(before);
  });
  it('binding and mandatory audit failures rollback every money or change/projection effect', async () => {
    const f = await fixture(), saved = await f.saved(), input = await f.initial(saved.row.rowStableKey), before = await counts(f.userId);
    await db.client.$executeRawUnsafe(`CREATE TRIGGER bank_flow_binding_failure BEFORE INSERT ON BankPaymentBinding WHEN NEW.userId='${f.userId}' BEGIN SELECT RAISE(ABORT,'Synthetic binding failure'); END;`);
    try { await expect(recordBankPayment(f.userId, saved.row.rowStableKey, input)).rejects.toThrow(); expect(await counts(f.userId)).toEqual(before); } finally { await db.client.$executeRawUnsafe('DROP TRIGGER bank_flow_binding_failure'); }
    const initial = await recordBankPayment(f.userId, saved.row.rowStableKey, input), binding = initial.row.assignment!.bindingStableKey, change = await f.change(binding), beforeChange = await counts(f.userId);
    await db.client.$executeRawUnsafe(`CREATE TRIGGER bank_flow_audit_failure BEFORE INSERT ON AuditLog WHEN NEW.userId='${f.userId}' AND NEW.action='PAYMENT_ALLOCATION_CHANGED' BEGIN SELECT RAISE(ABORT,'Synthetic audit failure'); END;`);
    try { await expect(reallocateBankPayment(f.userId, binding, change)).rejects.toThrow(); expect(await counts(f.userId)).toEqual(beforeChange); expect((await recoverBankPayment(f.userId, saved.row.rowStableKey, input.idempotencyKey)).row.assignment!.allocatedInvoice.invoiceId).toBe(f.a.id); } finally { await db.client.$executeRawUnsafe('DROP TRIGGER bank_flow_audit_failure'); }
  });
  it('retains genuine later refund on current cancellation basis and truthful never-received correction after movement', async () => {
    const f = await fixture(), saved = await f.saved(), initial = await recordBankPayment(f.userId, saved.row.rowStableKey, await f.initial(saved.row.rowStableKey)), binding = initial.row.assignment!.bindingStableKey, rootId = initial.row.assignment!.originalPaymentId;
    await reallocateBankPayment(f.userId, binding, await f.change(binding)); const basis = await cancel(f, f.b.id), current = await readInvoicePaymentJournal(f.userId, f.b.id, 3);
    const refunded = await recordPaymentAdjustment(f.userId, f.b.id, { originalPaymentId: rootId, kind: 'CUSTOMER_REFUND', amount: '10.00', actionDate: '2026-10-22', reason: 'Synthetic genuine payout.', reference: 'Synthetic payout evidence', cancellationInvoiceId: basis.id, idempotencyKey: randomUUID(), expectedLedgerVersion: current.ledgerVersion, expectedAllocationRevision: 1 });
    expect(refunded.adjustment).toMatchObject({ contractVersion: 3, originalPaymentId: rootId, invoiceId: f.b.id, allocationRevision: 1 });
    const afterRefund = await recoverBankPayment(f.userId, saved.row.rowStableKey, null); expect(afterRefund.row.assignment).toMatchObject({ allocatedInvoice: { invoiceId: f.b.id, openCents: '0' }, canReallocate: false }); expect((await readInvoicePaymentJournal(f.userId, f.a.id, 3)).summary).toMatchObject({ paidCents: '0', openCents: '12000' });
    const g = await fixture(), mistaken = await g.saved(), recorded = await recordBankPayment(g.userId, mistaken.row.rowStableKey, await g.initial(mistaken.row.rowStableKey)), otherBinding = recorded.row.assignment!.bindingStableKey;
    await reallocateBankPayment(g.userId, otherBinding, await g.change(otherBinding)); const journal = await readInvoicePaymentJournal(g.userId, g.b.id, 3);
    const correction = { originalPaymentId: recorded.row.assignment!.originalPaymentId, kind: 'PAYMENT_CORRECTION' as const, amount: '20.00', actionDate: '2026-10-22', reason: 'Synthetic assertion proved factually mistaken.', reference: 'Synthetic contrary evidence', idempotencyKey: randomUUID(), expectedLedgerVersion: journal.ledgerVersion, expectedAllocationRevision: 1, declarationNeverReceived: true };
    await expect(recordPaymentAdjustment(g.userId, g.b.id, { ...correction, declarationNeverReceived: false })).rejects.toThrow();
    await recordPaymentAdjustment(g.userId, g.b.id, correction); const corrected = await recoverBankPayment(g.userId, mistaken.row.rowStableKey, null); expect(corrected.row.assignment).toMatchObject({ allocatedInvoice: { paidCents: '2000', openCents: '10000' }, canReallocate: false });
  });
  it('preserves immutable saved receipt/evidence as explicit review-only when its live projection is inconsistent', async () => {
    const f = await fixture(), saved = await f.saved(), initial = await recordBankPayment(f.userId, saved.row.rowStableKey, await f.initial(saved.row.rowStableKey));
    await db.client.invoice.update({ where: { id: f.a.id }, data: { status: 'PAID' } });
    const detail = await readBankImport(f.userId, saved.receipt.id, 0);
    expect(detail.receipt).toEqual(saved.receipt); expect(detail.rows).toEqual(saved.detail.rows);
    expect(detail.rowEnvelopes![0]).toMatchObject({ assignmentState: 'REVIEW_REQUIRED', bindingStableKey: initial.row.assignment!.bindingStableKey, assignment: null });
    expect(detail.rowEnvelopes![0].assignmentReviewReason).toContain('keine neue Zahlung');
    await expect(preflightBankPayment(f.userId, saved.row.rowStableKey, { invoiceId: f.a.id })).rejects.toThrow();
    expect((await counts(f.userId)).slice(0, 3)).toEqual([1, 1, 1]);
  });
  it('allows a genuine new full receipt at former invoice even when origin cash exceeds its face amount', async () => {
    const f = await fixture(), saved = await f.saved('120,00'), initial = await recordBankPayment(f.userId, saved.row.rowStableKey, await f.initial(saved.row.rowStableKey)), binding = initial.row.assignment!.bindingStableKey;
    await reallocateBankPayment(f.userId, binding, await f.change(binding)); const newReceipt = await f.saved('120,00', '21.10.2026');
    await recordBankPayment(f.userId, newReceipt.row.rowStableKey, await f.initial(newReceipt.row.rowStableKey));
    const journal = await readInvoicePaymentJournal(f.userId, f.a.id, 3); expect(journal.ledger).toMatchObject({ version: 3, originCash: { originalReceivedCents: '24000' }, allocation: { validAllocatedCents: '12000' } }); expect((await counts(f.userId)).slice(0, 3)).toEqual([2, 2, 2]);
  });
});
describe('bank allocation authenticated same-origin closed routes', () => {
  it('guards authorization/origin/body limits/capability and keeps preflight read-only', async () => {
    const f = await fixture(), saved = await f.saved(), input = await f.initial(saved.row.rowStableKey), context = { params: Promise.resolve({ id: saved.row.rowStableKey }) };
    const request = (body: unknown = input, headers = {}) => new Request('http://localhost/api/bank-imports/rows/x/allocation', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bivaro-Payment-Contract': '3', ...headers }, body: JSON.stringify(body) });
    state.userId = null; expect((await GET(new Request('http://localhost/api/bank-imports/rows/x/allocation'), context)).status).toBe(401); expect((await POST(request(), context)).status).toBe(401);
    state.userId = f.userId; expect((await POST(request(input, { origin: 'https://evil.invalid' }), context)).status).toBe(403); expect((await POST(request(input, { 'content-length': '99999999' }), context)).status).toBe(413); expect((await POST(request(input, { 'X-Bivaro-Payment-Contract': '2' }), context)).status).toBe(409);
    const before = await counts(f.userId), checked = await preflightPOST(request({ invoiceId: f.a.id }), context); expect(checked.status).toBe(200); expect(checked.headers.get('cache-control')).toBe('private, no-store'); expect(await counts(f.userId)).toEqual(before);
    expect((await POST(request({ ...input, amount: '999' }), context)).status).toBe(400);
    const success = await POST(request(), context); expect(success.status).toBe(201); const result = await success.json();
    expect((await POST(request(), context)).status).toBe(200); expect((await changePOST(request({ ...await f.change(result.row.assignment.bindingStableKey), currency: 'EUR' }), { params: Promise.resolve({ id: result.row.assignment.bindingStableKey }) })).status).toBe(400);
    const recovery = await GET(new Request(`http://localhost/api/bank-imports/rows/x/allocation?idempotencyKey=${input.idempotencyKey}`), context); expect((await recovery.json()).operation.kind).toBe('BANK_PAYMENT_RECORDED');
  });
});
