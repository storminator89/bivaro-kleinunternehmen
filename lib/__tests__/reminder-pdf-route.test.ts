import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as ReturnType<typeof createTestDatabase>['client'] | null, owner: 'reminder-pdf-owner', unauthorized: false, send: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => {
  class UnauthorizedError extends Error {}
  return { UnauthorizedError, unauthorizedResponse: () => new Response(null, { status: 401 }), requireUserId: async () => { if (state.unauthorized) throw new UnauthorizedError(); return state.owner; } };
});
vi.mock('nodemailer', () => ({ default: { createTransport: state.send } }));

import { PDFDocument } from 'pdf-lib';
import { previewReminder } from '@/lib/reminder-workbench';
import { recordFullPayment } from '@/lib/payment-journal/service';
import { POST } from '@/app/api/reminders/download-pdf/route';

let db: ReturnType<typeof createTestDatabase>, next = 0;
const owner = 'reminder-pdf-owner';
const source = (data: Record<string, unknown> = {}) => db.client.invoice.create({ data: { userId: owner, fileName: `synthetic-pdf-${++next}.pdf`, storedFileName: `synthetic-pdf-${next}.pdf`, invoiceNumber: `SYNTHETIC-PDF-${next}`, totalAmount: 120, status: 'SENT', parsedData: { currency: 'EUR' }, ...data } });
const pay = (id: number, amount = '40', paid = '0') => recordFullPayment(owner, id, { amount, expectedPaidCents: paid, paidAt: '2026-10-01', currency: 'EUR', source: 'MANUAL', reference: `Synthetic ${++next}`, idempotencyKey: `reminder-pdf-payment-${next}` });
const post = (body: object, headers = {}) => POST(new Request('http://localhost/api/reminders/download-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }));
const confirmed = (preview: Awaited<ReturnType<typeof previewReminder>>) => ({ invoiceId: preview.invoiceId, reminderLevel: preview.reminderLevel, expectedBalanceVersion: preview.balanceVersion, previewAsOf: preview.previewAsOf, expectedDocumentVersion: preview.documentVersion });
async function financialState(id: number) {
  return { invoice: await db.client.invoice.findUnique({ where: { id } }), incomes: await db.client.income.findMany({ where: { invoiceId: id } }), payments: await db.client.paymentJournalEvent.findMany({ where: { invoiceId: id } }), reminders: await db.client.reminder.findMany({ where: { invoiceId: id } }), auditCount: await db.client.auditLog.count({ where: { userId: owner } }) };
}
beforeAll(async () => {
  db = createTestDatabase(); state.client = db.client;
  await db.client.user.createMany({ data: [{ id: owner, email: 'pdf-owner@example.invalid', password: 'synthetic' }, { id: 'reminder-pdf-other', email: 'pdf-other@example.invalid', password: 'synthetic' }] });
}, 40_000);
afterAll(async () => { await db?.cleanup(); });

describe('confirmed reminder PDF endpoint (authored acceptance)', () => {
  it('downloads only the exact reviewed rest-balance document and does not write or send', async () => {
    const invoice = await source(); await pay(invoice.id);
    const preview = await previewReminder(owner, invoice.id), before = await financialState(invoice.id);
    expect(preview).toMatchObject({ totalCents: '12000', paidCents: '4000', openCents: '8000' });
    const response = await post(confirmed(preview));
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toContain(`mahnentwurf-${invoice.id}.pdf`);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const pdf = await PDFDocument.load(await response.arrayBuffer());
    expect(pdf.getTitle()).toBe(preview.subject); expect(pdf.getCreationDate()?.getTime()).toBe(Math.floor(new Date(preview.previewAsOf).getTime() / 1000) * 1000);
    expect(await financialState(invoice.id)).toEqual(before); expect(state.send).not.toHaveBeenCalled();
    const again = await previewReminder(owner, invoice.id, { ...confirmed(preview) }, true);
    expect(again).toEqual(preview);
  });

  it('rejects a competing payment rather than exporting the old 80 EUR amount', async () => {
    const invoice = await source(); await pay(invoice.id);
    const preview = await previewReminder(owner, invoice.id); await pay(invoice.id, '10', '4000');
    const before = await financialState(invoice.id), response = await post(confirmed(preview));
    expect(response.status).toBe(409); expect((await response.json()).code).toBe('PAYMENT_STATE_CHANGED');
    expect(await financialState(invoice.id)).toEqual(before);
  });

  it('requires full document confirmation and rejects changed options/company text without payment changes', async () => {
    const invoice = await source(), preview = await previewReminder(owner, invoice.id);
    const absent = await post({ invoiceId: invoice.id, expectedBalanceVersion: preview.balanceVersion });
    expect(absent.status).toBe(409); expect((await absent.json()).code).toBe('DOCUMENT_CONFIRMATION_REQUIRED');
    const options = await post({ ...confirmed(preview), fee: '2.50' });
    expect(options.status).toBe(409); expect((await options.json()).code).toBe('REMINDER_DOCUMENT_CHANGED');
    await db.client.settings.upsert({ where: { userId: owner }, create: { userId: owner, companyName: 'Neue synthetische Firma' }, update: { companyName: 'Neue synthetische Firma' } });
    const changed = await post(confirmed(preview));
    expect(changed.status).toBe(409); expect((await changed.json()).code).toBe('REMINDER_DOCUMENT_CHANGED');
  });

  it('expires a review after 24 hours and keeps the original deadline when revalidated across midnight', async () => {
    const invoice = await source();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-25T23:59:00.000Z'));
      const preview = await previewReminder(owner, invoice.id);
      vi.setSystemTime(new Date('2026-10-26T00:01:00.000Z'));
      expect(await previewReminder(owner, invoice.id, confirmed(preview), true)).toEqual(preview);
      vi.setSystemTime(new Date('2026-10-27T00:01:00.000Z'));
      const response = await post(confirmed(preview));
      expect(response.status).toBe(409); expect((await response.json()).code).toBe('REMINDER_PREVIEW_EXPIRED');
    } finally { vi.useRealTimers(); }
  });

  it('does not reveal a foreign invoice, accept cross-origin requests, or download without authentication', async () => {
    const invoice = await source({ userId: 'reminder-pdf-other' });
    const foreign = await post({ invoiceId: invoice.id, previewAsOf: new Date().toISOString(), expectedBalanceVersion: 'a'.repeat(64), expectedDocumentVersion: 'b'.repeat(64) });
    expect(foreign.status).toBe(404);
    expect((await post({}, { origin: 'https://untrusted.example.invalid' })).status).toBe(403);
    state.unauthorized = true;
    try { expect((await post({})).status).toBe(401); } finally { state.unauthorized = false; }
    expect(state.send).not.toHaveBeenCalled();
  });

  it('retains the settlement guard and offers TXT for unsupported characters', async () => {
    const invoice = await source(); await pay(invoice.id);
    const preview = await previewReminder(owner, invoice.id); await pay(invoice.id, '80', '4000');
    expect((await post(confirmed(preview))).status).toBe(409);
    const unicode = await source();
    const draft = await previewReminder(owner, unicode.id, { notes: 'Synthetischer Hinweis 🧾' });
    const response = await post({ ...confirmed(draft), notes: 'Synthetischer Hinweis 🧾' });
    expect(response.status).toBe(422); expect((await response.json()).code).toBe('REMINDER_PDF_CHARSET');
  });
});
