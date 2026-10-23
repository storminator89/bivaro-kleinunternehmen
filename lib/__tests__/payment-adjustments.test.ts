import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';
import { readInvoicePaymentJournal, recordFullPayment, adoptLegacyPaidInvoice } from '@/lib/payment-journal/service';
import { recordPaymentAdjustment } from '@/lib/payment-journal/adjustment-service';
import type { AdjustmentInput } from '@/lib/payment-journal/adjustment-contract';
import { operationalIncomeEntriesSql } from '@/lib/payment-journal/accounting-source';
import { readBackupSnapshot } from '@/lib/backup-snapshot';
import { createBackupManifest, CURRENT_SCHEMA_VERSION, RECURRING_BALANCE_DAILY_SCHEMA_VERSION } from '@/lib/backup-manifest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import { readPaymentAdjustmentPreflight, paymentAdjustmentAttempt, paymentAdjustmentPayload, readConfirmedPaymentAdjustment } from '@/lib/payment-adjustment-form';
import { createCashTransaction } from '@/lib/cashbook-service';
import { adjustmentFingerprint } from '@/lib/payment-journal/adjustment-evidence';
import { reminderBalance } from '@/lib/reminder-workbench';
import { ownedInvoice } from '@/lib/payment-journal/service';
afterEach(() => vi.unstubAllEnvs());

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, userId: 'adjustment-owner' as string | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return { requireUserId: async () => { if (!state.userId) throw new UnauthorizedError(); return state.userId; }, getUserId: async () => state.userId, UnauthorizedError, unauthorizedResponse: () => new Response(null, { status: 401 }) };
});
let validateBackupForRestore: typeof import('@/lib/backup-restore')['validateBackupForRestore'];
let restoreBackupData: typeof import('@/lib/backup-restore')['restoreBackupData'];
let storageRoot: string;
let db: ReturnType<typeof createTestDatabase>, next = 0;
const owner = 'adjustment-owner';
const key = () => `adjustment-command-${++next}`;
async function paid(amount = '120.00', paidAt = '2025-06-15') {
  const invoice = await db.client.invoice.create({ data: { userId: owner, invoiceNumber: `2026-${++next}`, fileName: 'synthetic.pdf', storedFileName: 'synthetic.pdf', parsedData: { currency: 'EUR', taxMode: 'small-business', taxAmount: 0 }, totalAmount: 120, status: 'SENT', issuanceState: 'ISSUED', invoiceDate: new Date('2025-06-01') } });
  const payment = await recordFullPayment(owner, invoice.id, { amount, paidAt, currency: 'EUR', source: 'MANUAL', reference: 'Synthetic original receipt', idempotencyKey: key(), expectedPaidCents: '0' });
  return { invoice, payment: payment.event };
}
async function cancel(invoiceId: number) {
  const source = await db.client.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const basis = await db.client.invoice.create({ data: { type: 'CREDIT_NOTE', userId: owner, originalInvoiceId: invoiceId, invoiceNumber: `2026-GS-${++next}`, fileName: 'synthetic-cancellation.pdf', storedFileName: 'synthetic-cancellation.pdf', parsedData: { currency: 'EUR', taxMode: 'small-business' }, totalAmount: -120, status: 'SENT', issuanceState: 'ISSUED', invoiceDate: new Date('2026-03-01'), cancellationReason: 'Synthetic full cancellation', customerId: source.customerId } });
  await db.client.invoice.update({ where: { id: invoiceId }, data: { status: 'CANCELLED', cancellationReason: 'Synthetic full cancellation' } });
  return basis;
}
async function command(invoiceId: number, root: number, extra: Partial<AdjustmentInput> = {}): Promise<AdjustmentInput> {
  return { kind: 'PAYMENT_CORRECTION', originalPaymentId: root, amount: '20.00', actionDate: '2026-03-03', reason: 'This recorded portion never arrived', reference: key(), idempotencyKey: key(), expectedLedgerVersion: (await readInvoicePaymentJournal(owner, invoiceId)).ledgerVersion, declarationNeverReceived: true, ...extra };
}
async function snapshot(userId = owner) {
  const data = (await readBackupSnapshot(userId)).data;
  return { version: '3.0', data, manifest: createBackupManifest({ sourceUserId: userId, data, generatedAt: new Date().toISOString() }) };
}
beforeAll(async () => {
  db = createTestDatabase(); state.client = db.client;
  storageRoot = mkdtempSync(path.join(tmpdir(), 'bivaro-adjustments-storage-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(storageRoot);
  try { ({ validateBackupForRestore, restoreBackupData } = await import('@/lib/backup-restore')); } finally { cwd.mockRestore(); }
  await db.client.user.createMany({ data: [owner,'adjustment-other','adjustment-restore'].map(id => ({ id, email: `${id}@test.invalid`, password: 'synthetic-only' })) });
}, 40_000);
afterAll(async () => { await db?.cleanup(); if (storageRoot) rmSync(storageRoot, { recursive: true, force: true }); });
describe('operational append-only adjustment contract', () => {
  it('corrects only never-received portions in original period and allows a replacement real receipt', async () => {
    const { invoice, payment } = await paid(); const originalIncome = await db.client.income.findUniqueOrThrow({ where: { id: payment.incomeId! } });
    const result = await recordPaymentAdjustment(owner, invoice.id, await command(invoice.id, payment.id, { amount: '120.00' }));
    expect(result.ledger).toMatchObject({ correctedCents: '12000', validReceivedCents: '0', collectibleOpenCents: '12000', refundDueCents: '0' });
    expect(result.adjustment.accountingEffectiveOn).toEqual(payment.paidAt);
    expect(await db.client.paymentJournalEvent.findUnique({ where: { id: payment.id } })).toEqual(payment);
    expect(await db.client.income.findUnique({ where: { id: payment.incomeId! } })).toEqual(originalIncome);
    const reopened = await db.client.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(reopened).toMatchObject({ status: 'SENT', issuanceState: 'ISSUED', paidAt: null });
    await expect(recordFullPayment(owner, invoice.id, { amount: '120', currency: 'EUR', paidAt: '2026-03-04', source: 'MANUAL', reference: 'Replacement actual receipt', idempotencyKey: key(), expectedPaidCents: '0' })).rejects.toMatchObject({ code: 'PAYMENT_STATE_CHANGED' });
    await recordFullPayment(owner, invoice.id, { amount: '120', currency: 'EUR', paidAt: '2026-03-04', source: 'MANUAL', reference: 'Replacement actual receipt', idempotencyKey: key(), expectedPaidCents: '0', expectedLedgerVersion: result.ledgerVersion });
    expect((await readInvoicePaymentJournal(owner, invoice.id)).ledger).toMatchObject({ originalReceivedCents: '24000', correctedCents: '12000', validReceivedCents: '12000', collectibleOpenCents: '0' });
  });
  it('keeps cancellation distinct from a later cross-year real refund and never creates collectible debt', async () => {
    const { invoice, payment } = await paid(); const basis = await cancel(invoice.id);
    expect((await readInvoicePaymentJournal(owner, invoice.id)).ledger).toMatchObject({ collectibleOpenCents: '0', refundDueCents: '12000', refundedCents: '0' });
    const input = await command(invoice.id, payment.id, { kind: 'CUSTOMER_REFUND', amount: '40.00', cancellationInvoiceId: basis.id, declarationNeverReceived: undefined, reference: 'Synthetic payout 1' });
    expect((await readInvoicePaymentJournal(owner, invoice.id)).eligibleCancellationBasis?.invoiceId).toBe(basis.id);
    const saved = await recordPaymentAdjustment(owner, invoice.id, input);
    expect(saved.ledger).toMatchObject({ validReceivedCents: '12000', refundedCents: '4000', netRetainedCents: '8000', refundDueCents: '8000', collectibleOpenCents: '0' });
    expect(saved.adjustment.accountingEffectiveOn.toISOString()).toBe('2026-03-03T00:00:00.000Z');
    expect((await db.client.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('CANCELLED');
    expect((await recordPaymentAdjustment(owner, invoice.id, input)).replayed).toBe(true);
    await expect(recordPaymentAdjustment(owner, invoice.id, { ...input, idempotencyKey: key(), expectedLedgerVersion: saved.ledgerVersion })).rejects.toMatchObject({ code: 'DUPLICATE_PAYOUT_EVIDENCE' });
    expect(() => reminderBalance({ ...invoice, status: 'CANCELLED' } as never)).toThrow();
    await expect(db.client.invoice.update({ where: { id: basis.id }, data: { totalAmount: -100 } })).rejects.toThrow();
  });
  it('concurrent refunds share remaining capacity, and same-key replay creates one audit/event', async () => {
    const { invoice, payment } = await paid(); const basis = await cancel(invoice.id);
    const input = await command(invoice.id, payment.id, { kind: 'CUSTOMER_REFUND', amount: '80', cancellationInvoiceId: basis.id, declarationNeverReceived: undefined });
    const results = await Promise.allSettled([recordPaymentAdjustment(owner, invoice.id, input), recordPaymentAdjustment(owner, invoice.id, { ...input, idempotencyKey: key(), reference: key() })]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.client.paymentAdjustment.count({ where: { invoiceId: invoice.id } })).toBe(1);
    const current = await readInvoicePaymentJournal(owner, invoice.id);
    await expect(recordPaymentAdjustment(owner, invoice.id, await command(invoice.id, payment.id, { amount: '40.01', expectedLedgerVersion: current.ledgerVersion }))).rejects.toMatchObject({ code: 'PAYMENT_REVIEW_REQUIRED' });
    const retry = await Promise.all([recordPaymentAdjustment(owner, invoice.id, input), recordPaymentAdjustment(owner, invoice.id, input)]);
    expect(retry.every(result => result.replayed)).toBe(true);
    expect(await db.client.auditLog.count({ where: { entityId: String(invoice.id), action: 'CUSTOMER_REFUND' } })).toBe(1);
  });
  it('replays in a shared namespace and atomically rejects foreign, stale, fiscal-uncertain and invalid evidence', async () => {
    const { invoice, payment } = await paid();
    const input = await command(invoice.id, payment.id);
    await expect(recordPaymentAdjustment(owner, invoice.id, { ...input, idempotencyKey: payment.idempotencyKey })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(recordPaymentAdjustment('adjustment-other', invoice.id, input)).rejects.toMatchObject({ status: 404 });
    await expect(recordPaymentAdjustment(owner, invoice.id, { ...input, expectedLedgerVersion: '0'.repeat(64) })).rejects.toMatchObject({ code: 'PAYMENT_STATE_CHANGED' });
    for (const extra of [{ reason: ' ' }, { declarationNeverReceived: false }, { actionDate: '2099-01-01' }, { amount: '0' }]) await expect(recordPaymentAdjustment(owner, invoice.id, { ...input, ...extra })).rejects.toThrow();
    expect(await db.client.paymentAdjustment.count({ where: { invoiceId: invoice.id } })).toBe(0);
    await db.client.invoice.update({ where: { id: invoice.id }, data: { parsedData: { currency: 'EUR', taxMode: 'standard', taxAmount: 19 } } });
    await expect(recordPaymentAdjustment(owner, invoice.id, await command(invoice.id, payment.id))).rejects.toMatchObject({ code: 'PAYMENT_REVIEW_REQUIRED' });
    expect((await readInvoicePaymentJournal(owner, invoice.id)).canRecordAdjustment).toBe(false);
  });
  it('keeps signed operative movements including negative refund-only years, never treats a correction as current cash outflow', async () => {
    const { invoice, payment } = await paid('40'); const basis = await cancel(invoice.id);
    await recordPaymentAdjustment(owner, invoice.id, await command(invoice.id, payment.id, { kind: 'CUSTOMER_REFUND', amount: '40', declarationNeverReceived: undefined, cancellationInvoiceId: basis.id }));
    const movements = await db.client.$queryRaw<{ amountCents: number | bigint; bookingDate: number | bigint; movementKind: string }[]>(operationalIncomeEntriesSql(owner));
    expect(movements.some(row => row.movementKind === 'CUSTOMER_REFUND' && Number(row.amountCents) === -4000 && new Date(Number(row.bookingDate)).getUTCFullYear() === 2026)).toBe(true);
  });
  it('round trips exact-capability evidence with remapped original/basis links and preserves ancestor merges', async () => {
    const backup = await snapshot();
    expect(backup.manifest.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(() => validateBackupForRestore(backup)).not.toThrow();
    await restoreBackupData({ userId: 'adjustment-restore', backup, overwrite: true, resolveFile: async () => new Uint8Array([37,80,68,70]) });
    const restored = await snapshot('adjustment-restore');
    expect(() => validateBackupForRestore(restored)).not.toThrow();
    const count = await db.client.paymentAdjustment.count({ where: { userId: 'adjustment-restore' } });
    expect(count).toBeGreaterThan(0);
    const repeated = await restoreBackupData({ userId: 'adjustment-restore', backup, overwrite: false, resolveFile: async () => new Uint8Array([37,80,68,70]) });
    expect(repeated.paymentAdjustments).toEqual({ imported: 0, skipped: count });
    await expect(restoreBackupData({ userId: 'adjustment-restore', backup: { version: '2.0', data: {} }, overwrite: true, resolveFile: async () => new Uint8Array() })).rejects.toThrow(/unveränderliche/);
    const disguised = structuredClone(backup); disguised.manifest.schemaVersion = RECURRING_BALANCE_DAILY_SCHEMA_VERSION;
    expect(() => validateBackupForRestore(disguised)).toThrow();
    const malformed = structuredClone(backup); const records = malformed.data.paymentAdjustments as Record<string, unknown>[];
    records[0].amountCents = '999999'; malformed.manifest = createBackupManifest({ sourceUserId: owner, data: malformed.data, generatedAt: new Date().toISOString() });
    expect(() => validateBackupForRestore(malformed)).toThrow();
  });
  it('serializes concurrent correction and refund against the same original capacity', async () => {
    const { invoice, payment } = await paid(); const basis = await cancel(invoice.id);
    const correction = await command(invoice.id, payment.id, { amount: '80' });
    const refund = await command(invoice.id, payment.id, { kind: 'CUSTOMER_REFUND', amount: '80', declarationNeverReceived: undefined, cancellationInvoiceId: basis.id });
    const results = await Promise.allSettled([recordPaymentAdjustment(owner, invoice.id, correction), recordPaymentAdjustment(owner, invoice.id, refund)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const ledger = (await readInvoicePaymentJournal(owner, invoice.id)).ledger!;
    expect(BigInt(ledger.correctedCents)+BigInt(ledger.refundedCents)).toBe(BigInt(8000));
    expect(ledger).toMatchObject({ netRetainedCents: '4000', refundDueCents: '4000', collectibleOpenCents: '0' });
  });
  it('rejects legacy-unknown roots and cashbook linkage in both directions without financial writes', async () => {
    const legacy = await db.client.invoice.create({ data: { userId: owner, fileName: 'synthetic.pdf', storedFileName: 'synthetic.pdf', parsedData: { currency: 'EUR', taxMode: 'small-business' }, totalAmount: 120, status: 'PAID', issuanceState: 'ISSUED' } });
    const adopted = await adoptLegacyPaidInvoice(owner, legacy.id);
    await expect(recordPaymentAdjustment(owner, legacy.id, await command(legacy.id, adopted.event.id))).rejects.toMatchObject({ code: 'PAYMENT_REVIEW_REQUIRED' });
    const linked = await paid('40');
    const book = await db.client.cashBook.create({ data: { userId: owner, name: 'Synthetic only', initialBalance: 0 } });
    await createCashTransaction(owner, { cashBookId: book.id, type: 'EINNAHME', amount: 40, date: '2025-06-15', incomeId: linked.payment.incomeId, description: 'Synthetic cash receipt' });
    await expect(recordPaymentAdjustment(owner, linked.invoice.id, await command(linked.invoice.id, linked.payment.id))).rejects.toMatchObject({ code: 'CASHBOOK_ADJUSTMENT_UNSUPPORTED' });
    const adjusted = await paid();
    await recordPaymentAdjustment(owner, adjusted.invoice.id, await command(adjusted.invoice.id, adjusted.payment.id));
    const count = await db.client.cashTransaction.count({ where: { cashBookId: book.id } });
    await expect(createCashTransaction(owner, { cashBookId: book.id, type: 'EINNAHME', amount: 120, date: '2025-06-15', incomeId: adjusted.payment.incomeId, description: 'Excluded linkage' })).rejects.toMatchObject({ status: 409 });
    await expect(db.client.cashTransaction.create({ data: { userId: owner, cashBookId: book.id, type: 'EINNAHME', amount: 120, date: new Date('2025-06-15'), incomeId: adjusted.payment.incomeId, description: 'Excluded raw linkage', runningBalance: 160 } })).rejects.toThrow();
    expect(await db.client.cashTransaction.count({ where: { cashBookId: book.id } })).toBe(count);
  });
  it('KPI route corrects the represented prior year without inventing current-year cash outflow', async () => {
    const { GET: kpis } = await import('@/app/api/dashboard/kpis/route');
    const { invoice, payment } = await paid();
    const read = async (year: number) => {
      const response = await kpis(new Request(`http://localhost/api/dashboard/kpis?year=${year}`));
      expect(response.status).toBe(200); return response.json();
    };
    const beforePrior = await read(2025), beforeCurrent = await read(2026);
    await recordPaymentAdjustment(owner, invoice.id, await command(invoice.id, payment.id, { amount: '20', actionDate: '2026-03-03' }));
    const prior = await read(2025), current = await read(2026);
    expect(prior.yearComparison.revenueThisYearTotal).toBe(beforePrior.yearComparison.revenueThisYearTotal-20);
    expect(current.yearComparison.revenueThisYearTotal).toBe(beforeCurrent.yearComparison.revenueThisYearTotal);
    expect(BigInt(prior.operationalMovements.selectedYear.correctedCents)).toBe(BigInt(beforePrior.operationalMovements.selectedYear.correctedCents)+BigInt(2000));
    expect(current).toMatchObject({ paymentContractVersion: 3, fiscalMappingStatus: 'UNREVIEWED' });
    expect(current.recentActivities.some((row: Record<string, unknown>) => row.movementKind === 'CUSTOMER_REFUND' && typeof row.invoiceId === 'number')).toBe(true);
  });
  it('rolls adjustment, operation, lifecycle and mandatory audit back on audit failure', async () => {
    const { invoice, payment } = await paid();
    const original = await db.client.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    const input = await command(invoice.id, payment.id);
    await db.client.$executeRawUnsafe(`CREATE TRIGGER synthetic_adjustment_audit_failure BEFORE INSERT ON "AuditLog" WHEN NEW.action='PAYMENT_CORRECTION' BEGIN SELECT RAISE(ABORT,'Synthetic audit failure'); END`);
    try { await expect(recordPaymentAdjustment(owner, invoice.id, input)).rejects.toThrow(); }
    finally { await db.client.$executeRawUnsafe('DROP TRIGGER synthetic_adjustment_audit_failure'); }
    expect(await db.client.paymentAdjustment.count({ where: { invoiceId: invoice.id } })).toBe(0);
    expect(await db.client.paymentOperation.count({ where: { userId: owner, idempotencyKey: input.idempotencyKey } })).toBe(0);
    expect(await db.client.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toEqual(original);
  });
  it('merges PAID ancestor into later cancellation/refund and never regresses on ancestor replay', async () => {
    const target = 'adjustment-merge'; await db.client.user.create({ data: { id: target, email: `${target}@test.invalid`, password: 'synthetic' } });
    const { invoice, payment } = await paid(); const ancestor = await snapshot();
    await restoreBackupData({ userId: target, backup: ancestor, overwrite: true, resolveFile: async () => new Uint8Array([37,80,68,70]) });
    const basis = await cancel(invoice.id);
    await recordPaymentAdjustment(owner, invoice.id, await command(invoice.id, payment.id, { kind: 'CUSTOMER_REFUND', amount: '40', declarationNeverReceived: undefined, cancellationInvoiceId: basis.id }));
    const advanced = await snapshot();
    await restoreBackupData({ userId: target, backup: advanced, overwrite: false, resolveFile: async () => new Uint8Array([37,80,68,70]) });
    const targetInvoice = await db.client.invoice.findFirstOrThrow({ where: { userId: target, invoiceNumber: invoice.invoiceNumber } });
    expect((await readInvoicePaymentJournal(target, targetInvoice.id)).ledger).toMatchObject({ refundDueCents: '8000', refundedCents: '4000', collectibleOpenCents: '0' });
    const before = (await snapshot(target)).data;
    await restoreBackupData({ userId: target, backup: ancestor, overwrite: false, resolveFile: async () => new Uint8Array([37,80,68,70]) });
    expect((await snapshot(target)).data.paymentAdjustments).toEqual(before.paymentAdjustments);
    expect(await db.client.invoice.findUniqueOrThrow({ where: { id: targetInvoice.id } })).toEqual(targetInvoice);
  });
  it('neutral refund-only handoff includes outside-period original/basis context without duplicate cash', async () => {
    const { createAccountantExport, parseAccountantExportPeriod } = await import('@/lib/accountant-export');
    const result = await createAccountantExport(owner, parseAccountantExportPeriod(new URLSearchParams('year=2026')));
    const zip = await JSZip.loadAsync(result.bytes);
    const records = JSON.parse(await zip.file('records.json')!.async('string'));
    const refund = records.adjustments.find((row: Record<string, unknown>) => row.kind === 'CUSTOMER_REFUND');
    expect(refund).toMatchObject({ signedEffectCents: `-${refund.amountCents}`, fiscalMappingStatus: 'UNREVIEWED', accountingEffectiveInPeriod: true, contextOnly: false });
    expect(records.payments.find((row: Record<string, unknown>) => row.id === refund.originalPaymentId)).toMatchObject({ contextOnly: true, paymentDateInPeriod: false, movementKind: 'RECEIPT' });
    expect(records.invoices.some((row: Record<string, unknown>) => row.id === refund.cancellationInvoiceId)).toBe(true);
    expect(result.manifest).toMatchObject({ formatVersion: 2, fiscalMappingStatus: 'UNREVIEWED' });
  });
  it('blocks positive-only fiscal/raw consumers and old adjusted readers instead of returning stale totals', async () => {
    const [{ GET: eur }, { GET: tax }, { GET: summary }, { GET: incomes }, { GET: incomeExport }, { GET: journal }] = await Promise.all([
      import('@/app/api/eur-export/route'), import('@/app/api/tax-summary/route'), import('@/app/api/dashboard/summary/route'),
      import('@/app/api/incomes/route'), import('@/app/api/incomes/export/route'), import('@/app/api/invoices/[id]/payments/route'),
    ]);
    for (const route of [eur, tax, summary, incomes, incomeExport]) {
      const response = await route(new NextRequest('http://localhost/api/synthetic?year=2026'));
      expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'PAYMENT_ADJUSTMENTS_REVIEW_REQUIRED', fiscalMappingStatus: 'UNREVIEWED' });
    }
    const adjustment = await db.client.paymentAdjustment.findFirstOrThrow({ where: { userId: owner } });
    const old = await journal(new Request('http://localhost/api/synthetic'), { params: Promise.resolve({ id: String(adjustment.invoiceId) }) });
    expect(old.status).toBe(409); expect(await old.json()).toMatchObject({ code: 'PAYMENT_CAPABILITY_REQUIRED' });
    const current = await journal(new Request('http://localhost/api/synthetic', { headers: { 'X-Bivaro-Payment-Contract': '2' } }), { params: Promise.resolve({ id: String(adjustment.invoiceId) }) });
    expect(current.status).toBe(200); expect(await current.json()).toMatchObject({ ledger: { version: 2 } });
    const { GET: invoices } = await import('@/app/api/invoices/route');
    const oldList = await invoices(new Request('http://localhost/api/invoices')); expect(oldList.status).toBe(409); expect(await oldList.json()).toMatchObject({ code: 'PAYMENT_CAPABILITY_REQUIRED' });
    const currentList = await invoices(new Request('http://localhost/api/invoices', { headers: { 'X-Bivaro-Payment-Contract': '2' } })); expect(currentList.status).toBe(200); expect((await currentList.json()).items.some((row: Record<string, unknown>) => row.paymentLedger && (row.paymentLedger as Record<string, unknown>).version === 2)).toBe(true);
  });
  it('rejects missing current capability sections and conflicting restored source adjustment identity', async () => {
    const backup = await snapshot();
    for (const key of ['paymentAdjustments','paymentOperations']) {
      const broken = structuredClone(backup); delete broken.data[key]; broken.manifest = createBackupManifest({ sourceUserId: owner, data: broken.data, generatedAt: new Date().toISOString() });
      expect(() => validateBackupForRestore(broken)).toThrow(/erforderlichen Abschnitt/);
    }
    const target = 'adjustment-source-id'; await db.client.user.create({ data: { id: target, email: `${target}@test.invalid`, password: 'synthetic' } });
    await restoreBackupData({ userId: target, backup, overwrite: true, resolveFile: async () => new Uint8Array([37,80,68,70]) });
    const forged = structuredClone(backup); const adjustments = forged.data.paymentAdjustments as Record<string, unknown>[];
    const old = adjustments.find(row => row.kind === 'PAYMENT_CORRECTION' && row.amountCents === '12000')!;
    const movedId = 1000000; const clone: Record<string, unknown> = { ...old, id: movedId };
    old.idempotencyKey = key(); old.amountCents = '1';
    const root = (forged.data.paymentJournalEvents as Record<string, unknown>[]).find(row => row.id === old.originalPaymentId)!;
    old.semanticFingerprint = adjustmentFingerprint(old, root, null);
    // Reduce the retained original event so both source histories remain individually valid.
    clone.amountCents = '11999'; clone.semanticFingerprint = adjustmentFingerprint(clone, root, null);
    adjustments.push(clone);
    (forged.data.paymentOperations as Record<string, unknown>[]).push({ id: movedId, idempotencyKey: old.idempotencyKey, kind: old.kind, createdAt: old.recordedAt });
    // Keep audit graph complete for the altered synthetic evidence, then source identity still rejects it.
    for (const [offset, adjustment] of [old,clone].entries()) (forged.data.auditLogs as Record<string, unknown>[]).push({ id: movedId + offset + 1, userId: owner, action: adjustment.kind, entityType: 'Invoice', entityId: String(adjustment.invoiceId), createdAt: adjustment.recordedAt,
      newValues: JSON.stringify({ paymentAdjustmentId: adjustment.id, originalPaymentId: adjustment.originalPaymentId, kind: adjustment.kind, amountCents: adjustment.amountCents }), metadata: JSON.stringify({ actorId: owner, tenantId: owner, operation: 'synthetic-evidence', originalReference: 'synthetic', reason: 'synthetic' }) });
    forged.manifest = createBackupManifest({ sourceUserId: owner, data: forged.data, generatedAt: new Date().toISOString() });
    expect(() => validateBackupForRestore(forged)).not.toThrow();
    await expect(restoreBackupData({ userId: target, backup: forged, overwrite: false, resolveFile: async () => new Uint8Array([37,80,68,70]) })).rejects.toThrow(/Quellidentität/);
  });
  it('preserves verified source aliases across restore chains and rejects reused root/adjustment source IDs', async () => {
    for (const target of ['adjustment-chain-b','adjustment-chain-c']) await db.client.user.create({ data: { id: target, email: `${target}@test.invalid`, password: 'synthetic' } });
    const original = await snapshot();
    const apply = (userId: string, backup: unknown, overwrite = false) => restoreBackupData({ userId, backup, overwrite, resolveFile: async () => new Uint8Array([37,80,68,70]) });
    await apply('adjustment-chain-b', original, true); await apply('adjustment-chain-c', original, true);
    const middle = await snapshot('adjustment-chain-b');
    const rootsBefore = await db.client.paymentJournalEvent.count({ where: { userId: 'adjustment-chain-c' } });
    const adjustmentsBefore = await db.client.paymentAdjustment.count({ where: { userId: 'adjustment-chain-c' } });
    await apply('adjustment-chain-c', middle);
    const aliases = async () => (await db.client.auditLog.findMany({ where: { userId: 'adjustment-chain-c', action: 'RESTORE' } })).filter(row => row.metadata && JSON.parse(row.metadata).identityOnly === true).length;
    const aliasCount = await aliases(); expect(aliasCount).toBeGreaterThan(0);
    await apply('adjustment-chain-c', middle);
    expect(await aliases()).toBe(aliasCount);
    expect(await db.client.paymentJournalEvent.count({ where: { userId: 'adjustment-chain-c' } })).toBe(rootsBefore);
    expect(await db.client.paymentAdjustment.count({ where: { userId: 'adjustment-chain-c' } })).toBe(adjustmentsBefore);
    const repack = (backup: typeof middle) => { backup.manifest = createBackupManifest({ sourceUserId: 'adjustment-chain-b', data: backup.data, generatedAt: new Date().toISOString() }); return backup; };
    const changedRoot = structuredClone(middle);
    const roots = changedRoot.data.paymentJournalEvents as Record<string, unknown>[];
    const source = roots.find(row => roots.some(other => other.id !== row.id && other.invoiceId === row.invoiceId))!;
    const other = roots.find(row => row.id !== source.id && row.invoiceId === source.invoiceId)!;
    const from = source.id, to = other.id; source.id = to; other.id = from;
    for (const adjustment of changedRoot.data.paymentAdjustments as Record<string, unknown>[]) {
      if (adjustment.originalPaymentId === from) adjustment.originalPaymentId = to;
      else if (adjustment.originalPaymentId === to) adjustment.originalPaymentId = from;
    }
    for (const audit of changedRoot.data.auditLogs as Record<string, unknown>[]) {
      if (!audit.newValues) continue;
      const values = JSON.parse(String(audit.newValues));
      if (values.originalPaymentId === from) values.originalPaymentId = to;
      else if (values.originalPaymentId === to) values.originalPaymentId = from;
      audit.newValues = JSON.stringify(values);
    }
    repack(changedRoot); expect(() => validateBackupForRestore(changedRoot)).not.toThrow();
    await expect(apply('adjustment-chain-c', changedRoot)).rejects.toThrow(/Quellidentität/);
    const changedAdjustment = structuredClone(middle);
    const adjustments = changedAdjustment.data.paymentAdjustments as Record<string, unknown>[];
    const left = adjustments[0], right = adjustments[1], leftId = left.id, rightId = right.id;
    left.id = rightId; right.id = leftId;
    for (const audit of changedAdjustment.data.auditLogs as Record<string, unknown>[]) {
      if (!audit.newValues) continue;
      const values = JSON.parse(String(audit.newValues));
      if (values.paymentAdjustmentId === leftId) values.paymentAdjustmentId = rightId;
      else if (values.paymentAdjustmentId === rightId) values.paymentAdjustmentId = leftId;
      audit.newValues = JSON.stringify(values);
    }
    repack(changedAdjustment); expect(() => validateBackupForRestore(changedAdjustment)).not.toThrow();
    await expect(apply('adjustment-chain-c', changedAdjustment)).rejects.toThrow(/Quellidentität/);
  });
  it('rejects ancestor cash links added to already-adjusted target originals transactionally', async () => {
    const { invoice, payment } = await paid(); const ancestor = await snapshot();
    await recordPaymentAdjustment(owner, invoice.id, await command(invoice.id, payment.id));
    const target = 'adjustment-cash-merge'; await db.client.user.create({ data: { id: target, email: `${target}@test.invalid`, password: 'synthetic' } });
    await restoreBackupData({ userId: target, backup: await snapshot(), overwrite: true, resolveFile: async () => new Uint8Array([37,80,68,70]) });
    (ancestor.data.cashBooks as Record<string, unknown>[]).push({ id: 2000000, name: 'Synthetic conflicting ancestor book', initialBalance: 0, currency: 'EUR' });
    (ancestor.data.cashTransactions as Record<string, unknown>[]).push({ id: 2000001, cashBookId: 2000000, incomeId: payment.incomeId, type: 'EINNAHME', description: 'Synthetic forbidden late linkage', amount: 120, runningBalance: 120, date: payment.paidAt, createdAt: payment.createdAt, updatedAt: payment.createdAt });
    ancestor.manifest = createBackupManifest({ sourceUserId: owner, data: ancestor.data, generatedAt: new Date().toISOString() });
    expect(() => validateBackupForRestore(ancestor)).not.toThrow();
    const before = (await snapshot(target)).data;
    await expect(restoreBackupData({ userId: target, backup: ancestor, overwrite: false, resolveFile: async () => new Uint8Array([37,80,68,70]) })).rejects.toThrow();
    expect((await snapshot(target)).data).toEqual(before);
  });
  it('round trips actual backend JSON through the v2 UI parser and correction/refund confirmation', async () => {
    const { invoice, payment } = await paid();
    const wire = (value: unknown) => JSON.parse(JSON.stringify(value));
    const initial = readPaymentAdjustmentPreflight(wire(await readInvoicePaymentJournal(owner, invoice.id)), invoice.id);
    expect(initial.ledger.documentState).toBe('PAID');
    const draft = paymentAdjustmentAttempt(null, { kind: 'PAYMENT_CORRECTION', originalPaymentId: payment.id, amount: '20', actionDate: '2026-03-03', reason: 'Synthetic never received', reference: key(), expectedLedgerVersion: initial.ledgerVersion }, key);
    const result = await recordPaymentAdjustment(owner, invoice.id, paymentAdjustmentPayload(draft) as AdjustmentInput);
    expect(readConfirmedPaymentAdjustment(wire(result), draft, payment.paidAt!.toISOString())).toMatchObject({ amountCents: '2000', kind: 'PAYMENT_CORRECTION' });
    const basis = await cancel(invoice.id);
    const cancelled = readPaymentAdjustmentPreflight(wire(await readInvoicePaymentJournal(owner, invoice.id)), invoice.id);
    expect(cancelled.ledger).toMatchObject({ documentState: 'CANCELLED', validReceivedCents: '10000', refundDueCents: '10000', collectibleOpenCents: '0' });
    const refund = paymentAdjustmentAttempt(null, { kind: 'CUSTOMER_REFUND', originalPaymentId: payment.id, amount: '40', actionDate: '2026-03-04', reason: 'Synthetic actual payout', reference: key(), expectedLedgerVersion: cancelled.ledgerVersion, cancellationInvoiceId: basis.id }, key);
    const saved = await recordPaymentAdjustment(owner, invoice.id, paymentAdjustmentPayload(refund) as AdjustmentInput);
    expect(readConfirmedPaymentAdjustment(wire(saved), refund)).toMatchObject({ amountCents: '4000', kind: 'CUSTOMER_REFUND' });
    expect(readPaymentAdjustmentPreflight(wire(await readInvoicePaymentJournal(owner, invoice.id)), invoice.id).ledger).toMatchObject({ refundedCents: '4000', netRetainedCents: '6000', refundDueCents: '6000', collectibleOpenCents: '0' });
  });
  it('authenticates and same-origin protects the adjustment HTTP contract, validates fields, and replays once', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost');
    const { POST } = await import('@/app/api/invoices/[id]/payments/adjustments/route');
    const { invoice, payment } = await paid();
    const input = await command(invoice.id, payment.id);
    const context = { params: Promise.resolve({ id: String(invoice.id) }) };
    const request = (body: unknown, origin = 'http://localhost') => new Request('http://localhost/api/synthetic', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
    const foreign = await POST(request(input, 'https://cross-origin.test.invalid'), context);
    expect(foreign.status).toBe(403);
    state.userId = null;
    try { expect((await POST(request(input), context)).status).toBe(401); } finally { state.userId = owner; }
    expect((await POST(request({ ...input, currency: 'EUR' }), context)).status).toBe(400);
    expect(await db.client.paymentAdjustment.count({ where: { invoiceId: invoice.id } })).toBe(0);
    const saved = await POST(request(input), context); expect(saved.status).toBe(201);
    expect(await saved.json()).toMatchObject({ replayed: false, adjustment: { kind: 'PAYMENT_CORRECTION', amountCents: '2000' }, ledger: { version: 2, documentState: 'SENT', collectibleOpenCents: '2000' } });
    const replay = await POST(request(input), context); expect(replay.status).toBe(200); expect(await replay.json()).toMatchObject({ replayed: true });
    const stale = await POST(request({ ...input, idempotencyKey: key() }), context); expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({ code: 'PAYMENT_STATE_CHANGED', ledgerVersion: (await readInvoicePaymentJournal(owner, invoice.id)).ledgerVersion });
    const conflict = await POST(request({ ...input, reason: 'Changed meaning' }), context); expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(await db.client.paymentAdjustment.count({ where: { invoiceId: invoice.id } })).toBe(1);
    expect(await db.client.auditLog.count({ where: { entityId: String(invoice.id), action: 'PAYMENT_CORRECTION' } })).toBe(1);
  });
  it('refuses adjustment mutation/deletion and maintains original projection evidence', async () => {
    const adjustment = await db.client.paymentAdjustment.findFirstOrThrow({ where: { userId: owner } });
    await expect(db.client.paymentAdjustment.update({ where: { id: adjustment.id }, data: { reason: 'overwrite' } })).rejects.toThrow();
    await expect(db.client.paymentAdjustment.delete({ where: { id: adjustment.id } })).rejects.toThrow();
    const source = await ownedInvoice(db.client, owner, adjustment.invoiceId);
    expect(source.paymentJournalEvents.length).toBeGreaterThan(0);
  });
});
