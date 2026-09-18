import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/audit-log', () => ({ auditCreate: vi.fn(), auditUpdate: vi.fn(), auditDelete: vi.fn(), createAuditLog: vi.fn() }));

import { firstExecution, calculateNextExecution } from '@/lib/recurring-schedule';
import { executeRecurringExpenses } from '@/lib/recurring-expenses-service';
import { cashAmount, createCashTransaction, updateCashTransaction, deleteCashTransaction, recalculateCashBalances } from '@/lib/cashbook-service';
import { inTransaction } from '@/lib/db-transaction';
import { getNextDocumentNumber, previewDocumentNumber } from '@/lib/invoice-numbers';
import { updateInvoiceStatus } from '@/lib/invoice-payments';

let database: ReturnType<typeof createTestDatabase>;
beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  await database.client.user.createMany({ data: ['alice', 'bob'].map(id => ({ id, email: `${id}@test.invalid`, password: 'unused' })) });
}, 40_000);
afterAll(async () => { await database?.cleanup(); });

describe('recurring schedule', () => {
  it('clamps February without skipping it and returns to day 31', () => {
    const feb = calculateNextExecution('MONTHLY', 31, new Date(2026, 0, 31));
    expect([feb.getMonth(), feb.getDate()]).toEqual([1, 28]);
    const march = calculateNextExecution('MONTHLY', 31, feb);
    expect([march.getMonth(), march.getDate()]).toEqual([2, 31]);
    expect(calculateNextExecution('YEARLY', 29, new Date(2024, 1, 29)).getDate()).toBe(28);
    expect(firstExecution('MONTHLY', 1, new Date(2026, 0, 15)).getMonth()).toBe(1);
  });

  it('catches up through a past end date exactly once across concurrent requests', async () => {
    const recurring = await database.client.recurringExpense.create({ data: {
      userId: 'alice', description: 'Monthly fixture', amount: 10, interval: 'MONTHLY', dayOfMonth: 31,
      startDate: new Date(2026, 0, 31), nextExecution: new Date(2026, 0, 31), endDate: new Date(2026, 2, 31),
    } });
    await Promise.all([1, 2].map(() => executeRecurringExpenses('alice', recurring.id, new Date(2026, 3, 15))));
    const entries = await database.client.expense.findMany({ where: { recurringExpenseId: recurring.id }, orderBy: { date: 'asc' } });
    expect(entries).toHaveLength(3);
    expect(entries.map(item => item.date.getMonth())).toEqual([0, 1, 2]);
    expect((await database.client.recurringExpense.findUniqueOrThrow({ where: { id: recurring.id } })).isActive).toBe(false);
  });
});

