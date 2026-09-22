import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

const testUser = {
  name: 'E2E Admin',
  email: `e2e-${Date.now()}@example.test`,
  password: 'SecurePass123',
};

test.describe.serial('auth, dashboard and invoice flow', () => {
  test('registers the first admin user and opens the dashboard', async ({ page }, testInfo) => {
    const deniedBootstrap = await page.request.post('/api/auth/register', { data: {
      email: 'unproven-admin@example.test', name: 'Unproven', password: testUser.password,
    } });
    expect(deniedBootstrap.status()).toBe(403);
    await page.goto('/register');

    await page.getByLabel('Name').fill(testUser.name);
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Bootstrap-Nachweis', { exact: true }).fill('e2e-bootstrap-token-for-isolated-fixtures-only');
    const overlongPassword = 'Aa1' + '😀'.repeat(18);
    await page.getByLabel('Passwort', { exact: true }).fill(overlongPassword);
    await page.getByLabel('Passwort bestätigen').fill(overlongPassword);
    await page.getByRole('button', { name: 'Admin-Konto erstellen' }).click();
    await expect(page.getByText('Passwort darf maximal 72 UTF-8-Bytes lang sein.', { exact: false })).toBeVisible();
    await expect(page).toHaveURL(/\/register/);
    await page.screenshot({ path: testInfo.outputPath('password-byte-policy.png'), fullPage: true });
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

  test('lets an admin maintain SMTP without exposing the stored password', async ({ page }, testInfo) => {
    expect((await page.request.get('/api/settings/smtp')).status()).toBe(401);
    expect((await page.request.put('/api/settings/smtp', { data: {} })).status()).toBe(401);
    expect((await page.request.delete('/api/settings/smtp')).status()).toBe(401);
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/settings');
    await page.locator('#smtp-host').fill('smtp.example.test');
    await page.locator('#smtp-port').fill('587');
    await page.locator('#smtp-from').fill('rechnung@example.test');
    await page.locator('#smtp-user').fill('synthetic-mail-user');
    const syntheticPassword = 'synthetic-smtp-password-e2e';
    await page.locator('#smtp-password').fill(syntheticPassword);
    await page.getByRole('button', { name: 'SMTP speichern', exact: true }).click();
    await expect(page.getByText('SMTP-Konfiguration gespeichert.', { exact: true })).toBeVisible();
    await expect(page.locator('#smtp-password')).toHaveValue('');

    await page.reload();
    await expect(page.locator('#smtp-host')).toHaveValue('smtp.example.test');
    await expect(page.locator('#smtp-password')).toHaveValue('');
    await expect(page.getByText('· Passwort gespeichert', { exact: true })).toBeVisible();
    await page.locator('#smtp-port').fill('465');
    await page.locator('#smtp-secure').click();
    await page.getByRole('button', { name: 'SMTP speichern', exact: true }).click();
    await expect(page.getByText('SMTP-Konfiguration gespeichert.', { exact: true })).toBeVisible();
    const response = await page.request.get('/api/settings/smtp');
    expect(response.ok()).toBe(true);
    const configuration = await response.json();
    expect(configuration).toMatchObject({ port: 465, secure: true, source: 'database', passwordConfigured: true });
    expect(configuration).not.toHaveProperty('password');
    expect(configuration).not.toHaveProperty('encryptedPassword');
    expect(JSON.stringify(configuration)).not.toContain(syntheticPassword);
    const backup = await page.request.get('/api/backup');
    expect(backup.ok()).toBe(true);
    expect(await backup.text()).not.toContain(syntheticPassword);
    await page.setViewportSize({ width: 1280, height: 1200 });
    await page.locator('#smtp-versand').scrollIntoViewIfNeeded();
    await page.locator('#smtp-versand').screenshot({ path: testInfo.outputPath('smtp-settings.png') });
    await page.getByRole('button', { name: 'Gespeicherte Konfiguration entfernen', exact: true }).click();
    await expect(page.getByText('Gespeicherte SMTP-Konfiguration entfernt.', { exact: false })).toBeVisible();
    expect((await (await page.request.get('/api/settings/smtp')).json()).source).not.toBe('database');
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

    const invalidBackup = { version: '2.0', confirmOverwrite: true, data: {
      invoices: [{ id: 1, fileName: 'paid.pdf', storedFileName: 'paid.pdf', status: 'PAID', totalAmount: 100, parsedData: {} }],
      incomes: [{ id: 1, description: 'Conflicting payment', amount: 90, invoiceId: 1, date: '2026-06-15' }],
    } };
    for (const endpoint of ['/api/backup/preview', '/api/backup/restore']) {
      const rejected = await page.request.post(endpoint, { data: invalidBackup });
      expect(rejected.status()).toBe(400);
      expect((await rejected.json()).issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'incomes[0].amount' }),
      ]));
    }
    const preserved = await (await page.request.get('/api/incomes')).json();
    expect(preserved.items.some((item: { id: number }) => item.id === income.id)).toBe(true);

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
      // Exercise a real server-side calendar rejection and the form's recovery.
      await page.route('**/api/incomes', async route => {
        await route.continue({ postData: JSON.stringify({ ...route.request().postDataJSON(), date: '2026-02-30' }) });
      }, { times: 1 });
      const rejected = page.waitForResponse(response => response.url().endsWith('/api/incomes') && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Einnahme speichern', exact: true }).click();
      expect((await rejected).status()).toBe(400);
      await expect(page.locator('#income-date-error')).toContainText('Zahlungsdatum');
      await expect(page.getByLabel('Zahlungsdatum', { exact: true })).toHaveAttribute('aria-invalid', 'true');
      await page.getByLabel('Zahlungsdatum', { exact: true }).locator('..').screenshot({ path: testInfo.outputPath('income-date-field-error.png'), animations: 'disabled' });
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

  test('deactivates access while keeping the user visible and rejects old sessions and keys', async ({ page, browser }, testInfo) => {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    const email = 'former-e2e@example.test';
    expect((await page.request.post('/api/users', { data: { email, name: 'Former user', password: 'SecurePass123', role: 'USER' } })).ok()).toBe(true);
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3100' });
    const former = await context.newPage();
    try {
      await former.goto('/login');
      await former.getByLabel('E-Mail').fill(email);
      await former.getByLabel('Passwort', { exact: true }).fill('SecurePass123');
      await former.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
      await expect(former).toHaveURL(/\/dashboard/);
      expect((await former.request.post('/api/incomes', { data: { description: 'Retained income', amount: 10, date: '2026-01-01' } })).ok()).toBe(true);
      const keyResponse = await former.request.post('/api/api-keys', { data: { name: 'Revocation test', scopes: ['read'] } });
      expect(keyResponse.status()).toBe(201);
      const { key } = await keyResponse.json();
      await page.goto('/users');
      const row = page.getByRole('row').filter({ hasText: email });
      await expect(row.getByText('Aktiv', { exact: true })).toBeVisible();
      page.once('dialog', dialog => dialog.accept());
      await row.getByRole('button', { name: 'Zugang deaktivieren' }).click();
      await expect(row.getByText('Deaktiviert', { exact: true })).toBeVisible();
      await expect(row.getByRole('button', { name: 'Zugang deaktivieren' })).toBeDisabled();
      await page.screenshot({ path: testInfo.outputPath('deactivated-user.png'), fullPage: true });
      expect((await former.request.get('/api/incomes')).status()).toBe(401);
      expect((await former.request.get('/api/v1/incomes', { headers: { Authorization: `Bearer ${key}` } })).status()).toBe(401);
      await former.goto('/dashboard');
      await expect(former).toHaveURL(/\/login/);
      await former.getByLabel('E-Mail').fill(email);
      await former.getByLabel('Passwort', { exact: true }).fill('SecurePass123');
      await former.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
      await expect(former.getByRole('alert')).toBeVisible();
      await expect(former).toHaveURL(/\/login/);
    } finally { await context.close(); }
  });

  test('shows annual tax data and downloads an explicitly limited EÜR working paper', async ({ page }, testInfo) => {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/steuer-simulation');
    const annual = page.waitForResponse(response => response.url().includes('/api/tax-summary?') && response.url().includes('year=2025'));
    await page.getByLabel('Steuerjahr', { exact: true }).selectOption('2025');
    const summary = await (await annual).json();
    expect(summary.complete).toBe(true);
    expect(summary.annualBasis).toBe(true);
    expect(summary.profit).toBe(45.67);
    await expect(page.getByRole('heading', { name: 'Gewinn laut EÜR' })).toBeVisible();
    await expect(page.getByText('Zeitraum: Steuerjahr 2025', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('tax-annual.png'), fullPage: true });
    await page.getByLabel('Analysezeitraum').selectOption('last3Months');
    await expect(page.getByRole('alert').filter({ hasText: 'keine endgültige Steuerlast' })).toBeVisible();
    await expect(page.getByText('nicht berechnet', { exact: true }).first()).toBeVisible();
    await page.goto('/dashboard?tab=eur');
    await page.getByRole('button', { name: 'EÜR-Übertragungshilfe öffnen', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Anlage EÜR – Übertragungshilfe' });
    await expect(dialog.getByText('anlage-euer-2025-v1', { exact: false })).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'CSV herunterladen' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('Anlage-EUER-Uebertragungshilfe-2025.csv');
    const csv = await readFile((await download.path())!, 'utf8');
    expect(csv).toContain('45,67');
    expect(csv).toContain('anlage-euer-2025-v1');
    await page.screenshot({ path: testInfo.outputPath('eur-working-paper.png'), fullPage: true });
  });

  test('remembers customer context, reserves services and offers the previous price without leaking internal notes', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    const privateNote = 'INTERN: Bestellnummer vor Versand prüfen';
    const customerName = 'E2E Billing Assistant';
    await page.goto('/customers');
    await page.getByRole('button', { name: 'Neuen Kunden anlegen' }).click();
    await page.locator('#name').fill(customerName);
    await page.locator('#email').fill('billing@example.test');
    await page.locator('#address').fill('Kundenweg 2');
    await page.locator('#zipCode').fill('10115');
    await page.locator('#city').fill('Berlin');
    await page.locator('#internalNote').fill(privateNote);
    await page.locator('#noteVisibility').selectOption('BOTH');
    const customerSaved = page.waitForResponse(r => r.url().endsWith('/api/customers') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Kunden anlegen', exact: true }).click();
    const customerResponse = await customerSaved;
    expect(customerResponse.ok()).toBe(true);
    const customer = await customerResponse.json();

    await page.getByRole('button', { name: `Leistungsnotizen für ${customerName}` }).click();
    await page.locator('#billing-note-date').fill('2026-09-22');
    await page.locator('#billing-note-description').fill('Serverwartung');
    await page.locator('#billing-note-quantity').fill('2');
    await page.locator('#billing-note-unit').selectOption('Stunde');
    const noteSaved = page.waitForResponse(r => r.url().endsWith('/api/billing-notes') && r.request().method() === 'POST');
    await page.getByRole('button', { name: /Leistungsnotiz hinzufügen/ }).click();
    expect((await noteSaved).status()).toBe(201);
    await expect(page.getByText('Serverwartung', { exact: true })).toBeVisible();
    await page.getByRole('dialog').screenshot({ path: testInfo.outputPath('billing-notes.png') });

    await page.goto('/dashboard/invoices/new');
    await page.getByRole('combobox', { name: 'Gespeicherten Kunden auswählen' }).selectOption(String(customer.id));
    await expect(page.getByText(privateNote, { exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Gespeicherten Kunden auswählen' }).selectOption('');
    await expect(page.locator('#customer')).toHaveValue('');
    await expect(page.locator('#invoice-buyer-email')).toHaveValue('');
    await expect(page.getByText(privateNote, { exact: true })).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Gespeicherten Kunden auswählen' }).selectOption(String(customer.id));
    await page.getByRole('checkbox', { name: 'Leistungsnotiz Serverwartung übernehmen' }).check();
    await expect(page.locator('#invoice-item-description-0')).toHaveValue('Serverwartung');
    await expect(page.locator('#invoice-item-quantity-0')).toHaveValue('2');
    await page.locator('#invoice-item-price-0').fill('95');
    await page.getByRole('combobox', { name: 'Ausgabeformat', exact: true }).selectOption('xml-only');
    await page.getByLabel('Käuferreferenz / Leitweg-ID', { exact: false }).fill('E2E-ORDER');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath('billing-assistant-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath('billing-assistant-mobile.png'), fullPage: true });

    let failedSaveDownloads = 0;
    const countDownload = () => { failedSaveDownloads += 1; };
    page.on('download', countDownload);
    await page.route('**/api/invoices/upload', route => route.fulfill({
      status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetischer Speicherkonflikt' }),
    }), { times: 1 });
    const failureDialog = page.waitForEvent('dialog').then(async dialog => {
      expect(dialog.message()).toContain('Synthetischer Speicherkonflikt');
      await dialog.accept();
    });
    await page.getByRole('button', { name: 'XML erstellen', exact: true }).click();
    await failureDialog;
    await expect(page.getByRole('button', { name: 'XML erstellen', exact: true })).toBeEnabled();
    expect(failedSaveDownloads).toBe(0);
    page.off('download', countDownload);
    await expect(page.locator('#invoice-item-price-0')).toHaveValue('95');
    expect(await (await page.request.get(`/api/billing-notes?customerId=${customer.id}`)).json()).toHaveLength(1);

    // The server commits, but its response never reaches the browser. Retrying
    // must recover that same invoice and preserve its single note reservation.
    await page.route('**/api/invoices/upload', async route => {
      const committed = await route.fetch();
      expect(committed.ok(), await committed.text()).toBe(true);
      await route.abort('failed');
    }, { times: 1 });
    const lostResponseDialog = page.waitForEvent('dialog').then(dialog => dialog.accept());
    await page.getByRole('button', { name: 'XML erstellen', exact: true }).click();
    await lostResponseDialog;
    await expect(page.getByRole('button', { name: 'XML erstellen', exact: true })).toBeEnabled();
    expect(await (await page.request.get(`/api/billing-notes?customerId=${customer.id}`)).json()).toEqual([]);

    const downloaded = page.waitForEvent('download');
    const uploaded = page.waitForResponse(r => r.url().endsWith('/api/invoices/upload') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'XML erstellen', exact: true }).click();
    const response = await uploaded;
    expect(response.ok(), await response.text()).toBe(true);
    const invoice = await response.json();
    const download = await downloaded;
    const xml = await readFile((await download.path())!, 'utf8');
    expect(xml).toContain('Serverwartung');
    expect(xml).not.toContain(privateNote);
    expect(await (await page.request.get(`/api/billing-notes?customerId=${customer.id}`)).json()).toEqual([]);
    const reserved = await (await page.request.get(`/api/billing-notes?customerId=${customer.id}&includeLinked=true`)).json();
    expect(reserved[0].invoiceId).toBe(invoice.id);
    const draftResponse = await page.request.post('/api/email/preview', { data: { documentType: 'invoice', id: invoice.id } });
    expect(draftResponse.ok()).toBe(true);
    const draft = await draftResponse.json();
    expect(draft.internalCustomerNote).toBe(privateNote);
    expect(draft.text).not.toContain(privateNote);
    expect(draft.subject).not.toContain(privateNote);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/customers');
    await page.getByRole('button', { name: `Leistungsnotizen für ${customerName}` }).click();
    await expect(page.getByText('Rechnung zugeordnet', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Leistungsnotiz Serverwartung löschen' })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('dialog').screenshot({ path: testInfo.outputPath('billing-notes-reserved.png') });

    expect((await page.request.put('/api/invoices', { data: { id: invoice.id, status: 'SENT' } })).ok()).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/dashboard/invoices/new');
    await page.getByRole('combobox', { name: 'Gespeicherten Kunden auswählen' }).selectOption(String(customer.id));
    await page.locator('#invoice-item-description-0').fill('Serverwartung');
    await page.locator('#invoice-item-unit-0').selectOption('Stunde');
    await expect(page.locator('#invoice-item-price-0')).toHaveValue('0');
    await page.getByRole('button', { name: /Preis übernehmen/ }).click();
    await expect(page.locator('#invoice-item-price-0')).toHaveValue('95');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath('price-memory.png'), fullPage: true });
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
