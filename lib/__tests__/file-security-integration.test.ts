import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as unknown, userId: 'alice' }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({ requireUserId: async () => state.userId, UnauthorizedError: class extends Error {}, unauthorizedResponse: () => new Response(null, { status: 401 }) }));
vi.mock('@/lib/audit-log', () => ({ auditCreate: vi.fn(), auditDelete: vi.fn(), auditUpdate: vi.fn(), createAuditLog: vi.fn(), auditBackup: vi.fn(), auditSecurityEvent: vi.fn() }));

let database: ReturnType<typeof createTestDatabase>;
let directory: string;
let storage: typeof import('@/lib/upload-path');
let restore: typeof import('@/lib/backup-restore');
let quotes: typeof import('@/app/api/quotes/route');
let download: typeof import('@/app/api/invoices/download/route');
let incomeRoute: typeof import('@/app/api/incomes/route');
let upload: typeof import('@/app/api/invoices/upload/route');
let exportFull: typeof import('@/app/api/backup/full/route');
let restoreFull: typeof import('@/app/api/backup/full/restore/route');
let logo: typeof import('@/app/api/files/logo/route');
let pdf: Uint8Array;

beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  await database.client.user.createMany({ data: ['alice', 'bob', 'restore', 'rollback'].map(id => ({ id, email: `${id}@files.test`, password: 'unused' })) });
  directory = await mkdtemp(path.join(tmpdir(), 'bivaro-files-'));
  // Resolve the real storage implementation against a temporary root, then
  // restore cwd before any other command. No development files are touched.
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
  try {
    storage = await import('@/lib/upload-path');
    restore = await import('@/lib/backup-restore');
    quotes = await import('@/app/api/quotes/route');
    download = await import('@/app/api/invoices/download/route');
    incomeRoute = await import('@/app/api/incomes/route');
    upload = await import('@/app/api/invoices/upload/route');
    exportFull = await import('@/app/api/backup/full/route');
    restoreFull = await import('@/app/api/backup/full/restore/route');
    logo = await import('@/app/api/files/logo/route');
  } finally { cwd.mockRestore(); }
  const document = await PDFDocument.create(); document.addPage(); pdf = await document.save();
}, 40_000);
afterAll(async () => {
  await database?.cleanup();
  if (directory) await rm(directory, { recursive: true, force: true });
});