describe('cash balances and tenant references', () => {
  it('rejects positive sub-cent amounts instead of rounding them to zero', () => {
    expect(() => cashAmount(0.001)).toThrow('Ungültiger Betrag');
    expect(cashAmount(0, false)).toBe(0);
  });

  it('recalculates backdated entries and initial balance in stable order', async () => {
    const book = await database.client.cashBook.create({ data: { userId: 'alice', initialBalance: 100 } });
    const later = await createCashTransaction('alice', { cashBookId: book.id, amount: 10, type: 'EINNAHME', description: 'Later', date: '2026-02-02' });
    const first = await createCashTransaction('alice', { cashBookId: book.id, amount: 20, type: 'AUSGABE', description: 'Earlier', date: '2026-02-01' });
    expect((await database.client.cashTransaction.findUniqueOrThrow({ where: { id: later.id } })).runningBalance).toBe(90);
    await inTransaction(async tx => {
      await tx.cashBook.update({ where: { id: book.id }, data: { initialBalance: 200 } });
      await recalculateCashBalances(tx, book.id, 'alice');
    });
    expect((await database.client.cashTransaction.findUniqueOrThrow({ where: { id: later.id } })).runningBalance).toBe(190);
    await deleteCashTransaction('alice', first.id);
    expect((await database.client.cashTransaction.findUniqueOrThrow({ where: { id: later.id } })).runningBalance).toBe(210);
    await expect(updateCashTransaction('alice', later.id, { amount: 'NaN' })).rejects.toThrow();
    const income = await database.client.income.create({ data: { userId: 'bob', description: 'Private', amount: 10 } });
    await expect(createCashTransaction('alice', { cashBookId: book.id, amount: 10, type: 'EINNAHME', description: 'Foreign', incomeId: income.id })).rejects.toThrow('Einnahme nicht gefunden');
  });

  it('requires linked income and expense amount/date to match the cash entry', async () => {
    const book = await database.client.cashBook.create({ data: { userId: 'alice', initialBalance: 0 } });
    const income = await database.client.income.create({
      data: { userId: 'alice', description: 'Linked income', amount: 10, date: new Date('2026-05-04T15:30:00.000Z') },
    });
    const linked = await createCashTransaction('alice', {
      cashBookId: book.id, amount: 10, type: 'EINNAHME', description: 'Linked income',
      date: '2026-05-04', incomeId: income.id,
    });
    expect(linked.incomeId).toBe(income.id);
    await expect(createCashTransaction('alice', {
      cashBookId: book.id, amount: 10, type: 'EINNAHME', description: 'Duplicate link',
      date: '2026-05-04', incomeId: income.id,
    })).rejects.toThrow('bereits mit dem Kassenbuch verknüpft');
    const mismatchedIncome = await database.client.income.create({
      data: { userId: 'alice', description: 'Mismatched income', amount: 10, date: new Date('2026-05-04T15:30:00.000Z') },
    });
    await expect(createCashTransaction('alice', {
      cashBookId: book.id, amount: 9.99, type: 'EINNAHME', description: 'Wrong amount',
      date: '2026-05-04', incomeId: mismatchedIncome.id,
    })).rejects.toThrow('Betrag und Datum');
    await expect(createCashTransaction('alice', {
      cashBookId: book.id, amount: 10, type: 'EINNAHME', description: 'Wrong date',
      date: '2026-05-05', incomeId: mismatchedIncome.id,
    })).rejects.toThrow('Betrag und Datum');

    const expense = await database.client.expense.create({
      data: { userId: 'alice', description: 'Linked expense', amount: 3.5, date: new Date('2026-05-06T23:00:00.000Z') },
    });
    await expect(createCashTransaction('alice', {
      cashBookId: book.id, amount: 3.5, type: 'AUSGABE', description: 'Linked expense',
      date: '2026-05-06', expenseId: expense.id,
    })).resolves.toMatchObject({ expenseId: expense.id });
  });

  it('serializes same-day concurrent entries and leaves a complete balance suffix', async () => {
    const book = await database.client.cashBook.create({ data: { userId: 'alice', initialBalance: 0 } });
    const entries = await Promise.all(Array.from({ length: 5 }, (_, index) => createCashTransaction('alice', {
      cashBookId: book.id, amount: 10, type: 'EINNAHME', description: `Concurrent ${index}`, date: '2026-06-01',
    })));
    expect(entries).toHaveLength(5);
    const rows = await database.client.cashTransaction.findMany({
      where: { cashBookId: book.id }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(rows).toHaveLength(5);
    expect(rows.map(row => row.runningBalance)).toEqual([10, 20, 30, 40, 50]);
  });

  it('allows only one concurrent cash link for an income', async () => {
    const book = await database.client.cashBook.create({ data: { userId: 'alice', initialBalance: 0 } });
    const income = await database.client.income.create({
      data: { userId: 'alice', description: 'Single link', amount: 7, date: new Date('2026-06-02T00:00:00.000Z') },
    });
    const results = await Promise.allSettled([1, 2].map(index => createCashTransaction('alice', {
      cashBookId: book.id, amount: 7, type: 'EINNAHME', description: `Link ${index}`, date: '2026-06-02', incomeId: income.id,
    })));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(await database.client.cashTransaction.count({ where: { incomeId: income.id } })).toBe(1);
  });
});

describe('invoice numbers and payment lifecycle', () => {
  it('increments beyond 100, permits equal numbers for different tenants and serializes reservations', async () => {
    const fixture = { fileName: 'test.pdf', storedFileName: 'test.pdf', parsedData: {}, userId: 'alice' };
    for (const number of ['2026-99', '2026-100']) await database.client.invoice.create({ data: { ...fixture, invoiceNumber: number } });
    expect((await previewDocumentNumber(database.client, 'alice', 'INVOICE', 2026)).number).toBe('2026-101');
    const numbers = await Promise.all([1, 2].map(() => inTransaction(async tx => {
      const number = await getNextDocumentNumber(tx, 'alice', 'INVOICE', 2026);
      await tx.invoice.create({ data: { ...fixture, invoiceNumber: number } });
      return number;
    })));
    expect(new Set(numbers).size).toBe(2);
    await database.client.invoice.create({ data: { ...fixture, userId: 'bob', invoiceNumber: '2026-100' } });
  });

  it('creates one income on payment, preserves its date on retries and removes it on reopening', async () => {
    const invoice = await database.client.invoice.create({ data: { userId: 'alice', fileName: 'test.pdf', storedFileName: 'test.pdf', parsedData: {}, totalAmount: 123.45 } });
    const paid = await updateInvoiceStatus('alice', invoice.id, 'PAID', '2026-04-15T12:00:00Z');
    expect(paid.income?.amount).toBe(123.45);
    expect(paid.income?.date.toISOString()).toBe('2026-04-15T12:00:00.000Z');
    const repeated = await updateInvoiceStatus('alice', invoice.id, 'PAID');
    expect(repeated.income?.id).toBe(paid.income?.id);
    expect(repeated.paidAt).toEqual(paid.paidAt);
    const reopened = await updateInvoiceStatus('alice', invoice.id, 'SENT');
    expect(reopened.income).toBeNull(); expect(reopened.paidAt).toBeNull();
    await expect(updateInvoiceStatus('bob', invoice.id, 'PAID')).rejects.toThrow('Rechnung nicht gefunden');
  });

  it('rejects payment for a legacy stored e-invoice whose raw XML is foreign currency', async () => {
    const invoice = await database.client.invoice.create({
      data: {
        userId: 'alice', fileName: 'legacy.xml', storedFileName: 'legacy.xml', totalAmount: 100,
        parsedData: {
          eInvoiceFormat: 'UBL',
          rawXml: '<Invoice><ID>USD-1</ID><IssueDate>2026-09-18</IssueDate><DocumentCurrencyCode>USD</DocumentCurrencyCode><LegalMonetaryTotal><TaxInclusiveAmount currencyID="USD">100</TaxInclusiveAmount><PayableAmount currencyID="USD">100</PayableAmount></LegalMonetaryTotal></Invoice>',
        },
      },
    });

    await expect(updateInvoiceStatus('alice', invoice.id, 'PAID')).rejects.toThrow('währung');
    expect(await database.client.income.findUnique({ where: { invoiceId: invoice.id } })).toBeNull();
  });
});
