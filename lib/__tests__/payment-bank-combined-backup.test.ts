import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from './helpers/database';
import { stripEmptyBankImportsForLegacy } from './helpers/backup-schema';
import {
  BACKUP_FEATURE_CAPABILITIES, BANK_IMPORT_EVIDENCE_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION,
  PAYMENT_TERMS_SCHEMA_VERSION, PROJECT_OUTBOX_PURCHASE_VALIDATION_SCHEMA_VERSION,
  backupSchemaSupportsBankImportEvidence, backupSchemaSupportsPaymentTerms, createBackupManifest,
} from '@/lib/backup-manifest';
import { inferBankCsvMapping, parseBankCsv } from '@/lib/bank-csv';
import { BANK_IMPORT_MAPPING_VERSION, BANK_IMPORT_PARSER_VERSION } from '@/lib/bank-import-contract';
import { confirmBankImport, readBankImport, recoverBankImport } from '@/lib/bank-import-service';
import { readBackupSnapshot } from '@/lib/backup-snapshot';
import { paymentTermSuggestion } from '@/lib/payment-terms';

const state = vi.hoisted(() => ({ client: null as ReturnType<typeof createTestDatabase>['client'] | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
const sourceId = 'combined-source';
const fixed = new Date('2026-10-22T00:00:00.000Z');
const csv = 'Datum;Betrag;Währung;Verwendungszweck;Umsatz-ID\n21.10.2026;12,34;EUR;Synthetisch;Combined-A\n21.10.2026;-0,03;EUR;Synthetisch;Combined-B\n21.10.2026;2,00;USD;Synthetisch;Combined-C';
const request = {
  requestId: randomUUID(), originalBase64: Buffer.from(csv).toString('base64'), delimiter: ';',
  mapping: { ...inferBankCsvMapping(parseBankCsv(csv).headers), accountAlias: 'Synthetisches Kombikonto' },
  parserVersion: BANK_IMPORT_PARSER_VERSION, mappingVersion: BANK_IMPORT_MAPPING_VERSION, reviewed: true,
};
const resolveFile = async () => new Uint8Array([37, 80, 68, 70]);
let db: ReturnType<typeof createTestDatabase>;
let directory: string;
let restore: typeof import('@/lib/backup-restore');
let sourceCustomerId: number;
let receipt: Awaited<ReturnType<typeof confirmBankImport>>['receipt'];
function pack(data: Record<string, unknown>, userId = sourceId) {
  return { version: '3.0', type: 'full', exportedAt: fixed.toISOString(), data,
    manifest: createBackupManifest({ sourceUserId: userId, generatedAt: fixed.toISOString(), data }) };
}
async function snapshot(userId = sourceId) {
  return pack(JSON.parse(JSON.stringify((await readBackupSnapshot(userId)).data)), userId);
}
async function owner(userId: string) {
  await db.client.user.create({ data: { id: userId, email: `${userId}@example.invalid`, password: 'synthetic fixture' } });
  return userId;
}
async function financialCounts(userId: string) {
  return Promise.all([
    db.client.invoice.count({ where: { userId } }), db.client.income.count({ where: { userId } }),
    db.client.expense.count({ where: { userId } }), db.client.paymentJournalEvent.count({ where: { userId } }),
    db.client.paymentOperation.count({ where: { userId } }), db.client.paymentAdjustment.count({ where: { userId } }),
    db.client.cashTransaction.count({ where: { userId } }),
  ]);
}
function withoutPaymentTerms(data: Record<string, unknown>) {
  for (const customer of data.customers as Record<string, unknown>[]) customer.paymentTermDays = null;
  (data.settings as Record<string, unknown>).paymentTermDays = null;
  for (const invoice of data.invoices as Record<string, unknown>[]) delete (invoice.parsedData as Record<string, unknown>).paymentTermSelection;
}

beforeAll(async () => {
  db = createTestDatabase(); state.client = db.client;
  directory = await mkdtemp(path.join(tmpdir(), 'bivaro-combined-backup-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
  try { restore = await import('@/lib/backup-restore'); } finally { cwd.mockRestore(); }
  await owner(sourceId);
  const customer = await db.client.customer.create({ data: { userId: sourceId, name: 'Synthetic combined customer', createdAt: fixed, paymentTermDays: 30 } });
  sourceCustomerId = customer.id;
  await db.client.settings.create({ data: { userId: sourceId, companyName: 'Synthetic combined company', paymentTermDays: 21 } });
  await db.client.invoice.create({ data: { userId: sourceId, customerId: customer.id, type: 'INVOICE', invoiceNumber: '2026-6001',
    fileName: 'combined.pdf', storedFileName: 'combined.pdf', invoiceDate: fixed, dueDate: new Date('2026-11-21T00:00:00.000Z'),
    parsedData: { paymentTermSelection: paymentTermSuggestion('2026-10-22', customer.id, 30, 21), notes: 'Synthetic bound origin' }, uploadedAt: fixed } });
  await db.client.invoice.create({ data: { userId: sourceId, customerId: customer.id, type: 'INVOICE', invoiceNumber: '2025-6002',
    fileName: 'manual.pdf', storedFileName: 'manual.pdf', invoiceDate: new Date('2025-01-01T00:00:00.000Z'), dueDate: new Date('2025-01-08T00:00:00.000Z'),
    parsedData: { paymentTermSelection: { version: 1, source: 'MANUAL', days: null, invoiceDate: '2025-01-01', dueDate: '2025-01-08', customerId: customer.id } }, uploadedAt: fixed } });
  const before = await financialCounts(sourceId);
  receipt = (await confirmBankImport(sourceId, request)).receipt;
  expect(await financialCounts(sourceId)).toEqual(before);
}, 40_000);
afterAll(async () => { await db?.cleanup(); if (directory) await rm(directory, { recursive: true, force: true }); });

describe('payment terms and bank evidence exact combined backup contract', () => {
  it('keeps 300, payment-only 400, bank-only 500 and combined 600 as separate immutable closed identities', () => {
    expect(PROJECT_OUTBOX_PURCHASE_VALIDATION_SCHEMA_VERSION).toBe('20261022030000_combine_projects_outbox_validation');
    expect(PAYMENT_TERMS_SCHEMA_VERSION).toBe('20261022040000_add_payment_terms');
    expect(BANK_IMPORT_EVIDENCE_SCHEMA_VERSION).toBe('20261022050000_add_bank_import_evidence');
    expect(CURRENT_SCHEMA_VERSION).toBe('20261022060000_combine_payment_terms_bank_import_evidence');
    for (const [schema, paymentTerms, bankImportEvidence] of [
      [PROJECT_OUTBOX_PURCHASE_VALIDATION_SCHEMA_VERSION, false, false],
      [PAYMENT_TERMS_SCHEMA_VERSION, true, false], [BANK_IMPORT_EVIDENCE_SCHEMA_VERSION, false, true],
      [CURRENT_SCHEMA_VERSION, true, true],
    ] as const) {
      expect(backupSchemaSupportsPaymentTerms(schema)).toBe(paymentTerms);
      expect(backupSchemaSupportsBankImportEvidence(schema)).toBe(bankImportEvidence);
      expect(BACKUP_FEATURE_CAPABILITIES[schema]).toEqual({ ...BACKUP_FEATURE_CAPABILITIES[PROJECT_OUTBOX_PURCHASE_VALIDATION_SCHEMA_VERSION], paymentTerms, bankImportEvidence });
      expect(Object.isFrozen(BACKUP_FEATURE_CAPABILITIES[schema])).toBe(true);
    }
    for (const schema of [undefined, `${CURRENT_SCHEMA_VERSION}_future`, '20991231060000_combine_payment_terms_bank_import_evidence']) {
      expect(backupSchemaSupportsPaymentTerms(schema)).toBe(false);
      expect(backupSchemaSupportsBankImportEvidence(schema)).toBe(false);
    }
  });

  it('accepts genuine standalone histories but rejects relabelling either feature under the other or accepted 300', async () => {
    const source = await snapshot();
    const paymentOnly = structuredClone(source);
    paymentOnly.data.bankImportBatches = []; paymentOnly.data.bankImportRows = [];
    paymentOnly.manifest = createBackupManifest({ sourceUserId: sourceId, generatedAt: fixed.toISOString(), data: paymentOnly.data });
    paymentOnly.manifest.schemaVersion = PAYMENT_TERMS_SCHEMA_VERSION;
    stripEmptyBankImportsForLegacy(paymentOnly);
    expect(() => restore.validateBackupForRestore(paymentOnly)).not.toThrow();
    const bankOnly = structuredClone(source); withoutPaymentTerms(bankOnly.data);
    bankOnly.manifest = createBackupManifest({ sourceUserId: sourceId, generatedAt: fixed.toISOString(), data: bankOnly.data });
    bankOnly.manifest.schemaVersion = BANK_IMPORT_EVIDENCE_SCHEMA_VERSION;
    expect(() => restore.validateBackupForRestore(bankOnly)).not.toThrow();
    const historic = structuredClone(paymentOnly); withoutPaymentTerms(historic.data);
    historic.manifest = createBackupManifest({ sourceUserId: sourceId, generatedAt: fixed.toISOString(), data: historic.data });
    historic.manifest.schemaVersion = PROJECT_OUTBOX_PURCHASE_VALIDATION_SCHEMA_VERSION;
    stripEmptyBankImportsForLegacy(historic);
    expect(() => restore.validateBackupForRestore(historic)).not.toThrow();
    for (const schema of [PAYMENT_TERMS_SCHEMA_VERSION, BANK_IMPORT_EVIDENCE_SCHEMA_VERSION, PROJECT_OUTBOX_PURCHASE_VALIDATION_SCHEMA_VERSION]) {
      const mislabeled = structuredClone(source); mislabeled.manifest.schemaVersion = schema;
      expect(() => restore.validateBackupForRestore(mislabeled)).toThrow();
    }
  });

  it('cross-tenant roundtrip remaps customer provenance only, retains bank identities/recovery, manual dates and empty ledgers on replay', async () => {
    const source = await snapshot(); const target = await owner('combined-target');
    const first = await restore.restoreBackupData({ userId: target, overwrite: true, backup: source, resolveFile });
    expect(first.bankImportBatches).toEqual({ imported: 1, skipped: 0 });
    expect(first.bankImportRows).toEqual({ imported: 3, skipped: 0 });
    const customer = await db.client.customer.findFirstOrThrow({ where: { userId: target } });
    expect(customer.id).not.toBe(sourceCustomerId); expect(customer.paymentTermDays).toBe(30);
    expect((await db.client.settings.findUniqueOrThrow({ where: { userId: target } })).paymentTermDays).toBe(21);
    const invoices = await db.client.invoice.findMany({ where: { userId: target }, orderBy: { invoiceNumber: 'desc' } });
    expect(invoices[0].parsedData).toEqual({ paymentTermSelection: paymentTermSuggestion('2026-10-22', customer.id, 30, 21), notes: 'Synthetic bound origin' });
    expect(invoices[1]).toMatchObject({ invoiceDate: new Date('2025-01-01T00:00:00.000Z'), dueDate: new Date('2025-01-08T00:00:00.000Z'), parsedData: {
      paymentTermSelection: { version: 1, source: 'MANUAL', days: null, invoiceDate: '2025-01-01', dueDate: '2025-01-08', customerId: customer.id },
    } });
    const portable = await snapshot(target);
    expect(portable.data.bankImportBatches).toEqual(source.data.bankImportBatches);
    expect(portable.data.bankImportRows).toEqual(source.data.bankImportRows);
    expect(await recoverBankImport(target, request.requestId)).toEqual(receipt);
    expect((await readBankImport(target, receipt.id, 0)).receipt).toEqual(receipt);
    const before = await financialCounts(target);
    expect(await confirmBankImport(target, request)).toEqual({ receipt, replayed: true });
    const repeated = await restore.restoreBackupData({ userId: target, overwrite: false, backup: source, resolveFile });
    expect(repeated.invoices).toEqual({ imported: 0, skipped: 2 });
    expect(repeated.bankImportBatches).toEqual({ imported: 0, skipped: 1 });
    expect(repeated.bankImportRows).toEqual({ imported: 0, skipped: 3 });
    expect(await financialCounts(target)).toEqual(before);
    expect(before).toEqual([2, 0, 0, 0, 0, 0, 0]);
    const native = await snapshot(target); expect(() => restore.validateBackupForRestore(native)).not.toThrow();
  });

  it('rolls back early bank receipt/row inserts when a later numbered invoice provenance collision rejects the combined restore', async () => {
    const target = await owner('combined-rollback');
    const customer = await db.client.customer.create({ data: { userId: target, name: 'Synthetic combined customer', createdAt: fixed, paymentTermDays: 7 } });
    await db.client.settings.create({ data: { userId: target, companyName: 'Keep target company', paymentTermDays: 9 } });
    await db.client.invoice.create({ data: { userId: target, customerId: customer.id, type: 'INVOICE', invoiceNumber: '2026-6001',
      fileName: 'legacy-target.pdf', storedFileName: 'legacy-target.pdf', invoiceDate: fixed, dueDate: new Date('2026-11-21T00:00:00.000Z'), parsedData: {}, uploadedAt: fixed } });
    const source = await snapshot(), before = await snapshot(target), finances = await financialCounts(target);
    const queries: string[] = [];
    db.client.$on('query', event => queries.push(event.query));
    await expect(restore.restoreBackupData({ userId: target, overwrite: false, backup: source, resolveFile })).rejects.toThrow(/Kollision/);
    expect(queries.some(query => /INSERT INTO.*BankImportBatch/u.test(query))).toBe(true);
    expect(queries.some(query => /INSERT INTO.*BankImportRow/u.test(query))).toBe(true);
    expect(await db.client.bankImportBatch.count({ where: { userId: target } })).toBe(0);
    expect(await db.client.bankImportRow.count({ where: { userId: target } })).toBe(0);
    expect(await recoverBankImport(target, request.requestId)).toBeNull();
    expect(await financialCounts(target)).toEqual(finances);
    expect((await snapshot(target)).data).toEqual(before.data);
    expect((await db.client.customer.findUniqueOrThrow({ where: { id: customer.id } })).paymentTermDays).toBe(7);
    expect((await db.client.settings.findUniqueOrThrow({ where: { userId: target } })).paymentTermDays).toBe(9);
  });
});