function jsonRequest(url: string, body: object) {
  return new NextRequest(`http://localhost${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

describe('file and restore security integration', () => {
  it('stores traversal filenames only as metadata and rejects a foreign customer', async () => {
    state.userId = 'alice';
    const marker = path.join(directory, 'marker.pdf'); await writeFile(marker, 'unchanged');
    const response = await quotes.POST(jsonRequest('/api/quotes', { fileName: '../../marker.pdf', quoteNumber: 'AN-TEST', parsedData: {}, pdfBytes: Buffer.from(pdf).toString('base64') }));
    expect(response.status).toBe(200);
    const quote = await response.json();
    expect(storage.isSafeStoredFileName(quote.storedFileName)).toBe(true);
    expect(await readFile(marker, 'utf8')).toBe('unchanged');
    expect(await readFile(storage.getTenantUploadPath('alice', quote.storedFileName))).toEqual(Buffer.from(pdf));
    const foreignCustomer = await database.client.customer.create({ data: { userId: 'bob', name: 'Foreign customer' } });
    const denied = await incomeRoute.POST(jsonRequest('/api/incomes', { description: 'Foreign relation', amount: 1, customerId: foreignCustomer.id }));
    expect(denied.status).toBe(404);
    expect(await database.client.income.count({ where: { userId: 'alice' } })).toBe(0);
  });

  it('cannot steal or poison a foreign legacy UUID filename through JSON restore', async () => {
    const legacyName = `${randomUUID()}.pdf`;
    await mkdir(storage.UPLOAD_BASE_DIR, { recursive: true });
    await writeFile(path.join(storage.UPLOAD_BASE_DIR, legacyName), pdf);
    const victim = await database.client.invoice.create({ data: { userId: 'bob', fileName: 'private.pdf', storedFileName: legacyName, parsedData: {}, invoiceNumber: 'VICTIM' } });
    const result = await restore.restoreBackupData({ userId: 'alice', overwrite: false, backup: { version: '2.0', data: {
      invoices: [{ id: 1, fileName: 'copied.pdf', storedFileName: legacyName, parsedData: {}, invoiceNumber: 'ATTACK' }],
    } } });
    expect(result.warnings.length).toBeGreaterThan(0);
    const imported = await database.client.invoice.findFirstOrThrow({ where: { userId: 'alice', invoiceNumber: 'ATTACK' } });
    expect(imported.storedFileName).not.toBe(legacyName);
    state.userId = 'alice';
    expect((await download.GET(new NextRequest(`http://localhost/api/invoices/download?id=${imported.id}`))).status).toBe(404);
    expect((await download.GET(new NextRequest(`http://localhost/api/invoices/download?id=${victim.id}`))).status).toBe(404);
    state.userId = 'bob';
    const response = await download.GET(new NextRequest(`http://localhost/api/invoices/download?id=${victim.id}`));
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(pdf));
  });

  it('rolls back an error after deletion and removes every staged file', async () => {
    const original = await database.client.expense.create({ data: { userId: 'rollback', description: 'Must survive', amount: 77 } });
    // An invalid reminder level passes scalar prevalidation and fails inside
    // the transaction after the existing rows were deleted and new files staged.
    const backup = { version: '2.0', data: {
      invoices: [{ id: 1, fileName: 'invoice.pdf', storedFileName: 'source.pdf', invoiceNumber: 'ROLLBACK', parsedData: {} }],
      reminders: [{ id: 1, invoiceId: 1, reminderLevel: 'invalid' }],
    } };
    await expect(restore.restoreBackupData({ userId: 'rollback', overwrite: true, backup, resolveFile: async () => pdf })).rejects.toThrow();
    expect((await database.client.expense.findUniqueOrThrow({ where: { id: original.id } })).amount).toBe(77);
    expect(await database.client.invoice.count({ where: { userId: 'rollback' } })).toBe(0);
    expect(await readdir(storage.tenantUploadDir('rollback'))).toEqual([]);
  });

  it('restores files, duplicate customer names and all cash/recurring/invoice relations', async () => {
    const date = '2026-01-31T12:00:00.000Z';
    const backup = { version: '2.0', data: {
      customers: [{ id: 10, name: 'Same name', email: 'first@example.test' }, { id: 11, name: 'Same name', email: 'second@example.test' }],
      recurringExpenses: [{ id: 20, description: 'Schedule', amount: 5, interval: 'MONTHLY', dayOfMonth: 31, startDate: date, nextExecution: '2026-02-28T12:00:00.000Z' }],
      expenses: [{ id: 30, description: 'Receipt', amount: 5, date, taxDeductiblePercentage: 0, recurringExpenseId: 20, scheduledDate: date, receiptFileName: 'receipt.pdf', storedReceiptFileName: 'receipt.pdf' }],
      invoices: [
        { id: 40, type: 'QUOTE', fileName: 'quote.pdf', storedFileName: 'quote.pdf', invoiceNumber: 'RESTORE-QUOTE', parsedData: {}, customerId: 10, validUntil: '2026-02-28T00:00:00.000Z' },
        { id: 41, type: 'INVOICE', fileName: 'invoice.pdf', storedFileName: 'invoice.pdf', invoiceNumber: 'RESTORE-INVOICE', parsedData: {}, customerId: 11, convertedFromQuoteId: 40, status: 'PAID', paidAt: date, totalAmount: 10 },
        { id: 42, type: 'CREDIT_NOTE', fileName: 'credit.pdf', storedFileName: 'credit.pdf', invoiceNumber: 'RESTORE-CREDIT', parsedData: {}, originalInvoiceId: 41, totalAmount: -10 },
      ],
      incomes: [{ id: 50, description: 'Payment', amount: 10, date, invoiceId: 41, customerId: 11 }],
      cashBooks: [{ id: 60, name: 'Cash', initialBalance: 100 }],
      cashTransactions: [
        { id: 70, cashBookId: 60, type: 'EINNAHME', description: 'Payment', amount: 10, date, createdAt: date, runningBalance: -999, incomeId: 50 },
        { id: 71, cashBookId: 60, type: 'AUSGABE', description: 'Receipt', amount: 5, date, createdAt: date, runningBalance: -999, expenseId: 30 },
      ],
    } };
    await restore.restoreBackupData({ userId: 'restore', overwrite: true, backup, resolveFile: async () => pdf });
    const customerRecords = await database.client.customer.findMany({ where: { userId: 'restore' } });
    expect(customerRecords).toHaveLength(2);
    const invoice = await database.client.invoice.findFirstOrThrow({ where: { userId: 'restore', invoiceNumber: 'RESTORE-INVOICE' }, include: { income: true, customer: true, convertedFromQuote: true, creditNotes: true } });
    expect(invoice.customer?.email).toBe('second@example.test');
    expect(invoice.income?.amount).toBe(10);
    expect(invoice.convertedFromQuote?.validUntil?.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(invoice.creditNotes[0]?.originalInvoiceId).toBe(invoice.id);
    expect(await readFile(storage.getTenantUploadPath('restore', invoice.storedFileName))).toEqual(Buffer.from(pdf));
    const expense = await database.client.expense.findFirstOrThrow({ where: { userId: 'restore' }, include: { recurringExpense: true } });
    expect(expense.taxDeductiblePercentage).toBe(0);
    expect(expense.recurringExpense?.description).toBe('Schedule');
    const transactions = await database.client.cashTransaction.findMany({ where: { userId: 'restore' }, orderBy: { id: 'asc' } });
    expect(transactions.map(item => item.runningBalance)).toEqual([110, 105]);
    expect(transactions[0].incomeId).toBe(invoice.income?.id);
    expect(transactions[1].expenseId).toBe(expense.id);
  });

  it('converts a quote using a separate invoice document and retries without duplication', async () => {
    state.userId = 'alice';
    const quoteResponse = await quotes.POST(jsonRequest('/api/quotes', { fileName: 'quote.pdf', quoteNumber: 'CONVERT-QUOTE', parsedData: {}, pdfBytes: Buffer.from(pdf).toString('base64') }));
    const quote = await quoteResponse.json();
    const document = await PDFDocument.create(); document.addPage();
    const xml = '<Invoice><ID>CONVERT-INVOICE</ID><IssueDate>2026-09-18</IssueDate><LegalMonetaryTotal><PayableAmount>25</PayableAmount></LegalMonetaryTotal></Invoice>';
    await document.attach(new TextEncoder().encode(xml), 'factur-x.xml', { mimeType: 'application/xml' });
    const invoiceBytes = await document.save();
    const request = () => {
      const form = new FormData();
      form.append('file', new File([new Uint8Array(invoiceBytes)], 'invoice.pdf', { type: 'application/pdf' }));
      form.append('fromQuoteId', String(quote.id));
      return new NextRequest('http://localhost/api/invoices/upload', { method: 'POST', body: form });
    };
    const response = await upload.POST(request());
    expect(response.status).toBe(200);
    const invoice = await response.json();
    expect(invoice.invoiceNumber).toBe('CONVERT-INVOICE');
    expect(invoice.convertedFromQuoteId).toBe(quote.id);
    expect(invoice.storedFileName).not.toBe(quote.storedFileName);
    expect(await database.client.income.count({ where: { invoiceId: invoice.id } })).toBe(0);
    const retry = await upload.POST(request());
    expect(retry.status).toBe(200);
    expect((await retry.json()).id).toBe(invoice.id);
    expect(await database.client.invoice.count({ where: { convertedFromQuoteId: quote.id } })).toBe(1);
    expect((await quotes.DELETE(new Request(`http://localhost/api/quotes?id=${quote.id}`, { method: 'DELETE' }))).status).toBe(200);
    const downloaded = await download.GET(new NextRequest(`http://localhost/api/invoices/download?id=${invoice.id}`));
    expect(downloaded.status).toBe(200);
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(Buffer.from(invoiceBytes));
  });


  it('roundtrips a real full ZIP export into another tenant with new file references', async () => {
    state.userId = 'restore';
    const exported = await exportFull.GET();
    expect(exported.status).toBe(200);
    const archive = new Uint8Array(await exported.arrayBuffer());
    state.userId = 'bob';
    const form = new FormData(); form.append('file', new File([archive], 'backup.zip', { type: 'application/zip' }));
    const imported = await restoreFull.POST(new NextRequest('http://localhost/api/backup/full/restore', { method: 'POST', body: form }));
    expect(imported.status).toBe(200);
    const original = await database.client.invoice.findFirstOrThrow({ where: { userId: 'restore', invoiceNumber: 'RESTORE-INVOICE' } });
    const copy = await database.client.invoice.findFirstOrThrow({ where: { userId: 'bob', invoiceNumber: 'RESTORE-INVOICE' }, include: { income: true, convertedFromQuote: true } });
    expect(copy.storedFileName).not.toBe(original.storedFileName);
    expect(copy.income?.amount).toBe(10);
    expect(copy.convertedFromQuote?.userId).toBe('bob');
    expect(await readFile(storage.getTenantUploadPath('bob', copy.storedFileName))).toEqual(Buffer.from(pdf));
  });


  it('refuses to label an archive complete when a referenced document is missing', async () => {
    state.userId = 'alice';
    const response = await exportFull.GET();
    expect(response.status).toBe(409);
    expect((await response.json()).missingCount).toBeGreaterThan(0);
  });


  it('maps legacy logos to the protected endpoint without accepting traversal or external URLs', () => {
    expect(storage.privateLogoUrl('/uploads/old-logo.png')).toBe('/api/files/logo?file=old-logo.png');
    expect(storage.privateLogoUrl('/api/files/logo?file=old-logo.png')).toBe('/api/files/logo?file=old-logo.png');
    expect(storage.privateLogoUrl('/uploads/%2e%2e%2fsecret.png')).toBeNull();
    expect(storage.privateLogoUrl('https://example.invalid/logo.png')).toBeNull();
  });


  it('serves legacy logos only to the owner through the protected route', async () => {
    await writeFile(path.join(storage.UPLOAD_BASE_DIR, 'old-logo.png'), 'logo-fixture');
    await database.client.settings.create({ data: { userId: 'bob', logoUrl: '/uploads/old-logo.png' } });
    state.userId = 'bob';
    const request = new NextRequest('http://localhost/api/files/logo?file=old-logo.png');
    expect((await logo.GET(request)).status).toBe(200);
    state.userId = 'alice';
    expect((await logo.GET(request)).status).toBe(404);
  });

});
