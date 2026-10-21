import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';

function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
async function fixture(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const password = 'SyntheticInterruption123!', email = `interruption-${randomUUID()}@example.test`;
  const user = await prisma.user.create({ data: { email, password: await hashPassword(password), name: 'Synthetic interruption' } });
  await page.goto('/login'); await page.getByLabel('E-Mail').fill(email); await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click(); await expect(page).toHaveURL(/\/dashboard/);
  const pdf = await PDFDocument.create(); pdf.addPage();
  const created = await page.request.post('/api/invoices', { data: { fileName: 'synthetic-interruption.pdf', invoiceNumber: 'SYNTHETIC-INTERRUPTION', totalAmount: 100, invoiceDate: '2026-10-20',
    parsedData: { items: [{ description: 'Synthetic service', quantity: 1, unitPrice: 100, amount: 100, taxRate: 0 }], taxMode: 'small-business' }, pdfBytes: await pdf.saveAsBase64() } });
  expect(created.status()).toBe(200); const invoiceId = (await created.json()).id as number;
  expect((await page.request.put('/api/invoices', { data: { id: invoiceId, status: 'SENT' } })).status()).toBe(200);
  const paid = await page.request.post(`/api/invoices/${invoiceId}/payments`, { data: { amount: '40.00', currency: 'EUR', paidAt: '2026-10-20', expectedPaidCents: '0', source: 'MANUAL', reference: 'Synthetic interruption payment', idempotencyKey: randomUUID() } }); expect(paid.status()).toBe(201);
  return { userId: user.id, invoiceId };
}
async function snapshot(userId: string, invoiceId: number) {
  return { invoice: await prisma.invoice.findFirst({ where: { userId, id: invoiceId } }), credits: await prisma.invoice.findMany({ where: { userId, originalInvoiceId: invoiceId } }), counters: await prisma.invoiceNumberCounter.findMany({ where: { userId } }), payments: await prisma.paymentJournalEvent.findMany({ where: { userId, invoiceId } }), incomes: await prisma.income.findMany({ where: { userId, invoiceId } }), auditCount: await prisma.auditLog.count({ where: { userId } }) };
}
async function modal(page: Page) {
  await page.goto('/dashboard?tab=invoices'); const row = page.getByRole('row').filter({ hasText: 'SYNTHETIC-INTERRUPTION' });
  await row.getByRole('button', { name: /Weitere Aktionen/ }).click(); await page.getByRole('menuitem', { name: 'Rechnung stornieren', exact: true }).click();
  return page.getByRole('dialog', { name: 'Rechnung stornieren', exact: true });
}
async function assertLocked(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Rechnung stornieren', exact: true });
  await expect(dialog).toHaveAttribute('aria-busy', 'true');
  await expect(dialog.getByRole('status')).toContainText('Schließen würde den Auftrag nicht zurücknehmen');
  await expect(dialog.getByRole('button', { name: 'Schließen', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Abbrechen', exact: true })).toBeDisabled();
  await expect(dialog.getByLabel(/Stornierungsgrund/)).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  await page.mouse.click(4, 4); await expect(dialog).toBeVisible();
}

test('keeps a confirmed cancellation visible while its already-committed response is delayed', async ({ page }) => {
  test.setTimeout(90_000); const { userId, invoiceId } = await fixture(page), delivery = deferred(), completed = deferred();
  let calls = 0, serverStatus = 0;
  try {
    const originalBytes = await (await page.request.get(`/api/invoices/download?id=${invoiceId}&download=true`)).body();
    const before = await snapshot(userId, invoiceId);
    const preview = await modal(page); await preview.getByRole('button', { name: 'Abbrechen', exact: true }).click(); await expect(preview).toHaveCount(0); expect(await snapshot(userId, invoiceId)).toEqual(before);
    await page.route('**/api/invoices/cancel', async route => { calls++; const response = await route.fetch(); serverStatus = response.status(); completed.release(); await delivery.promise; await route.fulfill({ response }); });
    const dialog = await modal(page); await dialog.getByLabel(/Stornierungsgrund/).fill('Synthetic delayed confirmed correction');
    await dialog.getByRole('button', { name: 'Rechnung stornieren', exact: true }).click();
    await completed.promise; expect(serverStatus).toBe(200); await assertLocked(page);
    const committed = await snapshot(userId, invoiceId); expect(committed.credits).toHaveLength(1); expect(committed.payments).toEqual(before.payments); expect(committed.incomes).toEqual(before.incomes);
    const delivered = page.waitForResponse(response => response.url().endsWith('/api/invoices/cancel') && response.request().method() === 'POST'); delivery.release(); expect((await delivered).status()).toBe(200);
    await expect(dialog).toHaveCount(0); expect(calls).toBe(1);
    expect(await snapshot(userId, invoiceId)).toEqual(committed);
    expect(await (await page.request.get(`/api/invoices/download?id=${invoiceId}&download=true`)).body()).toEqual(originalBytes);
    await page.goto(`/history?invoiceId=${invoiceId}`); await expect(page.getByRole('list', { name: 'Dokumentbeziehungen' }).getByRole('listitem')).toHaveCount(2);
    await expect(page.getByText('Storno bedeutet nicht zurückgezahlt.', { exact: true })).toBeVisible();
  } finally { delivery.release(); await page.unroute('**/api/invoices/cancel'); await prisma.$disconnect(); }
});

test('unlocks ordinary dismissal after a terminal server rejection without financial side effects', async ({ page }) => {
  test.setTimeout(90_000); const { userId, invoiceId } = await fixture(page), delivery = deferred(), received = deferred();
  try {
    const before = await snapshot(userId, invoiceId);
    await page.route('**/api/invoices/cancel', async route => { received.release(); await delivery.promise; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic rejection before write' }) }); });
    const dialog = await modal(page); await dialog.getByLabel(/Stornierungsgrund/).fill('Synthetic rejected correction'); await dialog.getByRole('button', { name: 'Rechnung stornieren', exact: true }).click(); await received.promise;
    await assertLocked(page); expect(await snapshot(userId, invoiceId)).toEqual(before);
    delivery.release(); await expect(dialog.getByRole('alert')).toContainText('Synthetic rejection before write');
    await expect(dialog).toHaveAttribute('aria-busy', 'false'); await expect(dialog.getByRole('button', { name: 'Schließen', exact: true })).toBeVisible();
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); expect(await snapshot(userId, invoiceId)).toEqual(before);
    const reopened = await modal(page); await expect(reopened.getByLabel(/Stornierungsgrund/)).toHaveValue(''); await reopened.getByRole('button', { name: 'Abbrechen', exact: true }).click(); expect(await snapshot(userId, invoiceId)).toEqual(before);
  } finally { delivery.release(); await page.unroute('**/api/invoices/cancel'); await prisma.$disconnect(); }
});
