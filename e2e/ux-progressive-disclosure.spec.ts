import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// Real rendered app, owned isolated runner DB, synthetic identity only. This
// journey never creates, sends, pays, deletes, exports or restores a document.
async function navigation(page: Page, width: number) {
  if (width < 1024) await page.getByRole('button', { name: 'Menü öffnen', exact: true }).click();
  const nav = page.getByRole('navigation', { name: width < 1024 ? 'Mobile Hauptnavigation' : 'Hauptnavigation', exact: true });
  await expect(nav).toBeVisible();
  return nav;
}
async function closeNavigation(page: Page, width: number) {
  if (width < 1024) {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Menü öffnen', exact: true })).toBeFocused();
  }
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('progressive UX keeps keyboard navigation, active history and setup/editor/handoff intent clear at desktop and mobile', async ({ page, baseURL }, info) => {
  test.setTimeout(120_000);
  expect(baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticProgressiveUx123!';
  const user = await prisma.user.create({ data: { email: `progressive-ux-${randomUUID()}@example.test`, name: 'SYNTHETISCH · UX', password: await hashPassword(password), role: 'USER' } });
  try {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(user.email);
    await page.getByLabel('Passwort', { exact: true }).fill(password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    const writes: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(`${request.method()} ${url.pathname}`);
    });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await page.goto('/dashboard');
      const setup = page.getByRole('region', { name: 'Einrichtung', exact: true });
      await expect(setup.getByText('Nächster Einrichtungsschritt', { exact: true })).toBeVisible();
      await expect(setup.getByRole('link', { name: 'Firmendaten ergänzen', exact: true })).toBeVisible();
      await expect(setup.locator('details')).not.toHaveAttribute('open', '');
      await expect(setup.getByRole('link')).toHaveCount(1);
      await setup.locator('summary').focus(); await page.keyboard.press('Enter');
      await expect(setup.getByRole('link', { name: 'Exportwege ansehen', exact: true })).toBeVisible();
      await setup.locator('summary').focus(); await page.keyboard.press('Enter');
      let nav = await navigation(page, width);
      await expect(nav.getByRole('link')).toHaveCount(10);
      await expect(nav.getByRole('link', { name: 'Rechnungshistorie', exact: true })).toHaveCount(0);
      const historySummary = nav.locator('summary').filter({ hasText: 'Historie und Mahnwesen' });
      const before = { url: page.url(), entries: await page.evaluate(() => history.length) };
      await historySummary.focus(); await page.keyboard.press('Enter');
      await expect(nav.getByRole('link', { name: 'Rechnungshistorie', exact: true })).toBeVisible();
      expect(page.url()).toBe(before.url); expect(await page.evaluate(() => history.length)).toBe(before.entries);
      await nav.getByRole('link', { name: 'Rechnungshistorie', exact: true }).focus(); await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/history$/);
      if (width < 1024) await expect(nav).toBeHidden();
      nav = await navigation(page, width);
      await expect(nav.getByRole('link', { name: 'Rechnungshistorie', exact: true })).toHaveAttribute('aria-current', 'page');
      await nav.getByRole('link', { name: 'Dashboard', exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await page.goBack(); await expect(page).toHaveURL(/\/history$/);
      nav = await navigation(page, width);
      await expect(nav.getByRole('link', { name: 'Rechnungshistorie', exact: true })).toHaveAttribute('aria-current', 'page');
      await closeNavigation(page, width);
      await page.goForward(); await expect(page).toHaveURL(/\/dashboard$/);
      if (width === 1440) {
        await page.getByRole('button', { name: 'Sidebar einklappen', exact: true }).click();
        await expect(nav.getByRole('link')).toHaveCount(15);
        await expect(nav.getByRole('link', { name: 'Mahnwesen', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Sidebar ausklappen', exact: true }).click();
      }
      await noOverflow(page);
      await page.screenshot({ path: info.outputPath(`progressive-setup-${width}.png`), fullPage: false, animations: 'disabled' });
      await page.goto('/dashboard/invoices/new');
      await expect(page.getByRole('heading', { name: 'Neue Rechnung', exact: true })).toBeVisible();
      nav = await navigation(page, width);
      await expect(nav.getByRole('link', { name: 'Rechnungen', exact: true })).toHaveAttribute('aria-current', 'page');
      await closeNavigation(page, width);
      const format = page.getByRole('combobox', { name: 'Rechnungsformat', exact: true });
      await expect(format).toHaveValue('zugferd-pdf');
      await expect(format.locator('option')).toHaveCount(2);
      await expect(format.locator('option[value="xml-only"]')).toHaveText('Nur XML (XRechnung)');
      await format.selectOption('xml-only');
      await expect(page.getByText('Für Empfänger, die eine XRechnung verlangen. E-Mail und Käuferreferenz sind erforderlich.', { exact: true })).toBeVisible();
      await expect(page.locator('#invoice-create-effect')).toContainText('nicht versendet. Es wird keine Zahlung erfasst.');
      await expect(page.getByRole('button', { name: 'XML erstellen', exact: true })).toBeDisabled();
      await format.selectOption('zugferd-pdf');
      await noOverflow(page);
      await page.goto('/purchases');
      await expect(page.getByRole('heading', { name: 'Belegeingang', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Beleg hinzufügen', exact: true })).toBeVisible();
      await expect(page.getByLabel('Aufgabenart filtern', { exact: true })).toBeHidden();
      const optionalFilters = page.locator('summary').filter({ hasText: /^Lieferantenaufgaben filtern$/ });
      await optionalFilters.focus(); await page.keyboard.press('Enter');
      await expect(page.getByLabel('Aufgabenart filtern', { exact: true })).toHaveValue('all');
      await optionalFilters.focus(); await page.keyboard.press('Enter');
      await page.goto('/settings#handoff-settings');
      await expect(page.getByRole('button', { name: 'Daten sichern (JSON)', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Daten und Dateien sichern (ZIP)', exact: true })).toBeVisible();
      const handoff = page.locator('#handoff-settings').getByRole('link', { name: 'Unterlagen übergeben', exact: true });
      await expect(handoff).toHaveAttribute('href', '/handoff');
      await handoff.click();
      await expect(page).toHaveURL(/\/handoff$/);
      await expect(page.getByRole('heading', { name: 'Für welchen Zeitraum?', exact: true })).toBeVisible();
      await expect(page.getByText('Zuerst die Vorschau prüfen. Ein Download oder Versand wird dadurch noch nicht gestartet.', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Vorschau laden', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'ZIP herunterladen', exact: true })).toHaveCount(0);
      await noOverflow(page);
    }
    expect(writes).toEqual([]);
    expect(await Promise.all([
      prisma.invoice.count({ where: { userId: user.id } }), prisma.expense.count({ where: { userId: user.id } }),
      prisma.income.count({ where: { userId: user.id } }), prisma.paymentJournalEvent.count({ where: { userId: user.id } }),
      prisma.emailOutbox.count({ where: { userId: user.id } }),
    ])).toEqual([0, 0, 0, 0, 0]);
  } finally { await prisma.$disconnect(); }
});
