import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type { Prisma } from '@prisma/client';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as ReturnType<typeof createTestDatabase>['client'] | null, actor: 'accountant-owner' as string | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    requireUserId: async () => { if (!state.actor) throw new UnauthorizedError(); return state.actor; },
    unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  };
});

let database: ReturnType<typeof createTestDatabase>;
let directory: string;
let storage: typeof import('@/lib/upload-path');
let exporter: typeof import('@/lib/accountant-export');
let route: typeof import('@/app/api/accountant-export/route');
let fileSnapshot: typeof import('@/lib/backup-snapshot');
const queries: string[] = [];
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const params = (value = 'from=2026-01-01&to=2026-01-31') => new URLSearchParams(value);
const request = (value = 'from=2026-01-01&to=2026-01-31') => new Request(`http://localhost/api/accountant-export?${value}`);

beforeAll(async () => {
  database = createTestDatabase(); // Explicit fresh DATABASE_URL; never loads the application database.
  state.client = database.client;
  database.client.$on('query', event => { queries.push(event.query); });
  directory = await mkdtemp(path.join(tmpdir(), 'bivaro-accountant-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
  try {
    exporter = await import('@/lib/accountant-export');
    route = await import('@/app/api/accountant-export/route');
    storage = await import('@/lib/upload-path');
    fileSnapshot = await import('@/lib/backup-snapshot');
  } finally { cwd.mockRestore(); }
  await database.client.user.createMany({ data: [
    { id: 'accountant-owner', email: 'owner@test.invalid', password: 'PASSWORD_SECRET' },
    { id: 'accountant-other', email: 'other@test.invalid', password: 'OTHER_PASSWORD' },
  ] });
}, 40_000);

beforeEach(async () => {
  state.actor = 'accountant-owner';
  await database.client.cashTransaction.deleteMany();
  await database.client.cashBook.deleteMany();
  await database.client.income.deleteMany();
  await database.client.invoice.deleteMany();
  await database.client.expense.deleteMany();
  await database.client.customer.deleteMany();
  await database.client.settings.deleteMany();
  await database.client.auditLog.deleteMany();
  await database.client.apiKey.deleteMany();
  await rm(storage.UPLOAD_BASE_DIR, { recursive: true, force: true });
});
afterAll(async () => {
  await database?.cleanup();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function unpack() {
  const result = await exporter.createAccountantExport('accountant-owner', exporter.parseAccountantExportPeriod(params()));
  const zip = await JSZip.loadAsync(result.bytes);
  return { result, zip, manifest: JSON.parse(await zip.file('manifest.json')!.async('string')), records: JSON.parse(await zip.file('records.json')!.async('string')) };
}

async function invoice(data: Partial<Prisma.InvoiceUncheckedCreateInput> = {}) {
  return database.client.invoice.create({ data: {
    userId: 'accountant-owner', fileName: 'document.pdf', storedFileName: 'missing.pdf',
    invoiceDate: date('2026-01-15'), uploadedAt: date('2026-01-15'), parsedData: {}, totalAmount: 12.34,
    ...data,
  } });
}

describe('bounded calendar and spreadsheet-safe contracts', () => {
  it('accepts leap years and includes the final day without timezone assumptions', () => {
    const value = exporter.parseAccountantExportPeriod(params('year=2024'));
    expect(value.from).toBe('2024-01-01');
    expect(value.endExclusive.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(exporter.parseAccountantExportPeriod(params('from=2026-12-31&to=2026-12-31')).start.toISOString()).toBe('2026-12-31T00:00:00.000Z');
  });
  it.each([
    '', 'year=0', 'year=26', 'year=0000', 'year=2026&from=2026-01-01',
    'year=2026&year=2025', 'from=2026-01-01', 'from=2026-02-30&to=2026-03-01',
    'from=2026-02-01&to=2026-01-31', 'from=2025-01-01&to=2026-01-02',
    'from=2026-01-01T00:00:00Z&to=2026-01-31', 'year=2026&userId=accountant-other',
  ])('rejects ambiguous or unbounded selection %s', value => {
    expect(() => exporter.parseAccountantExportPeriod(params(value))).toThrow(exporter.AccountantExportError);
  });
  it('quotes semicolons, quotes, newlines and neutralizes formula prefixes after whitespace', () => {
    expect(exporter.accountantCsvCell('a;"b"\nc')).toBe('"a;""b""\nc"');
    for (const value of ['=1+1', '+CMD()', '-1+1', '@SUM(A1)', '  =A1', '\ufeff=A1', '\t=1', '\r=1', '\n=1']) {
      expect(exporter.accountantCsvCell(value)).toBe(`"'${value}"`);
    }
    expect(exporter.accountantCsvCell(null)).toBe('""');
  });
});

describe('business snapshot, manifest and original-file isolation', () => {
  it('keeps inclusive date boundaries, payment dates and credit-note originals; never sums duplicate views', async () => {
    const original = await invoice({ invoiceDate: date('2025-12-10'), uploadedAt: date('2025-12-10'), status: 'CANCELLED', paidAt: date('2026-01-31') });
    const credit = await invoice({ type: 'CREDIT_NOTE', originalInvoiceId: original.id, totalAmount: -12.34, cancellationReason: 'Korrektur', invoiceDate: date('2026-01-31') });
    await invoice({ type: 'QUOTE' });
    await invoice({ invoiceDate: date('2026-02-01') });
    const paidOutside = await invoice({ status: 'PAID', paidAt: date('2026-02-01') });
    const janIncome = await database.client.income.create({ data: { userId: 'accountant-owner', amount: 12.34, description: 'Paid Jan', date: date('2025-12-10'), invoiceId: original.id } });
    const outsideIncome = await database.client.income.create({ data: { userId: 'accountant-owner', amount: 12.34, description: 'Paid Feb', date: date('2026-01-10'), invoiceId: paidOutside.id } });
    await database.client.expense.createMany({ data: [
      { userId: 'accountant-owner', description: 'first', amount: 1, date: date('2026-01-01') },
      { userId: 'accountant-owner', description: 'last', amount: 2, date: new Date('2026-01-31T23:59:59.999Z'), taxRelevant: false, taxDeductiblePercentage: 50 },
      { userId: 'accountant-owner', description: 'outside', amount: 3, date: date('2026-02-01') },
    ] });
    const { manifest, records } = await unpack();
    expect(records.expenses.map((row: { description: string }) => row.description)).toEqual(['first', 'last']);
    expect(records.expenses[1]).toMatchObject({ taxRelevant: false, taxDeductiblePercentage: 50 });
    expect(records.invoices.map((row: { id: number }) => row.id).sort()).toEqual([original.id, credit.id, paidOutside.id].sort());
    expect(records.incomes.find((row: { id: number }) => row.id === janIncome.id)).toMatchObject({ accountingDate: '2026-01-31', accountingDateInPeriod: true, cashRealized: true });
    expect(records.incomes.find((row: { id: number }) => row.id === outsideIncome.id)).toMatchObject({ accountingDate: '2026-02-01', accountingDateInPeriod: false });
    expect(records.invoices.find((row: { id: number }) => row.id === credit.id)).toMatchObject({ amount: '-12.34', originalInvoiceId: original.id, currency: null });
    expect(manifest.scope).toMatchObject({ datevCertified: false, elsterSubmission: false, completeAuditExport: false, restorableBackup: false });
    expect(manifest.scope.paymentModel).toContain('single-full-payment');
    expect(manifest).not.toHaveProperty('total');
  });

  it('excludes other tenants, unrelated customers, arbitrary parsed payloads and all system secrets', async () => {
    const ownCustomer = await database.client.customer.create({ data: { userId: 'accountant-owner', name: 'Own customer', internalNote: 'INTERNAL_SECRET', email: 'CONTACT_SECRET' } });
    const otherCustomer = await database.client.customer.create({ data: { userId: 'accountant-other', name: 'FOREIGN_CUSTOMER' } });
    await database.client.customer.create({ data: { userId: 'accountant-owner', name: 'UNRELATED_CUSTOMER' } });
    await invoice({ customerId: ownCustomer.id, parsedData: { password: 'OPAQUE_SECRET', rawXML: 'RAW_OPAQUE_SECRET' } });
    const otherInvoice = await invoice({ userId: 'accountant-other', customerId: otherCustomer.id, invoiceNumber: 'FOREIGN_INVOICE' });
    await database.client.income.create({ data: { userId: 'accountant-owner', amount: 5, description: 'broken historical foreign reference', date: date('2026-01-01'), invoiceId: otherInvoice.id, customerId: otherCustomer.id } });
    await database.client.expense.create({ data: { userId: 'accountant-other', amount: 5, description: 'FOREIGN_EXPENSE', date: date('2026-01-01') } });
    await database.client.settings.create({ data: { userId: 'accountant-owner', companyName: 'Own company', footerText: 'FOOTER_SECRET', allowedOrigins: 'ORIGIN_SECRET' } });
    await database.client.apiKey.create({ data: { userId: 'accountant-owner', name: 'API_SECRET_NAME', keyHash: 'API_SECRET_HASH', keyPrefix: 'API_PREFIX' } });
    await database.client.auditLog.create({ data: { userId: 'accountant-owner', action: 'SECURITY_EVENT', entityType: 'SecurityEvent', metadata: 'AUDIT_SECRET' } });
    const { zip, records, manifest } = await unpack();
    const content = (await Promise.all(Object.values(zip.files).map(file => file.async('string')))).join('\n');
    for (const secret of ['PASSWORD_SECRET', 'OTHER_PASSWORD', 'FOREIGN_CUSTOMER', 'FOREIGN_INVOICE', 'FOREIGN_EXPENSE', 'UNRELATED_CUSTOMER', 'INTERNAL_SECRET', 'CONTACT_SECRET', 'OPAQUE_SECRET', 'RAW_OPAQUE_SECRET', 'FOOTER_SECRET', 'ORIGIN_SECRET', 'API_SECRET_NAME', 'API_SECRET_HASH', 'API_PREFIX', 'AUDIT_SECRET']) expect(content).not.toContain(secret);
    expect(records.customers).toHaveLength(1);
    expect(records.company).toMatchObject({ companyName: 'Own company' });
    expect(records.incomes[0].cashRealized).toBeNull();
    expect(manifest.warnings.some((warning: { code: string }) => warning.code === 'REFERENCE_OUTSIDE_SCOPE')).toBe(true);
  });

  it('includes an otherwise out-of-period original behind an in-period credit note without changing it', async () => {
    const older = await invoice({ invoiceDate: date('2025-12-10'), uploadedAt: date('2025-12-10'), status: 'CANCELLED', paidAt: null });
    const credit = await invoice({ type: 'CREDIT_NOTE', originalInvoiceId: older.id, totalAmount: -12.34 });
    const { records } = await unpack();
    expect(records.invoices.map((row: { id: number }) => row.id).sort()).toEqual([older.id, credit.id].sort());
    expect(records.invoices.find((row: { id: number }) => row.id === older.id)).toMatchObject({ documentDateInPeriod: false, paymentDateInPeriod: false });
    expect(await database.client.invoice.findUnique({ where: { id: older.id } })).toEqual(older);
  });

  it('packs exact tenant bytes with safe generated archive paths and verifies every entry hash/count', async () => {
    const storedName = await storage.writeTenantFile('accountant-owner', 'original.pdf', Buffer.from('OWN ORIGINAL\x00bytes'));
    await storage.ensureTenantUploadDir('accountant-other');
    await writeFile(storage.getTenantUploadPath('accountant-other', storedName), 'OTHER TENANT BYTES');
    const ownInvoice = await invoice({ storedFileName: storedName, fileName: '../../=Danger;"name.pdf', status: 'SENT', issuanceState: 'ISSUED' });
    const before = await database.client.invoice.findUnique({ where: { id: ownInvoice.id } });
    const { zip, records, manifest } = await unpack();
    const originalPath = `originals/invoice-${ownInvoice.id}.pdf`;
    expect(await zip.file(originalPath)!.async('string')).toBe('OWN ORIGINAL\x00bytes');
    expect(records.originals[0]).toMatchObject({ status: 'included', zipPath: originalPath, originalFileName: '../../=Danger;"name.pdf' });
    expect(Object.keys(zip.files).every(name => !name.includes('..') && !name.startsWith('/'))).toBe(true);
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.period).toEqual({ from: '2026-01-01', to: '2026-01-31', timezone: 'UTC', inclusive: true });
    expect(manifest.originalCounts).toEqual({ included: 1, missing: 0, notAttached: 0 });
    expect(manifest.counts.invoices).toBe(records.invoices.length);
    expect(manifest.entries.map((entry: { zipPath: string }) => entry.zipPath).sort()).toEqual(Object.keys(zip.files).filter(name => name !== 'manifest.json').sort());
    for (const entry of manifest.entries) {
      const bytes = await zip.file(entry.zipPath)!.async('nodebuffer');
      expect(entry.bytes).toBe(bytes.length);
      expect(entry.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    }
    expect(await database.client.invoice.findUnique({ where: { id: ownInvoice.id } })).toEqual(before);
    expect(await readFile(storage.getTenantUploadPath('accountant-owner', storedName), 'utf8')).toBe('OWN ORIGINAL\x00bytes');
  });

  it('retains missing, absent, unsafe, symlinked, shared legacy and foreign-only file references as warnings', async () => {
    const foreignName = await storage.writeTenantFile('accountant-other', 'foreign.pdf', Buffer.from('FOREIGN_ONLY_BYTES'));
    const linked = await invoice({ storedFileName: foreignName });
    const unsafe = await invoice({ storedFileName: '../../etc/passwd' });
    await writeFile(path.join(storage.UPLOAD_BASE_DIR, 'shared.pdf'), 'SHARED_LEGACY_BYTES');
    const shared = await invoice({ storedFileName: 'shared.pdf' });
    await invoice({ userId: 'accountant-other', storedFileName: 'shared.pdf' });
    await storage.ensureTenantUploadDir('accountant-owner');
    const symlinkName = '00000000-0000-4000-8000-000000000001.pdf';
    await symlink(storage.getTenantUploadPath('accountant-other', foreignName), storage.getTenantUploadPath('accountant-owner', symlinkName));
    const symbolic = await invoice({ storedFileName: symlinkName });
    const absent = await database.client.expense.create({ data: { userId: 'accountant-owner', description: 'no receipt', amount: 1, date: date('2026-01-01') } });
    const { zip, records, manifest } = await unpack();
    expect(manifest.originalCounts).toEqual({ included: 0, missing: 4, notAttached: 1 });
    for (const id of [linked.id, unsafe.id, shared.id, symbolic.id]) expect(records.originals.find((row: { recordType: string; recordId: number }) => row.recordType === 'invoice' && row.recordId === id).status).toBe('missing');
    expect(records.originals.find((row: { recordType: string; recordId: number }) => row.recordType === 'expense' && row.recordId === absent.id).status).toBe('not-attached');
    expect(Object.keys(zip.files).filter(name => name.startsWith('originals/'))).toEqual([]);
    expect(JSON.stringify(manifest)).not.toContain(directory);
    expect(manifest.warnings.filter((row: { code: string }) => row.code === 'ORIGINAL_MISSING')).toHaveLength(4);
  });

  it('keeps CSV raw-text correspondence and exposes money rounding rather than silently changing ledger data', async () => {
    const description = '=HYPERLINK("x");\nraw';
    const expense = await database.client.expense.create({ data: { userId: 'accountant-owner', description, amount: 1.005, date: date('2026-01-01'), category: '@SUM(1)' } });
    const { records, manifest, zip } = await unpack();
    expect(records.expenses[0]).toMatchObject({ description, amount: '1.005', amountCents: '101', amountRoundingDifferenceCents: '0.5' });
    const csv = await zip.file('expenses.csv')!.async('string');
    expect(csv).toContain('"\'=HYPERLINK(""x"");\nraw"');
    expect(csv).toContain('"\'@SUM(1)"');
    expect(manifest.warnings.some((row: { code: string; recordId: number }) => row.code === 'MONEY_ROUNDING' && row.recordId === expense.id)).toBe(true);
    expect((await database.client.expense.findUniqueOrThrow({ where: { id: expense.id } })).amount).toBe(1.005);
  });

  it('includes only linked cash books, explicit currency and out-of-period link warnings', async () => {
    const book = await database.client.cashBook.create({ data: { userId: 'accountant-owner', name: 'USD book', currency: 'USD' } });
    await database.client.cashBook.create({ data: { userId: 'accountant-owner', name: 'UNRELATED_BOOK' } });
    const expense = await database.client.expense.create({ data: { userId: 'accountant-owner', description: 'older', amount: 5, date: date('2025-12-31') } });
    await database.client.cashTransaction.create({ data: { userId: 'accountant-owner', cashBookId: book.id, expenseId: expense.id, description: 'cash expense', date: date('2026-01-01'), type: 'AUSGABE', amount: 5, runningBalance: 10 } });
    const { records, manifest } = await unpack();
    expect(records.cashBooks).toHaveLength(1);
    expect(records.cashTransactions[0]).toMatchObject({ amount: '5', currency: 'USD', expenseId: expense.id });
    expect(manifest.warnings.map((row: { code: string }) => row.code)).toContain('CASH_CURRENCY_NOT_EUR');
    expect(manifest.warnings.map((row: { code: string }) => row.code)).toContain('REFERENCE_OUTSIDE_SCOPE');
  });

  it('returns useful empty indices rather than inventing transactions', async () => {
    const { zip, records, manifest } = await unpack();
    expect(records.expenses).toEqual([]);
    expect(await zip.file('expenses.csv')!.async('string')).toContain('"taxDeductiblePercentage"');
    expect(manifest.originalCounts).toEqual({ included: 0, missing: 0, notAttached: 0 });
  });
});

describe('download API failure and resource boundaries', () => {
  it('requires a session before parsing period or revealing any data', async () => {
    state.actor = null;
    expect((await route.GET(request())).status).toBe(401);
    expect((await route.GET(request('year=bad'))).status).toBe(401);
    state.actor = 'accountant-owner';
    expect((await route.GET(request('year=bad'))).status).toBe(400);
  });

  it('returns an attachment, no-store/nosniff and a minimal audit event with no exported logs', async () => {
    const response = await route.GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="bivaro-uebergabepaket-2026-01-01-2026-01-31.zip"');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const logs = await database.client.auditLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ userId: 'accountant-owner', action: 'SECURITY_EVENT', entityType: 'SecurityEvent', entityName: 'ACCOUNTANT_HANDOFF_EXPORT' });
    expect(logs[0].oldValues).toBeNull();
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    expect(Object.keys(zip.files)).not.toContain('auditLogs.json');
  });

  it('changes tenant from session only and never accepts caller-selected tenant ids', async () => {
    await database.client.expense.createMany({ data: [
      { userId: 'accountant-owner', amount: 1, description: 'OWNER_LEDGER', date: date('2026-01-01') },
      { userId: 'accountant-other', amount: 2, description: 'OTHER_LEDGER', date: date('2026-01-01') },
    ] });
    state.actor = 'accountant-other';
    const response = await route.GET(request());
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    const records = JSON.parse(await zip.file('records.json')!.async('string'));
    expect(records.expenses.map((row: { description: string }) => row.description)).toEqual(['OTHER_LEDGER']);
    expect((await route.GET(request('year=2026&userId=accountant-owner'))).status).toBe(400);
  });

  it('rejects too many rows before fetching an unbounded dataset, without silently truncating', async () => {
    await database.client.income.createMany({ data: Array.from({ length: exporter.ACCOUNTANT_EXPORT_LIMITS.maxRecords + 1 }, (_, index) => ({ userId: 'accountant-owner', amount: 1, description: `row ${index}`, date: date('2026-01-01') })) });
    const response = await route.GET(request());
    expect(response.status).toBe(413);
    expect((await response.json()).error).toContain('10.000');
  });

  it('rejects oversized originals rather than dropping them with a warning', async () => {
    const storedName = await storage.writeTenantFile('accountant-owner', 'large.pdf', Buffer.alloc(0));
    await truncate(storage.getTenantUploadPath('accountant-owner', storedName), exporter.ACCOUNTANT_EXPORT_LIMITS.maxFileBytes + 1);
    await invoice({ storedFileName: storedName });
    const response = await route.GET(request());
    expect(response.status).toBe(413);
  });

  it('preflights giant free-text fields before materializing or serializing business records', async () => {
    await database.client.expense.create({ data: { userId: 'accountant-owner', amount: 1, description: 'x'.repeat(exporter.ACCOUNTANT_EXPORT_LIMITS.maxSourceTextBytes + 1), date: date('2026-01-01') } });
    queries.length = 0;
    const response = await route.GET(request());
    expect(response.status).toBe(413);
    expect((await response.json()).error).toContain('2 MiB');
    expect(queries.some(query => query.startsWith('SELECT') && query.includes('Expense') && query.includes('id') && !query.includes('description'))).toBe(true);
    expect(queries.filter(query => query.startsWith('SELECT') && query.includes('Expense') && query.includes('description') && !query.includes('SUM('))).toEqual([]);
  });

  it('fails visibly on a changed original version rather than emitting a mismatched archive', async () => {
    const storedName = await storage.writeTenantFile('accountant-owner', 'changing.pdf', Buffer.from('original'));
    await invoice({ storedFileName: storedName });
    const originalRead = fileSnapshot.readStableBackupFile;
    const spy = vi.spyOn(fileSnapshot, 'readStableBackupFile').mockImplementation(async (...args) => {
      const result = await originalRead(...args);
      await writeFile(args[0], 'CHANGED_AFTER_STABLE_READ');
      return result;
    });
    try { expect((await route.GET(request())).status).toBe(409); }
    finally { spy.mockRestore(); }
  });
});

describe('guided handoff preview and approved-snapshot download', () => {
  it('uses the same scope and warnings without constructing or compressing a ZIP', async () => {
    const storedName = await storage.writeTenantFile('accountant-owner', 'preview.pdf', Buffer.from('UNCHANGED_ORIGINAL'));
    await invoice({ storedFileName: storedName });
    await database.client.expense.create({ data: { userId: 'accountant-owner', amount: 1, description: 'PRIVATE_DESCRIPTION_NOT_IN_PREVIEW', date: date('2026-01-01') } });
    const compression = vi.spyOn(JSZip.prototype, 'generateAsync');
    try {
      const response = await route.GET(request('year=2026&preview=1'));
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('content-disposition')).toBeNull();
      const body = await response.json();
      expect(body).not.toHaveProperty('bytes');
      expect(body).not.toHaveProperty('records');
      expect(JSON.stringify(body)).not.toContain('PRIVATE_DESCRIPTION_NOT_IN_PREVIEW');
      expect(JSON.stringify(body)).not.toContain('UNCHANGED_ORIGINAL');
      expect(body.manifest).toMatchObject({ formatVersion: 1, counts: { invoices: 1, expenses: 1 }, originalCounts: { included: 1, missing: 0, notAttached: 1 } });
      expect(body.manifest.warnings.some((warning: { code: string }) => warning.code === 'ORIGINAL_NOT_ATTACHED')).toBe(true);
      expect(body.manifest.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(body.manifest.entries.some((entry: { zipPath: string }) => entry.zipPath === 'manifest.json')).toBe(false);
      expect(compression).not.toHaveBeenCalled();
      expect(await database.client.auditLog.count()).toBe(0);
      const second = await (await route.GET(request('year=2026&preview=1'))).json();
      expect(second.manifest.sourceFingerprint).toBe(body.manifest.sourceFingerprint);
      const download = await route.GET(request(`year=2026&expectedFingerprint=${body.manifest.sourceFingerprint}`));
      expect(download.status).toBe(200);
      const zip = await JSZip.loadAsync(await download.arrayBuffer());
      const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
      expect(manifest.sourceFingerprint).toBe(body.manifest.sourceFingerprint);
      expect(manifest.counts).toEqual(body.manifest.counts);
      expect(manifest.warnings).toEqual(body.manifest.warnings);
      expect(compression).toHaveBeenCalledTimes(1);
      expect(await database.client.auditLog.count()).toBe(1);
    } finally { compression.mockRestore(); }
  });

  it('rejects changed records before compression rather than downloading an unapproved snapshot', async () => {
    const expense = await database.client.expense.create({ data: { userId: 'accountant-owner', amount: 1, description: 'before', date: date('2026-01-01') } });
    const preview = await (await route.GET(request('year=2026&preview=1'))).json();
    await database.client.expense.update({ where: { id: expense.id }, data: { description: 'after' } });
    const compression = vi.spyOn(JSZip.prototype, 'generateAsync');
    try {
      const response = await route.GET(request(`year=2026&expectedFingerprint=${preview.manifest.sourceFingerprint}`));
      expect(response.status).toBe(409);
      expect((await response.json()).error).toContain('seit der Vorschau geändert');
      expect(compression).not.toHaveBeenCalled();
      expect(await database.client.auditLog.count()).toBe(0);
    } finally { compression.mockRestore(); }
  });

  it('also detects changed original bytes with unchanged database records', async () => {
    const storedName = await storage.writeTenantFile('accountant-owner', 'reviewed.pdf', Buffer.from('before'));
    await invoice({ storedFileName: storedName });
    const preview = await (await route.GET(request('year=2026&preview=1'))).json();
    await writeFile(storage.getTenantUploadPath('accountant-owner', storedName), 'after');
    const response = await route.GET(request(`year=2026&expectedFingerprint=${preview.manifest.sourceFingerprint}`));
    expect(response.status).toBe(409);
    const updated = await (await route.GET(request('year=2026&preview=1'))).json();
    expect(updated.manifest.sourceFingerprint).not.toBe(preview.manifest.sourceFingerprint);
  });

  it('keeps authentication, period validation and file-size limits identical for previews', async () => {
    state.actor = null;
    expect((await route.GET(request('year=2026&preview=1'))).status).toBe(401);
    state.actor = 'accountant-owner';
    for (const query of ['year=2026&preview=0', 'year=2026&preview=1&preview=1', 'year=2026&expectedFingerprint=bad', `year=2026&preview=1&expectedFingerprint=${'a'.repeat(64)}`, 'year=2026&preview=1&userId=accountant-other', 'year=2026&year=2025&preview=1', 'from=2025-01-01&to=2026-01-02&preview=1']) {
      expect((await route.GET(request(query))).status).toBe(400);
    }
    const storedName = await storage.writeTenantFile('accountant-owner', 'large-preview.pdf', Buffer.alloc(0));
    await truncate(storage.getTenantUploadPath('accountant-owner', storedName), exporter.ACCOUNTANT_EXPORT_LIMITS.maxFileBytes + 1);
    await invoice({ storedFileName: storedName });
    expect((await route.GET(request('year=2026&preview=1'))).status).toBe(413);
  });
});
