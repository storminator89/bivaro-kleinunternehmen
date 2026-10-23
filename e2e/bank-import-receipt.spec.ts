import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// The supported runner owns this exact fresh synthetic database. No deployed
// tenant, bank connection, real data or hosted credentials are used.
async function account(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticBankEvidence123!';
  const user = await prisma.user.create({ data: { email: `bank-evidence-${randomUUID()}@example.test`, name: 'Synthetic bank evidence', password: await hashPassword(password), role: 'USER' } });
  await page.goto('/login'); await page.getByLabel('E-Mail').fill(user.email); await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click(); await expect(page).toHaveURL(/\/dashboard/);
  return user.id;
}
async function finances(page: Page) {
  return Promise.all(['/api/incomes', '/api/expenses'].map(async path => {
    const response = await page.request.get(path, { headers: { 'X-Bivaro-Payment-Contract': '2' } });
    expect(response.status()).toBe(200); return response.json();
  }));
}
async function ledgerCounts(userId: string) {
  return Promise.all([
    prisma.invoice.count({ where: { userId } }), prisma.income.count({ where: { userId } }),
    prisma.expense.count({ where: { userId } }), prisma.paymentJournalEvent.count({ where: { userId } }),
    prisma.paymentAdjustment.count({ where: { userId } }), prisma.paymentOperation.count({ where: { userId } }),
    prisma.cashTransaction.count({ where: { userId } }),
  ]);
}
async function preview(page: Page, csv: string) {
  await page.getByLabel('Bank-CSV auswählen', { exact: true }).setInputFiles({ name: 'synthetic-bank-evidence-only.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByLabel('Kontoalias *', { exact: true }).fill('Synthetisches QA-Konto');
  await page.getByRole('button', { name: 'Vorschau prüfen', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Vorschau prüfen', exact: true })).toBeFocused();
}
for (const width of [1440, 360, 390]) test(`bank evidence: bounded save/recovery/history, ${width}px`, async ({ page }, info) => {
  test.setTimeout(90_000); await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
  const userId = await account(page); await page.goto('/bank-csv');
  const before = await finances(page), ledgerBefore = await ledgerCounts(userId), nonce = randomUUID();
  expect(ledgerBefore).toEqual([0, 0, 0, 0, 0, 0, 0]);
  expect(await prisma.bankImportBatch.count({ where: { userId } })).toBe(0);
  const csv = `Datum;Betrag;Währung;Gegenpartei;Verwendungszweck;Umsatz-ID\n22.10.2026;40,01;EUR;Synthetisch;QA-${nonce};A-${nonce}\n22.10.2026;40,01;EUR;Synthetisch;QA-${nonce};B-${nonce}\n22.10.2026;-0,03;EUR;Synthetisch;Gebühr;C-${nonce}\n22.10.2026;5,00;USD;Synthetisch;FX;D-${nonce}`;
  let posts = 0; page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/bank-imports') posts++; });
  await preview(page, csv); expect(posts).toBe(0);
  await page.getByRole('button', { name: 'Zurück zur Zuordnung', exact: true }).click(); await expect(page.getByRole('button', { name: 'Vorschau prüfen', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Vorschau prüfen', exact: true }).click();
  await page.getByRole('button', { name: 'Datei verwerfen', exact: true }).click(); await expect(page.getByLabel('Bank-CSV auswählen', { exact: true })).toBeFocused(); expect(posts).toBe(0);
  await preview(page, csv);
  await page.getByLabel(/Ich habe Kontoalias, Spalten, Vorzeichen und Kontrollsummen geprüft/u).check();
  // Commit response is intentionally dropped once. The safe retry must GET the
  // same UUID, not POST a second batch or invent a new request key.
  await page.route('**/api/bank-imports', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('connectionreset');
  }, { times: 1 });
  await page.getByRole('button', { name: 'Geprüfte Umsätze speichern', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByText(/Ergebnis unklar\./u)).toBeVisible();
  await page.getByRole('button', { name: 'Ergebnis sicher erneut prüfen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Gespeicherte Quittung', exact: true })).toBeFocused();
  await expect(page.getByText('Import gespeichert, noch keine Zahlungen zugeordnet', { exact: true })).toBeVisible(); expect(posts).toBe(1);
  expect(await prisma.bankImportBatch.count({ where: { userId } })).toBe(1);
  expect(await prisma.bankImportRow.count({ where: { userId } })).toBe(4);
  const savedBatch = await prisma.bankImportBatch.findFirstOrThrow({ where: { userId } });
  const savedRows = await prisma.bankImportRow.findMany({ where: { userId }, orderBy: { sourceRow: 'asc' } });
  if (width === 1440) await page.screenshot({ path: info.outputPath('bank-evidence-saved-1440.png'), fullPage: false });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  const opener = page.getByRole('button', { name: 'Quittung öffnen', exact: true }).first(); await opener.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Importquittung', exact: true })).toBeFocused();
  await expect(page.getByText('Import gespeichert, noch keine Zahlungen zugeordnet', { exact: true })).toBeVisible();
  const foreignCurrency = page.getByRole('article', { name: 'Gespeicherte Bankzeile 5', exact: true });
  await expect(foreignCurrency.getByText('Betrag / Währung prüfen', { exact: true })).toBeVisible();
  await expect(foreignCurrency.getByRole('button', { name: 'Rechnung wählen', exact: true })).toBeDisabled();
  if (width === 390) {
    await page.getByRole('heading', { name: 'Importquittung', exact: true }).evaluate(element => {
      element.scrollIntoView({ block: 'start', behavior: 'instant' });
      window.scrollBy({ top: -80, behavior: 'instant' });
    });
    await page.screenshot({ path: info.outputPath('bank-evidence-reopened-390.png'), fullPage: false });
  }
  await page.getByRole('button', { name: 'Zurück zum Importverlauf', exact: true }).click(); await expect(opener).toBeFocused();
  // A new keyboard open/close cycle must retain logical focus; this is not a
  // retry of the required focus assertion above.
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Importquittung', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Zurück zum Importverlauf', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(opener).toBeFocused();
  // If the user moves elsewhere while a receipt loads, its late response must
  // not take focus back. Synchronize on the actual request, never a timed sleep.
  let release!: () => void, requested!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { requested = resolve; });
  await page.route(`**/api/bank-imports/${savedBatch.stableKey}?page=0`, async route => { requested(); await held; await route.continue(); }, { times: 1 });
  await page.keyboard.press('Enter'); await started;
  const fileChooser = page.getByLabel('Bank-CSV auswählen', { exact: true }); await fileChooser.focus(); release();
  await expect(page.getByRole('heading', { name: 'Importquittung', exact: true })).toBeVisible(); await expect(fileChooser).toBeFocused();
  await page.getByRole('button', { name: 'Zurück zum Importverlauf', exact: true }).click(); await expect(opener).toBeFocused();
  await preview(page, csv); await page.getByLabel(/Ich habe Kontoalias, Spalten, Vorzeichen und Kontrollsummen geprüft/u).check();
  await page.getByRole('button', { name: 'Geprüfte Umsätze speichern', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Gespeicherte Quittung', exact: true })).toBeVisible(); expect(posts).toBe(2); // Existing owned receipt from 409, no new batch.
  expect(await finances(page)).toEqual(before);
  expect(await ledgerCounts(userId)).toEqual(ledgerBefore);
  expect(await prisma.bankImportBatch.count({ where: { userId } })).toBe(1);
  expect(await prisma.bankImportBatch.findFirstOrThrow({ where: { userId } })).toEqual(savedBatch);
  expect(await prisma.bankImportRow.findMany({ where: { userId }, orderBy: { sourceRow: 'asc' } })).toEqual(savedRows);
});
