import { stripEmptyPaymentAdjustmentsForLegacy } from './helpers/backup-schema';
import { createBackupManifest } from './helpers/backup';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import JSZip from 'jszip';
import { createTestDatabase } from './helpers/database';
import { backupSchemaSupportsServiceBilling, CURRENT_SCHEMA_VERSION, GROWTH_AI_SCHEMA_VERSION, validateBackupManifest } from '@/lib/backup-manifest';
import { getServiceBillingPeriod, isUnrenderedServiceBillingDraft, readServiceBillingPlanInput } from '@/lib/service-billing';
import { createBackupPreview } from '@/lib/backup-preview';
const state = vi.hoisted(() => ({ client: null as PrismaClient | null, userId: 'recurring-backup-source' }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({ requireUserId: async () => state.userId, UnauthorizedError: class extends Error {}, unauthorizedResponse: () => new Response(null, { status: 401 }) }));
vi.mock('@/lib/audit-log', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/audit-log')>(), auditSecurityEvent: vi.fn() }));
import { readBackupSnapshot } from '@/lib/backup-snapshot';
import { restoreBackupData, validateBackupForRestore } from '@/lib/backup-restore';
import { GET as exportFull } from '@/app/api/backup/full/route';
let database: ReturnType<typeof createTestDatabase>;
const sourceOwner = 'recurring-backup-source';
const fixed = new Date('2026-10-21T09:00:00.000Z');
const pack = <T extends Record<string, unknown>>(data: T, sourceUserId = sourceOwner) => ({ version: '3.0', type: 'full', data, manifest: createBackupManifest({ sourceUserId, generatedAt: fixed.toISOString(), data }) });
async function snapshot(userId = sourceOwner) { return pack(JSON.parse(JSON.stringify((await readBackupSnapshot(userId)).data)), userId); }
async function owner(suffix: string) {
  const id = `recurring-backup-${suffix}`;
  await database.client.user.create({ data: { id, email: `${id}@test.invalid`, password: 'unused' } });
  return id;
}
beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  await owner('source');
  const customer = await database.client.customer.create({ data: { userId: sourceOwner, name: 'Synthetic support customer', email: 'support@example.invalid' } });
  const input = readServiceBillingPlanInput({ name: 'Synthetic IT support', customerId: customer.id, cadence: 'MONTHLY', anchorDate: '2026-01-31', taxMode: 'standard', items: [{ description: 'IT support plan', quantity: 1, unit: 'Pauschale', unitPrice: 100, taxRate: 19 }] });
  const plan = await database.client.serviceBillingPlan.create({ data: { userId: sourceOwner, ...input, status: 'PAUSED', nextPeriod: 3, revision: 4, createdAt: fixed, updatedAt: fixed } });
  const period = getServiceBillingPeriod(input.anchorDate, input.cadence, 0);
  const invoice = await database.client.invoice.create({ data: {
    userId: sourceOwner, customerId: customer.id, type: 'INVOICE', status: 'DRAFT', issuanceState: 'UNISSUED',
    fileName: 'Serviceentwurf Synthetic IT support', storedFileName: '', invoiceNumber: null, invoiceDate: null, dueDate: null,
    uploadedAt: fixed, totalAmount: 119,
    parsedData: { currency: 'EUR', documentType: 'INVOICE', grossAmount: 119, netAmount: 100, taxAmount: 19, totalAmount: 119, lineItems: [{ description: 'IT support plan', quantity: 1, unitPrice: 100, taxRate: 19, unit: 'Pauschale', positionNumber: '1', amount: 100 }],
      _serviceBillingDraft: { version: 1, planStableKey: plan.stableKey, periodIndex: 0, periodStart: period.periodStart, periodEnd: period.periodEnd, taxMode: input.taxMode, items: input.items, customerAddress: '', notes: 'User must review' } },
  } });
  for (let index = 0; index < 3; index++) {
    const dates = getServiceBillingPeriod(input.anchorDate, input.cadence, index);
    await database.client.serviceBillingPeriod.create({ data: { userId: sourceOwner, planId: plan.id, periodIndex: index, periodStart: dates.periodStart, periodEnd: dates.periodEnd, action: index === 1 ? 'SKIPPED' : 'GENERATED', invoiceId: index === 0 ? invoice.id : null, createdAt: fixed } });
  }
}, 40_000);
afterAll(async () => database?.cleanup());

