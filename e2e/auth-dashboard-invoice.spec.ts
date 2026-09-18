import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

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
    const incomeResponse = await page.request.post('/api/incomes', { data: { description: 'Must survive merge', amount: 42 } });
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
