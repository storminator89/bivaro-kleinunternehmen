import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient, type PaymentJournalEvent } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { createTestDatabase } from './helpers/database';
import { recordFullPayment, readInvoicePaymentJournal, adoptLegacyPaidInvoice } from '@/lib/payment-journal/service';
import { loadInvoicePaymentState, loadInvoicePaymentStates, invoicePaymentResponse, updateInvoicePaymentProjection } from '@/lib/payment-journal/allocation-ledger';
import { bankBindingBasisSnapshot, allocationChangeBasisSnapshot, allocationCommercialHash, assertAllocationInvoice, assertAllocationCancellationBasis } from '@/lib/payment-journal/allocation-evidence';
import { financialHash, adjustmentFingerprint } from '@/lib/payment-journal/adjustment-evidence';
import { recordPaymentAdjustment } from '@/lib/payment-journal/adjustment-service';
import { readPaymentAdjustmentPreflight, paymentAdjustmentAttempt, readConfirmedPaymentAdjustment } from '@/lib/payment-adjustment-form';
import { readPaymentPreflight, paymentAttempt, recoverConfirmedPayment } from '@/lib/full-payment-form';
import { generateZugferdXml } from '@/lib/zugferd-generator';
import { parseEInvoiceXml } from '@/lib/e-invoice-parser';
import { reduceAllocationLedger } from '@/lib/payment-journal/allocation-contract';
import { operationalIncomeEntriesSql } from '@/lib/payment-journal/accounting-source';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({ requireUserId: async () => 'allocation-core-owner', UnauthorizedError: class extends Error {}, unauthorizedResponse: () => new Response(null, { status: 401 }) }));
let db: ReturnType<typeof createTestDatabase>, next = 0;
const owner = 'allocation-core-owner';
const key = () => randomUUID();
async function invoice(customerId: number, totalAmount = 120) {
  return db.client.invoice.create({ data: { userId: owner, customerId, fileName: 'synthetic.pdf', storedFileName: 'synthetic.pdf',
    invoiceNumber: `ALLOC-${++next}`, totalAmount, status: 'SENT', issuanceState: 'ISSUED', parsedData: { currency: 'EUR', taxMode: 'small-business', taxAmount: 0, items: [{ quantity: 1, unitPrice: totalAmount, amount: totalAmount, taxRate: 0, taxCategory: 'E' }] } } });
}
async function fixture(amount = '40') {
  const customer = await db.client.customer.create({ data: { userId: owner, name: `Synthetic customer ${++next}` } });
  const a = await invoice(customer.id), b = await invoice(customer.id);
  const rowKey = key(), op = key();
  const batch = await db.client.bankImportBatch.create({ data: { userId: owner, stableKey: key(), requestId: key(), fingerprint: key(), sourceSha256: 'a'.repeat(64), sourceBytes: 1, parserVersion: 'bank-csv-v1', mappingVersion: 'bank-csv-mapping-v1', accountAlias: 'Synthetic', delimiter: ';', mapping: {}, receipt: {} } });
  const row = await db.client.bankImportRow.create({ data: { stableKey: rowKey, userId: owner, batchId: batch.id, sourceRow: 1,
    evidence: { date: '2026-01-01', amountCents: String(Number(amount) * 100), currency: 'EUR' } } });
  const before = await db.client.$transaction(tx => loadInvoicePaymentState(tx, owner, a.id));
  const payment = await recordFullPayment(owner, a.id, { amount, currency: 'EUR', paidAt: '2026-01-01', source: 'MANUAL', reference: `bank-row:${rowKey}`, idempotencyKey: op, expectedPaidCents: '0', expectedLedgerVersion: before.ledgerVersion });
  const basis = bankBindingBasisSnapshot(row, a, { idempotencyKey: op, expectedLedgerVersion: before.ledgerVersion });
  const binding = await db.client.bankPaymentBinding.create({ data: { stableKey: key(), userId: owner, bankImportRowId: row.id, paymentJournalEventId: payment.event.id, idempotencyKey: op, semanticFingerprint: financialHash(basis), basisSnapshot: basis } });
  return { a, b, customer, row, binding, root: payment.event };
}
async function load(id: number) { return db.client.$transaction(tx => loadInvoicePaymentState(tx, owner, id)); }
async function move(bindingId: number, toId: number) {
  return db.client.$transaction(async tx => {
    const binding = await tx.bankPaymentBinding.findUniqueOrThrow({ where: { id: bindingId }, include: { paymentJournalEvent: true, allocationChanges: { orderBy: { revision: 'asc' } } } });
    const head = binding.allocationChanges.at(-1) ?? null, fromId = head?.toInvoiceId ?? binding.paymentJournalEvent.invoiceId;
    const from = await loadInvoicePaymentState(tx, owner, fromId), to = await loadInvoicePaymentState(tx, owner, toId);
    const input = { expectedAllocationRevision: head?.revision ?? 0, expectedSourceLedgerVersion: from.ledgerVersion, expectedTargetLedgerVersion: to.ledgerVersion, actionDate: '2026-02-01', reason: 'Wrong invoice; actual cash unchanged' };
    const basis = allocationChangeBasisSnapshot(binding, binding.paymentJournalEvent, from.invoice, to.invoice, head, input), operationKey = key();
    await tx.paymentOperation.create({ data: { userId: owner, idempotencyKey: operationKey, kind: 'PAYMENT_ALLOCATION_CHANGED' } });
    const change = await tx.paymentAllocationChange.create({ data: { stableKey: key(), userId: owner, bindingId, revision: input.expectedAllocationRevision + 1, previousChangeId: head?.id ?? null,
      fromInvoiceId: fromId, toInvoiceId: toId, amountCents: binding.paymentJournalEvent.amountCents, currency: 'EUR', actionDate: new Date('2026-02-01'), reason: input.reason,
      idempotencyKey: operationKey, semanticFingerprint: financialHash(basis), basisSnapshot: basis } });
    await updateInvoicePaymentProjection(tx, await loadInvoicePaymentState(tx, owner, fromId, { validateProjection: false }));
    await updateInvoicePaymentProjection(tx, await loadInvoicePaymentState(tx, owner, toId, { validateProjection: false }));
    return change;
  });
}
async function cancel(id: number) {
  const original = await db.client.invoice.findUniqueOrThrow({ where: { id } });
  const basis = await db.client.invoice.create({ data: { userId: owner, customerId: original.customerId, originalInvoiceId: id, invoiceNumber: `CANCEL-${++next}`, totalAmount: -original.totalAmount!,
    type: 'CREDIT_NOTE', status: 'SENT', issuanceState: 'ISSUED', invoiceDate: new Date('2026-03-01'), cancellationReason: 'Full synthetic cancellation', fileName: 'synthetic.pdf', storedFileName: 'synthetic.pdf', parsedData: { currency: 'EUR' } } });
  await db.client.invoice.update({ where: { id }, data: { status: 'CANCELLED' } });
  return basis;
}
async function correction(invoiceId: number, root: PaymentJournalEvent, amount = '20') {
  const current = await load(invoiceId);
  return { kind: 'PAYMENT_CORRECTION' as const, originalPaymentId: root.id, amount, actionDate: '2026-03-02', reason: 'Counter-evidence: recorded amount never arrived', reference: key(), idempotencyKey: key(), declarationNeverReceived: true,
    expectedLedgerVersion: current.ledgerVersion, expectedAllocationRevision: current.effectivePayments.find(value => value.originalPaymentId === root.id)!.allocationRevision! };
}
beforeAll(async () => { db = createTestDatabase(); state.client = db.client; await db.client.user.create({ data: { id: owner, email: 'allocation-core@test.invalid', password: 'synthetic' } }); }, 40_000);
afterAll(async () => { await db?.cleanup(); });
describe('immutable receipt / effective invoice allocation v3', () => {
  it('moves A -> B -> A without cash mutation; revision changes token even with the same balances', async () => {
    const f = await fixture(), before = await load(f.a.id), income = await db.client.income.findUniqueOrThrow({ where: { id: f.root.incomeId! } });
    expect(before.summary).toMatchObject({ paidCents: '4000', openCents: '8000' });
    await move(f.binding.id, f.b.id);
    expect((await load(f.a.id)).summary).toMatchObject({ paidCents: '0', openCents: '12000' });
    expect((await load(f.b.id)).summary).toMatchObject({ paidCents: '4000', openCents: '8000' });
    await expect(readInvoicePaymentJournal(owner, f.a.id)).rejects.toMatchObject({ code: 'PAYMENT_CAPABILITY_REQUIRED' });
    await move(f.binding.id, f.a.id);
    const after = await load(f.a.id);
    expect(after.summary).toEqual(before.summary); expect(after.ledgerVersion).not.toBe(before.ledgerVersion);
    expect(after.effectivePayments[0]).toMatchObject({ originInvoiceId: f.a.id, allocatedInvoiceId: f.a.id, allocationRevision: 2 });
    expect(await db.client.paymentJournalEvent.findUnique({ where: { id: f.root.id } })).toEqual(f.root);
    expect(await db.client.income.findUnique({ where: { id: income.id } })).toEqual(income);
    expect(readPaymentPreflight(JSON.parse(JSON.stringify(invoicePaymentResponse(after)))).summary.openCents).toBe('8000');
  });
  it('accepts a genuinely new old-invoice payment even when origin gross exceeds face', async () => {
    const f = await fixture(); await move(f.binding.id, f.b.id); const old = await load(f.a.id);
    await recordFullPayment(owner, f.a.id, { amount: '120', currency: 'EUR', paidAt: '2026-02-02', source: 'MANUAL', reference: 'New real receipt', idempotencyKey: key(), expectedPaidCents: '0', expectedLedgerVersion: old.ledgerVersion });
    expect((await load(f.a.id)).ledger).toMatchObject({ originCash: { originalReceivedCents: '16000' }, allocation: { originalAllocatedCents: '12000' }, collectibleOpenCents: '0' });
    expect((await load(f.b.id)).summary.paidCents).toBe('4000');
  });
  it('records a genuine cross-invoice partial refund with current cancellation basis and one original cash source', async () => {
    const f = await fixture(); await move(f.binding.id, f.b.id); const basis = await cancel(f.b.id), current = await load(f.b.id);
    const input = { kind: 'CUSTOMER_REFUND' as const, originalPaymentId: f.root.id, amount: '10', actionDate: '2026-03-02', reason: 'Actual partial payout', reference: key(), idempotencyKey: key(), cancellationInvoiceId: basis.id, expectedLedgerVersion: current.ledgerVersion, expectedAllocationRevision: 1 };
    const result = await recordPaymentAdjustment(owner, f.b.id, input);
    expect(result.adjustment).toMatchObject({ invoiceId: f.b.id, originalPaymentId: f.root.id, contractVersion: 3, allocationRevision: 1, cancellationInvoiceId: basis.id });
    expect(result.ledger).toMatchObject({ allocation: { validAllocatedCents: '4000', refundedAllocatedCents: '1000', retainedAllocatedCents: '3000' }, refundDueCents: '3000', collectibleOpenCents: '0' });
    expect((await load(f.a.id)).summary.paidCents).toBe('0');
    expect((await recordPaymentAdjustment(owner, f.b.id, input)).replayed).toBe(true);
    await expect(recordPaymentAdjustment(owner, f.b.id, { ...input, amount: '11' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const dto = JSON.parse(JSON.stringify(await readInvoicePaymentJournal(owner, f.b.id, 3)));
    expect(readPaymentAdjustmentPreflight(dto, f.b.id).effectivePayments?.[0].originInvoiceId).toBe(f.a.id);
    const draft = paymentAdjustmentAttempt(null, input, () => input.idempotencyKey);
    expect(readConfirmedPaymentAdjustment(JSON.parse(JSON.stringify(result)), draft).allocationRevision).toBe(1);
    const entries = await db.client.$queryRaw<Array<{ movementKind: string; amountCents: bigint }>>(Prisma.sql`SELECT * FROM (${operationalIncomeEntriesSql(owner)})`);
    expect(entries.filter(entry => entry.movementKind === 'CUSTOMER_REFUND' && BigInt(entry.amountCents) === BigInt(-1000))).toHaveLength(1);
    expect(await db.client.paymentJournalEvent.count({ where: { id: f.root.id } })).toBe(1);
    await expect(move(f.binding.id, f.a.id)).rejects.toThrow();
  });
  it('truthfully corrects mistaken imported receipt after movement at original cash date, not as payout', async () => {
    const f = await fixture(); await move(f.binding.id, f.b.id); const input = await correction(f.b.id, f.root);
    const saved = await recordPaymentAdjustment(owner, f.b.id, input);
    expect(saved.adjustment.accountingEffectiveOn).toEqual(f.root.paidAt);
    expect(saved.ledger).toMatchObject({ allocation: { correctedAllocatedCents: '2000', validAllocatedCents: '2000', refundedAllocatedCents: '0' }, collectibleOpenCents: '10000' });
    expect((await load(f.a.id)).ledger).toMatchObject({ originCash: { originalReceivedCents: '4000', correctedCents: '2000' }, allocation: { validAllocatedCents: '0' } });
    await expect(recordPaymentAdjustment(owner, f.b.id, { ...input, idempotencyKey: key(), expectedLedgerVersion: (await load(f.b.id)).ledgerVersion, amount: '20.01' })).rejects.toMatchObject({ code: 'PAYMENT_REVIEW_REQUIRED' });
    await expect(recordPaymentAdjustment(owner, f.b.id, { ...input, idempotencyKey: key(), declarationNeverReceived: false })).rejects.toThrow();
    expect(await db.client.paymentJournalEvent.findUnique({ where: { id: f.root.id } })).toEqual(f.root);
    await expect(move(f.binding.id, f.a.id)).rejects.toThrow();
  });
  it('serializes root-wide capacity and rolls the operation/adjustment/projection back when audit fails', async () => {
    const f = await fixture(); await move(f.binding.id, f.b.id);
    const input = await correction(f.b.id, f.root, '30');
    const raced = await Promise.allSettled([recordPaymentAdjustment(owner, f.b.id, input), recordPaymentAdjustment(owner, f.b.id, { ...input, idempotencyKey: key(), reference: key() })]);
    expect(raced.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await load(f.b.id)).summary.paidCents).toBe('1000');
    const second = await fixture(); await move(second.binding.id, second.b.id); const failing = await correction(second.b.id, second.root);
    await db.client.$executeRawUnsafe(`CREATE TRIGGER reject_allocation_core_audit BEFORE INSERT ON AuditLog WHEN NEW.action='PAYMENT_CORRECTION' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END`);
    try { await expect(recordPaymentAdjustment(owner, second.b.id, failing)).rejects.toThrow(); }
    finally { await db.client.$executeRawUnsafe('DROP TRIGGER reject_allocation_core_audit'); }
    expect(await db.client.paymentOperation.count({ where: { userId: owner, idempotencyKey: failing.idempotencyKey } })).toBe(0);
    expect(await db.client.paymentAdjustment.count({ where: { originalPaymentId: second.root.id } })).toBe(0);
    expect((await load(second.b.id)).summary.paidCents).toBe('4000');
  });
  it('preserves frozen context through customer rename and explicitly guards allocation-history deletion without blocking unrelated customers', async () => {
    const f = await fixture(); await move(f.binding.id, f.b.id);
    await db.client.customer.update({ where: { id: f.customer.id }, data: { name: 'Renamed live label' } });
    await expect(db.client.customer.delete({ where: { id: f.customer.id } })).rejects.toThrow();
    expect((await load(f.b.id)).summary.paidCents).toBe('4000');
    const basis = await cancel(f.b.id), current = await load(f.b.id);
    await recordPaymentAdjustment(owner, f.b.id, { kind: 'CUSTOMER_REFUND', originalPaymentId: f.root.id, amount: '40', actionDate: '2026-03-02', reason: 'Actual payout after rename', reference: key(), idempotencyKey: key(), cancellationInvoiceId: basis.id, expectedLedgerVersion: current.ledgerVersion, expectedAllocationRevision: 1 });
    expect((await load(f.b.id)).ledger.refundDueCents).toBe('0');
    const unrelated = await db.client.customer.create({ data: { userId: owner, name: 'Unrelated' } });
    await expect(db.client.customer.delete({ where: { id: unrelated.id } })).resolves.toMatchObject({ id: unrelated.id });
  });
  it('freezes only the adjusted receipt while an unrelated bank root remains eligible', async () => {
    const f = await fixture(); await move(f.binding.id, f.b.id);
    const batch = await db.client.bankImportBatch.findUniqueOrThrow({ where: { id: f.row.batchId } });
    const row = await db.client.bankImportRow.create({ data: { userId: owner, batchId: batch.id, stableKey: key(), sourceRow: 2, evidence: { date: '2026-01-02', amountCents: '2000', currency: 'EUR' } } });
    const current = await load(f.b.id), op = key();
    const second = await recordFullPayment(owner, f.b.id, { amount: '20', currency: 'EUR', paidAt: '2026-01-02', source: 'MANUAL', reference: `bank-row:${row.stableKey}`, idempotencyKey: op, expectedPaidCents: '4000', expectedLedgerVersion: current.ledgerVersion });
    const basis = bankBindingBasisSnapshot(row, current.invoice, { idempotencyKey: op, expectedLedgerVersion: current.ledgerVersion });
    const binding = await db.client.bankPaymentBinding.create({ data: { userId: owner, bankImportRowId: row.id, paymentJournalEventId: second.event.id, idempotencyKey: op, semanticFingerprint: financialHash(basis), basisSnapshot: basis } });
    await recordPaymentAdjustment(owner, f.b.id, await correction(f.b.id, f.root));
    const caps = (await load(f.b.id)).rootCapabilities;
    expect(caps.find(root => root.originalPaymentId === f.root.id)?.canReallocate).toBe(false);
    expect(caps.find(root => root.originalPaymentId === second.event.id)).toMatchObject({ canCorrect: true, canReallocate: true, correctableCents: '2000' });
    await move(binding.id, f.a.id);
    expect((await load(f.a.id)).summary.paidCents).toBe('2000');
  });
  it('rejects raw v2 bypass of a moved root and preserves immutable allocation evidence', async () => {
    const f = await fixture(); const change = await move(f.binding.id, f.b.id), op = key();
    await db.client.paymentOperation.create({ data: { userId: owner, idempotencyKey: op, kind: 'PAYMENT_CORRECTION' } });
    await expect(db.client.paymentAdjustment.create({ data: { userId: owner, invoiceId: f.a.id, originalPaymentId: f.root.id, kind: 'PAYMENT_CORRECTION', amountCents: '1000', actionDate: new Date('2026-03-02'), accountingEffectiveOn: f.root.paidAt!, reason: 'Synthetic bypass', reference: key(), idempotencyKey: op, semanticFingerprint: '0'.repeat(64), contractVersion: 2 } })).rejects.toThrow();
    await expect(db.client.bankPaymentBinding.update({ where: { id: f.binding.id }, data: { semanticFingerprint: '0'.repeat(64) } })).rejects.toThrow();
    await expect(db.client.bankPaymentBinding.delete({ where: { id: f.binding.id } })).rejects.toThrow();
    await expect(db.client.paymentAllocationChange.delete({ where: { id: change.id } })).rejects.toThrow();
    await expect(db.client.paymentJournalEvent.update({ where: { id: f.root.id }, data: { invoiceId: f.b.id } })).rejects.toThrow();
  });
  it('uses graph-bounded exact aggregate strings rather than capping origin cash at one invoice amount', () => {
    const root = { amountCents: '9007199254740991', paidAt: '2026-01-01T00:00:00.000Z', dateCertainty: 'ACTUAL', invoiceId: 1, source: 'MANUAL' };
    const projected = reduceAllocationLedger(120, 1, 'SENT', [1, 2].map(id => ({ root: { ...root, id }, allocatedInvoiceId: 2, adjustments: [], bindingStableKey: key(), allocationRevision: 1, allocationChangeStableKey: key() })));
    expect(projected.ledger.originCash.originalReceivedCents).toBe('18014398509481982');
    expect(projected.summary).toMatchObject({ paidCents: '0', openCents: '12000' });
  });
  it('uses the same checked batch projection without per-invoice queries or hiding invalid source balances', async () => {
    const f = await fixture(); await move(f.binding.id, f.b.id);
    const batch = await db.client.$transaction(tx => loadInvoicePaymentStates(tx, owner, [f.a.id, f.b.id]));
    expect(batch.get(f.a.id)?.summary).toEqual((await load(f.a.id)).summary);
    expect(batch.get(f.b.id)?.summary).toEqual((await load(f.b.id)).summary);
    const invalid = await invoice(f.customer.id, 0);
    const checked = await db.client.$transaction(tx => loadInvoicePaymentStates(tx, owner, [f.a.id, f.b.id, invalid.id], { onReview: 'omit' }));
    expect(checked.has(invalid.id)).toBe(false); expect(checked.size).toBe(2);
  });
  it('recovers an old receipt without claiming its historic invoice is still allocated or settled', async () => {
    const f = await fixture(), before = await load(f.a.id);
    const draft = paymentAttempt(null, f.a.id, '40', '2026-01-01', f.root.reference, () => f.root.idempotencyKey, '0', before.ledgerVersion);
    await move(f.binding.id, f.b.id);
    const dto = JSON.parse(JSON.stringify(await readInvoicePaymentJournal(owner, f.a.id, 3)));
    const confirmed = recoverConfirmedPayment(dto, f.a.id, f.root.idempotencyKey, draft);
    expect(confirmed).toMatchObject({ id: f.root.id, summary: { paidCents: '0', openCents: '12000' }, currentAssignment: { allocatedInvoiceId: f.b.id, allocationRevision: 1 } });
    expect(readPaymentAdjustmentPreflight(dto, f.a.id).allocationHistory?.[0]).toMatchObject({ fromInvoiceId: f.a.id, toInvoiceId: f.b.id, fromInvoiceNumber: f.a.invoiceNumber, toInvoiceNumber: f.b.invoiceNumber });
  });
  it('requires explicitly recorded zero VAT for bank allocations without changing v2 evidence semantics', async () => {
    const f = await fixture();
    expect(() => assertAllocationInvoice({ ...f.a, parsedData: { currency: 'EUR', taxMode: 'small-business' } })).toThrow();
    expect(() => assertAllocationInvoice({ ...f.a, parsedData: { currency: 'EUR', taxMode: 'small-business', taxAmount: 0, items: [{}] } })).toThrow();
    expect(() => assertAllocationInvoice({ ...f.a, parsedData: { currency: 'EUR', taxMode: 'small-business', taxAmount: 0, items: [{ quantity: 1, unitPrice: 120, amount: 120, taxRate: 0, taxCategory: 'E' }] } })).not.toThrow();
    for (const bad of [{ taxAmount: '0' }, { taxAmount: false }, { taxAmount: 0, items: [{ taxRate: '0' }] }, { taxAmount: 0, items: [{ taxRate: false }] }]) {
      expect(() => assertAllocationInvoice({ ...f.a, parsedData: { currency: 'EUR', taxMode: 'small-business', ...bad } })).toThrow();
    }
    for (const bad of [{}, { taxAmount: '0' }, { taxAmount: false }, { taxAmount: 0, items: [{}] }]) {
      const invalid = await invoice(f.customer.id);
      await db.client.invoice.update({ where: { id: invalid.id }, data: { parsedData: { currency: 'EUR', taxMode: 'small-business', ...bad } } });
      const row = await db.client.bankImportRow.create({ data: { userId: owner, batchId: f.row.batchId, stableKey: key(), sourceRow: ++next + 100, evidence: { date: '2026-01-01', amountCents: '1000', currency: 'EUR' } } });
      const op = key(), payment = await recordFullPayment(owner, invalid.id, { amount: '10', currency: 'EUR', paidAt: '2026-01-01', source: 'MANUAL', reference: `bank-row:${row.stableKey}`, idempotencyKey: op, expectedPaidCents: '0' });
      const forged = bankBindingBasisSnapshot(row, invalid, { idempotencyKey: op, expectedLedgerVersion: '0'.repeat(64) });
      await expect(db.client.bankPaymentBinding.create({ data: { userId: owner, bankImportRowId: row.id, paymentJournalEventId: payment.event.id, idempotencyKey: op, semanticFingerprint: financialHash(forged), basisSnapshot: forged } })).rejects.toThrow();
    }
    await expect(db.client.bankImportRow.update({ where: { id: f.row.id }, data: { evidence: { date: '2026-01-01', amountCents: '5000', currency: 'EUR' } } })).rejects.toThrow();
    await expect(db.client.income.update({ where: { id: f.root.incomeId! }, data: { amount: 50 } })).rejects.toThrow();
  });
  it('blocks legacy adoption through the existing route on an incoming fully paid allocation and its moved-away origin', async () => {
    const f = await fixture('120'); await move(f.binding.id, f.b.id);
    await expect(adoptLegacyPaidInvoice(owner, f.b.id)).rejects.toMatchObject({ code: 'PAYMENT_REVIEW_REQUIRED' });
    await expect(adoptLegacyPaidInvoice(owner, f.a.id)).rejects.toMatchObject({ code: 'PAYMENT_REVIEW_REQUIRED' });
    const { POST, GET } = await import('@/app/api/invoices/[id]/payments/route');
    const oldClient = await GET(new Request(`http://localhost/api/invoices/${f.b.id}/payments`, { headers: { 'X-Bivaro-Payment-Contract': '2' } }), { params: Promise.resolve({ id: String(f.b.id) }) });
    expect(oldClient.status).toBe(409); expect(await oldClient.json()).toMatchObject({ code: 'PAYMENT_CAPABILITY_REQUIRED', requiredContract: 3 });
    const response = await POST(new Request(`http://localhost/api/invoices/${f.b.id}/payments`, { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'LEGACY_IMPORT' }) }), { params: Promise.resolve({ id: String(f.b.id) }) });
    expect(response.status).toBe(409);
    expect(await db.client.paymentJournalEvent.count({ where: { invoiceId: f.b.id } })).toBe(0);
    expect((await load(f.b.id)).summary.paidCents).toBe('12000');
  });
  it('requires a complete consistent cancellation basis and rechecks genuine generated source XML with the existing bounded parser', async () => {
    const f = await fixture();
    for (const data of [
      { taxAmount: 0 }, { taxAmount: 0, items: [] }, { taxAmount: 0, items: [{ quantity: 1, unitPrice: 100, taxRate: 0 }] },
      { taxAmount: 0, grossAmount: 140, items: [{ quantity: 1, unitPrice: 120, taxRate: 0 }] },
      { taxAmount: 0, netAmount: 100, items: [{ quantity: 1, unitPrice: 120, taxRate: 0 }] },
      { taxAmount: 0, items: [{ quantity: 1, unitPrice: 120, amount: 140, taxRate: 0 }] },
    ]) expect(() => assertAllocationInvoice({ ...f.a, parsedData: { currency: 'EUR', taxMode: 'small-business', ...data } })).toThrow();
    const xml = generateZugferdXml({ invoiceNumber: f.a.invoiceNumber!, date: new Date('2026-01-01'), dueDate: new Date('2026-01-15'), currency: 'EUR', taxMode: 'small-business',
      seller: { name: 'Synthetic seller', address: 'Example 1\n10000 Berlin', countryCode: 'DE', email: 'seller@test.invalid', taxNumber: 'synthetic', iban: 'DE89370400440532013000' },
      buyer: { name: f.customer.name, address: 'Example 2', zipCode: '10000', city: 'Berlin', countryCode: 'DE', email: 'buyer@test.invalid' },
      items: [{ description: 'Synthetic service', quantity: 1, unitPrice: 120, total: 120, unit: 'Stück', taxRate: 0 }], netAmount: 120, taxAmount: 0 });
    const parsed = await parseEInvoiceXml(xml);
    const genuine = { ...f.a, parsedData: { ...parsed, invoiceDate: parsed.invoiceDate?.toISOString(), dueDate: parsed.dueDate?.toISOString() } };
    expect(genuine.parsedData).not.toHaveProperty('taxMode');
    expect(() => assertAllocationInvoice(genuine)).not.toThrow();
    expect(() => assertAllocationInvoice({ ...genuine, parsedData: { ...genuine.parsedData, taxMode: 'standard' } })).toThrow();
    await expect(assertAllocationCancellationBasis(genuine)).resolves.toBeUndefined();
    await expect(assertAllocationCancellationBasis({ ...genuine, parsedData: { ...genuine.parsedData, rawXml: xml.replace('<ram:GrandTotalAmount>120.00</ram:GrandTotalAmount>', '<ram:GrandTotalAmount>140.00</ram:GrandTotalAmount>') } })).rejects.toThrow();
    // Exercise the actual upload parser shape: canonical §19 lives on parsed E lines, not a taxMode field.
    const generated = await invoice(f.customer.id), sourceXml = xml.replace(`<ram:ID>${f.a.invoiceNumber}</ram:ID>`, `<ram:ID>${generated.invoiceNumber}</ram:ID>`);
    const source = JSON.parse(JSON.stringify(await parseEInvoiceXml(sourceXml))) as Prisma.InputJsonObject;
    await db.client.invoice.update({ where: { id: generated.id }, data: { parsedData: source } });
    const row = await db.client.bankImportRow.create({ data: { userId: owner, batchId: f.row.batchId, stableKey: key(), sourceRow: ++next + 100, evidence: { date: '2026-01-01', amountCents: '4000', currency: 'EUR' } } });
    const preflight = await load(generated.id), op = key();
    expect(preflight.allocationReviewReason).toBeNull();
    const received = await recordFullPayment(owner, generated.id, { amount: '40', currency: 'EUR', paidAt: '2026-01-01', source: 'MANUAL', reference: `bank-row:${row.stableKey}`, idempotencyKey: op, expectedPaidCents: '0', expectedLedgerVersion: preflight.ledgerVersion });
    const basis = bankBindingBasisSnapshot(row, preflight.invoice, { idempotencyKey: op, expectedLedgerVersion: preflight.ledgerVersion });
    await db.client.bankPaymentBinding.create({ data: { userId: owner, bankImportRowId: row.id, paymentJournalEventId: received.event.id, idempotencyKey: op, semanticFingerprint: financialHash(basis), basisSnapshot: basis } });
    const cancellation = await cancel(generated.id), current = await load(generated.id);
    expect(current.rootCapabilities[0].canRefund).toBe(true);
    await recordPaymentAdjustment(owner, generated.id, { kind: 'CUSTOMER_REFUND', originalPaymentId: received.event.id, amount: '40', actionDate: '2026-03-02', reason: 'Actual payout for generated invoice', reference: key(), idempotencyKey: key(), cancellationInvoiceId: cancellation.id, expectedLedgerVersion: current.ledgerVersion, expectedAllocationRevision: 0 });
    expect((await load(generated.id)).ledger.refundDueCents).toBe('0');
    const legacy = { root: { id: 99999, invoiceId: f.a.id, amountCents: '12000', paidAt: null, dateCertainty: 'UNKNOWN', source: 'LEGACY_IMPORT' }, allocatedInvoiceId: f.a.id, adjustments: [], bindingStableKey: null, allocationRevision: null, allocationChangeStableKey: null };
    expect(() => reduceAllocationLedger(120, f.a.id, 'PAID', [legacy, { root: f.root, allocatedInvoiceId: f.b.id, adjustments: [], bindingStableKey: f.binding.stableKey, allocationRevision: 1, allocationChangeStableKey: key() }])).toThrow();
  });
  it('keeps portable commercial hashes independent of only known local payment-term customer IDs; preserves v2 fingerprints', () => {
    const source = { invoiceNumber: 'PORTABLE', totalAmount: 120, parsedData: { currency: 'EUR', paymentTermSelection: { customerId: 1, days: 14 } } };
    expect(allocationCommercialHash(source)).toBe(allocationCommercialHash({ ...source, parsedData: { currency: 'EUR', paymentTermSelection: { customerId: 99, days: 14 } } }));
    expect(allocationCommercialHash(source)).not.toBe(allocationCommercialHash({ ...source, parsedData: { currency: 'EUR', paymentTermSelection: { customerId: 99, days: 30 } } }));
    const evidence = { kind: 'PAYMENT_CORRECTION', amountCents: '1000', actionDate: new Date('2026-03-02'), accountingEffectiveOn: new Date('2026-01-01'), reason: 'Never received', reference: 'synthetic' };
    const expected = financialHash({ ...evidence, rootKey: 'original-key', basisSnapshot: null });
    expect(adjustmentFingerprint(evidence, { idempotencyKey: 'original-key' }, null)).toBe(expected);
    expect(adjustmentFingerprint({ ...evidence, contractVersion: 2 }, { idempotencyKey: 'original-key' }, null)).toBe(expected);
  });
});
