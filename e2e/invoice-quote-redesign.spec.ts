import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// Hosted acceptance only: real fixture authentication, intercepted presentation
// records. Existing real payment/conversion suites remain unchanged and run too.
const record = {
  id: 910001, type: 'INVOICE', invoiceNumber: 'SYNTHETISCH-2026-LANGER-BELEGNAME',
  fileName: 'SYNTHETISCH-Leistungsnachweis-mit-langem-Dateinamen.pdf',
  uploadedAt: '2026-10-01T10:00:00.000Z', invoiceDate: '2026-10-01', dueDate: '2026-10-15',
  totalAmount: 999999999.99, status: 'SENT', issuanceState: 'ISSUED', hasPdfFile: true,
  customer: { id: 910001, name: 'SYNTHETISCHE Werkstatt für lange Kundennamen' },
  paymentSummary: { totalCents: '99999999999', paidCents: '4000', openCents: '99999995999', paid: false, paymentState: 'PARTIAL' },
};
const quote = {
  ...record, type: 'QUOTE', id: 920001, invoiceNumber: 'SYNTHETISCH-ANGEBOT-2026-LANG', status: 'ACCEPTED',
  validUntil: '2026-10-31', quoteFollowUpOn: '2026-10-23', quoteResponseNote: 'Nur interne synthetische Planung.',
  parsedData: { taxMode: 'small-business', items: [{ description: 'Synthetische Leistung', quantity: 1, unitPrice: 12.34, unit: 'Stück', taxRate: 0 }] },
};
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
  const password = 'SyntheticLedgerLayout123!';
  const user = await prisma.user.create({ data: { email: `ledger-layout-${randomUUID()}@example.test`, name: 'Synthetic ledger layout', password: await hashPassword(password), role: 'USER' } });
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
  process.stdout.write(`Invoice quote capture proof: ${JSON.stringify(proof)}\n`);
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

