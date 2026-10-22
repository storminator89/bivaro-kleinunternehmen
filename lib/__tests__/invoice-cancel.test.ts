import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({
  client: null as unknown,
  userId: 'alice',
  directory: null as string | null,
  files: [] as string[],
  fileNumber: 0,
  lastPdfData: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({
  requireUserId: async () => state.userId,
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/credit-note-pdf', () => ({
  generateCreditNotePDF: vi.fn(async (data: Record<string, unknown>) => {
    state.lastPdfData = data;
    return new Uint8Array([37, 80, 68, 70]);
  }),
}));
vi.mock('@/lib/upload-path', () => ({
  writeTenantFile: vi.fn(async (_userId: string, _originalName: string, bytes: Uint8Array) => {
    if (!state.directory) throw new Error('test storage is not initialized');
    const storedName = `credit-note-${++state.fileNumber}.pdf`;
    const filePath = path.join(state.directory, storedName);
    writeFileSync(filePath, bytes);
    state.files.push(filePath);
    return storedName;
  }),
  deleteTenantFile: vi.fn(async (_userId: string, storedName: string) => {
    if (!state.directory) return;
    try { unlinkSync(path.join(state.directory, storedName)); } catch { /* best effort */ }
  }),
}));

import { CURRENT_SCHEMA_VERSION, validatePaymentTermBackupFields } from '@/lib/backup-manifest';
import { paymentTermSuggestion } from '@/lib/payment-terms';
import { POST as cancelInvoice } from '@/app/api/invoices/cancel/route';

let database: ReturnType<typeof createTestDatabase>;

beforeAll(async () => {
  state.directory = mkdtempSync(path.join(tmpdir(), 'bivaro-cancel-'));
  database = createTestDatabase();
  state.client = database.client;
  await database.client.user.create({ data: { id: 'alice', email: 'alice@cancel.test', password: 'unused' } });
}, 40_000);

afterAll(async () => {
  await database?.cleanup();
  if (state.directory) rmSync(state.directory, { recursive: true, force: true });
});

describe('invoice cancellation', () => {
  it('preserves the income date for a legacy paid invoice without paidAt', async () => {
    const incomeDate = new Date('2025-04-12T10:30:00.000Z');
    const invoice = await database.client.invoice.create({
      data: {
        userId: 'alice',
        type: 'INVOICE',
        fileName: 'legacy-invoice.pdf',
        storedFileName: 'legacy-invoice.pdf',
        parsedData: { items: [] },
        invoiceNumber: '2025-07',
        totalAmount: 120,
        status: 'PAID',
        paidAt: null,
      },
    });
    await database.client.income.create({
      data: {
        userId: 'alice',
        invoiceId: invoice.id,
        description: 'Legacy payment',
        amount: 120,
        date: incomeDate,
      },
    });

    const response = await cancelInvoice(new Request('http://localhost/api/invoices/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invoiceId: invoice.id, cancellationReason: 'Legacy correction' }),
    }));

    expect(response.status).toBe(200);
    const persisted = await database.client.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(persisted.status).toBe('CANCELLED');
    expect(persisted.paidAt).toEqual(incomeDate);
    expect((await database.client.income.findFirstOrThrow({ where: { invoiceId: invoice.id } })).date).toEqual(incomeDate);
    expect(await database.client.invoice.count({ where: { originalInvoiceId: invoice.id } })).toBe(1);
    expect(state.files).toHaveLength(1);
    expect(persisted.cancellationReason).toBe('Legacy correction');
    const counters = await database.client.invoiceNumberCounter.findMany();
    const duplicate = await cancelInvoice(new Request('http://localhost/api/invoices/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invoiceId: invoice.id, cancellationReason: 'Explicit retry' }) }));
    expect(duplicate.status).toBe(400);
    expect(await database.client.invoiceNumberCounter.findMany()).toEqual(counters);
  });

  it('preserves original payment-term evidence without copying it into a new credit note', async () => {
    const parsedData = { items: [], paymentTermSelection: paymentTermSuggestion('2026-10-22', null) };
    const invoice = await database.client.invoice.create({ data: {
      userId: 'alice', type: 'INVOICE', fileName: 'terms.pdf', storedFileName: 'terms.pdf',
      invoiceNumber: 'PAYMENT-TERMS-CANCEL', invoiceDate: new Date('2026-10-22T00:00:00.000Z'),
      dueDate: new Date('2026-11-05T00:00:00.000Z'), parsedData, totalAmount: 10, status: 'SENT',
    } });
    const response = await cancelInvoice(new Request('http://localhost/api/invoices/cancel', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invoiceId: invoice.id, cancellationReason: 'Synthetic provenance preservation' }),
    }));
    expect(response.status).toBe(200);
    const original = await database.client.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    const credit = await database.client.invoice.findFirstOrThrow({ where: { originalInvoiceId: invoice.id } });
    expect(original.parsedData).toEqual(parsedData); expect(original.dueDate).toEqual(invoice.dueDate);
    expect(credit.parsedData).not.toHaveProperty('paymentTermSelection');
    expect(() => validatePaymentTermBackupFields({ invoices: [original, credit] }, CURRENT_SCHEMA_VERSION)).not.toThrow();
  });

  it('cancels price-basis lines using the original line amount', async () => {
    const invoice = await database.client.invoice.create({
      data: {
        userId: 'alice',
        type: 'INVOICE',
        fileName: 'basis-invoice.xml',
        storedFileName: 'basis-invoice.xml',
        parsedData: {
          eInvoiceFormat: 'UBL',
          documentType: 'INVOICE',
          currency: 'EUR',
          grossAmount: 10,
          netAmount: 10,
          taxAmount: 0,
          dueAmount: 10,
          lineItems: [{
            description: 'Material', quantity: 200, unitPrice: 5, baseQuantity: 100,
            amount: 10, unit: 'Stück', taxRate: 0, allowances: [], charges: [],
          }],
        },
        invoiceNumber: 'BASIS-1',
        totalAmount: 10,
        status: 'SENT',
      },
    });

    const response = await cancelInvoice(new Request('http://localhost/api/invoices/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invoiceId: invoice.id, cancellationReason: 'Price basis correction' }),
    }));

    expect(response.status).toBe(200);
    const pdfData = state.lastPdfData as { items: Array<Record<string, unknown>>; grossAmount: number; netAmount: number };
    expect(pdfData.items[0]).toMatchObject({ quantity: 200, unitPrice: 5, baseQuantity: 100, amount: 10 });
    expect(pdfData.netAmount).toBe(10);
    expect(pdfData.grossAmount).toBe(10);
    const creditNote = await database.client.invoice.findFirstOrThrow({ where: { originalInvoiceId: invoice.id } });
    expect(creditNote.totalAmount).toBe(-10);
  });
});


