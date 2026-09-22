import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as unknown, userId: 'upload-owner' }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({ requireUserId: async () => state.userId, UnauthorizedError: class extends Error {}, unauthorizedResponse: () => new Response(null, { status: 401 }) }));

let database: ReturnType<typeof createTestDatabase>;
let storageDirectory: string;
let upload: typeof import('@/app/api/invoices/upload/route');

const sourceXml = (invoiceNumber: string) => `<Invoice><ID>${invoiceNumber}</ID><IssueDate>2026-09-18</IssueDate><DocumentCurrencyCode>EUR</DocumentCurrencyCode><LegalMonetaryTotal><TaxInclusiveAmount currencyID="EUR">25</TaxInclusiveAmount><PayableAmount currencyID="EUR">25</PayableAmount></LegalMonetaryTotal></Invoice>`;

function request(xml: string, generatedRequestId: string) {
  const form = new FormData();
  form.append('file', new File([xml], 'invoice.xml', { type: 'application/xml' }));
  form.append('generatedRequestId', generatedRequestId);
  return new NextRequest('http://localhost/api/invoices/upload', { method: 'POST', body: form });
}

beforeAll(async () => {
  database = createTestDatabase();
  state.client = database.client;
  await database.client.user.create({ data: { id: state.userId, email: 'upload-owner@test.invalid', password: 'unused' } });
  storageDirectory = await mkdtemp(path.join(tmpdir(), 'bivaro-upload-idempotency-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(storageDirectory);
  try {
    upload = await import('@/app/api/invoices/upload/route');
  } finally {
    cwd.mockRestore();
  }
}, 40_000);

afterAll(async () => {
  await database?.cleanup();
  if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
});

describe('invoice upload idempotency', () => {
  it('returns the committed invoice for an identical retry and rejects a changed retry', async () => {
    const requestId = '8d9a54b4-5cf7-4ad4-ae4c-eec8e3cb5d4f';
    const first = await upload.POST(request(sourceXml('IDEMP-1'), requestId));
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { id: number };
    expect(await database.client.invoice.count({ where: { userId: state.userId } })).toBe(1);

    const retry = await upload.POST(request(sourceXml('IDEMP-1'), requestId));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ id: firstBody.id, idempotent: true });
    expect(await database.client.invoice.count({ where: { userId: state.userId } })).toBe(1);

    const changed = await upload.POST(request(sourceXml('IDEMP-2'), requestId));
    expect(changed.status).toBe(409);
    expect(await database.client.invoice.count({ where: { userId: state.userId } })).toBe(1);
  });

  it('serializes simultaneous retries to one invoice', async () => {
    const requestId = '0b6a5b69-45ca-42a6-9d6d-a90391cd2a82';
    const responses = await Promise.all([
      upload.POST(request(sourceXml('IDEMP-RACE'), requestId)),
      upload.POST(request(sourceXml('IDEMP-RACE'), requestId)),
    ]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(new Set((await Promise.all(responses.map(response => response.json()))).map(body => body.id)).size).toBe(1);
    expect(await database.client.invoice.count({ where: { userId: state.userId, invoiceNumber: 'IDEMP-RACE' } })).toBe(1);
  });
});
