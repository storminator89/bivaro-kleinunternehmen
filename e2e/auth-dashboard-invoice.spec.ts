import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

const testUser = {
  name: 'E2E Admin',
  email: `e2e-${Date.now()}@example.test`,
  password: 'SecurePass123',
};

const invoiceIssuer = {
  companyName: 'E2E Rechnungssteller', companyAddress: 'Testweg 1\n10115 Berlin',
  email: 'rechnung@example.test', telephone: '+49 301234567',
  taxNumber: '123/456/78901', iban: 'DE89370400440532013000',
  // Legacy workflows explicitly declare the old §19 fixture; UNSET is tested below.
  fiscalTaxRegime: 'SMALL_BUSINESS', fiscalEffectiveFrom: '2020-01-01',
};

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(testUser.email);
  await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function saveFiscalProfile(page: Page, regime: 'STANDARD' | 'SMALL_BUSINESS', date: string) {
  await page.goto('/settings#fiscal-profile');
  const profile = page.locator('#fiscal-profile');
  await profile.locator(`input[value="${regime}"]`).check();
  await profile.getByLabel('Gültig ab', { exact: true }).fill(date);
  await profile.getByRole('checkbox', { name: /Ich bestätige meine Auswahl/ }).check();
  const saved = page.waitForResponse(response => response.url().endsWith('/api/settings') && response.request().method() === 'POST');
  await profile.getByRole('button', { name: 'Steuerprofil speichern', exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await expect(profile.getByText('Steuerprofil gespeichert. Bestehende Rechnungen bleiben unverändert.', { exact: true })).toBeVisible();
}

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
    await expect(page.getByRole('heading', { name: 'Jahresvergleich', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Letzte Aktivitäten', exact: true })).toBeVisible();
    // Generated artwork must load without breaking text labels or navigation.
    const sidebarIcons = page.locator('aside [data-bivaro-icon^="nav-"]');
    await expect(sidebarIcons).toHaveCount(14);
    await expect(page.locator('.dashboard-metrics [data-bivaro-icon^="tile-"]')).toHaveCount(4);
    await expect(page.getByRole('main').locator('img[data-bivaro-icon]')).toHaveCount(0);
    const flatAccents = page.locator('.dashboard-metrics [data-bivaro-style="flat"]');
    await expect(flatAccents).toHaveCount(4);
    const masks = await flatAccents.evaluateAll(elements => elements.map(element => ({
      mask: getComputedStyle(element).maskImage,
      ink: getComputedStyle(element).backgroundColor,
      width: element.getBoundingClientRect().width,
    })));
    for (const accent of masks) {
      expect(accent.mask).toContain('/brand/icons/flat/');
      expect(accent.ink).toBe('rgb(69, 111, 98)');
      expect(accent.width).toBeLessThanOrEqual(32);
      const source = accent.mask.match(/url\(["']?([^"')]+)/)?.[1];
      expect(source).toBeTruthy();
      expect((await page.request.get(source!)).status()).toBe(200);
    }
    await expect(page.locator('aside .brand-full [data-bivaro-icon="bivaro-sidebar-flat"]')).toBeVisible();
    await expect.poll(async () => sidebarIcons.evaluateAll(images => images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
    expect(await page.locator('aside [data-bivaro-icon="nav-dashboard"]').evaluate(image => getComputedStyle(image).filter)).toBe('none');
    for (const iconRoute of ['/favicon.ico', '/icon.png', '/apple-icon.png']) {
      const icon = await page.request.get(iconRoute);
      expect(icon.status()).toBe(200);
      expect(icon.headers()['content-type']).toMatch(/image\//);
    }
    for (const width of [1440, 320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('dashboard-workspace-' + width + '.png'), fullPage: true });
    }
    await expect(page.getByRole('button', { name: 'Rechnung erstellen' })).toBeVisible();
  });

  test('keeps every workspace responsive and navigable', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    const routes = [
      ['overview', '/dashboard'], ['invoices', '/dashboard?tab=invoices'],
      ['quotes', '/dashboard?tab=quotes'], ['incomes', '/dashboard?tab=incomes'],
      ['expenses', '/dashboard?tab=expenses'], ['eur', '/dashboard?tab=eur'],
      ['gwg', '/dashboard?tab=gwg'], ['invoice-editor', '/dashboard/invoices/new'],
      ['quote-editor', '/dashboard/quotes/new'], ['reminders', '/dashboard/reminders'],
      ['customers', '/customers'], ['cashbook', '/cashbook'], ['tax', '/steuer-simulation'],
      ['settings', '/settings'], ['users', '/users'], ['api-keys', '/settings/api-keys'],
      ['api-docs', '/settings/api-keys/docs'], ['audit', '/settings/audit-logs'],
      ['procedures', '/settings/documentation'], ['home', '/'],
    ];
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    for (const [name, route] of routes) {
      await page.goto(route);
      await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.getByRole('main').locator('.animate-spin')).toHaveCount(0);
      for (const width of [1440, 320, 375, 414, 768]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} overflows at ${width}`).toBe(true);
        if (width === 1440 || width === 375) await page.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`), fullPage: true });
      }
    }
    await page.getByRole('button', { name: 'Dunkles Farbschema aktivieren', exact: true }).click();
    await page.goto('/dashboard');
    await page.screenshot({ path: testInfo.outputPath('overview-dark.png'), fullPage: true });
    await page.getByRole('button', { name: 'Helles Farbschema aktivieren', exact: true }).click();
    await page.setViewportSize({ width: 375, height: 900 });
    await page.getByRole('button', { name: 'Menü öffnen', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Mobile Hauptnavigation' })).toBeVisible();
    await page.getByRole('navigation', { name: 'Mobile Hauptnavigation' }).getByRole('link', { name: 'Kunden', exact: true }).click();
    await expect(page).toHaveURL(/\/customers/);
    await expect(page.getByRole('navigation', { name: 'Mobile Hauptnavigation' })).not.toBeVisible();
    expect(pageErrors).toEqual([]);
    // Public auth views use a separate anonymous context and never alter stored records.
    const anonymous = await page.context().browser()!.newContext();
    const publicPage = await anonymous.newPage();
    for (const route of ['/login', '/register']) {
      await publicPage.goto(new URL(route, page.url()).href);
      await expect(publicPage.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
      for (const width of [320, 375, 414, 768, 1440]) {
        await publicPage.setViewportSize({ width, height: 1000 });
        expect(await publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
      await publicPage.screenshot({ path: testInfo.outputPath(route.slice(1) + '-public.png'), fullPage: true });
    }
    await anonymous.close();
  });

  test('requires a conscious dated fiscal profile and persists the real settings UI selection', async ({ page }, testInfo) => {
    await signIn(page);
    expect(await (await page.request.get('/api/settings')).json()).toMatchObject({
      fiscalTaxRegime: 'UNSET', fiscalEffectiveFrom: null, fiscalConfirmedAt: null,
    });
    await page.goto('/dashboard/invoices/new');
    await expect(page.getByLabel('Umsatzsteuerbehandlung dieses Dokuments', { exact: true })).toHaveValue('');
    await expect(page.getByText('Bivaro nimmt § 19 nicht automatisch an.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'PDF erstellen', exact: true })).toBeDisabled();
    await expect(page.getByText('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.', { exact: true })).toHaveCount(0);

    await page.goto('/settings#fiscal-profile');
    const profile = page.locator('#fiscal-profile');
    await expect(profile.getByRole('radio', { name: /Noch nicht geklärt/ })).toBeChecked();
    await profile.getByRole('radio', { name: /Regelbesteuerung/ }).check();
    await profile.getByRole('button', { name: 'Steuerprofil speichern', exact: true }).click();
    await expect(profile.locator('#fiscal-date-error')).toContainText('gültiges Kalenderdatum');
    await expect(profile.getByText('Bitte bestätigen Sie Ihre bewusst gewählte Einordnung.', { exact: true })).toBeVisible();
    await profile.getByLabel('Gültig ab', { exact: true }).fill('2026-01-01');
    await profile.getByRole('button', { name: 'Steuerprofil speichern', exact: true }).click();
    await expect(profile.getByText('Bitte bestätigen Sie Ihre bewusst gewählte Einordnung.', { exact: true })).toBeVisible();
    // Validation must not silently create a confirmed profile.
    expect(await (await page.request.get('/api/settings')).json()).toMatchObject({ fiscalTaxRegime: 'UNSET', fiscalConfirmedAt: null });
    await profile.getByRole('checkbox', { name: /Ich bestätige meine Auswahl/ }).check();
    const saved = page.waitForResponse(response => response.url().endsWith('/api/settings') && response.request().method() === 'POST');
    await profile.getByRole('button', { name: 'Steuerprofil speichern', exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await expect(profile.getByText('Steuerprofil gespeichert. Bestehende Rechnungen bleiben unverändert.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(profile.getByRole('radio', { name: /Regelbesteuerung/ })).toBeChecked();
    await expect(profile.getByLabel('Gültig ab', { exact: true })).toHaveValue('2026-01-01');
    await expect(profile.getByRole('checkbox', { name: /Ich bestätige meine Auswahl/ })).not.toBeChecked();
    await expect(profile.getByText('Gespeichert: Regelbesteuerung · gültig ab 01.01.2026.', { exact: false })).toBeVisible();
    const stored = await (await page.request.get('/api/settings')).json();
    expect(stored).toMatchObject({ fiscalTaxRegime: 'STANDARD', fiscalEffectiveFrom: '2026-01-01' });
    expect(Number.isNaN(Date.parse(stored.fiscalConfirmedAt))).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('fiscal-profile-saved-reloaded.png'), fullPage: true });
  });

  test('defaults standard documents to 19 percent, requires pre-profile acknowledgement and preserves a 7 percent template', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await signIn(page);
    await page.goto('/dashboard/invoices/new');
    const taxMode = page.getByLabel('Umsatzsteuerbehandlung dieses Dokuments', { exact: true });
    const create = page.getByRole('button', { name: 'PDF erstellen', exact: true });
    await expect(taxMode).toHaveValue('standard');
    await expect(page.locator('#invoice-item-tax-0')).toHaveValue('19');
    await page.getByLabel('Empfänger (Name & Anschrift)', { exact: true }).fill('E2E Profilkunde\nKundenweg 2\n10115 Berlin');
    await page.locator('#invoice-item-description-0').fill('Profilprüfung');
    await page.locator('#invoice-item-price-0').fill('100');
    await expect(page.getByRole('complementary', { name: 'Rechnungsübersicht' })).toContainText('119,00');
    await page.getByLabel('Rechnungsdatum', { exact: true }).fill('2025-12-31');
    await expect(taxMode).toHaveValue('');
    await expect(page.getByText('Das Firmenprofil gilt erst ab 2026-01-01', { exact: false })).toBeVisible();
    await taxMode.selectOption('standard');
    const acknowledgement = page.getByRole('checkbox', { name: /Ich habe diese Steuerbehandlung für dieses Dokument geprüft/ });
    await expect(acknowledgement).not.toBeChecked();
    await expect(create).toBeDisabled();
    await acknowledgement.check();
    await expect(create).toBeEnabled();
    await page.getByLabel('Steuerfall', { exact: true }).selectOption('reverse-charge');
    await expect(create).toBeDisabled();
    await expect(page.getByRole('alert').filter({ hasText: 'Dieser Steuerfall wird nicht unterstützt.' })).toBeVisible();
    await page.getByLabel('Steuerfall', { exact: true }).selectOption('domestic');
    await expect(create).toBeEnabled();
    await page.locator('#invoice-item-tax-0').fill('7');
    await expect(page.getByRole('complementary', { name: 'Rechnungsübersicht' })).toContainText('107,00');
    await page.getByText('Rechnungsvorlagen', { exact: true }).click();
    await page.getByRole('button', { name: 'Als Vorlage speichern', exact: true }).click();
    await page.getByPlaceholder('Name der Vorlage', { exact: true }).fill('E2E Ermäßigter Satz 7 Prozent');
    const templateSaved = page.waitForResponse(response => response.url().endsWith('/api/invoice-templates') && response.request().method() === 'POST');
    const notice = page.waitForEvent('dialog').then(async dialog => {
      expect(dialog.message()).toBe('Vorlage erfolgreich gespeichert.');
      await dialog.accept();
    });
    await page.getByRole('button', { name: 'Vorlage speichern', exact: true }).click();
    expect((await templateSaved).ok()).toBe(true);
    await notice;
    const templates = await (await page.request.get('/api/invoice-templates')).json() as Array<{ id: number; name: string; data: { taxMode: string; items: Array<{ taxRate: number }> } }>;
    const template = templates.find(item => item.name === 'E2E Ermäßigter Satz 7 Prozent')!;
    expect(template.data).toMatchObject({ taxMode: 'standard', items: [expect.objectContaining({ taxRate: 7 })] });

    // A later explicit company choice must not rewrite the saved document decision.
    await saveFiscalProfile(page, 'SMALL_BUSINESS', '2020-01-01');
    await page.reload();
    await expect(page.locator('#fiscal-profile').getByRole('radio', { name: /^Kleinunternehmerregelung/ })).toBeChecked();
    await page.goto('/dashboard/invoices/new');
    await expect(taxMode).toHaveValue('small-business');
    await expect(page.locator('#invoice-item-tax-0')).toHaveValue('0');
    await page.getByText('Rechnungsvorlagen', { exact: true }).click();
    await page.getByLabel('Rechnungsvorlage auswählen', { exact: true }).selectOption(String(template.id));
    await expect(taxMode).toHaveValue('standard');
    await expect(page.locator('#invoice-item-tax-0')).toHaveValue('7');
    await expect(page.getByText('Steuerangaben aus der Vorlage bleiben erhalten.', { exact: false })).toBeVisible();
    await page.getByLabel('Rechnungsdatum', { exact: true }).fill('2026-02-01');
    await expect(page.locator('#invoice-item-tax-0')).toHaveValue('7');
    await expect(page.getByRole('complementary', { name: 'Rechnungsübersicht' })).toContainText('107,00');
    await page.screenshot({ path: testInfo.outputPath('fiscal-template-7-preserved.png'), fullPage: true });
  });

  test('opens the invoice creation flow from the dashboard', async ({ page }, testInfo) => {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await page.getByRole('button', { name: 'Rechnung erstellen' }).click();

    await expect(page).toHaveURL(/\/dashboard\/invoices\/new/);
    await expect(page.getByRole('heading', { name: 'Rechnung erstellen', level: 1 })).toBeVisible();
    await page.locator('#invoice-item-description-0').fill('Designprüfung');
    await page.locator('#invoice-item-quantity-0').fill('2');
    await page.locator('#invoice-item-price-0').fill('125.50');
    const summary = page.getByRole('complementary', { name: 'Rechnungsübersicht' });
    await expect(summary).toContainText('251,00');
    await page.getByRole('button', { name: 'Position 1 duplizieren', exact: true }).click();
    await expect(summary).toContainText('502,00');
    await page.getByRole('button', { name: 'Position 2 entfernen', exact: true }).click();
    for (const width of [1440, 320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('invoice-studio-' + width + '.png'), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByText('Rechnungsvorlagen', { exact: true }).click();
    await expect(page.getByLabel('Rechnungsvorlage auswählen')).toBeVisible();
    await page.getByRole('button', { name: 'Live-Vorschau', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Rechnungsvorschau' })).toBeVisible();
  });

  test('creates a quote with the displayed amount and downloads its PDF', async ({ page }, testInfo) => {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/dashboard/quotes/new');
    await page.getByLabel('Umsatzsteuerbehandlung dieses Dokuments', { exact: true }).selectOption('standard');
    await page.getByRole('checkbox', { name: /Ich habe diese Steuerbehandlung für dieses Dokument geprüft/ }).check();
    await page.getByLabel('Empfänger (Name & Anschrift)', { exact: true }).fill('Designfixture Kunde\nTestweg 1\n10115 Berlin');
    await page.getByLabel('Angebotsnummer', { exact: true }).fill('E2E-DESIGN-QUOTE');
    await page.locator('#quote-item-0-description').fill('Designprüfung\nMit mehrzeiliger Beschreibung');
    await page.locator('#quote-item-0-quantity').fill('2');
    await page.locator('#quote-item-0-unit-price').fill('100');
    await page.locator('#quote-item-0-tax').fill('19');
    await expect(page.getByRole('complementary', { name: 'Angebotsübersicht' })).toContainText('238,00');
    await page.setViewportSize({ width: 375, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('quote-editor-populated-375.png'), fullPage: true });
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Angebot erstellen & speichern', exact: true }).click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe('Angebot_E2E-DESIGN-QUOTE.pdf');
    const pdf = await readFile((await download.path())!);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const stored = await (await page.request.get('/api/quotes?search=E2E-DESIGN-QUOTE')).json();
    expect(stored.items).toEqual(expect.arrayContaining([expect.objectContaining({invoiceNumber:'E2E-DESIGN-QUOTE',totalAmount:238})]));
  });

  test('keeps invoice filters and navigation usable at compact widths', async ({ page }, testInfo) => {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/dashboard?tab=invoices');
    await expect(page.getByRole('heading', { name: 'Rechnungen', exact: true, level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Offen', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Offen', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Filter zurücksetzen', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Alle', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#invoiceFile')).not.toBeVisible();
    await page.getByText('E-Rechnung importieren', { exact: true }).click();
    await expect(page.getByLabel('Rechnungsdatei auswählen')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rechnung hochladen', exact: true })).toBeDisabled();
    await page.getByText('E-Rechnung importieren', { exact: true }).click();
    await page.getByLabel('Suche', { exact: true }).fill('Keine-Treffer-UI-Test');
    await expect(page.getByRole('button', { name: 'Filter zurücksetzen' })).toBeVisible();
    await page.getByRole('button', { name: 'Filter zurücksetzen' }).click();
    await expect(page.getByLabel('Suche', { exact: true })).toHaveValue('');
    for (const width of [1440, 320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 960 });
      await expect(page.getByRole('heading', { name: 'Rechnungen', exact: true, level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('invoices-' + width + '.png'), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByRole('button', { name: 'Sidebar einklappen', exact: true }).click();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole('button', { name: 'Menü öffnen', exact: true }).click();
    const mobileNavigation = page.getByRole('navigation', { name: 'Mobile Hauptnavigation' });
    await expect(mobileNavigation.getByText('Ausgaben', { exact: true })).toBeVisible();
    await mobileNavigation.getByRole('link', { name: 'Ausgaben', exact: true }).click();
    await expect(mobileNavigation).not.toBeVisible();
    for (const tab of ['expenses', 'incomes', 'quotes']) {
      await page.setViewportSize({ width: 320, height: 960 });
      await page.goto('/dashboard?tab=' + tab);
      await expect(page.locator('#mobile-work-area')).toHaveCount(0);
      await expect(page.getByText('Summe dieser Seite', { exact: true })).toBeVisible();
      if (tab === 'quotes') await expect(page.getByRole('button', { name: 'Angebot erstellen', exact: true })).toHaveCount(1);
      if (tab === 'expenses' || tab === 'incomes') {
        await expect(page.locator(tab === 'expenses' ? '#description' : '#incomeDescription')).not.toBeVisible();
        await page.getByRole('button', { name: tab === 'expenses' ? 'Ausgabe erfassen' : 'Einnahme erfassen', exact: true }).click();
        await expect(page.locator(tab === 'expenses' ? '#description' : '#incomeDescription')).toBeVisible();
      }
      const clippedButtons = await page.getByRole('main').locator('button').evaluateAll(buttons => buttons.filter(button => {
        const rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && (rect.left < 0 || rect.right > window.innerWidth + 1);
      }).map(button => button.textContent));
      expect(clippedButtons).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(tab + '-320.png'), fullPage: true });
    }
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
    for (const width of [1440, 320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('settings-workspace-' + width + '.png'), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
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
    expect((await page.request.post('/api/settings', { data: invoiceIssuer })).ok()).toBe(true);

    await page.getByRole('button', { name: 'Rechnung erstellen' }).click();
    await page.getByRole('combobox', { name: 'Ausgabeformat', exact: true }).selectOption('xml-only');
    await page.getByLabel('Umsatzsteuerbehandlung').selectOption('standard');
    await page.getByRole('checkbox', { name: /Ich habe diese Steuerbehandlung für dieses Dokument geprüft/ }).check();
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

  for (const workspace of ['dashboard', 'reminders'] as const) {
    test(`records one explicit backdated full payment from ${workspace}, retaining failures and retrying only reads after save`, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      await signIn(page);
      const mobile = workspace === 'reminders';
      await page.setViewportSize({ width: mobile ? 390 : 1440, height: mobile ? 844 : 1000 });
      const invoiceNumber = `E2E-BPR010-${workspace.toUpperCase()}`;
      const pdf = await PDFDocument.create();
      pdf.addPage();
      const created = await page.request.post('/api/invoices', { data: {
        fileName: `${invoiceNumber}.pdf`, invoiceNumber, totalAmount: 123.45,
        invoiceDate: '2024-12-01', dueDate: '2024-12-15', parsedData: { currency: 'EUR' },
        pdfBytes: await pdf.saveAsBase64(),
      } });
      expect(created.ok()).toBe(true);
      const invoice = await created.json();
      const paymentPath = `/api/invoices/${invoice.id}/payments`;
      const readInvoice = async () => {
        const list = await (await page.request.get(`/api/invoices?search=${invoiceNumber}`)).json();
        expect(list.items).toHaveLength(1);
        return list.items[0];
      };
      const readPayment = async () => {
        const response = await page.request.get(paymentPath);
        expect(response.ok()).toBe(true);
        return response.json();
      };
      const before = await readInvoice();
      const preflight = await readPayment();
      expect(preflight).toMatchObject({ currency: 'EUR', event: null, canRecordPayment: true,
        summary: { totalCents: '12345', paidCents: '0', openCents: '12345', paid: false, paidAt: null } });
      // The compatibility API must not silently guess today when an actual date is missing.
      const undated = await page.request.put('/api/invoices', { data: { id: invoice.id, status: 'PAID' } });
      expect(undated.status()).toBe(400);
      expect((await undated.json()).code).toBe('PAYMENT_DETAILS_REQUIRED');
      expect(await readInvoice()).toEqual(before);
      await page.goto(workspace === 'dashboard' ? '/dashboard?tab=invoices' : '/dashboard/reminders');
      const openPayment = async () => {
        if (workspace === 'dashboard') {
          const row = page.getByRole('row').filter({ hasText: invoiceNumber });
          await row.getByRole('button', { name: 'Zahlungsstatus: Entwurf', exact: true }).click();
          await page.getByRole('menuitem', { name: 'Bezahlt', exact: true }).click();
        } else {
          const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: invoiceNumber, exact: true }) });
          await card.getByRole('button', { name: 'Zahlung erfassen', exact: true }).focus();
          await page.keyboard.press('Enter');
        }
        const dialog = page.getByRole('dialog', { name: 'Vollständige Zahlung erfassen', exact: true });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Zahlung verbindlich erfassen', exact: true })).toBeEnabled();
        await expect(dialog).toContainText('123,45');
        await expect(dialog.getByLabel('Tatsächliches Zahlungsdatum', { exact: true })).toHaveValue('');
        await expect(dialog.getByLabel('Zahlungsreferenz', { exact: true })).toHaveValue('');
        return dialog;
      };
      let postCount = 0;
      let failedOnce = false;
      let blockRefresh = false;
      let blockedReads = 0;
      let refreshReads = 0;
      let firstAttemptPayload: Record<string, unknown> | undefined;
      let savedPayload: Record<string, unknown> | undefined;
      let savedEvent: { id: number; incomeId: number } | undefined;
      await page.route(`**${paymentPath}`, async route => {
        if (route.request().method() !== 'POST') return route.continue();
        postCount += 1;
        const payload = route.request().postDataJSON();
        // Exercise a real API rejection, not an invented success/error response.
        const response = await route.fetch({ postData: JSON.stringify(!failedOnce ? { ...payload, paidAt: '2026-02-30' } : payload) });
        const body = await response.body();
        if (!failedOnce) {
          expect(response.status()).toBe(400);
          firstAttemptPayload = payload;
          failedOnce = true;
        } else if (response.ok()) {
          savedPayload = payload;
          savedEvent = JSON.parse(body.toString()).event;
          blockRefresh = true;
        }
        await route.fulfill({ response, body });
      });
      await page.route(workspace === 'dashboard' ? '**/api/invoices?*' : '**/api/reminders?*', async route => {
        if (route.request().method() !== 'GET') return route.continue();
        refreshReads += 1;
        if (blockRefresh) {
          blockedReads += 1;
          await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Isolated E2E list refresh failure' }) });
        } else await route.continue();
      });
      const assertDialogFitsViewport = async () => {
        const bounds = await page.getByRole('dialog').evaluate(element => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight };
        });
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.top).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(bounds.width);
        expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
      };
      let dialog = await openPayment();
      await assertDialogFitsViewport();
      await page.screenshot({ path: testInfo.outputPath(`${workspace}-payment-open-blank.png`), fullPage: false, animations: 'disabled' });
      await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      expect(postCount).toBe(0);
      expect(await readInvoice()).toEqual(before);
      expect(await readPayment()).toEqual(preflight);
      dialog = await openPayment();
      const date = dialog.getByLabel('Tatsächliches Zahlungsdatum', { exact: true });
      const reference = dialog.getByLabel('Zahlungsreferenz', { exact: true });
      const submit = dialog.getByRole('button', { name: 'Zahlung verbindlich erfassen', exact: true });
      await expect(date).toHaveAttribute('required', '');
      await expect(reference).toHaveAttribute('required', '');
      await submit.click();
      expect(await date.evaluate(input => (input as HTMLInputElement).validity.valueMissing)).toBe(true);
      expect(postCount).toBe(0);
      await date.fill('2024-12-31');
      await submit.click();
      expect(await reference.evaluate(input => (input as HTMLInputElement).validity.valueMissing)).toBe(true);
      expect(postCount).toBe(0);
      await submit.focus();
      await page.keyboard.press('Shift+Tab'); // Cancel, then the required reference.
      await page.keyboard.press('Shift+Tab');
      await expect(reference).toBeFocused();
      await reference.pressSequentially(`Synthetic statement ${workspace} 2024-12-31`);
      await submit.focus();
      await page.keyboard.press('Enter');
      await expect(dialog.getByRole('alert')).toContainText('Zahlungsdatum');
      await expect(date).toHaveValue('2024-12-31');
      await expect(reference).toHaveValue(`Synthetic statement ${workspace} 2024-12-31`);
      expect(await readInvoice()).toEqual(before);
      expect((await readPayment()).event).toBeNull();
      await assertDialogFitsViewport();
      await page.screenshot({ path: testInfo.outputPath(`${workspace}-payment-error-retains-input.png`), fullPage: false, animations: 'disabled' });
      const saved = page.waitForResponse(response => response.url().endsWith(paymentPath) && response.request().method() === 'POST' && response.status() === 201);
      await submit.focus();
      await page.keyboard.press('Enter');
      await saved;
      await expect(dialog.getByText('Zahlung gespeichert', { exact: true })).toBeVisible();
      await expect(dialog.getByRole('alert')).toHaveText('Die Zahlung ist gespeichert, aber die Listen konnten nicht aktualisiert werden. Nicht erneut buchen.');
      expect(blockedReads).toBeGreaterThan(0);
      expect(postCount).toBe(2);
      await expect(submit).toHaveCount(0);
      await expect(dialog).toContainText('31.12.2024');
      await expect(dialog.getByRole('status')).toBeFocused();
      expect(savedPayload).toMatchObject({ amount: '123.45', currency: 'EUR', paidAt: '2024-12-31', source: 'MANUAL', reference: `Synthetic statement ${workspace} 2024-12-31` });
      expect(savedPayload?.idempotencyKey).toMatch(/^[\da-f-]{36}$/iu);
      expect(savedPayload).toEqual(firstAttemptPayload); // An unchanged retry keeps its request identity.
      expect(savedEvent?.incomeId).toEqual(expect.any(Number));
      await assertDialogFitsViewport();
      await page.screenshot({ path: testInfo.outputPath(`${workspace}-payment-saved-refresh-warning.png`), fullPage: false, animations: 'disabled' });
      const readsBeforeRetry = refreshReads;
      blockRefresh = false;
      await dialog.getByRole('button', { name: 'Listen aktualisieren', exact: true }).click();
      await expect(dialog.getByRole('alert')).toHaveCount(0);
      expect(refreshReads).toBeGreaterThan(readsBeforeRetry);
      expect(postCount).toBe(2); // Refresh recovery is GET-only, never another payment POST.
      const assertSinglePayment = async () => {
        const stored = await readPayment();
        expect(stored).toMatchObject({ canRecordPayment: false, event: { id: savedEvent!.id, incomeId: savedEvent!.incomeId, amountCents: '12345', reference: savedPayload!.reference, dateCertainty: 'ACTUAL', paidAt: '2024-12-31T00:00:00.000Z' },
          summary: { totalCents: '12345', paidCents: '12345', openCents: '0', paid: true } });
        const record = await readInvoice();
        expect(record).toMatchObject({ status: 'PAID', paidAt: '2024-12-31T00:00:00.000Z', issuanceState: 'ISSUED', income: { id: savedEvent!.incomeId, amount: 123.45, date: '2024-12-31T00:00:00.000Z' } });
        const incomes = await (await page.request.get(`/api/incomes?search=${invoiceNumber}&pageSize=100`)).json();
        expect(incomes.items).toHaveLength(1);
        expect(incomes.items[0]).toMatchObject({ id: savedEvent!.incomeId, invoiceId: invoice.id, amount: 123.45 });
      };
      await assertSinglePayment();
      const replay = await page.request.post(paymentPath, { data: savedPayload });
      expect(replay.status()).toBe(200);
      expect(await replay.json()).toMatchObject({ replayed: true, event: { id: savedEvent!.id, incomeId: savedEvent!.incomeId } });
      await dialog.locator('[data-slot="dialog-footer"]').getByRole('button', { name: 'Schließen', exact: true }).click();
      await page.reload();
      await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
      await assertSinglePayment();
      expect(postCount).toBe(2);
      if (workspace === 'reminders') {
        await expect(page.getByRole('article').filter({ hasText: invoiceNumber })).toHaveCount(0);
      } else {
        await expect(page.getByRole('row').filter({ hasText: invoiceNumber })).toContainText('Bezahlt');
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${workspace}-payment-reloaded.png`), fullPage: false, animations: 'disabled' });
    });
  }

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
    await card.getByRole('button', { name: `Weitere Aktionen fuer Rechnung ${invoiceNumber}`, exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Rechnung löschen', exact: true })).toBeDisabled();
    await expect(page.getByText('Nur nachweislich unausgestellte Entwürfe ohne Zahlung sind löschbar.', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('protected-invoice-mobile.png'), fullPage: true, animations: 'disabled' });
    await page.keyboard.press('Escape');
    await card.getByRole('button', { name: 'Details', exact: true }).click();
    const details = page.getByRole('dialog');
    await expect(details.getByRole('button', { name: 'PDF öffnen', exact: true })).toBeVisible();
    await expect(details.getByText('Rechnungsbetrag', { exact: true })).toBeVisible();
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await details.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('invoice-details-' + width + '.png'), fullPage: true });
    }
    await details.getByRole('button', { name: 'Schließen', exact: true }).click();
  });

  test('keeps a backdated manual income on the entered calendar day across browser timezones', async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL, timezoneId: 'America/Los_Angeles' });
    const page = await context.newPage();
    try {
      await page.goto('/login');
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
      // The traced browser Response.body() stalled after a completed reply.
      // Assert the real upstream body and fulfill with those exact bytes.
      let rejectNextIncome = true;
      let createdIncome: { date?: string } | undefined;
      await page.route('**/api/incomes', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        const data = route.request().postDataJSON();
        const response = await route.fetch({ postData: JSON.stringify(rejectNextIncome ? { ...data, date: '2026-02-30' } : data) });
        rejectNextIncome = false;
        const body = await response.body();
        if (response.ok()) createdIncome = JSON.parse(body.toString());
        await route.fulfill({ response, body });
      });
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
      expect(createdIncome?.date).toBe('2025-12-31T00:00:00.000Z');
      const row = page.getByRole('row').filter({ hasText: 'E2E Jahreswechsel Einnahme' });
      await expect(row.getByText('31.12.2025', { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('income-business-date-desktop.png'), fullPage: true, animations: 'disabled' });
      await page.setViewportSize({ width: 390, height: 844 });
      const card = page.getByRole('article').filter({ hasText: 'E2E Jahreswechsel Einnahme' });
      await expect(card.getByText('31.12.2025', { exact: false })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('income-business-date-mobile.png'), fullPage: true, animations: 'disabled' });
      for (const date of [undefined, '2026-02-30']) {
        const invalid = await page.request.post('/api/incomes', { data: { description: 'Invalid income date', amount: 1, date } });
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

  test('deactivates access while keeping the user visible and rejects old sessions and keys', async ({ page, browser, baseURL }, testInfo) => {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    const email = 'former-e2e@example.test';
    expect((await page.request.post('/api/users', { data: { email, name: 'Former user', password: 'SecurePass123', role: 'USER' } })).ok()).toBe(true);
    const context = await browser.newContext({ baseURL });
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
    await page.getByRole('button', { name: 'Nebenberuflich', exact: true }).click();
    await page.getByLabel('Bruttojahresgehalt (EUR)', { exact: true }).fill('65000');
    await page.getByText('Berechnungsweg anzeigen', { exact: true }).click();
    await expect(page.getByText('Einkünfte aus Anstellung', { exact: true })).toBeVisible();
    for (const width of [1440, 320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('tax-studio-' + width + '.png'), fullPage: true });
    }
    await page.getByRole('button', { name: 'Standardwerte', exact: true }).click();
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
    expect((await page.request.post('/api/settings', { data: invoiceIssuer })).ok()).toBe(true);

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
    // Verify persistence through the real read API; Chromium's browser-response
    // body inspection can stall after this status-only UI mutation completes.
    const storedCustomers = await (await page.request.get('/api/customers')).json() as Array<{ id: number; email: string }>;
    const customer = storedCustomers.find(item => item.email === 'billing@example.test')!;
    expect(customer).toMatchObject({ name: customerName, internalNote: privateNote });

    for (const width of [320, 375, 414, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('customers-workspace-' + width + '.png'), fullPage: true });
    }
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

  test('uses the shared design system, accessible trends and mobile command navigation', async ({ page }, testInfo) => {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    const actual = await (await page.request.get('/api/dashboard/kpis')).json();
    const fixture = { ...actual, openInvoices: 900, yearComparison: {
      ...actual.yearComparison,
      revenueThisYearToDate: 2400, revenueLastYearToDate: 1200,
      expensesThisYearToDate: 600, expensesLastYearToDate: 800,
    } };
    await page.route('**/api/dashboard/kpis', route => route.fulfill({ json: fixture }));
    await page.reload();
    const metrics = page.locator('.dashboard-metric');
    await expect(metrics).toHaveCount(4);
    await expect(metrics.nth(1)).toContainText('600,00');
    await expect(metrics.nth(1).locator('.financial-trend')).toHaveClass(/text-positive/);
    await expect(metrics.nth(1).locator('.financial-trend')).toContainText('gesunken');
    await page.evaluate(() => document.fonts.ready);
    expect(await page.locator('h1').evaluate(el => getComputedStyle(el).fontFamily.toLowerCase())).toContain('inter');
    expect(await page.locator('.app-sidebar').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(6, 37, 31)');
    await page.screenshot({ path: testInfo.outputPath('financial-trends-desktop.png'), fullPage: true });
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: 'Befehlspalette' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 375, height: 900 });
    await page.getByRole('button', { name: 'Befehlspalette öffnen' }).click();
    await page.getByRole('combobox').fill('Kunden');
    await page.getByRole('option', { name: 'Kunden', exact: true }).click();
    await expect(page).toHaveURL(/\/customers/);
    await expect(page.getByRole('dialog', { name: 'Befehlspalette' })).not.toBeVisible();
  });

  test('distinguishes failed booking queries from empty lists and retries them', async ({ page }, testInfo) => {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    let fail = true;
    await page.route('**/api/incomes?*', route => fail
      ? route.fulfill({ status: 500, json: { error: 'Isolated UI failure fixture' } })
      : route.continue());
    await page.goto('/dashboard?tab=incomes');
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Einnahmen konnten nicht geladen werden.');
    await expect(page.locator('.ledger-page-total strong')).toHaveText('—');
    for (const emptyMessage of await page.getByText('Keine Einnahmen vorhanden.', { exact: false }).all()) {
      await expect(emptyMessage).not.toBeVisible();
    }
    await page.screenshot({ path: testInfo.outputPath('income-query-error.png'), fullPage: true });
    fail = false;
    await page.getByRole('button', { name: 'Erneut laden' }).click();
    await expect(page.locator('.query-feedback')).toHaveCount(0);
    await expect(page.locator('.ledger-page-total strong')).not.toHaveText('—');
  });

  test('selects historical calendar years without changing current KPIs and recovers comparison failures', async ({ page }, testInfo) => {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    const currentYear = new Date().getFullYear();
    const historyYear = currentYear - 10;
    for (const [date, amount] of [[`${historyYear}-01-10`, 11.1], [`${historyYear}-12-31`, 22.2]] as const) {
      const response = await page.request.post('/api/incomes', { data: { description: 'Year selector fixture', amount, date, taxRelevant: true } });
      expect(response.status()).toBe(200);
    }
    await page.reload();
    await expect(page.locator('.dashboard-metric')).toHaveCount(4);
    const currentKpis = (await page.locator('.dashboard-metrics').textContent()) ?? '';
    const comparison = page.locator('.year-analysis');
    await page.getByLabel('Vergleichsjahr', { exact: true }).selectOption(String(historyYear));
    await expect(comparison.getByRole('status')).toHaveCount(0);
    await expect(comparison).toContainText('Vollständige Kalenderjahre');
    await expect(comparison.locator('.year-summary-grid')).toContainText('33,30');
    await expect(page.locator('.dashboard-metrics')).toHaveText(currentKpis);
    await comparison.getByRole('tab', { name: 'Einnahmen', exact: true }).click();
    await expect(comparison.locator('tfoot')).toContainText('Gesamtjahr');
    await expect(comparison.locator('tbody tr').last()).toContainText('22,20');
    for (const width of [1440, 768, 375, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`year-selector-${width}.png`), fullPage: true });
    }
    const monthlyRegion = comparison.getByRole('region', { name: /Monatsvergleich Einnahmen/ });
    await monthlyRegion.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => monthlyRegion.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    const emptyYear = historyYear - 1;
    let fail = true;
    await page.route(`**/api/dashboard/kpis?year=${emptyYear}`, route => fail ? route.fulfill({ status: 500, json: { error: 'Comparison failure fixture' } }) : route.continue());
    await page.getByLabel('Vergleichsjahr', { exact: true }).selectOption(String(emptyYear));
    await expect(comparison.getByRole('alert')).toContainText('Vergleichsdaten konnten nicht geladen werden.');
    await expect(comparison.locator('.year-summary-grid')).toHaveCount(0);
    fail = false;
    await comparison.getByRole('button', { name: 'Erneut laden' }).click();
    await expect(comparison.getByRole('alert')).toHaveCount(0);
    await expect(comparison.locator('tfoot')).toContainText('Gesamtjahr');
    await expect(comparison.locator('tfoot')).toContainText('0,00');
    await expect(comparison.getByRole('tab', { name: 'Einnahmen', exact: true })).toHaveAttribute('data-state', 'active');
    await page.getByLabel('Vergleichsjahr', { exact: true }).selectOption(String(currentYear));
    await expect(comparison).toContainText('Vergleich bis zum heutigen Datum');
    await expect(page.locator('.dashboard-metrics')).toHaveText(currentKpis);
    await page.getByRole('button', { name: 'Einnahme erfassen', exact: true }).click();
    await page.getByLabel('Beschreibung', { exact: true }).fill('Year selector cache update');
    await page.getByLabel('Betrag (€)', { exact: true }).fill('1.10');
    await page.getByLabel('Zahlungsdatum', { exact: true }).fill(`${historyYear}-06-15`);
    await page.getByRole('button', { name: 'Einnahme speichern', exact: true }).click();
    await expect(page.getByLabel('Beschreibung', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: 'Befehlspalette öffnen' }).click();
    await page.getByRole('combobox').fill('Dashboard');
    await page.getByRole('option', { name: 'Dashboard öffnen', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.getByLabel('Vergleichsjahr', { exact: true }).selectOption(String(historyYear));
    await expect(page.locator('.year-summary-grid')).toContainText('34,40');
  });

  test('orders complete income and expense result sets and resets pagination when sorting changes', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    for (const resource of ['incomes', 'expenses']) {
      for (let index = 1; index <= 12; index++) {
        const response = await page.request.post(`/api/${resource}`, { data: { description: `ORDER-UI ${String(index).padStart(2, '0')}`, amount: index * 10, date: `${new Date().getFullYear()}-05-01`, taxRelevant: true, ...(resource === 'expenses' ? { category: 'Ordering fixture', taxDeductiblePercentage: 100 } : {}) } });
        expect(response.status()).toBe(200);
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(`/dashboard?tab=${resource}`);
      await page.getByLabel('Suche', { exact: true }).fill('ORDER-UI');
      await expect(page.locator('.ledger-count')).toHaveText('12');
      await page.getByLabel('Sortierung', { exact: true }).selectOption('amount:asc');
      await expect(page.locator('.ledger-list tbody tr').first()).toContainText('ORDER-UI 01');
      await page.getByRole('button', { name: 'Weiter', exact: true }).click();
      await expect(page.locator('.ledger-list tbody tr').first()).toContainText('ORDER-UI 11');
      await page.getByLabel('Sortierung', { exact: true }).selectOption('amount:desc');
      await expect(page.locator('.ledger-list tbody tr').first()).toContainText('ORDER-UI 12');
      await expect(page.getByRole('button', { name: 'Zurück', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: 'Betrag: aufsteigend sortieren', exact: true }).click();
      await expect(page.getByLabel('Sortierung', { exact: true })).toHaveValue('amount:asc');
      await expect(page.locator('.ledger-list tbody tr').first()).toContainText('ORDER-UI 01');
      await page.screenshot({ path: testInfo.outputPath(`${resource}-ordered-1440.png`), fullPage: true });
      await page.setViewportSize({ width: 375, height: 1000 });
      await page.getByLabel('Sortierung', { exact: true }).selectOption('description:desc');
      await expect(page.locator('.ledger-record h3').first()).toHaveText('ORDER-UI 12');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${resource}-ordered-375.png`), fullPage: true });
      await page.getByRole('button', { name: 'Filter zurücksetzen', exact: true }).click();
      await expect(page.getByLabel('Sortierung', { exact: true })).toHaveValue('date:desc');
      await expect(page.getByLabel('Suche', { exact: true })).toHaveValue('');
    }
  });

  test('keeps public help usable at 320 and 390 pixels and follows keyboard routes through login', async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      for (const route of ['/', '/help']) {
        await page.goto(route);
        await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page).not.toHaveURL(/\/login/);
        for (const width of [320, 390]) {
          await page.setViewportSize({ width, height: 844 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${route} overflows at ${width}`).toBe(true);
          const clipped = await page.getByRole('main').locator('a, button').evaluateAll(elements => elements.filter(element => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && (rect.left < -1 || rect.right > window.innerWidth + 1);
          }).map(element => element.textContent));
          expect(clipped).toEqual([]);
          await page.screenshot({ path: testInfo.outputPath(`${route === '/' ? 'home' : 'help'}-pilot-${width}.png`), fullPage: true });
        }
      }
      await expect(page.locator('#steuerprofil')).toContainText('sind nicht dasselbe');
      await expect(page.locator('#umfang')).toContainText('keine ELSTER-Einreichung');
      await expect(page.locator('#zugang')).toContainText('kein öffentlicher Betreiber- oder Supportkontakt');
      // Tab rather than click proves the first workflow link is keyboard reachable.
      await page.goto('/');
      const firstGuide = page.getByRole('link', { name: 'Den ersten Ablauf kennenlernen', exact: true });
      for (let index = 0; index < 20 && !(await firstGuide.evaluate(element => element === document.activeElement)); index++) await page.keyboard.press('Tab');
      await expect(firstGuide).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/help#erste-rechnung$/);
      const protectedLink = page.getByRole('link', { name: 'Firmendaten öffnen', exact: true });
      await protectedLink.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/login\?callbackUrl=/);
      expect(new URL(page.url()).searchParams.get('callbackUrl')).toBe('/settings');
      // A redirected document can expose its URL before the login form is ready.
      await page.waitForLoadState('load');
      await expect(page.getByRole('heading', { name: 'Willkommen zurück', exact: true })).toBeVisible();
      await page.getByLabel('E-Mail').fill(testUser.email);
      await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
      const authenticated = page.waitForResponse(response => response.url().includes('/api/auth/callback/credentials') && response.request().method() === 'POST');
      await page.getByLabel('Passwort', { exact: true }).press('Enter');
      expect((await authenticated).status()).toBe(200);
      expect(await (await page.request.get('/api/auth/session')).json()).toMatchObject({ user: { email: testUser.email } });
      await expect(page).toHaveURL(/\/settings$/);
      await expect(page.getByRole('heading', { name: 'Einstellungen', exact: true, level: 1 })).toBeVisible();
      expect(errors).toEqual([]);
    } finally { await context.close(); }
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
