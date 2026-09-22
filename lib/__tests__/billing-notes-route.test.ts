import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as unknown, userId: 'owner' }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({
  requireUserId: async () => state.userId,
  UnauthorizedError: class extends Error {},
  unauthorizedResponse: () => new Response(null, { status: 401 }),
}));

import { DELETE, GET, POST } from '@/app/api/billing-notes/route';

let database: ReturnType<typeof createTestDatabase>;
let customerId: number;
let otherCustomerId: number;

beforeAll(async () => {
  database = createTestDatabase();
  state.client = database.client;
  await database.client.user.createMany({
    data: [
      { id: 'owner', email: 'owner@billing-route.test', password: 'unused' },
      { id: 'other', email: 'other@billing-route.test', password: 'unused' },
    ],
  });
  customerId = (await database.client.customer.create({ data: { userId: 'owner', name: 'Eigener Kunde' } })).id;
  otherCustomerId = (await database.client.customer.create({ data: { userId: 'other', name: 'Fremder Kunde' } })).id;
}, 40_000);

afterAll(async () => { await database?.cleanup(); });

describe('billing note API boundaries', () => {
  it('rejects invalid note input before writing and does not disclose another tenant', async () => {
    const invalid = await POST(new Request('http://localhost/api/billing-notes', {
      method: 'POST', body: JSON.stringify({ customerId, serviceDate: '2026-03-01', description: 'Zeit', quantity: true }),
      headers: { 'content-type': 'application/json' },
    }));
    expect(invalid.status).toBe(400);
    expect(await database.client.billingNote.count()).toBe(0);

    const foreign = await GET(new Request(`http://localhost/api/billing-notes?customerId=${otherCustomerId}`));
    expect(foreign.status).toBe(404);
  });

  it('deletes only unlinked notes and protects a claimed note', async () => {
    const createdResponse = await POST(new Request('http://localhost/api/billing-notes', {
      method: 'POST', body: JSON.stringify({ customerId, serviceDate: '2026-03-02', description: 'Zeit' }),
      headers: { 'content-type': 'application/json' },
    }));
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { id: number; serviceDate: string };
    expect(created.serviceDate).toBe('2026-03-02');
    const allNotes = () => GET(new Request(`http://localhost/api/billing-notes?customerId=${customerId}&includeLinked=true`));
    expect(await (await allNotes()).json()).toEqual([expect.objectContaining({ id: created.id, invoiceId: null })]);

    const invoice = await database.client.invoice.create({
      data: { userId: 'owner', customerId, fileName: 'claimed.pdf', storedFileName: 'claimed.pdf', parsedData: {}, issuanceState: 'UNISSUED' },
    });
    await database.client.billingNote.update({ where: { id: created.id }, data: { invoiceId: invoice.id } });
    expect(await (await allNotes()).json()).toEqual([expect.objectContaining({ id: created.id, invoiceId: invoice.id })]);
    expect(await (await GET(new Request(`http://localhost/api/billing-notes?customerId=${customerId}`))).json()).toEqual([]);
    const response = await DELETE(new Request(`http://localhost/api/billing-notes?id=${created.id}`, { method: 'DELETE' }));
    expect(response.status).toBe(409);
    expect(await database.client.billingNote.findUnique({ where: { id: created.id } })).not.toBeNull();
  });
});
