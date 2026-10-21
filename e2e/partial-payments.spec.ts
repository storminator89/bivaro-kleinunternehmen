import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';

// Only synthetic identities are seeded directly. All financial mutations use
// the real HTTP routes; the supported runner owns the isolated temporary DB.
async function isolatedAccount(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const password = 'SyntheticPartialPass123!';
  const email = `partial-${randomUUID()}@example.test`;
  const user = await prisma.user.create({ data: { email, name: 'Synthetic partial acceptance', password: await hashPassword(password), role: 'USER' } });
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return user.id;
}

async function createInvoice(page: Page, invoiceNumber: string) {
  const pdf = await PDFDocument.create(); pdf.addPage();
  const response = await page.request.post('/api/invoices', { data: {
    fileName: `${invoiceNumber}.pdf`, invoiceNumber, totalAmount: 120,
    invoiceDate: '2024-12-01', dueDate: '2024-12-15',
    parsedData: { currency: 'EUR' }, pdfBytes: await pdf.saveAsBase64(),
  } });
  expect(response.status()).toBe(200);
  return response.json() as Promise<{ id: number }>;
}

async function snapshot(userId: string, invoiceId: number) {
  return {
    invoice: await prisma.invoice.findFirst({ where: { id: invoiceId, userId }, select: { id: true, status: true, paidAt: true, totalAmount: true } }),
    events: await prisma.paymentJournalEvent.findMany({ where: { userId, invoiceId }, orderBy: { id: 'asc' } }),
    incomes: await prisma.income.findMany({ where: { userId, invoiceId }, orderBy: { id: 'asc' } }),
    reminders: await prisma.reminder.findMany({ where: { userId, invoiceId }, orderBy: { id: 'asc' } }),
    auditCount: await prisma.auditLog.count({ where: { userId } }),
  };
}

async function allocate(page: Page, invoiceId: number, amount: string, paidAt: string, expectedPaidCents: string) {
  const response = await page.request.post(`/api/invoices/${invoiceId}/payments`, { data: {
    amount, paidAt, expectedPaidCents, currency: 'EUR', source: 'MANUAL',
    reference: 'Synthetic bank evidence', idempotencyKey: randomUUID(),
  } });
  expect(response.status()).toBe(201);
  return response.json();
}

test('treats a later deliberate equal amount/date/reference as a distinct allocation', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const userId = await isolatedAccount(page);
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const invoiceNumber = 'EXTRA-EQUAL-120';
    const invoice = await createInvoice(page, invoiceNumber);
    const paymentPath = `/api/invoices/${invoice.id}/payments`;
    const payloads: Record<string, unknown>[] = [];
    for (const baseline of ['0', '4000', '8000']) {
      await page.goto('/dashboard?tab=invoices');
      // This isolated tenant has one invoice: avoid opening a dropdown while
      // an unnecessary debounced search replaces the same row underneath it.
      const row = page.getByRole('row').filter({ hasText: invoiceNumber });
      await expect(page.getByRole('row').filter({ has: page.getByRole('button', { name: /^Zahlungsstatus:/ }) })).toHaveCount(1);
      await expect(row).toHaveCount(1);
      const state = baseline === '0' ? 'Offen' : 'Teilbezahlt';
      await row.getByRole('button', { name: `Zahlungsstatus: ${state}`, exact: true }).click();
      await page.getByRole('menuitem', { name: baseline === '0' ? 'Bezahlt' : 'Weitere Zahlung erfassen', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Zahlung erfassen', exact: true });
      await expect(dialog.getByText('Zahlung gespeichert', { exact: true })).toHaveCount(0);
      const submit = dialog.getByRole('button', { name: 'Zahlung verbindlich erfassen', exact: true });
      await expect(submit).toBeEnabled();
      await dialog.getByLabel('Eingegangener Betrag (EUR)', { exact: true }).fill('40.00');
      await dialog.getByLabel('Tatsächliches Zahlungsdatum', { exact: true }).fill('2025-01-02');
      await dialog.getByLabel('Zahlungsreferenz', { exact: true }).fill('Same date and reference, separate real receipts');
      const saved = page.waitForResponse(response => response.url().endsWith(paymentPath) && response.request().method() === 'POST');
      await submit.click();
      const response = await saved;
      expect(response.status()).toBe(201);
      const payload = response.request().postDataJSON();
      expect(payload).toMatchObject({ amount: '40.00', paidAt: '2025-01-02', expectedPaidCents: baseline, reference: 'Same date and reference, separate real receipts' });
      payloads.push(payload);
      await expect(dialog.getByText('Zahlung gespeichert', { exact: true })).toBeVisible();
      await expect(dialog.getByRole('region', { name: 'Zahlungsverlauf', exact: true }).getByRole('listitem')).toHaveCount(payloads.length);
      await dialog.locator('[data-slot="dialog-footer"]').getByRole('button', { name: 'Schließen', exact: true }).click();
    }
    expect(new Set(payloads.map(payload => payload.idempotencyKey)).size).toBe(3);
    const ledgerResponse = await page.request.get(paymentPath);
    expect(ledgerResponse.status()).toBe(200);
    const ledger = await ledgerResponse.json();
    expect(ledger.events).toHaveLength(3);
    expect(ledger.summary).toMatchObject({ paidCents: '12000', openCents: '0', paymentState: 'PAID' });
    const db = await snapshot(userId, invoice.id);
    expect(db.events).toHaveLength(3); expect(db.incomes).toHaveLength(3);
    expect(db.events.every(event => event.amountCents === '4000')).toBe(true);
    expect(new Set(db.events.map(event => event.incomeId)).size).toBe(3);
    await testInfo.attach('deliberate-equal-allocation-evidence.json', { body: Buffer.from(JSON.stringify({ payloads, ledger, db }, null, 2)), contentType: 'application/json' });
  } finally { await prisma.$disconnect(); }
});

