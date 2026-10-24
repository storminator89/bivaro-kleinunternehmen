import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';
import type { ServiceArticle } from '../lib/service-articles';
import type { IncomingDocument } from '../lib/purchase-documents/types';
import type { ExpenseDetailResponse } from '../lib/expense-detail';

// Hosted-only presentation acceptance. Real isolated fixture login; synthetic
// read responses. The one upload request is held and rejected, never persisted.
const articles: ServiceArticle[] = [
  { id: 930001, name: 'SYNTHETISCHE Werkstatt-Leistung mit ausführlicher Bezeichnung', description: 'Planung und Dokumentation für einen synthetischen Auftrag. Vollständige Beschreibung bleibt auch auf schmalen Bildschirmen lesbar.', unit: 'Beratungsstunde einschließlich Dokumentation', unitPriceCents: '12345', sourcePriceCents: '14691', sourcePriceBasis: 'GROSS', taxRate: '19' },
  { id: 930002, name: 'SYNTHETISCHES Ersatzteil', description: 'Separater Artikel für die Suche.', unit: 'Stück', unitPriceCents: '2999', sourcePriceCents: '2999', sourcePriceBasis: 'NET', taxRate: '7' },
];
const receipt: IncomingDocument = {
  id: 940001, direction: 'INCOMING', reviewState: 'REVIEW', reviewStatus: 'REVIEW', parseStatus: 'FAILED', validationStatus: 'NOT_VALIDATED', revision: 1,
  originalRef: { id: 940001, fileName: 'SYNTHETISCHER-langer-Originalbeleg-zur-manuellen-Prüfung.xml', sha256: 'a'.repeat(64), bytes: 100, mediaType: 'application/xml', uploadedAt: '2026-10-01T10:00:00Z', downloadUrl: '/api/purchase-documents/940001/original' },
  supplierName: 'SYNTHETISCHE Werkstatt für ausführliche Lieferantenbezeichnungen', invoiceNumber: 'SYNTHETISCH-2026-001', invoiceDate: '2026-10-01T00:00:00Z', currency: 'EUR', totalAmount: '123.45',
  supplierId: null, selectedSupplierSnapshot: null, supplierCandidate: null, buyerCandidate: null, parserWarnings: [{ code: 'NOT_VALIDATED', message: 'Keine Konformitätsprüfung.' }], parserVersion: null, parseErrorCode: null, preview: null, businessDuplicates: [], linkedExpenseId: null, dismissedAt: null, dismissalReason: null, approvalSupported: false,
};
const expense: ExpenseDetailResponse = {
  expense: { id: 950001, description: 'SYNTHETISCHER Bürobedarf mit nachvollziehbarem Originalbezug', amount: 123.45, date: '2026-10-03T00:00:00Z', category: 'Büromaterial', taxRelevant: true, taxDeductiblePercentage: 75, depreciationYears: null, receiptFileName: null },
  source: { id: receipt.id, originalFileName: receipt.originalRef.fileName, originalSha256: receipt.originalRef.sha256, mediaType: 'application/xml', originalUrl: receipt.originalRef.downloadUrl, supplierId: null, selectedSupplierSnapshot: null, invoiceNumber: receipt.invoiceNumber, invoiceDate: receipt.invoiceDate, approvedAt: '2026-10-03T12:00:00Z' },
};
async function settled(page: Page) {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  expect(await page.evaluate(() => document.fonts.check('400 14px Inter'))).toBe(true);
}
async function navigate(page: Page, destination: string) {
  const session = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/auth/session' && new URL(page.url()).pathname === destination);
  await page.goto(destination); const response = await session; expect(response.status()).toBe(200); expect(await response.finished()).toBeNull(); await settled(page);
}
async function account(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticCatalogInbox123!';
  const user = await prisma.user.create({ data: { email: `catalog-inbox-${randomUUID()}@example.test`, name: 'Synthetic catalog inbox', password: await hashPassword(password), role: 'USER' } });
  await navigate(page, '/login');
  await page.getByLabel('E-Mail').fill(user.email); await page.getByLabel('Passwort', { exact: true }).fill(password);
  const session = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/auth/session' && new URL(page.url()).pathname === '/dashboard');
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  const response = await session; expect(response.status()).toBe(200); expect(await response.finished()).toBeNull(); await expect(page).toHaveURL(/\/dashboard/); await settled(page);
  const unexpected: string[] = [];
  await page.route('**/api/**', async route => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
    unexpected.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`); await route.abort('blockedbyclient');
  });
  return { user, unexpected };
}
async function theme(page: Page, value: 'light' | 'dark') {
  if (await page.locator('html').evaluate(element => element.classList.contains('dark')) !== (value === 'dark')) {
    await page.getByRole('button', { name: value === 'dark' ? 'Dunkles Farbschema aktivieren' : 'Helles Farbschema aktivieren', exact: true }).click();
  }
  await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${value}\\b`));
}
async function geometry(page: Page) {
  await settled(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const outside = await page.getByRole('main').evaluate(root => [...root.querySelectorAll('button,a,input,select,summary')].filter(element => {
    const box = element.getBoundingClientRect(); const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || (element.classList.contains('sr-only') && style.position === 'absolute')) return false;
    return box.width > 0 && box.height > 0 && (box.left < -1 || box.right > document.documentElement.clientWidth + 1);
  }).map(element => element.textContent?.trim().slice(0, 80)));
  expect(outside).toEqual([]);
}
async function capture(page: Page, info: TestInfo, name: string) {
  expect(info.retry).toBe(0); await geometry(page);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  const surface = await page.evaluate(() => ({ innerWidth, innerHeight, scrollY, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) }));
  expect(surface.scrollY).toBe(0); expect(surface.innerWidth * surface.height * 4).toBeLessThanOrEqual(16 * 1024 * 1024);
  const png = await page.screenshot({ path: info.outputPath(name), fullPage: true, animations: 'disabled' });
  expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(surface.clientWidth); expect(png.readUInt32BE(16)).toBeLessThanOrEqual(surface.innerWidth); expect(png.readUInt32BE(20)).toBeGreaterThanOrEqual(surface.height);
  process.stdout.write(`Catalog inbox capture proof: ${JSON.stringify({ name, ...surface, viewport: page.viewportSize(), fullPage: true, pngWidth: png.readUInt32BE(16), pngHeight: png.readUInt32BE(20), encodedBytes: png.length })}\n`);
}
async function matrix(page: Page, info: TestInfo, surface: string) {
  for (const value of ['light', 'dark'] as const) {
    await theme(page, value);
    for (const width of [320, 375, 768, 1440]) { await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 }); await geometry(page); }
    for (const width of [1440, 390]) { await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await capture(page, info, `catalog-inbox-${surface}-${value}-${width}.png`); }
  }
}
async function noWrites(userId: string, unexpected: string[]) {
  expect(unexpected).toEqual([]);
  for (const count of await Promise.all([prisma.expense.count({ where: { userId } }), prisma.income.count({ where: { userId } }), prisma.invoice.count({ where: { userId } }), prisma.purchaseDocument.count({ where: { userId } })])) expect(count).toBe(0);
}
test.afterAll(async () => { await prisma.$disconnect(); });

