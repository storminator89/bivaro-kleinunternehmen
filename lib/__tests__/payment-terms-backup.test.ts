import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestDatabase } from './helpers/database';
import {
  BACKUP_FEATURE_CAPABILITIES, PAYMENT_BANK_IMPORT_SCHEMA_VERSION, PAYMENT_TERMS_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION, PROJECT_OUTBOX_PURCHASE_VALIDATION_SCHEMA_VERSION,
  backupSchemaSupportsPaymentTerms, backupSchemaSupportsProjectServiceTimes, backupSchemaSupportsEmailOutbox,
  backupSchemaSupportsPurchaseValidation, createBackupManifest, validatePaymentTermBackupFields,
} from '@/lib/backup-manifest';
import { stripEmptyBankImportsForLegacy } from './helpers/backup-schema';
import { readBackupSnapshot } from '@/lib/backup-snapshot';
import { paymentTermSuggestion, type PaymentTermSelection } from '@/lib/payment-terms';
import { PURCHASE_RULES_SHA256, PURCHASE_RULES_VERSION, PURCHASE_VALIDATION_VERSION, PURCHASE_VALIDATOR_VERSION, XRECHNUNG_PROFILE } from '@/lib/purchase-documents/validation-contract';
import { technicalReportFingerprint } from '@/lib/purchase-documents/validation-evidence';

