import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
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
vi.mock('@/lib/audit-log', () => ({ createAuditLog: vi.fn() }));
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
    expect((await database.client.income.findUniqueOrThrow({ where: { invoiceId: invoice.id } })).date).toEqual(incomeDate);
    expect(await database.client.invoice.count({ where: { originalInvoiceId: invoice.id } })).toBe(1);
    expect(state.files).toHaveLength(1);
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
      body: JSON.stringify({ invoiceId: invoice.id }),
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
