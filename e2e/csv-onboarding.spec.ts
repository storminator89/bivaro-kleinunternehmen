import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../lib/password';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';

// Run only through the hosted supported runner: one runner-owned temporary DB,
// synthetic tenants, no third-party migration service or real customer data.
async function account(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const password = 'SyntheticCsvImport123!';
  const user = await prisma.user.create({ data: { email: `csv-${randomUUID()}@example.test`, password: await hashPassword(password), name: 'Synthetic CSV acceptance' } });
  await page.goto('/login'); await page.getByLabel('E-Mail').fill(user.email); await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click(); await expect(page).toHaveURL(/\/dashboard/);
  return user.id;
}
async function cleanup(userId: string) {
  await prisma.dataImportBatch.deleteMany({ where: { userId } }); await prisma.serviceArticle.deleteMany({ where: { userId } });
  await prisma.auditLog.deleteMany({ where: { userId } }); await prisma.customer.deleteMany({ where: { userId } }); await prisma.settings.deleteMany({ where: { userId } }); await prisma.user.delete({ where: { id: userId } });
}
// The named step list belongs to the wizard's immediate container; Next's
// global route announcer is deliberately outside this application-owned scope.
function csvWizard(page: Page) {
  return page.getByRole('list', { name: 'Importschritte', exact: true }).locator('..');
}
function previewRow(page: Page, kind: 'Kunden' | 'Artikel und Leistungen', summary: string) {
  return page.getByRole('region', { name: `Vorschau: ${kind}`, exact: true }).locator('details')
    .filter({ has: page.locator('summary').getByText(summary, { exact: true }) });
}
async function upload(page: Page, csv: string) {
  await page.getByLabel('CSV-Datei auswählen', { exact: true }).setInputFiles({ name: 'synthetic-only.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await page.getByRole('button', { name: 'Vorschau prüfen', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Vorschau:/ })).toBeVisible();
}

test('customer template, mapping, cancellation, lost response replay and reload recover without duplicate writes', async ({ page }, testInfo) => {
  test.setTimeout(90_000); const userId = await account(page);
  try {
    await page.setViewportSize({ width: 375, height: 812 }); await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/customers'); await page.getByRole('link', { name: 'CSV importieren', exact: true }).click();
    const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: 'CSV-Vorlage herunterladen', exact: true }).click();
    expect((await downloaded).suggestedFilename()).toBe('bivaro-kunden-vorlage.csv');
    await page.getByLabel('CSV-Datei auswählen', { exact: true }).setInputFiles({ name: 'too-large.csv', mimeType: 'text/csv', buffer: Buffer.alloc(256 * 1024 + 1) });
    await expect(csvWizard(page)).toHaveCount(1);
    await expect(csvWizard(page).getByRole('alert')).toContainText('256 KiB');
    const csv = 'Firma;Mail;PLZ;Stadt\nSynthetische Werkstatt;werkstatt@example.test;00123;Musterstadt\nSynthetische Werkstatt;werkstatt@example.test;00123;Musterstadt\nFehlerhafter Kontakt;keine-email;00123;Musterstadt';
    await upload(page, csv);
    await expect(page.getByRole('button', { name: '1 Datensätze jetzt importieren', exact: true })).toBeDisabled();
    expect(await prisma.customer.count({ where: { userId } })).toBe(0); expect(await prisma.dataImportBatch.count({ where: { userId } })).toBe(0);
    await page.getByRole('button', { name: 'Zurück zur Zuordnung', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(page.getByLabel('E-Mail (optional)', { exact: true })).toHaveValue('1');
    await page.getByRole('button', { name: 'Vorschau prüfen', exact: true }).click();
    await page.getByRole('link', { name: 'Abbrechen', exact: true }).click(); await expect(page).toHaveURL(/\/customers$/);
    expect(await prisma.customer.count({ where: { userId } })).toBe(0);
    await page.getByRole('link', { name: 'CSV importieren', exact: true }).click(); await upload(page, csv);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Datei auswählen', exact: true })).toBeVisible();
    expect(await prisma.customer.count({ where: { userId } })).toBe(0);
    await upload(page, csv);
    const customerRow = previewRow(page, 'Kunden', 'Zeile 2 · Synthetische Werkstatt');
    await expect(customerRow).toHaveCount(1);
    await customerRow.locator('summary').click();
    await expect(customerRow.getByText('00123', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('csv-customer-preview-mobile.png'), fullPage: true });
    let lost = false;
    await page.route('**/api/data-import', async route => {
      if (route.request().method() === 'POST' && route.request().postDataJSON().action === 'confirm' && !lost) { lost = true; await route.fetch(); await route.abort('failed'); }
      else await route.continue();
    });
    await csvWizard(page).getByRole('checkbox').check(); await page.getByRole('button', { name: '1 Datensätze jetzt importieren', exact: true }).click();
    await expect(csvWizard(page).getByRole('alert')).toContainText('Keine eindeutige Antwort');
    expect(await prisma.customer.count({ where: { userId } })).toBe(1);
    await page.getByRole('button', { name: 'Mit derselben Importkennung erneut bestätigen', exact: true }).click();
    await expect(page.getByRole('heading', { name: '1 Kunden übernommen', exact: true })).toBeVisible();
    expect(await prisma.customer.count({ where: { userId } })).toBe(1); expect(await prisma.dataImportBatch.count({ where: { userId } })).toBe(1);
    await page.reload(); await expect(page.getByRole('heading', { name: '1 Kunden übernommen', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Zur Kundenliste', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Synthetische Werkstatt', exact: true })).toBeVisible();
    expect(await prisma.invoice.count({ where: { userId } })).toBe(0); expect(await prisma.income.count({ where: { userId } })).toBe(0);
  } finally { await cleanup(userId); }
});

test('article CSV makes exact reusable positions without changing unknown fiscal profile or issuing documents', async ({ page }, testInfo) => {
  test.setTimeout(90_000); const userId = await account(page);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/customers/articles'); await page.getByRole('link', { name: 'CSV importieren', exact: true }).click();
    await expect(page.getByLabel('Datenart', { exact: true })).toHaveValue('articles');
    await upload(page, 'Name;Beschreibung;Einheit;Preis;Preisbasis;Steuersatz\nSynthetische Wartung;Wartung vor Ort;Stunde;119,00;GROSS;19\nUnbekannter Preis;Nicht null;Stück;;NET;0\nKostenfreie Prüfung;Prüfung ohne Preis;Stück;0;NET;0');
    const maintenance = previewRow(page, 'Artikel und Leistungen', 'Zeile 2 · Synthetische Wartung');
    const unknown = previewRow(page, 'Artikel und Leistungen', 'Zeile 3 · Unbekannter Preis');
    const free = previewRow(page, 'Artikel und Leistungen', 'Zeile 4 · Kostenfreie Prüfung');
    for (const row of [maintenance, unknown, free]) await expect(row).toHaveCount(1);
    await maintenance.locator('summary').click();
    await expect(maintenance.getByText('Gespeicherter Netto-Einzelpreis', { exact: true })).toBeVisible();
    await expect(maintenance.getByText('100,00 € · 19 % Steuer (Quelle)', { exact: true })).toBeVisible();
    await unknown.locator('summary').click();
    await expect(unknown.locator('summary')).toContainText('Fehler – ausgelassen');
    await expect(unknown.getByText('Gespeicherter Netto-Einzelpreis', { exact: true })).toHaveCount(0);
    await free.locator('summary').click();
    await expect(free.locator('summary')).toContainText('Wird angelegt');
    await expect(free.getByText('Gespeicherter Netto-Einzelpreis', { exact: true })).toBeVisible();
    await expect(free.getByText('0,00 € · 0 % Steuer (Quelle)', { exact: true })).toBeVisible();
    expect(await prisma.serviceArticle.count({ where: { userId } })).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await csvWizard(page).getByRole('checkbox').check(); await page.getByRole('button', { name: '2 Datensätze jetzt importieren', exact: true }).click();
    await expect(page.getByRole('heading', { name: '2 Artikel und Leistungen übernommen', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Zum Artikelkatalog', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Synthetische Wartung', exact: true })).toBeVisible();
    const article = await prisma.serviceArticle.findFirstOrThrow({ where: { userId, nameKey: 'synthetische wartung' } });
    expect(article).toMatchObject({ unitPriceCents: '10000', sourcePriceCents: '11900', sourcePriceBasis: 'GROSS', taxRate: '19' });
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: testInfo.outputPath('csv-service-catalog-desktop.png'), fullPage: true });
    await page.goto('/dashboard/invoices/new');
    await page.getByRole('button', { name: 'Aus Artikelkatalog übernehmen', exact: true }).click();
    await page.getByRole('button', { name: 'Synthetische Wartung als Position übernehmen', exact: true }).click();
    await expect(page.locator('#invoice-item-description-0')).toHaveValue('Wartung vor Ort');
    await expect(page.locator('#invoice-item-price-0')).toHaveValue('100'); await expect(page.locator('#invoice-item-tax-0')).toHaveValue('0');
    await page.goto('/dashboard/quotes/new');
    await page.getByRole('button', { name: 'Aus Artikelkatalog übernehmen', exact: true }).click();
    await page.getByRole('button', { name: 'Synthetische Wartung als Position übernehmen', exact: true }).click();
    await expect(page.locator('#quote-item-0-description')).toHaveValue('Wartung vor Ort');
    await expect(page.locator('#quote-item-0-unit-price')).toHaveValue('100');
    await expect(page.locator('#quote-item-0-tax')).toHaveValue('0');
    expect((await prisma.settings.findUnique({ where: { userId } }))?.fiscalTaxRegime ?? 'UNSET').toBe('UNSET');
    expect(await prisma.invoice.count({ where: { userId } })).toBe(0); expect(await prisma.income.count({ where: { userId } })).toBe(0);
    const backup = await (await page.request.get('/api/backup')).json(); expect(backup.data.serviceArticles).toHaveLength(2);
    expect(backup.manifest.modelCoverage.find((row: { model: string }) => row.model === 'ServiceArticle').mode).toBe('included');
  } finally { await cleanup(userId); }
});
