import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';
import { adoptLegacyPaidInvoice, readInvoicePaymentJournal, recordFullPayment, recordFullPaymentInTransaction } from '@/lib/payment-journal/service';
import { exactPaymentCents, paymentDate, paymentSummary, type FullPaymentInput } from '@/lib/payment-journal/contract';
import { updateInvoiceStatus } from '@/lib/invoice-payments';
import { PrismaClient as IndependentPrismaClient } from '@prisma/client';
import { isRetryableDatabaseError } from '@/lib/db-transaction';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
let database: ReturnType<typeof createTestDatabase>;
let next = 0;
async function invoice(data: Record<string, unknown> = {}) {
  return database.client.invoice.create({ data: { userId: 'payment-owner', fileName: 'invoice.pdf', storedFileName: 'invoice.pdf',
    parsedData: {}, totalAmount: 123.45, status: 'SENT', issuanceState: 'ISSUED', ...data } });
}
function input(overrides: Partial<FullPaymentInput> = {}): FullPaymentInput {
  return { amount: '123.45', currency: 'EUR', paidAt: '2026-10-19', source: 'MANUAL', reference: 'Bank transfer statement 10/19', idempotencyKey: `payment-${++next}`, ...overrides };
}
beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  await database.client.user.createMany({ data: ['payment-owner', 'payment-other'].map(id => ({ id, email: `${id}@test.invalid`, password: 'fixture' })) });
}, 40_000);
afterAll(async () => { await database?.cleanup(); });

describe('exact first-full-payment contract', () => {
  it.each(['0', '-1', '0.001', 'NaN', 'Infinity', '90071992547409.91'])('rejects invalid/unsafe amount %s', amount => {
    expect(() => exactPaymentCents(amount)).toThrow();
  });
  it('parses cents and derives paid/open once, not event plus Income', () => {
    expect(exactPaymentCents('123.45')).toBe(BigInt(12345));
    expect(paymentSummary('123.45')).toMatchObject({ paidCents: '0', openCents: '12345', paid: false });
    expect(paymentSummary('123.45', { amountCents: '12345', paidAt: null, dateCertainty: 'UNKNOWN' })).toMatchObject({ paidCents: '12345', openCents: '0', paid: true });
  });
  it.each(['2026-02-30', '2026-13-01', '2026-1-1', '', '2026-10-19T00:00:00Z'])('rejects non-calendar input %s', date => {
    expect(() => paymentDate(date)).toThrow();
  });
  it('supports exact ISO instants only for legacy compatibility', () => {
    expect(paymentDate('2026-10-19T12:00:00Z', true).toISOString()).toBe('2026-10-19T12:00:00.000Z');
    expect(() => paymentDate('2026-02-30T12:00:00Z', true)).toThrow();
  });
});

