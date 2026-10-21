import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';

// Intended for the existing isolated hosted acceptance runner, never a real tenant.
test('plans quote follow-up, keeps manual response/error drafts and restores the task context', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const password = 'SyntheticQuoteWorkflow123!';
  const email = `quote-workflow-${randomUUID()}@example.test`;
  const user = await prisma.user.create({ data: { email, name: 'Synthetic quote workflow', password: await hashPassword(password), role: 'USER' } });
  try {
    await page.goto('/login'); await page.getByLabel('E-Mail').fill(email); await page.getByLabel('Passwort', { exact: true }).fill(password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click(); await expect(page).toHaveURL(/\/dashboard/);
    const pdf = await PDFDocument.create(); pdf.addPage();
    const created = await page.request.post('/api/quotes', { data: { fileName: 'synthetic-quote-workflow.pdf', quoteNumber: 'SYNTHETIC-QUOTE-FOLLOWUP', quoteDate: '2026-10-01', validUntil: '2026-10-10', totalAmount: 24.68, parsedData: { taxMode: 'small-business', items: [{ description: 'Synthetic follow-up service', quantity: 2, unitPrice: 12.34, unit: 'Stunde', taxRate: 0 }] }, pdfBytes: await pdf.saveAsBase64() } });
    expect(created.status()).toBe(200); const quote = await created.json();
    expect((await page.request.put('/api/quotes', { data: { id: quote.id, status: 'SENT' } })).status()).toBe(200);
    const before = await (await page.request.get(`/api/quotes/download?id=${quote.id}&download=true`)).body();
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/dashboard?tab=quotes');
    const open = () => page.getByRole('button', { name: 'Rückmeldung & Nachfassen', exact: true }).filter({ visible: true }).click();
    await open();
    const dialog = page.getByRole('dialog', { name: 'Rückmeldung & Nachfassen', exact: true });
    await dialog.getByLabel('Wieder bei mir auf den Tisch am', { exact: true }).fill('2000-01-01');
    await dialog.getByLabel('Interne Notiz / Grund der Rückmeldung', { exact: true }).fill('Synthetic: am Freitag nachfragen');
    await page.route(`**/api/quotes/${quote.id}/workflow`, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic save interruption' }) }), { times: 1 });
    await dialog.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Synthetic save interruption');
    await expect(dialog.getByLabel('Interne Notiz / Grund der Rückmeldung', { exact: true })).toHaveValue('Synthetic: am Freitag nachfragen');
    await dialog.getByRole('button', { name: 'Änderungen speichern', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: /1 · Nachfassen/ }).click(); await expect(page).toHaveURL(/quoteStatus=FOLLOW_UP/);
    await page.getByLabel('Suche', { exact: true }).fill('SYNTHETIC-QUOTE-FOLLOWUP'); await expect(page).toHaveURL(/quoteSearch=SYNTHETIC-QUOTE-FOLLOWUP/);
    await page.reload(); await expect(page.getByLabel('Suche', { exact: true })).toHaveValue('SYNTHETIC-QUOTE-FOLLOWUP');
    await expect(page.getByText('Nachfassen überfällig', { exact: true }).filter({ visible: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('quote-followup-mobile-390.png'), fullPage: true });
    await open(); await dialog.getByLabel('Interne Notiz / Grund der Rückmeldung', { exact: true }).fill('Unsaved synthetic response');
    await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await open();
    await expect(dialog.getByLabel('Interne Notiz / Grund der Rückmeldung', { exact: true })).toHaveValue('Synthetic: am Freitag nachfragen');
    // A second editor wins; the first must not silently overwrite it.
    const current = await prisma.invoice.findUniqueOrThrow({ where: { id: quote.id } });
    expect((await page.request.patch(`/api/quotes/${quote.id}/workflow`, { data: { quoteResponseNote: 'Synthetic second-editor response', expected: { status: current.status, quoteFollowUpOn: current.quoteFollowUpOn, quoteResponseNote: current.quoteResponseNote } } })).status()).toBe(200);
    await dialog.getByLabel('Interne Notiz / Grund der Rückmeldung', { exact: true }).fill('Stale synthetic response');
    await dialog.getByRole('button', { name: 'Änderungen speichern', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('zwischenzeitlich geändert');
    await expect(dialog.getByLabel('Interne Notiz / Grund der Rückmeldung', { exact: true })).toHaveValue('Stale synthetic response');
    await page.keyboard.press('Escape'); await page.reload(); await open();
    await dialog.getByLabel('Stand manuell festhalten', { exact: true }).selectOption('ACCEPTED');
    await dialog.getByLabel('Interne Notiz / Grund der Rückmeldung', { exact: true }).fill('Synthetic: Kunde hat telefonisch zugesagt');
    await dialog.getByRole('button', { name: 'Änderungen speichern', exact: true }).click(); await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: /3 · Rechnung vorbereiten/ }).click(); await expect(page).toHaveURL(/quoteStatus=READY_TO_INVOICE/);
    await page.goBack(); await expect(page).toHaveURL(/quoteStatus=FOLLOW_UP/); await expect(page.getByText('Keine passenden Angebote', { exact: true })).toBeVisible();
    await page.goForward(); await expect(page).toHaveURL(/quoteStatus=READY_TO_INVOICE/);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.getByText('Rechnungsentwurf vorbereiten', { exact: true }).filter({ visible: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('quote-followup-desktop-1440.png'), fullPage: true });
    await page.getByRole('button', { name: 'Angebot SYNTHETIC-QUOTE-FOLLOWUP in Rechnung umwandeln', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Rechnungsentwurf prüfen?', exact: true });
    await expect(confirm).toContainText('keine Zahlung oder Einnahme');
    await confirm.getByRole('button', { name: 'Entwurf prüfen', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Rechnung erstellen', exact: true });
    await expect(editor.locator('#invoice-item-description-0')).toHaveValue('Synthetic follow-up service');
    await page.keyboard.press('Escape'); await expect(editor).toBeHidden();
    await expect(page).toHaveURL(/quoteStatus=READY_TO_INVOICE/);

    expect((await (await page.request.get(`/api/quotes/download?id=${quote.id}&download=true`)).body()).equals(before)).toBe(true);
    expect(await prisma.invoice.count({ where: { userId: user.id, convertedFromQuoteId: quote.id } })).toBe(0);
    expect(await prisma.income.count({ where: { userId: user.id } })).toBe(0);
  } finally { await prisma.$disconnect(); }
});
