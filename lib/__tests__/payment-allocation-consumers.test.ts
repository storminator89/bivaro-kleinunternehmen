import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import JSZip from 'jszip';
import { NextRequest } from 'next/server';
import { generateApiKey } from '@/lib/api-auth';
import { createTestDatabase } from './helpers/database';
import { recordFullPayment } from '@/lib/payment-journal/service';
import { loadInvoicePaymentState, updateInvoicePaymentProjection } from '@/lib/payment-journal/allocation-ledger';
import { bankBindingBasisSnapshot, allocationChangeBasisSnapshot } from '@/lib/payment-journal/allocation-evidence';
import { financialHash } from '@/lib/payment-journal/adjustment-evidence';
import { recordPaymentAdjustment } from '@/lib/payment-journal/adjustment-service';
import { operationalIncomeEntriesSql } from '@/lib/payment-journal/accounting-source';
import { previewReminder } from '@/lib/reminder-workbench';
import { readDailyActions } from '@/lib/daily-actions/service';
import { readCustomerTimeline } from '@/lib/customer-timeline';
import { readInvoiceHistory } from '@/lib/invoice-history';
import { createAccountantExport, parseAccountantExportPeriod } from '@/lib/accountant-export';
import { createCashTransaction } from '@/lib/cashbook-service';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, userId: 'allocation-consumer-owner' }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({ requireUserId: async () => state.userId, UnauthorizedError: class extends Error {}, unauthorizedResponse: () => new Response(null, { status: 401 }) }));
// Cancellation is tested as a document transaction, never by executing a PDF runtime.
vi.mock('@/lib/credit-note-pdf', () => ({ generateCreditNotePDF: vi.fn(async () => new Uint8Array([37, 80, 68, 70])) }));
vi.mock('@/lib/upload-path', async original => ({ ...await original<typeof import('@/lib/upload-path')>(), writeTenantFile: vi.fn(async () => 'synthetic-cancellation.pdf'), deleteTenantFile: vi.fn(async () => undefined) }));
import { GET as invoiceList, PUT as invoiceUpdate } from '@/app/api/invoices/route';
import { GET as v1ReminderList } from '@/app/api/v1/reminders/route';
import { GET as reminderList } from '@/app/api/reminders/route';
import { GET as kpis } from '@/app/api/dashboard/kpis/route';
import { GET as incomeList } from '@/app/api/incomes/route';
import { POST as cancelInvoice } from '@/app/api/invoices/cancel/route';
import { DELETE as deleteCustomer, PUT as renameCustomer } from '@/app/api/customers/route';

