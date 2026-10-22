import { expect, test, type Dialog, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// Authored for the supported hosted acceptance runner only. Its fresh temporary
// database and tenant files are synthetic; do not point this at a deployed tenant.
// No SMTP, payment, reminder, legal issuance or external delivery is exercised.
test.use({ timezoneId: 'Europe/Berlin' });

async function fixture(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticPaymentTerms123!';
  const user = await prisma.user.create({ data: { email: `payment-terms-${randomUUID()}@example.test`, name: 'Synthetic payment terms', password: await hashPassword(password), role: 'USER' } });
  const customer = await prisma.customer.create({ data: { userId: user.id, name: 'SYNTHETISCH · Firmenvorgabe', email: 'synthetic-buyer@example.test', address: 'Testweg 1', zipCode: '10115', city: 'Berlin', paymentTermDays: null } });
  const immediate = await prisma.customer.create({ data: { userId: user.id, name: 'SYNTHETISCH · Sofort', email: 'synthetic-zero@example.test', address: 'Testweg 2', zipCode: '10115', city: 'Berlin', paymentTermDays: 0 } });
  const fourteen = await prisma.customer.create({ data: { userId: user.id, name: 'SYNTHETISCH · Vierzehn', email: 'synthetic-fourteen@example.test', address: 'Testweg 3', zipCode: '10115', city: 'Berlin', paymentTermDays: 14 } });
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(user.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  const settings = await page.request.post('/api/settings', { data: {
    companyName: 'SYNTHETISCH · Zahlungsziel', companyAddress: 'Teststraße 1\n10115 Berlin',
    email: 'synthetic@example.test', telephone: '+49 301234567', taxNumber: '123/456/78901',
    iban: 'DE89370400440532013000', fiscalTaxRegime: 'SMALL_BUSINESS', fiscalEffectiveFrom: '2020-01-01', paymentTermDays: null,
  } });
  expect(settings.ok(), await settings.text()).toBe(true);
  return { userId: user.id, customer, immediate, fourteen };
}

async function geometry(page: Page, width: number) {
  const height = width === 1440 ? 1000 : 844;
  await page.setViewportSize({ width, height });
  expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width, height });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const dialog = page.getByRole('dialog');
  if (await dialog.count()) await expect.poll(() => dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
}

// Use actual scrolling/hit testing; never conceal controls or alter their CSS.
async function reachable(locator: Locator) {
  // Resizing can reflow the editor and update native scroll anchoring after the
  // first scroll. Re-align on each observation; never accept an occluded control.
  await expect.poll(async () => {
    await locator.scrollIntoViewIfNeeded();
    await locator.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const dialog = element.closest('[role="dialog"]');
      if (dialog) dialog.scrollBy({ top: rect.top - dialog.getBoundingClientRect().top - 32, behavior: 'instant' });
      else {
        const header = Math.max(0, ...Array.from(document.querySelectorAll('.app-topbar')).map(node => node.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0).map(rect => rect.bottom));
        window.scrollBy({ top: rect.top - header - 32, behavior: 'instant' });
      }
    });
    return locator.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const dialog = element.closest('[role="dialog"]')?.getBoundingClientRect();
      const header = Math.max(0, ...Array.from(document.querySelectorAll('.app-topbar')).map(node => node.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0).map(rect => rect.bottom));
      const clip = { left: Math.max(0, dialog?.left ?? 0), right: Math.min(innerWidth, dialog?.right ?? innerWidth), top: dialog ? Math.max(0, dialog.top) : header, bottom: Math.min(innerHeight, dialog?.bottom ?? innerHeight) };
      if (rect.width <= 0 || rect.height <= 0 || rect.left < clip.left || rect.right > clip.right || rect.top < clip.top || rect.bottom > clip.bottom) return `Outside visible bounds: ${JSON.stringify({ rect: rect.toJSON(), clip })}`;
      // Rounded/native inputs have transparent bounding-box corners. Sample
      // beyond their computed corner radii, not a fixed diagonal 3px from a
      // fractional edge. The complete rectangle must still pass the bounds
      // check above; all three actual interior hit tests remain mandatory.
      const style = getComputedStyle(element);
      const cornerInset = (radius: string) => {
        const [horizontal, vertical = horizontal] = radius.split(/\s+/);
        const pixels = (value: string, extent: number) => value.endsWith('%') ? Number.parseFloat(value) * extent / 100 : Number.parseFloat(value);
        return [Math.min(rect.width / 2, Math.max(3, pixels(horizontal, rect.width) + 1)), Math.min(rect.height / 2, Math.max(3, pixels(vertical, rect.height) + 1))];
      };
      const [leftInset, topInset] = cornerInset(style.borderTopLeftRadius);
      const [rightInset, bottomInset] = cornerInset(style.borderBottomRightRadius);
      const hits = [[rect.left + leftInset, rect.top + topInset], [rect.right - rightInset, rect.bottom - bottomInset], [rect.left + rect.width / 2, rect.top + rect.height / 2]].map(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return { x, y, reachable: hit !== null && (element === hit || element.contains(hit)), hit: hit ? `${hit.tagName}#${hit.id}.${hit.className}` : null };
      });
      return hits.every(hit => hit.reachable) ? 'reachable' : `Occluded control: ${JSON.stringify({ rect: rect.toJSON(), clip, hits })}`;
    });
  }).toBe('reachable');
}

