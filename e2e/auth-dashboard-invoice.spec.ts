import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import type { IncomingDocument } from '../lib/purchase-documents/types';
import type { SupplierDto } from '../lib/suppliers';

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

/** Native screenshot preparation only: use normal scrolling and wait for the
 * real fonts/progress component, never hide UI or change business data. */
async function settleScreenshotAtTop(page: Page) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const progress = page.locator('div[aria-hidden="true"][class*="pointer-events-none"][class*="fixed"][class*="h-0.5"]');
  await expect(progress).toHaveCount(1);
  await expect(progress).toHaveCSS('opacity', '0');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

/** Wait for the actual debounced query and its rendered result, not a row
 * left over from the unfiltered list that may unmount during menu selection. */
async function searchPartialInvoiceAndWait(page: Page, invoiceNumber: string) {
  const filtered = page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === '/api/invoices'
      && url.searchParams.get('search') === invoiceNumber;
  });
  await page.getByLabel('Suche', { exact: true }).fill(invoiceNumber);
  const response = await filtered;
  expect(response.status()).toBe(200);
  expect(await response.finished()).toBeNull();
  const result = await response.json();
  expect(result.total).toBe(1);
  expect(result.items).toHaveLength(1);
  expect(result.items[0].invoiceNumber).toBe(invoiceNumber);
  await expect(page.getByRole('status').filter({ hasText: 'Rechnungen werden geladen…' })).toHaveCount(0);
  await expect(page.locator('.invoice-ledger .ledger-count')).toHaveText('1');
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

// All purchase acceptance data is synthetic and isolated by the supported E2E runner.
let bookingSupplier: SupplierDto;
let bookingSource: IncomingDocument & { bytes: Buffer };
let bookingExpenseId: number;

async function purchaseFinancialSnapshot(page: Page) {
  const responses = await Promise.all(['/api/expenses?pageSize=1', '/api/incomes?pageSize=1', '/api/invoices?pageSize=1', '/api/customers', '/api/cashbook'].map(url => page.request.get(url)));
  for (const response of responses) expect(response.status()).toBe(200);
  const [expenses, incomes, invoices, customers, books] = await Promise.all(responses.map(response => response.json()));
  return { expenses: expenses.total as number, incomes: incomes.total as number, invoices: invoices.total as number, customers: customers.length as number,
    cashBooks: books.map((book: { id: number; transactionCount: number; currentBalance: number }) => ({ id: book.id, count: book.transactionCount, balance: book.currentBalance })) };
}
async function readPurchase(page: Page, id: number): Promise<IncomingDocument> {
  const response = await page.request.get(`/api/purchase-documents/${id}`); expect(response.status()).toBe(200);
  return (await response.json()).document;
}
async function uploadPurchaseFixture(page: Page, number: string, suffix = '', options: { currency?: string; typeCode?: string; payable?: string; supported?: boolean } = {}) {
  const currency = options.currency ?? 'EUR', typeCode = options.typeCode ?? '380', payable = options.payable ?? '119.00';
  await page.goto('/purchases');
  await expect(page.getByRole('heading', { name: 'Belegeingang', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Original hinzufügen', exact: true }).click();
  const bytes = Buffer.from(`<Invoice><ID>${number}</ID><IssueDate>2026-10-11</IssueDate><DueDate>2026-10-25</DueDate><InvoiceTypeCode>${typeCode}</InvoiceTypeCode><DocumentCurrencyCode>${currency}</DocumentCurrencyCode><AccountingSupplierParty><Party><PartyName><Name>Synthetischer Originalverkäufer</Name></PartyName><PostalAddress><StreetName>Original-Testweg 1</StreetName><CityName>Quellstadt</CityName><PostalZone>10115</PostalZone><Country><IdentificationCode>DE</IdentificationCode></Country></PostalAddress></Party></AccountingSupplierParty><AccountingCustomerParty><Party><PartyName><Name>Synthetischer eigener Betrieb</Name></PartyName></Party></AccountingCustomerParty><LegalMonetaryTotal><TaxExclusiveAmount currencyID="${currency}">100.00</TaxExclusiveAmount><TaxInclusiveAmount currencyID="${currency}">119.00</TaxInclusiveAmount><PayableAmount currencyID="${currency}">${payable}</PayableAmount></LegalMonetaryTotal>${suffix}</Invoice>`);
  await page.getByLabel('Foto, PDF- oder XML-Original auswählen', { exact: true }).setInputFiles({ name: `${number}${suffix ? '-duplicate' : ''}.xml`, mimeType: 'application/xml', buffer: bytes });
  const uploaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/purchase-documents' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Original hochladen', exact: true }).click();
  const response = await uploaded; expect(response.status()).toBe(201);
  const { document } = await response.json() as { document: IncomingDocument };
  await expect(page).toHaveURL(new RegExp(`/purchases\\?document=${document.id}$`));
  await expect(page.getByRole('dialog').getByRole('region', { name: 'Lieferant / Verkäufer', exact: true })).toContainText('Synthetischer Originalverkäufer');
  expect(document.approvalSupported).toBe(options.supported ?? true);
  return { ...document, bytes };
}
async function selectPurchaseSupplier(page: Page, name: string) {
  const dialog = page.getByRole('dialog');
  const contact = dialog.getByRole('listitem').filter({ hasText: name });
  await expect(contact).toHaveCount(1);
  const selected = page.waitForResponse(response => /\/api\/purchase-documents\/\d+\/supplier$/.test(response.url()) && response.request().method() === 'POST');
  await contact.getByRole('button', { name: 'Für diesen Beleg auswählen', exact: true }).click();
  expect((await selected).status()).toBe(200);
  await expect(dialog.getByRole('region', { name: 'Gewählter Lieferantenkontakt', exact: true })).toContainText(name);
}
async function openPurchaseDetails(page: Page) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Als Ausgabe erfassen', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Zahlung und Einordnung', exact: true })).toBeFocused();
}
async function expectBlankPurchaseChoices(page: Page) {
  const dialog = page.getByRole('dialog');
  for (const label of ['Tatsächliches Zahlungsdatum', 'Kategorie', 'Steuerlich berücksichtigen?', 'Betrieblicher / abziehbarer Anteil in %']) await expect(dialog.getByLabel(label, { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Weiter zur Bestätigung', exact: true })).toBeDisabled();
}
async function fillPurchaseDetails(page: Page, description: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Beschreibung', { exact: true }).fill(description);
  await dialog.getByLabel('Tatsächliches Zahlungsdatum', { exact: true }).fill('2026-10-18');
  await dialog.getByLabel('Kategorie', { exact: true }).fill('Bürobedarf');
  await dialog.getByLabel('Steuerlich berücksichtigen?', { exact: true }).selectOption('no');
  await dialog.getByLabel('Betrieblicher / abziehbarer Anteil in %', { exact: true }).fill('75');
}
async function confirmPurchaseChoices(page: Page) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Weiter zur Bestätigung', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Angaben bewusst bestätigen', exact: true })).toBeFocused();
  for (const expression of [/Ich habe das unveränderte Original geprüft/, /Der Empfänger \/ Käufer im Original gehört/, /Der vollständige Betrag ist tatsächlich abgeflossen/]) await dialog.getByRole('checkbox', { name: expression }).check();
}
async function assertDownloadedBytes(page: Page, action: () => Promise<unknown>, bytes: Buffer) {
  const downloading = page.waitForEvent('download'); await action();
  const download = await downloading; expect(await download.failure()).toBeNull();
  expect(await readFile((await download.path())!)).toEqual(bytes);
}

