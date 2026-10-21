import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';

async function account(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const password = 'SyntheticGuidePass123!';
  const email = `handoff-guide-${randomUUID()}@example.test`;
  const user = await prisma.user.create({ data: { email, name: 'Synthetic handoff guide', password: await hashPassword(password), role: 'USER' } });
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return user.id;
}
async function source(page: Page, dated: boolean) {
  const id = `SYNTHETIC-GUIDE-${randomUUID()}`;
  const date = dated ? '<IssueDate>2037-05-02</IssueDate>' : '';
  const bytes = Buffer.from(`<Invoice><ID>${id}</ID>${date}<InvoiceTypeCode>380</InvoiceTypeCode><DocumentCurrencyCode>EUR</DocumentCurrencyCode><AccountingSupplierParty><Party><PartyName><Name>Synthetic seller</Name></PartyName></Party></AccountingSupplierParty><LegalMonetaryTotal><TaxExclusiveAmount currencyID="EUR">10.00</TaxExclusiveAmount><TaxInclusiveAmount currencyID="EUR">10.00</TaxInclusiveAmount><PayableAmount currencyID="EUR">10.00</PayableAmount></LegalMonetaryTotal></Invoice>`);
  const result = await page.request.post('/api/purchase-documents', { multipart: { uploadRequestId: randomUUID(), file: { name: `${dated ? 'dated' : 'undated'}-synthetic-guide.xml`, mimeType: 'application/xml', buffer: bytes } } });
  expect(result.status()).toBe(201);
  return (await result.json()).document as { id: number; revision: number };
}
async function load(page: Page) {
  await page.getByRole('button', { name: 'Vorschau laden', exact: true }).click();
  await expect(page.locator('#handoff-review-heading')).toBeFocused();
  const receipt = page.locator('details:has(> #handoff-receipt-title)');
  await expect(receipt).not.toHaveAttribute('open', '');
  await page.locator('#handoff-receipt-title').click();
}
const approval = (page: Page) => page.getByRole('checkbox', { name: /Ich habe Umfang und Warnungen/ });
const noteCheck = (page: Page) => page.getByRole('checkbox', { name: /Ich habe den Empfang außerhalb/ });
const noteSave = (page: Page) => page.getByRole('button', { name: 'Manuelle Empfangsnotiz speichern', exact: true });

