import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// Hosted-only acceptance. Authentication uses an isolated synthetic account;
// list records are intercepted and all financial mutation requests are blocked.
// Eight exact full-page image names are a separate bounded evidence partition.
const income = {
  id: 930001, description: 'SYNTHETISCHER Zahlungseingang mit vollständig lesbarer Leistungsbeschreibung ohne abgeschnittene Inhalte',
  amount: 999999999.99, date: '2026-10-01', taxRelevant: true,
  customerName: 'SYNTHETISCHE Werkstatt für besonders lange Kundennamen',
  originInvoiceId: 930101, originInvoiceNumber: 'SYNTHETISCH-ORIGINAL-2026-001',
  allocatedInvoiceId: 930102, allocatedInvoiceNumber: 'SYNTHETISCH-AKTUELL-2026-002', allocationRevision: 3,
};
const expense = {
  id: 940001, description: 'SYNTHETISCHE beleggebundene Betriebsausgabe mit vollständig lesbarer Beschreibung und geschützter Originalzuordnung',
  amount: 999999999.99, date: '2026-10-01', taxRelevant: true, taxDeductiblePercentage: 100,
  category: 'SYNTHETISCHE langfristige betriebliche Dienstleistungen',
  sourceLinked: true, sourceDocumentId: 940101,
  receiptFileName: 'SYNTHETISCH-langer-Originalbeleg.xml', storedReceiptFileName: 'synthetic-original.xml',
};
const manualExpense = { id: 940002, description: 'SYNTHETISCHE manuelle Ausgabe', amount: 12.34, date: '2026-10-02', taxRelevant: false, category: 'Bürobedarf' };
async function settled(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  expect(await page.evaluate(() => document.fonts.check('400 14px Inter'))).toBe(true);
}
async function documentNavigation(page: Page, destination: string, navigate: () => Promise<unknown>) {
  const session = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/auth/session' && new URL(page.url()).pathname === destination);
  await navigate();
  const response = await session;
  expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
  await settled(page);
}
async function account(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticCashflowLayout123!';
  const user = await prisma.user.create({ data: { email: `cashflow-layout-${randomUUID()}@example.test`, name: 'Synthetic cashflow layout', password: await hashPassword(password), role: 'USER' } });
  await documentNavigation(page, '/login', () => page.goto('/login'));
  await page.getByLabel('E-Mail').fill(user.email); await page.getByLabel('Passwort', { exact: true }).fill(password);
  await documentNavigation(page, '/dashboard', () => page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click());
  return user;
}
async function theme(page: Page, value: 'light' | 'dark') {
  if (await page.locator('html').evaluate(element => element.classList.contains('dark')) !== (value === 'dark')) {
    await page.getByRole('button', { name: value === 'dark' ? 'Dunkles Farbschema aktivieren' : 'Helles Farbschema aktivieren', exact: true }).click();
  }
  await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${value}\\b`));
}
async function geometry(page: Page, workspace: string) {
  await settled(page);
  const result = await page.locator(workspace).evaluate(element => {
    const root = document.documentElement;
    const overflowing = [...element.querySelectorAll('button,a,input,select,summary,td,h3')].filter(node => {
      const r = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      // Screen-reader-only labels are intentionally clipped, not painted overflow.
      const screenReaderOnly = (node.classList.contains('sr-only') || style.clipPath === 'inset(50%)') && style.position === 'absolute'
        && style.overflow === 'hidden' && r.width <= 1 && r.height <= 1;
      if (screenReaderOnly) return false;
      return r.width > 0 && r.height > 0 && (r.left < -1 || r.right > root.clientWidth + 1 || node.scrollWidth > node.clientWidth + 1);
    }).map(node => ({ tag: node.tagName, text: node.textContent?.trim().slice(0, 100), width: node.clientWidth, scrollWidth: node.scrollWidth }));
    return { width: innerWidth, clientWidth: root.clientWidth, scrollWidth: root.scrollWidth, overflowing };
  });
  expect(result.scrollWidth, JSON.stringify(result)).toBeLessThanOrEqual(result.clientWidth);
  expect(result.overflowing, JSON.stringify(result)).toEqual([]);
}
async function capture(page: Page, info: TestInfo, name: string) {
  expect(info.retry).toBe(0);
  await settled(page);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
  const surface = await page.evaluate(() => ({ innerWidth, innerHeight, scrollY,
    clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
    height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    disclosures: [...document.querySelectorAll('details')].map(node => ({ label: node.querySelector('summary')?.textContent?.trim(), open: node.open })),
  }));
  expect(surface.scrollY).toBe(0); expect(surface.scrollWidth).toBeLessThanOrEqual(surface.clientWidth);
  expect(surface.innerWidth * surface.height * 4).toBeLessThanOrEqual(16 * 1024 * 1024);
  const png = await page.screenshot({ path: info.outputPath(name), fullPage: true });
  const proof = { name, ...surface, viewport: page.viewportSize(), fullPage: true,
    pngWidth: png.readUInt32BE(16), pngHeight: png.readUInt32BE(20), encodedBytes: png.length };
  expect(proof.pngHeight).toBeGreaterThanOrEqual(surface.height);
  expect(proof.pngWidth).toBeGreaterThanOrEqual(surface.clientWidth);
  expect(proof.pngWidth).toBeLessThanOrEqual(surface.innerWidth);
  process.stdout.write(`Cashflow capture proof: ${JSON.stringify(proof)}\n`);
}
async function noFinancialWrites(page: Page) {
  const unexpected: string[] = [];
  await page.route('**/api/**', async route => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
    unexpected.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    await route.abort('blockedbyclient');
  });
  return unexpected;
}

for (const kind of ['income', 'expense'] as const) {
  test(`${kind} cashflow redesign preserves readable light/dark ledgers and entry controls`, async ({ page }, info) => {
    test.setTimeout(120_000);
    const user = await account(page), unexpected = await noFinancialWrites(page);
    const plural = kind === 'income' ? 'incomes' : 'expenses';
    const noun = kind === 'income' ? 'Einnahmen' : 'Ausgaben';
    const records = kind === 'income' ? [income] : [expense, manualExpense];
    const requests: string[] = [];
    let mode: 'normal' | 'empty' | 'error' = 'normal';
    await page.route(`**/api/${plural}?**`, async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      const query = new URL(route.request().url()).searchParams;
      requests.push(`?${query.toString()}`);
      await route.fulfill({ status: mode === 'error' ? 503 : 200, json: mode === 'error' ? { error: 'Synthetic cashflow interruption' }
        : { items: mode === 'empty' ? [] : records, total: mode === 'empty' ? 0 : 21, page: Number(query.get('page') ?? 1), pageSize: Number(query.get('pageSize') ?? 10) } });
    });
    await documentNavigation(page, '/dashboard', () => page.goto(`/dashboard?tab=${plural}`));
    const workspace = page.locator('.bookkeeping-workspace');
    const entry = workspace.locator(`#${kind}-entry`);
    const visibleRecord = () => page.getByText(records[0].description, { exact: true }).filter({ visible: true });
    await expect(visibleRecord()).toBeVisible();
    await expect(entry).toBeHidden();
    for (const value of ['light', 'dark'] as const) {
      await theme(page, value);
      for (const width of [320, 375, 414, 768, 1280, 1440]) {
        await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
        await geometry(page, '.bookkeeping-workspace');
        await expect(visibleRecord()).toBeVisible();
        if (width < 1280) {
          const title = workspace.locator('article h3').first();
          expect(await title.evaluate(element => ({ whiteSpace: getComputedStyle(element).whiteSpace, overflow: getComputedStyle(element).overflow }))).toEqual({ whiteSpace: 'normal', overflow: 'visible' });
        } else {
          await expect(workspace.getByRole('columnheader')).toHaveCount(kind === 'income' ? 7 : 6);
        }
      }
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        if (width === 1440) {
          await page.getByRole('button', { name: kind === 'income' ? 'Einnahme erfassen' : 'Ausgabe erfassen', exact: true }).click();
          await expect(entry).toBeVisible(); await expect(entry).toHaveAttribute('open', '');
          await entry.locator(kind === 'income' ? '#incomeDescription' : '#description').fill('SYNTHETISCHER ungespeicherter Eintrag');
          if (kind === 'expense') {
            await entry.locator('#receipt').setInputFiles({ name: 'SYNTHETISCH-vollständig-lesbarer-langer-Belegname.xml.png', mimeType: 'image/png', buffer: Buffer.from('synthetic-selected-not-uploaded') });
            await expect(entry.getByText('SYNTHETISCH-vollständig-lesbarer-langer-Belegname.xml.png', { exact: true })).toBeVisible();
            await entry.locator('#taxRelevant').uncheck();
            await expect(entry.locator('#taxDeductiblePercentage')).toBeVisible();
            await expect(entry.locator('#depreciationYears')).toBeVisible();
            await expect(entry.getByText('Bis 800 € netto: leer lassen.', { exact: true })).toBeVisible();
            await entry.locator('#receipt').focus();
            await expect(entry.locator('#receipt')).toBeFocused();
            expect(await entry.locator('#receipt').evaluate(element => getComputedStyle(element.parentElement!).outlineStyle)).toBe('solid');
            await entry.locator('#description').focus();
          }
        } else {
          await entry.locator('summary').click();
          await expect(entry).toBeHidden();
        }
        await geometry(page, '.bookkeeping-workspace');
        await capture(page, info, `cashflow-${kind}-${value}-${width}.png`);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const search = workspace.locator(`#${kind}-search`);
    await search.focus(); await page.keyboard.press('Tab');
    await expect(workspace.locator(kind === 'income' ? '#income-customer-filter' : '#expense-category-filter')).toBeFocused();
    expect(await search.evaluate(element => getComputedStyle(element).fontSize)).toBe('16px');
    await search.fill('synthetic');
    await expect.poll(() => requests.some(query => query.includes('search=synthetic'))).toBe(true);
    await workspace.getByRole('button', { name: 'Suche leeren', exact: true }).click();
    await expect(search).toHaveValue('');
    await workspace.locator(`#${kind}-date-filter`).selectOption('thisYear');
    await expect.poll(() => requests.some(query => query.includes('dateRange=thisYear'))).toBe(true);
    await workspace.locator(`#${kind}-tax-filter`).selectOption('yes');
    await expect.poll(() => requests.some(query => query.includes('taxRelevant=yes'))).toBe(true);
    await workspace.getByRole('button', { name: 'Filter zurücksetzen', exact: true }).click();
    await expect(workspace.locator(`#${kind}-date-filter`)).toHaveValue('all');
    await expect(workspace.locator(`#${kind}-tax-filter`)).toHaveValue('all');
    for (const size of ['20', '50', '10']) {
      await workspace.locator(`#${plural}-page-size`).selectOption(size);
      await expect(workspace.locator(`#${plural}-page-size`)).toHaveValue(size);
      await expect.poll(() => requests.some(query => query.includes(`pageSize=${size}`))).toBe(true);
    }
    await workspace.getByRole('button', { name: 'Weiter', exact: true }).click();
    await expect.poll(() => requests.some(query => query.includes('page=2'))).toBe(true);
    await expect(workspace.getByText('Seite 2 von 3 · 21 Einträge', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const label of ['Datum', 'Beschreibung', 'Betrag']) {
      const head = workspace.getByRole('columnheader').filter({ has: page.getByRole('button', { name: new RegExp(`^${label}:`) }) });
      await head.getByRole('button').click(); await expect(head).toHaveAttribute('aria-sort', /ascending|descending/);
    }
    if (kind === 'income') {
      await expect(workspace.getByRole('link', { name: income.originInvoiceNumber, exact: true }).filter({ visible: true })).toHaveAttribute('href', `/history?invoiceId=${income.originInvoiceId}`);
      await expect(workspace.getByRole('link', { name: income.allocatedInvoiceNumber, exact: true }).filter({ visible: true })).toHaveAttribute('href', `/history?invoiceId=${income.allocatedInvoiceId}`);
    } else {
      const row = workspace.getByRole('row').filter({ hasText: expense.description });
      await expect(row.getByRole('link', { name: `Gespeicherte Ausgabe zu ${expense.description} ansehen`, exact: true })).toHaveAttribute('href', `/expenses/${expense.id}`);
      await expect(row.getByRole('button', { name: /bearbeiten|löschen|duplizieren/i })).toHaveCount(0);
    }
    // Editing opens existing presentation only. Cancel before any financial write.
    await workspace.getByRole('button', { name: `${kind === 'income' ? income.description : manualExpense.description} bearbeiten`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: kind === 'income' ? 'Einnahme bearbeiten' : 'Ausgabe bearbeiten', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click(); await expect(dialog).toBeHidden();
    mode = 'empty'; await documentNavigation(page, '/dashboard', () => page.goto(`/dashboard?tab=${plural}`));
    await expect(workspace.getByText(`Keine ${noun} vorhanden. Erfassen Sie Ihre erste ${kind === 'income' ? 'Einnahme' : 'Ausgabe'} oben.`, { exact: true })).toBeVisible();
    mode = 'error'; await documentNavigation(page, '/dashboard', () => page.reload());
    await expect(workspace.getByRole('alert').filter({ hasText: `${noun} konnten nicht geladen werden.` })).toBeVisible();
    mode = 'normal'; await workspace.getByRole('button', { name: 'Erneut laden', exact: true }).click();
    await expect(visibleRecord()).toBeVisible();
    expect(unexpected).toEqual([]);
    expect(await prisma.income.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.expense.count({ where: { userId: user.id } })).toBe(0);
  });
}
