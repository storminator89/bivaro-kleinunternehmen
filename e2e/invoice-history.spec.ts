import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';

async function account(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const password = 'SyntheticHistoryPass123!';
  const email = `history-${randomUUID()}@example.test`;
  const user = await prisma.user.create({ data: { email, name: 'Synthetic history acceptance', password: await hashPassword(password), role: 'USER' } });
  await page.goto('/login'); await page.getByLabel('E-Mail').fill(email); await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click(); await expect(page).toHaveURL(/\/dashboard/);
  return user.id;
}
async function source(page: Page) {
  const pdf = await PDFDocument.create(); pdf.addPage();
  const result = await page.request.post('/api/invoices', { data: { fileName: 'synthetic-history.pdf', invoiceNumber: 'SYNTHETIC-HISTORY-100', invoiceDate: '2026-10-20', totalAmount: 100,
    parsedData: { currency: 'EUR', taxMode: 'small-business', grossAmount: 100, netAmount: 100, taxAmount: 0, items: [{ description: 'Synthetic service', quantity: 1, unitPrice: 100, amount: 100, taxRate: 0 }] }, pdfBytes: await pdf.saveAsBase64() } });
  expect(result.status()).toBe(200); const invoice = await result.json();
  expect((await page.request.put('/api/invoices', { data: { id: invoice.id, status: 'SENT' } })).status()).toBe(200);
  return invoice.id as number;
}
async function openCancellation(page: Page) {
  const row = page.getByRole('row').filter({ hasText: 'SYNTHETIC-HISTORY-100' });
  await row.getByRole('button', { name: /Weitere Aktionen/ }).click(); await page.getByRole('menuitem', { name: 'Rechnung stornieren', exact: true }).click();
  return page.getByRole('dialog', { name: 'Rechnung stornieren', exact: true });
}

