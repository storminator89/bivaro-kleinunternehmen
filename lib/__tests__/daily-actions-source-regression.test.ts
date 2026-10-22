import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { createTestDatabase } from './helpers/database';

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, userId: 'daily-source-regression' }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({ requireUserId: async () => state.userId, UnauthorizedError: class extends Error {}, unauthorizedResponse: () => new Response(null, { status: 401 }) }));

let database: ReturnType<typeof createTestDatabase>;
let storage: string;
let invoices: typeof import('@/app/api/invoices/route');
let quotes: typeof import('@/app/api/quotes/route');
let payments: typeof import('@/app/api/invoices/[id]/payments/route');
let workflow: typeof import('@/app/api/quotes/[id]/workflow/route');
let intake: typeof import('@/app/api/purchase-documents/route');
let reviewDraft: typeof import('@/app/api/purchase-documents/[id]/review-draft/route');
let daily: typeof import('@/app/api/daily-actions/route');
beforeAll(async () => {
  database = createTestDatabase(); state.client = database.client;
  await database.client.user.create({ data: { id: state.userId, email: `${state.userId}@example.invalid`, password: 'unused synthetic fixture' } });
  storage = await mkdtemp(path.join(tmpdir(), 'bivaro-daily-source-files-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(storage);
  try {
    invoices = await import('@/app/api/invoices/route');
    quotes = await import('@/app/api/quotes/route');
    payments = await import('@/app/api/invoices/[id]/payments/route');
    workflow = await import('@/app/api/quotes/[id]/workflow/route');
    intake = await import('@/app/api/purchase-documents/route');
    reviewDraft = await import('@/app/api/purchase-documents/[id]/review-draft/route');
    daily = await import('@/app/api/daily-actions/route');
  } finally { cwd.mockRestore(); }
}, 40_000);
afterAll(async () => { await database?.cleanup(); if (storage) await rm(storage, { recursive: true, force: true }); });

const context = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
function json(url: string, body: unknown, method = 'POST') {
  return new NextRequest(`http://localhost${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function document(type: 'invoices' | 'quotes', number: string) {
  const pdf = await PDFDocument.create(); pdf.addPage();
  const response = await (type === 'invoices' ? invoices : quotes).POST(json(`/api/${type}`, { fileName: `${number}.pdf`, invoiceNumber: type === 'invoices' ? number : undefined, quoteNumber: type === 'quotes' ? number : undefined, invoiceDate: '2026-01-01', quoteDate: '2026-01-01', dueDate: '2000-01-01', totalAmount: 120, parsedData: { currency: 'EUR', taxMode: 'small-business', items: [{ description: 'Synthetic daily service', quantity: 1, unitPrice: 120, unit: 'Stück', taxRate: 0 }] }, pdfBytes: await pdf.saveAsBase64() }));
  expect(response.status).toBe(200);
  return await response.json() as { id: number; status: string; quoteFollowUpOn: string | null; quoteResponseNote: string | null };
}

it('retains all four actual API-created daily sources after an empty initial read and leaves read snapshots unchanged', async () => {
  expect(await (await daily.GET()).json()).toMatchObject({ actionCount: 0, actions: [] });
  const invoice = await document('invoices', 'SYNTHETIC-DAILY-PARTIAL');
  expect((await invoices.PUT(json('/api/invoices', { id: invoice.id, status: 'SENT' }, 'PUT'))).status).toBe(200);
  expect((await payments.POST(json(`/api/invoices/${invoice.id}/payments`, { amount: '40.00', paidAt: '2026-01-02', expectedPaidCents: '0', currency: 'EUR', source: 'MANUAL', reference: 'Synthetic bank statement', idempotencyKey: randomUUID() }), context(invoice.id))).status).toBe(201);
  const followUp = await document('quotes', 'SYNTHETIC-DAILY-FOLLOWUP');
  expect((await workflow.PATCH(json(`/api/quotes/${followUp.id}/workflow`, { quoteFollowUpOn: '2000-01-01', expected: { status: followUp.status, quoteFollowUpOn: null, quoteResponseNote: null } }, 'PATCH'), context(followUp.id))).status).toBe(200);
  const accepted = await document('quotes', 'SYNTHETIC-DAILY-ACCEPTED');
  expect((await workflow.PATCH(json(`/api/quotes/${accepted.id}/workflow`, { status: 'ACCEPTED', expected: { status: accepted.status, quoteFollowUpOn: null, quoteResponseNote: null } }, 'PATCH'), context(accepted.id))).status).toBe(200);
  const photo = await sharp({ create: { width: 80, height: 120, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const form = new FormData(); form.append('file', new File([new Uint8Array(photo)], 'synthetic-daily-receipt.png', { type: 'image/png' })); form.append('uploadRequestId', randomUUID());
  const uploaded = await intake.POST(new NextRequest('http://localhost/api/purchase-documents', { method: 'POST', body: form }));
  expect(uploaded.status).toBe(201); const receipt = (await uploaded.json()).document;
  expect((await reviewDraft.POST(json(`/api/purchase-documents/${receipt.id}/review-draft`, { expectedRevision: receipt.revision, draft: { supplierName: 'Synthetic draft supplier', invoiceNumber: 'SYN-DAILY', invoiceDate: '2026-01-02', paymentDate: '', amount: '9.99', note: 'Synthetic saved review; not booked.' } }), context(receipt.id))).status).toBe(200);
  const before = await database.client.auditLog.count({ where: { userId: state.userId } });
  for (let read = 0; read < 2; read++) {
    const response = await daily.GET();
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const result = await response.json();
    expect(result).toMatchObject({ actionCount: 4, isPartial: false });
    expect(result.actions.map((action: { id: string }) => action.id)).toEqual([`invoice:${invoice.id}`, `quote:${followUp.id}`, `quote:${accepted.id}`, `receipt:${receipt.id}`]);
    expect(result.actions[0]).toMatchObject({ amountCents: '8000', source: 'SYNTHETIC-DAILY-PARTIAL' });
  }
  expect(await database.client.auditLog.count({ where: { userId: state.userId } })).toBe(before);
});
