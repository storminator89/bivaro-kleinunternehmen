import { expect, test, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';
import type { TaxSummary } from '../lib/tax-summary';

// Authored acceptance source. Run ONLY in an authorized hosted fixture runner;
// never start a local server, migrate, reset, or run this against real accounts.
// Happy-path summary responses below come from the actual seeded server. Only
// the explicitly named interruption injects a failure; server time is not faked.
async function summaryResponse(page: Page, year: number, range = 'thisYear') {
  const response = await page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/tax-summary' && url.searchParams.get('year') === String(year)
      && url.searchParams.get('timeRange') === range;
  });
  expect(response.status()).toBe(200);
  return await response.json() as TaxSummary;
}

async function keyboardFocus(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(control).toBeFocused();
  expect(await control.evaluate(node => node.matches(':focus-visible'))).toBe(true);
}

async function alignReadable(_page: Page, target: Locator) {
  await target.evaluate(node => {
    const visible = (element: HTMLElement) => element.getClientRects().length > 0;
    const stuck = (element: HTMLElement) => visible(element)
      && element.getBoundingClientRect().top <= (Number.parseFloat(getComputedStyle(element).top) || 0) + 1;
    const header = [...document.querySelectorAll<HTMLElement>('.app-topbar')].find(visible);
    if (!header) throw new Error('Expected visible application header');
    const mobile = [...document.querySelectorAll<HTMLElement>('.tax-mobile-result')].find(stuck);
    const safeTop = Math.max(header.getBoundingClientRect().bottom, mobile?.getBoundingClientRect().bottom ?? 0) + 16;
    window.scrollBy({ top: node.getBoundingClientRect().top - safeTop, behavior: 'instant' });
  });
  await expect.poll(() => target.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const blockers = [...document.querySelectorAll<HTMLElement>('.app-topbar,.tax-mobile-result')]
      .filter(element => element.getClientRects().length > 0 && element.getBoundingClientRect().top <= (Number.parseFloat(getComputedStyle(element).top) || 0) + 1);
    const top = Math.max(0, ...blockers.map(element => element.getBoundingClientRect().bottom));
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return rect.width > 0 && rect.height > 0 && rect.top >= top + 8 && rect.bottom <= innerHeight - 8
      && rect.left >= 0 && rect.right <= innerWidth && node.scrollWidth <= node.clientWidth + 1
      && hit !== null && (hit === node || node.contains(hit));
  })).toBe(true);
}

function stableBasis({ generatedAt: _generatedAt, dataAsOf: _dataAsOf, ...basis }: TaxSummary) {
  // A new server read has a fresh timestamp; selected source values must match.
  return basis;
}