test('guides real unresolved originals through back, refreshed review, ZIP and an honest manual receipt note', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const userId = await account(page);
  const dated = await source(page, true);
  await source(page, false);
  expect((await page.request.post('/api/expenses', { data: { description: 'SYNTHETIC GUIDE missing evidence', amount: '12.34', date: '2037-05-03', category: 'Synthetic', taxRelevant: false } })).ok()).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/handoff?year=2037');
  await load(page);
  await expect(page.getByRole('heading', { name: '1 offener Eingangsbeleg im Zeitraum', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '1 offener Eingangsbeleg ohne Belegdatum', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '1 fehlende Originaldatei im Paket', exact: true })).toBeVisible();
  await expect(noteCheck(page)).toBeDisabled();
  await expect(noteSave(page)).toBeDisabled();
  await expect(page.getByText('Keine Empfangsnotiz für diesen Paketstand vorhanden; Übergabe unbekannt.', { exact: false })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('accountant-guide-1440-readiness.png'), fullPage: true, animations: 'disabled' });
  const link = page.getByRole('link', { name: `Beleg #${dated.id}: dated-synthetic-guide.xml`, exact: true });
  await link.focus(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(url => url.pathname === '/purchases' && url.searchParams.size === 1 && url.searchParams.get('document') === String(dated.id));
  await expect(page.getByRole('dialog')).toBeVisible();
  // Deliberate source review does not post a financial expense.
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Beleg verwerfen', exact: true }).click();
  await dialog.getByLabel('Warum wird dieser Beleg verworfen?', { exact: true }).fill('Synthetic non-business document reviewed for handoff');
  const dismissed = page.waitForResponse(response => new URL(response.url()).pathname === `/api/purchase-documents/${dated.id}/dismiss`);
  await dialog.getByRole('button', { name: 'Verwerfen bestätigen', exact: true }).click();
  expect((await dismissed).ok()).toBe(true);
  await page.goBack();
  await expect(page).toHaveURL(/\/handoff\?year=2037$/);
  await expect(page.getByRole('textbox', { name: 'Kalenderjahr', exact: true })).toHaveValue('2037');
  await load(page);
  await expect(page.getByRole('heading', { name: '0 offene Eingangsbelege im Zeitraum', exact: true })).toBeHidden();
  await expect(page.getByRole('link', { name: `Beleg #${dated.id}: dated-synthetic-guide.xml`, exact: true })).toHaveCount(0);
  await approval(page).check();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ZIP herunterladen', exact: true }).click();
  const file = await downloaded;
  const destination = testInfo.outputPath('synthetic-guide.zip'); await file.saveAs(destination);
  const zip = await JSZip.loadAsync(await readFile(destination));
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  expect(manifest.period).toMatchObject({ from: '2037-01-01', to: '2037-12-31' });
  expect(manifest.originalCounts.notAttached).toBe(1);
  expect(manifest.scope.restorableBackup).toBe(false);
  expect(await prisma.auditLog.count({ where: { userId, entityType: 'AccountantHandoff' } })).toBe(0);
  await expect(noteCheck(page)).toBeEnabled();
  await expect(page.getByText('Download ist kein Empfangsnachweis.', { exact: false })).toBeVisible();
  await noteCheck(page).check();
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/handoff-acknowledgement' && response.request().method() === 'POST');
  await noteSave(page).click(); expect((await saved).status()).toBe(201);
  await expect(page.getByText('Von Ihnen manuell als empfangen notiert:', { exact: true })).toBeVisible();
  const note = await prisma.auditLog.findFirstOrThrow({ where: { userId, entityType: 'AccountantHandoff' } });
  expect(JSON.parse(note.metadata!)).toMatchObject({ sourceFingerprint: manifest.sourceFingerprint, acknowledgement: 'USER_RECORDED_NOT_VERIFIED' });
  await noteCheck(page).check();
  const replay = page.waitForResponse(response => new URL(response.url()).pathname === '/api/handoff-acknowledgement' && response.request().method() === 'POST');
  await noteSave(page).click();
  const replayResponse = await replay; expect(replayResponse.status()).toBe(200);
  expect(await replayResponse.json()).toMatchObject({ acknowledgedAt: note.createdAt.toISOString(), replayed: true });
  expect(await prisma.auditLog.count({ where: { userId, entityType: 'AccountantHandoff' } })).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Dunkles Farbschema aktivieren', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await noteSave(page).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('accountant-guide-390-manual-note.png'), fullPage: true, animations: 'disabled' });
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Kalenderjahr', exact: true })).toHaveValue('2037');
  await load(page);
  await expect(page.getByText('Von Ihnen manuell als empfangen notiert:', { exact: true })).toBeVisible();
  await expect(noteCheck(page)).toBeDisabled();
  await expect(approval(page)).not.toBeChecked();
});

test('keeps an unsupported empty year, handles readiness retry and stale preview 409 without carrying a receipt note forward', async ({ page }) => {
  test.setTimeout(90_000);
  await account(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/handoff?year=2091');
  let fail = true;
  await page.route('**/api/handoff-readiness?**', async route => {
    if (fail) { fail = false; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic readiness unavailable. Retry safely.' }) }); }
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Vorschau laden', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Synthetic readiness unavailable');
  await expect(page.getByRole('main').getByRole('alert')).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Kalenderjahr', exact: true })).toHaveValue('2091');
  await load(page);
  await expect(page.getByText('Keine Datensätze im gewählten Zeitraum.', { exact: false })).toBeVisible();
  await expect(page.getByText('Vollständigkeit ungeprüft', { exact: false })).toBeVisible();
  await approval(page).check();
  expect((await page.request.post('/api/incomes', { data: { description: 'SYNTHETIC GUIDE changed after preview', amount: '0.01', date: '2091-01-02' } })).ok()).toBe(true);
  let downloads = 0; page.on('download', () => downloads++);
  const conflict = page.waitForResponse(response => response.url().includes('/api/accountant-export?') && response.status() === 409);
  await page.getByRole('button', { name: 'ZIP herunterladen', exact: true }).click(); await conflict;
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Daten oder Originale haben sich seit der Vorschau geändert');
  await expect(page.getByRole('textbox', { name: 'Kalenderjahr', exact: true })).toHaveValue('2091');
  expect(downloads).toBe(0);
  await load(page);
  await expect(approval(page)).not.toBeChecked();
  await expect(noteSave(page)).toBeDisabled();
  await approval(page).check();
  await page.getByRole('button', { name: 'Vorschau aktualisieren', exact: true }).click();
  await expect(approval(page)).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'ZIP herunterladen', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
