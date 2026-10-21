import { expect, test, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';

async function expectUnobscuredBasis(node: Locator) {
  await expect.poll(() => node.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const header = [...window.document.querySelectorAll<HTMLElement>('.app-topbar')].find(item => {
      const rect = item.getBoundingClientRect();
      return item.getClientRects().length > 0 && rect.width > 0 && rect.height > 0;
    });
    if (!header) return false;
    const headerBottom = header.getBoundingClientRect().bottom;
    if (rect.width <= 0 || rect.height <= 0 || rect.top < headerBottom + 8 || rect.bottom > window.innerHeight - 8 || rect.left < 0 || rect.right > window.innerWidth) return false;
    const points = [[rect.left + 1, rect.top + 1], [rect.right - 1, rect.top + 1], [rect.left + 1, rect.bottom - 1], [rect.right - 1, rect.bottom - 1], [rect.left + rect.width / 2, rect.top + rect.height / 2]];
    return points.every(([x, y]) => {
      const hit = window.document.elementFromPoint(x, y);
      return hit !== null && (hit === element || element.contains(hit));
    });
  })).toBe(true);
}

// Authored for the isolated hosted acceptance runner; never production data.
// Do not run a native local browser/build for this work package.
test('revenue indicators preserve unknown/zero, included external share, corrections and financial data', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const year = new Date().getFullYear();
  const password = 'SyntheticRevenueBasis123!';
  const user = await prisma.user.create({ data: { email: `revenue-${randomUUID()}@example.test`, password: await hashPassword(password), name: 'Synthetic revenue basis' } });
  await prisma.income.createMany({ data: [
    { userId: user.id, description: 'Synthetic current receipt', amount: 1234.56, date: new Date(year, 0, 1, 12) },
    { userId: user.id, description: 'Synthetic prior receipt', amount: 12000, date: new Date(year - 1, 0, 1, 12) },
  ] });
  const financialSnapshot = async () => ({ settings: await prisma.settings.findMany({ where: { userId: user.id } }), incomes: await prisma.income.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } }), expenses: await prisma.expense.findMany({ where: { userId: user.id } }), invoices: await prisma.invoice.findMany({ where: { userId: user.id } }), payments: await prisma.paymentJournalEvent.findMany({ where: { userId: user.id } }) });
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(user.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  const before = await financialSnapshot();
  const panel = page.getByRole('region', { name: `Umsatzdatenbasis ${year}`, exact: true });
  const disclosure = page.getByText(`Umsatzindikatoren · ${year}`, { exact: true }).locator('..');
  await expect(panel).toBeHidden();
  await disclosure.focus(); await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Keine zum angezeigten Zeitraum gültige eigene Erklärung');
  await expect(panel).toContainText('Gesamtumsatz des Unternehmens');
  await expect(panel).toContainText('Unbekannt');
  await expect(panel).toContainText('1.234,56');
  await expect(page.getByText('Sofort steuerpflichtig!', { exact: true })).toHaveCount(0);
  await disclosure.focus(); await page.keyboard.press('Enter');
  await expect(panel).toBeHidden();
  await page.keyboard.press('Enter'); await expect(panel).toBeVisible();
  await panel.getByRole('link', { name: 'Jahreskontext prüfen', exact: true }).click();
  await expect(page).toHaveURL(/\/settings#annual-context/);
  const section = page.locator('#annual-context');
  await section.getByRole('button', { name: 'Jahreskontext öffnen', exact: true }).click();
  await expect(section.getByLabel('Kontextjahr', { exact: true })).toBeEnabled();
  await section.getByLabel('Gründungsjahr · leer = unbekannt', { exact: true }).fill(String(year - 2));
  await section.getByLabel('Davon außerhalb Bivaro erfasst (EUR)', { exact: true }).fill('0');
  await section.getByLabel('Von mir erklärter Datenstand', { exact: true }).selectOption('PARTIAL');
  await section.getByLabel('Quelle Ihrer Angaben', { exact: true }).fill('Synthetic own prior-year source');
  await section.getByRole('checkbox', { name: /Ich erkläre diese Angaben/ }).check();
  await section.getByRole('button', { name: 'Kontextrevision speichern', exact: true }).click();
  await expect(section.getByRole('status')).toContainText('Revision 1 gespeichert');
  await page.goto('/dashboard');
  await disclosure.click();
  await expect(panel).toContainText('Teilweise selbst erklärt');
  await expect(panel).toContainText('Davon außerhalb Bivaro: 0,00 €');
  await expect(panel).toContainText('Revision 1');
  await expect(panel).toContainText('Unbekannt');
  await panel.getByRole('link', { name: 'Jahreskontext prüfen', exact: true }).click();
  await section.getByRole('button', { name: 'Jahreskontext öffnen', exact: true }).click();
  await section.getByLabel('Gesamtumsatz im Vorjahr (EUR)', { exact: true }).fill('24000');
  await section.getByLabel('Davon außerhalb Bivaro erfasst (EUR)', { exact: true }).fill('10000');
  await section.getByLabel('Von mir erklärter Datenstand', { exact: true }).selectOption('COMPLETE');
  await section.getByRole('checkbox', { name: /Ich erkläre diese Angaben/ }).check();
  await section.getByRole('button', { name: 'Kontextrevision speichern', exact: true }).click();
  await expect(section.getByRole('status')).toContainText('Revision 2 gespeichert');
  // Back is read-only; reload establishes that the latest saved revision wins.
  await page.goBack(); await page.reload();
  await disclosure.click();
  await expect(panel).toContainText('Revision 2');
  await expect(panel).toContainText('Als vollständig selbst erklärt');
  await expect(panel).toContainText('24.000,00');
  await expect(panel).not.toContainText('34.000,00');
  await expect(panel).toContainText(`Außerhalb Bivaro erfasste Umsätze ${year}: unbekannt`);
  // The historical selector is still a chart-only control, not a tax-context editor.
  await page.getByLabel('Vergleichsjahr', { exact: true }).selectOption(String(year - 1));
  await expect(page.getByRole('heading', { name: 'Jahresvergleich', exact: true })).toBeVisible();
  await expect(panel).toContainText(`Vorjahr ${year - 1}`);
  await expect(panel).toContainText('Revision 2');
  for (const width of [360, 390, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await expect(page.locator('.app-topbar:visible')).toHaveCount(1);
    const link = panel.getByRole('link', { name: 'Jahreskontext prüfen', exact: true });
    await link.scrollIntoViewIfNeeded();
    await link.focus(); await expect(link).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(link).toBeInViewport();
    const declaration = panel.getByText(`Gründungsjahr: ${year - 2} · Quelle: Synthetic own prior-year source`, { exact: true });
    await declaration.scrollIntoViewIfNeeded();
    await expect(declaration).toBeInViewport();
    // Check the complete basis by scrolling; a viewport image is not a full-form claim.
    for (const term of await panel.locator('dt').all()) {
      await term.scrollIntoViewIfNeeded();
      await expect(term).toBeInViewport();
    }
    const currentBasis = panel.locator('dl > div').first();
    await currentBasis.evaluate(node => {
      const header = [...window.document.querySelectorAll<HTMLElement>('.app-topbar')].find(item => {
        const rect = item.getBoundingClientRect();
        return item.getClientRects().length > 0 && rect.width > 0 && rect.height > 0;
      });
      if (!header) throw new Error('Expected visible application header');
      const headerBottom = header.getBoundingClientRect().bottom;
      window.scrollTo({ top: window.scrollY + node.getBoundingClientRect().top - headerBottom - 24, behavior: 'instant' });
    });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const currentLabel = currentBasis.locator('dt');
    const currentAmount = currentBasis.locator('dd').first();
    await expect(currentLabel).toHaveText(`Operativer Zahlungssaldo in Bivaro · ${year}`);
    await expect(currentAmount).toHaveText('1.234,56 €');
    await expectUnobscuredBasis(currentLabel);
    await expectUnobscuredBasis(currentAmount);
    if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`revenue-indicators-amounts-${width}.png`), fullPage: false });
  }
  await page.goto('/steuer-simulation');
  await page.getByText('Datenbasis und Grenzen', { exact: true }).click();
  await expect(page.getByText('Nur In-App-Buchungen;', { exact: false })).toBeVisible();
  await expect(page.getByText('Kleinunternehmerstatus ungeprüft.', { exact: false })).toBeVisible();
  expect(await financialSnapshot()).toEqual(before);
  expect(await prisma.annualBusinessContextRevision.count({ where: { userId: user.id } })).toBe(2);
});
