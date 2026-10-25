import { expect, test, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';
import type { RevenueIndicatorBasis } from '../lib/revenue-indicators';
import type { AnnualContextRevision } from '../lib/annual-business-context';

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
  const simulationSource = page.getByRole('region', { name: 'Gewinn laut EÜR', exact: true });
  const sourceDetails = simulationSource.locator('details');
  await expect(sourceDetails).toHaveCount(1);
  const sourceSummary = sourceDetails.locator('summary');
  await expect(sourceSummary).toHaveText('Datenbasis und Grenzen');
  await expect(sourceDetails).not.toHaveAttribute('open', '');
  await sourceSummary.click();
  await expect(sourceDetails).toHaveAttribute('open', '');
  // Inspect this opened source disclosure, not the independently repeated
  // result-local limitations or the more detailed source paragraph.
  const sourceScope = sourceDetails.getByText('Nur In-App-Buchungen; externe Beträge fehlen. Jahreskontext wird nicht addiert. Kleinunternehmerstatus ungeprüft.', { exact: true });
  await expect(sourceScope).toBeVisible();
  await expect(sourceScope).toContainText('Kleinunternehmerstatus ungeprüft.');
  expect(await financialSnapshot()).toEqual(before);
  expect(await prisma.annualBusinessContextRevision.count({ where: { userId: user.id } })).toBe(2);
});

