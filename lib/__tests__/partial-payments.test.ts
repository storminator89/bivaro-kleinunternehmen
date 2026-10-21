import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import { createTestDatabase } from './helpers/database';
import { calculateAccountingYear, getIncomeAccountingDate, isIncludedIncome } from '@/lib/accounting';
import { paymentSummary, type FullPaymentInput } from '@/lib/payment-journal/contract';
import { recordFullPayment, recordFullPaymentInTransaction, readInvoicePaymentJournal, adoptLegacyPaidInvoice } from '@/lib/payment-journal/service';
import { updateInvoiceStatus } from '@/lib/invoice-payments';
import { isRetryableDatabaseError } from '@/lib/db-transaction';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
let db: ReturnType<typeof createTestDatabase>;
let next = 0;
const owner = 'partial-owner';
const input = (overrides: Partial<FullPaymentInput> = {}): FullPaymentInput => ({
  amount: '40.00', currency: 'EUR', paidAt: '2025-12-31', source: 'MANUAL', reference: 'Actual bank statement',
  idempotencyKey: `partial-${++next}`, expectedPaidCents: '0', ...overrides,
});
async function invoice(data: Prisma.InvoiceUncheckedCreateInput = { userId: owner, fileName: 'x', storedFileName: 'x', parsedData: {} }) {
  return db.client.invoice.create({ data: { totalAmount: 120, status: 'SENT', issuanceState: 'ISSUED', ...data } });
}
beforeAll(async () => {
  db = createTestDatabase(); state.client = db.client;
  await db.client.user.create({ data: { id: owner, email: 'partial@test.invalid', password: 'fixture' } });
}, 40_000);
afterAll(async () => { await db?.cleanup(); });