const state = vi.hoisted(() => ({ client: null as ReturnType<typeof createTestDatabase>['client'] | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
let database: ReturnType<typeof createTestDatabase>;
let directory: string;
let restore: typeof import('@/lib/backup-restore');
let preview: typeof import('@/lib/backup-preview');
const sourceUserId = 'payment-terms-source';
const fixed = new Date('2026-10-22T00:00:00.000Z');
const resolveFile = async () => new Uint8Array([37, 80, 68, 70]);
async function owner(suffix: string) {
  const userId = `payment-terms-${suffix}`;
  await database.client.user.create({ data: { id: userId, email: `${userId}@example.invalid`, password: 'fixture' } });
  return userId;
}
function pack(data: Record<string, unknown>, source = sourceUserId) {
  return { version: '3.0', type: 'full', exportedAt: fixed.toISOString(), data,
    manifest: createBackupManifest({ sourceUserId: source, generatedAt: fixed.toISOString(), data }) };
}
async function snapshot(source = sourceUserId) {
  return pack(JSON.parse(JSON.stringify((await readBackupSnapshot(source)).data)), source);
}
function invoice(data: Record<string, unknown>) { return (data.invoices as Record<string, unknown>[])[0]; }
function selection(data: Record<string, unknown>) { return (invoice(data).parsedData as Record<string, unknown>).paymentTermSelection as PaymentTermSelection; }
function historical(data: Record<string, unknown>) {
  const old = structuredClone(data);
  for (const customer of old.customers as Record<string, unknown>[]) customer.paymentTermDays = null;
  (old.settings as Record<string, unknown>).paymentTermDays = null;
  for (const row of old.invoices as Record<string, unknown>[]) delete (row.parsedData as Record<string, unknown>).paymentTermSelection;
  const result = pack(old);
  result.manifest.schemaVersion = PROJECT_OUTBOX_PURCHASE_VALIDATION_SCHEMA_VERSION;
  stripEmptyBankImportsForLegacy(result);
  return result;
}

beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  directory = await mkdtemp(path.join(tmpdir(), 'bivaro-payment-backup-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
  try { restore = await import('@/lib/backup-restore'); preview = await import('@/lib/backup-preview'); }
  finally { cwd.mockRestore(); }
  await owner('source');
  const customer = await database.client.customer.create({ data: { userId: sourceUserId, name: 'Synthetic payment customer', paymentTermDays: 30, createdAt: fixed } });
  await database.client.settings.create({ data: { userId: sourceUserId, companyName: 'Synthetic payment company', paymentTermDays: 21 } });
  await database.client.invoice.create({ data: { userId: sourceUserId, customerId: customer.id, type: 'INVOICE', invoiceNumber: '2026-9930',
    fileName: 'synthetic.pdf', storedFileName: 'synthetic.pdf', invoiceDate: fixed, dueDate: new Date('2026-11-21T00:00:00.000Z'),
    parsedData: { paymentTermSelection: paymentTermSuggestion('2026-10-22', customer.id, 30, 21), notes: 'Synthetic immutable origin' }, uploadedAt: fixed } });
  await database.client.invoice.create({ data: { userId: sourceUserId, customerId: customer.id, invoiceNumber: '2026-9900',
    fileName: 'legacy.pdf', storedFileName: 'legacy.pdf', invoiceDate: new Date('2025-01-01T00:00:00.000Z'), dueDate: new Date('2025-01-08T00:00:00.000Z'), parsedData: {}, uploadedAt: fixed } });
}, 40_000);
afterAll(async () => { await database?.cleanup(); if (directory) await rm(directory, { recursive: true, force: true }); });

describe('closed additive payment-term backup contract', () => {
  it('adds one exact capability identity without changing any historical feature set', () => {
    expect(PAYMENT_TERMS_SCHEMA_VERSION).toBe('20261022040000_add_payment_terms');
    expect(PAYMENT_BANK_IMPORT_SCHEMA_VERSION).toBe('20261022060000_combine_payment_terms_bank_import_evidence');
    expect(PROJECT_OUTBOX_PURCHASE_VALIDATION_SCHEMA_VERSION).toBe('20261022030000_combine_projects_outbox_validation');
    expect(backupSchemaSupportsPaymentTerms(CURRENT_SCHEMA_VERSION)).toBe(true);
    for (const schema of Object.keys(BACKUP_FEATURE_CAPABILITIES).filter(key => !backupSchemaSupportsPaymentTerms(key))) expect(backupSchemaSupportsPaymentTerms(schema)).toBe(false);
    for (const schema of [CURRENT_SCHEMA_VERSION, PROJECT_OUTBOX_PURCHASE_VALIDATION_SCHEMA_VERSION]) {
      expect(backupSchemaSupportsProjectServiceTimes(schema)).toBe(true);
      expect(backupSchemaSupportsEmailOutbox(schema)).toBe(true);
      expect(backupSchemaSupportsPurchaseValidation(schema)).toBe(true);
    }
    expect(backupSchemaSupportsPaymentTerms('20271022040000_add_payment_terms')).toBe(false);
  });

  it('roundtrips defaults and provenance while remapping only its customer reference and preserving historical dates', async () => {
    const source = await snapshot();
    expect(preview.createBackupPreview(source).manifest?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    const target = await owner('roundtrip');
    await restore.restoreBackupData({ userId: target, overwrite: true, backup: source, resolveFile });
    const customer = await database.client.customer.findFirstOrThrow({ where: { userId: target } });
    expect(customer.paymentTermDays).toBe(30);
    expect(customer.id).not.toBe(selection(source.data).customerId);
    expect((await database.client.settings.findUniqueOrThrow({ where: { userId: target } })).paymentTermDays).toBe(21);
    const rows = await database.client.invoice.findMany({ where: { userId: target }, orderBy: { invoiceNumber: 'desc' } });
    expect(rows[0].parsedData).toEqual({ ...(invoice(source.data).parsedData as object), paymentTermSelection: { ...selection(source.data), customerId: customer.id } });
    expect(rows[0]).toMatchObject({ invoiceDate: fixed, dueDate: new Date('2026-11-21T00:00:00.000Z') });
    expect(rows[1]).toMatchObject({ invoiceDate: new Date('2025-01-01T00:00:00.000Z'), dueDate: new Date('2025-01-08T00:00:00.000Z'), parsedData: {} });
    const repeated = await restore.restoreBackupData({ userId: target, overwrite: false, backup: source, resolveFile });
    expect(repeated.invoices).toEqual({ imported: 0, skipped: 2 });
    expect((await database.client.invoice.findFirstOrThrow({ where: { userId: target, invoiceNumber: '2026-9930' } })).parsedData).toEqual(rows[0].parsedData);
    const native = await snapshot(target);
    expect(() => restore.validateBackupForRestore(native)).not.toThrow();
  });

  it('preserves existing defaults on merge skips and restores defaults into newly created settings only', async () => {
    const source = await snapshot();
    const target = await owner('merge-defaults');
    const originalCustomer = (source.data.customers as Record<string, unknown>[])[0];
    await database.client.customer.create({ data: { userId: target, name: String(originalCustomer.name), paymentTermDays: 7, createdAt: fixed } });
    await database.client.settings.create({ data: { userId: target, companyName: 'Target company', paymentTermDays: 9 } });
    const result = await restore.restoreBackupData({ userId: target, overwrite: false, backup: source, resolveFile });
    expect(result.customers).toEqual({ imported: 0, skipped: 1 });
    expect((await database.client.customer.findFirstOrThrow({ where: { userId: target } })).paymentTermDays).toBe(7);
    expect((await database.client.settings.findUniqueOrThrow({ where: { userId: target } })).paymentTermDays).toBe(9);
    const empty = await owner('merge-new-settings');
    await restore.restoreBackupData({ userId: empty, overwrite: false, backup: source, resolveFile });
    expect((await database.client.settings.findUniqueOrThrow({ where: { userId: empty } })).paymentTermDays).toBe(21);
  });

  it('accepts genuine historic triple-capability backups with absent or null future fields and never infers defaults', async () => {
    const old = historical((await snapshot()).data);
    expect(() => restore.validateBackupForRestore(old)).not.toThrow();
    const target = await owner('historical');
    await restore.restoreBackupData({ userId: target, overwrite: true, backup: old, resolveFile });
    expect((await database.client.customer.findFirstOrThrow({ where: { userId: target } })).paymentTermDays).toBeNull();
    expect((await database.client.settings.findUniqueOrThrow({ where: { userId: target } })).paymentTermDays).toBeNull();
    expect(await database.client.invoice.findMany({ where: { userId: target } })).toHaveLength(2);
    for (const schema of [...Object.keys(BACKUP_FEATURE_CAPABILITIES), undefined]) {
      expect(() => validatePaymentTermBackupFields({ customers: [{ paymentTermDays: null }, {}], settings: { paymentTermDays: null }, invoices: [{ parsedData: { paymentTermSelection: null } }] }, schema)).not.toThrow();
    }
  });

  it.each([-1, 366, 1.5, '30', true, [], {}])('rejects invalid default %j in manifest, preview and restore before any overwrite writes', async days => {
    const source = await snapshot();
    const target = await owner(`invalid-${Array.isArray(days) ? 'array' : typeof days}-${JSON.stringify(days).replace(/[^a-z0-9]/gi, '-')}`);
    const keep = await database.client.customer.create({ data: { userId: target, name: 'Keep synthetic target', paymentTermDays: 5 } });
    for (const location of ['customer', 'settings']) {
      const data = structuredClone(source.data);
      const row = location === 'customer' ? (data.customers as Record<string, unknown>[])[0] : data.settings as Record<string, unknown>;
      row.paymentTermDays = days;
      const backup = pack(data);
      expect(() => preview.createBackupPreview(backup)).toThrow(/paymentTermDays/);
      expect(() => restore.validateBackupForRestore(backup)).toThrow(/paymentTermDays/);
      await expect(restore.restoreBackupData({ userId: target, overwrite: true, backup, resolveFile })).rejects.toThrow(/paymentTermDays/);
      expect(await database.client.customer.findUnique({ where: { id: keep.id } })).toEqual(keep);
    }
  });

  it.each([0, 365, null])('restores explicit nullable boundary default %j without recalculating old invoices', async days => {
    const source = await snapshot();
    (source.data.customers as Record<string, unknown>[])[0].paymentTermDays = days;
    (source.data.settings as Record<string, unknown>).paymentTermDays = days;
    const target = await owner(`boundary-${days}`);
    await restore.restoreBackupData({ userId: target, overwrite: true, backup: pack(source.data), resolveFile });
    expect((await database.client.customer.findFirstOrThrow({ where: { userId: target } })).paymentTermDays).toBe(days);
    expect((await database.client.settings.findUniqueOrThrow({ where: { userId: target } })).paymentTermDays).toBe(days);
    expect((await database.client.invoice.findFirstOrThrow({ where: { userId: target, invoiceNumber: '2026-9930' } })).dueDate).toEqual(new Date('2026-11-21T00:00:00.000Z'));
  });

  it('rejects recomputed-hash future defaults and provenance for every historical capability identity and v2', async () => {
    const source = await snapshot();
    for (const schema of [...Object.keys(BACKUP_FEATURE_CAPABILITIES).filter(key => !backupSchemaSupportsPaymentTerms(key)), undefined]) {
      for (const data of [{ customers: [{ paymentTermDays: 0 }] }, { settings: { paymentTermDays: 365 } }, { invoices: [invoice(source.data)] }]) {
        expect(() => validatePaymentTermBackupFields(data, schema)).toThrow(/Älteres Backupschema/);
      }
    }
    const backup = historical(source.data);
    (backup.data.customers as Record<string, unknown>[])[0].paymentTermDays = 30;
    const invalid = pack(backup.data); invalid.manifest.schemaVersion = PROJECT_OUTBOX_PURCHASE_VALIDATION_SCHEMA_VERSION;
    expect(() => preview.createBackupPreview(invalid)).toThrow(/Älteres Backupschema/);
    expect(() => restore.validateBackupForRestore({ version: '2.0', data: { customers: [{ id: 1, name: 'Synthetic', paymentTermDays: 0 }] } })).toThrow(/Älteres Backupschema/);
  });

  it('rejects snapshot/date/customer/type/shape mismatches and service draft markers', async () => {
    const original = await snapshot();
    const changes: ((data: Record<string, unknown>) => void)[] = [
      data => { selection(data).days = 31; },
      data => { selection(data).source = 'COMPANY'; selection(data).days = 21; },
      data => { selection(data).invoiceDate = '2026-10-21'; },
      data => { selection(data).dueDate = '2026-11-20'; },
      data => { selection(data).customerId = null; },
      data => { invoice(data).invoiceDate = null; },
      data => { invoice(data).dueDate = null; },
      data => { invoice(data).invoiceDate = '2026-10-22T23:00:00.000-02:00'; },
      data => { invoice(data).type = 'QUOTE'; },
      data => { invoice(data).invoiceNumber = null; },
      data => { (invoice(data).parsedData as Record<string, unknown>)._serviceBillingDraft = null; },
      data => { (selection(data) as unknown as Record<string, unknown>).future = true; },
      data => { invoice(data).parsedData = JSON.stringify(invoice(data).parsedData); },
    ];
    for (const mutate of changes) {
      const data = structuredClone(original.data); mutate(data);
      expect(() => preview.createBackupPreview(pack(data))).toThrow();
      expect(() => restore.validateBackupForRestore(pack(data))).toThrow();
    }
  });

  it.each(['CUSTOMER', 'COMPANY', 'FALLBACK', 'MANUAL'])('rejects array-coerced backup source %s even with recomputed hashes', async sourceName => {
    const source = await snapshot();
    (selection(source.data) as unknown as Record<string, unknown>).source = [sourceName];
    expect(() => preview.createBackupPreview(pack(source.data))).toThrow();
    expect(() => restore.validateBackupForRestore(pack(source.data))).toThrow();
  });

  it('rejects changed or missing provenance on repeated cross-tenant imports atomically', async () => {
    const source = await snapshot(); const target = await owner('collision');
    await restore.restoreBackupData({ userId: target, overwrite: false, backup: source, resolveFile });
    const before = await snapshot(target);
    const mutations: ((data: Record<string, unknown>) => void)[] = [
      data => { selection(data).source = 'COMPANY'; },
      data => { selection(data).source = 'MANUAL'; selection(data).days = null; },
      data => { selection(data).days = 29; selection(data).dueDate = '2026-11-20'; invoice(data).dueDate = '2026-11-20T00:00:00.000Z'; },
      data => { delete (invoice(data).parsedData as Record<string, unknown>).paymentTermSelection; },
    ];
    for (const mutate of mutations) {
      const data = structuredClone(source.data); mutate(data);
      await expect(restore.restoreBackupData({ userId: target, overwrite: false, backup: pack(data), resolveFile })).rejects.toThrow(/Kollision/);
      expect((await snapshot(target)).data).toEqual(before.data);
    }
    const native = await snapshot(target);
    expect((await restore.restoreBackupData({ userId: target, overwrite: false, backup: native, resolveFile })).invoices).toEqual({ imported: 0, skipped: 2 });
  });

  it('rejects a numbered legacy target collision rather than silently discarding new provenance', async () => {
    const source = await snapshot(); const target = await owner('missing-target-provenance');
    await restore.restoreBackupData({ userId: target, overwrite: false, backup: historical(source.data), resolveFile });
    const before = await snapshot(target);
    await expect(restore.restoreBackupData({ userId: target, overwrite: false, backup: source, resolveFile })).rejects.toThrow(/Kollision/);
    expect((await snapshot(target)).data).toEqual(before.data);
  });

  it('replays payment-journal invoices cross-tenant using remapped provenance rather than raw source IDs', async () => {
    const source = await snapshot();
    const row = invoice(source.data);
    Object.assign(row, { totalAmount: 100, status: 'PAID', issuanceState: 'ISSUED', paidAt: fixed.toISOString() });
    source.data.incomes = [{ id: 991, manualRecordId: '54000000-0000-4000-8000-000000000991', manualRecordState: 'LEGACY_UNREVIEWED', manualRecordOrigin: 'PAYMENT_JOURNAL', manualRecordRevision: 0, invoiceId: row.id, customerId: row.customerId, description: 'Synthetic payment', amount: 100, date: fixed.toISOString(), taxRelevant: true }];
    source.data.paymentJournalEvents = [{ bankPaymentBindingStableKey: null, id: 992, invoiceId: row.id, incomeId: 991, amountCents: '10000', currency: 'EUR', paidAt: fixed.toISOString(),
      dateCertainty: 'ACTUAL', source: 'MANUAL', reference: 'Synthetic payment', idempotencyKey: 'synthetic-payment-term-allocation', createdAt: fixed.toISOString() }];
    const backup = pack(source.data), target = await owner('journal');
    await restore.restoreBackupData({ userId: target, overwrite: false, backup, resolveFile });
    const customer = await database.client.customer.findFirstOrThrow({ where: { userId: target } });
    expect(customer.id).not.toBe(row.customerId);
    const repeat = await restore.restoreBackupData({ userId: target, overwrite: false, backup, resolveFile });
    expect(repeat.paymentJournalEvents).toEqual({ imported: 0, skipped: 1 });
    expect(repeat.incomes).toEqual({ imported: 0, skipped: 1 });
    expect(await database.client.paymentJournalEvent.count({ where: { userId: target } })).toBe(1);
    const restoredIncome = await database.client.income.findFirstOrThrow({ where: { userId: target } });
    expect(restoredIncome).toMatchObject({ manualRecordState: 'LEGACY_UNREVIEWED', manualRecordOrigin: 'PAYMENT_JOURNAL', amount: 100 });
    expect(restoredIncome.manualRecordId).not.toBe('54000000-0000-4000-8000-000000000991');
  });

  it.each([false, true])('keeps target-owned sent outbox attempts and technical report history during overwrite=%j', async overwrite => {
    const target = await owner(`history-${overwrite}`);
    const outbox = await database.client.emailOutbox.create({ data: { userId: target, sourceInvoiceId: 991, documentType: 'INVOICE', requestId: `synthetic-${overwrite}`,
      fingerprint: `synthetic-fingerprint-${overwrite}`, attachmentSha256: 'a'.repeat(64), storedFileName: 'historic.pdf', attachmentFileName: 'historic.pdf',
      from: 'sender@example.invalid', to: 'recipient@example.invalid', cc: '', bcc: '', subject: 'Synthetic historical send', text: 'Synthetic', state: 'SENT',
      messageId: 'synthetic-message@example.invalid', createdAt: fixed, updatedAt: fixed } });
    const attempt = await database.client.emailOutboxAttempt.create({ data: { outboxId: outbox.id, requestId: 'synthetic-attempt', sequence: 1, state: 'SENT', startedAt: fixed, finishedAt: fixed, messageId: outbox.messageId } });
    const report = { reportVersion: 1 as const, originalSha256: 'b'.repeat(64), checkerVersion: PURCHASE_VALIDATION_VERSION, validatorVersion: PURCHASE_VALIDATOR_VERSION,
      rulesVersion: PURCHASE_RULES_VERSION, rulesSha256: PURCHASE_RULES_SHA256, checkedAt: fixed.toISOString(), status: 'VALID' as const,
      reasonCode: 'SUPPORTED_RULES_PASSED', format: 'UBL' as const, profile: XRECHNUNG_PROFILE, checks: { xml: 'PASSED' as const, xsd: 'PASSED' as const, schematron: 'PASSED' as const }, findings: [], findingsTruncated: false, accountingApproval: 'NOT_PERFORMED' as const };
    const evidence = await database.client.purchaseValidationReport.create({ data: { userId: target, stableKey: `synthetic-stable-${overwrite}`,
      requestId: `synthetic-request-${overwrite}`, originalSha256: report.originalSha256, sourceDocumentIdAtCheck: 991, report,
      fingerprint: technicalReportFingerprint(report), checkedAt: fixed, createdAt: fixed } });
    await restore.restoreBackupData({ userId: target, overwrite, backup: await snapshot(), resolveFile });
    // Existing overwrite detaches document links and advances operational updatedAt;
    // it must not change the immutable send envelope or its historical outcome.
    expect(await database.client.emailOutbox.findUniqueOrThrow({ where: { id: outbox.id } })).toEqual({ ...outbox, updatedAt: overwrite ? expect.any(Date) : outbox.updatedAt });
    expect(await database.client.emailOutboxAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).toEqual(attempt);
    expect(await database.client.purchaseValidationReport.findUniqueOrThrow({ where: { id: evidence.id } })).toEqual(evidence);
    expect((await snapshot(target)).data).not.toHaveProperty('emailOutbox');
  });
});
