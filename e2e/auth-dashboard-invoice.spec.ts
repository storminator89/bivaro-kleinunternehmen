import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

const testUser = {
  name: 'E2E Admin',
  email: `e2e-${Date.now()}@example.test`,
  password: 'SecurePass123',
};

test.describe.serial('auth, dashboard and invoice flow', () => {
  test('registers the first admin user and opens the dashboard', async ({ page }) => {
    await page.goto('/register');

    await page.getByLabel('Name').fill(testUser.name);
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByLabel('Passwort bestätigen').fill(testUser.password);
    await page.getByRole('button', { name: 'Admin-Konto erstellen' }).click();

    await expect(page).toHaveURL(/\/login/);

    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Buchhaltung', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rechnung erstellen' })).toBeVisible();
  });

  test('opens the invoice creation flow from the dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await page.getByRole('button', { name: 'Rechnung erstellen' }).click();

    await expect(page).toHaveURL(/\/dashboard\/invoices\/new/);
    await expect(page.getByRole('heading', { name: 'Rechnung erstellen', level: 1 })).toBeVisible();
  });

  test('honors merge mode even when the backup requests overwrite and displays missing-file warnings', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    const incomeResponse = await page.request.post('/api/incomes', { data: { description: 'Must survive merge', amount: 42, date: '2026-06-15' } });
    expect(incomeResponse.ok()).toBe(true);
    const income = await incomeResponse.json();

    await page.goto('/settings');
    await page.locator('#restore-file').setInputFiles({
      name: 'untrusted-backup.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ version: '2.0', confirmOverwrite: true, data: {
        invoices: [{ id: 1, fileName: 'missing.pdf', storedFileName: 'missing.pdf', invoiceNumber: 'E2E-MISSING-FILE', parsedData: {} }],
      } })),
    });
    const restoreResponse = page.waitForResponse(response => response.url().endsWith('/api/backup/restore') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Geprüftes Backup importieren' }).click();
    const response = await restoreResponse;
    expect(response.request().postDataJSON().confirmOverwrite).toBe(false);
    expect(response.ok()).toBe(true);
    await expect(page.getByText('Wiederherstellung mit Hinweisen', { exact: true })).toBeVisible();
    const incomes = await (await page.request.get('/api/incomes')).json();
    expect(incomes.items.some((item: { id: number }) => item.id === income.id)).toBe(true);
  });

  test('exports an XRechnung with explicit reference and rounded tax groups', async ({ page }, testInfo) => {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    expect((await page.request.post('/api/settings', { data: {
      companyName: 'E2E Rechnungssteller', companyAddress: 'Testweg 1\n10115 Berlin',
      email: 'rechnung@example.test', telephone: '+49 301234567',
      taxNumber: '123/456/78901', iban: 'DE89370400440532013000',
    } })).ok()).toBe(true);

    await page.getByRole('button', { name: 'Rechnung erstellen' }).click();
    await page.getByRole('combobox', { name: 'Ausgabeformat', exact: true }).selectOption('xml-only');
    await page.getByLabel('Umsatzsteuerbehandlung').selectOption('standard');
    await page.getByLabel('Empfänger (Name & Anschrift)').fill('E2E Kunde\nBuchhaltung\nKundenweg 2\n10115 Berlin');
    await page.getByLabel('E-Mail des Empfängers', { exact: false }).fill('kunde@example.test');
    await page.locator('#invoice-item-description-0').fill('Leistung 19 Prozent');
    await page.locator('#invoice-item-price-0').fill('0.08');
    await page.locator('#invoice-item-tax-0').fill('19');
    await page.getByRole('button', { name: 'Position hinzufügen' }).click();
    await page.locator('#invoice-item-description-1').fill('Leistung 7 Prozent');
    await page.locator('#invoice-item-price-1').fill('0.08');
    await page.locator('#invoice-item-tax-1').fill('7');

    const missingReference = page.waitForEvent('dialog').then(async dialog => {
      expect(dialog.message()).toMatch(/referenz|Leitweg/i);
      await dialog.accept();
    });
    await page.getByRole('button', { name: 'XML erstellen', exact: true }).click();
    await missingReference;
    await page.getByLabel('Käuferreferenz / Leitweg-ID', { exact: false }).fill('E2E-BUYER-REFERENCE');
    await page.screenshot({ path: testInfo.outputPath('invoice-editor.png'), fullPage: true });

    const downloaded = page.waitForEvent('download');
    const uploaded = page.waitForResponse(response => response.url().endsWith('/api/invoices/upload') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'XML erstellen', exact: true }).click();
    const response = await uploaded;
    expect(response.ok()).toBe(true);
    const download = await downloaded;
    const path = testInfo.outputPath('xrechnung.xml');
    await download.saveAs(path);
    const xml = await readFile(path, 'utf8');
    expect(xml).toContain('<ram:BuyerReference>E2E-BUYER-REFERENCE</ram:BuyerReference>');
    expect(xml).toContain('<ram:TaxTotalAmount currencyID="EUR">0.03</ram:TaxTotalAmount>');
    expect(xml).toContain('<ram:GrandTotalAmount>0.19</ram:GrandTotalAmount>');
    expect(xml).toContain('Buchhaltung');
    expect(xml).toContain('Kundenweg 2');
    const invoice = await response.json();
    expect(invoice.totalAmount).toBe(0.19);
  });

  test('creates a Factur-X PDF using the same rounded amounts as its XML', async ({ page }, testInfo) => {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.getByRole('button', { name: 'Rechnung erstellen' }).click();
    await page.getByLabel('Empfänger (Name & Anschrift)').fill('PDF Testkunde\nKundenweg 2\n10115 Berlin');
    await page.locator('#invoice-item-description-0').fill('Teilmenge');
    await page.locator('#invoice-item-quantity-0').fill('0.333');
    await page.locator('#invoice-item-price-0').fill('1');
    await page.getByRole('button', { name: 'Position hinzufügen' }).click();
    await page.locator('#invoice-item-description-1').fill('Teilmenge 2');
    await page.locator('#invoice-item-quantity-1').fill('0.333');
    await page.locator('#invoice-item-price-1').fill('1');
    await page.getByRole('button', { name: 'Position hinzufügen' }).click();
    await page.locator('#invoice-item-description-2').fill('Teilmenge 3');
    await page.locator('#invoice-item-quantity-2').fill('0.333');
    await page.locator('#invoice-item-price-2').fill('1');
    const downloaded = page.waitForEvent('download');
    const uploaded = page.waitForResponse(response => response.url().endsWith('/api/invoices/upload') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'PDF erstellen', exact: true }).click();
    const response = await uploaded;
    expect(response.ok()).toBe(true);
    expect((await response.json()).totalAmount).toBe(0.99);
    const download = await downloaded;
    const path = testInfo.outputPath('factur-x.pdf');
    await download.saveAs(path);
    expect((await readFile(path)).subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('preserves a paid invoice and hides destructive actions on desktop and mobile', async ({ page }, testInfo) => {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    const pdf = await PDFDocument.create();
    pdf.addPage();
    const invoiceNumber = 'E2E-PROTECTED-PAYMENT';
    const created = await page.request.post('/api/invoices', { data: {
      fileName: 'synthetic-payment.pdf', invoiceNumber, totalAmount: 123.45,
      parsedData: {}, pdfBytes: await pdf.saveAsBase64(),
    } });
    expect(created.ok()).toBe(true);
    const invoice = await created.json();
    const originalPdf = await (await page.request.get(`/api/invoices/download?id=${invoice.id}`)).body();
    const payment = await page.request.put('/api/invoices', { data: {
      id: invoice.id, status: 'PAID', paidAt: '2026-06-15T12:00:00.000Z',
    } });
    expect(payment.ok()).toBe(true);
    expect((await page.request.delete(`/api/invoices?id=${invoice.id}`)).status()).toBe(409);
    expect((await page.request.put('/api/invoices', { data: { id: invoice.id, status: 'SENT' } })).status()).toBe(409);
    const list = await (await page.request.get(`/api/invoices?search=${invoiceNumber}`)).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      id: invoice.id, status: 'PAID', issuanceState: 'ISSUED',
      income: { amount: 123.45, date: '2026-06-15T12:00:00.000Z' },
    });
    const retainedPdf = await page.request.get(`/api/invoices/download?id=${invoice.id}`);
    expect(retainedPdf.ok()).toBe(true);
    expect(await retainedPdf.body()).toEqual(originalPdf);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/dashboard?tab=invoices');
    await page.getByRole('button', { name: `Weitere Aktionen fuer Rechnung ${invoiceNumber}`, exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Rechnung löschen', exact: true })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath('protected-invoice-desktop.png'), fullPage: true, animations: 'disabled' });
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    const card = page.getByRole('article').filter({ hasText: invoiceNumber });
    await expect(card.getByRole('button', { name: 'Löschen', exact: true })).toBeDisabled();
    await expect(card.getByText('Löschen ist nur für nachweislich unausgestellte Entwürfe ohne Zahlung möglich.')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('protected-invoice-mobile.png'), fullPage: true, animations: 'disabled' });
  });

  test('keeps a backdated manual income on the entered calendar day across browser timezones', async ({ browser }, testInfo) => {
    const context = await browser.newContext({ timezoneId: 'America/Los_Angeles' });
    const page = await context.newPage();
    try {
      await page.goto('http://127.0.0.1:3100/login');
      await page.getByLabel('E-Mail').fill(testUser.email);
      await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
      await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
      await expect(page).toHaveURL(/\/dashboard/);
      await page.getByRole('button', { name: 'Einnahme erfassen', exact: true }).click();
      await page.locator('#incomeDescription').fill('E2E Jahreswechsel Einnahme');
      await page.locator('#incomeAmount').fill('45.67');
      await expect(page.getByLabel('Zahlungsdatum', { exact: true })).toHaveAttribute('required', '');
      await page.getByLabel('Zahlungsdatum', { exact: true }).fill('2025-12-31');
      const saved = page.waitForResponse(response => response.url().endsWith('/api/incomes') && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Einnahme speichern', exact: true }).click();
      const response = await saved;
      expect(response.ok()).toBe(true);
      expect(response.request().postDataJSON().date).toBe('2025-12-31');
      expect((await response.json()).date).toBe('2025-12-31T00:00:00.000Z');
      const row = page.getByRole('row').filter({ hasText: 'E2E Jahreswechsel Einnahme' });
      await expect(row.getByText('31.12.2025', { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('income-business-date-desktop.png'), fullPage: true, animations: 'disabled' });
      await page.setViewportSize({ width: 390, height: 844 });
      const card = page.getByRole('article').filter({ hasText: 'E2E Jahreswechsel Einnahme' });
      await expect(card.getByText('31.12.2025', { exact: false })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('income-business-date-mobile.png'), fullPage: true, animations: 'disabled' });
      for (const date of [undefined, '2026-02-30']) {
        const invalid = await page.request.post('http://127.0.0.1:3100/api/incomes', { data: { description: 'Invalid income date', amount: 1, date } });
        expect(invalid.status()).toBe(400);
        expect((await invalid.json()).field).toBe('date');
      }
    } finally {
      await context.close();
    }
  });

  test('shows the cash overdraft error and retains the zero balance', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    const created = await page.request.post('/api/cashbook', { data: { name: 'E2E Nullbestand', initialBalance: 0 } });
    expect(created.status()).toBe(201);
    const cashBook = await created.json();
    await page.goto('/cashbook');
    await page.getByRole('button', { name: 'Buchung', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Neue Kassenbuchung' });
    await dialog.getByRole('button', { name: 'Ausgabe', exact: true }).click();
    await dialog.locator('#tx-amount').fill('1');
    await dialog.locator('#tx-description').fill('E2E nicht gedeckte Barausgabe');
    const denied = page.waitForResponse(response => response.url().endsWith('/api/cashbook/transactions') && response.request().method() === 'POST');
    const errorMessage = page.waitForEvent('dialog').then(async alert => {
      expect(alert.message()).toContain('negativen Kassenbestand');
      await alert.accept();
    });
    await dialog.getByRole('button', { name: 'Buchung erfassen', exact: true }).click();
    expect((await denied).status()).toBe(409);
    await errorMessage;
    await expect(dialog).toBeVisible();
    const transactions = await (await page.request.get(`/api/cashbook/transactions?cashBookId=${cashBook.id}`)).json();
    expect(transactions.items).toEqual([]);
    const books = await (await page.request.get('/api/cashbook')).json();
    expect(books.find((item: { id: number }) => item.id === cashBook.id).currentBalance).toBe(0);
  });

  test('blocks anonymous data access and revokes an existing cookie after a password reset', async ({ page, request }) => {
    expect((await request.get('/api/users')).status()).toBe(401);
    expect((await request.get('/api/incomes')).status()).toBe(401);
    expect((await request.post('/api/auth/register', { data: {
      email: 'second-bootstrap@example.test', password: 'SecurePass123', name: 'Blocked bootstrap',
    } })).status()).toBe(403);

    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    const session = await (await page.request.get('/api/auth/session')).json();
    expect((await page.request.get('/api/users')).status()).toBe(200);
    expect((await page.request.patch(`/api/users/${session.user.id}`, {
      data: { password: 'ChangedSecurePass456' },
    })).status()).toBe(200);
    expect((await page.request.get('/api/users')).status()).toBe(401);
    expect((await page.request.get('/api/incomes')).status()).toBe(401);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

});
