import { expect, test, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../lib/password';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';
import { serviceArticleNameKey } from '../lib/service-articles';

// Hosted-only acceptance source: real editor controls/authentication, bounded
// real fixture catalogue reads, no persisted documents/plans/financial mutations.
const name = 'SYNTHETIC catalogue freshness';
const prices = (cents: string) => ({ unitPriceCents: cents, sourcePriceCents: cents });
type Owner = { id: string; role: string; sessionVersion: number };
async function documentSession(page: Page, destination: string, navigate: () => Promise<unknown>, owner?: Owner) {
  const session = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/auth/session'
    && new URL(page.url()).pathname === destination);
  await navigate();
  const response = await session;
  expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
  const body = await response.json();
  expect(body.user ? { id: body.user.id, role: body.user.role, sessionVersion: body.user.sessionVersion } : undefined).toEqual(owner);
  // The next fixture navigation must not cancel this document's auth fetch.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function signIn(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticCatalogFresh168!';
  const user = await prisma.user.create({ data: { email: `catalog-fresh-${randomUUID()}@example.test`,
    name: 'Synthetic catalogue freshness', password: await hashPassword(password), role: 'USER' } });
  await documentSession(page, '/login', () => page.goto('/login')); await page.getByLabel('E-Mail').fill(user.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await documentSession(page, '/dashboard', () => page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click(),
    { id: user.id, role: user.role, sessionVersion: user.sessionVersion });
  await expect(page).toHaveURL(/\/dashboard/);
  return user;
}

for (const editor of ['invoice', 'quote', 'service-plan'] as const) {
  test(`${editor} accepts only a fresh current catalogue after reopen, canceled reads and error retry`, async ({ page }) => {
    test.setTimeout(90_000);
    const user = await signIn(page);
    let release!: () => void, arrived!: () => void, complete!: () => void;
    const held = new Promise<void>(resolve => { arrived = resolve; });
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const oldDone = new Promise<void>(resolve => { complete = resolve; });
    let oldRequest: import('@playwright/test').Request | undefined;
    let retired = false, reads = 0;
    const unexpectedWrites: string[] = [];
    try {
      const article = await prisma.serviceArticle.create({ data: { userId: user.id, name, nameKey: serviceArticleNameKey(name),
        description: 'SYNTHETIC fresh service line', unit: 'Stunde', ...prices('10000'), sourcePriceBasis: 'NET', taxRate: '19' } });
      await page.route('**/api/**', async route => {
        if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
        unexpectedWrites.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
        await route.abort('blockedbyclient');
      });
      await page.route('**/api/service-articles', async route => {
        reads += 1;
        if (reads === 4) return route.fulfill({ status: 503, json: { error: 'Synthetic catalogue read interruption' } });
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        const expectedPrice = reads === 1 ? '10000' : reads === 2 ? '25000' : reads === 3 ? '35000' : '45000';
        expect(await response.json()).toEqual([expect.objectContaining({ id: article.id, name, ...prices(expectedPrice), taxRate: '19' })]);
        if (reads === 2) {
          oldRequest = route.request(); arrived();
          try {
            await waiting;
            if (retired) await route.abort('aborted').catch(() => {});
            else await route.fulfill({ response });
          } finally { complete(); }
        } else await route.fulfill({ response });
      });
      let surface: Locator;
      const owner = { id: user.id, role: user.role, sessionVersion: user.sessionVersion };
      if (editor === 'service-plan') {
        await documentSession(page, '/service-billing', () => page.goto('/service-billing'), owner);
        await page.getByRole('button', { name: 'Ersten Serviceplan anlegen', exact: true }).click();
        surface = page.getByRole('dialog', { name: 'Neuer Serviceplan', exact: true });
        await surface.getByLabel('Umsatzsteuer', { exact: true }).selectOption('small-business');
      } else {
        const destination = editor === 'invoice' ? '/dashboard/invoices/new' : '/dashboard/quotes/new';
        await documentSession(page, destination, () => page.goto(destination), owner);
        surface = page.getByRole('main');
      }
      const price = (index: number) => surface.locator(editor === 'invoice' ? `#invoice-item-price-${index}`
        : editor === 'quote' ? `#quote-item-${index}-unit-price` : `#service-line-price-${index}`);
      const tax = (index: number) => surface.locator(editor === 'invoice' ? `#invoice-item-tax-${index}`
        : editor === 'quote' ? `#quote-item-${index}-tax` : `#service-line-tax-${index}`);
      const toggle = surface.getByRole('button', { name: 'Aus Artikelkatalog übernehmen', exact: true });
      const picker = toggle.locator('..');
      const select = picker.getByRole('button', { name: `${name} als Position übernehmen`, exact: true });
      await toggle.click(); await select.click();
      await expect(price(0)).toHaveValue(editor === 'service-plan' ? '100.00' : '100');
      await expect(tax(0)).toHaveValue('0');
      await prisma.serviceArticle.update({ where: { id: article.id }, data: prices('25000') });
      await toggle.click(); await held;
      await expect(picker.getByRole('status')).toContainText('Katalog wird geladen');
      await expect(select).toHaveCount(0);
      await expect(price(0)).toHaveValue(editor === 'service-plan' ? '100.00' : '100');
      const canceled = page.waitForEvent('requestfailed', { predicate: request => request === oldRequest });
      retired = true; await toggle.click(); await canceled;
      await prisma.serviceArticle.update({ where: { id: article.id }, data: prices('35000') });
      await toggle.click();
      await expect(select).toBeVisible();
      await expect(picker).toContainText('350,00 €');
      release(); await oldDone;
      await expect(picker).not.toContainText('250,00 €');
      await select.click();
      await expect(price(1)).toHaveValue(editor === 'service-plan' ? '350.00' : '350');
      await expect(tax(1)).toHaveValue('0');
      await toggle.click();
      await expect(picker.getByRole('alert')).toContainText('Frühere Preise können nicht übernommen werden');
      await expect(select).toHaveCount(0);
      await expect(price(1)).toHaveValue(editor === 'service-plan' ? '350.00' : '350');
      await prisma.serviceArticle.update({ where: { id: article.id }, data: prices('45000') });
      await picker.getByRole('button', { name: 'Katalog erneut laden', exact: true }).click();
      await expect(select).toBeVisible(); await expect(picker).toContainText('450,00 €');
      await select.click();
      await expect(price(2)).toHaveValue(editor === 'service-plan' ? '450.00' : '450');
      await expect(tax(2)).toHaveValue('0');
      expect(reads).toBe(5); expect(unexpectedWrites).toEqual([]);
      expect(await prisma.invoice.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.income.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.expense.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.serviceBillingPlan.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.serviceArticle.findMany({ where: { userId: user.id } })).toEqual([
        expect.objectContaining({ id: article.id, ...prices('45000'), taxRate: '19' }),
      ]);
    } finally { release(); await prisma.user.delete({ where: { id: user.id } }); }
  });
}