describe('partial-payment ledger and actual-date accounting', () => {
  it('books 120 -> 40 on A -> 80 on B with two distinct immutable Income projections', async () => {
    const source = await invoice();
    const firstInput = input();
    const first = await recordFullPayment(owner, source.id, firstInput);
    expect(first.summary).toMatchObject({ totalCents: '12000', paidCents: '4000', openCents: '8000', paymentState: 'PARTIAL', paid: false });
    expect(await db.client.invoice.findUniqueOrThrow({ where: { id: source.id } })).toMatchObject({ status: 'SENT', issuanceState: 'ISSUED', paidAt: null });
    const early = await db.client.income.findMany({ where: { invoiceId: source.id }, include: { invoice: true, paymentJournalEvent: true } });
    expect(early).toHaveLength(1); expect(isIncludedIncome(early[0])).toBe(true);
    expect(calculateAccountingYear(2025, early, []).totalIncome).toBe(40);
    const second = await recordFullPayment(owner, source.id, input({ amount: '80.00', paidAt: '2026-01-02', expectedPaidCents: '4000' }));
    expect(second.summary).toMatchObject({ paidCents: '12000', openCents: '0', paymentState: 'PAID', paid: true });
    const stored = await db.client.invoice.findUniqueOrThrow({ where: { id: source.id }, include: { incomes: true, paymentJournalEvents: true } });
    expect(stored.status).toBe('PAID'); expect(stored.paidAt?.toISOString()).toBe('2026-01-02T00:00:00.000Z');
    expect(stored.incomes.map(row => row.amount)).toEqual([40, 80]);
    expect(new Set(stored.paymentJournalEvents.map(row => row.incomeId)).size).toBe(2);
    const realized = await db.client.income.findMany({ where: { invoiceId: source.id }, include: { invoice: true, paymentJournalEvent: true } });
    expect(calculateAccountingYear(2025, realized, []).totalIncome).toBe(40);
    expect(calculateAccountingYear(2026, realized, []).totalIncome).toBe(80);
    expect(getIncomeAccountingDate(realized[0]).toISOString()).toBe('2025-12-31T00:00:00.000Z');
    const replay = await recordFullPayment(owner, source.id, { ...firstInput, expectedPaidCents: '0' });
    expect(replay.replayed).toBe(true); expect(replay.event.id).toBe(first.event.id);
    expect(replay.summary).toMatchObject({ paidCents: '12000', openCents: '0' });
    const read = await readInvoicePaymentJournal(owner, source.id);
    expect(read.events).toHaveLength(2); expect(read.event).toBeNull(); expect(read.canRecordPayment).toBe(false);
    await db.client.invoice.update({ where: { id: source.id }, data: { status: 'CANCELLED' } });
    const cancelled = await db.client.income.findMany({ where: { invoiceId: source.id }, include: { invoice: true, paymentJournalEvent: true } });
    expect(calculateAccountingYear(2025, cancelled, []).totalIncome).toBe(40);
    expect(calculateAccountingYear(2026, cancelled, []).totalIncome).toBe(80);
    expect(await db.client.paymentJournalEvent.count({ where: { invoiceId: source.id } })).toBe(2);
  });
  it('uses latest actual allocation date, not submission order, for settlement projection', async () => {
    const source = await invoice();
    await recordFullPayment(owner, source.id, input({ paidAt: '2026-06-20' }));
    await recordFullPayment(owner, source.id, input({ amount: '80.00', paidAt: '2026-06-01', expectedPaidCents: '4000' }));
    expect((await db.client.invoice.findUniqueOrThrow({ where: { id: source.id } })).paidAt?.toISOString()).toBe('2026-06-20T00:00:00.000Z');
  });
  it('leaves cancelled partial actual cash realized without manufacturing paidAt/refund', async () => {
    const source = await invoice(); await recordFullPayment(owner, source.id, input());
    await db.client.invoice.update({ where: { id: source.id }, data: { status: 'CANCELLED' } });
    const rows = await db.client.income.findMany({ where: { invoiceId: source.id }, include: { invoice: true, paymentJournalEvent: true } });
    expect(rows[0].invoice?.paidAt).toBeNull(); expect(calculateAccountingYear(2025, rows, []).totalIncome).toBe(40);
    expect((await readInvoicePaymentJournal(owner, source.id)).canRecordPayment).toBe(false);
  });
  it('rejects stale distinct intent and overpayment with current balance, preserving every row', async () => {
    const source = await invoice(); await recordFullPayment(owner, source.id, input());
    await expect(recordFullPayment(owner, source.id, input())).rejects.toMatchObject({ code: 'PAYMENT_STATE_CHANGED', status: 409, summary: { openCents: '8000' } });
    await expect(recordFullPayment(owner, source.id, input({ expectedPaidCents: '4000', amount: '80.01' }))).rejects.toMatchObject({ code: 'PAYMENT_EXCEEDS_OPEN', summary: { openCents: '8000' } });
    await expect(updateInvoiceStatus(owner, source.id, 'PAID', '2026-06-01')).rejects.toMatchObject({ code: 'PAYMENT_DETAILS_REQUIRED' });
    expect(await db.client.income.count({ where: { invoiceId: source.id } })).toBe(1);
  });
  it('same intent ignores changed optimistic baseline, but changed financial payload conflicts', async () => {
    const source = await invoice(); const request = input();
    const first = await recordFullPayment(owner, source.id, request);
    expect((await recordFullPayment(owner, source.id, { ...request, expectedPaidCents: '4000' })).event.id).toBe(first.event.id);
    await expect(recordFullPayment(owner, source.id, { ...request, amount: '41' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    // A deliberately repeated equal-looking real allocation has a new baseline/key.
    await recordFullPayment(owner, source.id, input({ expectedPaidCents: '4000' }));
    expect((await readInvoicePaymentJournal(owner, source.id)).summary?.paidCents).toBe('8000');
  });
  it('independent clients restart stale concurrent allocations; exactly one commits', async () => {
    const source = await invoice();
    // eslint-disable-next-line no-restricted-syntax -- second client to this suite-owned explicit temporary fixture.
    const other = new PrismaClient({ datasources: { db: { url: db.url } } });
    const run = async (client: PrismaClient, request: FullPaymentInput) => {
      for (let attempt = 0; ; attempt++) {
        try { return await client.$transaction(tx => recordFullPaymentInTransaction(tx, owner, source.id, request), { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 20_000 }); }
        catch (error) { if (!isRetryableDatabaseError(error) || attempt >= 7) throw error; await new Promise(resolve => setTimeout(resolve, 25)); }
      }
    };
    try {
      const results = await Promise.allSettled([run(db.client, input()), run(other, input())]);
      expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1);
      expect(results.find(row => row.status === 'rejected')).toMatchObject({ reason: { code: 'PAYMENT_STATE_CHANGED' } });
      expect(await db.client.income.count({ where: { invoiceId: source.id } })).toBe(1);
    } finally { await other.$disconnect(); }
  }, 60_000);
  it('audit failure rolls back second allocation and all settlement projections', async () => {
    const source = await invoice(); await recordFullPayment(owner, source.id, input());
    await db.client.$executeRawUnsafe(`CREATE TRIGGER partial_audit_fail BEFORE INSERT ON AuditLog BEGIN SELECT RAISE(ABORT, 'fixture audit failure'); END;`);
    try { await expect(recordFullPayment(owner, source.id, input({ amount: '80', expectedPaidCents: '4000' }))).rejects.toThrow(); }
    finally { await db.client.$executeRawUnsafe('DROP TRIGGER partial_audit_fail'); }
    expect(await db.client.income.count({ where: { invoiceId: source.id } })).toBe(1);
    expect((await readInvoicePaymentJournal(owner, source.id)).summary?.openCents).toBe('8000');
    expect(await db.client.invoice.findUniqueOrThrow({ where: { id: source.id } })).toMatchObject({ status: 'SENT', paidAt: null });
  });
  it('unknown legacy and unjournaled Income require review, adopted full evidence cannot accept partials', async () => {
    const legacy = await invoice({ userId: owner, fileName: 'x', storedFileName: 'x', parsedData: {}, status: 'PAID' });
    expect(await readInvoicePaymentJournal(owner, legacy.id)).toMatchObject({ summary: null, reviewRequired: true, legacyAdoptionRequired: true, canRecordPayment: false });
    await expect(recordFullPayment(owner, legacy.id, input())).rejects.toMatchObject({ code: 'PAYMENT_REVIEW_REQUIRED' });
    await adoptLegacyPaidInvoice(owner, legacy.id);
    await expect(recordFullPayment(owner, legacy.id, input({ expectedPaidCents: '12000' }))).rejects.toMatchObject({ status: 409 });
    const ambiguous = await invoice();
    await db.client.income.create({ data: { userId: owner, invoiceId: ambiguous.id, amount: 40, date: new Date('2025-12-31'), description: 'Unexplained' } });
    expect(await readInvoicePaymentJournal(owner, ambiguous.id)).toMatchObject({ summary: null, reviewRequired: true, canRecordPayment: false });
    await expect(recordFullPayment(owner, ambiguous.id, input())).rejects.toMatchObject({ code: 'PAYMENT_REVIEW_REQUIRED' });
  });
  it('never derives an overallocated or invalid invoice balance', () => {
    const event = { amountCents: '4000', paidAt: null, dateCertainty: 'UNKNOWN' };
    expect(paymentSummary('120', [event, event])).toMatchObject({ paymentState: 'PARTIAL', openCents: '4000' });
    expect(() => paymentSummary('120', [event, event, event, event])).toThrow();
    expect(() => paymentSummary('invalid', [])).toThrow();
  });
});

it('public Income mutations cannot change a projection and direct database inconsistencies block new allocations', async () => {
  const source = await invoice();
  const allocation = await recordFullPayment(owner, source.id, input());
  const { updateManualIncome, deleteManualIncome } = await import('@/lib/income-service');
  await expect(updateManualIncome(owner, allocation.event.incomeId!, { amount: 41 })).rejects.toMatchObject({ code: 'LINKED_BOOKING' });
  await expect(deleteManualIncome(owner, allocation.event.incomeId!)).rejects.toMatchObject({ code: 'LINKED_BOOKING' });
  // Existing DB triggers protect event immutability, not arbitrary SQL changes
  // to Income; application/restore must fail closed instead of inventing cents.
  await db.client.income.update({ where: { id: allocation.event.incomeId! }, data: { amount: 41 } });
  expect(await readInvoicePaymentJournal(owner, source.id)).toMatchObject({ summary: null, reviewRequired: true, canRecordPayment: false });
  await expect(recordFullPayment(owner, source.id, input({ expectedPaidCents: '4000' }))).rejects.toMatchObject({ code: 'PAYMENT_REVIEW_REQUIRED' });
  expect(await db.client.income.count({ where: { invoiceId: source.id } })).toBe(1);
});

it('keeps exhausted transient failures explicit even after a rolled-back unique-key race', async () => {
  const { Prisma } = await import('@prisma/client');
  const source = await invoice();
  const unique = new Prisma.PrismaClientKnownRequestError('synthetic unique race', { code: 'P2002', clientVersion: 'fixture' });
  const busy = new Prisma.PrismaClientKnownRequestError('synthetic transaction conflict', { code: 'P2034', clientVersion: 'fixture' });
  const transaction = vi.spyOn(db.client, '$transaction').mockRejectedValue(busy).mockRejectedValueOnce(unique);
  try { await expect(recordFullPayment(owner, source.id, input())).rejects.toMatchObject({ status: 503, code: 'PAYMENT_RETRY_REQUIRED' }); }
  finally { transaction.mockRestore(); }
  expect(await db.client.paymentJournalEvent.count({ where: { invoiceId: source.id } })).toBe(0);
  expect(await db.client.income.count({ where: { invoiceId: source.id } })).toBe(0);
});

it('uses an honest technical reference for empty/whitespace legacy invoice numbers without rewriting documents', async () => {
  const old = await invoice({ userId: owner, fileName: 'old', storedFileName: 'old', parsedData: {}, status: 'PAID', invoiceNumber: '' });
  const adopted = await adoptLegacyPaidInvoice(owner, old.id);
  expect(adopted.event).toMatchObject({ source: 'LEGACY_IMPORT', dateCertainty: 'UNKNOWN', reference: `invoice:${old.id}`, incomeId: null, paidAt: null });
  expect((await db.client.invoice.findUniqueOrThrow({ where: { id: old.id } })).invoiceNumber).toBe('');
  const current = await invoice({ userId: owner, fileName: 'current', storedFileName: 'current', parsedData: {}, invoiceNumber: '   ' });
  await updateInvoiceStatus(owner, current.id, 'PAID', '2026-01-02');
  expect(await db.client.paymentJournalEvent.findFirstOrThrow({ where: { invoiceId: current.id } })).toMatchObject({ source: 'LEGACY_STATUS', reference: `invoice:${current.id}` });
  expect((await db.client.invoice.findUniqueOrThrow({ where: { id: current.id } })).invoiceNumber).toBe('   ');
});

it('preserves already-PAID no-op with any linked cashbook projection while blocking changes', async () => {
  const source = await invoice();
  const first = await recordFullPayment(owner, source.id, input());
  await recordFullPayment(owner, source.id, input({ amount: '80', expectedPaidCents: '4000', paidAt: '2026-01-02' }));
  const book = await db.client.cashBook.create({ data: { userId: owner, name: 'Fixture cash' } });
  await db.client.cashTransaction.create({ data: { userId: owner, cashBookId: book.id, incomeId: first.event.incomeId,
    type: 'EINNAHME', description: 'Receipt linked to first allocation', amount: 40, runningBalance: 40, date: new Date('2025-12-31') } });
  const before = await db.client.invoice.findUniqueOrThrow({ where: { id: source.id }, include: { incomes: true, paymentJournalEvents: true } });
  const unchanged = await updateInvoiceStatus(owner, source.id, 'PAID');
  expect(unchanged.incomes).toHaveLength(2);
  const customer = await db.client.customer.create({ data: { userId: owner, name: 'Another customer' } });
  await expect(updateInvoiceStatus(owner, source.id, 'PAID', undefined, customer.id)).rejects.toMatchObject({ status: 409 });
  expect(await db.client.invoice.findUniqueOrThrow({ where: { id: source.id }, include: { incomes: true, paymentJournalEvents: true } })).toEqual(before);
});
