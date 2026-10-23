import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';

// The supported runner owns an isolated temporary database. No real accounts,
// banks or transfers; setup financial writes use only existing HTTP routes.
async function account(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const password = 'SyntheticBankPreview123!';
  const user = await prisma.user.create({ data: { email: `bank-csv-${randomUUID()}@example.test`, name: 'Synthetic bank preview', password: await hashPassword(password), role: 'USER' } });
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(user.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return user.id;
}
async function invoice(page: Page, invoiceNumber: string) {
  const pdf = await PDFDocument.create(); pdf.addPage();
  const response = await page.request.post('/api/invoices', { data: { fileName: `${invoiceNumber}.pdf`, invoiceNumber, invoiceDate: '2026-10-01', totalAmount: 120, parsedData: { currency: 'EUR', taxMode: 'small-business', taxAmount: 0 }, pdfBytes: await pdf.saveAsBase64() } });
  expect(response.status()).toBe(200);
  return response.json() as Promise<{ id: number }>;
}
async function snapshot(page: Page, userId: string, invoiceId?: number) {
  const paymentResponse = invoiceId ? await page.request.get(`/api/invoices/${invoiceId}/payments`, { headers: { 'X-Bivaro-Payment-Contract': '2' } }) : null;
  if (paymentResponse) expect(paymentResponse.status()).toBe(200);
  return { payments: paymentResponse ? await paymentResponse.json() : null, incomeCount: await prisma.income.count({ where: { userId } }), expenseCount: await prisma.expense.count({ where: { userId } }), invoiceCount: await prisma.invoice.count({ where: { userId } }), auditCount: await prisma.auditLog.count({ where: { userId } }) };
}
async function upload(page: Page, contents: string, name = 'synthetic-bank-only.csv') {
  await page.getByLabel('Bank-CSV auswählen', { exact: true }).setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(contents, 'utf8') });
  await expect(page.getByRole('heading', { name: 'Spalten zuordnen', exact: true })).toBeVisible();
  await page.getByLabel('Kontoalias *', { exact: true }).fill('Synthetic Geschäftskonto');
}
// Next's global route announcer is outside the application-owned workspace.
function bankWorkspace(page: Page) {
  return page.getByRole('list', { name: 'Bank-CSV Schritte', exact: true }).locator('..').locator('..');
}
async function preview(page: Page) {
  await page.getByRole('button', { name: 'Vorschau prüfen', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Vorschau prüfen', exact: true })).toBeFocused();
}
const single = 'Buchungsdatum;Betrag;Währung;Gegenpartei;Verwendungszweck;Umsatz-ID\n21.10.2026;40,00;EUR;Synthetische Werkstatt;RE-BANK-120;synthetic-1';

test('desktop preview explains partial suggestions, duplicate and manual-payment cautions without writes', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const userId = await account(page);
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.emulateMedia({ colorScheme: 'light' });
  const created = await invoice(page, 'RE-BANK-120');
  const paid = await page.request.post(`/api/invoices/${created.id}/payments`, { data: { amount: '40.00', currency: 'EUR', paidAt: '2026-10-20', source: 'MANUAL', reference: 'RE-BANK-120', expectedPaidCents: '0', idempotencyKey: randomUUID() } });
  expect(paid.status()).toBe(201);
  const before = await snapshot(page, userId, created.id);
  const writes: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  await page.goto('/dashboard?tab=invoices'); await page.getByRole('link', { name: 'Bank-CSV prüfen', exact: true }).click();
  await upload(page, `${single}\n21.10.2026;40,00;EUR;Synthetische Werkstatt;RE-BANK-120;synthetic-1\n20.10.2026;40,00;EUR;Synthetische Werkstatt;RE-BANK-120;synthetic-prior\n31.02.2026;10,00;EUR;Fehlerfall;RE-BANK-120;synthetic-bad\n21.10.2026;-5,00;EUR;Bankgebühr;Gebühr;synthetic-fee\n21.10.2026;30,00;USD;Fremdwährung;RE-BANK-120;synthetic-fx\n22.10.2026;30,00;EUR;Synthetische Werkstatt;RE-BANK-120;synthetic-new-partial`);
  await page.screenshot({ path: testInfo.outputPath('bank-csv-mapping-desktop-1440.png'), fullPage: true });
  await preview(page);
  await expect(page.getByText(/Mögliche Dubletten wurden markiert/u)).toBeVisible();
  await expect(page.getByRole('article', { name: 'Bankzeile 5', exact: true })).toContainText('Fehlerhaft');
  await expect(page.getByRole('article', { name: 'Bankzeile 6', exact: true })).toContainText('kein EUR-Eingang');
  await page.getByRole('button', { name: 'Rechnungsvorschläge prüfen', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Rechnungsvorschläge geprüft', exact: true })).toBeFocused();
  await expect(page.getByRole('article', { name: 'Bankzeile 2', exact: true }).getByRole('heading', { name: 'RE-BANK-120', exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Bankzeile 4', exact: true })).toContainText(/bereits|vorhanden|manuell/iu);
  const partial = page.getByRole('article', { name: 'Bankzeile 8', exact: true });
  await expect(partial).toContainText('mögliche Teilzahlung');
  await expect(partial).toContainText('Nur Vorschlag · keine Zahlung erfasst');
  await expect(partial).toContainText('Geprüfter Rechnungsrest: 80,00 €');
  const duplicate = page.getByRole('article', { name: 'Bankzeile 2', exact: true });
  const details = duplicate.locator('details');
  await expect(details).not.toHaveAttribute('open', '');
  const disclosure = duplicate.getByLabel('Prüfhinweise zu Bankzeile 2', { exact: true });
  await disclosure.focus(); await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  await expect(duplicate.getByText('Die externe Buchungs-ID kommt mehrfach vor. Bitte mögliche Doppelbuchung oder widersprüchliche Daten prüfen.', { exact: true })).toBeVisible();
  await page.keyboard.press('Enter'); await expect(details).not.toHaveAttribute('open', '');
  await expect(page.getByText('Nur Vorschau · keine Buchung', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('bank-csv-desktop-preview.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: testInfo.outputPath('bank-csv-results-mobile-390.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(await snapshot(page, userId, created.id)).toEqual(before);
  expect(writes).toEqual([]);
  await page.getByRole('button', { name: 'Zuordnung ändern', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Vorschau prüfen', exact: true })).toBeFocused();
  await expect(page.getByLabel('Kontoalias *', { exact: true })).toHaveValue('Synthetic Geschäftskonto');
  await preview(page); await page.getByRole('button', { name: 'Datei verwerfen', exact: true }).click();
  await expect(page.getByLabel('Bank-CSV auswählen', { exact: true })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Spalten zuordnen', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'CSV aus deinem Bankexport', exact: true })).toBeVisible();
  expect(await snapshot(page, userId, created.id)).toEqual(before);
});

for (const width of [360, 390]) {
  test(`mobile ${width}: empty state, error retry, keyboard back and reload remain read-only`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const userId = await account(page);
    const before = await snapshot(page, userId);
    await page.setViewportSize({ width, height: 844 }); await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/bank-csv');
    await page.getByLabel('Bank-CSV auswählen', { exact: true }).setInputFiles({ name: 'too-large.csv', mimeType: 'text/csv', buffer: Buffer.alloc(2 * 1024 * 1024 + 1) });
    await expect(bankWorkspace(page).getByRole('alert')).toContainText('2 MiB');
    await upload(page, single); await preview(page);
    let fail = true;
    await page.route('**/api/invoices?*', route => fail ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }) : route.continue());
    await page.getByRole('button', { name: 'Rechnungsvorschläge prüfen', exact: true }).click();
    await expect(bankWorkspace(page).getByRole('alert')).toContainText('Vorschau bleibt erhalten');
    fail = false;
    await page.getByRole('button', { name: 'Rechnungsvorschläge erneut prüfen', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Rechnungsvorschläge geprüft', exact: true })).toBeFocused();
    await expect(page.getByText('0 Rechnungen anhand ihres Zahlungsjournals verglichen.', { exact: false })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Bankzeile 2', exact: true })).toContainText('Kein eindeutiger Rechnungsvorschlag');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`bank-csv-${width}-empty-match.png`), fullPage: true });
    await page.getByRole('button', { name: 'Zuordnung ändern', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Vorschau prüfen', exact: true })).toBeFocused();
    await page.getByRole('link', { name: 'Rechnungen', exact: true }).click(); await expect(page).toHaveURL(/\/dashboard\?tab=invoices$/u);
    await page.goBack(); await expect(page.getByRole('heading', { name: 'CSV aus deinem Bankexport', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Spalten zuordnen', exact: true })).toHaveCount(0);
    expect(await snapshot(page, userId)).toEqual(before);
  });
}

for (const contract of [2, 3]) test(`adjusted history: genuine v${contract} projection never recycles corrected original receipts`, async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const userId = await account(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const created = await invoice(page, 'RE-BANK-120');
  const paid = await page.request.post(`/api/invoices/${created.id}/payments`, { data: { amount: '120.00', currency: 'EUR', paidAt: '2026-10-20', source: 'MANUAL', reference: 'RE-BANK-120', expectedPaidCents: '0', idempotencyKey: randomUUID() } });
  expect(paid.status()).toBe(201);
  const original = await paid.json();
  const journalResponse = await page.request.get(`/api/invoices/${created.id}/payments`, { headers: { 'X-Bivaro-Payment-Contract': '2' } });
  expect(journalResponse.status()).toBe(200);
  const journal = await journalResponse.json();
  const corrected = await page.request.post(`/api/invoices/${created.id}/payments/adjustments`, { data: { kind: 'PAYMENT_CORRECTION', originalPaymentId: original.event.id, amount: '40.00', actionDate: '2026-10-21', reason: 'Synthetic receipt was never received', reference: 'Synthetic statement correction', declarationNeverReceived: true, expectedLedgerVersion: journal.ledgerVersion, idempotencyKey: randomUUID() } });
  expect(corrected.status()).toBe(201);
  const authoritative = await page.request.get(`/api/invoices/${created.id}/payments`, { headers: { 'X-Bivaro-Payment-Contract': '3' } });
  expect(authoritative.status()).toBe(200);
  expect(await authoritative.json()).toMatchObject({
    events: [{ id: original.event.id, amountCents: '12000' }],
    ledger: { version: 3, originCash: { originalReceivedCents: '12000', correctedCents: '4000', validReceivedCents: '8000' }, collectibleOpenCents: '4000' },
    effectivePayments: [{ originalPaymentId: original.event.id, validReceivedCents: '8000' }],
  });
  if (contract === 2) {
    // Exercise the promised historical fallback with the server's genuine v2
    // projection. No journal/body/success is fabricated and no write is routed.
    await page.route(`**/api/invoices/${created.id}/payments`, async route => {
      expect(route.request().method()).toBe('GET');
      const response = await route.fetch({ headers: { ...route.request().headers(), 'x-bivaro-payment-contract': '2' } });
      expect(response.status()).toBe(200);
      await route.fulfill({ response });
    });
  }
  const before = await snapshot(page, userId, created.id);
  const writes: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method())) writes.push(request.method()); });
  await page.goto('/bank-csv'); await upload(page, single); await preview(page);
  await page.getByRole('button', { name: 'Rechnungsvorschläge prüfen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Rechnungsvorschläge geprüft', exact: true })).toBeVisible();
  const bankRow = page.getByRole('article', { name: 'Bankzeile 2', exact: true });
  await expect(bankRow.getByText(/Möglicherweise bereits erfasst/u)).toHaveCount(0);
  if (contract === 2) {
    await expect(page.getByText(/1 Rechnungen mit Korrektur oder Erstattung/u)).toBeVisible();
    await expect(bankRow).toContainText('Kein eindeutiger Rechnungsvorschlag');
    await expect(bankRow.getByRole('heading', { name: 'RE-BANK-120', exact: true })).toHaveCount(0);
    await page.getByText('Betroffene Rechnungen anzeigen', { exact: true }).click();
    await expect(page.getByRole('link', { name: 'RE-BANK-120 · Journal prüfen', exact: true })).toHaveAttribute('href', `/history?invoiceId=${created.id}`);
    await page.screenshot({ path: testInfo.outputPath('bank-csv-adjusted-review-only.png'), fullPage: true });
  } else {
    await expect(bankRow.getByRole('heading', { name: 'RE-BANK-120', exact: true })).toBeVisible();
    await expect(bankRow).toContainText('Geprüfter Rechnungsrest: 40,00 €');
    await expect(bankRow).toContainText('Nur Vorschlag · keine Zahlung erfasst');
    await expect(page.getByText(/1 Rechnungen mit Korrektur oder Erstattung/u)).toHaveCount(0);
  }
  expect(await snapshot(page, userId, created.id)).toEqual(before); expect(writes).toEqual([]);
});

test('back cancels an in-flight comparison; a late reply cannot replace mapping or capture focus', async ({ page }) => {
  test.setTimeout(90_000);
  const userId = await account(page), before = await snapshot(page, userId);
  await page.goto('/bank-csv'); await upload(page, single); await preview(page);
  let reached = false;
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/invoices?*', async route => { reached = true; await gate; await route.continue().catch(() => {}); });
  await page.getByRole('button', { name: 'Rechnungsvorschläge prüfen', exact: true }).click();
  await expect.poll(() => reached).toBe(true);
  await page.getByRole('button', { name: 'Zurück zur Zuordnung', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Vorschau prüfen', exact: true })).toBeFocused();
  await page.getByLabel('Kontoalias *', { exact: true }).focus(); release();
  await expect(page.getByLabel('Kontoalias *', { exact: true })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Rechnungsvorschläge geprüft', exact: true })).toHaveCount(0);
  await preview(page); await page.getByRole('button', { name: 'Rechnungsvorschläge prüfen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Rechnungsvorschläge geprüft', exact: true })).toBeVisible();
  expect(await snapshot(page, userId)).toEqual(before);
});
