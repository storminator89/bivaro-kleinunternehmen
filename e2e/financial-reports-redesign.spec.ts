import { expect, test, type Locator, type Page, type Response, type TestInfo } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';
import type { DashboardSummary } from '../hooks/use-dashboard-data';

// Acceptance source for a later authorized hosted run, not a local test run.
// Synthetic read responses prove presentation only. Existing eur-2026.spec.ts
// retains real financial/export coverage. No business write is allowed here.
const year = new Date().getUTCFullYear();
const category = 'SYNTHETISCHE vollständig lesbare Betriebsausgaben mit außergewöhnlich langer Kategorienbezeichnung';
const description = 'SYNTHETISCHES Wirtschaftsgut mit vollständig lesbarer Anschaffungsbeschreibung und dokumentiertem Rechenweg';
type ReportOwner = { id: string; role: string; sessionVersion: number };
type AuthDiagnostic = { level: string; code: string; errorName: string };
const reportAuth = new WeakMap<Page, ReturnType<typeof observeReportAuth>>();
const diagnosticToken = (value: unknown) => typeof value === 'string' && /^[A-Za-z_][A-Za-z_0-9]{0,63}$/.test(value) ? value : 'Unknown';
async function ownerSession(response: Response, owner: ReportOwner) {
  expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
  const session = await response.json();
  expect({ id: session.user?.id, role: session.user?.role, sessionVersion: session.user?.sessionVersion }).toEqual(owner);
}
function observeReportAuth(page: Page, owner: ReportOwner) {
  const diagnostics: AuthDiagnostic[] = [], pending = new Set<Promise<void>>();
  const record = (diagnostic: AuthDiagnostic) => {
    if (diagnostics.length < 32) diagnostics.push(diagnostic);
    else if (diagnostics.length === 32) diagnostics.push({ level: 'error', code: 'AUTH_DIAGNOSTIC_OVERFLOW', errorName: 'Unknown' });
  };
  const observe = (check: Promise<void>) => {
    const tracked = check.catch(error => { record({ level: 'error', code: 'SESSION_OBSERVATION_FAILED', errorName: diagnosticToken(error?.name) }); });
    pending.add(tracked); void tracked.then(() => pending.delete(tracked));
  };
  page.on('request', request => {
    if (request.method() !== 'GET' || new URL(request.url()).pathname !== '/api/auth/session') return;
    observe((async () => {
      const response = await request.response();
      if (!response) {
        record({ level: 'error', code: 'SESSION_REQUEST_FAILED', errorName: request.failure()?.errorText === 'net::ERR_ABORTED' ? 'AbortError' : 'NetworkError' });
        return;
      }
      await ownerSession(response, owner);
    })());
  });
  // NextAuth's URL-encoded beacon stringifies nested errors. Its local console
  // metadata can retain the error name; never persist messages, stacks or URLs.
  page.on('console', message => {
    const match = /^\[next-auth\]\[(error|warn|debug)\]\[([A-Z_0-9]{1,64})\]/.exec(message.text());
    if (!match) return;
    observe((async () => {
      const metadata = await message.args()[3]?.jsonValue();
      record({ level: match[1], code: match[2], errorName: diagnosticToken(metadata?.error?.name ?? metadata?.name) });
    })());
  });
  const settle = async () => {
    // Wait for exact observed session requests, not an arbitrary delay or global
    // network-idle heuristic. Repeated reads started during settlement count too.
    await expect.poll(() => pending.size, { message: 'Every observed session response must finish before navigation' }).toBe(0);
    expect(diagnostics, 'Unexpected authentication diagnostics (bounded fields only)').toEqual([]);
  };
  const healthy = async () => {
    const session = await page.evaluate(async () => {
      const response = await fetch('/api/auth/session', { cache: 'no-store' });
      const body = await response.json();
      return { status: response.status, id: body.user?.id, role: body.user?.role, sessionVersion: body.user?.sessionVersion };
    });
    expect(session).toEqual({ status: 200, ...owner }); await settle();
  };
  return { record, settle, healthy };
}
function summary(timeRange = 'thisYear', empty = false): DashboardSummary {
  const selectedYear = timeRange === 'lastYear' ? year - 1 : year;
  return {
    timeRange: timeRange as DashboardSummary['timeRange'],
    totalIncome: empty ? 0 : 999999999.99, totalExpense: empty ? 0 : 123456789.12, profit: empty ? 0 : 876543210.87,
    expenseCategories: empty ? [] : [{ category, amount: 123456789.12 }],
    monthlyData: empty ? [] : [
      { month: 1, year: selectedYear, monthName: 'Jan', revenue: 500000000, expenses: 60000000, profit: 440000000 },
      { month: 2, year: selectedYear, monthName: 'Feb', revenue: 499999999.99, expenses: 63456789.12, profit: 436543210.87 },
    ],
    depreciationDetails: empty ? [] : [{ id: 960001, description, date: `${selectedYear}-01-01`, totalAmount: 2400, years: 3, currentYearAmount: 800, remainingAmount: 1600, calculationExplanation: 'SYNTHETISCHER Rechenweg: 2.400,00 € / 3 Jahre = 800,00 € im ausgewählten Jahr.' }],
    privateWithdrawals: empty ? 0 : 130.12, privateDeposits: empty ? 0 : 430.12,
  };
}
async function settled(page: Page) {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  expect(await page.evaluate(() => document.fonts.check('400 14px Inter'))).toBe(true);
}
async function navigate(page: Page, destination: string) {
  await reportAuth.get(page)?.settle();
  const session = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/auth/session' && new URL(page.url()).pathname === destination.split('?')[0]);
  await page.goto(destination); const response = await session;
  expect(response.status()).toBe(200); expect(await response.finished()).toBeNull(); await settled(page);
  await reportAuth.get(page)?.settle();
}
async function account(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticReportsLayout123!';
  const user = await prisma.user.create({ data: { email: `reports-layout-${randomUUID()}@example.test`, name: 'Synthetic reports layout', password: await hashPassword(password), role: 'USER' } });
  await navigate(page, '/login'); await page.getByLabel('E-Mail').fill(user.email); await page.getByLabel('Passwort', { exact: true }).fill(password);
  const session = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/auth/session' && new URL(page.url()).pathname === '/dashboard');
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  const owner = { id: user.id, role: user.role, sessionVersion: user.sessionVersion };
  await ownerSession(await session, owner); await expect(page).toHaveURL(/\/dashboard/);
  const auth = observeReportAuth(page, owner); reportAuth.set(page, auth);
  const unexpected: string[] = [];
  await page.route('**/api/**', async route => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
    if (route.request().method() === 'POST' && new URL(route.request().url()).pathname === '/api/auth/_log') {
      const body = route.request().postDataBuffer();
      const fields = new URLSearchParams(body && body.length <= 16 * 1024 ? body.toString('utf8') : '');
      auth.record({ level: diagnosticToken(fields.get('level')), code: diagnosticToken(fields.get('code')), errorName: diagnosticToken(fields.get('name')) });
      // Logging is not a financial mutation, but an unknown/auth-error beacon is
      // still a failure. Do not continue it or allow any other auth POST.
      return route.abort('blockedbyclient');
    }
    unexpected.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`); await route.abort('blockedbyclient');
  });
  await auth.healthy();
  return { user, unexpected, auth };
}
async function theme(page: Page, value: 'light' | 'dark') {
  if (await page.locator('html').evaluate(element => element.classList.contains('dark')) !== (value === 'dark')) {
    await page.getByRole('button', { name: value === 'dark' ? 'Dunkles Farbschema aktivieren' : 'Helles Farbschema aktivieren', exact: true }).click();
  }
  await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${value}\\b`));
}
// Real keyboard traversal establishes :focus-visible; programmatic focus alone
// correctly retains pointer modality after the theme-button matrix.
async function keyboardFocus(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(control).toBeFocused();
  expect(await control.evaluate(element => element.matches(':focus-visible'))).toBe(true);
}
async function geometry(page: Page, workspace: Locator) {
  await settled(page);
  const measured = await workspace.evaluate(element => ({
    rootWidth: document.documentElement.clientWidth, rootScroll: document.documentElement.scrollWidth,
    overflow: [...element.querySelectorAll('button,summary,td,th,h2,h3,h4,dt,dd,strong')].filter(node => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (rect.left < -1 || rect.right > document.documentElement.clientWidth + 1 || node.scrollWidth > node.clientWidth + 1);
    }).map(node => ({ tag: node.tagName, text: node.textContent?.trim(), width: node.clientWidth, scrollWidth: node.scrollWidth })),
  }));
  expect(measured.rootScroll, JSON.stringify(measured)).toBeLessThanOrEqual(measured.rootWidth);
  expect(measured.overflow, JSON.stringify(measured)).toEqual([]);
  for (const control of await workspace.locator('button,summary').all()) {
    if (await control.isVisible()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
}
async function capture(page: Page, info: TestInfo, name: string, workspace: Locator) {
  expect(info.retry).toBe(0); await geometry(page, workspace);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  const surface = await page.evaluate(() => ({ width: document.documentElement.clientWidth, innerWidth, height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight), scrollY }));
  expect(surface.innerWidth).toBe(page.viewportSize()!.width); expect(surface.scrollY).toBe(0); expect(surface.width * surface.height * 4).toBeLessThanOrEqual(16 * 1024 * 1024);
  const png = await page.screenshot({ path: info.outputPath(name), fullPage: true, animations: 'disabled' });
  expect(png.length).toBeLessThanOrEqual(1024 * 1024);
  expect(png.readUInt32BE(16)).toBe(surface.width); expect(png.readUInt32BE(20)).toBeGreaterThanOrEqual(surface.height);
  process.stdout.write(`Financial reports capture proof: ${JSON.stringify({ name, ...surface, viewport: page.viewportSize(), fullPage: true, pngWidth: png.readUInt32BE(16), pngHeight: png.readUInt32BE(20), encodedBytes: png.length, sha256: createHash('sha256').update(png).digest('hex') })}\n`);
}
async function noWrites(page: Page, userId: string, unexpected: string[]) {
  await reportAuth.get(page)!.healthy();
  expect(unexpected).toEqual([]);
  expect(await prisma.income.count({ where: { userId } })).toBe(0);
  expect(await prisma.expense.count({ where: { userId } })).toBe(0);
  expect(await prisma.invoice.count({ where: { userId } })).toBe(0);
}
async function csv(download: import('@playwright/test').Download) {
  const path = await download.path(); expect(path).not.toBeNull(); return readFile(path!, 'utf8');
}

