import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';

// Authored acceptance only: run with the existing isolated full-browser runner.
// Seed synthetic identity only; every invoice/payment/reminder uses a real API.
async function account(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const email = `reminder-workbench-${randomUUID()}@example.test`;
  const password = 'SyntheticReminderPass123!';
  const user = await prisma.user.create({ data: { email, name: 'Synthetic reminder review', password: await hashPassword(password), role: 'USER' } });
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return user.id;
}
async function payment(page: Page, id: number, amount: string, expectedPaidCents: string) {
  const response = await page.request.post(`/api/invoices/${id}/payments`, { data: { amount, expectedPaidCents, currency: 'EUR', source: 'MANUAL', paidAt: '2026-10-01', reference: 'Synthetic bank reference, not a real payment', idempotencyKey: randomUUID() } });
  expect(response.status()).toBe(201);
}
async function snapshot(userId: string, invoiceId: number) {
  return {
    invoice: await prisma.invoice.findFirst({ where: { id: invoiceId, userId } }),
    incomes: await prisma.income.findMany({ where: { userId, invoiceId }, orderBy: { id: 'asc' } }),
    events: await prisma.paymentJournalEvent.findMany({ where: { userId, invoiceId }, orderBy: { id: 'asc' } }),
    reminders: await prisma.reminder.findMany({ where: { userId, invoiceId }, orderBy: { id: 'asc' } }),
  };
}

for (const width of [1440, 390]) test(`prepares a confirmed rest-balance reminder without fake payments or automatic sends at ${width}px`, async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width, height: 1000 });
  const userId = await account(page);
  const emailRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/email/')) emailRequests.push(request.url()); });
  try {
    const pdf = await PDFDocument.create(); pdf.addPage();
    const invoiceNumber = `WORKBENCH-${width}-120`;
    const created = await page.request.post('/api/invoices', { data: { fileName: `${invoiceNumber}.pdf`, invoiceNumber, totalAmount: 120, invoiceDate: '2026-09-01', dueDate: '2026-09-15', parsedData: { currency: 'EUR' }, pdfBytes: await pdf.saveAsBase64() } });
    expect(created.status()).toBe(200);
    const invoice = await created.json() as { id: number };
    await payment(page, invoice.id, '40.00', '0');
    const before = await snapshot(userId, invoice.id);
    await page.goto('/dashboard/reminders');
    const record = page.getByRole(width < 1280 ? 'article' : 'row').filter({ hasText: invoiceNumber });
    await expect(record).toContainText('80,00');
    await record.getByRole('button', { name: 'Restbetrag prüfen', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Mahnung intern erfassen', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await snapshot(userId, invoice.id)).toEqual(before);
    await record.getByRole('button', { name: 'Restbetrag prüfen', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Aktuellen Restbetrag prüfen und Entwurf laden', exact: true }).click();
    await expect(dialog.getByRole('region', { name: 'Geprüfter Mahnentwurf', exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Geprüfter Zahlungsstand')).toContainText('120,00');
    await expect(dialog.getByLabel('Geprüfter Zahlungsstand')).toContainText('40,00');
    await expect(dialog.getByLabel('Geprüfter Zahlungsstand')).toContainText('80,00');
    await expect(dialog.getByRole('region', { name: 'Zahlungsverlauf', exact: true }).getByRole('listitem')).toHaveCount(1);
    await expect(dialog).not.toContainText('keinen Zahlungseingang');
    await dialog.getByRole('checkbox').check();
    const downloaded = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Textentwurf herunterladen', exact: true }).click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toMatch(/\.txt$/u);
    const local = await file.path(); expect(local).not.toBeNull();
    expect(await readFile(local!, 'utf8')).toContain('Zahlbetrag: 80,00 €');
    expect(await snapshot(userId, invoice.id)).toEqual(before);
    expect(emailRequests).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`confirmed-reminder-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // A genuine second fixture allocation invalidates the reviewed 80 EUR version.
    await payment(page, invoice.id, '10.00', '4000');
    const afterPayment = await snapshot(userId, invoice.id);
    const stale = page.waitForResponse(response => response.url().endsWith('/api/reminders/download') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Textentwurf herunterladen', exact: true }).click();
    expect((await stale).status()).toBe(409);
    await expect(dialog.getByRole('alert').filter({ hasText: 'Zahlungsstand hat sich geändert' })).toBeVisible();
    await expect(dialog.getByRole('region', { name: 'Geprüfter Mahnentwurf', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Mahnung intern erfassen', exact: true })).toBeDisabled();
    expect(await snapshot(userId, invoice.id)).toEqual(afterPayment);
    await dialog.getByRole('button', { name: 'Aktuellen Restbetrag prüfen und Entwurf laden', exact: true }).click();
    await expect(dialog.getByLabel('Geprüfter Zahlungsstand')).toContainText('70,00');
    await expect(dialog.getByRole('region', { name: 'Zahlungsverlauf', exact: true }).getByRole('listitem')).toHaveCount(2);
    await dialog.getByRole('checkbox').check();
    const recorded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/reminders' && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Mahnung intern erfassen', exact: true }).click();
    const response = await recorded; expect(response.status()).toBe(200);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const payload = response.request().postDataJSON();
    const replay = await page.request.post('/api/reminders', { data: payload });
    expect(replay.status()).toBe(200); expect((await replay.json()).replayed).toBe(true);
    const after = await snapshot(userId, invoice.id);
    expect(after.invoice).toEqual(afterPayment.invoice); expect(after.incomes).toEqual(afterPayment.incomes); expect(after.events).toEqual(afterPayment.events);
    expect(after.reminders).toHaveLength(1); expect(after.reminders[0].balanceSnapshot).toMatchObject({ openCents: '7000', paidCents: '5000', totalCents: '12000' });
    expect(emailRequests).toEqual([]);
    const audit = await prisma.auditLog.findMany({ where: { userId, entityType: 'Reminder', entityId: String(after.reminders[0].id), action: 'CREATE' } });
    expect(audit).toHaveLength(1);
    await testInfo.attach('reminder-balance-http-db-evidence.json', { body: Buffer.from(JSON.stringify({ before, afterPayment, after, emailRequests, audit }, null, 2)), contentType: 'application/json' });
  } finally { await prisma.$disconnect(); }
});
