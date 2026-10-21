import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import { createTestDatabase } from './helpers/database';
const state = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client; } }));
vi.mock('@/lib/get-user-id', () => ({ requireUserId: async () => 'surface-owner', getUserId: async () => 'surface-owner', UnauthorizedError: class extends Error {}, unauthorizedResponse: () => new Response(null, { status: 401 }) }));
import { recordFullPayment, adoptLegacyPaidInvoice } from '@/lib/payment-journal/service';
import { GET as getKpis } from '@/app/api/dashboard/kpis/route';
import { GET as getSummary } from '@/app/api/dashboard/summary/route';
import { GET as getTax } from '@/app/api/tax-summary/route';
import { GET as getEur } from '@/app/api/eur-export/route';
import { GET as getIncomes } from '@/app/api/incomes/route';
import { GET as getReminders, POST as postReminder } from '@/app/api/reminders/route';
import { buildDocumentEmailDraft, sendDocumentEmail } from '@/lib/email';
import { ensureTenantUploadDir } from '@/lib/upload-path';
import { writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { createAccountantExport, parseAccountantExportPeriod } from '@/lib/accountant-export';
let db: ReturnType<typeof createTestDatabase>;
let directory: string;
beforeAll(async () => {
  db = createTestDatabase(); state.client = db.client;
  await db.client.user.create({ data: { id: 'surface-owner', email: 'surface@test.invalid', password: 'fixture' } });
  directory = await ensureTenantUploadDir('surface-owner');
  await writeFile(path.join(directory, 'surface.pdf'), '%PDF-fixture');
}, 40_000);
afterAll(async () => { await db?.cleanup(); if (directory) await rm(directory, { recursive: true, force: true }); });
const get = (pathname: string) => new NextRequest(`http://localhost${pathname}`);

it('all financial surfaces retain 40/80 in actual periods and expose only exact remaining balances', async () => {
  const source = await db.client.invoice.create({ data: { userId: 'surface-owner', fileName: 'surface.pdf', storedFileName: 'surface.pdf', parsedData: {}, invoiceNumber: 'SURFACE-120', totalAmount: 120, status: 'SENT', issuanceState: 'ISSUED', dueDate: new Date('2024-01-01') } });
  await recordFullPayment('surface-owner', source.id, { amount: '40', paidAt: '2024-12-31', currency: 'EUR', source: 'MANUAL', reference: 'Statement A', idempotencyKey: 'surface-A', expectedPaidCents: '0' });
  let kpis = await (await getKpis(get('/api/dashboard/kpis?year=2024'))).json();
  expect(kpis.openInvoices).toBe(80); expect(kpis.yearComparison.revenueThisYearTotal).toBe(40);
  let reminders = await (await getReminders(get('/api/reminders?includeAll=true'))).json();
  expect(reminders.stats.totalAmount).toBe(80);
  expect(reminders.invoices[0]).toMatchObject({ openAmount: 80, canCreateReminder: false, paymentSummary: { paymentState: 'PARTIAL', paidCents: '4000', openCents: '8000' } });
  const rejected = await postReminder(new Request('http://localhost/api/reminders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invoiceId: source.id, fee: 0 }) }));
  expect(rejected.status).toBe(409); expect(await db.client.reminder.count()).toBe(0);
  await expect(buildDocumentEmailDraft('surface-owner', { documentType: 'reminder', id: source.id })).rejects.toThrow('Zahlungsnachweisen');
  await expect(sendDocumentEmail('surface-owner', { documentType: 'reminder', id: source.id, to: 'never-send@example.invalid', subject: 'Must not send', text: 'Original total must not send' })).rejects.toThrow('Zahlungsnachweisen');
  const before = await getEur(get('/api/eur-export?year=2024&format=json'));
  expect(before.status).toBe(200); expect(await before.json()).toMatchObject({ data: { totalIncome: 40 } });
  await recordFullPayment('surface-owner', source.id, { amount: '80', paidAt: '2025-01-02', currency: 'EUR', source: 'MANUAL', reference: 'Statement B', idempotencyKey: 'surface-B', expectedPaidCents: '4000' });
  const incomes = await (await getIncomes(get('/api/incomes'))).json();
  expect(incomes.items).toHaveLength(2);
  expect(incomes.items.map((row: { paymentJournalEvent: { amountCents: string } }) => row.paymentJournalEvent.amountCents).sort()).toEqual(['4000', '8000']);
  for (const [year, amount] of [[2024, 40], [2025, 80]]) {
    const response = await getEur(get(`/api/eur-export?year=${year}&format=json`));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ data: { totalIncome: amount } });
  }
  const tax = await getTax(get('/api/tax-summary?year=2025&timeRange=thisYear'));
  expect(tax.status).toBe(200); expect(await tax.json()).toMatchObject({ totalIncome: 80 });
  const summary = await getSummary(get('/api/dashboard/summary?timeRange=all'));
  expect(summary.status).toBe(200); expect(await summary.json()).toMatchObject({ totalIncome: 120 });
  kpis = await (await getKpis(get('/api/dashboard/kpis?year=2024'))).json();
  expect(kpis.openInvoices).toBe(0); expect(kpis.yearComparison.revenueThisYearTotal).toBe(40);
  await db.client.invoice.update({ where: { id: source.id }, data: { status: 'CANCELLED' } });
  for (const [year, amount] of [[2024, 40], [2025, 80]]) {
    expect(await (await getEur(get(`/api/eur-export?year=${year}&format=json`))).json()).toMatchObject({ data: { totalIncome: amount } });
  }
  const unknown = await db.client.invoice.create({ data: { userId: 'surface-owner', fileName: 'surface.pdf', storedFileName: 'surface.pdf', parsedData: {}, invoiceNumber: 'LEGACY-UNKNOWN', invoiceDate: new Date('2024-12-31'), totalAmount: 30, status: 'PAID', issuanceState: 'UNKNOWN' } });
  await adoptLegacyPaidInvoice('surface-owner', unknown.id);
  const handoff = await createAccountantExport('surface-owner', parseAccountantExportPeriod(new URLSearchParams('from=2024-12-01&to=2024-12-31')));
  const zip = await JSZip.loadAsync(handoff.bytes);
  const records = JSON.parse(await zip.file('records.json')!.async('string'));
  expect(records.incomes).toHaveLength(1); expect(records.incomes[0]).toMatchObject({ amount: '40', accountingDate: '2024-12-31', cashRealized: true, paymentDateCertainty: 'ACTUAL' });
  expect(records.payments).toHaveLength(3);
  expect(records.payments.find((row: { dateCertainty: string }) => row.dateCertainty === 'UNKNOWN')).toMatchObject({ incomeId: null, paidAt: null, source: 'LEGACY_IMPORT', amountCents: '3000', paymentDateInPeriod: null });
  expect(handoff.manifest.warnings.some(row => row.code === 'PAYMENT_DATE_UNCERTAIN')).toBe(true);
  expect(await zip.file('payments.csv')!.async('string')).toContain('UNKNOWN');
  reminders = await (await getReminders(get('/api/reminders?includeAll=true'))).json();
  expect(reminders.invoices).toEqual([]);
});