test('simulation discloses real annual basis, assumptions and limits through history, reload, retry and mobile keyboard use', async ({ page }, info) => {
  test.setTimeout(150_000);
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticSimulationScope123!';
  const userId = randomUUID();
  try {
    const user = await prisma.user.create({ data: {
      id: userId, email: `simulation-scope-${randomUUID()}@example.test`, name: 'Synthetic simulation scope', password: await hashPassword(password),
    } });
    const unpaid = await prisma.invoice.create({ data: {
      userId: user.id, fileName: 'synthetic-unpaid.pdf', storedFileName: 'synthetic-unpaid.pdf', parsedData: {},
      invoiceDate: new Date('2026-01-02T12:00:00Z'), issuanceState: 'ISSUED', status: 'SENT', totalAmount: 7777,
    } });
    await prisma.income.createMany({ data: [
      { userId: user.id, description: 'Synthetic cash receipt 2025', amount: 30000, date: new Date('2025-01-03T12:00:00Z') },
      { userId: user.id, description: 'Synthetic cash receipt 2026', amount: 60000, date: new Date('2026-01-03T12:00:00Z') },
      { userId: user.id, description: 'Synthetic unpaid invoice, not a receipt', amount: 7777, invoiceId: unpaid.id, date: new Date('2026-01-03T12:00:00Z') },
      { userId: user.id, description: 'Synthetic excluded income', amount: 500, taxRelevant: false, date: new Date('2026-01-03T12:00:00Z') },
    ] });
    await prisma.expense.createMany({ data: [
      { userId: user.id, description: 'Synthetic expense 2025', amount: 5000, date: new Date('2025-01-04T12:00:00Z') },
      { userId: user.id, description: 'Synthetic partial expense 2026', amount: 10000, taxDeductiblePercentage: 80, date: new Date('2026-01-04T12:00:00Z') },
      { userId: user.id, description: 'Synthetic excluded expense', amount: 1000, taxRelevant: false, date: new Date('2026-01-04T12:00:00Z') },
    ] });
    await prisma.annualBusinessContextRevision.create({ data: {
      userId: user.id, revision: 1, contextYear: 2026, effectiveFrom: '2026-01-01', foundingYear: 2025,
      previousYearTurnoverCents: '12000000', previousYearExternalTurnoverCents: '9000000', completeness: 'PARTIAL',
      sourceNote: 'Synthetic external context; not an accounting receipt or simulation input',
    } });
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(user.email);
    await page.getByLabel('Passwort', { exact: true }).fill(password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    const snapshot = () => prisma.$transaction([
      prisma.settings.findMany({ where: { userId: user.id } }),
      prisma.income.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } }),
      prisma.expense.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } }),
      prisma.invoice.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } }),
      prisma.paymentJournalEvent.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } }),
      prisma.annualBusinessContextRevision.findMany({ where: { userId: user.id }, orderBy: { revision: 'asc' } }),
    ]);
    const before = await snapshot();
    const writes: string[] = [];
    const authDiagnostics: string[] = [];
    await page.route('**/api/**', async route => {
      const method = route.request().method();
      const url = new URL(route.request().url());
      if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return route.continue();
      // Only this exact observed POST endpoint is an authentication log, not
      // an income, expense, payment or profile operation. Do not exempt the
      // auth namespace, other methods, query variants or other origins.
      if (method === 'POST' && url.pathname === '/api/auth/_log' && url.search === ''
        && url.origin === new URL(page.url()).origin) {
        authDiagnostics.push(`${method} ${url.pathname}`);
        return route.continue();
      }
      writes.push(`${method} ${url.pathname}`);
      await route.abort('blockedbyclient');
    });
    const initialRead = summaryResponse(page, 2026);
    await page.goto('/steuer-simulation?year=2026&timeRange=thisYear');
    const initial = await initialRead;
    expect(initial).toMatchObject({ year: 2026, timeRange: 'thisYear', annualBasis: true, inputScope: 'IN_APP_ONLY', externalDataIncluded: false,
      totalIncome: 60000, totalExpenses: 8000, profit: 52000, sourceCount: 2, incomeCount: 1, expenseCount: 1 });
    const result = page.getByRole('region', { name: 'Ergebnis', exact: true });
    const disclosure = result.getByLabel('Einordnung des Simulationsergebnisses', { exact: true });
    const source = page.getByRole('region', { name: 'Gewinn laut EÜR', exact: true });
    await expect(disclosure).toContainText('Regeljahr 2026');
    await expect(disclosure).toContainText('01.01.2026 bis 31.12.2026');
    await expect(disclosure).toContainText('Modelleingang nach Annahmen: 47.000,00');
    await expect(disclosure).toContainText('nicht Ihr vollständiges persönliches zu versteuerndes Einkommen');
    await expect(disclosure).toContainText('keine vollständige persönliche Steuerlast');
    await expect(disclosure).toContainText('Externe Einnahmen und Ausgaben fehlen');
    await expect(disclosure).toContainText('Jahreskontext wird nicht addiert');
    await expect(disclosure).toContainText('Zusammenveranlagung');
    await expect(disclosure).toContainText('komplexe Verlustfälle');
    await expect(disclosure).toContainText('Krankenversicherung 4.000,00');
    await expect(disclosure).toContainText('Soli ein · Kirchensteuer aus');
    await expect(result.locator('.tax-calculation')).not.toHaveAttribute('open', '');
    // These disclosures must be visible without opening calculation/details.
    for (const paragraph of await disclosure.locator(':scope > p').all()) await expect(paragraph).toBeVisible();
    await expect(source).toContainText('52.000,00');
    await expect(source).not.toContainText('67.777,00');

    const infoControl = source.getByText('Datenbasis und Grenzen', { exact: true });
    await keyboardFocus(page, infoControl); await page.keyboard.press('Enter');
    await expect(source.getByText(/Geladene Daten für Regeljahr 2026/)).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(source.getByText(/Geladene Daten für Regeljahr 2026/)).toBeHidden();
    const calculation = result.getByText('Berechnungsweg anzeigen', { exact: true });
    await keyboardFocus(page, calculation); await page.keyboard.press('Enter');
    await expect(result.getByText('Vereinfachter Modelleingang für den Tarif', { exact: true })).toBeVisible();
    await page.keyboard.press('Enter');
    const editAssumptions = disclosure.getByRole('link', { name: 'Annahmen bearbeiten', exact: true });
    await keyboardFocus(page, editAssumptions); await page.keyboard.press('Enter');
    await expect(page.locator('#parameters-heading')).toBeFocused();
    const help = page.getByRole('button', { name: 'Krankenversicherung (EUR) - Hilfe', exact: true });
    await keyboardFocus(page, help); await expect(page.getByRole('tooltip')).toContainText('Basisabsicherung');
    await page.keyboard.press('Escape');
    await page.getByLabel('Sonstige Sonderausgaben (EUR)', { exact: true }).fill('1234');
    await expect(disclosure).toContainText('Modelleingang nach Annahmen: 45.766,00');
    await expect(disclosure).toContainText('sonstige Abzüge 1.234,00');
    await page.getByLabel('Krankenversicherung (EUR)', { exact: true }).fill('');
    await expect(page.getByLabel('Krankenversicherung (EUR)', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(result.locator('.tax-result-amount')).toHaveText('nicht berechnet');
    await expect(disclosure).toContainText('Krankenversicherung ungültige Eingabe');
    await expect(disclosure).not.toContainText('NaN');
    await page.getByLabel('Krankenversicherung (EUR)', { exact: true }).fill('4000');
    await expect(disclosure).toContainText('Modelleingang nach Annahmen: 45.766,00');
    await page.getByRole('button', { name: 'Nebenberuflich', exact: true }).click();
    await page.getByLabel('Bruttojahresgehalt (EUR)', { exact: true }).fill('65000');
    await page.getByRole('checkbox', { name: 'Kirchensteuer berechnen', exact: true }).check();
    await page.getByLabel('Kirchensteuer (%)', { exact: true }).fill('9');
    await expect(disclosure).toContainText('Bruttogehalt 65.000,00');
    await expect(disclosure).toContainText('Werbungskosten 1.230,00');
    await expect(disclosure).toContainText('Kirchensteuer ein (9 %)');
    await page.getByRole('button', { name: 'Standardwerte', exact: true }).click();
    await expect(disclosure).toContainText('Modelleingang nach Annahmen: 47.000,00');
    // Assumptions are explicitly local, not new saved accounting facts.
    expect(await snapshot()).toEqual(before);

    const priorRead = summaryResponse(page, 2025);
    await page.getByLabel('Steuerjahr', { exact: true }).selectOption('2025');
    const prior = await priorRead;
    expect(prior).toMatchObject({ year: 2025, totalIncome: 30000, totalExpenses: 5000, profit: 25000 });
    const periodRead = summaryResponse(page, 2025, 'all');
    await page.getByLabel('Analysezeitraum', { exact: true }).selectOption('all');
    const periodBasis = await periodRead;
    expect(periodBasis.annualBasis).toBe(false);
    await expect(disclosure).toContainText('Gesamter erfasster Zeitraum · keine Jahresbasis');
    await expect(result.locator('.tax-result-amount')).toHaveText('nicht berechnet');
    await expect(page.getByRole('alert').filter({ hasText: 'Keine Berechnung für diesen Zeitraum oder Verlustfall.' })).toBeVisible();
    const chosenUrl = page.url();
    await page.goto('/dashboard');
    const backRead = summaryResponse(page, 2025, 'all');
    await page.goBack(); await backRead;
    await expect(page).toHaveURL(chosenUrl);
    await expect(page.getByLabel('Steuerjahr', { exact: true })).toHaveValue('2025');
    await expect(page.getByLabel('Analysezeitraum', { exact: true })).toHaveValue('all');
    const reloadRead = summaryResponse(page, 2025, 'all');
    await page.reload();
    const reloaded = await reloadRead;
    await expect(page).toHaveURL(chosenUrl);
    expect(stableBasis(reloaded)).toEqual(stableBasis(periodBasis));
    await expect(disclosure).toContainText('Regeljahr 2025');
    await expect(result.locator('.tax-result-amount')).toHaveText('nicht berechnet');

    const restoredRead = summaryResponse(page, 2026);
    await page.goto('/steuer-simulation?year=2026&timeRange=thisYear');
    expect(stableBasis(await restoredRead)).toEqual(stableBasis(initial));
    await expect(disclosure).toContainText('Modelleingang nach Annahmen: 47.000,00');
    const hints = page.getByText('Prüfhinweise', { exact: true }).locator('..');
    await keyboardFocus(page, hints); await page.keyboard.press('Enter');
    const checks = page.locator('.tax-recommendations');
    await expect(checks).toContainText('Erfasste Teilabzüge');
    await expect(checks).toContainText('kein Nachweis einer Steuerbefreiung');
    await expect(checks).not.toContainText('Zukunftsinvestitionen vorziehen');
    await expect(checks).not.toContainText('Zusätzliche Abzugsmöglichkeiten');
    await page.keyboard.press('Enter');

    for (const width of [360, 390, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await page.evaluate(async () => { await document.fonts.ready; });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      // Every line must be reachable in the normal viewport, below real sticky UI.
      for (const paragraph of await disclosure.locator(':scope > p').all()) await alignReadable(page, paragraph);
      await alignReadable(page, result.getByRole('heading', { name: 'Ergebnis', exact: true }));
      if (width !== 360) await page.screenshot({ path: info.outputPath(`simulation-transparency-${width}.png`), animations: 'disabled', fullPage: false });
    }

    // Only this branch substitutes a transport failure, never successful data.
    let interrupted = true;
    await page.route('**/api/tax-summary?*', route => interrupted
      ? route.fulfill({ status: 503, json: { error: 'Synthetische Datenunterbrechung' } }) : route.continue());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Finanzdaten neu laden', exact: true }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'Synthetische Datenunterbrechung' });
    await expect(alert).toBeVisible();
    await expect(result.locator('.tax-result-amount')).toHaveText('nicht berechnet');
    await expect(disclosure).toContainText('Nicht bestätigt · keine Berechnung');
    await expect(source).toContainText('Nicht verfügbar / fachlich zu prüfen');
    await alignReadable(page, alert);
    await page.screenshot({ path: info.outputPath('simulation-transparency-error-390.png'), animations: 'disabled', fullPage: false });
    interrupted = false;
    const retryRead = summaryResponse(page, 2026);
    await keyboardFocus(page, page.getByRole('button', { name: 'Finanzdaten neu laden', exact: true }));
    await page.keyboard.press('Enter');
    expect(stableBasis(await retryRead)).toEqual(stableBasis(initial));
    await expect(alert).toHaveCount(0);
    await expect(disclosure).toContainText('Modelleingang nach Annahmen: 47.000,00');
    await info.attach('simulation-auth-diagnostics', {
      body: JSON.stringify({ scope: 'Only exact same-origin POST /api/auth/_log without query parameters', requests: authDiagnostics }),
      contentType: 'application/json',
    });
    expect(writes).toEqual([]);
    expect(await snapshot()).toEqual(before);
  } finally {
    await page.unrouteAll({ behavior: 'wait' });
    // The supported runner disposes this exact fresh fixture directory. The
    // append-only annual context and its restricted account intentionally live
    // until that disposal; never delete immutable rows or bypass their triggers.
    await prisma.$disconnect();
  }
});