test('article catalog preserves exact prices, complete records, keyboard search and full light/dark surfaces', async ({ page }, info) => {
  test.setTimeout(120_000); const { user, unexpected } = await account(page);
  let mode: 'normal' | 'empty' | 'error' | 'loading' = 'normal';
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/service-articles', async route => {
    if (mode === 'loading') await gate;
    await route.fulfill({ status: mode === 'error' ? 503 : 200, json: mode === 'error' ? { error: 'Synthetic catalog interruption' } : mode === 'empty' ? [] : articles });
  });
  await navigate(page, '/customers/articles');
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.locator('#article-930001')).toContainText('123,45'); await expect(page.locator('#article-930001')).toContainText('146,91');
  await expect(page.locator('#article-930001')).toContainText(articles[0].description);
  await matrix(page, info, 'articles');
  const search = page.getByRole('textbox', { name: 'Artikel und Leistungen suchen', exact: true });
  await search.focus(); await expect(search).toBeFocused(); await search.fill('Ersatzteil');
  await expect(page.getByRole('article')).toHaveCount(1); await expect(page.locator('#article-930002')).toBeVisible(); await search.fill('');
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'CSV importieren', exact: true })).toHaveAttribute('href', '/customers/import?kind=articles');
  await expect(page.getByRole('link', { name: 'Zur Kundenverwaltung', exact: true })).toHaveAttribute('href', '/customers');
  mode = 'empty'; await navigate(page, '/customers/articles');
  await expect(page.getByRole('heading', { name: 'Noch keine Artikel oder Leistungen', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Artikel und Leistungen importieren', exact: true })).toHaveAttribute('href', '/customers/import?kind=articles');
  mode = 'error'; await navigate(page, '/customers/articles');
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Artikel und Leistungen konnten nicht geladen werden. Bitte laden Sie die Seite erneut.');
  mode = 'loading';
  try {
    await navigate(page, '/customers/articles');
    await expect(page.getByRole('main').getByRole('status').filter({ hasText: 'Katalog wird geladen' })).toHaveText('Katalog wird geladen …');
    await expect(page.getByRole('article')).toHaveCount(0);
  } finally { release(); }
  await expect(page.getByRole('article')).toHaveCount(2);
  await noWrites(user.id, unexpected);
});

test('receipt inbox retains selected queue across disclosure and keeps busy controls reachable', async ({ page }, info) => {
  test.setTimeout(120_000); const { user, unexpected } = await account(page);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let posts = 0;
  await page.route('**/api/purchase-documents*', async route => {
    if (route.request().method() === 'POST') { posts++; await gate; await route.fulfill({ status: 400, json: { error: 'Synthetisch abgelehnter Upload; kein Original gespeichert.' } }); return; }
    await route.fulfill({ json: { documents: [receipt], total: 1, page: 1, limit: 25 } });
  });
  await navigate(page, '/purchases');
  await expect(page.getByRole('list', { name: 'Eingangsbelege', exact: true })).toBeVisible();
  const disclosure = page.getByRole('button', { name: 'Original hinzufügen', exact: true });
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false'); await expect(page.locator('#incoming-upload-panel')).toBeHidden();
  await matrix(page, info, 'receipts');
  await disclosure.focus(); await page.keyboard.press('Enter');
  const panel = page.locator('#incoming-upload-panel'), picker = panel.getByLabel('Foto, PDF- oder XML-Original auswählen', { exact: true });
  await expect(panel).toBeVisible();
  await picker.setInputFiles(['first', 'second'].map(name => ({ name: `synthetic-${name}.xml`, mimeType: 'application/xml', buffer: Buffer.from(`<Synthetic>${name}</Synthetic>`) })));
  const queue = panel.getByRole('list', { name: 'Upload-Warteschlange', exact: true }); await expect(queue.getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: 'Upload ausblenden', exact: true }).click(); await expect(panel).toBeHidden();
  await page.getByRole('button', { name: 'Original hinzufügen', exact: true }).click(); await expect(queue.getByRole('listitem')).toHaveCount(2);
  await expect(queue).toContainText('synthetic-first.xml'); await expect(queue).toContainText('synthetic-second.xml'); expect(posts).toBe(0);
  await theme(page, 'light'); await page.setViewportSize({ width: 390, height: 844 }); await capture(page, info, 'catalog-inbox-upload-open-light-390.png');
  try {
    await panel.getByRole('button', { name: 'Auswahl hochladen', exact: true }).click(); await expect.poll(() => posts).toBe(1);
    const busy = page.getByRole('button', { name: 'Originale werden gespeichert…', exact: true });
    await expect(busy).toBeDisabled(); await expect(busy).toHaveAttribute('aria-expanded', 'true'); await expect(panel).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Abbrechen', exact: true })).toBeVisible(); await expect(picker).toBeDisabled();
    await theme(page, 'dark'); await page.setViewportSize({ width: 1440, height: 1000 }); await capture(page, info, 'catalog-inbox-upload-busy-dark-1440.png');
  } finally { release(); }
  await expect(page.getByRole('button', { name: 'Upload ausblenden', exact: true })).toBeEnabled();
  await expect(panel).toBeVisible();
  const failedRows = queue.getByRole('listitem');
  await expect(failedRows).toHaveCount(2);
  for (const name of ['synthetic-first.xml', 'synthetic-second.xml']) {
    const row = failedRows.filter({ hasText: name });
    await expect(row.getByText('Fehlgeschlagen', { exact: true })).toBeVisible();
    await expect(row.getByText('Die Anfrage konnte nicht abgeschlossen werden. Bitte erneut versuchen.', { exact: true })).toBeVisible();
    await expect(row.getByRole('button', { name: /^Erneut versuchen\s*:/ })).toBeEnabled();
  }
  await expect(queue.getByRole('button', { name: /^Erneut versuchen\s*:/ })).toHaveCount(2);
  expect(posts).toBe(2);
  await noWrites(user.id, unexpected);
});

