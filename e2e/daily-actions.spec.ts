import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';

// Authored for the existing isolated acceptance runner. Never run against a
// real tenant. No native build/browser run or CI launch is implied by this file.
async function pdfDocument(page: Page, type: 'invoices' | 'quotes', number: string) {
  const pdf = await PDFDocument.create(); pdf.addPage();
  const response = await page.request.post(`/api/${type}`, { data: { fileName: `${number}.pdf`, invoiceNumber: type === 'invoices' ? number : undefined, quoteNumber: type === 'quotes' ? number : undefined, invoiceDate: '2026-01-01', quoteDate: '2026-01-01', dueDate: '2000-01-01', totalAmount: 120, parsedData: { currency: 'EUR', taxMode: 'small-business', items: [{ description: 'Synthetic daily service', quantity: 1, unitPrice: 120, unit: 'Stück', taxRate: 0 }] }, pdfBytes: await pdf.saveAsBase64() } });
  expect(response.status()).toBe(200);
  return await response.json() as { id: number; status: string; quoteFollowUpOn: string | null; quoteResponseNote: string | null };
}
async function financialSnapshot(userId: string) {
  return { invoices: await prisma.invoice.findMany({ where: { userId }, orderBy: { id: 'asc' } }), incomes: await prisma.income.findMany({ where: { userId }, orderBy: { id: 'asc' } }), expenses: await prisma.expense.findMany({ where: { userId }, orderBy: { id: 'asc' } }), payments: await prisma.paymentJournalEvent.findMany({ where: { userId }, orderBy: { id: 'asc' } }), reminders: await prisma.reminder.findMany({ where: { userId }, orderBy: { id: 'asc' } }) };
}