// Source-only follow-up for issue #59. The dashboard deliberately exposes the
// current server year, not the chart's historical selection. Compare independent
// businesses founded this year and in the previous year at the SAME real server
// date; this is not a simulated calendar rollover or a historical dashboard.
// No successful HTTP response, application time or browser clock is substituted.
test('compares founding and following-year server references while preserving unknown inputs and financial records', async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  if (!baseURL) throw new Error('The supported hosted fixture runner must supply baseURL.');
  const origin = new URL(baseURL).origin;
  const observed: Array<{ year: number; foundingYear: boolean; currentYear: number }> = [];

  async function nextServerBasis(page: Page): Promise<RevenueIndicatorBasis> {
    const response = await page.waitForResponse(response => {
      const url = new URL(response.url());
      return response.request().method() === 'GET' && url.origin === origin
        && url.pathname === '/api/dashboard/kpis' && url.search === '';
    });
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    const data = await response.json() as { paymentContractVersion: number; fiscalMappingStatus: string; revenueBasis: RevenueIndicatorBasis };
    expect(data.paymentContractVersion).toBe(3);
    expect(data.fiscalMappingStatus).toBe('UNREVIEWED');
    expect(data.revenueBasis).toBeDefined();
    expect(Number.isFinite(Date.parse(data.revenueBasis.asOf))).toBe(true);
    return data.revenueBasis;
  }

  for (const kind of ['founding', 'following-year'] as const) {
    const context = await browser.newContext({ baseURL, timezoneId: 'UTC' });
    try {
      await isolateSyntheticLoginIpBudget();
      const page = await context.newPage();
      const password = 'SyntheticFoundingReference123!';
      const user = await prisma.user.create({ data: {
        email: `revenue-${kind}-${randomUUID()}@example.test`, password: await hashPassword(password), name: `Synthetic ${kind} reference`,
      } });
      await prisma.settings.create({ data: { userId: user.id, fiscalTaxRegime: 'UNSET' } });
      await page.goto('/login');
      await page.getByLabel('E-Mail').fill(user.email);
      await page.getByLabel('Passwort', { exact: true }).fill(password);
      const bootstrapRead = nextServerBasis(page);
      await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard/);
      const bootstrap = await bootstrapRead;
      const year = bootstrap.year;
      // Fail visibly outside the reviewed years; never invent future references
      // or skip the comparison while claiming that the acceptance was covered.
      expect([2025, 2026], 'Current server year must have a reviewed revenue reference').toContain(year);
      expect(bootstrap.period).toBe('TO_DATE');
      expect(bootstrap.context).toBeNull();
      expect(bootstrap.reference).toEqual({ previousYear: 25000, currentYear: null, foundingYear: false });
      if (observed.length) expect(year).toBe(observed[0].year);
      const foundingYear = kind === 'founding' ? year : year - 1;
      const expectedReference = kind === 'founding' ? 25000 : 100000;
      await prisma.income.createMany({ data: [
        { userId: user.id, description: `Synthetic ${kind} actual-year receipt`, amount: 30000, date: new Date(bootstrap.asOf) },
        ...(kind === 'following-year' ? [{ userId: user.id, description: 'Synthetic founding-year in-app receipt', amount: 15000, date: new Date(Date.UTC(year - 1, 0, 3, 12)) }] : []),
      ] });
      const financialSnapshot = () => prisma.$transaction([
        prisma.user.findUnique({ where: { id: user.id }, select: { id: true, email: true, name: true, role: true, sessionVersion: true, deactivatedAt: true } }),
        prisma.settings.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } }),
        prisma.income.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } }),
        prisma.expense.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } }),
        prisma.invoice.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } }),
        prisma.paymentJournalEvent.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } }),
        prisma.paymentAdjustment.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } }),
      ]);
      const before = await financialSnapshot();
      const forbiddenWrites: string[] = [], declarationRequests: string[] = [];
      let allowDeclaration = false;
      await page.route('**/api/**', async route => {
        const method = route.request().method(), url = new URL(route.request().url());
        if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return route.continue();
        if (url.origin === origin && url.search === '' && method === 'POST') {
          if (url.pathname === '/api/auth/_log') return route.continue(); // Exact diagnostic only, never an auth-namespace exemption.
          if (url.pathname === '/api/settings/annual-context' && allowDeclaration) {
            declarationRequests.push(route.request().postData() ?? '');
            return route.continue(); // Only the explicitly initiated own-context declaration below.
          }
        }
        forbiddenWrites.push(`${method} ${url.pathname}`);
        await route.abort('blockedbyclient');
      });
      const panel = page.getByRole('region', { name: `Umsatzdatenbasis ${year}`, exact: true });
      const disclosure = page.getByText(`Umsatzindikatoren · ${year}`, { exact: true }).locator('..');
      async function showBasis(basis: RevenueIndicatorBasis) {
        await expect(panel).toBeHidden();
        await disclosure.focus(); await page.keyboard.press('Enter');
        await expect(panel).toBeVisible();
        expect(basis).toMatchObject({ year, previousYear: year - 1, period: 'TO_DATE', inAppRevenue: 30000,
          previousYearInAppRevenue: kind === 'founding' ? 0 : 15000, businessTotal: null, externalRevenue: null });
        const stand = new Date(basis.asOf).toLocaleString('de-DE', { timeZone: 'UTC' });
        await expect(panel.getByText(`${year} bis Datenstand · Datenstand ${stand} · Zahlungsjahr wie in der Finanzübersicht.`, { exact: true })).toBeVisible();
        await expect(panel.getByText('Kein Steuerstatus', { exact: true })).toBeVisible();
        const currentCash = panel.locator('dl > div').filter({ has: page.getByText(`Operativer Zahlungssaldo in Bivaro · ${year}`, { exact: true }) });
        await expect(currentCash.locator('dd').filter({ hasText: /^30\.000,00/ })).toHaveText('30.000,00 €');
        const priorCash = panel.locator('dl > div').filter({ has: page.getByText(`Operativer Zahlungssaldo in Bivaro · Vorjahr ${year - 1}`, { exact: true }) });
        await expect(priorCash.locator('dd').filter({ hasText: kind === 'founding' ? /^0,00/ : /^15\.000,00/ })).toHaveText(kind === 'founding' ? '0,00 €' : '15.000,00 €');
        await expect(panel).toContainText(`Außerhalb Bivaro erfasste Umsätze ${year}: unbekannt und nicht enthalten.`);
        const businessTotal = panel.locator('dl > div').filter({ has: page.getByText(`Gesamtumsatz des Unternehmens · ${year}`, { exact: true }) });
        await expect(businessTotal).toHaveCount(1);
        await expect(businessTotal.locator('dd').filter({ hasText: /^Unbekannt$/ })).toHaveText('Unbekannt');
        await expect(panel).toContainText('Keine automatische Steuer-Einstufung.');
        await expect(panel).not.toContainText('Sofort steuerpflichtig!');
        await expect(panel).not.toContainText('Steuerbefreiung bestätigt');
      }
      const missingRead = nextServerBasis(page);
      await page.reload();
      const missing = await missingRead;
      await showBasis(missing);
      expect(missing.context).toBeNull();
      expect(missing.reference?.currentYear).toBeNull();
      await expect(panel).toContainText('Jahreskontext fehlt');
      await expect(panel).toContainText('Keine zum angezeigten Zeitraum gültige eigene Erklärung vorhanden. Unbekannte Beträge werden nicht als 0 € behandelt.');
      await expect(panel).toContainText('Referenz für das betrachtete Jahr nicht zugeordnet: Gründungsjahr unbekannt.');

      async function editContext() {
        await panel.getByRole('link', { name: 'Jahreskontext prüfen', exact: true }).click();
        await expect(page).toHaveURL(/\/settings#annual-context/);
        const section = page.locator('#annual-context');
        await section.getByRole('button', { name: 'Jahreskontext öffnen', exact: true }).click();
        await expect(section.getByLabel('Kontextjahr', { exact: true })).toBeEnabled();
        await expect(section.getByLabel('Kontextjahr', { exact: true })).toHaveValue(String(year));
        return section;
      }
      async function saveDeclaration(section: Locator, revision: number): Promise<AnnualContextRevision> {
        await section.getByRole('checkbox', { name: /Ich erkläre diese Angaben/ }).check();
        const savedResponse = page.waitForResponse(response => response.request().method() === 'POST'
          && new URL(response.url()).origin === origin && new URL(response.url()).pathname === '/api/settings/annual-context');
        allowDeclaration = true;
        try {
          await section.getByRole('button', { name: 'Kontextrevision speichern', exact: true }).click();
          const response = await savedResponse;
          expect(response.status()).toBe(201);
          const result = await response.json() as { revision: number; saved: AnnualContextRevision };
          expect(result).toMatchObject({ revision, saved: { revision, contextYear: year, foundingYear, provenance: 'USER_DECLARED' } });
          await expect(section.getByRole('status')).toContainText(`Revision ${revision} gespeichert`);
          return result.saved;
        } finally { allowDeclaration = false; }
      }
      async function returnToBasis() {
        const response = nextServerBasis(page);
        await page.goto('/dashboard');
        const basis = await response;
        await showBasis(basis);
        return basis;
      }
      let section = await editContext();
      await section.getByLabel('Gründungsjahr · leer = unbekannt', { exact: true }).fill(String(foundingYear));
      await section.getByLabel('Gesamtumsatz im Vorjahr (EUR)', { exact: true }).fill('');
      await section.getByLabel('Davon außerhalb Bivaro erfasst (EUR)', { exact: true }).fill('');
      await section.getByLabel('Von mir erklärter Datenstand', { exact: true }).selectOption('PARTIAL');
      await section.getByLabel('Quelle Ihrer Angaben', { exact: true }).fill(`Synthetic ${kind} reference declaration`);
      const partialSaved = await saveDeclaration(section, 1);
      const partial = await returnToBasis();
      expect(partial.context).toEqual(partialSaved);
      expect(partial.context).toMatchObject({ completeness: 'PARTIAL', previousYearTurnoverCents: null, previousYearExternalTurnoverCents: null });
      expect(partial.reference).toEqual({ previousYear: 25000, currentYear: expectedReference, foundingYear: kind === 'founding' });
      await expect(panel).toContainText('Teilweise selbst erklärt');
      await expect(panel.getByText('Als vollständig selbst erklärt', { exact: true })).toHaveCount(0);
      await expect(panel).toContainText(`Referenz für das Vorjahr ${year - 1}: 25.000,00 €. Ein eigener Gesamtbetrag ist noch unbekannt.`);

      section = await editContext();
      await section.getByLabel('Gesamtumsatz im Vorjahr (EUR)', { exact: true }).fill(kind === 'founding' ? '0' : '20000');
      await section.getByLabel('Davon außerhalb Bivaro erfasst (EUR)', { exact: true }).fill(kind === 'founding' ? '0' : '5000');
      await section.getByLabel('Von mir erklärter Datenstand', { exact: true }).selectOption('COMPLETE');
      const completeSaved = await saveDeclaration(section, 2);
      const complete = await returnToBasis();
      expect(complete.context).toEqual(completeSaved);
      expect(complete.reference).toEqual({ previousYear: 25000, currentYear: expectedReference, foundingYear: kind === 'founding' });
      expect(complete.context).toMatchObject({ completeness: 'COMPLETE', previousYearTurnoverCents: kind === 'founding' ? '0' : '2000000',
        previousYearExternalTurnoverCents: kind === 'founding' ? '0' : '500000' });
      await expect(panel).toContainText('Als vollständig selbst erklärt');
      await expect(panel).toContainText(`Gründungsjahr: ${foundingYear} · Quelle: Synthetic ${kind} reference declaration`);
      await expect(panel).toContainText(`Referenz für das Vorjahr ${year - 1}: 25.000,00 €. Der selbst erklärte Vorjahresbetrag liegt nicht darüber; dies bestätigt keine Steuerbefreiung.`);
      const currentReference = kind === 'founding'
        ? `Referenz ${year}: 25.000,00 € · Gründungsjahr laut eigener Erklärung. Der operative Zahlungssaldo liegt oberhalb der Referenz; daraus folgt weder ein geprüfter Gesamtumsatz noch ein Steuerstatus. Daten fachlich prüfen lassen.`
        : `Referenz ${year}: 100.000,00 € · kein Gründungsjahr laut eigener Erklärung. Ein verbleibender Freibetrag wird aus der unvollständigen Datenbasis nicht berechnet.`;
      await expect(panel.getByText(currentReference, { exact: true })).toBeVisible();
      const declaredPrior = panel.locator('dl > div').filter({ has: page.getByText(`Selbst erklärter Gesamtumsatz · Vorjahr ${year - 1}`, { exact: true }) });
      await expect(declaredPrior.locator('dd').filter({ hasText: kind === 'founding' ? /^0,00/ : /^20\.000,00/ })).toHaveText(kind === 'founding' ? '0,00 €' : '20.000,00 €');
      if (kind === 'following-year') {
        await expect(panel).toContainText('Davon außerhalb Bivaro: 5.000,00 €');
        await expect(declaredPrior).not.toContainText('25.000,00'); // External share is already included, never added again.
      }
      const reloadRead = nextServerBasis(page);
      await page.reload();
      const reloaded = await reloadRead;
      await showBasis(reloaded);
      const { asOf: _completeAsOf, ...confirmedBasis } = complete;
      const { asOf: _reloadedAsOf, ...reloadedBasis } = reloaded;
      expect(reloadedBasis).toEqual(confirmedBasis);
      await expect(panel.getByText(currentReference, { exact: true })).toBeVisible();
      expect(declarationRequests).toHaveLength(2);
      expect(declarationRequests.map(body => JSON.parse(body).expectedRevision)).toEqual([0, 1]);
      expect(forbiddenWrites).toEqual([]);
      expect(await financialSnapshot()).toEqual(before);
      expect(await prisma.annualBusinessContextRevision.count({ where: { userId: user.id } })).toBe(2);
      expect(await prisma.settings.findUnique({ where: { userId: user.id } })).toMatchObject({ fiscalTaxRegime: 'UNSET', fiscalConfirmedAt: null });
      observed.push({ year, foundingYear: complete.reference!.foundingYear, currentYear: complete.reference!.currentYear! });
    } finally {
      await context.close();
      // Append-only context/account rows remain in this exact fresh fixture
      // until supported runner disposal; no immutable-history trigger bypass.
    }
  }
  expect(observed).toEqual([
    { year: observed[0].year, foundingYear: true, currentYear: 25000 },
    { year: observed[0].year, foundingYear: false, currentYear: 100000 },
  ]);
});