async function noFinancialWrites(userId: string, invoices = 0) {
  expect(await prisma.invoice.count({ where: { userId } })).toBe(invoices);
  expect(await prisma.income.count({ where: { userId } })).toBe(0);
  expect(await prisma.expense.count({ where: { userId } })).toBe(0);
  expect(await prisma.paymentJournalEvent.count({ where: { userId } })).toBe(0);
  expect(await prisma.emailOutbox.count({ where: { userId } })).toBe(0);
  expect(await prisma.reminder.count({ where: { userId } })).toBe(0);
}

async function companyTerm(page: Page, days: number | null) {
  const response = await page.request.post('/api/settings', { data: { paymentTermDays: days } });
  expect(response.ok(), await response.text()).toBe(true);
}

async function customerTerm(page: Page, customer: { id: number; name: string }, days: number | null) {
  const response = await page.request.put('/api/customers', { data: { id: customer.id, name: customer.name, paymentTermDays: days } });
  expect(response.ok(), await response.text()).toBe(true);
}

async function prepareXml(page: Page, customerId: number) {
  await page.goto('/dashboard/invoices/new');
  await page.getByRole('combobox', { name: 'Gespeicherten Kunden auswählen', exact: true }).selectOption(String(customerId));
  await page.locator('#date').fill('2026-03-28');
  await page.locator('#invoice-item-description-0').fill('SYNTHETISCH · Zahlungszielprüfung');
  await page.locator('#invoice-item-price-0').fill('12.34');
  await page.getByRole('combobox', { name: 'Ausgabeformat', exact: true }).selectOption('xml-only');
  await page.getByLabel('Käuferreferenz / Leitweg-ID', { exact: false }).fill('SYNTHETIC-PAYMENT-TERM');
}

async function createXml(page: Page): Promise<{ id: number }> {
  let rejectDialog!: (error: Error) => void;
  const unexpectedDialog = new Promise<never>((_, reject) => { rejectDialog = reject; });
  const observeDialog = (dialog: Dialog) => {
    const message = dialog.message().slice(0, 1200);
    void dialog.dismiss().catch(() => undefined);
    rejectDialog(new Error(`Unexpected XML creation dialog: ${message}`));
  };
  page.on('dialog', observeDialog);
  try {
    const [saved] = await Promise.race([
      Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === '/api/invoices/upload' && response.request().method() === 'POST'),
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'XML erstellen', exact: true }).click(),
      ]), unexpectedDialog,
    ]);
    expect(saved.ok(), await saved.text()).toBe(true);
    const result = await saved.json();
    expect(Number.isSafeInteger(result.id)).toBe(true);
    return result;
  } finally { page.off('dialog', observeDialog); }
}