test('expense detail distinguishes saved facts and immutable original provenance in both themes', async ({ page }, info) => {
  test.setTimeout(120_000); const { user, unexpected } = await account(page);
  await page.route('**/api/expenses/950001', route => route.fulfill({ json: expense }));
  await navigate(page, '/expenses/950001');
  await expect(page.getByRole('heading', { name: 'Gespeicherte Ausgabe #950001', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Verknüpftes unverändertes Original', exact: true })).toBeVisible();
  await expect(page.getByText('Zahlung und Abziehbarkeit nicht extern geprüft.', { exact: true })).toBeVisible();
  await expect(page.getByText('Gewählter Kontakt-Snapshot · nicht die Originalangabe', { exact: true })).toBeVisible();
  await expect(page.getByText('Beleggebunden: Ändern, Löschen und nachträgliche Kassenbuch-Zuordnung gesperrt.', { exact: true })).toBeVisible();
  await matrix(page, info, 'expense');
  const checksum = page.locator('summary').filter({ hasText: 'Original-Prüfsumme (SHA-256)' });
  await checksum.focus(); await page.keyboard.press('Enter'); await expect(page.getByText(receipt.originalRef.sha256, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Original herunterladen', exact: true })).toHaveAttribute('href', receipt.originalRef.downloadUrl);
  await expect(page.getByRole('link', { name: 'Eingangsbeleg ansehen', exact: true })).toHaveAttribute('href', '/purchases?document=940001');
  await noWrites(user.id, unexpected);
});