describe('explicit cancellation reason boundary', () => {
  async function original() {
    return database.client.invoice.create({ data: { userId: 'alice', fileName: 'reason.pdf', storedFileName: 'reason.pdf', parsedData: { items: [] }, totalAmount: 100, status: 'SENT', issuanceState: 'ISSUED' } });
  }
  async function snapshot(id: number) {
    return { invoice: await database.client.invoice.findUnique({ where: { id } }), credits: await database.client.invoice.count({ where: { originalInvoiceId: id } }), counters: await database.client.invoiceNumberCounter.findMany(), audits: await database.client.auditLog.count(), files: state.files.filter(file => existsSync(file)) };
  }
  function request(invoiceId: number, cancellationReason: unknown) {
    return new Request('http://localhost/api/invoices/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invoiceId, cancellationReason }) });
  }
  it.each([undefined, null, '', '   ', 42, {}, [], 'bad\u0000reason', 'x'.repeat(1001)])('rejects absent, nontext, blank, control or oversized reason without side effects (%j)', async value => {
    const invoice = await original(), before = await snapshot(invoice.id);
    const response = await cancelInvoice(request(invoice.id, value));
    expect(response.status).toBe(400); expect(await response.json()).toHaveProperty('fieldErrors.cancellationReason');
    expect(await snapshot(invoice.id)).toEqual(before);
  });
  it('stores the same explicit trimmed reason on original, correction and both audit entries', async () => {
    const invoice = await original(); const response = await cancelInvoice(request(invoice.id, '  Explicit synthetic correction  '));
    expect(response.status).toBe(200);
    const credit = await database.client.invoice.findFirstOrThrow({ where: { originalInvoiceId: invoice.id } });
    expect(credit.cancellationReason).toBe('Explicit synthetic correction');
    expect((await database.client.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).cancellationReason).toBe(credit.cancellationReason);
    const entries = await database.client.auditLog.findMany({ where: { userId: 'alice', OR: [{ entityType: 'Invoice', entityId: String(invoice.id) }, { entityType: 'CreditNote', entityId: String(credit.id) }] } });
    expect(entries).toHaveLength(2);
    expect(entries.every(entry => JSON.parse(entry.metadata!).reason === credit.cancellationReason)).toBe(true);
  });
  it('rolls back document and number allocation if the required cancellation audit cannot be stored', async () => {
    const invoice = await original(), before = await snapshot(invoice.id);
    await database.client.$executeRawUnsafe(`CREATE TRIGGER fail_cancellation_audit BEFORE INSERT ON AuditLog WHEN NEW.action = 'CANCELLED' BEGIN SELECT RAISE(ABORT, 'synthetic cancellation audit failure'); END`);
    const silence = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await cancelInvoice(request(invoice.id, 'Explicit failed-audit correction'));
      expect(response.status).toBe(409); expect(await snapshot(invoice.id)).toEqual(before);
    } finally {
      silence.mockRestore(); await database.client.$executeRawUnsafe('DROP TRIGGER fail_cancellation_audit');
    }
  });
});


describe('cancellation input and ownership regression', () => {
  it('rejects malformed JSON with a clear 400 before allocating a number', async () => {
    const before = await database.client.invoiceNumberCounter.findMany();
    const response = await cancelInvoice(new Request('http://localhost/api/invoices/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }));
    expect(response.status).toBe(400); expect(await database.client.invoiceNumberCounter.findMany()).toEqual(before);
  });
  it('preserves multiline explicit reasons and never cancels another owner document', async () => {
    const invoice = await database.client.invoice.create({ data: { userId: 'alice', fileName: 'multiline.pdf', storedFileName: 'multiline.pdf', parsedData: { items: [] }, totalAmount: 10, status: 'SENT' } });
    const request = () => new Request('http://localhost/api/invoices/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invoiceId: invoice.id, cancellationReason: '  First line\r\nSecond line  ' }) });
    state.userId = 'other-owner';
    try { expect((await cancelInvoice(request())).status).toBe(404); } finally { state.userId = 'alice'; }
    expect((await cancelInvoice(request())).status).toBe(200);
    expect((await database.client.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).cancellationReason).toBe('First line\nSecond line');
  });
});