describe('recurring service plans are portable, non-financial business state', () => {
  it('declares one new exact capability without changing historical growth + AI semantics', async () => {
    const source = await snapshot();
    expect(source.manifest.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(backupSchemaSupportsServiceBilling(CURRENT_SCHEMA_VERSION)).toBe(true);
    expect(backupSchemaSupportsServiceBilling(GROWTH_AI_SCHEMA_VERSION)).toBe(false);
    expect(createBackupPreview(source).counts).toMatchObject({ serviceBillingPlans: 1, serviceBillingPeriods: 3, invoices: 1, incomes: 0, paymentJournalEvents: 0 });
    const downgrade = structuredClone(source); downgrade.manifest.schemaVersion = GROWTH_AI_SCHEMA_VERSION; stripEmptyPaymentAdjustmentsForLegacy(downgrade);
    expect(() => validateBackupManifest(downgrade.manifest, downgrade.data)).toThrow(/Servicepläne|Periodenidentitäten/);
    for (const key of ['serviceBillingPlans', 'serviceBillingPeriods']) {
      const missing = structuredClone(source); delete missing.data[key]; missing.manifest = createBackupManifest({ sourceUserId: sourceOwner, generatedAt: fixed.toISOString(), data: missing.data });
      expect(() => validateBackupForRestore(missing)).toThrow(/erforderlichen Abschnitt/);
    }
  });
  it('exports an actual ZIP with an unrendered editable draft but without synthetic invoice files', async () => {
    state.userId = sourceOwner;
    const response = await exportFull();
    expect(response.status).toBe(200);
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    expect(Object.keys(zip.files)).toEqual(['backup.json']);
    const archive = JSON.parse(await zip.file('backup.json')!.async('string'));
    expect(archive.manifest.fileManifest).toEqual([]);
    expect(archive.data.invoices[0].storedFileName).toBe('');
    const target = await owner('zip-target');
    const resolveFile = vi.fn(async () => { throw new Error('No file is expected for a planning draft'); });
    await restoreBackupData({ userId: target, overwrite: true, backup: archive, resolveFile });
    expect(resolveFile).not.toHaveBeenCalled();
    const restored = await database.client.serviceBillingPlan.findFirstOrThrow({ where: { userId: target } });
    expect(restored).toMatchObject({ stableKey: archive.data.serviceBillingPlans[0].stableKey, status: 'PAUSED', nextPeriod: 3, revision: 4, anchorDate: '2026-01-31' });
    expect(restored.id).not.toBe(archive.data.serviceBillingPlans[0].id);
    const invoice = await database.client.invoice.findFirstOrThrow({ where: { userId: target } });
    expect(invoice).toMatchObject({ storedFileName: '', invoiceNumber: null, invoiceDate: null, dueDate: null, status: 'DRAFT', issuanceState: 'UNISSUED' });
    expect(await database.client.income.count({ where: { userId: target } })).toBe(0);
    expect(await database.client.invoiceNumberCounter.count({ where: { userId: target } })).toBe(0);
  });
  it('merges repeated archives and re-exported owner-remapped archives without duplicate plans, periods or drafts', async () => {
    const target = await owner('merge-target');
    const mirror = await owner('mirror');
    const source = await snapshot();
    await restoreBackupData({ userId: target, overwrite: false, backup: source });
    await restoreBackupData({ userId: target, overwrite: false, backup: source });
    await restoreBackupData({ userId: mirror, overwrite: false, backup: await snapshot(target) });
    const repeated = await restoreBackupData({ userId: target, overwrite: false, backup: await snapshot(mirror) });
    expect(repeated.serviceBillingPlans).toEqual({ imported: 0, skipped: 1 });
    expect(repeated.serviceBillingPeriods).toEqual({ imported: 0, skipped: 3 });
    expect(repeated.invoices).toEqual({ imported: 0, skipped: 1 });
    expect(await database.client.serviceBillingPlan.count({ where: { userId: target } })).toBe(1);
    expect(await database.client.serviceBillingPeriod.count({ where: { userId: target } })).toBe(3);
    expect(await database.client.invoice.count({ where: { userId: target } })).toBe(1);
    expect(await database.client.income.count({ where: { userId: target } })).toBe(0);
  });
  it('retains deletion tombstones and refuses an old archive that would regenerate a deleted period draft', async () => {
    const target = await owner('deleted-target'); const empty = await owner('deleted-remap');
    const source = await snapshot(); await restoreBackupData({ userId: target, overwrite: false, backup: source });
    await database.client.invoice.deleteMany({ where: { userId: target } });
    const receipt = await database.client.serviceBillingPeriod.findFirstOrThrow({ where: { userId: target, periodIndex: 0 } });
    expect(receipt).toMatchObject({ action: 'GENERATED', invoiceId: null });
    await expect(restoreBackupData({ userId: target, overwrite: false, backup: source })).rejects.toThrow(/gelöschte Entwurfsperiode/);
    await restoreBackupData({ userId: empty, overwrite: false, backup: await snapshot(target) });
    expect(await database.client.invoice.count({ where: { userId: empty } })).toBe(0);
    expect(await database.client.serviceBillingPeriod.count({ where: { userId: empty, action: 'GENERATED', invoiceId: null } })).toBe(2);
  });
  it('refuses destructive overwrite and divergent plan or linked draft evidence without touching the target', async () => {
    const target = await owner('conflict-target'); const source = await snapshot();
    await restoreBackupData({ userId: target, overwrite: false, backup: source });
    await expect(restoreBackupData({ userId: target, overwrite: true, backup: source })).rejects.toThrow(/nicht überschrieben/);
    const modified = structuredClone(source); modified.data.serviceBillingPlans[0].name = 'Changed plan'; modified.manifest = createBackupManifest({ sourceUserId: sourceOwner, generatedAt: fixed.toISOString(), data: modified.data });
    await expect(restoreBackupData({ userId: target, overwrite: false, backup: modified })).rejects.toThrow(/Abweichender Serviceplan/);
    const invoice = await database.client.invoice.findFirstOrThrow({ where: { userId: target } });
    await database.client.invoice.update({ where: { id: invoice.id }, data: { totalAmount: 120 } });
    await expect(restoreBackupData({ userId: target, overwrite: false, backup: source })).rejects.toThrow(/Periodenentwurf/);
    expect(await database.client.invoice.count({ where: { userId: target } })).toBe(1);
    expect((await database.client.serviceBillingPlan.findFirstOrThrow({ where: { userId: target } })).name).toBe('Synthetic IT support');
  });
  it('retains ordinary rendered invoice conservative state while repeating its exact period archive without duplicate documents', async () => {
    const target = await owner('rendered-target');
    const source = await snapshot();
    const invoice = source.data.invoices[0];
    invoice.storedFileName = 'synthetic-rendered.pdf'; invoice.fileName = 'synthetic-rendered.pdf';
    invoice.invoiceNumber = '2026-SERVICE-SYNTHETIC'; invoice.invoiceDate = fixed.toISOString();
    delete invoice.parsedData._serviceBillingDraft;
    source.manifest = createBackupManifest({ sourceUserId: sourceOwner, generatedAt: fixed.toISOString(), data: source.data });
    const resolveFile = async () => new Uint8Array([37, 80, 68, 70]);
    await restoreBackupData({ userId: target, overwrite: false, backup: source, resolveFile });
    expect((await database.client.invoice.findFirstOrThrow({ where: { userId: target } })).issuanceState).toBe('UNKNOWN');
    const repeated = await restoreBackupData({ userId: target, overwrite: false, backup: source, resolveFile });
    expect(repeated.invoices).toEqual({ imported: 0, skipped: 1 });
    expect(repeated.serviceBillingPeriods).toEqual({ imported: 0, skipped: 3 });
    expect(await database.client.invoice.count({ where: { userId: target } })).toBe(1);
  });
  it('never grants the no-file exemption to ordinary rendered documents with missing originals', async () => {
    const target = await owner('missing-rendered-target');
    const source = await snapshot(); const invoice = source.data.invoices[0];
    invoice.fileName = 'ordinary-rendered.xml'; invoice.storedFileName = 'ordinary-rendered.xml';
    invoice.invoiceNumber = 'SYNTHETIC-ORIGINAL'; invoice.invoiceDate = fixed.toISOString();
    delete invoice.parsedData._serviceBillingDraft;
    source.manifest = createBackupManifest({ sourceUserId: sourceOwner, generatedAt: fixed.toISOString(), data: source.data });
    expect(() => validateBackupForRestore(source)).not.toThrow();
    const resolveFile = vi.fn(async () => null);
    await expect(restoreBackupData({ userId: target, overwrite: false, backup: source, resolveFile })).rejects.toThrow(/fehlt im Backup/);
    expect(resolveFile).toHaveBeenCalledOnce();
    expect(await database.client.serviceBillingPlan.count({ where: { userId: target } })).toBe(0);
    expect(await database.client.invoice.count({ where: { userId: target } })).toBe(0);
  });
  it('rejects a recomputed manifest with mismatched planning seed before any target business write', async () => {
    const target = await owner('malformed-target');
    const source = await snapshot();
    source.data.invoices[0].parsedData._serviceBillingDraft.periodIndex = 1;
    source.manifest = createBackupManifest({ sourceUserId: sourceOwner, generatedAt: fixed.toISOString(), data: source.data });
    await expect(restoreBackupData({ userId: target, overwrite: false, backup: source })).rejects.toThrow(/Periodenidentität/);
    expect(await database.client.serviceBillingPlan.count({ where: { userId: target } })).toBe(0);
    expect(await database.client.serviceBillingPeriod.count({ where: { userId: target } })).toBe(0);
    expect(await database.client.invoice.count({ where: { userId: target } })).toBe(0);
    expect(await database.client.income.count({ where: { userId: target } })).toBe(0);
  });
  it('rejects source-bearing no-file planning archives before any restore write', async () => {
    const target = await owner('source-bearing-target');
    const source = await snapshot();
    Object.assign(source.data.invoices[0].parsedData, {
      rawXml: '<Invoice><ID>ISSUED-ORIGINAL</ID><IssueDate>2026-10-21</IssueDate></Invoice>',
      invoiceNumber: 'ISSUED-ORIGINAL', invoiceDate: '2026-10-21', _uploadRequest: { id: 'original-upload' },
    });
    source.manifest = createBackupManifest({ sourceUserId: sourceOwner, generatedAt: fixed.toISOString(), data: source.data });
    expect(() => validateBackupForRestore(source)).toThrow();
    const resolveFile = vi.fn(async () => { throw new Error('Validation must precede staging'); });
    await expect(restoreBackupData({ userId: target, overwrite: false, backup: source, resolveFile })).rejects.toThrow();
    expect(resolveFile).not.toHaveBeenCalled();
    expect(await database.client.serviceBillingPlan.count({ where: { userId: target } })).toBe(0);
    expect(await database.client.invoice.count({ where: { userId: target } })).toBe(0);
    expect(await database.client.auditLog.count({ where: { userId: target } })).toBe(0);
  });
  it('rejects relation projections in backup seeds even when valid for native runtime reads', async () => {
    const original = await snapshot();
    const scalar = original.data.invoices[0];
    const receipt = { ...original.data.serviceBillingPeriods[0], userId: sourceOwner, plan: { ...original.data.serviceBillingPlans[0], userId: sourceOwner } };
    const relations: Array<[string, unknown]> = [
      ['customer', { id: scalar.customerId, userId: sourceOwner }], ['serviceBillingPeriod', receipt],
      ['incomes', []], ['paymentJournalEvents', []], ['billingNotes', []], ['reminders', []], ['creditNotes', []],
      ['originalInvoice', null], ['convertedFromQuote', null], ['convertedInvoice', null],
    ];
    for (const [field, value] of relations) {
      const source = structuredClone(original);
      Object.assign(source.data.invoices[0], { userId: sourceOwner, [field]: value });
      expect(isUnrenderedServiceBillingDraft(source.data.invoices[0])).toBe(true);
      source.manifest = createBackupManifest({ sourceUserId: sourceOwner, generatedAt: fixed.toISOString(), data: source.data });
      expect(() => validateBackupForRestore(source)).toThrow(/unbekannte Felder/);
    }
  });
  it('rejects reverse original, conversion, dunning and billing-note evidence before staging or business writes', async () => {
    const target = await owner('reverse-evidence-target');
    const original = await snapshot();
    const mutateCases = [
      (data: typeof original.data) => { const seed = data.invoices[0]; data.invoices.push({ ...seed, id: seed.id + 100, type: 'CREDIT_NOTE', fileName: 'synthetic-credit.pdf', storedFileName: 'synthetic-credit.pdf', invoiceNumber: 'SYNTHETIC-CREDIT', issuanceState: 'UNKNOWN', parsedData: {}, originalInvoiceId: String(seed.id) }); },
      (data: typeof original.data) => { const seed = data.invoices[0]; data.invoices.push({ ...seed, id: seed.id + 100, fileName: 'synthetic-conversion.pdf', storedFileName: 'synthetic-conversion.pdf', invoiceNumber: 'SYNTHETIC-CONVERSION', issuanceState: 'UNKNOWN', parsedData: {}, convertedFromQuoteId: String(seed.id) }); },
      (data: typeof original.data) => { data.reminders.push({ id: 100, invoiceId: String(data.invoices[0].id), reminderLevel: 1, sentAt: fixed.toISOString(), dueDate: fixed.toISOString(), fee: 5, notes: 'Synthetic dunning proof', createdAt: fixed.toISOString() }); },
      (data: typeof original.data) => { data.billingNotes.push({ id: 100, customerId: data.customers[0].id, invoiceId: String(data.invoices[0].id), serviceDate: '2026-01-31T00:00:00.000Z', description: 'Already claimed source note', quantity: 1, unit: 'Stunde', createdAt: fixed.toISOString(), updatedAt: fixed.toISOString() }); },
    ];
    const resolveFile = vi.fn(async () => { throw new Error('Contradictory source must be rejected before staging'); });
    for (const mutate of mutateCases) {
      const source = structuredClone(original); mutate(source.data);
      source.manifest = createBackupManifest({ sourceUserId: sourceOwner, generatedAt: fixed.toISOString(), data: source.data });
      expect(() => validateBackupForRestore(source)).toThrow(/Serviceentwurf/);
      await expect(restoreBackupData({ userId: target, overwrite: false, backup: source, resolveFile })).rejects.toThrow(/Serviceentwurf/);
    }
    expect(resolveFile).not.toHaveBeenCalled();
    expect(await database.client.serviceBillingPlan.count({ where: { userId: target } })).toBe(0);
    expect(await database.client.invoice.count({ where: { userId: target } })).toBe(0);
    expect(await database.client.reminder.count({ where: { userId: target } })).toBe(0);
    expect(await database.client.billingNote.count({ where: { userId: target } })).toBe(0);
    expect(await database.client.auditLog.count({ where: { userId: target } })).toBe(0);
  });
  it('rejects gapped, duplicate, wrong-tenant, wrong-calendar, unknown-field or detached draft evidence', async () => {
    const source = await snapshot();
    for (const mutate of [
      (data: typeof source.data) => { data.serviceBillingPeriods.splice(1, 1); },
      (data: typeof source.data) => { data.serviceBillingPeriods.push(structuredClone(data.serviceBillingPeriods[0])); },
      (data: typeof source.data) => { data.serviceBillingPlans[0].userId = 'other-owner'; },
      (data: typeof source.data) => { data.serviceBillingPeriods[0].userId = 'other-owner'; },
      (data: typeof source.data) => { data.invoices[0].userId = 'other-owner'; },
      (data: typeof source.data) => { data.invoices[0].originalInvoiceId = data.invoices[0].id; },
      (data: typeof source.data) => { data.invoices[0].convertedFromQuoteId = data.invoices[0].id; },
      (data: typeof source.data) => { data.invoices[0].cancellationReason = 'Existing cancellation proof'; },
      (data: typeof source.data) => { data.invoices[0].validUntil = '2026-12-31T00:00:00.000Z'; },
      (data: typeof source.data) => { data.invoices[0].parsedData = JSON.stringify(data.invoices[0].parsedData); },
      (data: typeof source.data) => { data.serviceBillingPeriods[0].periodEnd = '2026-02-28'; },
      (data: typeof source.data) => { data.serviceBillingPlans[0].automaticEmail = true; },
      (data: typeof source.data) => { data.serviceBillingPeriods[0].invoiceId = null; },
      (data: typeof source.data) => { delete data.serviceBillingPeriods[0].invoiceId; },
      (data: typeof source.data) => { data.invoices[0].parsedData._serviceBillingDraft.autoIssue = true; },
      (data: typeof source.data) => { data.invoices[0].paidAt = fixed.toISOString(); },
      (data: typeof source.data) => { data.invoices[0].totalAmount = 120; },
      (data: typeof source.data) => { data.invoices[0].parsedData._serviceBillingDraft.items[0].unitPrice = 110; },
      (data: typeof source.data) => { delete data.invoices[0].parsedData._serviceBillingDraft; },
    ]) {
      const modified = structuredClone(source); mutate(modified.data); modified.manifest = createBackupManifest({ sourceUserId: sourceOwner, generatedAt: fixed.toISOString(), data: modified.data });
      expect(() => validateBackupForRestore(modified)).toThrow();
    }
  });
});
