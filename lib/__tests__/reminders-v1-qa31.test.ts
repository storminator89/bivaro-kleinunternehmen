import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));

import { generateApiKey } from '@/lib/api-auth';
import { GET, POST } from '@/app/api/v1/reminders/route';

let database: ReturnType<typeof createTestDatabase>;
let key: string;
let readKey: string;
let writeKey: string;
let otherKey: string;
let openId: number;
let upcomingId: number;
let foreignId: number;
const rejectedInvoices: { id: number; type: string; status: string }[] = [];

async function createKey(userId: string, scopes: string[]) {
  const generated = generateApiKey();
  await database.client.apiKey.create({ data: {
    userId, name: 'Reminder regression fixture', keyHash: generated.keyHash,
    keyPrefix: generated.keyPrefix, scopes: JSON.stringify(scopes),
  } });
  return generated.key;
}

function request(method: string, body?: object, query = '', apiKey = key) {
  return new NextRequest(`http://localhost/api/v1/reminders${query}`, {
    method, headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeAll(async () => {
  // Migrations and Prisma use the helper's explicit, fresh temporary DATABASE_URL.
  database = createTestDatabase();
  state.client = database.client;
  await database.client.user.createMany({ data: [
    { id: 'reminder-api-owner', email: 'reminder-api-owner@test.invalid', password: 'unused' },
    { id: 'reminder-api-other', email: 'reminder-api-other@test.invalid', password: 'unused' },
  ] });
  key = await createKey('reminder-api-owner', ['read', 'write']);
  readKey = await createKey('reminder-api-owner', ['read']);
  writeKey = await createKey('reminder-api-owner', ['write']);
  otherKey = await createKey('reminder-api-other', ['read', 'write']);

  let sequence = 0;
  const createInvoice = (data: Record<string, unknown> = {}) => database.client.invoice.create({ data: {
    userId: 'reminder-api-owner', fileName: `reminder-api-${++sequence}.pdf`,
    storedFileName: `reminder-api-${sequence}.pdf`, parsedData: {},
    type: 'INVOICE', status: 'SENT', totalAmount: 297.5, dueDate: new Date('2020-01-15T12:00:00Z'), ...data,
  } });
  openId = (await createInvoice()).id;
  upcomingId = (await createInvoice({ status: 'DRAFT', dueDate: new Date('2099-01-15T12:00:00Z') })).id;
  foreignId = (await createInvoice({ userId: 'reminder-api-other' })).id;
  for (const data of [
    { type: 'QUOTE', status: 'DRAFT' }, { type: 'CREDIT_NOTE', status: 'SENT' },
    { type: 'INVOICE', status: 'PAID' }, { type: 'INVOICE', status: 'CANCELLED' },
  ]) {
    const invoice = await createInvoice(data);
    rejectedInvoices.push({ id: invoice.id, type: invoice.type, status: invoice.status });
    await database.client.reminder.create({ data: {
      userId: invoice.userId, invoiceId: invoice.id, fee: 99, dueDate: new Date('2099-01-15T12:00:00Z'),
    } });
  }
}, 40_000);
afterAll(async () => { await database?.cleanup(); });

describe('QA #31: API-key reminder eligibility mirrors the web endpoint', () => {
  it('lists only this tenant’s open INVOICE documents and excludes ineligible fees from statistics', async () => {
    const response = await GET(request('GET', undefined, '?includeAll=true'));
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.invoices.map((invoice: { id: number }) => invoice.id)).toEqual([openId, upcomingId]);
    expect(data.stats).toMatchObject({ totalOverdue: 1, totalAmount: 297.5, totalFees: 0 });

    const overdue = await GET(request('GET'));
    expect((await overdue.json()).data.invoices.map((invoice: { id: number }) => invoice.id)).toEqual([openId]);
  });

  it('does not bypass eligibility or tenant filtering for an explicit invoiceId', async () => {
    for (const invoiceId of [...rejectedInvoices.map(invoice => invoice.id), foreignId]) {
      const response = await GET(request('GET', undefined, `?invoiceId=${invoiceId}`));
      expect(response.status).toBe(200);
      expect((await response.json()).data.invoices).toEqual([]);
    }
    // invoiceId retains its existing ability to return an open future-due invoice.
    const upcoming = await GET(request('GET', undefined, `?invoiceId=${upcomingId}`));
    expect((await upcoming.json()).data.invoices).toEqual([expect.objectContaining({ id: upcomingId })]);
  });

  it.each(['QUOTE', 'CREDIT_NOTE', 'CANCELLED'])('rejects creating reminders for %s', async kind => {
    const invoice = rejectedInvoices.find(row => kind === 'CANCELLED' ? row.status === kind : row.type === kind)!;
    const before = await database.client.reminder.count({ where: { invoiceId: invoice.id } });
    const response = await POST(request('POST', { invoiceId: invoice.id }));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('INVOICE_NOT_OPEN');
    expect(await database.client.reminder.count({ where: { invoiceId: invoice.id } })).toBe(before);
  });

  it('preserves the paid-invoice error contract', async () => {
    const invoice = rejectedInvoices.find(row => row.status === 'PAID')!;
    const response = await POST(request('POST', { invoiceId: invoice.id }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('INVOICE_PAID');
  });

  it('keeps read and write scopes required and rejects missing credentials', async () => {
    expect((await GET(new NextRequest('http://localhost/api/v1/reminders'))).status).toBe(401);
    const readDenied = await GET(request('GET', undefined, '', writeKey));
    expect(readDenied.status).toBe(403);
    expect((await readDenied.json()).error.code).toBe('INSUFFICIENT_SCOPES');
    const writeDenied = await POST(request('POST', { invoiceId: openId }, '', readKey));
    expect(writeDenied.status).toBe(403);
    expect((await writeDenied.json()).error.code).toBe('INSUFFICIENT_SCOPES');
  });

  it('prevents API keys from creating reminders for another tenant', async () => {
    expect((await POST(request('POST', { invoiceId: foreignId }))).status).toBe(404);
    expect((await POST(request('POST', { invoiceId: openId }, '', otherKey))).status).toBe(404);
    expect(await database.client.reminder.count({ where: { invoiceId: foreignId } })).toBe(0);
  });

  it('preserves creation and audit of an eligible open invoice', async () => {
    const response = await POST(request('POST', { invoiceId: openId, fee: 5, dueDays: 7, notes: 'Intern erfasst' }));
    expect(response.status).toBe(201);
    expect(response.headers.get('location')).toBe(`/api/v1/reminders?invoiceId=${openId}`);
    const { data } = await response.json();
    expect(data).toMatchObject({ invoiceId: openId, reminderLevel: 1, fee: 5, notes: 'Intern erfasst' });
    expect(await database.client.auditLog.count({ where: {
      userId: 'reminder-api-owner', entityType: 'Reminder', entityId: String(data.id), action: 'CREATE',
    } })).toBe(1);
    expect(await database.client.income.count({ where: { invoiceId: openId } })).toBe(0);
  });
});