test('EÜR report keeps financial context, responsive modes, disclosures and interrupted exports', async ({ page }, info) => {
  test.setTimeout(120_000);
  const { user, unexpected } = await account(page), requests: string[] = [], downloads: string[] = [];
  let mode: 'full' | 'empty' | 'error' = 'full';
  let release: () => void = () => { throw new Error('No synthetic request is pending.'); };
  let held: Promise<void> | null = null;
  page.on('download', download => downloads.push(download.suggestedFilename()));
  await page.route('**/api/dashboard/summary?*', async route => {
    const range = new URL(route.request().url()).searchParams.get('timeRange')!; requests.push(range);
    if (held) { const pending = held; held = null; await pending; }
    await route.fulfill({ status: mode === 'error' ? 503 : 200, json: mode === 'error' ? { error: 'Synthetic report interruption' } : summary(range, mode === 'empty') });
  });
  await page.route('**/api/eur-export?*', route => route.fulfill({ status: 503, json: { error: 'Synthetic working-paper interruption' } }));
  await navigate(page, '/dashboard?tab=eur');
  const workspace = page.getByTestId('eur-report-workspace');
  await expect(workspace.getByRole('heading', { name: 'Gewinn', exact: true })).toBeVisible();
  await expect(workspace.getByText('876.543.210,87 €', { exact: true })).toBeVisible();
  await expect(workspace.getByText('Vorläufiges Ergebnis · vor Steuern', { exact: true })).toBeVisible();
  await expect(workspace.getByText('Nicht in der EÜR enthalten.', { exact: true })).toBeVisible();
  for (const value of ['light', 'dark'] as const) {
    await theme(page, value);
    for (const width of [320, 375, 390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 }); await geometry(page, workspace);
      await expect(workspace.getByRole('heading', { name: 'Details zu Abschreibungen (AfA)', exact: true })).toBeVisible();
      if ([1440, 390].includes(width)) await capture(page, info, `financial-reports-eur-${value}-${width}.png`, workspace);
    }
  }
  const disclosure = workspace.locator('details');
  await keyboardFocus(page, disclosure.locator('summary'));
  expect(await disclosure.locator('summary').evaluate(element => ({ style: getComputedStyle(element).outlineStyle, offset: getComputedStyle(element).outlineOffset }))).toEqual({ style: 'solid', offset: '-3px' });
  await page.keyboard.press('Enter'); await expect(disclosure).toHaveAttribute('open', '');
  await expect(disclosure.getByText(`Januar ${year}`, { exact: true })).toBeVisible();
  await geometry(page, workspace); await disclosure.locator('summary').click(); await expect(disclosure).not.toHaveAttribute('open', '');
  const transfer = workspace.getByRole('button', { name: 'EÜR-Übertragungshilfe öffnen', exact: true });
  await transfer.click(); const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Synthetic working-paper interruption', { exact: true })).toBeVisible();
  await dialog.locator('[data-slot="dialog-footer"]').getByRole('button', { name: 'Schließen', exact: true }).click(); await expect(dialog).toBeHidden();
  await expect(transfer).toBeFocused(); await transfer.click(); await expect(dialog).toBeVisible(); await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/tab=eur/); expect(downloads).toEqual([]);

  // Export rechecks fresh data. A second click while hidden/loading cannot create
  // a second download; navigating away invalidates the pending export callback.
  const download = page.waitForEvent('download'); await workspace.getByRole('button', { name: 'CSV exportieren', exact: true }).click();
  const file = await download; expect(file.suggestedFilename()).toMatch(/^eur-export-thisYear-/);
  expect(await csv(file)).toContain('GEWINN/VERLUST;876543210,87');
  await expect(workspace).toBeVisible();
  const repeated = page.waitForEvent('download'); await workspace.getByRole('button', { name: 'CSV exportieren', exact: true }).click();
  expect(await csv(await repeated)).toContain('GEWINN/VERLUST;876543210,87');
  await expect(workspace).toBeVisible();
  held = new Promise<void>(resolve => { release = resolve; });
  const before = requests.length;
  try {
    await workspace.getByRole('button', { name: 'CSV exportieren', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Lade EÜR-Auswertung' })).toBeVisible();
    await expect(workspace).toBeHidden(); await expect.poll(() => requests.length).toBeGreaterThan(before);
    await page.getByRole('link', { name: 'GWG-Verzeichnis', exact: true }).click(); await expect(page).toHaveURL(/tab=gwg/);
  } finally { release(); }
  await navigate(page, '/dashboard?tab=eur'); await expect(workspace).toBeVisible(); expect(downloads).toHaveLength(2);
  await page.getByRole('button', { name: 'Vorheriges Jahr anzeigen', exact: true }).click();
  await expect.poll(() => requests.includes('lastYear')).toBe(true); await expect(workspace).toBeVisible();
  const range = page.getByRole('combobox').first(); await range.click(); await page.getByRole('option', { name: 'Alle Daten', exact: true }).click();
  await expect(workspace.getByText('AfA-Berechnung nicht verfügbar', { exact: true })).toBeVisible();
  mode = 'empty'; await navigate(page, '/dashboard?tab=eur');
  await expect(workspace.getByText('Noch keine steuerrelevanten Ausgaben.', { exact: true })).toBeVisible();
  mode = 'error'; await navigate(page, '/dashboard?tab=eur');
  await expect(page.getByRole('alert').filter({ hasText: 'Kein Export aus zwischengespeicherten Zahlen.' })).toBeVisible(); await expect(workspace).toBeHidden();
  mode = 'full'; await page.getByRole('button', { name: 'Aktuellen EÜR-Stand erneut prüfen', exact: true }).click(); await expect(workspace).toBeVisible();
  await noWrites(page, user.id, unexpected);
});