test('shows only the remaining reminder balance and blocks internal, preview and send actions after a partial', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const userId = await isolatedAccount(page);
  try {
    // Even if the guard regresses, this runner must not have SMTP authority.
    expect(await prisma.smtpSettings.count()).toBe(0);
    expect(Boolean(process.env.SMTP_HOST)).toBe(false);
    expect(Boolean(process.env.SMTP_USER)).toBe(false);
    expect(Boolean(process.env.SMTP_PASSWORD)).toBe(false);
    const invoiceNumber = 'EXTRA-REMINDER-120';
    const invoice = await createInvoice(page, invoiceNumber);
    await allocate(page, invoice.id, '40.00', '2025-01-02', '0');
    const remindersResponse = await page.request.get('/api/reminders?includeAll=true');
    expect(remindersResponse.status()).toBe(200);
    const reminders = await remindersResponse.json();
    expect(reminders.stats.totalAmount).toBe(80);
    expect(reminders.invoices).toHaveLength(1);
    expect(reminders.invoices[0]).toMatchObject({ id: invoice.id, openAmount: 80, canCreateReminder: false, paymentSummary: { paymentState: 'PARTIAL', paidCents: '4000', openCents: '8000' } });
    const before = await snapshot(userId, invoice.id);
    const rejected: { path: string; status: number; body: unknown }[] = [];
    for (const request of [
      { path: '/api/reminders', data: { invoiceId: invoice.id, fee: 0 } },
      { path: '/api/email/preview', data: { documentType: 'reminder', id: invoice.id } },
      { path: '/api/email/send', data: { documentType: 'reminder', id: invoice.id, to: 'never-send@example.invalid', subject: 'Synthetic stale reminder', text: 'Must never leave the isolated fixture' } },
    ]) {
      const response = await page.request.post(request.path, { data: request.data });
      const body = await response.json();
      expect(response.status()).toBe(request.path === '/api/reminders' ? 409 : 400);
      if (request.path === '/api/reminders') expect(body.code).toBe('PAYMENT_REVIEW_REQUIRED');
      else expect(body.error).toContain('Zahlungsnachweisen');
      rejected.push({ path: request.path, status: response.status(), body });
    }
    expect(await snapshot(userId, invoice.id)).toEqual(before);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/dashboard/reminders');
      const record = page.getByRole(width < 1280 ? 'article' : 'row').filter({ hasText: invoiceNumber });
      await expect(record).toBeVisible();
      await expect(record).toContainText('80,00');
      await expect(record.getByRole('button', { name: 'Zahlungserinnerung', exact: true })).toHaveCount(0);
      await expect(record.getByRole('button', { name: width < 1280 ? 'Zahlung erfassen' : `Zahlung für Rechnung ${invoiceNumber} erfassen`, exact: true })).toBeVisible();
      await expect(page.getByText('Nach Teilzahlungen sind Mahnaktionen bis zur Restbetragsprüfung gesperrt.', { exact: false })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`partial-reminder-guard-${width}.png`), fullPage: true });
    }
    expect(await snapshot(userId, invoice.id)).toEqual(before);
    await testInfo.attach('partial-reminder-http-db-evidence.json', { body: Buffer.from(JSON.stringify({ reminders, rejected, before }, null, 2)), contentType: 'application/json' });
  } finally { await prisma.$disconnect(); }
});

test('recognizes each actual payment in its own accounting period before and after settlement', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const userId = await isolatedAccount(page);
  try {
    const invoice = await createInvoice(page, 'EXTRA-PERIOD-120');
    const evidence: unknown[] = [];
    const period = async (year: number, amount: number) => {
      const response = await page.request.get(`/api/eur-export?year=${year}&format=json`);
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.data.totalIncome).toBe(amount);
      return { year, totalIncome: body.data.totalIncome };
    };
    await allocate(page, invoice.id, '40.00', '2024-12-31', '0');
    evidence.push({ stage: 'PARTIAL', periods: [await period(2024, 40), await period(2025, 0)], db: await snapshot(userId, invoice.id) });
    await allocate(page, invoice.id, '80.00', '2025-01-02', '4000');
    const settled = await snapshot(userId, invoice.id);
    expect(settled.invoice).toMatchObject({ status: 'PAID', paidAt: new Date('2025-01-02T00:00:00.000Z') });
    expect(settled.events).toHaveLength(2); expect(settled.incomes).toHaveLength(2);
    expect(settled.incomes.map(income => ({ amount: income.amount, date: income.date.toISOString() }))).toEqual([
      { amount: 40, date: '2024-12-31T00:00:00.000Z' }, { amount: 80, date: '2025-01-02T00:00:00.000Z' },
    ]);
    const taxResponse = await page.request.get('/api/tax-summary?year=2025&timeRange=thisYear');
    expect(taxResponse.status()).toBe(200);
    const tax = await taxResponse.json(); expect(tax.totalIncome).toBe(80);
    evidence.push({ stage: 'PAID', periods: [await period(2024, 40), await period(2025, 80)], taxTotalIncome2025: tax.totalIncome, db: settled });
    await testInfo.attach('actual-period-http-db-evidence.json', { body: Buffer.from(JSON.stringify(evidence, null, 2)), contentType: 'application/json' });
  } finally { await prisma.$disconnect(); }
});