let db: ReturnType<typeof createTestDatabase>, next = 0;
const owner = 'allocation-consumer-owner';
const key = () => randomUUID();
async function fixture() {
  const customer = await db.client.customer.create({ data: { userId: owner, name: `Synthetic customer ${++next}` } });
  const invoice = () => db.client.invoice.create({ data: { userId: owner, customerId: customer.id, invoiceNumber: `CONSUMER-${++next}`, fileName: 'synthetic.pdf', storedFileName: 'synthetic.pdf', totalAmount: 120, status: 'SENT', issuanceState: 'ISSUED', invoiceDate: new Date('2025-12-01'), uploadedAt: new Date('2025-12-01'), dueDate: new Date('2026-02-01'), parsedData: { currency: 'EUR', taxMode: 'small-business', taxAmount: 0, items: [{ description: 'Synthetic item', quantity: 1, unitPrice: 120, amount: 120, taxRate: 0 }] } } });
  const a = await invoice(), b = await invoice(), rowKey = key(), op = key();
  const batch = await db.client.bankImportBatch.create({ data: { userId: owner, stableKey: key(), requestId: key(), fingerprint: key(), sourceSha256: 'a'.repeat(64), sourceBytes: 1, parserVersion: 'bank-csv-v1', mappingVersion: 'bank-csv-mapping-v1', accountAlias: 'Synthetic', delimiter: ';', mapping: {}, receipt: {} } });
  const row = await db.client.bankImportRow.create({ data: { stableKey: rowKey, userId: owner, batchId: batch.id, sourceRow: 1, evidence: { date: '2026-01-01', amountCents: '4000', currency: 'EUR' } } });
  const before = await load(a.id);
  const payment = await recordFullPayment(owner, a.id, { amount: '40', currency: 'EUR', paidAt: '2026-01-01', source: 'MANUAL', reference: `bank-row:${rowKey}`, idempotencyKey: op, expectedPaidCents: '0', expectedLedgerVersion: before.ledgerVersion });
  const basis = bankBindingBasisSnapshot(row, a, { idempotencyKey: op, expectedLedgerVersion: before.ledgerVersion });
  const binding = await db.client.bankPaymentBinding.create({ data: { stableKey: key(), userId: owner, bankImportRowId: row.id, paymentJournalEventId: payment.event.id, idempotencyKey: op, semanticFingerprint: financialHash(basis), basisSnapshot: basis } });
  return { a, b, customer, binding, root: payment.event };
}
function load(id: number) { return db.client.$transaction(tx => loadInvoicePaymentState(tx, owner, id)); }
async function move(bindingId: number, toId: number) {
  return db.client.$transaction(async tx => {
    const binding = await tx.bankPaymentBinding.findUniqueOrThrow({ where: { id: bindingId }, include: { paymentJournalEvent: true, allocationChanges: { orderBy: { revision: 'asc' } } } });
    const head = binding.allocationChanges.at(-1) ?? null, fromId = head?.toInvoiceId ?? binding.paymentJournalEvent.invoiceId;
    const from = await loadInvoicePaymentState(tx, owner, fromId), to = await loadInvoicePaymentState(tx, owner, toId);
    const input = { expectedAllocationRevision: head?.revision ?? 0, expectedSourceLedgerVersion: from.ledgerVersion, expectedTargetLedgerVersion: to.ledgerVersion, actionDate: '2026-02-01', reason: 'Wrong invoice; real cash remains unchanged' };
    const basis = allocationChangeBasisSnapshot(binding, binding.paymentJournalEvent, from.invoice, to.invoice, head, input), op = key();
    await tx.paymentOperation.create({ data: { userId: owner, idempotencyKey: op, kind: 'PAYMENT_ALLOCATION_CHANGED' } });
    await tx.paymentAllocationChange.create({ data: { stableKey: key(), userId: owner, bindingId, revision: input.expectedAllocationRevision + 1, previousChangeId: head?.id ?? null, fromInvoiceId: fromId, toInvoiceId: toId, amountCents: binding.paymentJournalEvent.amountCents, currency: 'EUR', actionDate: new Date('2026-02-01'), reason: input.reason, idempotencyKey: op, semanticFingerprint: financialHash(basis), basisSnapshot: basis } });
    for (const id of [fromId, toId]) await updateInvoicePaymentProjection(tx, await loadInvoicePaymentState(tx, owner, id, { validateProjection: false }));
  });
}
const jsonRequest = (url: string, method: string, data: unknown) => new Request(`http://localhost${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
async function cancel(id: number) {
  const response = await cancelInvoice(jsonRequest('/api/invoices/cancel', 'POST', { invoiceId: id, cancellationReason: 'Synthetic full cancellation' }));
  expect(response.status).toBe(200);
  return (await response.json()).creditNote.id as number;
}
beforeAll(async () => { db = createTestDatabase(); expect(db.url).toMatch(/^file:\/tmp\/bivaro-test-/); state.client = db.client; await db.client.user.create({ data: { id: owner, email: 'allocation-consumer@test.invalid', password: 'synthetic' } }); }, 40_000);
afterAll(async () => { await db?.cleanup(); });

describe('allocation-aware lifecycle consumers, origin cash and current receivable are distinct', () => {
  it('uses effective allocations for invoice list, reminder preview/list, daily actions and KPI; exposes immutable Income origin', async () => {
    const f = await fixture(); await move(f.binding.id, f.b.id);
    for (const [id, paidCents, openCents] of [[f.a.id, '0', '12000'], [f.b.id, '4000', '8000']] as const) {
      const response = await invoiceList(new Request(`http://localhost/api/invoices?document=${id}`, { headers: { 'X-Bivaro-Payment-Contract': '3' } }));
      expect(response.status).toBe(200); const data = await response.json();
      expect(data.items[0].paymentSummary).toMatchObject({ paidCents, openCents });
      expect((await previewReminder(owner, id)).openCents).toBe(openCents);
    }
    expect((await invoiceList(new Request(`http://localhost/api/invoices?document=${f.b.id}`))).status).toBe(409);
    const reminders = await (await reminderList(new Request('http://localhost/api/reminders?includeAll=true'))).json();
    expect(reminders.invoices.find((row: { id: number }) => row.id === f.a.id).paymentSummary.openCents).toBe('12000');
    expect(reminders.invoices.find((row: { id: number }) => row.id === f.b.id).paymentSummary.openCents).toBe('8000');
    const apiKey = generateApiKey();
    await db.client.apiKey.create({ data: { userId: owner, name: 'Synthetic reminder reader', keyHash: apiKey.keyHash, keyPrefix: apiKey.keyPrefix, scopes: '["read"]' } });
    const v1 = await (await v1ReminderList(new NextRequest('http://localhost/api/v1/reminders?includeAll=true', { headers: { authorization: `Bearer ${apiKey.key}` } }))).json();
    expect(v1.data.invoices.find((row: { id: number }) => row.id === f.b.id).paymentSummary.openCents).toBe('8000');
    const daily = await readDailyActions(owner, new Date('2026-10-22'));
    expect(daily.actions.find(row => row.id === `invoice:${f.a.id}`)?.amountCents).toBe('12000');
    expect(daily.actions.find(row => row.id === `invoice:${f.b.id}`)?.amountCents).toBe('8000');
    const summary = await (await kpis(new Request('http://localhost/api/dashboard/kpis'))).json();
    expect(summary.openInvoices).toBe(200); expect(summary.totalRevenue).toBe(40);
    expect(summary.recentActivities.find((row: { type: string }) => row.type === 'income')).toMatchObject({ invoiceId: f.a.id, originInvoiceId: f.a.id, allocatedInvoiceId: f.b.id, amount: 40 });
    const income = await (await incomeList(new Request('http://localhost/api/incomes'))).json();
    expect(income.items.find((row: { id: number }) => row.id === f.root.incomeId)).toMatchObject({ invoiceId: f.a.id, originInvoiceId: f.a.id, allocatedInvoiceId: f.b.id, invoiceAttribution: 'IMMUTABLE_CASH_ORIGIN', paymentProvenance: 'BANK_CSV', paymentAllocationReviewRequired: false });
  });

  it('invalidates a reminder confirmation after A -> B -> A although the numerical balance returns', async () => {
    const f = await fixture(), before = await previewReminder(owner, f.a.id);
    await move(f.binding.id, f.b.id); await move(f.binding.id, f.a.id);
    const after = await previewReminder(owner, f.a.id);
    expect(after.openCents).toBe(before.openCents); expect(after.balanceVersion).not.toBe(before.balanceVersion);
    await expect(previewReminder(owner, f.a.id, { expectedBalanceVersion: before.balanceVersion })).rejects.toMatchObject({ code: 'PAYMENT_STATE_CHANGED' });
  });

  it('cancels current B, refunds original A root once, and shows refund/cash-neutral change from both history contexts', async () => {
    const f = await fixture(); await move(f.binding.id, f.b.id);
    await cancel(f.a.id); expect((await load(f.a.id)).ledger.refundDueCents).toBe('0');
    const cancellationInvoiceId = await cancel(f.b.id), current = await load(f.b.id);
    expect(current.ledger.refundDueCents).toBe('4000');
    const command = { kind: 'CUSTOMER_REFUND' as const, originalPaymentId: f.root.id, amount: '10', actionDate: '2026-10-22', reason: 'Actual partial payout', reference: key(), idempotencyKey: key(), cancellationInvoiceId, expectedLedgerVersion: current.ledgerVersion, expectedAllocationRevision: 1 };
    await recordPaymentAdjustment(owner, f.b.id, command); expect((await recordPaymentAdjustment(owner, f.b.id, command)).replayed).toBe(true);
    expect((await load(f.b.id)).ledger).toMatchObject({ refundDueCents: '3000', collectibleOpenCents: '0' });
    expect((await load(f.a.id)).ledger.refundDueCents).toBe('0');
    expect(await db.client.paymentJournalEvent.findUnique({ where: { id: f.root.id } })).toEqual(f.root);
    const timeline = await readCustomerTimeline(owner, f.customer.id, null);
    expect(timeline.entries.find(row => row.kind === 'ADJUSTMENT')).toMatchObject({ amountCents: '1000', attribution: { originInvoiceId: f.a.id, allocatedInvoiceId: f.b.id, cancellationInvoiceId } });
    expect(timeline.entries.find(row => row.kind === 'ALLOCATION')).toMatchObject({ statusLabel: 'Rechnungszuordnung geändert · keine Geldbewegung', attribution: { fromInvoiceId: f.a.id, toInvoiceId: f.b.id } });
    for (const invoiceId of [f.a.id, f.b.id]) {
      const history = await readInvoiceHistory(owner, { invoiceId, page: 1, limit: 50, search: '' });
      expect(history?.kind).toBe('detail'); if (history?.kind !== 'detail') throw new Error('Missing history');
      expect(history.adjustments.find(row => row.originalPaymentId === f.root.id)).toMatchObject({ invoiceId: f.b.id, originInvoiceId: f.a.id, allocatedInvoiceId: f.b.id, cancellationInvoiceId });
      expect(history.payments.find(row => row.id === f.root.id)).toMatchObject({ originInvoiceId: f.a.id, allocatedInvoiceId: f.b.id });
      expect(history.allocationHistory).toHaveLength(1);
    }
    const movements = await db.client.$queryRaw<Array<{ id: number; amountCents: bigint | number; movementKind: string }>>(Prisma.sql`SELECT * FROM (${operationalIncomeEntriesSql(owner)}) WHERE id=${f.root.incomeId} OR id=-(SELECT id FROM PaymentAdjustment WHERE originalPaymentId=${f.root.id})`);
    expect(movements.map(row => [row.movementKind, Number(row.amountCents)]).sort()).toEqual([['CUSTOMER_REFUND', -1000], ['RECEIPT', 4000]]);
    const result = await createAccountantExport(owner, parseAccountantExportPeriod(new URLSearchParams('from=2026-10-01&to=2026-10-31')));
    const zip = await JSZip.loadAsync(result.bytes), records = JSON.parse(await zip.file('records.json')!.async('string'));
    expect(records.paymentContractVersion).toBe(3);
    expect(records.payments.find((row: { id: number }) => row.id === f.root.id)).toMatchObject({ invoiceId: f.a.id, originInvoiceId: f.a.id, allocatedInvoiceId: f.b.id, contextOnly: true, periodEffectCents: '0' });
    expect(records.incomes.find((row: { id: number }) => row.id === f.root.incomeId)).toMatchObject({ invoiceId: f.a.id, contextOnly: true, periodEffectCents: '0' });
    expect(records.adjustments.find((row: { originalPaymentId: number }) => row.originalPaymentId === f.root.id)).toMatchObject({ invoiceId: f.b.id, originInvoiceId: f.a.id, allocatedInvoiceId: f.b.id, cancellationInvoiceId, periodEffectCents: '-1000', contractVersion: 3, allocationRevision: 1 });
    expect(records.bindings.find((row: { paymentJournalEventId: number }) => row.paymentJournalEventId === f.root.id).cashEffectCents).toBe('0');
    expect(records.allocationChanges.every((row: { cashEffectCents: string }) => row.cashEffectCents === '0')).toBe(true);
    expect(records.invoices.some((row: { id: number }) => row.id === cancellationInvoiceId)).toBe(true);
    expect((await zip.file('adjustments.csv')!.async('string'))).toContain('allocationBasisSnapshot');
  });

  it('projects a truthful mistaken-receipt correction after movement, never as a payout or transfer', async () => {
    const f = await fixture(); await move(f.binding.id, f.b.id); const current = await load(f.b.id);
    const correction = await recordPaymentAdjustment(owner, f.b.id, { kind: 'PAYMENT_CORRECTION', originalPaymentId: f.root.id, amount: '20', actionDate: '2026-10-22', reason: 'Counter-evidence: this recorded portion never arrived', reference: key(), idempotencyKey: key(), declarationNeverReceived: true, expectedLedgerVersion: current.ledgerVersion, expectedAllocationRevision: 1 });
    expect(correction.adjustment.accountingEffectiveOn).toEqual(f.root.paidAt);
    expect((await load(f.a.id)).summary.openCents).toBe('12000'); expect((await load(f.b.id)).summary.openCents).toBe('10000');
    const timeline = await readCustomerTimeline(owner, f.customer.id, null);
    expect(timeline.entries.find(row => row.kind === 'ADJUSTMENT')).toMatchObject({ statusLabel: 'Zahlungskorrektur · fachlich ungeprüft', attribution: { originInvoiceId: f.a.id, allocatedInvoiceId: f.b.id } });
    await expect(previewReminder(owner, f.b.id)).rejects.toMatchObject({ code: 'PAYMENT_ADJUSTMENTS_REVIEW_REQUIRED' });
    const result = await createAccountantExport(owner, parseAccountantExportPeriod(new URLSearchParams('from=2026-10-01&to=2026-10-31')));
    const zip = await JSZip.loadAsync(result.bytes), records = JSON.parse(await zip.file('records.json')!.async('string'));
    expect(records.adjustments.find((row: { id: number }) => row.id === correction.adjustment.id)).toMatchObject({ kind: 'PAYMENT_CORRECTION', periodEffectCents: '0', contextOnly: true, accountingEffectiveInPeriod: false, recordedAtInPeriod: true });
    const originPeriod = await createAccountantExport(owner, parseAccountantExportPeriod(new URLSearchParams('from=2026-01-01&to=2026-01-31')));
    const originalZip = await JSZip.loadAsync(originPeriod.bytes), originalRecords = JSON.parse(await originalZip.file('records.json')!.async('string'));
    expect(originalRecords.payments.find((row: { id: number }) => row.id === f.root.id).periodEffectCents).toBe('4000');
    expect(originalRecords.adjustments.find((row: { id: number }) => row.id === correction.adjustment.id)).toMatchObject({ periodEffectCents: '-2000', contextOnly: false, accountingEffectiveInPeriod: true, recordedAtInPeriod: false });
    expect(await db.client.paymentAdjustment.count({ where: { originalPaymentId: f.root.id, kind: 'CUSTOMER_REFUND' } })).toBe(0);
  });

  it('retains bank/allocation customer evidence with friendly 409, allows rename and unrelated deletion', async () => {
    const f = await fixture(); await move(f.binding.id, f.b.id);
    const deleted = await deleteCustomer(new Request(`http://localhost/api/customers?id=${f.customer.id}`, { method: 'DELETE' }));
    expect(deleted.status).toBe(409); expect(await deleted.json()).toMatchObject({ code: 'CUSTOMER_ALLOCATION_HISTORY_REQUIRED' });
    expect((await renameCustomer(jsonRequest('/api/customers', 'PUT', { id: f.customer.id, name: 'Renamed synthetic customer' }))).status).toBe(200);
    expect((await load(f.b.id)).summary.paidCents).toBe('4000');
    const unrelated = await db.client.customer.create({ data: { userId: owner, name: 'Unrelated' } });
    expect((await deleteCustomer(new Request(`http://localhost/api/customers?id=${unrelated.id}`, { method: 'DELETE' }))).status).toBe(200);
  });

  it('preserves the old v2 list shape for unaffected journals while offering explicit v3', async () => {
    const invoice = await db.client.invoice.create({ data: { userId: owner, fileName: 'synthetic.pdf', storedFileName: 'synthetic.pdf', invoiceNumber: `CONSUMER-UNBOUND-${++next}`, totalAmount: 120, status: 'SENT', issuanceState: 'ISSUED', parsedData: { currency: 'EUR' } } });
    for (const contract of [2, 3]) {
      const response = await invoiceList(new Request(`http://localhost/api/invoices?document=${invoice.id}`, { headers: { 'X-Bivaro-Payment-Contract': String(contract) } }));
      expect(response.status).toBe(200); const result = await response.json();
      expect(result.items[0].paymentContractVersion).toBe(contract); expect(result.items[0].paymentLedger.version).toBe(contract);
      if (contract === 2) expect(result.items[0].paymentLedger.originalReceivedCents).toBe('0');
      else expect(result.items[0].paymentLedger.allocation.validAllocatedCents).toBe('0');
    }
  });

  it('blocks generic status/date/customer changes on incoming allocations with friendly 409 while preserving no-ops', async () => {
    const f = await fixture(); await move(f.binding.id, f.b.id);
    const other = await db.client.customer.create({ data: { userId: owner, name: 'Other own customer' } });
    for (const mutation of [{ status: 'PAID', paidAt: '2026-10-22' }, { paidAt: '2026-10-22' }, { customerId: other.id }]) {
      const response = await invoiceUpdate(jsonRequest('/api/invoices', 'PUT', { id: f.b.id, ...mutation }));
      expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'PAYMENT_ALLOCATION_WORKFLOW_REQUIRED' });
    }
    expect((await invoiceUpdate(jsonRequest('/api/invoices', 'PUT', { id: f.b.id, status: 'SENT', customerId: f.customer.id }))).status).toBe(200);
    const current = await load(f.b.id); expect(current.summary.openCents).toBe('8000'); expect(current.invoice.paidAt).toBeNull();
    await recordFullPayment(owner, f.b.id, { amount: '80', currency: 'EUR', paidAt: '2026-10-22', source: 'MANUAL', reference: key(), idempotencyKey: key(), expectedPaidCents: '4000', expectedLedgerVersion: current.ledgerVersion });
    const response = await invoiceUpdate(jsonRequest('/api/invoices', 'PUT', { id: f.b.id, status: 'SENT', paidAt: null }));
    expect(response.status).toBe(409); expect((await load(f.b.id)).invoice.status).toBe('PAID');
    expect(await db.client.paymentJournalEvent.findUnique({ where: { id: f.root.id } })).toEqual(f.root);
  });

  it('checks selected root cashbook provenance, not sibling adjustment/bank history', async () => {
    const f = await fixture(), current = await load(f.a.id);
    const sibling = await recordFullPayment(owner, f.a.id, { amount: '10', currency: 'EUR', paidAt: '2026-01-02', source: 'MANUAL', reference: key(), idempotencyKey: key(), expectedPaidCents: '4000', expectedLedgerVersion: current.ledgerVersion });
    const adjusted = await load(f.a.id);
    await recordPaymentAdjustment(owner, f.a.id, { kind: 'PAYMENT_CORRECTION', originalPaymentId: f.root.id, amount: '10', actionDate: '2026-10-22', reason: 'Selected bank assertion partly never arrived', reference: key(), idempotencyKey: key(), declarationNeverReceived: true, expectedLedgerVersion: adjusted.ledgerVersion, expectedAllocationRevision: 0 });
    const book = await db.client.cashBook.create({ data: { userId: owner } });
    await expect(createCashTransaction(owner, { cashBookId: book.id, incomeId: f.root.incomeId, type: 'EINNAHME', amount: 40, date: '2026-01-01', description: 'Not cash' })).rejects.toMatchObject({ status: 409 });
    expect((await createCashTransaction(owner, { cashBookId: book.id, incomeId: sibling.event.incomeId, type: 'EINNAHME', amount: 10, date: '2026-01-02', description: 'Actual unrelated cash' })).incomeId).toBe(sibling.event.incomeId);
  });
});
