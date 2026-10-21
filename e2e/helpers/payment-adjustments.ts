import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { hashPassword } from '../../lib/password';
import { prisma } from '../../lib/prisma';
import { readPaymentAdjustmentPreflight } from '../../lib/payment-adjustment-form';
import type { PaymentHistoryEvent, PaymentLedger } from '../../lib/full-payment-form';
import { e2eDatabasePath } from '../../scripts/e2e-fixture.mjs';

// The supported runner owns this exact fresh DB. Only synthetic identities are
// seeded directly; documents, receipts and adjustments use real HTTP routes.
export async function isolatedAccount(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const password = 'SyntheticAdjustmentPass123!';
  const email = `adjustment-${randomUUID()}@example.test`;
  const user = await prisma.user.create({ data: { email, name: 'Synthetic adjustment acceptance', password: await hashPassword(password), role: 'USER' } });
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return user.id;
}

export async function createInvoice(page: Page, invoiceNumber: string, options: {
  parsedData?: Record<string, unknown>; totalAmount?: number; invoiceDate?: string; dueDate?: string;
} = {}) {
  const totalAmount = options.totalAmount ?? 120;
  const pdf = await PDFDocument.create(); pdf.addPage();
  const response = await page.request.post('/api/invoices', { data: {
    fileName: `${invoiceNumber}.pdf`, invoiceNumber, totalAmount,
    invoiceDate: options.invoiceDate ?? '2025-06-01', dueDate: options.dueDate ?? '2025-06-15',
    parsedData: options.parsedData ?? { currency: 'EUR', taxMode: 'small-business', grossAmount: totalAmount, netAmount: totalAmount, taxAmount: 0,
      items: [{ description: 'Synthetic ordinary service', quantity: 1, unitPrice: totalAmount, amount: totalAmount, taxRate: 0 }] },
    pdfBytes: await pdf.saveAsBase64(),
  } });
  expect(response.status()).toBe(200);
  const invoice = await response.json() as { id: number; invoiceNumber: string };
  expect((await page.request.put('/api/invoices', { data: { id: invoice.id, status: 'SENT' } })).status()).toBe(200);
  return invoice;
}

export async function loadJournal(page: Page, invoiceId: number) {
  const response = await page.request.get(`/api/invoices/${invoiceId}/payments`, { headers: { 'X-Bivaro-Payment-Contract': '2' } });
  expect(response.status()).toBe(200);
  return readPaymentAdjustmentPreflight(await response.json(), invoiceId);
}

export async function allocate(page: Page, invoiceId: number, amount: string, paidAt: string, expectedPaidCents: string, options: {
  expectedLedgerVersion?: string; reference?: string; idempotencyKey?: string;
} = {}) {
  const response = await page.request.post(`/api/invoices/${invoiceId}/payments`, { data: {
    amount, paidAt, expectedPaidCents, currency: 'EUR', source: 'MANUAL',
    reference: options.reference ?? 'Synthetic original bank evidence', idempotencyKey: options.idempotencyKey ?? randomUUID(),
    ...(options.expectedLedgerVersion ? { expectedLedgerVersion: options.expectedLedgerVersion } : {}),
  } });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ event: PaymentHistoryEvent; ledgerVersion: string; ledger: PaymentLedger }>;
}

export async function snapshot(userId: string, invoiceId: number) {
  return {
    invoice: await prisma.invoice.findFirst({ where: { id: invoiceId, userId }, select: { id: true, status: true, issuanceState: true, paidAt: true, totalAmount: true } }),
    events: await prisma.paymentJournalEvent.findMany({ where: { userId, invoiceId }, orderBy: { id: 'asc' } }),
    incomes: await prisma.income.findMany({ where: { userId, invoiceId }, orderBy: { id: 'asc' } }),
    adjustments: await prisma.paymentAdjustment.findMany({ where: { userId, invoiceId }, orderBy: { id: 'asc' } }),
    operations: await prisma.paymentOperation.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    reminders: await prisma.reminder.findMany({ where: { userId, invoiceId }, orderBy: { id: 'asc' } }),
    audits: await prisma.auditLog.findMany({ where: { userId, entityType: 'Invoice', entityId: String(invoiceId) }, orderBy: { id: 'asc' } }),
  };
}

export async function openJournal(page: Page, invoiceNumber: string) {
  await page.getByRole('button', { name: `Weitere Aktionen fuer Rechnung ${invoiceNumber}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Zahlungsverlauf ansehen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Zahlungen und Korrekturen', exact: true });
  await expect(dialog.getByRole('region', { name: 'Zahlung korrigieren oder Erstattung dokumentieren', exact: true })).toBeVisible();
  return dialog;
}
