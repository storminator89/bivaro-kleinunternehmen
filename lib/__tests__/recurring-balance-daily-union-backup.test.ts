import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { NextRequest } from 'next/server';
import { createTestDatabase } from './helpers/database';
import { CURRENT_SCHEMA_VERSION, hashBytes, type BackupManifest } from '@/lib/backup-manifest';
import { isUnrenderedServiceBillingDraft } from '@/lib/service-billing';
import { validateAiReceiptResult } from '@/lib/purchase-documents/ai-validation';
import type { AiExtractionJob } from '@/lib/purchase-documents/ai-contract';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, userId: 'union-zip-source' }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({ requireUserId: async () => state.userId, UnauthorizedError: class extends Error {}, unauthorizedResponse: () => new Response(null, { status: 401 }) }));
vi.mock('@/lib/audit-log', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/audit-log')>(), auditSecurityEvent: vi.fn() }));
const source = 'union-zip-source', target = 'union-zip-target', mirror = 'union-zip-mirror';
const now = new Date('2026-10-21T10:00:00.000Z');
type FullArchive = { backup: { version: string; type: string; data: Record<string, unknown>; manifest: BackupManifest }; zip: JSZip };
let database: ReturnType<typeof createTestDatabase>, directory: string;
let storage: typeof import('@/lib/upload-path'), restore: typeof import('@/lib/backup-restore'), exportFull: typeof import('@/app/api/backup/full/route');
let plans: typeof import('@/lib/service-billing-service'), payments: typeof import('@/lib/payment-journal/service'), invoiceLifecycle: typeof import('@/lib/invoice-payments');
let reminders: typeof import('@/lib/reminder-workbench'), daily: typeof import('@/lib/daily-actions/service'), kpis: typeof import('@/app/api/dashboard/kpis/route');
let purchases: typeof import('@/lib/purchase-documents/service'), purchaseApproval: typeof import('@/lib/purchase-documents/approval');
let purchaseDraft: typeof import('@/lib/purchase-documents/save-review-draft'), suppliers: typeof import('@/lib/suppliers');
let sourceArchive: FullArchive, targetArchive: FullArchive;
let planStableKey: string, noFileId: number, renderedId: number, deletedId: number, quoteId: number;
let targetProvider: Awaited<ReturnType<PrismaClient['aiProviderSettings']['findUniqueOrThrow']>>;
let mirrorProvider: typeof targetProvider;
let outbound: MockInstance<typeof globalThis.fetch>;
const records = (data: Record<string, unknown>, key: string) => data[key] as Record<string, unknown>[];

beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  directory = await mkdtemp(path.join(tmpdir(), 'bivaro-recurring-union-zip-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
  try {
    storage = await import('@/lib/upload-path'); restore = await import('@/lib/backup-restore'); exportFull = await import('@/app/api/backup/full/route');
    plans = await import('@/lib/service-billing-service'); payments = await import('@/lib/payment-journal/service'); invoiceLifecycle = await import('@/lib/invoice-payments');
    reminders = await import('@/lib/reminder-workbench'); daily = await import('@/lib/daily-actions/service'); kpis = await import('@/app/api/dashboard/kpis/route');
    purchases = await import('@/lib/purchase-documents/service'); purchaseApproval = await import('@/lib/purchase-documents/approval');
    purchaseDraft = await import('@/lib/purchase-documents/save-review-draft'); suppliers = await import('@/lib/suppliers');
  } finally { cwd.mockRestore(); }
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  outbound = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No external service belongs in this synthetic fixture'));
  await database.client.user.createMany({ data: [source, target, mirror].map(id => ({ id, email: `${id}@synthetic.invalid`, password: 'unused synthetic fixture' })) });
  const customer = await database.client.customer.create({ data: { userId: source, name: 'Synthetic union support customer', contactPerson: 'Synthetic contact', email: 'customer@synthetic.invalid', phone: '000123', address: 'Testweg 1', zipCode: '00123', city: 'Teststadt', taxNumber: 'SYNTHETIC', internalNote: 'Private synthetic note', noteVisibility: 'EDITOR' } });
  await database.client.settings.create({ data: { userId: source, companyName: 'Synthetic union business', email: 'owner@synthetic.invalid', fiscalTaxRegime: 'STANDARD', fiscalEffectiveFrom: '2026-01-01', fiscalConfirmedAt: now } });
  await database.client.serviceArticle.create({ data: { userId: source, name: 'Synthetic support', nameKey: 'synthetic support', description: 'Reusable exact gross catalog price', unit: 'Pauschale', unitPriceCents: '10000', sourcePriceCents: '11900', sourcePriceBasis: 'GROSS', taxRate: '19' } });
  await database.client.annualBusinessContextRevision.create({ data: { userId: source, revision: 1, contextYear: 2026, effectiveFrom: '2026-01-01', foundingYear: 2020, previousYearTurnoverCents: '2400000', previousYearExternalTurnoverCents: '1000000', completeness: 'COMPLETE', sourceNote: 'Synthetic owner-declared prior-year records' } });

  const plan = await plans.createServiceBillingPlan(source, { name: 'Synthetic monthly support', customerId: customer.id, cadence: 'MONTHLY', anchorDate: '2026-01-31', taxMode: 'standard', items: [{ description: 'Synthetic support', quantity: 1, unitPrice: 100, unit: 'Pauschale', taxRate: 19 }] });
  async function decide(action: 'GENERATE' | 'SKIP') {
    const current = await database.client.serviceBillingPlan.findUniqueOrThrow({ where: { id: plan.id } });
    return plans.reviewServiceBillingPeriod(source, { planId: plan.id, revision: current.revision, periodIndex: current.nextPeriod, action, confirmed: true }, '2026-10-21');
  }
  noFileId = (await decide('GENERATE')).invoiceId!;
  renderedId = (await decide('GENERATE')).invoiceId!;
  const renderedXml = Buffer.from('<Invoice><ID>SYNTHETIC-SERVICE-119</ID><IssueDate>2026-02-28</IssueDate><DocumentCurrencyCode>EUR</DocumentCurrencyCode><LegalMonetaryTotal><TaxInclusiveAmount>119.00</TaxInclusiveAmount><PayableAmount>119.00</PayableAmount></LegalMonetaryTotal></Invoice>');
  const renderedFile = await storage.writeTenantFile(source, 'reviewed-service.xml', renderedXml);
  // Existing consciously rendered source state; editor replacement is covered by its native lifecycle suite.
  await database.client.invoice.update({ where: { id: renderedId }, data: { fileName: 'reviewed-service.xml', storedFileName: renderedFile, invoiceNumber: 'SYNTHETIC-SERVICE-119', invoiceDate: new Date('2026-02-28T00:00:00.000Z'), dueDate: new Date('2026-09-01T00:00:00.000Z'), status: 'SENT', issuanceState: 'ISSUED', parsedData: { currency: 'EUR' } } });
  await payments.recordFullPayment(source, renderedId, { amount: '39.00', currency: 'EUR', paidAt: '2026-10-01', source: 'MANUAL', reference: 'Synthetic source statement', expectedPaidCents: '0', idempotencyKey: 'union-source-payment-39' });
  const preview = await reminders.previewReminder(source, renderedId);
  await reminders.recordReminder(source, renderedId, { expectedBalanceVersion: preview.balanceVersion, idempotencyKey: 'union-source-reminder-80', fee: 5, notes: 'Historical confirmed remainder, not delivery proof' });
  deletedId = (await decide('GENERATE')).invoiceId!; await invoiceLifecycle.deleteInvoice(source, deletedId);
  await decide('SKIP');
  const current = await database.client.serviceBillingPlan.findUniqueOrThrow({ where: { id: plan.id } });
  await plans.updateServiceBillingPlan(source, { id: plan.id, revision: current.revision, status: 'PAUSED' }); planStableKey = current.stableKey;

  const pdf = await PDFDocument.create(); pdf.addPage([300, 150]).drawText('Synthetic quote source');
  const quoteFile = await storage.writeTenantFile(source, 'synthetic-quote.pdf', await pdf.save());
  quoteId = (await database.client.invoice.create({ data: { userId: source, customerId: customer.id, type: 'QUOTE', status: 'SENT', issuanceState: 'ISSUED', fileName: 'synthetic-quote.pdf', storedFileName: quoteFile, invoiceNumber: 'AN-SYNTHETIC-UNION', totalAmount: 500, parsedData: { currency: 'EUR' }, quoteFollowUpOn: '2026-10-20', quoteResponseNote: 'Manual response, not acceptance', validUntil: new Date('2026-10-25T00:00:00.000Z') } })).id;

  const supplier = await suppliers.createSupplier(source, { name: 'Synthetic office supplier', city: 'Teststadt', email: 'supplier@synthetic.invalid' });
  const photo = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#ffffff' } }).png().toBuffer();
  let incoming = (await purchases.intakePurchaseDocument({ userId: source, requestId: randomUUID(), originalFileName: 'synthetic-office.png', mediaType: 'image/png', bytes: photo })).document;
  incoming = await purchaseApproval.selectPurchaseSupplier(source, incoming.id, incoming.revision, supplier.id);
  incoming = await purchaseDraft.savePurchaseReviewDraft(source, incoming.id, incoming.revision, { supplierName: supplier.name, invoiceNumber: 'PHOTO-SYNTHETIC-1234', invoiceDate: '2026-10-19', paymentDate: '2026-10-20', amount: '12.34', note: 'Synthetic manually reviewed source' });
  await purchaseApproval.approvePurchaseExpense(source, incoming.id, { approvalRequestId: randomUUID(), expectedRevision: incoming.revision, description: 'Synthetic office supplies', amount: '12.34', expenseDate: '2026-10-20', category: 'Büromaterial', taxRelevant: true, taxDeductiblePercentage: '100', depreciationYears: null, confirmPaymentDate: true, confirmReviewedOriginal: true, confirmBuyerBelongsToBusiness: true, acknowledgedDuplicates: [], manualPhotoReview: { expectedDraft: incoming.reviewDraft, expectedDraftSavedAt: incoming.reviewDraftSavedAt, buyerName: 'Synthetic union business', currency: 'EUR', documentType: 'INVOICE', confirmSourceOwnership: true, confirmExactDraftValues: true, confirmOrdinaryInvoice: true } });
  const aiPhoto = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#eeeeee' } }).png().toBuffer();
  const aiSource = (await purchases.intakePurchaseDocument({ userId: source, requestId: randomUUID(), originalFileName: 'synthetic-ai.png', mediaType: 'image/png', bytes: aiPhoto })).document;
  const result = validateAiReceiptResult(JSON.stringify({ supplierName: 'Synthetic AI candidate', invoiceNumber: 'AI-SYNTHETIC-29', invoiceDate: '2026-10-20', currency: 'EUR', documentType: 'INVOICE', grossAmount: '0.29', netAmount: '0.24', taxAmount: '0.05', lineItems: [], lineItemsComplete: true }));
  const completed: AiExtractionJob = { id: randomUUID(), configVersion: 1, configRevision: randomUUID(), status: 'completed', sourceSha256: aiSource.originalRef.sha256, sourceRevision: aiSource.revision, createdAt: '2026-10-21T08:00:00.000Z', deadlineAt: '2026-10-21T08:01:30.000Z', finishedAt: '2026-10-21T08:00:30.000Z', errorCode: null, result, draftApplied: false };
  const running: AiExtractionJob = { ...completed, id: randomUUID(), status: 'running', result: null, finishedAt: null };
  await database.client.purchaseDocument.update({ where: { id: aiSource.id }, data: { aiExtraction: { version: 1, jobs: [completed, running] } as unknown as Prisma.InputJsonValue } });
  await database.client.aiProviderSettings.create({ data: { userId: source, enabled: true, autoAnalyzeNewUploads: true, baseUrl: 'https://source.synthetic.invalid/v1', model: 'synthetic-source', keyCiphertext: 'SOURCE-SYNTHETIC-KEY', keyIv: 'source-synthetic-iv', keyTag: 'source-synthetic-tag' } });
  targetProvider = await database.client.aiProviderSettings.create({ data: { userId: target, enabled: true, autoAnalyzeNewUploads: true, baseUrl: 'https://target.synthetic.invalid/v1', model: 'synthetic-target', keyCiphertext: 'TARGET-SYNTHETIC-KEY', keyIv: 'target-synthetic-iv', keyTag: 'target-synthetic-tag' } });
  mirrorProvider = await database.client.aiProviderSettings.create({ data: { userId: mirror, enabled: false, baseUrl: 'https://mirror.synthetic.invalid/v1', model: 'synthetic-mirror', keyCiphertext: 'MIRROR-SYNTHETIC-KEY', keyIv: 'mirror-synthetic-iv', keyTag: 'mirror-synthetic-tag' } });
}, 40_000);
afterAll(async () => { outbound?.mockRestore(); vi.useRealTimers(); await database?.cleanup(); if (directory) await rm(directory, { recursive: true, force: true }); });

async function archiveOf(userId: string): Promise<FullArchive> {
  state.userId = userId;
  const response = await exportFull.GET(); expect(response.status).toBe(200);
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const backup = JSON.parse(await zip.file('backup.json')!.async('string'));
  expect(backup.manifest.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  expect(() => restore.validateBackupForRestore(backup)).not.toThrow();
  return { backup, zip };
}
async function apply(userId: string, archive: FullArchive) {
  return restore.restoreBackupData({ userId, overwrite: false, backup: archive.backup, resolveFile: async (kind, name) => {
    const entry = archive.backup.manifest.fileManifest.find(row => row.kind === kind && row.sourceName === name);
    return entry?.zipPath && archive.zip.file(entry.zipPath) ? archive.zip.file(entry.zipPath)!.async('uint8array') : null;
  } });
}
async function counts(userId: string) {
  const client = database.client;
  return { invoices: await client.invoice.count({ where: { userId } }), plans: await client.serviceBillingPlan.count({ where: { userId } }), periods: await client.serviceBillingPeriod.count({ where: { userId } }), reminders: await client.reminder.count({ where: { userId } }), incomes: await client.income.count({ where: { userId } }), payments: await client.paymentJournalEvent.count({ where: { userId } }), expenses: await client.expense.count({ where: { userId } }), suppliers: await client.supplier.count({ where: { userId } }), customers: await client.customer.count({ where: { userId } }), articles: await client.serviceArticle.count({ where: { userId } }), receipts: await client.purchaseDocument.count({ where: { userId } }), contexts: await client.annualBusinessContextRevision.count({ where: { userId } }), counters: await client.invoiceNumberCounter.count({ where: { userId } }) };
}
async function assertJoinedIdentity(userId: string) {
  const plan = await database.client.serviceBillingPlan.findUniqueOrThrow({ where: { userId_stableKey: { userId, stableKey: planStableKey } }, include: { periods: { orderBy: { periodIndex: 'asc' }, include: { invoice: true } } } });
  expect(plan).toMatchObject({ status: 'PAUSED', nextPeriod: 4, anchorDate: '2026-01-31' });
  expect(plan.periods).toHaveLength(4);
  expect(isUnrenderedServiceBillingDraft(plan.periods[0].invoice)).toBe(true);
  expect(plan.periods[2]).toMatchObject({ action: 'GENERATED', invoiceId: null }); expect(plan.periods[3]).toMatchObject({ action: 'SKIPPED', invoiceId: null });
  const rendered = plan.periods[1].invoice!;
  expect(rendered).toMatchObject({ invoiceNumber: 'SYNTHETIC-SERVICE-119', type: 'INVOICE', status: 'SENT', issuanceState: 'ISSUED', totalAmount: 119 });
  const reminder = await database.client.reminder.findFirstOrThrow({ where: { userId } });
  const payment = await database.client.paymentJournalEvent.findFirstOrThrow({ where: { userId } });
  const income = await database.client.income.findFirstOrThrow({ where: { userId } });
  expect(reminder.invoiceId).toBe(rendered.id); expect(payment.invoiceId).toBe(rendered.id); expect(income.invoiceId).toBe(rendered.id); expect(payment.incomeId).toBe(income.id);
  expect(payment.amountCents).toBe('3900'); expect(reminder.balanceSnapshot).toMatchObject({ totalCents: '11900', paidCents: '3900', openCents: '8000' });
  if (userId !== source) expect(reminder.idempotencyKey).toMatch(/^restored:[a-f0-9]{64}$/u);
  expect(await counts(userId)).toEqual({ invoices: 3, plans: 1, periods: 4, reminders: 1, incomes: 1, payments: 1, expenses: 1, suppliers: 1, customers: 1, articles: 1, receipts: 2, contexts: 1, counters: 0 });
}

describe('full recurring, balance, AI, customer and daily union backup', () => {
  it('exports actual source bytes and owner-remaps both financial identities to the same rendered service period', async () => {
    sourceArchive = await archiveOf(source);
    const data = sourceArchive.backup.data;
    expect(records(data, 'invoices').find(row => row.id === noFileId)).toMatchObject({ invoiceNumber: null, storedFileName: '', issuanceState: 'UNISSUED' });
    expect(records(data, 'invoices').some(row => row.id === deletedId)).toBe(false);
    expect(sourceArchive.backup.manifest.fileManifest.filter(row => row.kind === 'invoice')).toHaveLength(2);
    expect(sourceArchive.backup.manifest.fileManifest.some(row => row.sourceName === '')).toBe(false);
    expect(sourceArchive.backup.manifest.modelCoverage).toContainEqual(expect.objectContaining({ model: 'AiProviderSettings', mode: 'excluded' }));
    expect(JSON.stringify(sourceArchive.backup)).not.toContain('SOURCE-SYNTHETIC-KEY');
    await apply(target, sourceArchive); await apply(target, sourceArchive); await assertJoinedIdentity(target);
    const sourceManual = await database.client.purchaseDocument.findFirstOrThrow({ where: { userId: source, reviewStatus: 'BOOKED' } });
    const targetManual = await database.client.purchaseDocument.findFirstOrThrow({ where: { userId: target, reviewStatus: 'BOOKED' } });
    expect(targetManual.reviewedSourceSnapshot).toMatchObject({ ownerId: target, reviewedByTenantId: source, provenance: 'MANUAL_PHOTO_REVIEW' });
    expect(hashBytes(await readFile(storage.getTenantUploadPath(target, targetManual.storedFileName)))).toBe(sourceManual.originalSha256);
    const sourceRendered = await database.client.invoice.findUniqueOrThrow({ where: { id: renderedId } });
    const targetRendered = await database.client.invoice.findFirstOrThrow({ where: { userId: target, invoiceNumber: sourceRendered.invoiceNumber } });
    expect(hashBytes(await readFile(storage.getTenantUploadPath(target, targetRendered.storedFileName)))).toBe(hashBytes(await readFile(storage.getTenantUploadPath(source, sourceRendered.storedFileName))));
    const restoredAi = await database.client.purchaseDocument.findFirstOrThrow({ where: { userId: target, reviewStatus: 'REVIEW' } });
    expect(restoredAi.aiExtraction).toMatchObject({ version: 1, jobs: [{ status: 'completed' }, { status: 'unknown', errorCode: 'AI_RESTORED_INTERRUPTED' }] });
    expect(await database.client.invoice.findFirstOrThrow({ where: { userId: target, type: 'QUOTE' } })).toMatchObject({ quoteFollowUpOn: '2026-10-20', quoteResponseNote: 'Manual response, not acceptance' });
    expect(await database.client.customer.findFirstOrThrow({ where: { userId: target } })).toMatchObject({ zipCode: '00123', internalNote: 'Private synthetic note', noteVisibility: 'EDITOR' });
    expect(await database.client.serviceArticle.findFirstOrThrow({ where: { userId: target } })).toMatchObject({ unitPriceCents: '10000', sourcePriceCents: '11900', sourcePriceBasis: 'GROSS', taxRate: '19' });
    expect(await database.client.aiProviderSettings.findUniqueOrThrow({ where: { userId: target } })).toEqual(targetProvider);
    targetArchive = await archiveOf(target); await apply(target, targetArchive); await assertJoinedIdentity(target);
    expect(outbound).not.toHaveBeenCalled();
  });
  it('safely rejects the known supplier-linked photo multi-hop return without partial writes', async () => {
    await apply(mirror, targetArchive); await assertJoinedIdentity(mirror);
    const reexported = await archiveOf(mirror);
    const snapshot = (await import('@/lib/backup-snapshot')).readBackupSnapshot;
    const before = (await snapshot(target)).data;
    const providerBefore = await database.client.aiProviderSettings.findUniqueOrThrow({ where: { userId: target } });
    // Supplier imports currently identify the immediate source, not a portable
    // multi-hop alias. The reviewed-photo supplier fingerprint must fail closed.
    await expect(apply(target, reexported)).rejects.toThrow('Eingangsbeleg-Kollision: Prüfzustand oder Originalmetadaten unterscheiden sich');
    expect((await snapshot(target)).data).toEqual(before);
    expect(await database.client.aiProviderSettings.findUniqueOrThrow({ where: { userId: target } })).toEqual(providerBefore);
    await assertJoinedIdentity(target);
    expect(await database.client.aiProviderSettings.findUniqueOrThrow({ where: { userId: target } })).toEqual(targetProvider);
    expect(await database.client.aiProviderSettings.findUniqueOrThrow({ where: { userId: mirror } })).toEqual(mirrorProvider);
    expect(outbound).not.toHaveBeenCalled();
  });
  it('round-trips separate native recurring, payment and confirmed-reminder full ZIPs through three owners', async () => {
    // These are independent native tenants, never a full-feature archive with
    // supplier/photo evidence removed to hide the known multi-hop limitation.
    const portableSource = 'union-portable-source', portableTarget = 'union-portable-target', portableMirror = 'union-portable-mirror';
    await database.client.user.createMany({ data: [portableSource, portableTarget, portableMirror].map(id => ({ id, email: `${id}@synthetic.invalid`, password: 'unused synthetic fixture' })) });
    const customer = await database.client.customer.create({ data: { userId: portableSource, name: 'Synthetic portable support customer', address: 'Testweg 2', zipCode: '00124', city: 'Teststadt' } });
    await database.client.settings.create({ data: { userId: portableSource, companyName: 'Synthetic portable business', fiscalTaxRegime: 'STANDARD', fiscalEffectiveFrom: '2026-01-01', fiscalConfirmedAt: now } });
    const plan = await plans.createServiceBillingPlan(portableSource, { name: 'Synthetic portable monthly support', customerId: customer.id, cadence: 'MONTHLY', anchorDate: '2026-01-31', taxMode: 'standard', items: [{ description: 'Synthetic portable support', quantity: 1, unitPrice: 100, unit: 'Pauschale', taxRate: 19 }] });
    async function decide(action: 'GENERATE' | 'SKIP') {
      const current = await database.client.serviceBillingPlan.findUniqueOrThrow({ where: { id: plan.id } });
      return plans.reviewServiceBillingPeriod(portableSource, { planId: plan.id, revision: current.revision, periodIndex: current.nextPeriod, action, confirmed: true }, '2026-10-21');
    }
    const seedId = (await decide('GENERATE')).invoiceId!;
    const renderedId = (await decide('GENERATE')).invoiceId!;
    const xml = Buffer.from('<Invoice><ID>SYNTHETIC-PORTABLE-119</ID><IssueDate>2026-02-28</IssueDate><DocumentCurrencyCode>EUR</DocumentCurrencyCode><LegalMonetaryTotal><TaxInclusiveAmount>119.00</TaxInclusiveAmount><PayableAmount>119.00</PayableAmount></LegalMonetaryTotal></Invoice>');
    const file = await storage.writeTenantFile(portableSource, 'portable-reviewed-service.xml', xml);
    await database.client.invoice.update({ where: { id: renderedId }, data: { fileName: 'portable-reviewed-service.xml', storedFileName: file, invoiceNumber: 'SYNTHETIC-PORTABLE-119', invoiceDate: new Date('2026-02-28T00:00:00.000Z'), dueDate: new Date('2026-09-01T00:00:00.000Z'), status: 'SENT', issuanceState: 'ISSUED', parsedData: { currency: 'EUR' } } });
    await payments.recordFullPayment(portableSource, renderedId, { amount: '39.00', currency: 'EUR', paidAt: '2026-10-01', source: 'MANUAL', reference: 'Synthetic portable statement', expectedPaidCents: '0', idempotencyKey: 'union-portable-payment-39' });
    const preview = await reminders.previewReminder(portableSource, renderedId);
    await reminders.recordReminder(portableSource, renderedId, { expectedBalanceVersion: preview.balanceVersion, idempotencyKey: 'union-portable-reminder-80', fee: 5, notes: 'Synthetic confirmed history, never delivery proof' });
    const deletedId = (await decide('GENERATE')).invoiceId!;
    await invoiceLifecycle.deleteInvoice(portableSource, deletedId); await decide('SKIP');
    const current = await database.client.serviceBillingPlan.findUniqueOrThrow({ where: { id: plan.id } });
    await plans.updateServiceBillingPlan(portableSource, { id: plan.id, revision: current.revision, status: 'PAUSED' });
    const providers = new Map<string, typeof targetProvider>();
    for (const userId of [portableSource, portableTarget, portableMirror]) providers.set(userId, await database.client.aiProviderSettings.create({ data: { userId, enabled: false, baseUrl: 'https://portable.synthetic.invalid/v1', model: userId, keyCiphertext: `${userId}-SYNTHETIC-KEY`, keyIv: `${userId}-iv`, keyTag: `${userId}-tag` } }));
    async function assertPortable(userId: string) {
      const restored = await database.client.serviceBillingPlan.findUniqueOrThrow({ where: { userId_stableKey: { userId, stableKey: current.stableKey } }, include: { periods: { orderBy: { periodIndex: 'asc' }, include: { invoice: true } } } });
      expect(restored).toMatchObject({ status: 'PAUSED', nextPeriod: 4, anchorDate: '2026-01-31' });
      expect(restored.periods).toHaveLength(4);
      expect(isUnrenderedServiceBillingDraft(restored.periods[0].invoice)).toBe(true);
      expect(restored.periods[2]).toMatchObject({ action: 'GENERATED', invoiceId: null });
      expect(restored.periods[3]).toMatchObject({ action: 'SKIPPED', invoiceId: null });
      const rendered = restored.periods[1].invoice!;
      expect(rendered).toMatchObject({ userId, invoiceNumber: 'SYNTHETIC-PORTABLE-119', type: 'INVOICE', status: 'SENT', issuanceState: 'ISSUED', totalAmount: 119 });
      const reminder = await database.client.reminder.findFirstOrThrow({ where: { userId } });
      const payment = await database.client.paymentJournalEvent.findFirstOrThrow({ where: { userId } });
      const income = await database.client.income.findFirstOrThrow({ where: { userId } });
      expect(reminder.invoiceId).toBe(rendered.id); expect(payment.invoiceId).toBe(rendered.id); expect(income.invoiceId).toBe(rendered.id); expect(payment.incomeId).toBe(income.id);
      expect(payment.amountCents).toBe('3900'); expect(reminder.balanceSnapshot).toMatchObject({ totalCents: '11900', paidCents: '3900', openCents: '8000' });
      expect(hashBytes(await readFile(storage.getTenantUploadPath(userId, rendered.storedFileName)))).toBe(hashBytes(xml));
      expect(await counts(userId)).toEqual({ invoices: 2, plans: 1, periods: 4, reminders: 1, incomes: 1, payments: 1, expenses: 0, suppliers: 0, customers: 1, articles: 0, receipts: 0, contexts: 0, counters: 0 });
      expect(await database.client.aiProviderSettings.findUniqueOrThrow({ where: { userId } })).toEqual(providers.get(userId));
    }
    const original = await archiveOf(portableSource);
    expect(records(original.backup.data, 'invoices').some(row => row.id === seedId && row.storedFileName === '')).toBe(true);
    for (const key of ['suppliers', 'purchaseDocuments', 'expenses']) expect(records(original.backup.data, key)).toEqual([]);
    expect(original.backup.manifest.fileManifest.filter(row => row.kind === 'invoice')).toHaveLength(1);
    await apply(portableTarget, original); await apply(portableTarget, original); await assertPortable(portableTarget);
    const second = await archiveOf(portableTarget); await apply(portableMirror, second); await assertPortable(portableMirror);
    const third = await archiveOf(portableMirror); await apply(portableTarget, third); await apply(portableTarget, third); await assertPortable(portableTarget);
    await apply(portableSource, third); await assertPortable(portableSource);
    const final = await archiveOf(portableTarget); await apply(portableMirror, final); await assertPortable(portableMirror);
    expect(outbound).not.toHaveBeenCalled();
  });
  it('reads restored daily actions and revenue without new drafts, financial writes, delivery or provider calls', async () => {
    const before = await counts(target); const audits = await database.client.auditLog.count({ where: { userId: target } });
    const queries: string[] = []; database.client.$on('query', event => { queries.push(event.query); });
    state.userId = target;
    const actions = await daily.readDailyActions(target, now);
    const rendered = await database.client.invoice.findFirstOrThrow({ where: { userId: target, invoiceNumber: 'SYNTHETIC-SERVICE-119' } });
    expect(actions.actions.find(row => row.id === `invoice:${rendered.id}`)).toMatchObject({ kind: 'INVOICE_OVERDUE', amountCents: '8000' });
    expect(actions.actions.filter(row => row.id.startsWith('invoice:'))).toHaveLength(1);
    const quote = await database.client.invoice.findFirstOrThrow({ where: { userId: target, type: 'QUOTE' } });
    expect(actions.actions.some(row => row.id === `quote:${quote.id}`)).toBe(true);
    expect(quote.id).not.toBe(quoteId);
    const response = await kpis.GET(new NextRequest('http://localhost/api/dashboard/kpis'));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ openInvoices: 80, openInvoicesReviewRequired: 0, revenueBasis: { inAppRevenue: 39, businessTotal: null, context: { sourceNote: 'Synthetic owner-declared prior-year records' } } });
    expect(queries.some(query => /\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(query))).toBe(false);
    expect(await counts(target)).toEqual(before); expect(await database.client.auditLog.count({ where: { userId: target } })).toBe(audits);
    expect(await database.client.aiProviderSettings.findUniqueOrThrow({ where: { userId: target } })).toEqual(targetProvider);
    expect(outbound).not.toHaveBeenCalled();
  });
});