test.describe.serial('auth, dashboard and invoice flow', () => {
  test('registers the first admin user and opens the dashboard', async ({ page }, testInfo) => {
    const deniedBootstrap = await page.request.post('/api/auth/register', { data: {
      email: 'unproven-admin@example.test', name: 'Unproven', password: testUser.password,
    } });
    expect(deniedBootstrap.status()).toBe(403);
    await page.goto('/register');
    await expect(page.getByRole('button', { name: 'Admin-Konto erstellen', exact: true })).toBeVisible();
    // Capture initial setup before any name, credential or bootstrap token is entered.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await settleScreenshotAtTop(page);
    await page.screenshot({ path: testInfo.outputPath('register-public.png'), fullPage: true });

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
    const sidebarIcons = page.locator('aside [data-bivaro-sidebar-icon^="nav-"]');
    await expect(sidebarIcons).toHaveCount(17);
    await expect(page.locator('aside').getByRole('link', { name: 'Heute erledigen', exact: true })).toHaveAttribute('href', '/dashboard/today');
    await expect(page.locator('aside').getByRole('link', { name: 'Rechnungshistorie', exact: true })).toHaveAttribute('href', '/history');
    await expect(page.locator('aside').getByRole('link', { name: 'Belegeingang', exact: true })).toHaveAttribute('href', '/purchases');
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
    const sidebarLogo = page.locator('aside .brand-full [data-bivaro-sidebar-icon="bivaro-sidebar"]');
    await expect(sidebarLogo).toBeVisible();
    const logoMask = await sidebarLogo.evaluate(icon => getComputedStyle(icon).maskImage);
    expect(logoMask).toContain('/brand/icons/sidebar-flat/bivaro-sidebar.webp');
    expect(await sidebarIcons.evaluateAll(icons => new Set(icons.map(icon => icon.getAttribute('data-bivaro-sidebar-icon'))).size)).toBe(14);
    const sidebarMasks = await sidebarIcons.evaluateAll(icons => icons.map(icon => ({
      mask: getComputedStyle(icon).maskImage,
      ink: getComputedStyle(icon).backgroundColor,
      labelInk: getComputedStyle(icon).color,
      mode: getComputedStyle(icon).maskMode,
      filter: getComputedStyle(icon).filter,
      width: icon.getBoundingClientRect().width,
      height: icon.getBoundingClientRect().height,
    })));
    for (const icon of sidebarMasks) {
      expect(icon.mask).toContain('/brand/icons/sidebar-flat/');
      expect(icon.ink).toBe(icon.labelInk);
      expect(icon.mode).toBe('alpha');
      expect(icon.filter).toBe('none');
      expect([icon.width, icon.height]).toEqual([28, 28]);
    }
    const sidebarSources = [...new Set(sidebarMasks.map(icon => icon.mask.match(/url\(["']?([^"')]+)/)?.[1]))];
    sidebarSources.push(logoMask.match(/url\(["']?([^"')]+)/)?.[1]);
    expect(sidebarSources).toHaveLength(15);
    for (const source of sidebarSources) {
      expect(source).toBeTruthy();
      const response = await page.request.get(source!);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('image/webp');
      const decoded = await page.evaluate(async url => {
        const image = new Image(); image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Cannot inspect decoded mask alpha');
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let transparent = false, solid = false;
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] === 0) transparent = true;
          if (pixels[index] >= 250) solid = true;
        }
        return { width: image.naturalWidth, height: image.naturalHeight, transparent, solid };
      }, source!);
      const size = source!.endsWith('/bivaro-sidebar.webp') ? 192 : 128;
      expect(decoded).toEqual({ width: size, height: size, transparent: true, solid: true });
    }
    for (const target of ['dark', 'light']) {
      await page.getByRole('button', { name: target === 'dark' ? 'Dunkles Farbschema aktivieren' : 'Helles Farbschema aktivieren', exact: true }).click();
      await expect(page.locator('html')).toHaveClass(target === 'dark' ? /\bdark\b/ : /\blight\b/);
      const active = page.locator('aside [data-bivaro-sidebar-icon="nav-dashboard"]');
      const inactive = page.locator('aside [data-bivaro-sidebar-icon="nav-cashbook"]');
      await expect(active).toHaveCSS('background-color', 'rgb(6, 37, 31)');
      await expect(active.locator('..')).toHaveCSS('background-color', 'rgb(121, 225, 171)');
      await expect(inactive).toHaveCSS('background-color', 'rgb(189, 207, 202)');
      await inactive.locator('..').hover();
      await expect(inactive).toHaveCSS('background-color', 'rgb(198, 216, 212)');
      await page.getByRole('heading', { name: 'Buchhaltung', level: 1 }).hover();
    }
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
        if ((width === 1440 || width === 375) && name !== 'cashbook') await page.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`), fullPage: true });
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
      // The registration original is captured before input in the existing first-admin case.
      if (route === '/login') await publicPage.screenshot({ path: testInfo.outputPath(route.slice(1) + '-public.png'), fullPage: true });
    }
    await anonymous.close();
  });

  test('requires a conscious dated fiscal profile and persists the real settings UI selection', async ({ page }, testInfo) => {
    await signIn(page);
    expect(await (await page.request.get('/api/settings')).json()).toMatchObject({
      fiscalTaxRegime: 'UNSET', fiscalEffectiveFrom: null, fiscalConfirmedAt: null,
    });
    await page.goto('/dashboard/invoices/new');
    await expect(page.getByLabel('Umsatzsteuer', { exact: true })).toHaveValue('');
    await expect(page.getByText('Profil fehlt', { exact: true })).toBeVisible();
    await page.locator('section[aria-labelledby="invoice-tax-heading"] summary').click();
    await expect(page.getByText('Kein gültiges Steuerprofil für dieses Datum.', { exact: false })).toBeVisible();
    await page.locator('section[aria-labelledby="invoice-tax-heading"] summary').click();
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
    const taxMode = page.getByLabel('Umsatzsteuer', { exact: true });
    const create = page.getByRole('button', { name: 'PDF erstellen', exact: true });
    await expect(taxMode).toHaveValue('standard');
    await expect(page.locator('#invoice-item-tax-0')).toHaveValue('19');
    await page.getByLabel('Empfänger (Name & Anschrift)', { exact: true }).fill('E2E Profilkunde\nKundenweg 2\n10115 Berlin');
    await page.locator('#invoice-item-description-0').fill('Profilprüfung');
    await page.locator('#invoice-item-price-0').fill('100');
    await expect(page.getByRole('complementary', { name: 'Rechnungsübersicht' })).toContainText('119,00');
    await page.getByLabel('Rechnungsdatum', { exact: true }).fill('2025-12-31');
    await expect(taxMode).toHaveValue('');
    await page.locator('section[aria-labelledby="invoice-tax-heading"] summary').click();
    await expect(page.getByText('Das Firmenprofil gilt erst ab 2026-01-01', { exact: false })).toBeVisible();
    await page.locator('section[aria-labelledby="invoice-tax-heading"] summary').click();
    await taxMode.selectOption('standard');
    const acknowledgement = page.getByRole('checkbox', { name: /Steuerbehandlung für dieses Dokument bestätigen/ });
    await expect(acknowledgement).not.toBeChecked();
    await expect(create).toBeDisabled();
    await acknowledgement.check();
    await expect(create).toBeEnabled();
    await page.getByLabel('Steuerfall', { exact: true }).selectOption('reverse-charge');
    await expect(create).toBeDisabled();
    await expect(page.getByRole('alert').filter({ hasText: 'Nicht unterstützt. Vorschau und Erstellung sind gesperrt.' })).toBeVisible();
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
    await expect(page.getByText('Vorlage', { exact: true })).toBeVisible();
    await page.locator('section[aria-labelledby="invoice-tax-heading"] summary').click();
    await expect(page.getByText('Steuerangaben aus der Vorlage bleiben erhalten.', { exact: false })).toBeVisible();
    await page.locator('section[aria-labelledby="invoice-tax-heading"] summary').click();
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
    await expect(page.getByRole('heading', { name: 'Neue Rechnung', level: 1 })).toBeVisible();
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
    await page.getByLabel('Umsatzsteuer', { exact: true }).selectOption('standard');
    await page.getByRole('checkbox', { name: /Steuerbehandlung für dieses Dokument bestätigen/ }).check();
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
    await page.locator('#smtp-versand summary').filter({ hasText: 'SMTP konfigurieren' }).click();
    await page.locator('#smtp-host').fill('smtp.example.test');
    await page.locator('#smtp-port').fill('587');
    await page.locator('#smtp-from').fill('rechnung@example.test');
    await page.locator('#smtp-user').fill('synthetic-mail-user');
    const syntheticPassword = 'synthetic-smtp-password-e2e';
    await page.locator('#smtp-password').fill(syntheticPassword);
    await page.getByRole('button', { name: 'SMTP speichern', exact: true }).click();
    await expect(page.getByText('SMTP-Konfiguration gespeichert.', { exact: true })).toBeVisible();
    await expect(page.locator('#smtp-host')).toBeVisible();
    await expect(page.locator('#smtp-password')).toHaveValue('');

    await page.reload();
    await page.locator('#smtp-versand summary').filter({ hasText: 'SMTP konfigurieren' }).click();
    await expect(page.locator('#smtp-host')).toHaveValue('smtp.example.test');
    await expect(page.locator('#smtp-password')).toHaveValue('');
    await expect(page.getByText('· Passwort gespeichert', { exact: true })).toBeVisible();
    await page.locator('#smtp-port').fill('465');
    await page.locator('#smtp-secure').click();
    await page.getByRole('button', { name: 'SMTP speichern', exact: true }).click();
    await expect(page.getByText('SMTP-Konfiguration gespeichert.', { exact: true })).toBeVisible();
    await expect(page.locator('#smtp-host')).toBeVisible();
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
    await page.locator('#backup-settings summary', { hasText: 'Backup wiederherstellen' }).click();
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
    await page.getByLabel('Umsatzsteuer').selectOption('standard');
    await page.getByRole('checkbox', { name: /Steuerbehandlung für dieses Dokument bestätigen/ }).check();
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
          await row.getByRole('button', { name: 'Zahlungsstatus: Offen', exact: true }).click();
          await page.getByRole('menuitem', { name: 'Bezahlt', exact: true }).click();
        } else {
          const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: invoiceNumber, exact: true }) });
          await card.getByRole('button', { name: 'Zahlung erfassen', exact: true }).focus();
          await page.keyboard.press('Enter');
        }
        const dialog = page.getByRole('dialog', { name: 'Zahlungen und Korrekturen', exact: true });
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
      const savedConfirmation = dialog.getByRole('status').filter({ has: page.getByText('Zahlung gespeichert', { exact: true }) });
      await expect(savedConfirmation).toBeVisible();
      await expect(dialog.getByRole('alert')).toHaveText('Die Zahlung ist gespeichert, aber die Listen konnten nicht aktualisiert werden. Nicht erneut buchen.');
      expect(blockedReads).toBeGreaterThan(0);
      expect(postCount).toBe(2);
      await expect(submit).toHaveCount(0);
      await expect(dialog).toContainText('31.12.2024');
      await expect(savedConfirmation).toBeFocused();
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
        expect(record).toMatchObject({ status: 'PAID', paidAt: '2024-12-31T00:00:00.000Z', issuanceState: 'ISSUED', incomes: [{ id: savedEvent!.incomeId, amount: 123.45, date: '2024-12-31T00:00:00.000Z' }] });
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

  for (const width of [1440, 390]) {
    test(`records two dated partial allocations and recovers only the lost pending request at ${width}px`, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      await signIn(page);
      await page.setViewportSize({ width, height: 900 });
      const invoiceNumber = `E2E-BPR011-${width}`;
      const pdf = await PDFDocument.create(); pdf.addPage();
      const created = await page.request.post('/api/invoices', { data: { fileName: `${invoiceNumber}.pdf`, invoiceNumber, totalAmount: 120, invoiceDate: '2026-09-01', dueDate: '2026-09-15', parsedData: { currency: 'EUR' }, pdfBytes: await pdf.saveAsBase64() } });
      expect(created.status()).toBe(200);
      const invoice = await created.json();
      const paymentPath = `/api/invoices/${invoice.id}/payments`;
      const journal = async () => (await page.request.get(paymentPath)).json();
      await page.goto('/dashboard?tab=invoices');
      await searchPartialInvoiceAndWait(page, invoiceNumber);
      const record = () => width < 1280 ? page.getByRole('article').filter({ hasText: invoiceNumber }) : page.getByRole('row').filter({ hasText: invoiceNumber });
      await expect(record()).toHaveCount(1);
      const open = async (state: 'Offen' | 'Teilbezahlt') => {
        await record().getByRole('button', { name: `Zahlungsstatus: ${state}`, exact: true }).click();
        await page.getByRole('menuitem', { name: state === 'Offen' ? 'Bezahlt' : 'Weitere Zahlung erfassen', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Zahlungen und Korrekturen', exact: true });
        await expect(dialog.getByRole('button', { name: 'Zahlung verbindlich erfassen', exact: true })).toBeEnabled();
        return dialog;
      };
      const before = await journal();
      let dialog = await open('Offen');
      await expect(dialog.getByLabel('Tatsächliches Zahlungsdatum', { exact: true })).toHaveValue('');
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      expect(await journal()).toEqual(before);
      await expect(record().getByRole('button', { name: 'Zahlungsstatus: Offen', exact: true })).toBeFocused();
      dialog = await open('Offen');
      await dialog.getByLabel('Eingegangener Betrag (EUR)', { exact: true }).fill('40,00');
      await dialog.getByLabel('Tatsächliches Zahlungsdatum', { exact: true }).fill('2026-09-30');
      await dialog.getByLabel('Zahlungsreferenz', { exact: true }).fill('Synthetic first allocation');
      let posts = 0;
      let savedFirst: Record<string, unknown> | undefined;
      await page.route(`**${paymentPath}`, async route => {
        if (route.request().method() !== 'POST') return route.continue();
        posts += 1;
        if (posts !== 1) return route.continue();
        savedFirst = route.request().postDataJSON();
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        // Real committed allocation, deliberately lost client response.
        await route.abort('failed');
      });
      await dialog.getByRole('button', { name: 'Zahlung verbindlich erfassen', exact: true }).click();
      await expect(dialog.getByRole('alert')).toContainText('Keine verlässliche Speicherbestätigung');
      await expect(dialog.getByLabel('Eingegangener Betrag (EUR)', { exact: true })).toHaveValue('40,00');
      await dialog.getByRole('button', { name: 'Zahlungsnachweis prüfen', exact: true }).click();
      await expect(dialog.getByText('Zahlung gespeichert', { exact: true })).toBeVisible();
      await expect(dialog.getByText('Noch einzuziehen', { exact: true }).locator('..').locator('dd')).toHaveText(/^80,00\s*€$/u);
      expect(posts).toBe(1);
      expect(savedFirst).toMatchObject({ amount: '40.00', expectedPaidCents: '0', paidAt: '2026-09-30' });
      expect((await journal()).events).toHaveLength(1);
      await dialog.locator('[data-slot="dialog-footer"]').getByRole('button', { name: 'Schließen', exact: true }).click();
      await page.getByRole('button', { name: 'Teilbezahlt', exact: true }).click();
      await expect(record()).toContainText('Teilbezahlt');
      await expect(record()).toContainText('Zugeordnet 40,00');
      await expect(record()).toContainText('Offen 80,00');
      await page.reload();
      // Reload server state; select the explicit server-side filter again.
      await searchPartialInvoiceAndWait(page, invoiceNumber);
      await page.getByRole('button', { name: 'Teilbezahlt', exact: true }).click();
      dialog = await open('Teilbezahlt');
      await expect(dialog.getByText('Zahlung gespeichert', { exact: true })).toHaveCount(0);
      const initialHistory = dialog.getByRole('region', { name: 'Zahlungsverlauf', exact: true });
      await expect(initialHistory.locator('ol').first().locator(':scope > li')).toHaveCount(1);
      await expect(initialHistory.locator('ul').first().locator(':scope > li')).toHaveCount(1);
      await expect(dialog.getByLabel('Eingegangener Betrag (EUR)', { exact: true })).toHaveValue('80.00');
      await expect(dialog.getByLabel('Tatsächliches Zahlungsdatum', { exact: true })).toHaveValue('');
      await dialog.getByLabel('Eingegangener Betrag (EUR)', { exact: true }).fill('80.01');
      await dialog.getByLabel('Tatsächliches Zahlungsdatum', { exact: true }).fill('2026-10-20');
      await dialog.getByLabel('Zahlungsreferenz', { exact: true }).fill('Synthetic settlement');
      await dialog.getByRole('button', { name: 'Zahlung verbindlich erfassen', exact: true }).click();
      await expect(dialog.getByRole('alert')).toContainText('übersteigt');
      expect(posts).toBe(1);
      await dialog.getByLabel('Eingegangener Betrag (EUR)', { exact: true }).fill('80.00');
      await dialog.getByRole('button', { name: 'Zahlung verbindlich erfassen', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(dialog.getByText('Zahlung gespeichert', { exact: true })).toBeVisible();
      await expect(dialog.getByRole('status').filter({ has: page.getByText('Zahlung gespeichert', { exact: true }) })).toContainText('Rechnung vollständig bezahlt.');
      const history = dialog.getByRole('region', { name: 'Zahlungsverlauf', exact: true });
      await expect(history.locator('ol').first().locator(':scope > li')).toHaveCount(2);
      await expect(history.locator('ul').first().locator(':scope > li')).toHaveCount(2);
      await expect(history).toContainText('30.09.2026'); await expect(history).toContainText('20.10.2026');
      const ledger = await journal();
      expect(ledger.event).toBeNull();
      expect(ledger.events).toHaveLength(2);
      expect(ledger.summary).toMatchObject({ paidCents: '12000', openCents: '0', paymentState: 'PAID' });
      const currentAxes = dialog.getByRole('region', { name: 'Zahlung korrigieren oder Erstattung dokumentieren', exact: true });
      await expect(currentAxes.getByText('Gültig zugeordnet', { exact: true }).locator('..').locator('dd')).toHaveText(/^120,00\s*€$/u);
      await expect(currentAxes.getByText('Noch einzuziehen', { exact: true }).locator('..').locator('dd')).toHaveText(/^0,00\s*€$/u);
      const currentConfirmation = dialog.getByRole('status').filter({ has: page.getByText('Zahlung gespeichert', { exact: true }) });
      await expect(currentConfirmation).toBeFocused();
      await expect(currentConfirmation).toBeInViewport({ ratio: 1 });
      const incomeList = await (await page.request.get(`/api/incomes?search=${invoiceNumber}&pageSize=100`)).json();
      expect(incomeList.items).toHaveLength(2);
      expect(new Set(incomeList.items.map((income: { amount: number }) => income.amount))).toEqual(new Set([40, 80]));
      await page.screenshot({ path: testInfo.outputPath(`partial-payments-${width}-two-events.png`), fullPage: false, animations: 'disabled' });
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await dialog.locator('[data-slot="dialog-footer"]').getByRole('button', { name: 'Schließen', exact: true }).click();
      await expect(page.getByLabel('Suche', { exact: true })).toHaveValue(invoiceNumber);
      await expect(page.getByRole('button', { name: 'Teilbezahlt', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(record()).toHaveCount(0);
      await page.getByRole('button', { name: 'Bezahlt', exact: true }).click();
      await expect(record()).toContainText('Bezahlt');
      // Merely opening history must not masquerade as a new saved operation.
      await record().getByRole('button', { name: `Weitere Aktionen fuer Rechnung ${invoiceNumber}`, exact: true }).click();
      await page.getByRole('menuitem', { name: 'Zahlungsverlauf ansehen', exact: true }).click();
      dialog = page.getByRole('dialog', { name: 'Zahlungen und Korrekturen', exact: true });
      const reloadedHistory = dialog.getByRole('region', { name: 'Zahlungsverlauf', exact: true });
      await expect(reloadedHistory.locator('ol').first().locator(':scope > li')).toHaveCount(2);
      await expect(reloadedHistory.locator('ul').first().locator(':scope > li')).toHaveCount(2);
      await expect(dialog.getByText('Zahlung gespeichert', { exact: true })).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: 'Zahlung verbindlich erfassen', exact: true })).toHaveCount(0);
      expect(posts).toBe(2);
    });
  }

  test('restores an uncertain request baseline after remount, then deliberately resolves a concurrent allocation', async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const invoiceNumber = 'E2E-BPR011-CONFLICT';
    const pdf = await PDFDocument.create(); pdf.addPage();
    const created = await page.request.post('/api/invoices', { data: { fileName: `${invoiceNumber}.pdf`, invoiceNumber, totalAmount: 120, parsedData: { currency: 'EUR' }, pdfBytes: await pdf.saveAsBase64() } });
    const invoice = await created.json();
    const paymentPath = `/api/invoices/${invoice.id}/payments`;
    await page.goto('/dashboard?tab=invoices');
    await searchPartialInvoiceAndWait(page, invoiceNumber);
    const row = page.getByRole('row').filter({ hasText: invoiceNumber });
    await row.getByRole('button', { name: 'Zahlungsstatus: Offen', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Bezahlt', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Zahlungen und Korrekturen', exact: true });
    let activeDialog = dialog;
    let submit = activeDialog.getByRole('button', { name: 'Zahlung verbindlich erfassen', exact: true });
    await expect(submit).toBeEnabled();
    await dialog.getByLabel('Eingegangener Betrag (EUR)', { exact: true }).fill('40.00');
    await dialog.getByLabel('Tatsächliches Zahlungsdatum', { exact: true }).fill('2026-10-19');
    await dialog.getByLabel('Zahlungsreferenz', { exact: true }).fill('Deliberate second allocation');
    let pendingPayload: Record<string, unknown> | undefined;
    let retryPayload: Record<string, unknown> | undefined;
    let posts = 0;
    await page.route(`**${paymentPath}`, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      posts += 1;
      if (posts === 1) {
        pendingPayload = route.request().postDataJSON();
        // No server commit, but the client cannot know that this response was lost.
        return route.abort('failed');
      }
      if (posts === 2) retryPayload = route.request().postDataJSON();
      return route.continue();
    });
    await submit.click();
    await expect(activeDialog.getByRole('alert')).toContainText('Keine verlässliche Speicherbestätigung');
    await page.keyboard.press('Escape');
    await expect(activeDialog).not.toBeVisible();
    // An independent client books while the uncertain form is unmounted.

    const concurrent = await page.request.post(paymentPath, { data: { amount: '20.00', currency: 'EUR', paidAt: '2026-10-18', source: 'MANUAL', reference: 'Concurrent independent evidence', idempotencyKey: `independent-${invoice.id}`, expectedPaidCents: '0' } });
    expect(concurrent.status()).toBe(201);
    await page.reload();
    await searchPartialInvoiceAndWait(page, invoiceNumber);
    await row.getByRole('button', { name: 'Zahlungsstatus: Teilbezahlt', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Weitere Zahlung erfassen', exact: true }).click();
    activeDialog = page.getByRole('dialog', { name: 'Zahlungen und Korrekturen', exact: true });
    submit = activeDialog.getByRole('button', { name: /^(Zahlung verbindlich erfassen|Unverändert erneut bestätigen)$/ });
    await expect(submit).toBeEnabled();
    await activeDialog.getByLabel('Eingegangener Betrag (EUR)', { exact: true }).fill('40.00');
    await activeDialog.getByLabel('Tatsächliches Zahlungsdatum', { exact: true }).fill('2026-10-19');
    await activeDialog.getByLabel('Zahlungsreferenz', { exact: true }).fill('Deliberate second allocation');
    const rejected = page.waitForResponse(response => response.url().endsWith(paymentPath) && response.request().method() === 'POST' && response.status() === 409);
    await submit.click(); await rejected;
    expect(retryPayload).toEqual(pendingPayload);
    expect(retryPayload?.expectedPaidCents).toBe('0');
    await expect(dialog).toContainText('Der Saldo wurde aktualisiert');
    await expect(dialog.getByLabel('Eingegangener Betrag (EUR)', { exact: true })).toHaveValue('40.00');
    await expect(dialog.getByLabel('Zahlungsreferenz', { exact: true })).toHaveValue('Deliberate second allocation');
    await expect(submit).toBeDisabled();
    const checked = dialog.getByRole('button', { name: 'Aktuellen Restbetrag geprüft', exact: true });
    await expect(checked).toBeEnabled();
    let journal = await (await page.request.get(paymentPath)).json(); expect(journal.events).toHaveLength(1);
    await checked.click(); await submit.click();
    await expect(dialog.getByText('Zahlung gespeichert', { exact: true })).toBeVisible();
    journal = await (await page.request.get(paymentPath)).json();
    expect(journal.events).toHaveLength(2); expect(journal.summary).toMatchObject({ paidCents: '6000', openCents: '6000' });
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
      incomes: [{ amount: 123.45, date: '2026-06-15T12:00:00.000Z' }],
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

  test('shows the cash overdraft error and retains the zero balance', async ({ page }, testInfo) => {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    const created = await page.request.post('/api/cashbook', { data: { name: 'E2E Nullbestand', initialBalance: 0 } });
    expect(created.status()).toBe(201);
    const cashBook = await created.json();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/cashbook');
    await expect(page.getByRole('button', { name: 'Buchung', exact: true })).toBeVisible();
    // Use the cashbook this real test already creates; no extra booking or setup write.
    await settleScreenshotAtTop(page);
    await page.screenshot({ path: testInfo.outputPath('cashbook-1440.png'), fullPage: true });
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
    await page.getByText('Datenbasis und Grenzen', { exact: true }).click();
    await expect(page.getByText('Zeitraum: Steuerjahr 2025', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('tax-annual.png'), fullPage: true });
    await page.getByRole('button', { name: 'Nebenberuflich', exact: true }).click();
    await page.getByLabel('Bruttojahresgehalt (EUR)', { exact: true }).fill('65000');
    await page.getByText('Berechnungsweg anzeigen', { exact: true }).click();
    await expect(page.getByText('Einkünfte aus Anstellung', { exact: true })).toBeVisible();
    for (const width of [1440, 320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await settleScreenshotAtTop(page);
      await page.screenshot({ path: testInfo.outputPath('tax-studio-' + width + '.png'), fullPage: true });
    }
    await page.getByRole('button', { name: 'Standardwerte', exact: true }).click();
    await page.getByLabel('Analysezeitraum').selectOption('last3Months');
    await expect(page.getByRole('alert').filter({ hasText: 'Keine Berechnung für diesen Zeitraum oder Verlustfall.' })).toBeVisible();
    await expect(page.getByText('nicht berechnet', { exact: true }).first()).toBeVisible();
    await page.goto('/dashboard?tab=eur');
    await page.getByRole('button', { name: 'EÜR-Übertragungshilfe öffnen', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Anlage EÜR – Übertragungshilfe' });
    const selectedYear = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/eur-export' && url.searchParams.get('year') === '2025' && url.searchParams.get('format') === 'json';
    });
    await dialog.getByRole('combobox').click();
    await page.getByRole('option', { name: '2025', exact: true }).click();
    expect((await selectedYear).status()).toBe(200);
    await expect(dialog.getByRole('combobox')).toHaveText('2025');
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
    await page.getByRole('button', { name: 'Neuer Kunde' }).click();
    await page.locator('#name').fill(customerName);
    await page.locator('#email').fill('billing@example.test');
    await page.locator('#address').fill('Kundenweg 2');
    await page.locator('#zipCode').fill('10115');
    await page.locator('#city').fill('Berlin');
    await page.getByText('Interner Hinweis', { exact: true }).click();
    await page.locator('#internalNote').fill(privateNote);
    await page.locator('#noteVisibility').selectOption('BOTH');
    const customerSaved = page.waitForResponse(r => r.url().endsWith('/api/customers') && r.request().method() === 'POST');
    await page.getByRole('dialog', { name: 'Neuer Kunde', exact: true }).getByRole('button', { name: 'Kunden anlegen', exact: true }).click();
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
    await expect(page.getByRole('article').filter({ hasText: 'Serverwartung' }).getByText('Rechnung zugeordnet', { exact: true })).toBeVisible();
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
      const paymentHelp = page.getByRole('region', { name: 'Zahlung erfassen', exact: true });
      await expect(paymentHelp).toContainText('Betrag, tatsächliches Datum und Referenz eingeben und verbindlich bestätigen.');
      await expect(paymentHelp).toContainText('Geldeingang anhand des Zahlungsnachweises prüfen.');
      await expect(paymentHelp).toContainText('Jede Teilzahlung erzeugt eine Einnahme am Zahlungsdatum; nicht zusätzlich manuell erfassen.');
      await expect(paymentHelp).not.toContainText('Ein eigenes Datumsfeld gibt es dort nicht');
      await expect(paymentHelp).not.toContainText('aktuellen Buchungszeitpunkt als Zahlungsdatum');
      await expect(page.locator('#steuerprofil')).toContainText('≠');
      await expect(page.locator('#umfang')).toContainText('keine ELSTER-Einreichung');
      await expect(page.locator('#zugang')).toContainText('Kein Supportkontakt');
      // Tab rather than click proves the first workflow link is keyboard reachable.
      await page.goto('/');
      const firstGuide = page.getByRole('link', { name: 'Erste Rechnung', exact: true });
      for (let index = 0; index < 20 && !(await firstGuide.evaluate(element => element === document.activeElement)); index++) await page.keyboard.press('Tab');
      await expect(firstGuide).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/help#erste-rechnung$/);
      const protectedLink = page.getByRole('link', { name: 'Firmendaten', exact: true });
      await protectedLink.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/login\?callbackUrl=/);
      expect(new URL(page.url()).searchParams.get('callbackUrl')).toBe('/settings');
      // A redirected document can expose its URL before the login form is ready.
      await page.waitForLoadState('load');
      await expect(page.getByRole('heading', { name: 'Anmelden', exact: true })).toBeVisible();
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

  test('reviews incoming originals at 390px without posting and preserves the exact download', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    const snapshot = async () => {
      const endpoints = ['/api/expenses?pageSize=1', '/api/incomes?pageSize=1', '/api/invoices?pageSize=1', '/api/customers', '/api/cashbook'];
      const responses = await Promise.all(endpoints.map(endpoint => page.request.get(endpoint)));
      for (const response of responses) expect(response.status()).toBe(200);
      const [expenses, incomes, invoices, customers, cashBooks] = await Promise.all(responses.map(response => response.json()));
      expect(typeof expenses.total).toBe('number'); expect(typeof incomes.total).toBe('number'); expect(typeof invoices.total).toBe('number');
      expect(Array.isArray(customers)).toBe(true); expect(Array.isArray(cashBooks)).toBe(true);
      return { expenses: expenses.total, incomes: incomes.total, invoices: invoices.total, customers: customers.length,
        cashBooks: cashBooks.map((book: { id: number; transactionCount: number; currentBalance: number }) => ({ id: book.id, count: book.transactionCount, balance: book.currentBalance })) };
    };
    const before = await snapshot();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/purchases');
    await expect(page.getByRole('heading', { name: 'Belegeingang', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Original hinzufügen', exact: true }).click();
    const bytes = Buffer.from('<Invoice><ID>INCOMING-E2E-42</ID><IssueDate>2026-10-20</IssueDate><DocumentCurrencyCode>EUR</DocumentCurrencyCode><AccountingSupplierParty><Party><PartyName><Name>E2E Eingangslieferant</Name></PartyName></Party></AccountingSupplierParty><AccountingCustomerParty><Party><PartyName><Name>E2E eigener Betrieb</Name></PartyName></Party></AccountingCustomerParty><LegalMonetaryTotal><TaxInclusiveAmount currencyID="EUR">119.00</TaxInclusiveAmount><PayableAmount currencyID="EUR">119.00</PayableAmount></LegalMonetaryTotal></Invoice>');
    const original = { name: 'incoming-e2e-original.xml', mimeType: 'application/xml', buffer: bytes };
    await page.getByLabel('Foto, PDF- oder XML-Original auswählen', { exact: true }).setInputFiles(original);
    const uploaded = page.waitForResponse(response => response.url().endsWith('/api/purchase-documents') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Original hochladen', exact: true }).click();
    const first = await uploaded; expect(first.status()).toBe(201);
    const { document } = await first.json();
    await expect(page).toHaveURL(new RegExp(`/purchases\\?document=${document.id}$`));
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Eingangsbeleg prüfen', exact: true })).toBeFocused();
    await expect(dialog.getByRole('region', { name: 'Lieferant / Verkäufer', exact: true })).toContainText('E2E Eingangslieferant');
    await expect(dialog.getByRole('region', { name: 'Empfänger / Käufer', exact: true })).toContainText('E2E eigener Betrieb');
    await expect(dialog.getByText('Zu prüfen · nicht gebucht', { exact: true })).toBeVisible();
    await expect(dialog.getByText('119,00 EUR', { exact: true })).toHaveCount(2);
    await expect(dialog.getByRole('button', { name: 'Als Ausgabe erfassen', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('region', { name: 'Gewählter Lieferantenkontakt', exact: true })).toContainText('Noch nicht zugeordnet.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('incoming-review-390.png'), fullPage: true, animations: 'disabled' });
    const downloaded = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Original herunterladen', exact: true }).click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe(original.name);
    expect(await readFile((await download.path())!)).toEqual(bytes);
    await dialog.getByRole('button', { name: 'Beleg verwerfen', exact: true }).click();
    await dialog.getByLabel('Warum wird dieser Beleg verworfen?', { exact: true }).fill('Abgebrochene Prüfung');
    await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await expect(dialog.getByLabel('Warum wird dieser Beleg verworfen?', { exact: true })).toHaveCount(0);
    await expect(dialog.getByText('Zu prüfen · nicht gebucht', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Beleg verwerfen', exact: true }).click();
    await dialog.getByLabel('Warum wird dieser Beleg verworfen?', { exact: true }).fill('E2E review only');
    await dialog.getByRole('button', { name: 'Verwerfen bestätigen', exact: true }).click();
    await expect(dialog.getByText('Verworfen · nicht gebucht', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Wieder öffnen', exact: true }).click();
    await expect(dialog.getByText('Zu prüfen · nicht gebucht', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/purchases$/);
    await page.getByLabel('Foto, PDF- oder XML-Original auswählen', { exact: true }).setInputFiles(original);
    const duplicate = page.waitForResponse(response => response.url().endsWith('/api/purchase-documents') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Original hochladen', exact: true }).click();
    expect((await duplicate).status()).toBe(409);
    await expect(page.getByRole('region', { name: 'Original hinzufügen', exact: true }).getByRole('alert')).toContainText('bereits im Belegeingang');
    await page.getByRole('button', { name: 'Vorhandenes Original öffnen', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/purchases\\?document=${document.id}$`));
    await expect(page.getByRole('dialog').getByText('Zu prüfen · nicht gebucht', { exact: true })).toBeVisible();
    expect(await snapshot()).toEqual(before);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/purchases$/);
    const searchField = page.getByLabel('Lieferant, Rechnungsnummer oder Dateiname', { exact: true });
    await searchField.fill('INCOMING-E2E-42');
    await expect(searchField).toHaveValue('INCOMING-E2E-42');
    const searched = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/purchase-documents' && url.searchParams.get('search') === 'INCOMING-E2E-42';
    });
    await page.getByRole('button', { name: 'Belege suchen', exact: true }).click();
    await expect(page).toHaveURL(/\/purchases\?search=INCOMING-E2E-42$/);
    expect((await searched).status()).toBe(200);
    await expect(searchField).toHaveValue('INCOMING-E2E-42');
    const result = page.getByRole('list', { name: 'Eingangsbelege', exact: true }).getByRole('button');
    await expect(result).toHaveCount(1);
    await page.setViewportSize({ width: 1440, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('incoming-list-1440.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Dunkles Farbschema aktivieren', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.screenshot({ path: testInfo.outputPath('incoming-list-dark-1440.png'), fullPage: true, animations: 'disabled' });
    await result.click();
    const desktopReview = page.getByRole('dialog');
    await expect(desktopReview.getByRole('heading', { name: 'Eingangsbeleg prüfen', exact: true })).toBeFocused();
    await expect(desktopReview.getByRole('region', { name: 'Lieferant / Verkäufer', exact: true })).toContainText('E2E Eingangslieferant');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await desktopReview.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('incoming-review-dark-1440.png'), fullPage: true, animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(desktopReview).toHaveCount(0);
    await expect(result).toBeFocused();
    await page.getByRole('button', { name: 'Helles Farbschema aktivieren', exact: true }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  test('discovers accountant handoff in settings and downloads the approved real archive exactly once', async ({ page }, testInfo) => {
    await signIn(page);
    // Dedicated future dates keep these synthetic records independent of earlier ledger cases.
    const original = Buffer.from('%PDF-1.7\nSynthetic accountant handoff receipt\n%%EOF\n');
    const attached = await page.request.post('/api/expenses', { multipart: {
      description: 'HANDOFF original fixture', amount: '23.45', date: '2041-03-15',
      category: 'Handoff fixture', taxRelevant: 'true',
      receipt: { name: 'synthetic-handoff.pdf', mimeType: 'application/pdf', buffer: original },
    } });
    expect(attached.ok()).toBe(true);
    const attachedExpense = await attached.json();
    const absent = await page.request.post('/api/expenses', { data: {
      description: 'HANDOFF absent original fixture', amount: 9.87, date: '2041-03-16',
      category: 'Handoff fixture', taxRelevant: true,
    } });
    expect(absent.ok()).toBe(true);
    const absentExpense = await absent.json();
    await page.goto('/settings');
    const entry = page.locator('#handoff-settings').getByRole('link', { name: 'Unterlagen übergeben', exact: true });
    await entry.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/handoff$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Unterlagen übergeben' })).toBeVisible();
    await expect(page.getByText('Bivaro-ZIP · Kein DATEV-/ELSTER-Export oder Backup.', { exact: true })).toBeVisible();
    await page.getByText('Paketinhalt und Grenzen', { exact: true }).click();
    await page.getByText('Grenzen und ausgeschlossene Daten', { exact: true }).click();
    await expect(page.getByText('Kein DATEV-Format oder zugesicherter DATEV-Import', { exact: false })).toBeVisible();
    await page.getByText('Paketinhalt und Grenzen', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Kalenderjahr', exact: true }).fill('2041');
    let downloadCount = 0;
    page.on('download', () => downloadCount++);
    const previewResponse = page.waitForResponse(response => response.url().includes('/api/accountant-export?') && response.url().includes('preview=1'));
    await page.getByRole('button', { name: 'Vorschau laden', exact: true }).click();
    const preview = await (await previewResponse).json();
    expect(preview.manifest).toMatchObject({
      period: { from: '2041-01-01', to: '2041-12-31' },
      counts: { expenses: 2 }, originalCounts: { included: 1, missing: 0, notAttached: 1 },
    });
    await expect(page.locator('#handoff-review-heading')).toBeFocused();
    await expect(page.getByText('1 Original fehlt', { exact: true })).toBeVisible();
    await page.getByText('Warnungen anzeigen', { exact: true }).click();
    await expect(page.getByText('Kein Originalbeleg an der Ausgabe hinterlegt.', { exact: false })).toBeVisible();
    const downloadButton = page.getByRole('button', { name: 'ZIP herunterladen', exact: true });
    await expect(downloadButton).toBeDisabled();
    expect(downloadCount).toBe(0);
    await page.getByRole('checkbox', { name: /Ich habe Umfang und Warnungen/ }).check();
    // Hold only the real ZIP request: repeated activation must not start a second request.
    let zipRequests = 0;
    let releaseZip!: () => void;
    const zipGate = new Promise<void>(resolve => { releaseZip = resolve; });
    await page.route('**/api/accountant-export?**', async route => {
      if (!new URL(route.request().url()).searchParams.has('preview')) {
        zipRequests++;
        await zipGate;
      }
      await route.continue();
    });
    const downloaded = page.waitForEvent('download');
    await downloadButton.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => zipRequests).toBe(1);
    await expect(page.getByRole('button', { name: 'ZIP wird erstellt', exact: true })).toBeDisabled();
    await page.keyboard.press('Enter');
    releaseZip();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe('bivaro-uebergabepaket-2041-01-01-2041-12-31.zip');
    const archivePath = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(archivePath);
    const bytes = await readFile(archivePath);
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
    const zip = await JSZip.loadAsync(bytes);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.sourceFingerprint).toBe(preview.manifest.sourceFingerprint);
    expect(manifest.scope).toMatchObject({ datevCertified: false, elsterSubmission: false, completeAuditExport: false, restorableBackup: false });
    expect(manifest.warnings).toContainEqual(expect.objectContaining({ code: 'ORIGINAL_NOT_ATTACHED', recordId: absentExpense.id }));
    const records = JSON.parse(await zip.file('records.json')!.async('string'));
    expect(records.expenses.map((row: { id: number }) => row.id).sort()).toEqual([attachedExpense.id, absentExpense.id].sort());
    expect(await zip.file(`originals/expense-${attachedExpense.id}.pdf`)!.async('nodebuffer')).toEqual(original);
    expect(await zip.file('README.txt')!.async('string')).toContain('kein vollständiger GoBD-Prüfexport');
    for (const entry of manifest.entries) {
      const content = await zip.file(entry.zipPath)!.async('nodebuffer');
      expect(content.byteLength).toBe(entry.bytes);
      expect(createHash('sha256').update(content).digest('hex')).toBe(entry.sha256);
    }
    await expect(page.getByRole('status')).toContainText('Es wurde nichts an eine Kanzlei gesendet.');
    expect(zipRequests).toBe(1);
    expect(downloadCount).toBe(1);
    await page.screenshot({ path: testInfo.outputPath('handoff-approved-archive.png'), fullPage: true });
    await page.getByRole('button', { name: 'Zeitraum ändern', exact: true }).click();
    await expect(page.locator('#handoff-period-heading')).toBeFocused();
    await page.getByRole('button', { name: 'Vorschau laden', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /Ich habe Umfang und Warnungen/ })).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'ZIP herunterladen', exact: true })).toBeDisabled();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Kalenderjahr', exact: true })).toHaveValue('2041');
    await expect(page.locator('#handoff-review-heading')).toHaveCount(0);
    expect(downloadCount).toBe(1);
  });

  test('opens handoff from help on mobile, validates dates and explains an empty package with keyboard focus', async ({ page }, testInfo) => {
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/help#export');
    const helpEntry = page.locator('#export').getByRole('link', { name: 'Unterlagen übergeben', exact: true });
    await helpEntry.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/handoff$/);
    let exportRequests = 0;
    page.on('request', request => { if (request.url().includes('/api/accountant-export?')) exportRequests++; });
    await page.getByRole('radio', { name: 'Eigener Zeitraum', exact: true }).check();
    const from = page.getByLabel('Von einschließlich', { exact: true });
    const to = page.getByLabel('Bis einschließlich', { exact: true });
    await from.fill('2042-12-31');
    await to.fill('2042-01-01');
    await page.getByRole('button', { name: 'Vorschau laden', exact: true }).click();
    expect(await to.evaluate(element => (element as HTMLInputElement).validity.rangeUnderflow)).toBe(true);
    expect(exportRequests).toBe(0);
    await from.fill('2042-01-01');
    await to.fill('2043-01-02');
    await page.getByRole('button', { name: 'Vorschau laden', exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('höchstens 366 Tage');
    expect(exportRequests).toBe(0);
    await to.fill('2042-12-31');
    await to.focus();
    const loadPreview = page.getByRole('button', { name: 'Vorschau laden', exact: true });
    // Native date fields may expose separate keyboard segments before the next control.
    for (let index = 0; index < 6 && !(await loadPreview.evaluate(element => element === document.activeElement)); index++) await page.keyboard.press('Tab');
    await expect(loadPreview).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#handoff-review-heading')).toBeFocused();
    await expect(page.getByText('Keine Datensätze im gewählten Zeitraum.', { exact: false })).toBeVisible();
    await expect(page.getByText('Keine technischen Warnungen.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ZIP herunterladen', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('handoff-mobile-empty-390.png'), fullPage: true });
    await page.keyboard.press('Tab');
    await expect(page.locator('summary', { hasText: 'Paketstand und Prüfsumme' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('checkbox', { name: /Ich habe Umfang und Warnungen/ })).toBeFocused();
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    const downloaded = page.waitForEvent('download');
    await expect(page.getByRole('button', { name: 'ZIP herunterladen', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    const download = await downloaded;
    const archivePath = testInfo.outputPath('handoff-empty.zip');
    await download.saveAs(archivePath);
    const zip = await JSZip.loadAsync(await readFile(archivePath));
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(Object.values(manifest.counts)).toEqual(expect.arrayContaining([0]));
    expect(Object.values(manifest.counts).every(count => count === 0)).toBe(true);
    expect(Object.keys(zip.files).some(path => path.startsWith('originals/'))).toBe(false);
    expect(await zip.file('expenses.csv')!.async('string')).toContain('"description"');
    await page.getByRole('button', { name: 'Zeitraum ändern', exact: true }).click();
    await expect(page.locator('#handoff-period-heading')).toBeFocused();
    await expect(from).toHaveValue('2042-01-01');
    await expect(to).toHaveValue('2042-12-31');
  });

  test('requires fresh approval when accountant handoff data changes after preview', async ({ page }, testInfo) => {
    await signIn(page);
    await page.goto('/handoff?year=2043');
    await page.getByRole('button', { name: 'Vorschau laden', exact: true }).click();
    await expect(page.locator('#handoff-review-heading')).toBeFocused();
    await page.getByRole('checkbox', { name: /Ich habe Umfang und Warnungen/ }).check();
    expect((await page.request.post('/api/incomes', { data: { description: 'HANDOFF changed after preview', amount: 7.89, date: '2043-01-02' } })).ok()).toBe(true);
    let downloads = 0;
    page.on('download', () => downloads++);
    const conflict = page.waitForResponse(response => response.url().includes('/api/accountant-export?') && response.status() === 409);
    await page.getByRole('button', { name: 'ZIP herunterladen', exact: true }).click();
    await conflict;
    await expect(page.locator('#handoff-period-heading')).toBeFocused();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Daten oder Originale haben sich seit der Vorschau geändert.');
    await expect(page.getByRole('textbox', { name: 'Kalenderjahr', exact: true })).toHaveValue('2043');
    expect(downloads).toBe(0);
    await page.getByRole('button', { name: 'Vorschau laden', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /Ich habe Umfang und Warnungen/ })).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'ZIP herunterladen', exact: true })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath('handoff-drift-new-approval.png'), fullPage: true });
  });

  test('books a reviewed supplier original at 390px only after deliberate payment confirmation', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const before = await purchaseFinancialSnapshot(page);
    const suppliersBefore = await (await page.request.get('/api/suppliers?limit=50')).json();
    const source = await uploadPurchaseFixture(page, 'BOOKING-E2E-101');
    bookingSource = source;
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Als Ausgabe erfassen', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('region', { name: 'Empfänger / Käufer', exact: true })).toContainText('Synthetischer eigener Betrieb');
    expect((await (await page.request.get('/api/suppliers?limit=50')).json()).total).toBe(suppliersBefore.total);
    expect(await purchaseFinancialSnapshot(page)).toEqual(before);
    await dialog.getByRole('button', { name: 'Kontakt auswählen / anlegen', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Lieferantenkontakt auswählen', exact: true })).toBeFocused();
    await dialog.getByRole('button', { name: 'Kontakt neu anlegen', exact: true }).click();
    await expect(dialog.getByLabel('Name *', { exact: true })).toBeFocused();
    await expect(dialog.getByLabel('Name *', { exact: true })).toHaveValue('');
    await dialog.getByRole('button', { name: 'Lieferantenangaben aus Original als Entwurf übernehmen', exact: true }).click();
    await expect(dialog.getByLabel('Name *', { exact: true })).toHaveValue('Synthetischer Originalverkäufer');
    await dialog.getByLabel('Name *', { exact: true }).fill('E2E bewusst gewählter Lieferantenkontakt');
    await dialog.getByLabel('Ort (optional)', { exact: true }).fill('Teststadt');
    // A definite validation failure must leave the user's contact draft intact.
    await page.route('**/api/suppliers', async route => {
      if (route.request().method() === 'POST') await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetischer Validierungsfehler – Eingaben prüfen.', code: 'INVALID_INPUT' }) });
      else await route.continue();
    });
    await dialog.getByRole('button', { name: 'Kontakt speichern', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Die Anfrage konnte nicht abgeschlossen werden. Bitte erneut versuchen.');
    await expect(dialog.getByRole('alert')).not.toContainText('Synthetischer Validierungsfehler');
    await expect(dialog.getByRole('alert')).toBeFocused();
    await expect(dialog.getByLabel('Name *', { exact: true })).toHaveValue('E2E bewusst gewählter Lieferantenkontakt');
    await expect(dialog.getByLabel('Ort (optional)', { exact: true })).toHaveValue('Teststadt');
    await page.unroute('**/api/suppliers');
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/suppliers' && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Kontakt speichern', exact: true }).click();
    const savedResponse = await saved; expect(savedResponse.status()).toBe(201);
    bookingSupplier = (await savedResponse.json()).supplier;
    await expect(dialog.getByRole('status').filter({ hasText: 'Zum Beleg wird er erst' })).toBeVisible();
    expect((await readPurchase(page, source.id)).supplierId).toBeNull();
    await selectPurchaseSupplier(page, bookingSupplier.name);
    const selected = await readPurchase(page, source.id);
    expect(selected.supplierId).toBe(bookingSupplier.id);
    expect(selected.selectedSupplierSnapshot).toEqual(bookingSupplier);
    expect(selected.supplierCandidate?.name).toBe('Synthetischer Originalverkäufer');
    expect(selected.buyerCandidate?.name).toBe('Synthetischer eigener Betrieb');
    expect(selected.originalRef).toEqual(source.originalRef);
    await expect(dialog.getByRole('button', { name: 'Kontakt wechseln / verwalten', exact: true })).toBeFocused();
    await openPurchaseDetails(page);
    await expectBlankPurchaseChoices(page);
    await fillPurchaseDetails(page, 'Synthetische Beschaffung 101');
    await dialog.getByRole('button', { name: 'Abbrechen · nicht buchen', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Als Ausgabe erfassen', exact: true })).toBeFocused();
    expect(await purchaseFinancialSnapshot(page)).toEqual(before);
    await openPurchaseDetails(page);
    await expectBlankPurchaseChoices(page);
    await fillPurchaseDetails(page, 'Synthetische Beschaffung 101');
    await dialog.getByLabel('Betrieblicher / abziehbarer Anteil in %', { exact: true }).fill('101');
    await expect(dialog.getByRole('button', { name: 'Weiter zur Bestätigung', exact: true })).toBeDisabled();
    await dialog.getByLabel('Betrieblicher / abziehbarer Anteil in %', { exact: true }).fill('75');
    const next = dialog.getByRole('button', { name: 'Weiter zur Bestätigung', exact: true });
    await next.focus(); await page.keyboard.press('Enter');
    await expect(dialog.getByRole('heading', { name: 'Angaben bewusst bestätigen', exact: true })).toBeFocused();
    const confirm = dialog.getByRole('button', { name: 'Zahlung bestätigen und Ausgabe erfassen', exact: true });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('checkbox', { name: /Ich habe das unveränderte Original geprüft/ }).check();
    await dialog.getByRole('checkbox', { name: /Der Empfänger \/ Käufer im Original gehört/ }).check();
    await expect(confirm).toBeDisabled();
    expect(await purchaseFinancialSnapshot(page)).toEqual(before);
    await dialog.getByRole('checkbox', { name: /Der vollständige Betrag ist tatsächlich abgeflossen/ }).check();
    await expect(confirm).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('purchase-confirmation-390.png'), fullPage: true, animations: 'disabled' });
    let approvalPosts = 0;
    await page.route(`**/api/purchase-documents/${source.id}/approve-expense`, async route => {
      approvalPosts++;
      const response = await route.fetch();
      // Keep the real response in flight so two physical clicks exercise the UI lock.
      await new Promise(resolve => setTimeout(resolve, 250));
      await route.fulfill({ response });
    });
    const approved = page.waitForResponse(response => response.url().endsWith(`/${source.id}/approve-expense`));
    await confirm.click({ clickCount: 2, delay: 30 });
    const response = await approved; expect(response.status()).toBe(200);
    const result = await response.json(); bookingExpenseId = result.expense.id;
    expect(result.replayed).toBe(false); expect(approvalPosts).toBe(1);
    await expect(dialog.getByRole('status').filter({ hasText: `Ausgabe #${bookingExpenseId} gespeichert` })).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Gespeicherte Ausgabe ansehen', exact: true })).toHaveAttribute('href', `/expenses/${bookingExpenseId}`);
    await expect(dialog.getByRole('button', { name: 'Als Ausgabe erfassen', exact: true })).toHaveCount(0);
    await expect(dialog).toContainText('18.10.2026');
    await page.screenshot({ path: testInfo.outputPath('purchase-saved-result-390.png'), fullPage: true, animations: 'disabled' });
    await assertDownloadedBytes(page, () => dialog.getByRole('button', { name: 'Original herunterladen', exact: true }).click(), source.bytes);
    const after = await purchaseFinancialSnapshot(page);
    expect(after).toEqual({ ...before, expenses: before.expenses + 1 });
    await dialog.getByRole('link', { name: 'Gespeicherte Ausgabe ansehen', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/expenses/${bookingExpenseId}$`));
    await expect(page.getByRole('heading', { name: `Gespeicherte Ausgabe #${bookingExpenseId}`, exact: true })).toBeVisible();
    await expect(page.getByRole('main')).toContainText('18.10.2026');
    await expect(page.getByRole('main')).toContainText('11.10.2026');
    await expect(page.getByRole('main')).toContainText('75 %');
    await expect(page.getByRole('main')).toContainText(bookingSupplier.name);
    await expect(page.getByRole('main')).toContainText('nachträgliche Kassenbuch-Zuordnung');
    await page.reload();
    await expect(page.getByRole('heading', { name: `Gespeicherte Ausgabe #${bookingExpenseId}`, exact: true })).toBeVisible();
    expect(await purchaseFinancialSnapshot(page)).toEqual(after);
    const detail = await (await page.request.get(`/api/expenses/${bookingExpenseId}`)).json();
    expect(detail.expense).toMatchObject({ amount: 119, date: '2026-10-18T00:00:00.000Z', category: 'Bürobedarf', taxRelevant: false, taxDeductiblePercentage: 75, depreciationYears: null });
    expect(detail.source.originalSha256).toBe(source.originalRef.sha256);
    await page.screenshot({ path: testInfo.outputPath('purchase-expense-detail-390.png'), fullPage: true, animations: 'disabled' });
    await assertDownloadedBytes(page, () => page.getByRole('link', { name: 'Original herunterladen', exact: true }).click(), source.bytes);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/dashboard?tab=expenses');
    const row = page.getByRole('row').filter({ hasText: 'Synthetische Beschaffung 101' });
    await expect(row).toContainText('Beleggebunden · schreibgeschützt');
    const sourceWarning = row.getByText('Originalzuordnung geschützt: kein allgemeines Ändern oder Löschen. Auch eine nachträgliche Kassenbuch-Zuordnung wird hier nicht unterstützt.', { exact: true });
    await expect(sourceWarning).toHaveCSS('white-space', 'normal');
    expect(await sourceWarning.evaluate(element => element.scrollWidth <= element.clientWidth), 'The complete readonly warning must wrap inside its desktop action cell').toBe(true);
    await expect(row.getByRole('button', { name: /bearbeiten|löschen|duplizieren/i })).toHaveCount(0);
    await expect(row.getByRole('button', { name: /Beleg .* anzeigen/ })).toHaveCount(0);
    await assertDownloadedBytes(page, () => row.getByRole('link', { name: /XML-Original .* herunterladen/ }).click(), source.bytes);
    await expect(row.getByRole('link', { name: /Gespeicherte Ausgabe .* ansehen/ })).toHaveAttribute('href', `/expenses/${bookingExpenseId}`);
    await page.screenshot({ path: testInfo.outputPath('purchase-source-bound-expense-list-1440.png'), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = page.getByRole('article').filter({ hasText: 'Synthetische Beschaffung 101' });
    await expect(mobile).toContainText('Beleggebunden · schreibgeschützt');
    await expect(mobile.getByRole('button', { name: /Bearbeiten|Löschen|Duplizieren/ })).toHaveCount(0);
    await assertDownloadedBytes(page, () => mobile.getByRole('link', { name: /XML-Original .* herunterladen/ }).click(), source.bytes);
    await page.screenshot({ path: testInfo.outputPath('purchase-source-bound-expense-list-390.png'), fullPage: true, animations: 'disabled' });
  });

  test('reuses a supplier without rewriting original snapshots and safely retries an uncertain saved booking', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await signIn(page);
    const before = await purchaseFinancialSnapshot(page);
    const second = await uploadPurchaseFixture(page, 'BOOKING-E2E-102');
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Kontakt auswählen / anlegen', exact: true }).click();
    await selectPurchaseSupplier(page, bookingSupplier.name);
    const selectedBeforeEdit = await readPurchase(page, second.id);
    await dialog.getByRole('button', { name: 'Kontakt wechseln / verwalten', exact: true }).click();
    const contact = dialog.getByRole('listitem').filter({ hasText: bookingSupplier.name });
    await contact.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
    await dialog.getByLabel('Name *', { exact: true }).fill('E2E explizit geänderter Lieferantenkontakt');
    const changed = page.waitForResponse(response => response.url().endsWith(`/api/suppliers/${bookingSupplier.id}`) && response.request().method() === 'PATCH');
    await dialog.getByRole('button', { name: 'Kontakt speichern', exact: true }).click();
    expect((await changed).status()).toBe(200);
    await expect(dialog.getByRole('status').filter({ hasText: 'Bestehende Originale und gespeicherte Zuordnungs-Snapshots bleiben unverändert' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Zurück zum Original', exact: true }).click();
    await expect(dialog.getByRole('region', { name: 'Gewählter Lieferantenkontakt', exact: true })).toContainText(bookingSupplier.name);
    const secondAfterEdit = await readPurchase(page, second.id);
    expect(secondAfterEdit.selectedSupplierSnapshot).toEqual(selectedBeforeEdit.selectedSupplierSnapshot);
    expect(secondAfterEdit.supplierCandidate).toEqual(selectedBeforeEdit.supplierCandidate);
    expect(secondAfterEdit.buyerCandidate).toEqual(selectedBeforeEdit.buyerCandidate);
    expect(secondAfterEdit.originalRef).toEqual(selectedBeforeEdit.originalRef);
    const old = await readPurchase(page, bookingSource.id);
    expect(old.selectedSupplierSnapshot).toEqual(bookingSupplier);
    expect(old.originalRef).toEqual(bookingSource.originalRef);
    expect((await (await page.request.get(`/api/expenses/${bookingExpenseId}`)).json()).source.selectedSupplierSnapshot).toEqual(bookingSupplier);
    await openPurchaseDetails(page); await fillPurchaseDetails(page, 'Synthetische Beschaffung 102'); await confirmPurchaseChoices(page);
    const sent: unknown[] = [];
    let firstExpenseId = 0;
    await page.route(`**/api/purchase-documents/${second.id}/approve-expense`, async route => {
      sent.push(route.request().postDataJSON());
      const response = await route.fetch();
      const body = await response.json();
      expect(response.status()).toBe(200);
      if (sent.length === 1) {
        firstExpenseId = body.expense.id;
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetisch verlorene Speicherantwort' }) });
      } else {
        expect(body.expense.id).toBe(firstExpenseId); expect(body.replayed).toBe(true);
        await route.fulfill({ response });
      }
    });
    await dialog.getByRole('button', { name: 'Zahlung bestätigen und Ausgabe erfassen', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Die Antwort ist unklar');
    await expect(dialog.getByRole('alert')).toBeFocused();
    await expect(dialog).toContainText('Synthetische Beschaffung 102');
    await expect(dialog).toContainText('18.10.2026');
    await expect(dialog.getByRole('button', { name: 'Angaben ändern', exact: true })).toHaveCount(0);
    const afterSaved = { ...before, expenses: before.expenses + 1 };
    expect(await purchaseFinancialSnapshot(page)).toEqual(afterSaved);
    // Only the automatic list refresh fails: the confirmed saved result remains authoritative.
    await page.route('**/api/purchase-documents?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetische Listenstörung' }) }));
    await dialog.getByRole('button', { name: 'Dieselbe Anfrage sicher wiederholen', exact: true }).click();
    await expect(dialog.getByRole('status').filter({ hasText: `Ausgabe #${firstExpenseId} gespeichert` })).toBeVisible();
    expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]);
    expect(await purchaseFinancialSnapshot(page)).toEqual(afterSaved);
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
    const listError = page.getByRole('alert').filter({ hasText: 'Die Änderung wurde gespeichert, aber die Belegliste' });
    await expect(listError).toContainText('Keine erneute Buchung starten');
    await page.screenshot({ path: testInfo.outputPath('purchase-saved-refresh-warning.png'), fullPage: true, animations: 'disabled' });
    await page.unroute('**/api/purchase-documents?*');
    const recoveryMethods: string[] = [];
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/purchase-documents')) recoveryMethods.push(request.method()); });
    const recovered = page.waitForResponse(response => new URL(response.url()).pathname === '/api/purchase-documents' && response.request().method() === 'GET');
    await listError.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
    expect((await recovered).status()).toBe(200);
    await expect(page.locator('section[aria-labelledby="incoming-list-heading"]')).toHaveAttribute('aria-busy', 'false');
    await expect(listError).toHaveCount(0);
    expect(recoveryMethods.length).toBeGreaterThan(0); expect(recoveryMethods.every(method => method === 'GET')).toBe(true);
    await page.goto(`/purchases?document=${second.id}`);
    await expect(page.getByRole('dialog').getByRole('link', { name: `Gespeicherte Ausgabe #${firstExpenseId} ansehen`, exact: true })).toHaveAttribute('href', `/expenses/${firstExpenseId}`);
    await page.reload();
    await expect(page.getByRole('dialog').getByRole('link', { name: `Gespeicherte Ausgabe #${firstExpenseId} ansehen`, exact: true })).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Als Ausgabe erfassen', exact: true })).toHaveCount(0);
    expect(await purchaseFinancialSnapshot(page)).toEqual(afterSaved);
    expect((await readPurchase(page, second.id)).linkedExpenseId).toBe(firstExpenseId);
  });

  test('rejects stale duplicate acknowledgments with an honest recoverable browser state', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await signIn(page);
    const before = await purchaseFinancialSnapshot(page);
    const duplicate = await uploadPurchaseFixture(page, 'BOOKING-E2E-101', '<!-- distinct synthetic duplicate bytes -->');
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Kontakt auswählen / anlegen', exact: true }).click();
    await selectPurchaseSupplier(page, 'E2E explizit geänderter Lieferantenkontakt');
    await openPurchaseDetails(page); await fillPurchaseDetails(page, 'Synthetischer Dublettenkonflikt');
    await confirmPurchaseChoices(page);
    const duplicateCheck = dialog.getByRole('checkbox', { name: new RegExp(`Ich habe Beleg #${bookingSource.id} geprüft`) });
    const confirm = dialog.getByRole('button', { name: 'Zahlung bestätigen und Ausgabe erfassen', exact: true });
    await expect(confirm).toBeDisabled(); await duplicateCheck.check(); await expect(confirm).toBeEnabled();
    // A second real browser uploads another source after the displayed duplicate list was reviewed.
    const other = await page.context().newPage();
    try {
      await uploadPurchaseFixture(other, 'BOOKING-E2E-101', '<!-- later concurrent synthetic duplicate -->');
      const rejected = page.waitForResponse(response => response.url().endsWith(`/${duplicate.id}/approve-expense`));
      await confirm.click(); expect((await rejected).status()).toBe(409);
      await expect(dialog.getByRole('alert')).toContainText('Die ähnlichen Belege haben sich geändert. Bitte den Beleg neu laden und die aktuellen Dubletten einzeln prüfen.');
      await expect(dialog.getByRole('alert')).toBeFocused();
      await expect(dialog).toContainText('Synthetischer Dublettenkonflikt');
      await expect(dialog).toContainText('18.10.2026');
      expect((await readPurchase(page, duplicate.id)).linkedExpenseId).toBeNull();
      expect(await purchaseFinancialSnapshot(page)).toEqual(before);
      await page.screenshot({ path: testInfo.outputPath('purchase-duplicate-conflict-recoverable.png'), fullPage: true, animations: 'disabled' });
      await dialog.getByRole('alert').getByRole('button', { name: 'Gespeicherten Belegstatus prüfen', exact: true }).click();
      await expect(dialog.getByRole('button', { name: 'Als Ausgabe erfassen', exact: true })).toBeEnabled();
      await openPurchaseDetails(page); await expectBlankPurchaseChoices(page);
      await fillPurchaseDetails(page, 'Synthetischer Dublettenkonflikt'); await confirmPurchaseChoices(page);
      await expect(dialog.getByRole('region', { name: 'Dubletten bewusst prüfen', exact: true }).getByRole('checkbox')).toHaveCount(2);
      await expect(dialog.getByRole('button', { name: 'Zahlung bestätigen und Ausgabe erfassen', exact: true })).toBeDisabled();
      await dialog.getByRole('button', { name: 'Abbrechen · nicht buchen', exact: true }).click();
      expect(await purchaseFinancialSnapshot(page)).toEqual(before);
    } finally { await other.close(); }
  });

  test('keeps unsupported currency, credit notes and partial payments unposted in the review UI', async ({ page }) => {
    test.setTimeout(60_000);
    await signIn(page);
    const before = await purchaseFinancialSnapshot(page);
    let financialPosts = 0;
    page.on('request', request => { if (request.method() === 'POST' && /\/(approve-expense|expenses|incomes)$/.test(new URL(request.url()).pathname)) financialPosts++; });
    for (const fixture of [
      { number: 'BOOKING-UNSUPPORTED-USD', currency: 'USD' },
      { number: 'BOOKING-UNSUPPORTED-CREDIT', typeCode: '381' },
      { number: 'BOOKING-UNSUPPORTED-PARTIAL', payable: '19.00' },
    ]) {
      await uploadPurchaseFixture(page, fixture.number, '', { ...fixture, supported: false });
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Kontakt auswählen / anlegen', exact: true }).click();
      await selectPurchaseSupplier(page, 'E2E explizit geänderter Lieferantenkontakt');
      await expect(dialog.getByRole('button', { name: 'Als Ausgabe erfassen', exact: true })).toBeDisabled();
      await expect(dialog).toContainText(/Nur EUR-Rechnungen|Gutschriften und andere Dokumenttypen|unterstützten Buchungsregeln/);
      expect(await purchaseFinancialSnapshot(page)).toEqual(before);
    }
    expect(financialPosts).toBe(0);
  });

  test('preserves manual PDF and image receipt previews and ordinary expense controls', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await signIn(page); await page.setViewportSize({ width: 1440, height: 1000 });
    const pdf = await PDFDocument.create(); pdf.addPage().drawText('Synthetic receipt only - no real transaction');
    const receipts = [
      { name: 'synthetic-manual-receipt.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) },
      { name: 'synthetic-manual-receipt.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1kAAAAASUVORK5CYII=', 'base64') },
    ];
    for (const receipt of receipts) {
      await page.goto('/dashboard?tab=expenses');
      const entry = page.locator('#expense-entry');
      await expect(entry).toBeHidden();
      await page.getByRole('button', { name: 'Ausgabe erfassen', exact: true }).click();
      await expect(entry).toBeVisible();
      const description = `Synthetischer manueller ${receipt.mimeType === 'application/pdf' ? 'PDF' : 'Bild'}-Beleg`;
      await entry.getByLabel('Beschreibung', { exact: true }).fill(description);
      await entry.getByLabel('Betrag (€)', { exact: true }).fill('12.34');
      await entry.getByLabel('Datum', { exact: true }).fill('2026-10-18');
      await entry.locator('input[type="file"]').setInputFiles(receipt);
      const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/expenses' && response.request().method() === 'POST');
      await entry.getByRole('button', { name: 'Ausgabe speichern', exact: true }).click();
      expect((await created).ok()).toBe(true);
      const row = page.getByRole('row').filter({ hasText: description });
      await expect(row).toBeVisible();
      for (const verb of ['bearbeiten', 'löschen', 'duplizieren']) await expect(row.getByRole('button', { name: `${description} ${verb}`, exact: true })).toBeEnabled();
      await expect(row.getByText('Beleggebunden · schreibgeschützt', { exact: true })).toHaveCount(0);
      const previewResponse = page.waitForResponse(response => response.url().includes('/api/expenses/download?id=') && !response.url().includes('download=true'));
      await row.getByRole('button', { name: `Beleg zu ${description} anzeigen`, exact: true }).click();
      const preview = page.getByRole('dialog', { name: 'Beleg anzeigen', exact: true });
      const response = await previewResponse; expect(response.status()).toBe(200); expect(response.headers()['content-type']).toContain(receipt.mimeType);
      await expect(preview.locator('iframe[title="Beleg Vorschau"]')).toBeVisible();
      await expect(preview.getByText('Vorschau konnte nicht geladen werden', { exact: true })).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`purchase-manual-${receipt.mimeType === 'application/pdf' ? 'pdf' : 'image'}-preview.png`), fullPage: true, animations: 'disabled' });
      // The primitive also renders a close icon with this label; use the visible footer control.
      await preview.locator('[data-slot="dialog-footer"]').getByRole('button', { name: 'Schließen', exact: true }).click();
      await expect(preview).toHaveCount(0);
      await assertDownloadedBytes(page, () => row.getByRole('link', { name: `Beleg zu ${description} herunterladen`, exact: true }).click(), receipt.buffer);
    }
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


test.describe('anonymous access and offer foundation', () => {
  test('keeps access help anonymous, private and keyboard navigable with safe callback roundtrips', async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    const errors: string[] = [];
    const mutations: string[] = [];
    const accountLookups: string[] = [];
    const credentialLeaks: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      const url = new URL(request.url());
      if (/private-access-probe|PRIVATE-ACCESS-PASSWORD-NOT-SENT/.test(request.url() + (request.postData() ?? ''))) credentialLeaks.push(url.pathname);
      if (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method())) mutations.push(url.pathname);
      if (/^\/api\/(?:users|settings|auth\/(?:register|registration-status|reset|forgot|recover))/.test(url.pathname)) accountLookups.push(url.pathname);
    });
    try {
      const target = '/dashboard?tab=invoices&year=2026&status=open';
      await page.goto(`/login?${new URLSearchParams({ callbackUrl: target })}`);
      await expect(page.getByRole('heading', { name: 'Anmelden', exact: true })).toBeVisible();
      await page.getByLabel('E-Mail', { exact: true }).fill('private-access-probe@example.test');
      await page.getByLabel('Passwort', { exact: true }).fill('PRIVATE-ACCESS-PASSWORD-NOT-SENT');
      const help = page.getByRole('link', { name: 'Probleme beim Anmelden?', exact: true });
      // Reach the actual help link from the password field using the keyboard.
      for (let index = 0; index < 8 && !(await help.evaluate(element => element === document.activeElement)); index++) await page.keyboard.press('Tab');
      await expect(help).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/help\/access\?callbackUrl=/);
      expect(new URL(page.url()).searchParams.get('callbackUrl')).toBe(target);
      await expect(page.getByRole('heading', { name: 'Zugangshilfe', exact: true })).toBeVisible();
      await page.getByText('Wiederherstellung und Sicherheit', { exact: true }).click();
      await expect(page.getByRole('main')).toContainText('Identität und Berechtigung unabhängig prüfen');
      await expect(page.getByRole('main')).toContainText('Kein Supportkontakt hinterlegt');
      await expect(page.getByRole('main')).toContainText('Es gibt keinen Resetlink per E-Mail');
      await expect(page.getByRole('main')).toContainText('Sitzungscookies, API-Schlüssel, Einmalcodes');
      await expect(page.getByRole('main').locator('input, textarea, select, form, input[type="file"]')).toHaveCount(0);
      await expect(page.getByRole('main').locator('a[href^="mailto:"], a[href^="tel:"]')).toHaveCount(0);
      for (const width of [360, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `access help overflows at ${width}`).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`access-help-${width}.png`), fullPage: true });
      }
      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Zugangshilfe');
      expect(new URL(page.url()).searchParams.get('callbackUrl')).toBe(target);
      const helpDocument = await page.content();
      expect(helpDocument).not.toMatch(/private-access-probe|PRIVATE-ACCESS-PASSWORD-NOT-SENT|e2e-secret-for-local-tests-only|e2e-bootstrap-token-for-isolated-fixtures-only/);
      const back = page.getByRole('link', { name: 'Zurück zur Anmeldung', exact: true });
      await page.setViewportSize({ width: 360, height: 900 });
      await back.focus();
      await expect(back).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath('access-help-return-focused-360.png'), fullPage: true });
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/login\?callbackUrl=/);
      await expect(page.getByRole('heading', { name: 'Anmelden', exact: true })).toBeVisible();
      expect(new URL(page.url()).searchParams.get('callbackUrl')).toBe(target);
      await expect(page.getByLabel('Passwort', { exact: true })).toHaveValue('');
      await page.goBack();
      await expect(page.getByRole('heading', { name: 'Zugangshilfe', exact: true })).toBeVisible();
      await page.goForward();
      await expect(page.getByRole('heading', { name: 'Anmelden', exact: true })).toBeVisible();

      for (const callback of ['https://outside.example.invalid/steal', '//outside.example.invalid/steal', '/dashboard?tab=invoices&token=PRIVATE-CALLBACK-TOKEN#PRIVATE-FRAGMENT']) {
        await page.goto(`/login?${new URLSearchParams({ callbackUrl: callback })}`);
        await page.getByRole('link', { name: 'Probleme beim Anmelden?', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Zugangshilfe', exact: true })).toBeVisible();
        const expected = callback.startsWith('/dashboard?') ? '/dashboard?tab=invoices' : '/dashboard';
        expect(new URL(page.url()).searchParams.get('callbackUrl')).toBe(expected);
        // Client navigation retains the prior document's inline RSC scripts; verify
        // the active help surface, then the newly requested sanitized document.
        expect(await page.getByRole('main').innerHTML()).not.toMatch(/PRIVATE-CALLBACK-TOKEN|PRIVATE-FRAGMENT|outside\.example\.invalid/);
        await page.reload();
        await expect(page.getByRole('heading', { name: 'Zugangshilfe', exact: true })).toBeVisible();
        expect(await page.content()).not.toMatch(/PRIVATE-CALLBACK-TOKEN|PRIVATE-FRAGMENT|outside\.example\.invalid/);
        await page.getByRole('link', { name: 'Zurück zur Anmeldung', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Anmelden', exact: true })).toBeVisible();
        expect(new URL(page.url()).searchParams.get('callbackUrl')).toBe(expected);
        expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
      }
      expect(await (await page.request.get('/api/auth/session')).json()).toEqual({});
      expect(mutations).toEqual([]);
      expect(accountLookups).toEqual([]);
      expect(credentialLeaks).toEqual([]);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });

  test('shows the unconfigured offer honestly without a preferred model, fake contact or online purchase', async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto('/');
      const compact = page.locator('#angebot');
      await expect(compact).toContainText('Konzept – kein verbindliches Angebot');
      await expect(compact).toContainText('Preis und Betriebsmodell noch offen');
      await compact.getByRole('link', { name: 'Angebot, Kontakt und Quellcode', exact: true }).click();
      await expect(page).toHaveURL(/\/help#angebot$/);
      const offer = page.locator('#angebot');
      await offer.getByText('Angebotsdetails', { exact: true }).click();
      await expect(offer.getByRole('heading', { name: 'Angebot und Verantwortung', exact: true })).toBeVisible();
      for (const copy of ['Konzept – kein verbindliches Angebot', 'concept-unconfigured-v1', 'Keine Softwareversion', 'Anbieter noch nicht bestätigt', 'Betriebsmodell noch offen; keine Variante voreingestellt', 'Preis und Steuerdarstellung noch offen', 'keine rechtliche Freigabe', 'Kein Supportkontakt hinterlegt', 'Apache-2.0', 'Quellcode-Zuordnung zum laufenden Release noch offen', 'Kein Onlineabschluss']) await expect(offer).toContainText(copy);
      await expect(offer.locator('form, input, select, button, a[href^="mailto:"], a[href^="tel:"]')).toHaveCount(0);
      await expect(offer).not.toContainText(/FIKTIVE TESTFIRMA|FICTIONAL-SOURCE|12,34/);
      const repository = offer.getByRole('link', { name: 'Projekt-Repository (keine Laufzeitzuordnung)', exact: true });
      await expect(repository).toHaveAttribute('href', 'https://github.com/storminator89/bivaro-kleinunternehmen');
      await expect(offer.getByRole('link', { name: 'Lizenz im Projekt-Repository', exact: true })).toHaveAttribute('href', 'https://github.com/storminator89/bivaro-kleinunternehmen/blob/main/LICENSE');
      for (const width of [360, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `offer help overflows at ${width}`).toBe(true);
        const clipped = await offer.locator('a').evaluateAll(elements => elements.filter(element => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && (rect.left < -1 || rect.right > window.innerWidth + 1);
        }).map(element => element.textContent));
        expect(clipped).toEqual([]);
        await offer.screenshot({ path: testInfo.outputPath(`offer-concept-${width}.png`) });
      }
      await page.reload();
      await offer.getByText('Angebotsdetails', { exact: true }).click();
      await expect(offer).toContainText('concept-unconfigured-v1');
      const access = offer.getByRole('link', { name: 'Zugang verloren oder Betriebsstörung', exact: true });
      await access.focus();
      await expect(access).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/help\/access$/);
      await expect(page.getByRole('heading', { name: 'Zugangshilfe', exact: true })).toBeVisible();
      await page.getByRole('link', { name: 'Betreiber und Angebot', exact: true }).click();
      await expect(page).toHaveURL(/\/help#angebot$/);
      await expect(offer).toContainText('Konzept – kein verbindliches Angebot');
      await offer.getByRole('link', { name: 'Zugang verloren oder Betriebsstörung', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Zugangshilfe', exact: true })).toBeVisible();
      await page.getByRole('link', { name: 'Zur Aufgabenhilfe', exact: true }).click();
      await expect(page).toHaveURL(/\/help#zugang$/);
      await expect(page.locator('#zugang')).toContainText('Kein Supportkontakt');
      await page.locator('#zugang').getByRole('link', { name: 'Angebot und Kontakt', exact: true }).click();
      await expect(page).toHaveURL(/\/help#angebot$/);
      await expect(offer.getByRole('heading', { name: 'Angebot und Verantwortung', exact: true })).toBeVisible();
      expect(await (await page.request.get('/api/auth/session')).json()).toEqual({});
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
});