for (const width of [1440, 360, 390]) {
  test(`company and customer payment terms distinguish blank from zero, reject invalid input and survive reload at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const { userId, customer } = await fixture(page);
    await geometry(page, width);
    await page.goto('/settings');
    const company = page.getByLabel('Zahlungsziel für neue Rechnungen (Tage)', { exact: true });
    const companyForm = page.locator('form').filter({ has: company });
    const save = companyForm.getByRole('button', { name: 'Speichern', exact: true });
    await expect(company).toHaveValue('');
    await expect(company).toHaveAttribute('min', '0'); await expect(company).toHaveAttribute('max', '365'); await expect(company).toHaveAttribute('step', '1');
    for (const invalid of ['-1', '1.5', '366']) {
      await company.fill(invalid); await save.click();
      expect(await company.evaluate(element => (element as HTMLInputElement).validity.valid)).toBe(false);
      expect((await prisma.settings.findUniqueOrThrow({ where: { userId } })).paymentTermDays).toBeNull();
    }
    await company.fill('0');
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/settings' && response.request().method() === 'POST');
    await save.focus(); await page.keyboard.press('Enter'); expect((await saved).ok()).toBe(true);
    await expect(companyForm.getByRole('status')).toContainText('Firmendaten gespeichert');
    await page.reload(); await expect(company).toHaveValue('0');
    expect((await prisma.settings.findUniqueOrThrow({ where: { userId } })).paymentTermDays).toBe(0);
    await company.fill('30'); await companyForm.getByRole('button', { name: 'Verwerfen', exact: true }).click(); await expect(company).toHaveValue('0');
    await company.fill(''); await save.click(); await expect(companyForm.getByRole('status')).toContainText('Firmendaten gespeichert');
    await page.reload(); await expect(company).toHaveValue('');
    expect((await prisma.settings.findUniqueOrThrow({ where: { userId } })).paymentTermDays).toBeNull();
    await geometry(page, width); await reachable(company); await company.focus(); await expect(company).toBeFocused();
    if (width === 1440) await page.screenshot({ path: testInfo.outputPath('payment-terms-settings-1440.png'), fullPage: false });

    await page.goto('/customers');
    const open = page.getByRole('button', { name: `${customer.name} bearbeiten`, exact: true }).filter({ visible: true });
    await open.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Kunden bearbeiten', exact: true });
    const term = dialog.getByLabel('Abweichendes Zahlungsziel (Tage)', { exact: true });
    const customerSave = dialog.getByRole('button', { name: 'Änderungen speichern', exact: true });
    await expect(term).toHaveValue('');
    for (const invalid of ['-1', '1.5', '366']) {
      await term.fill(invalid); await customerSave.click();
      expect(await term.evaluate(element => (element as HTMLInputElement).validity.valid)).toBe(false);
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).paymentTermDays).toBeNull();
    }
    await term.fill('0'); await geometry(page, width); await reachable(term); await term.focus(); await expect(term).toBeFocused();
    await reachable(customerSave); await customerSave.focus(); await page.keyboard.press('Enter'); await expect(dialog).toBeHidden();
    await page.reload(); await open.click(); await expect(term).toHaveValue('0');
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).paymentTermDays).toBe(0);
    await term.fill('25'); await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click(); await expect(dialog).toBeHidden();
    await open.click(); await expect(term).toHaveValue('0');
    await term.fill('33'); await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
    await open.focus(); await page.keyboard.press('Enter'); await expect(term).toHaveValue('0');
    await term.fill(''); await customerSave.click(); await expect(dialog).toBeHidden();
    await page.reload(); await open.click(); await expect(term).toHaveValue('');
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).paymentTermDays).toBeNull();
    await page.keyboard.press('Escape');
    // The server rejects coercion as well as the browser's range/step failures.
    for (const invalid of [-1, 1.5, 366, '', '0']) {
      expect((await page.request.post('/api/settings', { data: { paymentTermDays: invalid } })).status()).toBe(400);
      expect((await page.request.put('/api/customers', { data: { id: customer.id, name: customer.name, paymentTermDays: invalid } })).status()).toBe(400);
    }
    expect((await prisma.settings.findUniqueOrThrow({ where: { userId } })).paymentTermDays).toBeNull();
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).paymentTermDays).toBeNull();
    await noFinancialWrites(userId);
  });
}

test('calendar-day suggestions and explicit manual dates survive customer changes, refresh failure, cancel and history', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const { userId, customer, immediate, fourteen } = await fixture(page);
  await geometry(page, 1440); await page.goto('/dashboard/invoices/new');
  const select = page.getByRole('combobox', { name: 'Gespeicherten Kunden auswählen', exact: true });
  const date = page.locator('#date'); const due = page.locator('#due-date'); const source = page.locator('#payment-term-source');
  const reapply = page.getByRole('button', { name: 'Vorgabe erneut anwenden', exact: true });
  await select.selectOption(String(customer.id)); await expect(source).toHaveText('Standard: 14 Kalendertage');
  // Literal expectations are independent of the production date helper, including
  // leap day, month/year rollover and both Europe/Berlin DST transitions.
  for (const [invoiceDate, dueDate] of [['2024-02-20', '2024-03-05'], ['2026-01-31', '2026-02-14'], ['2026-03-28', '2026-04-11'], ['2026-10-24', '2026-11-07'], ['2026-12-31', '2027-01-14']]) {
    await date.fill(invoiceDate); await expect(due).toHaveValue(dueDate);
  }
  await companyTerm(page, 30); await reapply.click(); await expect(source).toHaveText('Firmenvorgabe: 30 Kalendertage'); await expect(due).toHaveValue('2027-01-30');
  await select.selectOption(String(immediate.id)); await expect(source).toHaveText('Kundenvorgabe: 0 Kalendertage'); await expect(due).toHaveValue('2026-12-31');
  await date.fill('2024-02-29'); await expect(due).toHaveValue('2024-02-29');
  await select.selectOption(String(fourteen.id)); await expect(source).toHaveText('Kundenvorgabe: 14 Kalendertage'); await expect(due).toHaveValue('2024-03-14');
  await due.fill('2024-04-30'); await expect(source).toContainText('Manuell festgelegt');
  await date.fill('2024-03-31'); await expect(due).toHaveValue('2024-04-30');
  const cancelOverwrite = page.waitForEvent('dialog').then(async confirm => { expect(confirm.type()).toBe('confirm'); expect(confirm.message()).toContain('manuell bearbeitet'); await confirm.dismiss(); });
  await select.selectOption(String(immediate.id)); await cancelOverwrite;
  await expect(select).toHaveValue(String(immediate.id)); await expect(due).toHaveValue('2024-04-30'); await expect(source).toContainText('Manuell');
  const acceptOverwrite = page.waitForEvent('dialog').then(async confirm => { expect(confirm.message()).toContain('Vorgabe des neuen Kunden'); await confirm.accept(); });
  await select.selectOption(String(customer.id)); await acceptOverwrite;
  await expect(source).toHaveText('Firmenvorgabe: 30 Kalendertage'); await expect(due).toHaveValue('2024-04-30');
  await page.getByRole('button', { name: 'Fälligkeit beibehalten', exact: true }).click(); await expect(source).toContainText('Manuell');
  await companyTerm(page, 5); await customerTerm(page, customer, 2); await date.fill('2024-04-01'); await expect(due).toHaveValue('2024-04-30');
  await page.route('**/api/settings', route => route.request().method() === 'GET' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetischer Ladefehler' }) }) : route.continue(), { times: 1 });
  await reapply.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'aktuelle Vorgabe konnte nicht geladen werden' })).toBeVisible();
  await expect(due).toHaveValue('2024-04-30'); await expect(source).toContainText('Manuell'); await expect(reapply).toBeEnabled();
  await date.fill('9999-12-31'); await due.fill('9999-12-31'); await reapply.click();
  await expect(page.getByRole('alert').filter({ hasText: 'außerhalb des unterstützten Datumsbereichs' })).toBeVisible();
  await expect(due).toHaveValue('9999-12-31'); await expect(source).toContainText('Manuell');
  await date.fill('2024-04-01'); await due.fill('2024-04-30');
  await reapply.click(); await expect(source).toHaveText('Kundenvorgabe: 2 Kalendertage'); await expect(due).toHaveValue('2024-04-03');
  for (const width of [1440, 360, 390]) {
    await geometry(page, width); await reachable(due); await due.focus(); await expect(due).toBeFocused();
    if (width === 390) await page.screenshot({ path: testInfo.outputPath('payment-terms-editor-390.png'), fullPage: false });
    await reachable(reapply);
  }
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click(); await expect(page).toHaveURL(/\/dashboard\?tab=invoices/);
  await noFinancialWrites(userId);
  await page.goto('/dashboard/invoices/new'); await expect(select).toHaveValue(''); await expect(source).toHaveText('Firmenvorgabe: 5 Kalendertage');
  await page.goBack(); await expect(page).toHaveURL(/\/dashboard\?tab=invoices/); await page.goForward(); await expect(select).toHaveValue('');
  await noFinancialWrites(userId);
});

test('deferred default refreshes cannot overwrite newer manual/date/customer choices or a reopened editor', async ({ page }) => {
  test.setTimeout(120_000);
  const { userId, customer, immediate } = await fixture(page);
  const settingsBody = await (await page.request.get('/api/settings')).json();
  const customersBody = await (await page.request.get('/api/customers')).json();
  for (const action of ['manual', 'date', 'customer', 'reopen'] as const) {
    await page.goto('/dashboard/invoices/new');
    const select = page.getByRole('combobox', { name: 'Gespeicherten Kunden auswählen', exact: true });
    const date = page.locator('#date'); const due = page.locator('#due-date'); const source = page.locator('#payment-term-source');
    await select.selectOption(String(customer.id)); await date.fill('2026-10-22');
    await expect(source).toHaveText('Standard: 14 Kalendertage'); await expect(due).toHaveValue('2026-11-05');
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    let captured = 0; let fulfilled = 0;
    await page.route(/\/api\/(?:settings|customers)(?:\?.*)?$/, async route => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      captured += 1;
      await held;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(new URL(route.request().url()).pathname === '/api/settings' ? settingsBody : customersBody) });
      fulfilled += 1;
    }, { times: 2 });
    await page.getByRole('button', { name: 'Vorgabe erneut anwenden', exact: true }).click();
    await expect.poll(() => captured).toBe(2);
    let expectedDate = '2026-10-22'; let expectedDue = '2026-11-05'; let expectedCustomer = String(customer.id);
    if (action === 'manual') { expectedDue = '2027-01-05'; await due.fill(expectedDue); }
    if (action === 'date') { expectedDate = '2026-12-31'; expectedDue = '2027-01-14'; await date.fill(expectedDate); }
    if (action === 'customer') { expectedCustomer = String(immediate.id); expectedDue = expectedDate; await select.selectOption(expectedCustomer); }
    if (action === 'reopen') {
      await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
      await page.goto('/dashboard/invoices/new');
      expectedDate = '2028-02-29'; expectedDue = '2028-03-15'; expectedCustomer = String(immediate.id);
      await select.selectOption(expectedCustomer); await date.fill(expectedDate); await due.fill(expectedDue);
    }
    await expect(date).toHaveValue(expectedDate); await expect(due).toHaveValue(expectedDue);
    release(); await expect.poll(() => fulfilled).toBe(2);
    await expect(date).toHaveValue(expectedDate); await expect(due).toHaveValue(expectedDue); await expect(select).toHaveValue(expectedCustomer);
    await expect(source).toContainText(action === 'manual' || action === 'reopen' ? 'Manuell' : action === 'customer' ? 'Kundenvorgabe: 0' : 'Standard: 14');
    await expect(page.getByRole('button', { name: 'Vorgabe erneut anwenden', exact: true })).toBeEnabled();
    await noFinancialWrites(userId);
  }
});

for (const staleSource of ['COMPANY', 'CUSTOMER'] as const) {
  test(`stale ${staleSource.toLowerCase()} default requires deliberate refresh, snapshots XML and permits a conscious manual date`, async ({ page }) => {
    test.setTimeout(120_000);
    const { userId, customer } = await fixture(page);
    await geometry(page, 1440);
    if (staleSource === 'COMPANY') await companyTerm(page, 14); else await customerTerm(page, customer, 14);
    await prepareXml(page, customer.id);
    const due = page.locator('#due-date'); const source = page.locator('#payment-term-source');
    await expect(due).toHaveValue('2026-04-11'); await expect(source).toContainText(staleSource === 'COMPANY' ? 'Firmenvorgabe' : 'Kundenvorgabe');
    if (staleSource === 'COMPANY') await companyTerm(page, 21); else await customerTerm(page, customer, 21);
    let downloads = 0;
    const countDownload = () => { downloads += 1; }; page.on('download', countDownload);
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const alert = page.waitForEvent('dialog').then(async dialog => { expect(dialog.type()).toBe('alert'); expect(dialog.message()).toContain('Zahlungszielvorgabe wurde geändert'); await dialog.accept(); });
        const failed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/invoices/upload' && response.request().method() === 'POST');
        await page.getByRole('button', { name: 'XML erstellen', exact: true }).click(); expect((await failed).status()).toBe(409); await alert;
        await expect(due).toHaveValue('2026-04-11'); await expect(page.locator('#invoice-item-description-0')).toHaveValue('SYNTHETISCH · Zahlungszielprüfung');
        await expect(page.getByRole('button', { name: 'XML erstellen', exact: true })).toBeEnabled();
        expect(downloads).toBe(0); await noFinancialWrites(userId);
      }
    } finally { page.off('download', countDownload); }
    await page.getByRole('button', { name: 'Vorgabe erneut anwenden', exact: true }).click(); await expect(due).toHaveValue('2026-04-18');
    const invoice = await createXml(page);
    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    const selection = (stored.parsedData as Record<string, unknown>).paymentTermSelection;
    expect(selection).toEqual({ version: 1, source: staleSource, days: 21, invoiceDate: '2026-03-28', dueDate: '2026-04-18', customerId: customer.id });
    expect(stored.dueDate?.toISOString().slice(0, 10)).toBe('2026-04-18');
    const original = await page.request.get(`/api/invoices/download?id=${invoice.id}`); expect(original.ok()).toBe(true);
    const originalBytes = await original.body(); expect(originalBytes.toString('utf8')).toContain('>20260418<'); expect(originalBytes.toString('utf8')).not.toContain('paymentTermSelection');
    await noFinancialWrites(userId, 1);

    await prepareXml(page, customer.id); await page.locator('#date').fill('2026-06-01'); await due.fill('2026-06-05'); await expect(source).toContainText('Manuell');
    // A second editor changing either default must not reject or rewrite an
    // explicitly manual choice, nor mutate the already archived document.
    await companyTerm(page, 365); await customerTerm(page, customer, 0);
    await expect(due).toHaveValue('2026-06-05');
    const manual = await createXml(page);
    const manualStored = await prisma.invoice.findUniqueOrThrow({ where: { id: manual.id } });
    expect((manualStored.parsedData as Record<string, unknown>).paymentTermSelection).toEqual({ version: 1, source: 'MANUAL', days: null, invoiceDate: '2026-06-01', dueDate: '2026-06-05', customerId: customer.id });
    expect((await (await page.request.get(`/api/invoices/download?id=${invoice.id}`)).body()).equals(originalBytes)).toBe(true);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).parsedData).toEqual(stored.parsedData);
    await noFinancialWrites(userId, 2);
  });
}

test('template loading and quote conversion never import an old payment-term selection or overwrite a manual date', async ({ page }) => {
  test.setTimeout(120_000);
  const { userId, customer } = await fixture(page); await companyTerm(page, 7); await geometry(page, 390);
  const oldSelection = { version: 1, source: 'MANUAL', days: null, invoiceDate: '2020-01-01', dueDate: '2020-02-01', customerId: customer.id };
  const sourceData = { taxMode: 'small-business', items: [{ description: 'SYNTHETISCH · Vorlagenposition', quantity: 1, unitPrice: 12.34, unit: 'Stück', taxRate: 0 }], date: '2020-01-01', dueDate: '2020-02-01', paymentTermSelection: oldSelection };
  const templateResponse = await page.request.post('/api/invoice-templates', { data: { name: 'SYNTHETISCH · Alte Datumswerte', data: sourceData } });
  expect(templateResponse.ok(), await templateResponse.text()).toBe(true); const template = await templateResponse.json();
  await page.goto('/dashboard/invoices/new'); await page.locator('#date').fill('2026-10-24'); await expect(page.locator('#due-date')).toHaveValue('2026-10-31');
  const drawer = page.locator('summary').filter({ hasText: 'Rechnungsvorlagen' }); await drawer.focus(); await page.keyboard.press('Enter');
  const templateSelect = page.getByRole('combobox', { name: 'Rechnungsvorlage auswählen', exact: true });
  await templateSelect.selectOption(String(template.id)); await expect(page.locator('#invoice-item-description-0')).toHaveValue('SYNTHETISCH · Vorlagenposition');
  await expect(page.locator('#date')).toHaveValue('2026-10-24'); await expect(page.locator('#due-date')).toHaveValue('2026-10-31'); await expect(page.locator('#payment-term-source')).toHaveText('Firmenvorgabe: 7 Kalendertage');
  await page.locator('#due-date').fill('2026-11-30'); await templateSelect.selectOption(''); await templateSelect.selectOption(String(template.id));
  await expect(page.locator('#due-date')).toHaveValue('2026-11-30'); await expect(page.locator('#payment-term-source')).toContainText('Manuell');
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click(); await noFinancialWrites(userId);
  expect((await prisma.invoiceTemplate.findUniqueOrThrow({ where: { id: template.id } })).data).toEqual(sourceData);

  const pdf = await PDFDocument.create(); pdf.addPage();
  const quoteData = { ...sourceData }; delete (quoteData as Partial<typeof sourceData>).paymentTermSelection;
  const quoteResponse = await page.request.post('/api/quotes', { data: { fileName: 'synthetic-payment-terms-quote.pdf', quoteNumber: 'SYNTHETIC-PAYMENT-TERMS-QUOTE', quoteDate: '2020-01-01', validUntil: '2020-02-01', customerId: customer.id, totalAmount: 12.34, parsedData: quoteData, pdfBytes: await pdf.saveAsBase64() } });
  expect(quoteResponse.ok(), await quoteResponse.text()).toBe(true); const quote = await quoteResponse.json();
  expect((await page.request.put('/api/quotes', { data: { id: quote.id, status: 'ACCEPTED' } })).ok()).toBe(true);
  const quoteBefore = await prisma.invoice.findUniqueOrThrow({ where: { id: quote.id } });
  const originalQuote = await page.request.get(`/api/quotes/download?id=${quote.id}&download=true`); expect(originalQuote.ok()).toBe(true); const quoteBytes = await originalQuote.body();
  await page.goto('/dashboard?tab=quotes');
  const quoteCard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'SYNTHETIC-PAYMENT-TERMS-QUOTE', exact: true }) });
  await expect(quoteCard).toBeVisible();
  await quoteCard.getByRole('button', { name: 'In Rechnung', exact: true }).click();
  await page.getByRole('dialog', { name: 'Rechnungsentwurf prüfen?', exact: true }).getByRole('button', { name: 'Entwurf prüfen', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Rechnung erstellen', exact: true });
  await expect(editor.locator('#invoice-item-description-0')).toHaveValue('SYNTHETISCH · Vorlagenposition');
  await expect(editor.getByRole('combobox', { name: 'Gespeicherten Kunden auswählen', exact: true })).toHaveValue(String(customer.id));
  await editor.locator('#date').fill('2024-02-29'); await expect(editor.locator('#due-date')).toHaveValue('2024-03-07'); await expect(editor.locator('#payment-term-source')).toHaveText('Firmenvorgabe: 7 Kalendertage');
  await geometry(page, 390); await reachable(editor.locator('#due-date'));
  await page.keyboard.press('Escape'); await expect(editor).toBeHidden(); await expect(page).toHaveURL(/tab=quotes/);
  expect((await prisma.invoice.findUniqueOrThrow({ where: { id: quote.id } })).parsedData).toEqual(quoteBefore.parsedData);
  expect((await (await page.request.get(`/api/quotes/download?id=${quote.id}&download=true`)).body()).equals(quoteBytes)).toBe(true);
  expect(await prisma.invoice.count({ where: { userId, convertedFromQuoteId: quote.id } })).toBe(0);
  await noFinancialWrites(userId, 1);
});