test('traces original, existing correction and separate payment without changing the original', async ({ page }, testInfo) => {
  test.setTimeout(90_000); const userId = await account(page);
  try {
    await page.setViewportSize({ width: 1440, height: 1100 });
    const invoiceId = await source(page);
    const beforeFile = await page.request.get(`/api/invoices/download?id=${invoiceId}&download=true`); expect(beforeFile.status()).toBe(200); const bytes = await beforeFile.body();
    const beforeCounter = await prisma.invoiceNumberCounter.findMany({ where: { userId } });
    await page.goto('/dashboard?tab=invoices');
    const preview = await openCancellation(page); await preview.getByRole('button', { name: 'Abbrechen', exact: true }).click(); await expect(preview).toHaveCount(0);
    expect(await prisma.invoiceNumberCounter.findMany({ where: { userId } })).toEqual(beforeCounter);
    expect(await prisma.invoice.count({ where: { userId, originalInvoiceId: invoiceId } })).toBe(0);
    expect((await page.request.put('/api/invoices', { data: { id: invoiceId, status: 'DRAFT' } })).status()).toBe(409);
    expect((await page.request.delete(`/api/invoices?id=${invoiceId}`)).status()).toBe(409);
    const payment = await page.request.post(`/api/invoices/${invoiceId}/payments`, { data: { amount: '40.00', expectedPaidCents: '0', currency: 'EUR', paidAt: '2026-10-20', source: 'MANUAL', reference: 'Synthetic payment proof', idempotencyKey: randomUUID() } }); expect(payment.status()).toBe(201);
    await page.reload(); const dialog = await openCancellation(page);
    const beforeRejected = await prisma.invoiceNumberCounter.findMany({ where: { userId } });
    await dialog.getByRole('button', { name: 'Rechnung stornieren', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(dialog.getByRole('alert')).toHaveText('Bitte einen Stornierungsgrund angeben.');
    await expect(dialog.getByLabel(/Stornierungsgrund/)).toBeFocused();
    await expect(dialog.getByLabel(/Stornierungsgrund/)).toHaveAttribute('aria-invalid', 'true');
    expect(await prisma.invoiceNumberCounter.findMany({ where: { userId } })).toEqual(beforeRejected);
    expect(await prisma.invoice.count({ where: { userId, originalInvoiceId: invoiceId } })).toBe(0);
    const missingReason = await page.request.post('/api/invoices/cancel', { data: { invoiceId } });
    expect(missingReason.status()).toBe(400); expect(await missingReason.json()).toHaveProperty('fieldErrors.cancellationReason');
    await dialog.getByLabel(/Stornierungsgrund/).fill('Synthetic service correction');
    const saved = page.waitForResponse(response => response.url().endsWith('/api/invoices/cancel') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Rechnung stornieren', exact: true }).focus(); await page.keyboard.press('Enter');
    const cancelled = await saved; expect(cancelled.status()).toBe(200); const correction = (await cancelled.json()).creditNote;
    await expect(dialog).toHaveCount(0);
    expect(await prisma.income.count({ where: { userId, invoiceId } })).toBe(1);
    expect(await prisma.paymentJournalEvent.count({ where: { userId, invoiceId } })).toBe(1);
    expect((await page.request.post('/api/invoices/cancel', { data: { invoiceId, cancellationReason: 'Synthetic duplicate' } })).status()).toBe(400);
    await page.goto(`/history?invoiceId=${invoiceId}`);
    await expect(page.getByRole('heading', { name: 'Original und Korrektur', exact: true })).toBeVisible();
    const documents = page.getByRole('list', { name: 'Dokumentbeziehungen', exact: true }); await expect(documents.getByRole('listitem')).toHaveCount(2);
    await expect(documents.getByText(correction.invoiceNumber, { exact: true })).toBeVisible();
    await expect(documents.getByText('Synthetic service correction', { exact: true })).toHaveCount(2);
    await expect(page.getByText('Storno bedeutet nicht zurückgezahlt.', { exact: true })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Gespeicherte Zahlungsnachweise' }).getByRole('listitem')).toHaveCount(1);
    const receiptEvent = page.getByRole('list', { name: 'Protokollierte Dokumentereignisse' }).getByRole('listitem').filter({ hasText: 'Zahlung erhalten' });
    await expect(receiptEvent).toHaveCount(1);
    await expect(receiptEvent.getByText('Eingegangener Betrag (Cent)', { exact: true })).toBeVisible();
    await expect(receiptEvent.getByText('Tatsächliches Eingangsdatum', { exact: true })).toBeVisible();
    await expect(receiptEvent).not.toContainText('Berichtigung / tatsächliche Rückzahlung');
    await expect(page.getByRole('list', { name: 'Protokollierte Dokumentereignisse' }).getByText('Dein Konto (im Protokoll zugeordnet)', { exact: false }).first()).toBeVisible();
    for (const id of [invoiceId, correction.id]) {
      const download = await page.request.get(`/api/invoices/download?id=${id}&download=true`); expect(download.status()).toBe(200); expect((await download.body()).subarray(0, 4).toString()).toBe('%PDF');
    }
    await page.screenshot({ path: testInfo.outputPath('history-correction-desktop.png'), fullPage: true });
    expect((await page.request.post('/api/settings', { data: { companyName: 'Synthetic changed profile', fiscalTaxRegime: 'STANDARD', fiscalEffectiveFrom: '2026-10-01' } })).status()).toBe(200);
    await page.reload(); await expect(documents.getByText('Kleinunternehmer', { exact: true }).first()).toBeVisible();
    expect(await (await page.request.get(`/api/invoices/download?id=${invoiceId}&download=true`)).body()).toEqual(bytes);
    await page.goto(`/history?invoiceId=${correction.id}`); await expect(documents.getByRole('listitem')).toHaveCount(2);
    await page.getByLabel('Protokollierte Aktion', { exact: true }).selectOption('CANCELLED'); await page.getByRole('button', { name: 'Filter anwenden', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Protokollierte Dokumentereignisse' }).getByRole('listitem')).toHaveCount(1);
    await page.goBack(); await expect(page.getByRole('list', { name: 'Protokollierte Dokumentereignisse' }).getByRole('listitem')).toHaveCount(5);
    await page.setViewportSize({ width: 390, height: 844 });
    const dark = page.getByRole('button', { name: 'Dunkles Farbschema aktivieren', exact: true }); if (await dark.isVisible()) await dark.click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(documents.getByRole('link', { name: /Gespeicherte Datei herunterladen/ }).first()).toBeVisible();
    await expect(receiptEvent.getByText('Eingegangener Betrag (Cent)', { exact: true })).toBeVisible();
    await expect(receiptEvent.getByText('Tatsächliches Eingangsdatum', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('history-correction-mobile.png'), fullPage: true });
    const finalCounter = await prisma.invoiceNumberCounter.findMany({ where: { userId } });
    await page.getByRole('button', { name: 'Alle Dokumente', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: /Dokument auswählen/ })).toBeVisible();
    expect(await prisma.invoiceNumberCounter.findMany({ where: { userId } })).toEqual(finalCounter);
  } finally { await prisma.$disconnect(); }
});

test('handles protected entry, empty results, filtering, retry and keyboard navigation', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/history'); await expect(page).toHaveURL(/\/login\?callbackUrl=/);
  await account(page);
  // Next also renders a route-announcer alert. Match the history error's
  // actual recovery actions rather than weakening either expected message.
  const historyError = page.getByRole('main').getByRole('alert').filter({ has: page.getByRole('button', { name: 'Zur Dokumentübersicht', exact: true }) });
  try {
    await page.goto('/history'); await expect(page.getByText('Keine passenden Dokumente', { exact: true })).toBeVisible();
    const invoiceId = await source(page);
    await page.goto(`/history?invoiceId=${invoiceId}&limit=1`); await expect(page.getByRole('list', { name: 'Protokollierte Dokumentereignisse' }).getByRole('listitem')).toHaveCount(1);
    await page.getByRole('navigation', { name: 'Historie blättern' }).getByRole('button', { name: 'Weiter', exact: true }).click();
    await expect(page).toHaveURL(/page=2/); await page.reload(); await expect(page.getByText('Seite 2 · 2 Einträge', { exact: true })).toBeVisible();
    await page.getByLabel('Protokollierte Aktion', { exact: true }).selectOption('DELETE'); await page.getByRole('button', { name: 'Filter anwenden', exact: true }).click();
    await expect(page.getByText('Keine protokollierten Ereignisse für diese Auswahl', { exact: true })).toBeVisible();
    await page.route('**/api/change-history?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic temporary history outage' }) }));
    await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click(); await expect(historyError).toContainText('Synthetic temporary history outage');
    await page.unroute('**/api/change-history?*'); await page.getByRole('button', { name: 'Erneut versuchen', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(page.getByText('Keine protokollierten Ereignisse für diese Auswahl', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Filter zurücksetzen', exact: true }).click(); await expect(page.getByRole('list', { name: 'Protokollierte Dokumentereignisse' }).getByRole('listitem')).toHaveCount(1);
    await page.goto('/history?invoiceId=999999999'); await expect(historyError).toContainText('Dokument nicht gefunden.');
  } finally { await prisma.$disconnect(); }
});


test('keeps genuinely missing legacy document and audit evidence unknown', async ({ page }) => {
  test.setTimeout(60_000); const userId = await account(page);
  try {
    // Only this explicit isolated runner fixture seeds a legacy row. No runtime
    // backdoor or historical event is added to manufacture missing evidence.
    const legacy = await prisma.invoice.create({ data: { userId, fileName: 'synthetic-unavailable-legacy.pdf', storedFileName: 'synthetic-unavailable-legacy.pdf', invoiceNumber: 'SYNTHETIC-LEGACY-UNKNOWN', parsedData: {}, totalAmount: null, invoiceDate: null, issuanceState: 'UNKNOWN', status: 'DRAFT' } });
    await page.goto(`/history?invoiceId=${legacy.id}`);
    const documents = page.getByRole('list', { name: 'Dokumentbeziehungen', exact: true });
    await expect(documents.getByText('Ausstellungsnachweis unbekannt', { exact: false })).toBeVisible();
    await expect(documents.getByText('Nicht dokumentiert / Altbestand', { exact: true })).toBeVisible();
    await expect(documents.getByText('Betrag unbekannt', { exact: true })).toBeVisible();
    await expect(documents.getByText('Datum unbekannt', { exact: true })).toBeVisible();
    await expect(documents.getByText('Gespeicherter Stornogrund', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Keine protokollierten Ereignisse für diese Auswahl', { exact: true })).toBeVisible();
    await expect(page.getByText('Dein Konto (im Protokoll zugeordnet)', { exact: false })).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Protokollierte Dokumentereignisse' })).toHaveCount(0);
    await expect(page.getByText('Keine Zahlungsjournal-Einträge vorhanden.', { exact: false })).toBeVisible();
    expect(await prisma.auditLog.count({ where: { userId, entityType: 'Invoice', entityId: String(legacy.id) } })).toBe(0);
    expect(await prisma.paymentJournalEvent.count({ where: { userId, invoiceId: legacy.id } })).toBe(0);
  } finally { await prisma.$disconnect(); }
});
