import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';

test('HTTP-compatible invoice identity survives a lost save response without duplicate issuance', async ({ page }) => {
  test.setTimeout(90_000);
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  // Reproduce the API surface on an ordinary HTTP LAN origin. Chromium treats
  // the runner's loopback URL as secure, so remove only the unavailable API.
  await page.addInitScript(() => Object.defineProperty(window.crypto, 'randomUUID', { value: undefined, configurable: true }));
  const password = 'SyntheticHttpInvoiceOnly123!';
  const user = await prisma.user.create({ data: {
    email: `http-invoice-${randomUUID()}@example.test`, name: 'Synthetic HTTP invoice',
    password: await hashPassword(password), role: 'USER',
  } });
  await prisma.settings.create({ data: {
    userId: user.id, companyName: 'Synthetic HTTP issuer', companyAddress: 'Synthetic Road 1\n10115 Berlin',
    email: 'issuer@example.test', telephone: '+49 000 000', taxNumber: '123/456/78901',
    iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', bankName: 'Synthetic bank',
    fiscalTaxRegime: 'SMALL_BUSINESS', fiscalEffectiveFrom: '2020-01-01', fiscalConfirmedAt: new Date(),
  } });
  const alerts: string[] = [];
  let rejectUnexpected!: (error: Error) => void;
  const unexpectedDialog = new Promise<never>((_, reject) => { rejectUnexpected = reject; });
  void unexpectedDialog.catch(() => undefined);
  page.on('dialog', async dialog => {
    alerts.push(dialog.message());
    if (dialog.message() !== 'Speichern fehlgeschlagen: Synthetic lost response after committed save') rejectUnexpected(new Error(dialog.message()));
    await dialog.dismiss();
  });
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(user.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/u);
  await page.goto('/dashboard/invoices/new');
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');
  expect(await page.evaluate(() => typeof crypto.getRandomValues)).toBe('function');
  const fields = page.locator('fieldset[aria-label="Rechnungsangaben"]');
  await fields.locator('#customer').fill('Synthetic HTTP buyer\nBuyer Road 2\n10115 Berlin');
  await fields.locator('#invoice-buyer-email').fill('buyer@example.test');
  await fields.locator('#invoice-buyer-reference').fill('SYNTHETIC-HTTP');
  await fields.locator('#invoice-item-description-0').fill('Synthetic HTTP invoice service');
  await fields.locator('#invoice-item-price-0').fill('114');
  await fields.locator('#invoice-output-mode').selectOption('xml-only');
  await expect(fields.getByRole('button', { name: 'XML erstellen', exact: true })).toBeEnabled();

  const identities: string[] = [];
  const saved: Array<{ id: number; idempotent?: boolean }> = [];
  await page.route('**/api/invoices/upload', async route => {
    const request = route.request();
    const form = await new Request(request.url(), { method: 'POST', headers: request.headers(), body: request.postDataBuffer()! }).formData();
    const identity = form.get('generatedRequestId');
    expect(identity).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    identities.push(String(identity));
    expect(JSON.parse(String(form.get('paymentTermSelection'))).source).toBe('FALLBACK');
    const response = await route.fetch();
    expect(response.status(), await response.text()).toBe(200);
    saved.push(await response.json());
    if (saved.length === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic lost response after committed save' }) });
    } else {
      await route.fulfill({ response });
    }
  });

  const upload = () => page.waitForResponse(response => new URL(response.url()).pathname === '/api/invoices/upload');
  const first = upload();
  await fields.getByRole('button', { name: 'XML erstellen', exact: true }).click();
  expect((await Promise.race([first, unexpectedDialog])).status()).toBe(503);
  await expect.poll(() => alerts).toEqual(['Speichern fehlgeschlagen: Synthetic lost response after committed save']);
  const firstInvoice = await prisma.invoice.findFirstOrThrow({ where: { userId: user.id } });
  const counters = await prisma.invoiceNumberCounter.findMany({ where: { userId: user.id } });
  const retry = upload(), download = page.waitForEvent('download');
  await fields.getByRole('button', { name: 'XML erstellen', exact: true }).click();
  expect((await retry).status()).toBe(200);
  expect(await (await download).failure()).toBeNull();
  expect(identities).toHaveLength(2);
  expect(identities[1]).toBe(identities[0]);
  expect(saved[1]).toMatchObject({ id: firstInvoice.id, idempotent: true });
  expect(await prisma.invoice.count({ where: { userId: user.id } })).toBe(1);
  expect(await prisma.invoice.findUniqueOrThrow({ where: { id: firstInvoice.id } })).toEqual(firstInvoice);
  expect(await prisma.invoiceNumberCounter.findMany({ where: { userId: user.id } })).toEqual(counters);
  expect(await prisma.income.count({ where: { userId: user.id } })).toBe(0);
  expect(await prisma.paymentJournalEvent.count({ where: { userId: user.id } })).toBe(0);
  await prisma.$disconnect();
});
