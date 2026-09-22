import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BillingNoteInputError, claimBillingNotesForInvoice, parseBillingNoteInput } from '@/lib/billing-notes';
import { createTestDatabase } from './helpers/database';

const prismaState = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return prismaState.client; } }));

import { updateInvoiceStatus } from '@/lib/invoice-payments';

let database: ReturnType<typeof createTestDatabase>;
let customerId: number;
let otherCustomerId: number;
let replacementCustomerId: number;
let sequence = 0;

function line(description: string, quantity = 1, unit = 'Stunde') {
  return {
    positionNumber: String(sequence++), description, details: null, quantity, unit,
    unitPrice: 100, baseQuantity: 1, baseUnit: unit, amount: quantity * 100, taxRate: 0,
    taxCategory: null, exemptionReason: null,
    charges: [], allowances: [],
  };
}

async function createInvoice(userId = 'owner', items: ReturnType<typeof line>[] = []) {
  return database.client.invoice.create({
    data: {
      userId, fileName: `invoice-${++sequence}.pdf`, storedFileName: `invoice-${sequence}.pdf`,
      parsedData: { lineItems: items }, customerId, issuanceState: 'UNISSUED',
    },
  });
}

beforeAll(async () => {
  database = createTestDatabase();
  await database.client.user.createMany({
    data: [
      { id: 'owner', email: 'owner@billing-notes.test', password: 'unused' },
      { id: 'other', email: 'other@billing-notes.test', password: 'unused' },
    ],
  });
  customerId = (await database.client.customer.create({ data: { userId: 'owner', name: 'Musterkunde' } })).id;
  replacementCustomerId = (await database.client.customer.create({ data: { userId: 'owner', name: 'Ersatzkunde' } })).id;
  otherCustomerId = (await database.client.customer.create({ data: { userId: 'other', name: 'Fremdkunde' } })).id;
  prismaState.client = database.client;
}, 40_000);

afterAll(async () => { await database?.cleanup(); });

describe('billing note validation and reservation', () => {
  it('rejects malformed quantities and preserves the business-date contract', () => {
    expect(() => parseBillingNoteInput({ customerId, serviceDate: '2026-02-30', description: 'Arbeitszeit' })).toThrow(BillingNoteInputError);
    expect(() => parseBillingNoteInput({ customerId, serviceDate: '2026-02-01', description: 'Arbeitszeit', quantity: true })).toThrow(BillingNoteInputError);
    const parsed = parseBillingNoteInput({ customerId, serviceDate: '2026-02-01', description: '  Arbeitszeit  ', quantity: '1.5' });
    expect(parsed).toMatchObject({ description: 'Arbeitszeit', quantity: 1.5, unit: 'Stunde' });
    expect(parsed.serviceDate.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('does not allow another tenant to claim a note', async () => {
    const note = await database.client.billingNote.create({
      data: { userId: 'owner', customerId, serviceDate: new Date('2026-02-01T00:00:00.000Z'), description: 'Arbeitszeit' },
    });
    const invoice = await createInvoice('other', [line('Arbeitszeit')]);
    await expect(database.client.$transaction(tx => claimBillingNotesForInvoice(tx, {
      userId: 'other', customerId: otherCustomerId, invoiceId: invoice.id, billingNoteIds: [note.id], lineItems: [line('Arbeitszeit')],
    }))).rejects.toMatchObject({ status: 404 });
    expect((await database.client.billingNote.findUniqueOrThrow({ where: { id: note.id } })).invoiceId).toBeNull();
  });

  it('rolls back invoice creation when a selected note has no matching line', async () => {
    const note = await database.client.billingNote.create({
      data: { userId: 'owner', customerId, serviceDate: new Date('2026-02-02T00:00:00.000Z'), description: 'Arbeitszeit', quantity: 2 },
    });
    const before = await database.client.invoice.count({ where: { userId: 'owner' } });
    await expect(database.client.$transaction(async tx => {
      const invoice = await tx.invoice.create({
        data: { userId: 'owner', customerId, fileName: 'rollback.pdf', storedFileName: 'rollback.pdf', parsedData: {}, issuanceState: 'UNISSUED' },
      });
      await claimBillingNotesForInvoice(tx, {
        userId: 'owner', customerId, invoiceId: invoice.id, billingNoteIds: [note.id], lineItems: [line('Other line')],
      });
    })).rejects.toMatchObject({ status: 409 });
    expect(await database.client.invoice.count({ where: { userId: 'owner' } })).toBe(before);
    expect((await database.client.billingNote.findUniqueOrThrow({ where: { id: note.id } })).invoiceId).toBeNull();
  });

  it('prevents duplicate claiming and releases a claim when the draft is deleted', async () => {
    const note = await database.client.billingNote.create({
      data: { userId: 'owner', customerId, serviceDate: new Date('2026-02-03T00:00:00.000Z'), description: 'Beratung' },
    });
    const firstInvoice = await createInvoice('owner', [line('Beratung')]);
    await database.client.$transaction(tx => claimBillingNotesForInvoice(tx, {
      userId: 'owner', customerId, invoiceId: firstInvoice.id, billingNoteIds: [note.id], lineItems: [line('Beratung')],
    }));
    const secondInvoice = await createInvoice('owner', [line('Beratung')]);
    await expect(database.client.$transaction(tx => claimBillingNotesForInvoice(tx, {
      userId: 'owner', customerId, invoiceId: secondInvoice.id, billingNoteIds: [note.id], lineItems: [line('Beratung')],
    }))).rejects.toMatchObject({ status: 409 });
    await database.client.invoice.delete({ where: { id: firstInvoice.id } });
    expect((await database.client.billingNote.findUniqueOrThrow({ where: { id: note.id } })).invoiceId).toBeNull();
  });

  it('allows only one concurrent transaction to reserve a note', async () => {
    const note = await database.client.billingNote.create({
      data: { userId: 'owner', customerId, serviceDate: new Date('2026-02-04T00:00:00.000Z'), description: 'Vor-Ort-Termin' },
    });
    const invoices = await Promise.all([createInvoice('owner', [line('Vor-Ort-Termin')]), createInvoice('owner', [line('Vor-Ort-Termin')])]);
    const results = await Promise.allSettled(invoices.map(invoice => database.client.$transaction(tx => claimBillingNotesForInvoice(tx, {
      userId: 'owner', customerId, invoiceId: invoice.id, billingNoteIds: [note.id], lineItems: [line('Vor-Ort-Termin')],
    }))));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const saved = await database.client.billingNote.findUniqueOrThrow({ where: { id: note.id } });
    expect([invoices[0].id, invoices[1].id]).toContain(saved.invoiceId);
  });

  it('blocks customer reassignment after a note is attached', async () => {
    const note = await database.client.billingNote.create({
      data: { userId: 'owner', customerId, serviceDate: new Date('2026-02-05T00:00:00.000Z'), description: 'Festgelegte Leistung' },
    });
    const invoice = await createInvoice('owner', [line('Festgelegte Leistung')]);
    await database.client.billingNote.update({ where: { id: note.id }, data: { invoiceId: invoice.id } });

    await expect(updateInvoiceStatus('owner', invoice.id, undefined, undefined, replacementCustomerId))
      .rejects.toMatchObject({ status: 409 });
    await expect(updateInvoiceStatus('other', invoice.id, undefined, undefined, otherCustomerId))
      .rejects.toMatchObject({ status: 404 });
    expect((await database.client.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).customerId).toBe(customerId);
  });
});
