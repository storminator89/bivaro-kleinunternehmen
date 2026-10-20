import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as unknown, transport: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({
  requireUserId: async () => 'reminder-owner',
  UnauthorizedError: class extends Error {},
  unauthorizedResponse: () => new Response(null, { status: 401 }),
}));
vi.mock('nodemailer', () => ({ default: { createTransport: state.transport } }));

import { GET, POST } from '@/app/api/reminders/route';
import { updateInvoiceStatus } from '@/lib/invoice-payments';

let database: ReturnType<typeof createTestDatabase>;
let sequence = 0;
const pastDue = new Date('2020-01-15T12:00:00Z');
const futureDue = new Date('2099-01-15T12:00:00Z');

const createInvoice = (data: Record<string, unknown> = {}) => database.client.invoice.create({ data: {
  userId: 'reminder-owner', fileName: `reminder-${++sequence}.pdf`, storedFileName: `reminder-${sequence}.pdf`,
  parsedData: {}, type: 'INVOICE', status: 'SENT', totalAmount: 100, dueDate: pastDue, ...data,
} });
const createReminder = (invoiceId: number) => POST(new Request('http://localhost/api/reminders', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ invoiceId, fee: 5, dueDays: 7, notes: 'Intern erfasst' }),
}));
const listReminders = async (includeAll = true) => {
  const response = await GET(new Request(`http://localhost/api/reminders?includeAll=${includeAll}`));
  expect(response.status).toBe(200);
  return response.json() as Promise<{
    invoices: { id: number; currentReminderLevel: number; totalFees: number; reminders: { createdAt: string }[] }[];
    stats: { totalOverdue: number; totalAmount: number; totalFees: number };
  }>;
};

beforeAll(async () => {
  // The helper deploys migrations only into its newly created temporary directory,
  // with an explicit DATABASE_URL; it never touches prisma/dev.db or .env's DB.
  database = createTestDatabase();
  state.client = database.client;
  await database.client.user.createMany({ data: [
    { id: 'reminder-owner', email: 'reminder-owner@test.invalid', password: 'unused' },
    { id: 'reminder-other', email: 'reminder-other@test.invalid', password: 'unused' },
  ] });
}, 40_000);
afterAll(async () => { await database?.cleanup(); });

describe('QA #31: only open invoices are eligible for reminders', () => {
  it('excludes offers, credit notes, paid/cancelled invoices and other tenants from counts and totals', async () => {
    const open = await createInvoice({ totalAmount: 297.5 });
    const upcoming = await createInvoice({ status: 'DRAFT', totalAmount: 200, dueDate: futureDue });
    const excluded = await Promise.all([
      createInvoice({ type: 'QUOTE', totalAmount: 200 }),
      createInvoice({ type: 'CREDIT_NOTE' }),
      createInvoice({ status: 'PAID' }),
      createInvoice({ status: 'CANCELLED' }),
      createInvoice({ userId: 'reminder-other' }),
    ]);
    // Even historic reminders/fees on excluded records must not affect KPIs.
    await database.client.reminder.createMany({ data: excluded.map(invoice => ({
      invoiceId: invoice.id, userId: invoice.userId, dueDate: futureDue, fee: 99,
    })) });

    const all = await listReminders();
    expect(all.invoices.map(invoice => invoice.id)).toEqual([open.id, upcoming.id]);
    expect(all.stats).toMatchObject({ totalOverdue: 1, totalAmount: 297.5, totalFees: 0 });
    expect((await listReminders(false)).invoices.map(invoice => invoice.id)).toEqual([open.id]);

    await database.client.invoice.deleteMany();
  });

  it.each([
    { type: 'QUOTE', status: 'DRAFT' },
    { type: 'CREDIT_NOTE', status: 'SENT' },
    { type: 'INVOICE', status: 'PAID' },
    { type: 'INVOICE', status: 'CANCELLED' },
  ])('rejects internal reminder creation for $type/$status', async data => {
    const invoice = await createInvoice(data);
    const response = await createReminder(invoice.id);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'Mahnungen können nur für offene Rechnungen erfasst werden' });
    expect(await database.client.reminder.count({ where: { invoiceId: invoice.id } })).toBe(0);
    await database.client.invoice.delete({ where: { id: invoice.id } });
  });

  it('keeps reminder creation tenant-scoped', async () => {
    const invoice = await createInvoice({ userId: 'reminder-other' });
    expect((await createReminder(invoice.id)).status).toBe(404);
    expect(await database.client.reminder.count({ where: { invoiceId: invoice.id } })).toBe(0);
    await database.client.invoice.delete({ where: { id: invoice.id } });
  });

  it('records a reminder without sending mail, then removes the paid invoice while preserving synchronized income', async () => {
    const customer = await database.client.customer.create({ data: {
      userId: 'reminder-owner', name: 'QA Kunde', email: 'customer@test.invalid',
    } });
    const invoice = await createInvoice({ customerId: customer.id, invoiceNumber: 'QA-29750', totalAmount: 297.5 });
    const response = await createReminder(invoice.id);
    expect(response.status).toBe(200);
    const reminder = await response.json();
    expect(reminder).toMatchObject({ invoiceId: invoice.id, reminderLevel: 1, fee: 5, notes: 'Intern erfasst' });
    expect(Number.isFinite(Date.parse(reminder.createdAt))).toBe(true);
    expect(state.transport).not.toHaveBeenCalled();
    expect(await database.client.income.count({ where: { invoiceId: invoice.id } })).toBe(0);
    const beforePayment = await listReminders();
    expect(beforePayment.invoices).toHaveLength(1);
    expect(beforePayment.stats).toMatchObject({ totalOverdue: 1, totalAmount: 297.5, totalFees: 5 });

    // This is the unchanged invoice-payment service used by PUT /api/invoices,
    // which the reminder page still invokes for its explicit paid action.
    const paid = await updateInvoiceStatus('reminder-owner', invoice.id, 'PAID', '2026-10-20T12:00:00Z');
    expect(paid.income).toMatchObject({ invoiceId: invoice.id, amount: 297.5, taxRelevant: true, customerId: customer.id });
    expect((await listReminders()).invoices).toEqual([]);
    expect((await listReminders()).stats).toMatchObject({ totalOverdue: 0, totalAmount: 0, totalFees: 0 });
    expect((await createReminder(invoice.id)).status).toBe(409);
    expect(await database.client.income.count({ where: { invoiceId: invoice.id } })).toBe(1);
  });
});

describe('QA #32: internal recording and manual email copy', () => {
  it('labels history with the recording date on mobile and desktop, never as sent', () => {
    const source = readFileSync('app/dashboard/reminders/page.tsx', 'utf8');
    expect(source.match(/Erfasst: \{formatDate\(reminder\.createdAt\)\}/g)).toHaveLength(2);
    expect(source).not.toContain('Gesendet:');
    expect(source).not.toContain('E-Mail wird gesendet an');
    expect(source).toContain('Mahnung intern erfassen');
    expect(source).toContain('Es wird keine E-Mail automatisch versendet.');
    expect(source).toContain('Empfänger für den manuellen Versand:');
    expect(source).toContain('Kopieren oder Öffnen im E-Mail-Client versendet noch keine E-Mail.');
    expect(source).toContain('onClick={handleOpenMailClient}');
    expect(source).toContain('window.open(`mailto:${email}?subject=${subject}&body=${body}`');
    expect(source).toContain("fetch('/api/invoices'");
    expect(source).toContain("JSON.stringify({ id: invoiceId, status: 'PAID' })");
  });
});
