import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as ReturnType<typeof createTestDatabase>['client'] | null, send: vi.fn(), owner: 'reminder-balance-owner' }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({ requireUserId: async () => state.owner, UnauthorizedError: class extends Error {}, unauthorizedResponse: () => new Response(null, { status: 401 }) }));
vi.mock('nodemailer', () => ({ default: { createTransport: state.send } }));

import { previewReminder, recordReminder, ReminderWorkbenchError } from '@/lib/reminder-workbench';
import { recordFullPayment } from '@/lib/payment-journal/service';
import { deleteInvoice } from '@/lib/invoice-payments';
import { sendDocumentEmail } from '@/lib/email';
import { POST as download } from '@/app/api/reminders/download/route';
import { POST as previewRoute } from '@/app/api/reminders/preview/route';
import { DELETE } from '@/app/api/reminders/route';
import { POST as v1Post } from '@/app/api/v1/reminders/route';
import { generateApiKey } from '@/lib/api-auth';
import { NextRequest } from 'next/server';

let db: ReturnType<typeof createTestDatabase>;
let next = 0;
const owner = 'reminder-balance-owner';
const invoice = (data: Record<string, unknown> = {}) => db.client.invoice.create({ data: { userId: owner, fileName: `balance-${++next}.pdf`, storedFileName: `balance-${next}.pdf`, invoiceNumber: `BALANCE-${next}`, totalAmount: 120, status: 'SENT', parsedData: { currency: 'EUR' }, ...data } });
const pay = (id: number, amount = '40', paid = '0') => recordFullPayment(owner, id, { amount, currency: 'EUR', paidAt: '2026-10-01', source: 'MANUAL', reference: `Bank evidence ${++next}`, idempotencyKey: `balance-payment-${next}`, expectedPaidCents: paid });
const post = (body: object) => new Request('http://localhost/api/reminders/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function financialState(id: number) {
  return { invoice: await db.client.invoice.findUnique({ where: { id } }), incomes: await db.client.income.findMany({ where: { invoiceId: id } }), events: await db.client.paymentJournalEvent.findMany({ where: { invoiceId: id } }), reminders: await db.client.reminder.findMany({ where: { invoiceId: id } }) };
}
beforeAll(async () => {
  db = createTestDatabase(); state.client = db.client;
  await db.client.user.createMany({ data: [{ id: owner, email: 'balance@example.invalid', password: 'fixture' }, { id: 'reminder-balance-other', email: 'balance-other@example.invalid', password: 'fixture' }] });
}, 40_000);
afterAll(async () => { await db?.cleanup(); });