test('daily actions lead to exact existing workflows, preserve drafts and remain read-only across errors/back/reload/mobile', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const password = 'SyntheticDailyActions123!';
  const email = `daily-actions-${randomUUID()}@example.test`;
  const user = await prisma.user.create({ data: { email, name: 'Synthetic daily assistant', password: await hashPassword(password), role: 'USER' } });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login'); await page.getByLabel('E-Mail').fill(email); await page.getByLabel('Passwort', { exact: true }).fill(password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click(); await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/dashboard/today');
    await expect(page.getByRole('heading', { name: 'Aktuell kein nächster Schritt aus diesen Quellen', exact: true })).toBeVisible();

    const invoice = await pdfDocument(page, 'invoices', 'SYNTHETIC-DAILY-PARTIAL');
    expect((await page.request.put('/api/invoices', { data: { id: invoice.id, status: 'SENT' } })).status()).toBe(200);
    expect((await page.request.post(`/api/invoices/${invoice.id}/payments`, { data: { amount: '40.00', paidAt: '2026-01-02', expectedPaidCents: '0', currency: 'EUR', source: 'MANUAL', reference: 'Synthetic bank statement', idempotencyKey: randomUUID() } })).status()).toBe(201);
    const followUp = await pdfDocument(page, 'quotes', 'SYNTHETIC-DAILY-FOLLOWUP');
    expect((await page.request.patch(`/api/quotes/${followUp.id}/workflow`, { data: { quoteFollowUpOn: '2000-01-01', expected: { status: followUp.status, quoteFollowUpOn: null, quoteResponseNote: null } } })).status()).toBe(200);
    const accepted = await pdfDocument(page, 'quotes', 'SYNTHETIC-DAILY-ACCEPTED');
    expect((await page.request.patch(`/api/quotes/${accepted.id}/workflow`, { data: { status: 'ACCEPTED', expected: { status: accepted.status, quoteFollowUpOn: null, quoteResponseNote: null } } })).status()).toBe(200);
    const photo = await sharp({ create: { width: 80, height: 120, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const intake = await page.request.post('/api/purchase-documents', { multipart: { file: { name: 'synthetic-daily-receipt.png', mimeType: 'image/png', buffer: photo }, uploadRequestId: randomUUID() } });
    expect(intake.status()).toBe(201); const document = (await intake.json()).document;
    expect((await page.request.post(`/api/purchase-documents/${document.id}/review-draft`, { data: { expectedRevision: document.revision, draft: { supplierName: 'Synthetic draft supplier', invoiceNumber: 'SYN-DAILY', invoiceDate: '2026-01-02', paymentDate: '', amount: '9.99', note: 'Synthetic saved review; not booked.' } } })).status()).toBe(200);
    const before = await financialSnapshot(user.id);
    const auditBefore = await prisma.auditLog.count({ where: { userId: user.id } });
    const originalBefore = await (await page.request.get(`/api/invoices/download?id=${invoice.id}&download=true`)).body();

    let releaseRead!: () => void;
    const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
    await page.route('**/api/daily-actions', async route => { await readGate; await route.continue(); }, { times: 1 });
    await page.goto('/dashboard');
    const preview = page.locator('section[aria-labelledby="daily-actions-preview-title"]');
    try { await expect(preview.getByRole('status')).toContainText('Nächste Schritte werden geladen'); }
    finally { releaseRead(); }
    await expect(preview.getByRole('listitem')).toHaveCount(3);
    await expect(preview.getByText('80,00 €', { exact: true })).toBeVisible();
    await preview.getByRole('link', { name: 'Alle Schritte', exact: true }).click();
    const list = page.getByRole('list', { name: 'Priorisierte nächste Schritte', exact: true });
    await expect(list.getByRole('listitem')).toHaveCount(4);
    await expect(list.getByRole('listitem').first()).toContainText('SYNTHETIC-DAILY-PARTIAL');
    for (const width of [360, 390, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await expect(page.locator('.app-topbar:visible')).toHaveCount(1);
      expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // Every action remains reachable at every tested width, including 360px.
      for (const actionLink of await list.getByRole('link').all()) {
        await actionLink.scrollIntoViewIfNeeded();
        await expect(actionLink).toBeInViewport();
      }
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      const firstAction = list.getByRole('listitem').first();
      await expect(firstAction.getByText('80,00 €', { exact: true })).toBeInViewport();
      await expect(firstAction.getByRole('link', { name: 'Rechnung prüfen: SYNTHETIC-DAILY-PARTIAL', exact: true })).toBeInViewport();
      // A normal viewport records the priority/balance/CTA, not the entire long list.
      if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`daily-actions-${width}.png`), fullPage: false });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await list.getByRole('link', { name: 'Rechnung prüfen: SYNTHETIC-DAILY-PARTIAL', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`tab=invoices&document=${invoice.id}`));
    await expect(page.getByText('Gezielt geöffnetes Dokument', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Details', exact: true }).filter({ visible: true }).click();
    const invoiceDialog = page.getByRole('dialog', { name: 'Rechnungsdetails', exact: true });
    await expect(invoiceDialog.getByText('80,00 €', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape'); await expect(invoiceDialog).toBeHidden();
    await page.goBack(); await expect(page).toHaveURL(/\/dashboard\/today$/);
    await page.goForward(); await expect(page).toHaveURL(new RegExp(`document=${invoice.id}`));
    await page.reload(); await expect(page.getByRole('button', { name: 'Details', exact: true }).filter({ visible: true })).toBeVisible();
    await page.goBack();

    await list.getByRole('link', { name: 'Rückmeldung erfassen: SYNTHETIC-DAILY-FOLLOWUP', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`tab=quotes&document=${followUp.id}`));
    await page.getByRole('button', { name: 'Rückmeldung & Nachfassen', exact: true }).filter({ visible: true }).click();
    const workflow = page.getByRole('dialog', { name: 'Rückmeldung & Nachfassen', exact: true });
    await expect(workflow.getByLabel('Wieder bei mir auf den Tisch am', { exact: true })).toHaveValue('2000-01-01');
    await workflow.getByLabel('Interne Notiz / Grund der Rückmeldung', { exact: true }).fill('Synthetic unsaved response');
    await page.keyboard.press('Escape'); await expect(workflow).toBeHidden(); await page.goBack();

    await list.getByRole('link', { name: 'Angebot öffnen: SYNTHETIC-DAILY-ACCEPTED', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`tab=quotes&document=${accepted.id}`));
    const acceptedCard = page.locator('[aria-label="Angebotsliste"]').getByRole('article').filter({ has: page.getByRole('heading', { name: 'SYNTHETIC-DAILY-ACCEPTED', exact: true }) });
    await expect(acceptedCard).toHaveCount(1);
    await acceptedCard.getByRole('button', { name: 'In Rechnung', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Rechnungsentwurf prüfen?', exact: true });
    await confirmation.getByRole('button', { name: 'Entwurf prüfen', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Rechnung erstellen', exact: true });
    await expect(editor.locator('#invoice-item-description-0')).toHaveValue('Synthetic daily service');
    await page.keyboard.press('Escape'); await expect(editor).toBeHidden(); await page.goBack();

    await list.getByRole('link', { name: 'Belegprüfung fortsetzen: synthetic-daily-receipt.png', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/purchases\\?document=${document.id}`));
    const review = page.getByRole('dialog');
    await expect(review.getByLabel('Prüfnotiz', { exact: true })).toHaveValue('Synthetic saved review; not booked.');
    await page.keyboard.press('Escape'); await expect(review).toBeHidden(); await page.goBack();

    await page.route('**/api/daily-actions', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic read interruption' }) }), { times: 1 });
    await page.getByRole('button', { name: 'Nächste Schritte aktualisieren', exact: true }).click();
    await expect(page.locator('section[aria-labelledby="daily-actions-title"]').getByRole('alert')).toContainText('Nächste Schritte konnten nicht geladen werden');
    await expect(list).toHaveCount(0);
    await page.getByRole('button', { name: 'Erneut laden', exact: true }).click(); await expect(list.getByRole('listitem')).toHaveCount(4);
    expect(await financialSnapshot(user.id)).toEqual(before);
    expect(await prisma.auditLog.count({ where: { userId: user.id } })).toBe(auditBefore);
    expect((await (await page.request.get(`/api/invoices/download?id=${invoice.id}&download=true`)).body()).equals(originalBefore)).toBe(true);

    // Finish one concrete task through the pre-existing manual response workflow.
    await list.getByRole('link', { name: 'Rückmeldung erfassen: SYNTHETIC-DAILY-FOLLOWUP', exact: true }).click();
    await page.getByRole('button', { name: 'Rückmeldung & Nachfassen', exact: true }).filter({ visible: true }).click();
    await workflow.getByLabel('Wieder bei mir auf den Tisch am', { exact: true }).fill('9999-12-31');
    await workflow.getByRole('button', { name: 'Änderungen speichern', exact: true }).click(); await expect(workflow).toBeHidden();
    await page.goBack(); await expect(list.getByRole('listitem')).toHaveCount(3);
    await page.reload(); await expect(list.getByRole('listitem')).toHaveCount(3);
    expect(await prisma.invoice.count({ where: { userId: user.id, convertedFromQuoteId: accepted.id } })).toBe(0);
    expect(await prisma.expense.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.income.count({ where: { userId: user.id } })).toBe(1);
  } finally { await prisma.$disconnect(); }
});
