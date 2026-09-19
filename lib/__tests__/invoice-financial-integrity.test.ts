import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));

import { deleteInvoice, InvoicePaymentError, updateInvoiceStatus } from '@/lib/invoice-payments';

let database: ReturnType<typeof createTestDatabase>;
let invoiceNumber = 0;

async function createInvoice(userId = 'alice', data: Record<string, unknown> = {}) {
  return database.client.invoice.create({
    data: {
      userId,
      fileName: `invoice-${++invoiceNumber}.pdf`,
      storedFileName: `invoice-${invoiceNumber}.pdf`,
      parsedData: {},
      issuanceState: 'UNISSUED',
      ...data,
    },
  });
}

beforeAll(async () => {
  database = createTestDatabase();
  state.client = database.client;
  await database.client.user.createMany({
    data: [
      { id: 'alice', email: 'alice@invoice-integrity.test', password: 'unused' },
      { id: 'bob', email: 'bob@invoice-integrity.test', password: 'unused' },
    ],
  });
}, 40_000);

afterAll(async () => { await database?.cleanup(); });

describe('invoice financial audit and lifecycle boundary', () => {
  it('records payment and income in one successful transaction', async () => {
    const invoice = await createInvoice('alice', { totalAmount: 123.45 });

    const paid = await updateInvoiceStatus('alice', invoice.id, 'PAID', '2026-04-15T12:00:00Z');

    expect(paid.status).toBe('PAID');
    expect(paid.income?.amount).toBe(123.45);
    expect(await database.client.auditLog.count({ where: { userId: 'alice', entityId: String(invoice.id), action: 'PAYMENT_RECEIVED' } })).toBe(1);
    const audit = await database.client.auditLog.findFirstOrThrow({ where: { userId: 'alice', entityId: String(invoice.id), action: 'PAYMENT_RECEIVED' } });
    expect(JSON.parse(audit.metadata!)).toMatchObject({
      actorId: 'alice', tenantId: 'alice', operation: 'invoice.payment', originalReference: `invoice:${invoice.id}`,
    });
  });

  it('rolls back payment and income when the financial audit insert fails', async () => {
    const invoice = await createInvoice('alice', { totalAmount: 50 });
    await database.client.$executeRawUnsafe(`CREATE TRIGGER "audit_insert_failure" BEFORE INSERT ON "AuditLog" BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END;`);
    try {
      await expect(updateInvoiceStatus('alice', invoice.id, 'PAID', '2026-04-16T12:00:00Z')).rejects.toThrow();
    } finally {
      await database.client.$executeRawUnsafe('DROP TRIGGER "audit_insert_failure"');
    }
    const unchanged = await database.client.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { income: true } });
    expect(unchanged.status).toBe('DRAFT');
    expect(unchanged.issuanceState).toBe('UNISSUED');
    expect(unchanged.income).toBeNull();
  });

  it('rolls back draft deletion when its financial audit insert fails', async () => {
    const invoice = await createInvoice('alice');
    await database.client.$executeRawUnsafe(`CREATE TRIGGER "audit_delete_failure" BEFORE INSERT ON "AuditLog" BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END;`);
    try {
      await expect(deleteInvoice('alice', invoice.id)).rejects.toThrow();
    } finally {
      await database.client.$executeRawUnsafe('DROP TRIGGER "audit_delete_failure"');
    }
    expect(await database.client.invoice.findUnique({ where: { id: invoice.id } })).not.toBeNull();
  });

  it('serializes a repeated payment as one business result and one audit event', async () => {
    const invoice = await createInvoice('alice', { totalAmount: 77 });

    const results = await Promise.all([
      updateInvoiceStatus('alice', invoice.id, 'PAID', '2026-04-17T12:00:00Z'),
      updateInvoiceStatus('alice', invoice.id, 'PAID', '2026-04-17T12:00:00Z'),
    ]);

    expect(results).toHaveLength(2);
    expect(await database.client.income.count({ where: { invoiceId: invoice.id } })).toBe(1);
    expect(await database.client.auditLog.count({ where: { entityId: String(invoice.id), action: 'PAYMENT_RECEIVED' } })).toBe(1);
  });

  it('does not disclose or mutate another tenant invoice', async () => {
    const invoice = await createInvoice('alice', { totalAmount: 20 });

    await expect(updateInvoiceStatus('bob', invoice.id, 'PAID')).rejects.toThrow('Rechnung nicht gefunden');
    await expect(deleteInvoice('bob', invoice.id)).rejects.toThrow('Rechnung nicht gefunden');
    const unchanged = await database.client.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { income: true } });
    expect(unchanged.status).toBe('DRAFT');
    expect(unchanged.income).toBeNull();
  });

  it('deletes only an explicitly unissued draft and audits that deletion', async () => {
    const invoice = await createInvoice('alice');

    await expect(deleteInvoice('alice', invoice.id)).resolves.toMatchObject({ deleted: true, id: invoice.id });
    expect(await database.client.invoice.findUnique({ where: { id: invoice.id } })).toBeNull();
    expect(await database.client.auditLog.count({ where: { entityId: String(invoice.id), action: 'DELETE' } })).toBe(1);
  });

  it('keeps legacy/issued drafts and existing income locked', async () => {
    const legacy = await createInvoice('alice', { issuanceState: 'UNKNOWN' });
    await expect(deleteInvoice('alice', legacy.id)).rejects.toMatchObject({ status: 409 } satisfies Partial<InvoicePaymentError>);
    expect(await database.client.invoice.findUnique({ where: { id: legacy.id } })).not.toBeNull();

    const withIncome = await createInvoice('alice', { totalAmount: 10 });
    await database.client.income.create({ data: { userId: 'alice', invoiceId: withIncome.id, description: 'Existing booking', amount: 10 } });
    await expect(deleteInvoice('alice', withIncome.id)).rejects.toMatchObject({ status: 409 } satisfies Partial<InvoicePaymentError>);
    expect(await database.client.income.findUnique({ where: { invoiceId: withIncome.id } })).not.toBeNull();
  });

  it('keeps drafts with a payment date and non-invoice documents locked', async () => {
    const datedDraft = await createInvoice('alice', { paidAt: new Date('2026-04-19T12:00:00Z') });
    await expect(deleteInvoice('alice', datedDraft.id)).rejects.toMatchObject({ status: 409 } satisfies Partial<InvoicePaymentError>);
    expect(await database.client.invoice.findUnique({ where: { id: datedDraft.id } })).not.toBeNull();
    await expect(updateInvoiceStatus('alice', datedDraft.id, 'SENT')).rejects.toMatchObject({ status: 409 } satisfies Partial<InvoicePaymentError>);

    const creditNote = await createInvoice('alice', { type: 'CREDIT_NOTE' });
    await expect(deleteInvoice('alice', creditNote.id)).rejects.toMatchObject({ status: 404 } satisfies Partial<InvoicePaymentError>);
    expect(await database.client.invoice.findUnique({ where: { id: creditNote.id } })).not.toBeNull();
  });

  it('rejects paid reopen and preserves the realized income', async () => {
    const invoice = await createInvoice('alice', { totalAmount: 25 });
    await updateInvoiceStatus('alice', invoice.id, 'PAID', '2026-04-18T12:00:00Z');

    await expect(updateInvoiceStatus('alice', invoice.id, 'SENT')).rejects.toMatchObject({ status: 409 } satisfies Partial<InvoicePaymentError>);
    const persisted = await database.client.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { income: true } });
    expect(persisted.status).toBe('PAID');
    expect(persisted.income).not.toBeNull();
  });
});