describe('atomic tenant payment journal', () => {
  it('creates one exact event, one Income, derived PAID and transactional audit on actual date', async () => {
    const source = await invoice();
    const result = await recordFullPayment('payment-owner', source.id, input());
    expect(result).toMatchObject({ replayed: false, event: { amountCents: '12345', dateCertainty: 'ACTUAL' }, summary: { paid: true, openCents: '0' } });
    const saved = await database.client.invoice.findUniqueOrThrow({ where: { id: source.id }, include: { incomes: true, paymentJournalEvents: true } });
    expect(saved.status).toBe('PAID'); expect(saved.incomes[0]?.amount).toBe(123.45);
    expect(saved.incomes[0]?.date.toISOString()).toBe('2026-10-19T00:00:00.000Z');
    expect(saved.paymentJournalEvents[0]?.incomeId).toBe(saved.incomes[0]?.id);
    expect(await database.client.auditLog.count({ where: { entityId: String(source.id), action: 'PAYMENT_RECEIVED' } })).toBe(1);
  });
  it('parallel same-key retries commit once and replay unchanged', async () => {
    const source = await invoice(); const request = input();
    const results = await Promise.all(Array.from({ length: 4 }, () => recordFullPayment('payment-owner', source.id, request)));
    expect(results.filter(result => !result.replayed)).toHaveLength(1);
    expect(new Set(results.map(result => result.event.id)).size).toBe(1);
    expect(await database.client.income.count({ where: { invoiceId: source.id } })).toBe(1);
    expect(await database.client.auditLog.count({ where: { entityId: String(source.id), action: 'PAYMENT_RECEIVED' } })).toBe(1);
  });
  it('retries independent-client serializable races as one full payment', async () => {
    const source = await invoice(); const request = input();
    // Second connection to this fresh temporary fixture only.
    const otherClient = new IndependentPrismaClient({ datasources: { db: { url: database.url } } });
    const run = async (client: PrismaClient) => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await client.$transaction(tx => recordFullPaymentInTransaction(tx, 'payment-owner', source.id, request), {
            isolationLevel: 'Serializable', maxWait: 10_000, timeout: 20_000,
          });
        } catch (error) {
          if (!isRetryableDatabaseError(error) || attempt >= 7) throw error;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      }
    };
    try {
      const results = await Promise.all([run(database.client), run(otherClient)]);
      expect(new Set(results.map(result => result.event.id)).size).toBe(1);
      expect(results.filter(result => !result.replayed)).toHaveLength(1);
      expect(await database.client.income.count({ where: { invoiceId: source.id } })).toBe(1);
    } finally { await otherClient.$disconnect(); }
  }, 60_000);
  it('parallel different keys cannot double-book', async () => {
    const source = await invoice();
    const results = await Promise.allSettled([recordFullPayment('payment-owner', source.id, input()), recordFullPayment('payment-owner', source.id, input())]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await database.client.paymentJournalEvent.count({ where: { invoiceId: source.id } })).toBe(1);
    expect(await database.client.income.count({ where: { invoiceId: source.id } })).toBe(1);
  });
  it('rejects changed payload and cross-invoice idempotency-key reuse', async () => {
    const source = await invoice(); const other = await invoice(); const request = input();
    await recordFullPayment('payment-owner', source.id, request);
    await expect(recordFullPayment('payment-owner', source.id, { ...request, paidAt: '2026-10-18' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
    await expect(recordFullPayment('payment-owner', other.id, request)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(await database.client.income.count({ where: { invoiceId: other.id } })).toBe(0);
  });
  it.each([{ amount: '0' }, { amount: '-2' }, { amount: '123.451' }, { amount: '123.46' }, { amount: '100' }, { currency: 'USD' }, { paidAt: '2026-02-30' }, { reference: '' }])('prevents writes for %j', async changes => {
    const source = await invoice();
    await expect(recordFullPayment('payment-owner', source.id, input(changes))).rejects.toThrow();
    expect(await database.client.income.count({ where: { invoiceId: source.id } })).toBe(0);
    expect(await database.client.paymentJournalEvent.count({ where: { invoiceId: source.id } })).toBe(0);
    expect((await database.client.invoice.findUniqueOrThrow({ where: { id: source.id } })).status).toBe('SENT');
  });
  it.each([{ type: 'QUOTE' }, { type: 'CREDIT_NOTE' }, { status: 'CANCELLED' }, { parsedData: { currency: 'USD' } }, { totalAmount: 0 }, { totalAmount: -1 }])('prevents unsupported invoice writes %j', async changes => {
    const source = await invoice(changes);
    await expect(recordFullPayment('payment-owner', source.id, input())).rejects.toThrow();
    expect(await database.client.income.count({ where: { invoiceId: source.id } })).toBe(0);
  });
  it('does not disclose foreign invoices or payment journal', async () => {
    const source = await invoice();
    await expect(recordFullPayment('payment-other', source.id, input())).rejects.toMatchObject({ status: 404 });
    await expect(readInvoicePaymentJournal('payment-other', source.id)).rejects.toMatchObject({ status: 404 });
    await expect(adoptLegacyPaidInvoice('payment-other', source.id)).rejects.toMatchObject({ status: 404 });
  });
  it('rejects legacy invoice links to foreign customers without creating an Income', async () => {
    const customer = await database.client.customer.create({ data: { userId: 'payment-other', name: 'Foreign customer' } });
    const source = await invoice({ customerId: customer.id });
    await expect(recordFullPayment('payment-owner', source.id, input())).rejects.toMatchObject({ code: 'PAYMENT_REVIEW_REQUIRED' });
    expect(await database.client.income.count({ where: { invoiceId: source.id } })).toBe(0);
  });
  it('rolls back all payment writes on mandatory audit failure', async () => {
    const source = await invoice();
    await database.client.$executeRawUnsafe(`CREATE TRIGGER payment_test_audit_fail BEFORE INSERT ON AuditLog BEGIN SELECT RAISE(ABORT, 'test audit failure'); END;`);
    try { await expect(recordFullPayment('payment-owner', source.id, input())).rejects.toThrow(); }
    finally { await database.client.$executeRawUnsafe('DROP TRIGGER payment_test_audit_fail'); }
    expect(await database.client.income.count({ where: { invoiceId: source.id } })).toBe(0);
    expect(await database.client.paymentJournalEvent.count({ where: { invoiceId: source.id } })).toBe(0);
    expect((await database.client.invoice.findUniqueOrThrow({ where: { id: source.id } })).status).toBe('SENT');
  });
  it('rejects event edits/deletes and cross-tenant links at database boundary', async () => {
    const source = await invoice(); const result = await recordFullPayment('payment-owner', source.id, input());
    await expect(database.client.paymentJournalEvent.update({ where: { id: result.event.id }, data: { reference: 'changed' } })).rejects.toThrow();
    await expect(database.client.paymentJournalEvent.delete({ where: { id: result.event.id } })).rejects.toThrow();
    const other = await invoice();
    await expect(database.client.paymentJournalEvent.create({ data: { userId: 'payment-other', invoiceId: other.id, amountCents: '12345', currency: 'EUR', paidAt: null, dateCertainty: 'UNKNOWN', source: 'LEGACY_IMPORT', reference: 'bad', idempotencyKey: input().idempotencyKey } })).rejects.toThrow();
  });
  it('keeps the immutable realized event and Income when invoice is cancelled', async () => {
    const source = await invoice(); const result = await recordFullPayment('payment-owner', source.id, input());
    await database.client.invoice.update({ where: { id: source.id }, data: { status: 'CANCELLED' } });
    expect((await readInvoicePaymentJournal('payment-owner', source.id)).summary).toMatchObject({ paidCents: '12345', openCents: '0' });
    expect(await database.client.income.findUnique({ where: { id: result.event.incomeId! } })).not.toBeNull();
    await expect(recordFullPayment('payment-owner', source.id, input())).rejects.toMatchObject({ status: 409 });
  });
  it.each([null, '', '   ', '  INV-66  '])('uses a nonblank new legacy status reference for invoice number %j', async invoiceNumber => {
    const source = await invoice({ invoiceNumber });
    const paid = await updateInvoiceStatus('payment-owner', source.id, 'PAID', '2026-10-19');
    const event = await database.client.paymentJournalEvent.findFirstOrThrow({ where: { invoiceId: source.id } });
    expect(event).toMatchObject({ reference: invoiceNumber?.trim() || `invoice:${source.id}`,
      source: 'LEGACY_STATUS', dateCertainty: 'ACTUAL', paidAt: new Date('2026-10-19'), incomeId: paid.incomes[0]?.id });
    expect(paid.invoiceNumber).toBe(invoiceNumber);
    await updateInvoiceStatus('payment-owner', source.id, 'PAID');
    expect(await database.client.paymentJournalEvent.findUniqueOrThrow({ where: { id: event.id } })).toEqual(event);
    expect(await database.client.income.count({ where: { invoiceId: source.id } })).toBe(1);
  });
  it('keeps normal draft/sent lifecycle and rejects ambiguous PAID without inventing a date', async () => {
    const source = await invoice({ status: 'DRAFT', issuanceState: 'UNISSUED' });
    expect((await updateInvoiceStatus('payment-owner', source.id, 'SENT')).status).toBe('SENT');
    await expect(updateInvoiceStatus('payment-owner', source.id, 'PAID')).rejects.toMatchObject({ code: 'PAYMENT_DETAILS_REQUIRED' });
    expect(await database.client.paymentJournalEvent.count({ where: { invoiceId: source.id } })).toBe(0);
    const paid = await updateInvoiceStatus('payment-owner', source.id, 'PAID', '2026-10-19');
    expect(paid.incomes[0]?.date.toISOString()).toBe('2026-10-19T00:00:00.000Z');
    expect((await updateInvoiceStatus('payment-owner', source.id, 'PAID')).incomes[0]?.id).toBe(paid.incomes[0]?.id);
  });
});

describe('explicit legacy payment adoption', () => {
  it.each([null, '', '   ', '  INV-66  '])('uses a nonblank new legacy adoption reference for invoice number %j without inventing finances', async invoiceNumber => {
    const userId = `payment-adopt-number-${++next}`;
    await database.client.user.create({ data: { id: userId, email: `${userId}@test.invalid`, password: 'fixture' } });
    const source = await invoice({ userId, invoiceNumber, status: 'PAID', paidAt: null });
    const adopted = await adoptLegacyPaidInvoice(userId, source.id);
    expect(adopted.event).toMatchObject({ reference: invoiceNumber?.trim() || `invoice:${source.id}`,
      source: 'LEGACY_IMPORT', dateCertainty: 'UNKNOWN', paidAt: null, incomeId: null });
    const replay = await adoptLegacyPaidInvoice(userId, source.id);
    expect(replay.replayed).toBe(true);
    expect(replay.event).toEqual(adopted.event);
    expect(await database.client.invoice.findUniqueOrThrow({ where: { id: source.id } })).toEqual(source);
    expect(await database.client.income.count({ where: { invoiceId: source.id } })).toBe(0);
    expect(await database.client.auditLog.count({ where: { entityId: String(source.id), action: 'IMPORT' } })).toBe(1);
  });
  it('adopts unknown historical dates once, without creating an Income or changing finances', async () => {
    const source = await invoice({ status: 'PAID', paidAt: null });
    const results = await Promise.all([adoptLegacyPaidInvoice('payment-owner', source.id), adoptLegacyPaidInvoice('payment-owner', source.id)]);
    expect(results[0].event).toMatchObject({ paidAt: null, incomeId: null, dateCertainty: 'UNKNOWN', source: 'LEGACY_IMPORT' });
    expect(results[1].event.id).toBe(results[0].event.id);
    expect(await database.client.income.count({ where: { invoiceId: source.id } })).toBe(0);
    expect((await database.client.invoice.findUniqueOrThrow({ where: { id: source.id } })).paidAt).toBeNull();
    expect(await database.client.auditLog.count({ where: { entityId: String(source.id), action: 'IMPORT' } })).toBe(1);
  });
  it('links existing Income once and preserves its historical date and amount', async () => {
    const source = await invoice({ status: 'PAID', paidAt: null });
    const income = await database.client.income.create({ data: { userId: 'payment-owner', invoiceId: source.id, amount: 123.45, date: new Date('2024-12-31T12:00:00Z'), description: 'Existing historical booking' } });
    const adopted = await adoptLegacyPaidInvoice('payment-owner', source.id);
    expect(adopted.event).toMatchObject({ incomeId: income.id, dateCertainty: 'LEGACY_INCOME', paidAt: income.date });
    expect(await database.client.income.findUnique({ where: { id: income.id } })).toEqual(income);
    expect(await database.client.income.count({ where: { invoiceId: source.id } })).toBe(1);
  });
  it('retains a known legacy invoice date without manufacturing a missing Income', async () => {
    const paidAt = new Date('2024-04-01T00:00:00Z'); const source = await invoice({ status: 'PAID', paidAt });
    expect((await adoptLegacyPaidInvoice('payment-owner', source.id)).event).toMatchObject({ incomeId: null, paidAt, dateCertainty: 'LEGACY_INVOICE' });
    expect(await database.client.income.count({ where: { invoiceId: source.id } })).toBe(0);
  });
  it('rejects conflicting legacy amount/date without mutation', async () => {
    const source = await invoice({ status: 'PAID', paidAt: new Date('2024-04-01') });
    await database.client.income.create({ data: { userId: 'payment-owner', invoiceId: source.id, amount: 100, date: new Date('2024-04-02'), description: 'Conflict' } });
    await expect(adoptLegacyPaidInvoice('payment-owner', source.id)).rejects.toMatchObject({ code: 'PAYMENT_REVIEW_REQUIRED' });
    expect(await database.client.paymentJournalEvent.count({ where: { invoiceId: source.id } })).toBe(0);
  });
});
