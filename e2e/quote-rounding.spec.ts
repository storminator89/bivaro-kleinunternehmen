import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// Exact fresh hosted-runner fixture only, never a real customer/deployment.
// Two synthetic quotes, no invoice conversion, delivery or financial activity.
test.describe.configure({ mode: 'serial', retries: 0 });
test.use({ timezoneId: 'Europe/Berlin' });

async function pdfText(bytes: Buffer) {
  expect(bytes.byteLength).toBeLessThan(2 * 1024 * 1024);
  const task = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true, disableFontFace: true });
  try {
    const doc = await task.promise;
    expect(doc.numPages).toBe(1);
    const content = await (await doc.getPage(1)).getTextContent();
    return content.items.filter(item => 'str' in item).map(item => 'str' in item ? item.str : '').join(' ').replace(/\s+/gu, ' ').trim();
  } finally { await task.destroy(); }
}

async function checkQuote(page: Page, baseURL: string | undefined, rate: 0 | 19, gross: number) {
  // Check all refusal guards before creating any fixture record or file.
  expect(process.env.GITHUB_ACTIONS).toBe('true');
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  expect(baseURL).toBe('http://127.0.0.1:3100');
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticQuoteRounding230!';
  const user = await prisma.user.create({ data: { email: `quote-rounding-${randomUUID()}@example.test`, name: 'Synthetic quote rounding', password: await hashPassword(password), role: 'USER' } });
  const number = `SYNTHETIC-ROUND-230-${rate}`;
  await page.setViewportSize({ width: rate ? 390 : 1440, height: 1000 });
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(user.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  const settings = await page.request.post('/api/settings', { data: {
    companyName: 'Synthetic quotation audit', companyAddress: 'Testweg 1\n10115 Berlin',
    fiscalTaxRegime: rate ? 'STANDARD' : 'SMALL_BUSINESS', fiscalEffectiveFrom: '2020-01-01',
  } });
  expect(settings.ok(), await settings.text()).toBe(true);
  await page.goto('/dashboard/quotes/new');
  await expect(page.locator('#quote-item-0-tax')).toHaveValue(String(rate));
  await page.getByLabel('Empfänger (Name & Anschrift)', { exact: true }).fill('Synthetic recipient only\nTestweg 2\n10115 Berlin');
  await page.getByLabel('Angebotsnummer', { exact: true }).fill(number);
  await page.locator('#quote-item-0-description').fill('Synthetic half hour');
  await page.locator('#quote-item-0-unit').selectOption('Stunde');
  await page.locator('#quote-item-0-quantity').fill('0.5');
  await page.locator('#quote-item-0-unit-price').fill('10.01');
  await page.getByRole('button', { name: 'Position 1 duplizieren', exact: true }).click();
  await expect(page.locator('#quote-item-1-quantity')).toHaveValue('0.5');
  await expect(page.locator('#quote-item-1-unit-price')).toHaveValue('10.01');
  const expectedGross = `${gross.toFixed(2).replace('.', ',')} €`;
  const overview = page.getByRole('complementary', { name: 'Angebotsübersicht' });
  await expect(overview).toContainText(expectedGross);
  await expect(overview).toContainText('10,02 €');
  for (const index of [0, 1]) await expect(page.locator('fieldset').filter({ has: page.locator(`#quote-item-${index}-quantity`) })).toContainText('5,01 €');
  expect(await prisma.invoice.count({ where: { userId: user.id } })).toBe(0);
  expect(await prisma.customer.count({ where: { userId: user.id } })).toBe(0);

  const [response, download] = await Promise.all([
    page.waitForResponse(value => new URL(value.url()).pathname === '/api/quotes' && value.request().method() === 'POST'),
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Angebot erstellen & speichern', exact: true }).click(),
  ]);
  expect(response.ok(), await response.text()).toBe(true);
  const receipt = await response.json();
  expect(Number.isSafeInteger(receipt.id)).toBe(true);
  expect(receipt.totalAmount).toBe(gross);
  expect(download.suggestedFilename()).toBe(`Angebot_${number}.pdf`);
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  const bytes = await readFile(downloadedPath!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const visible = await pdfText(bytes);
  expect(visible).toContain(`Angebotssumme: ${expectedGross}`);
  expect(visible).toContain('Netto: 10,02 €');
  expect(visible).toContain(rate ? 'zzgl. USt.: 1,90 €' : 'zzgl. USt. 0%: 0,00 €');
  const row = await prisma.invoice.findFirstOrThrow({ where: { id: receipt.id, userId: user.id } });
  expect(row.type).toBe('QUOTE'); expect(row.totalAmount).toBe(gross);
  const data = row.parsedData as { totalAmount?: number; items?: unknown[] };
  expect(data.totalAmount).toBe(gross); expect(data.items).toHaveLength(2);
  const original = await page.request.get(`/api/quotes/download?id=${receipt.id}&download=true`);
  expect(original.ok()).toBe(true); expect((await original.body()).equals(bytes)).toBe(true);

  await page.goto('/dashboard?tab=quotes'); await page.reload();
  const list = await page.request.get(`/api/quotes?search=${encodeURIComponent(number)}`);
  expect(list.ok()).toBe(true);
  expect((await list.json()).items).toEqual([expect.objectContaining({ id: receipt.id, type: 'QUOTE', totalAmount: gross })]);
  expect(await prisma.invoice.count({ where: { userId: user.id, type: 'QUOTE' } })).toBe(1);
  expect(await prisma.invoice.count({ where: { userId: user.id, type: 'INVOICE' } })).toBe(0);
  expect(await prisma.income.count({ where: { userId: user.id } })).toBe(0);
  expect(await prisma.expense.count({ where: { userId: user.id } })).toBe(0);
  expect(await prisma.paymentJournalEvent.count({ where: { userId: user.id } })).toBe(0);
  expect(await prisma.emailOutbox.count({ where: { userId: user.id } })).toBe(0);
  expect(await prisma.reminder.count({ where: { userId: user.id } })).toBe(0);
  expect(await prisma.customer.count({ where: { userId: user.id } })).toBe(0);
}

test('zero-tax half-cent quote keeps displayed, saved and downloaded PDF totals at 10.02 EUR', async ({ page, baseURL }) => {
  await checkQuote(page, baseURL, 0, 10.02);
});

test('19-percent half-cent quote keeps displayed, saved and downloaded PDF totals at 11.92 EUR', async ({ page, baseURL }) => {
  await checkQuote(page, baseURL, 19, 11.92);
});
