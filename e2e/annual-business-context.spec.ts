import { expect, test, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';

// Hosted browser acceptance only; no real data or production tenant.
test('optional annual context preserves unknown/zero, corrections, conflict, dirty/back/reload and historical documents', async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const password = 'SyntheticAnnualContext123!';
  const user = await prisma.user.create({ data: { email: `annual-${randomUUID()}@example.test`, password: await hashPassword(password), name: 'Synthetic annual context' } });
  const invoice = await prisma.invoice.create({ data: { userId: user.id, fileName: 'synthetic-original.pdf', storedFileName: 'synthetic-original.pdf', issuanceState: 'ISSUED', status: 'SENT', totalAmount: 12.34, parsedData: { rawXML: '<SyntheticOriginal tax="unchanged"/>' } } });
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(user.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  const settingsBefore = await (await page.request.get('/api/settings')).json();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/settings');
  const section = page.locator('#annual-context');
  await expect(section.getByRole('button', { name: 'Jahreskontext öffnen', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(section.getByLabel('Kontextjahr', { exact: true })).toHaveCount(0);
  await section.getByRole('button', { name: 'Jahreskontext öffnen', exact: true }).focus();
  await page.keyboard.press('Enter');
  const year = new Date().getUTCFullYear();
  await expect(section.getByLabel('Kontextjahr', { exact: true })).toBeEnabled();
  await section.getByLabel('Gründungsjahr · leer = unbekannt', { exact: true }).fill(String(year - 2));
  await section.getByLabel('Davon außerhalb Bivaro erfasst (EUR)', { exact: true }).fill('0');
  await section.getByLabel('Quelle Ihrer Angaben', { exact: true }).fill('Synthetic own prior-year statement');
  await section.getByLabel('Von mir erklärter Datenstand', { exact: true }).selectOption('COMPLETE');
  await section.getByRole('checkbox', { name: /Ich erkläre diese Angaben/ }).check();
  await section.getByRole('button', { name: 'Kontextrevision speichern', exact: true }).click();
  await expect(section.getByRole('alert')).toContainText('Nicht gespeichert');
  await expect(section.getByRole('alert')).toBeFocused();
  expect(await prisma.annualBusinessContextRevision.count({ where: { userId: user.id } })).toBe(0);
  await section.getByLabel('Von mir erklärter Datenstand', { exact: true }).selectOption('PARTIAL');
  // Network failure must not claim success, and reload-latest keeps typed values.
  await page.route('**/api/settings/annual-context', route => route.request().method() === 'POST' ? route.abort('failed') : route.continue(), { times: 1 });
  await section.getByRole('checkbox', { name: /Ich erkläre diese Angaben/ }).check();
  await section.getByRole('button', { name: 'Kontextrevision speichern', exact: true }).click();
  await expect(section.getByRole('alert')).toContainText('Speicherung nicht bestätigt');
  await expect(section.getByLabel('Quelle Ihrer Angaben', { exact: true })).toHaveValue('Synthetic own prior-year statement');
  await section.getByRole('button', { name: 'Neueren Stand laden · Eingaben behalten', exact: true }).click();
  await expect(section.getByRole('button', { name: 'Kontextrevision speichern', exact: true })).toBeEnabled();
  await section.getByRole('checkbox', { name: /Ich erkläre diese Angaben/ }).check();
  await section.getByRole('button', { name: 'Kontextrevision speichern', exact: true }).click();
  await expect(section.getByRole('status')).toContainText('Revision 1 gespeichert');
  expect(await prisma.annualBusinessContextRevision.findFirst({ where: { userId: user.id } })).toMatchObject({ previousYearTurnoverCents: null, previousYearExternalTurnoverCents: '0', completeness: 'PARTIAL' });
  await section.getByLabel('Quelle Ihrer Angaben', { exact: true }).fill('Unsaved synthetic change');
  page.once('dialog', dialog => dialog.dismiss());
  await section.getByRole('button', { name: 'Jahreskontext schließen', exact: true }).click();
  await expect(section.getByLabel('Quelle Ihrer Angaben', { exact: true })).toHaveValue('Unsaved synthetic change');
  await section.getByRole('button', { name: 'Kontext verwerfen', exact: true }).click();
  await expect(section.getByLabel('Quelle Ihrer Angaben', { exact: true })).toHaveValue('Synthetic own prior-year statement');
  const second = await context.newPage();
  await second.goto('/settings');
  await second.getByRole('button', { name: 'Jahreskontext öffnen', exact: true }).click();
  const other = second.locator('#annual-context');
  await expect(other.getByLabel('Quelle Ihrer Angaben', { exact: true })).toHaveValue('Synthetic own prior-year statement');
  await section.getByLabel('Gesamtumsatz im Vorjahr (EUR)', { exact: true }).fill('10,00');
  await section.getByRole('checkbox', { name: /Ich erkläre diese Angaben/ }).check();
  await section.getByRole('button', { name: 'Kontextrevision speichern', exact: true }).click();
  await expect(section.getByRole('status')).toContainText('Revision 2 gespeichert');
  await other.getByLabel('Quelle Ihrer Angaben', { exact: true }).fill('Stale tab correction');
  await other.getByRole('checkbox', { name: /Ich erkläre diese Angaben/ }).check();
  await other.getByRole('button', { name: 'Kontextrevision speichern', exact: true }).click();
  await expect(other.getByRole('alert')).toContainText('neuere Revision');
  await expect(other.getByLabel('Quelle Ihrer Angaben', { exact: true })).toHaveValue('Stale tab correction');
  await expect(other.getByRole('button', { name: 'Kontextrevision speichern', exact: true })).toBeDisabled();
  await second.close();
  await page.reload();
  await section.getByRole('button', { name: 'Jahreskontext öffnen', exact: true }).click();
  await expect(section.getByLabel('Gesamtumsatz im Vorjahr (EUR)', { exact: true })).toHaveValue('10.00');
  await section.getByText(`Versionsverlauf für ${year} (2)`, { exact: true }).click();
  await expect(section.getByText(/Revision 1 · Kontext gültig/)).toBeVisible();
  await expect(section.getByText(/Revision 2 · Kontext gültig/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Inspect normal viewport geometry, not a tall element capture: the latter
  // can composite the sticky global header across unrelated section content.
  // Keep the real header, styles and 390x844 / 1440x1000 viewports unchanged.
  const unobscuredInViewport = (target: Locator) => target.evaluate(node => {
    const header = [...document.querySelectorAll<HTMLElement>('.app-topbar')].find(item => item.getClientRects().length > 0);
    if (!header) return false;
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return rect.top >= header.getBoundingClientRect().bottom + 8
      && rect.bottom <= window.innerHeight - 8 && rect.left >= 0 && rect.right <= window.innerWidth
      && hit !== null && (hit === node || node.contains(hit));
  });
  const alignBelowHeader = async (target: Locator) => {
    await target.evaluate(node => {
      const header = [...document.querySelectorAll<HTMLElement>('.app-topbar')].find(item => item.getClientRects().length > 0);
      if (!header) throw new Error('Visible application header is required for viewport evidence');
      window.scrollBy({ top: node.getBoundingClientRect().top - header.getBoundingClientRect().bottom - 16, behavior: 'instant' });
    });
    await expect.poll(() => unobscuredInViewport(target)).toBe(true);
  };
  const captureAnnualViewport = async (name: string) => {
    await expect(page.locator('.app-topbar:visible')).toHaveCount(1);
    // Every editable annual field must be normally reachable below the header;
    // no overlays are hidden and no values, layout or application CSS change.
    for (const id of ['annual-year', 'annual-effective', 'annual-founding', 'annual-turnover', 'annual-external', 'annual-completeness', 'annual-source']) {
      await alignBelowHeader(section.locator(`#${id}`));
    }
    await alignBelowHeader(section.getByRole('heading', { name: 'Jahreskontext (optional)', exact: true }));
    for (const id of ['annual-year', 'annual-effective', 'annual-founding']) {
      await expect.poll(() => unobscuredInViewport(section.locator(`#${id}`))).toBe(true);
    }
    // One honest viewport per size, not a stitched claim that the entire long
    // revision form fits on a phone. Functional history assertions stay above.
    await page.screenshot({ path: testInfo.outputPath(name), animations: 'disabled' });
  };
  await captureAnnualViewport('annual-context-mobile.png');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await captureAnnualViewport('annual-context-desktop.png');
  await page.goto('/dashboard');
  await page.goBack();
  await expect(section.getByRole('heading', { name: 'Jahreskontext (optional)', exact: true })).toBeVisible();
  if (await section.getByRole('button', { name: 'Jahreskontext öffnen', exact: true }).count()) await section.getByRole('button', { name: 'Jahreskontext öffnen', exact: true }).click();
  await expect(section.getByLabel('Gesamtumsatz im Vorjahr (EUR)', { exact: true })).toHaveValue('10.00');
  expect(await (await page.request.get('/api/settings')).json()).toEqual(settingsBefore);
  expect(await prisma.invoice.findUnique({ where: { id: invoice.id } })).toEqual(invoice);
  const backup = await (await page.request.get('/api/backup')).json();
  expect(backup.data.annualBusinessContextRevisions).toHaveLength(2);
  expect(backup.data.annualBusinessContextRevisions[0]).toMatchObject({ previousYearTurnoverCents: null, previousYearExternalTurnoverCents: '0', provenance: 'USER_DECLARED' });
  // Fixture cleanup disconnects only. Append-only declarations are not deleted.
  await prisma.$disconnect();
});