describe('issue #47 confirmed remaining-balance reminder workbench', () => {
  it('previews and downloads 120 − 40 = 80 without payment, reminder or outbound side effects', async () => {
    const source = await invoice(); await pay(source.id);
    const before = await financialState(source.id);
    const preview = await previewReminder(owner, source.id);
    expect(preview).toMatchObject({ totalCents: '12000', paidCents: '4000', openCents: '8000', feeCents: '0', automaticDelivery: false, partialEmailDeliveryAvailable: false });
    expect(preview.paymentHistory).toHaveLength(1);
    expect(preview.text).toContain('Bereits eingegangen: 40,00 €');
    expect(preview.text).toContain('Offener Restbetrag: 80,00 €');
    expect(preview.text).toContain('Zahlbetrag: 80,00 €');
    expect(preview.text).not.toContain('keinen Zahlungseingang');
    const response = await download(post({ invoiceId: source.id, expectedBalanceVersion: preview.balanceVersion }));
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('text/plain');
    expect(response.headers.get('content-disposition')).toContain('.txt'); expect(await response.text()).toContain('Zahlbetrag: 80,00 €');
    expect(await financialState(source.id)).toEqual(before); expect(state.send).not.toHaveBeenCalled();
  });
  it('records the immutable confirmed snapshot once and rejects semantic key reuse', async () => {
    const source = await invoice(); await pay(source.id);
    const preview = await previewReminder(owner, source.id);
    const input = { expectedBalanceVersion: preview.balanceVersion, idempotencyKey: 'reminder-record-once', dueDays: 14, fee: 0 };
    const before = await financialState(source.id);
    const results = await Promise.all([recordReminder(owner, source.id, input), recordReminder(owner, source.id, input)]);
    expect(results[0].id).toBe(results[1].id); expect(results.map(row => row.replayed)).toEqual([false, true]);
    expect(results[0].balanceSnapshot).toMatchObject({ totalCents: '12000', paidCents: '4000', openCents: '8000' });
    expect(await db.client.auditLog.count({ where: { userId: owner, entityType: 'Reminder', entityId: String(results[0].id), action: 'CREATE' } })).toBe(1);
    const after = await financialState(source.id); expect({ ...after, reminders: [] }).toEqual(before);
    await expect(recordReminder(owner, source.id, { ...input, fee: 1 })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await pay(source.id, '10', '4000');
    expect((await recordReminder(owner, source.id, input)).replayed).toBe(true);
    const deletion = await DELETE(new Request(`http://localhost/api/reminders?id=${results[0].id}`, { method: 'DELETE' }));
    expect(deletion.status).toBe(409); expect((await deletion.json()).code).toBe('IMMUTABLE_REMINDER');
  });
  it('rejects stale exports and records after an actual second payment; never silently replaces the reviewed amount', async () => {
    const source = await invoice(); await pay(source.id);
    const old = await previewReminder(owner, source.id);
    await pay(source.id, '10', '4000');
    const before = await financialState(source.id);
    const stale = { expectedBalanceVersion: old.balanceVersion, idempotencyKey: 'stale-reminder-once' };
    await expect(recordReminder(owner, source.id, stale)).rejects.toMatchObject({ status: 409, code: 'PAYMENT_STATE_CHANGED' });
    const response = await download(post({ invoiceId: source.id, ...stale }));
    expect(response.status).toBe(409); expect((await response.json()).code).toBe('PAYMENT_STATE_CHANGED');
    await expect(sendDocumentEmail(owner, { documentType: 'reminder', id: source.id, to: 'never-send@example.invalid', subject: 'Stale 80 EUR', text: old.text })).rejects.toThrow('Zahlungsnachweisen');
    expect(state.send).not.toHaveBeenCalled(); expect(await financialState(source.id)).toEqual(before);
    expect(await previewReminder(owner, source.id)).toMatchObject({ paidCents: '5000', openCents: '7000' });
    expect((await previewReminder(owner, source.id)).paymentHistory).toHaveLength(2);
  });
  it('retains confirmed snapshot and owner at the database boundary, without changing the source', async () => {
    const source = await invoice({ status: 'DRAFT', issuanceState: 'UNISSUED' });
    const preview = await previewReminder(owner, source.id);
    const before = await financialState(source.id);
    const recorded = await recordReminder(owner, source.id, { expectedBalanceVersion: preview.balanceVersion, idempotencyKey: 'immutable-reminder-evidence' });
    await expect(db.client.reminder.update({ where: { id: recorded.id }, data: { fee: 999 } })).rejects.toThrow();
    await expect(db.client.reminder.delete({ where: { id: recorded.id } })).rejects.toThrow();
    await expect(deleteInvoice(owner, source.id)).rejects.toMatchObject({ status: 409 });
    const after = await financialState(source.id);
    expect(after.invoice).toEqual(before.invoice); expect(after.events).toEqual([]); expect(after.incomes).toEqual([]);
    await expect(db.client.reminder.create({ data: { userId: 'reminder-balance-other', invoiceId: source.id, dueDate: new Date(), balanceSnapshot: recorded.balanceSnapshot!, idempotencyKey: 'foreign-owner-command' } })).rejects.toThrow();
  });
  it('preserves zero-payment manual composition while rejecting a stale open draft after receipt', async () => {
    const source = await invoice();
    const initial = await previewReminder(owner, source.id);
    const before = await financialState(source.id);
    const fresh = await previewRoute(post({ invoiceId: source.id, expectedBalanceVersion: initial.balanceVersion }));
    expect(fresh.status).toBe(200); expect((await fresh.json()).paidCents).toBe('0');
    expect(await financialState(source.id)).toEqual(before);
    await pay(source.id);
    const stale = await previewRoute(post({ invoiceId: source.id, expectedBalanceVersion: initial.balanceVersion }));
    expect(stale.status).toBe(409); expect((await stale.json()).code).toBe('PAYMENT_STATE_CHANGED');
    expect(state.send).not.toHaveBeenCalled();
  });
  it('rolls back reminder creation when the mandatory audit fails', async () => {
    const source = await invoice(); await pay(source.id); const preview = await previewReminder(owner, source.id);
    await db.client.$executeRawUnsafe("CREATE TRIGGER reminder_audit_fail BEFORE INSERT ON AuditLog BEGIN SELECT RAISE(ABORT, 'synthetic reminder audit failure'); END;");
    try { await expect(recordReminder(owner, source.id, { expectedBalanceVersion: preview.balanceVersion, idempotencyKey: 'audit-rollback-reminder' })).rejects.toThrow(); }
    finally { await db.client.$executeRawUnsafe('DROP TRIGGER reminder_audit_fail'); }
    expect(await db.client.reminder.count({ where: { invoiceId: source.id } })).toBe(0);
  });
  it('requires explicit freshness and key for a partial, and never crosses tenant boundaries', async () => {
    const source = await invoice(); await pay(source.id); const preview = await previewReminder(owner, source.id);
    await expect(recordReminder(owner, source.id)).rejects.toMatchObject({ code: 'PAYMENT_REVIEW_REQUIRED' });
    await expect(recordReminder(owner, source.id, { expectedBalanceVersion: preview.balanceVersion })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    await expect(previewReminder('reminder-balance-other', source.id)).rejects.toMatchObject({ status: 404 });
    expect((await download(post({ invoiceId: source.id }))).status).toBe(409);
    const key = generateApiKey(); await db.client.apiKey.create({ data: { userId: owner, name: 'synthetic balance key', keyHash: key.keyHash, keyPrefix: key.keyPrefix, scopes: '["write"]' } });
    const call = (body: object) => v1Post(new NextRequest('http://localhost/api/v1/reminders', { method: 'POST', headers: { authorization: `Bearer ${key.key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    expect((await call({ invoiceId: source.id })).status).toBe(409);
    const confirmed = await call({ invoiceId: source.id, expectedBalanceVersion: preview.balanceVersion, idempotencyKey: 'v1-balanced-reminder' });
    expect(confirmed.status).toBe(201); expect((await confirmed.json()).data.balanceSnapshot.openCents).toBe('8000');
  });
  it('requires keys for every new confirmed command and reserves restored source identities', async () => {
    const source = await invoice(); const preview = await previewReminder(owner, source.id);
    await expect(recordReminder(owner, source.id, { expectedBalanceVersion: preview.balanceVersion })).rejects.toMatchObject({ status: 400, code: 'IDEMPOTENCY_KEY_REQUIRED' });
    await expect(recordReminder(owner, source.id, { expectedBalanceVersion: preview.balanceVersion, idempotencyKey: `restored:${'a'.repeat(64)}` })).rejects.toMatchObject({ status: 400 });
    expect(await db.client.reminder.count({ where: { invoiceId: source.id } })).toBe(0);
    // The historical no-confirmation zero-payment API remains an ordinary mutable record.
    const legacy = await recordReminder(owner, source.id);
    expect(legacy.balanceSnapshot).toBeNull(); expect(legacy.idempotencyKey).toBeNull();
    await expect(db.client.reminder.delete({ where: { id: legacy.id } })).resolves.toMatchObject({ id: legacy.id });
  });
  it('replays v1 confirmed commands after settlement, without permitting new paid commands or semantic key changes', async () => {
    const source = await invoice(); await pay(source.id); const preview = await previewReminder(owner, source.id);
    const key = generateApiKey(); await db.client.apiKey.create({ data: { userId: owner, name: 'synthetic replay key', keyHash: key.keyHash, keyPrefix: key.keyPrefix, scopes: '["write"]' } });
    const call = (body: object) => v1Post(new NextRequest('http://localhost/api/v1/reminders', { method: 'POST', headers: { authorization: `Bearer ${key.key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    const body = { invoiceId: source.id, expectedBalanceVersion: preview.balanceVersion, idempotencyKey: 'v1-confirmed-before-settlement' };
    const initial = await call(body); expect(initial.status).toBe(201); const original = (await initial.json()).data;
    await pay(source.id, '80', '4000');
    const before = await financialState(source.id);
    const replay = await call(body); expect(replay.status).toBe(201);
    expect((await replay.json()).data).toMatchObject({ id: original.id, replayed: true });
    const changed = await call({ ...body, fee: 1 }); expect(changed.status).toBe(409); expect((await changed.json()).error.code).toBe('IDEMPOTENCY_CONFLICT');
    const newCommand = await call({ ...body, idempotencyKey: 'new-command-after-settlement' }); expect(newCommand.status).toBe(400); expect((await newCommand.json()).error.code).toBe('INVOICE_PAID');
    const foreign = await invoice({ userId: 'reminder-balance-other' });
    const foreignCommand = await call({ ...body, invoiceId: foreign.id, idempotencyKey: 'new-foreign-command' }); expect(foreignCommand.status).toBe(404);
    expect(await financialState(source.id)).toEqual(before);
    expect(await db.client.auditLog.count({ where: { userId: owner, entityType: 'Reminder', entityId: String(original.id), action: 'CREATE' } })).toBe(1);
  });
  it.each([{ status: 'CANCELLED' }, { type: 'QUOTE' }, { type: 'CREDIT_NOTE' }, { totalAmount: null }, { parsedData: { currency: 'USD' } }])('fails closed for an unsupported or uncertain document %j', async data => {
    const source = await invoice(data);
    await expect(previewReminder(owner, source.id)).rejects.toBeInstanceOf(ReminderWorkbenchError);
    expect((await previewRoute(post({ invoiceId: source.id }))).status).toBe(409);
  });
  it('rejects unexplained legacy Income and overpaid/corrupt projections without guessing balances', async () => {
    const source = await invoice();
    await db.client.income.create({ data: { userId: owner, invoiceId: source.id, amount: 40, date: new Date('2026-10-01'), description: 'Unexplained historical Income' } });
    await expect(previewReminder(owner, source.id)).rejects.toMatchObject({ code: 'PAYMENT_REVIEW_REQUIRED' });
    const corrupt = await invoice(); await pay(corrupt.id);
    // Projection corruption, not a mutation of immutable payment evidence.
    await db.client.invoice.update({ where: { id: corrupt.id }, data: { totalAmount: 30 } });
    await expect(previewReminder(owner, corrupt.id)).rejects.toMatchObject({ code: 'PAYMENT_REVIEW_REQUIRED' });
  });
  it('never infers or accumulates fees and rejects inexact entered amounts', async () => {
    const source = await invoice(); await pay(source.id);
    expect((await previewReminder(owner, source.id, { fee: '2.50' })).text).toContain('Zahlbetrag: 82,50 €');
    await db.client.reminder.create({ data: { userId: owner, invoiceId: source.id, reminderLevel: 4, fee: 15, dueDate: new Date() } });
    const nextPreview = await previewReminder(owner, source.id);
    expect(nextPreview.text).toContain('Zahlbetrag: 80,00 €'); expect(nextPreview.reminderLevel).toBe(4);
    await expect(previewReminder(owner, source.id, { fee: '-1' })).rejects.toMatchObject({ status: 400 });
    await expect(previewReminder(owner, source.id, { fee: '1.001' })).rejects.toMatchObject({ status: 400 });
  });
});