test('GWG integrated register preserves responsive values, period and read-only export', async ({ page }, info) => {
  test.setTimeout(120_000);
  const { user, unexpected, auth } = await account(page), requests: string[] = [];
  let mode: 'full' | 'empty' | 'error' = 'full';
  await page.route('**/api/dashboard/assets?*', async route => {
    const query = new URL(route.request().url()).searchParams; requests.push(query.toString());
    const dateYear = query.get('timeRange') === 'lastYear' ? year - 1 : year;
    const items = mode === 'empty' ? [] : [{ id: 970001, description, amount: 999.99, date: `${dateYear}-01-01`, category, taxRelevant: true }];
    await route.fulfill({ status: mode === 'error' ? 503 : 200, json: mode === 'error' ? { error: 'Synthetic asset interruption' } : { items, total: items.length } });
  });
  await navigate(page, '/dashboard?tab=gwg');
  const workspace = page.getByTestId('gwg-report-workspace');
  await expect(workspace.getByRole('heading', { name: 'Erfasste Wirtschaftsgüter', exact: true })).toBeVisible();
  await expect(workspace.getByText('Automatisch aus passenden Ausgaben · § 6 Abs. 2 EStG.', { exact: true })).toBeVisible();
  for (const value of ['light', 'dark'] as const) {
    await theme(page, value);
    for (const width of [320, 375, 390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 }); await geometry(page, workspace);
      await expect(workspace.getByText(description, { exact: true }).filter({ visible: true })).toBeVisible();
      if ([1440, 390].includes(width)) await capture(page, info, `financial-reports-gwg-${value}-${width}.png`, workspace);
    }
  }
  const exporter = workspace.getByRole('button', { name: 'GWG exportieren', exact: true });
  await keyboardFocus(page, exporter); expect(await exporter.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
  const downloaded = page.waitForEvent('download'); await page.keyboard.press('Enter'); const file = await downloaded;
  expect(file.suggestedFilename()).toMatch(/^gwg-verzeichnis-/); expect(await csv(file)).toContain(`${description};${category};999,99`);
  await page.getByRole('button', { name: 'Vorheriges Jahr anzeigen', exact: true }).click();
  await expect(workspace.getByText('Vorjahr', { exact: true })).toBeVisible();
  await expect.poll(() => requests.some(query => query.includes('timeRange=lastYear'))).toBe(true);
  await page.route('**/api/dashboard/summary?*', route => route.fulfill({ json: summary('thisYear', true) }));
  await navigate(page, '/dashboard?tab=eur');
  await auth.settle(); await page.goBack(); await expect(page).toHaveURL(/tab=gwg/); await expect(workspace).toBeVisible(); await settled(page); await auth.healthy();
  await auth.settle(); await page.goForward(); await expect(page).toHaveURL(/tab=eur/); await settled(page); await auth.healthy();
  await auth.settle(); await page.goBack(); await expect(page).toHaveURL(/tab=gwg/); await expect(workspace).toBeVisible(); await settled(page); await auth.healthy();
  mode = 'empty'; await navigate(page, '/dashboard?tab=gwg'); await expect(workspace.getByText('Keine GWG-Anschaffungen gefunden', { exact: true })).toBeVisible();
  mode = 'error'; await navigate(page, '/dashboard?tab=gwg');
  await expect(page.getByRole('alert').filter({ hasText: 'Die Anlagendaten konnten nicht geladen werden' })).toBeVisible(); await expect(workspace).toBeHidden();
  mode = 'full'; await navigate(page, '/dashboard?tab=gwg'); await expect(workspace).toBeVisible(); await noWrites(page, user.id, unexpected);
});