test('invoice redesign retains full light/dark ledger pages and narrow-width controls', async ({ page }, info) => {
  test.setTimeout(120_000);
  const user = await account(page), unexpected = await noFinancialWrites(page);
  const requests: string[] = [];
  let mode: 'normal' | 'empty' | 'error' = 'normal';
  await page.route('**/api/invoices?**', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const query = new URL(route.request().url()).searchParams;
    requests.push(`?${query.toString()}`);
    await route.fulfill({ status: mode === 'error' ? 503 : 200, json: mode === 'error' ? { error: 'Synthetic list interruption' }
      : { items: mode === 'empty' ? [] : [record], total: mode === 'empty' ? 0 : 21, page: Number(query.get('page') ?? 1), pageSize: Number(query.get('pageSize') ?? 10) } });
  });
  await documentNavigation(page, '/dashboard', () => page.goto('/dashboard?tab=invoices'));
  await expect(page.getByText(record.invoiceNumber, { exact: true }).filter({ visible: true })).toBeVisible();
  for (const value of ['light', 'dark'] as const) {
    await theme(page, value);
    for (const width of [320, 375, 414, 768, 1440, 1599, 1600]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      await geometry(page, '.invoice-workspace');
      const rail = await page.locator('.invoice-workspace').evaluate(element => {
        const ledger = element.querySelector('.invoice-ledger')!.getBoundingClientRect(), tools = element.querySelector('aside')!.getBoundingClientRect();
        return { beside: tools.left >= ledger.right - 1, after: tools.top >= ledger.bottom - 1 };
      });
      expect(width >= 1600 ? rail.beside : rail.after).toBe(true);
      if (width >= 1280) {
        expect(await page.getByRole('button', { name: `Details zu Rechnung ${record.invoiceNumber}`, exact: true }).evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      }
    }
    for (const width of [1600, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await geometry(page, '.invoice-workspace'); await capture(page, info, `invoice-redesign-${value}-${width}.png`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const label of ['Rechnung', 'Datum', 'Betrag']) {
    await page.getByRole('columnheader').getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByRole('columnheader').filter({ has: page.getByRole('button', { name: label, exact: true }) })).toHaveAttribute('aria-sort', /ascending|descending/);
  }
  await page.locator('#invoice-search').fill('synthetic');
  await expect.poll(() => requests.some(value => value.includes('search=synthetic'))).toBe(true);
  await page.locator('#invoice-date-filter').selectOption('thisYear');
  await expect.poll(() => requests.some(value => value.includes('dateRange=thisYear'))).toBe(true);
  await page.getByRole('button', { name: 'Teilbezahlt', exact: true }).click();
  await expect.poll(() => requests.some(value => value.includes('paidStatus=partial'))).toBe(true);
  await page.locator('#invoices-page-size').selectOption('20');
  await expect.poll(() => requests.some(value => value.includes('pageSize=20'))).toBe(true);
  await expect(page.locator('#invoices-page-size')).toHaveValue('20');
  await page.getByRole('button', { name: 'Weiter', exact: true }).click();
  await expect.poll(() => requests.some(value => value.includes('page=2'))).toBe(true);
  await expect(page.getByText('21–21 von 21 Rechnungen · Seite 2 von 2', { exact: true })).toBeVisible();
  const disclosure = page.locator('details.invoice-import');
  await disclosure.locator('summary').click(); await expect(disclosure).toHaveAttribute('open', '');
  await disclosure.locator('input[type="file"]').setInputFiles({ name: 'synthetic-layout.xml', mimeType: 'application/xml', buffer: Buffer.from('<synthetic/>') });
  await expect(disclosure).toHaveAttribute('open', '');
  expect(await disclosure.locator('input[type="file"]').evaluate((element: HTMLInputElement) => element.files?.[0]?.name)).toBe('synthetic-layout.xml');
  // The file is selected, not imported; no document or financial mutation occurs.
  mode = 'empty'; await documentNavigation(page, '/dashboard', () => page.goto('/dashboard?tab=invoices'));
  await expect(page.getByRole('heading', { name: 'Ihre erste Rechnung beginnt hier', exact: true }).filter({ visible: true })).toBeVisible();
  mode = 'error'; await documentNavigation(page, '/dashboard', () => page.reload());
  await expect(page.getByRole('alert').filter({ hasText: 'Rechnungen konnten nicht geladen werden.' })).toBeVisible();
  mode = 'normal'; await page.getByRole('button', { name: 'Erneut laden', exact: true }).click();
  await expect(page.getByText(record.invoiceNumber, { exact: true }).filter({ visible: true })).toBeVisible();
  expect(unexpected).toEqual([]);
  expect(await prisma.invoice.count({ where: { userId: user.id } })).toBe(0);
  expect(await prisma.income.count({ where: { userId: user.id } })).toBe(0);
});

test('quote redesign retains full light/dark continuation rows and existing noncommitting actions', async ({ page }, info) => {
  test.setTimeout(120_000);
  const user = await account(page), unexpected = await noFinancialWrites(page);
  const requests: string[] = [];
  let mode: 'normal' | 'empty' | 'error' = 'normal';
  await page.route('**/api/quotes?**', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const query = new URL(route.request().url()).searchParams;
    requests.push(`?${query.toString()}`);
    await route.fulfill({ status: mode === 'error' ? 503 : 200, json: mode === 'error' ? { error: 'Synthetic list interruption' }
      : { items: mode === 'empty' ? [] : [quote], total: mode === 'empty' ? 0 : 41, page: Number(query.get('page') ?? 1), pageSize: Number(query.get('pageSize') ?? 20),
        workflowCounts: { FOLLOW_UP: 0, NEEDS_RESPONSE: 0, READY_TO_INVOICE: 1 }, workflowDate: '2026-10-23' } });
  });
  await documentNavigation(page, '/dashboard', () => page.goto('/dashboard?tab=quotes'));
  await expect(page.getByText(quote.invoiceNumber, { exact: true }).filter({ visible: true })).toBeVisible();
  for (const value of ['light', 'dark'] as const) {
    await theme(page, value);
    for (const width of [320, 375, 414, 768, 1440, 1599, 1600]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 }); await geometry(page, 'div:has(> .ledger-list #quote-next-heading)');
      if (width >= 1280) await expect(page.getByRole('columnheader')).toHaveCount(6);
    }
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await geometry(page, 'div:has(> .ledger-list #quote-next-heading)'); await capture(page, info, `quote-redesign-${value}-${width}.png`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const [label, status] of [['1 · Nachfassen', 'FOLLOW_UP'], ['2 · Rückmeldung klären', 'NEEDS_RESPONSE'], ['3 · Rechnung vorbereiten', 'READY_TO_INVOICE']]) {
    await page.getByRole('button', { name: new RegExp(label.replace('·', '\\·')) }).click();
    await expect(page).toHaveURL(new RegExp(`quoteStatus=${status}`));
  }
  await page.locator('#quote-search').fill('synthetic'); await expect(page).toHaveURL(/quoteSearch=synthetic/);
  await page.getByRole('button', { name: 'Filter zurücksetzen', exact: true }).click();
  await expect(page.locator('#quote-search')).toHaveValue('');
  await page.locator('#quote-status-filter').selectOption('ACCEPTED');
  await expect.poll(() => requests.some(value => value.includes('status=ACCEPTED'))).toBe(true);
  await page.locator('#quotes-page-size').selectOption('50');
  await expect.poll(() => requests.some(value => value.includes('pageSize=50'))).toBe(true);
  await expect(page.locator('#quotes-page-size')).toHaveValue('50');
  const workflow = page.getByRole('button', { name: 'Rückmeldung & Nachfassen', exact: true }).filter({ visible: true });
  await workflow.click();
  const dialog = page.getByRole('dialog', { name: 'Rückmeldung & Nachfassen', exact: true });
  await dialog.getByLabel('Interne Notiz / Grund der Rückmeldung', { exact: true }).fill('Unsaved synthetic note');
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(dialog).toBeHidden(); await workflow.click();
  await expect(dialog.getByLabel('Interne Notiz / Grund der Rückmeldung', { exact: true })).toHaveValue(quote.quoteResponseNote);
  await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: `Angebot ${quote.invoiceNumber} in Rechnung umwandeln`, exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Rechnungsentwurf prüfen?', exact: true });
  await expect(confirmation).toContainText('keine Zahlung oder Einnahme');
  await confirmation.getByRole('button', { name: 'Entwurf prüfen', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Rechnung erstellen', exact: true });
  await expect(editor.locator('#invoice-item-description-0')).toHaveValue('Synthetische Leistung');
  await page.keyboard.press('Escape'); await expect(editor).toBeHidden();
  await page.getByRole('button', { name: `Angebot ${quote.invoiceNumber} löschen`, exact: true }).click();
  const deletion = page.getByRole('dialog', { name: 'Angebot löschen?', exact: true });
  await deletion.getByRole('button', { name: 'Abbrechen', exact: true }).click(); await expect(deletion).toBeHidden();
  mode = 'empty'; await documentNavigation(page, '/dashboard', () => page.goto('/dashboard?tab=quotes'));
  await expect(page.getByText('Keine passenden Angebote vorhanden.', { exact: true }).filter({ visible: true })).toBeVisible();
  mode = 'error'; await documentNavigation(page, '/dashboard', () => page.reload());
  await expect(page.getByRole('button', { name: 'Erneut laden', exact: true })).toBeVisible();
  mode = 'normal'; await page.getByRole('button', { name: 'Erneut laden', exact: true }).click();
  await expect(page.getByText(quote.invoiceNumber, { exact: true }).filter({ visible: true })).toBeVisible();
  expect(unexpected).toEqual([]);
  expect(await prisma.invoice.count({ where: { userId: user.id } })).toBe(0);
  expect(await prisma.income.count({ where: { userId: user.id } })).toBe(0);
});
