import { expect, test, type Locator, type Page, type Request, type Route, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';

// Execute only in the existing hosted acceptance runner and its temporary DB.
// No production tenant, local browser, external service or capture-only CSS.
test.skip(process.env.CI !== 'true', 'Hosted customer redesign acceptance only.');

type Theme = 'light' | 'dark';
type Kind = 'customers' | 'articles';
const shapes = [{ width: 1440, height: 1000 }, { width: 375, height: 812 }] as const;
const customerName = 'Synthetische Werkstatt für langlebige Anlagen und technische Instandhaltung';

async function account(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const password = 'SyntheticCustomerRedesign123!';
  const user = await prisma.user.create({ data: { email: `customer-redesign-${randomUUID()}@example.test`, name: 'Synthetic customer redesign', password: await hashPassword(password), role: 'USER' } });
  const customer = await prisma.customer.create({ data: {
    userId: user.id, name: customerName, contactPerson: 'Alexandra Beispiel aus der technischen Projektleitung',
    email: 'technische-projektleitung-und-instandhaltung@example.test', phone: '+49 (30) 123456789',
    address: 'Synthetischer Werkstattweg 123, Gebäude für technische Anlagen', zipCode: '00123', city: 'Synthetischer Musterort',
    taxNumber: 'DE123456789', paymentTermDays: 30, internalNote: '', noteVisibility: 'EDITOR', createdAt: new Date('2026-01-01T12:00:00Z'),
  } });
  await prisma.customer.createMany({ data: [
    { userId: user.id, name: 'Synthetischer Kontakt ohne optionale Angaben', createdAt: new Date('2026-01-01T12:00:00Z') },
    { userId: user.id, name: `SYNTHETISCH-${'Werkstatt'.repeat(9)}`, email: 'werkstatt@example.test', city: 'Musterort', createdAt: new Date('2026-01-01T12:00:00Z') },
  ] });
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(user.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return { user, customer };
}

async function theme(page: Page, value: Theme) {
  const dark = await page.locator('html').evaluate(element => element.classList.contains('dark'));
  if (dark !== (value === 'dark')) await page.getByRole('button', { name: value === 'dark' ? 'Dunkles Farbschema aktivieren' : 'Helles Farbschema aktivieren', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${value}\\b`));
}

async function capture(page: Page, info: TestInfo, name: string, fullPage = true) {
  expect(info.retry).toBe(0);
  await page.evaluate(async () => {
    await window.document.fonts.ready;
    window.scrollTo({ top: 0, behavior: 'instant' });
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expect.poll(() => page.evaluate(() => window.document.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
  const surface = await page.evaluate(() => {
    const root = window.document.documentElement, body = window.document.body;
    return { innerWidth, innerHeight, scrollY, documentClientWidth: root.clientWidth, documentScrollWidth: root.scrollWidth,
      bodyClientWidth: body.clientWidth, bodyScrollWidth: body.scrollWidth,
      width: Math.max(root.scrollWidth, body.scrollWidth, root.offsetWidth, body.offsetWidth, root.clientWidth, body.clientWidth),
      height: Math.max(root.scrollHeight, body.scrollHeight, root.offsetHeight, body.offsetHeight, root.clientHeight, body.clientHeight),
      disclosures: [...window.document.querySelectorAll('details')].map(node => ({ label: node.querySelector('summary')?.textContent?.trim(), open: node.open })),
      internalScroll: [...window.document.querySelectorAll('[role="dialog"], [aria-label="Alle Importzeilen"]')].map(node => ({
        name: node.getAttribute('aria-label') || node.getAttribute('aria-labelledby'), scrollTop: node.scrollTop, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight,
      })),
    };
  });
  expect(surface.scrollY).toBe(0);
  expect(surface.documentScrollWidth).toBeLessThanOrEqual(surface.documentClientWidth);
  expect(surface.bodyScrollWidth).toBeLessThanOrEqual(surface.bodyClientWidth);
  const height = fullPage ? surface.height : surface.innerHeight;
  expect(height).toBeLessThanOrEqual(8000);
  expect(surface.innerWidth * height * 4).toBeLessThanOrEqual(16 * 1024 * 1024);
  const png = await page.screenshot({ path: info.outputPath(name), fullPage });
  const pngWidth = png.readUInt32BE(16), pngHeight = png.readUInt32BE(20);
  expect(pngWidth).toBe(fullPage ? surface.width : surface.innerWidth);
  expect(pngHeight).toBe(height);
  expect(png.length).toBeLessThanOrEqual(5 * 1024 * 1024);
  process.stdout.write(`Customer redesign capture proof: ${JSON.stringify({ name, url: page.url(), viewport: page.viewportSize(), fullPage, ...surface, pngWidth, pngHeight, encodedBytes: png.length })}\n`);
}

function visibleButton(page: Page, name: string) {
  return page.getByRole('button', { name, exact: true }).filter({ visible: true });
}

async function insideViewport(locator: Locator) {
  return locator.evaluate(element => {
    const rect = element.getBoundingClientRect(), dialog = element.closest('[role="dialog"]')?.getBoundingClientRect();
    return rect.top >= Math.max(0, dialog?.top ?? 0) && rect.bottom <= Math.min(innerHeight, dialog?.bottom ?? innerHeight);
  });
}

async function editScreens(page: Page, info: TestInfo, width: number) {
  await visibleButton(page, `${customerName} bearbeiten`).click();
  const dialog = page.getByRole('dialog', { name: 'Kunden bearbeiten', exact: true });
  await expect(dialog.locator('#name')).toHaveValue(customerName);
  await expect(dialog.locator('#customer-payment-term')).toHaveValue('30');
  await expect.poll(() => dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.evaluate(element => element.scrollTo({ top: 0, behavior: 'instant' }));
  await expect.poll(() => dialog.evaluate(element => element.scrollTop)).toBe(0);
  await expect.poll(() => insideViewport(dialog.getByRole('heading', { name: 'Kunden bearbeiten', exact: true }))).toBe(true);
  await expect.poll(() => insideViewport(dialog.locator('#name'))).toBe(true);
  if (width === 1440) {
    await page.setViewportSize({ width, height: 1080 });
    await capture(page, info, 'customer-redesign-edit-light-1440.png', false);
    // Planned optional twentieth image only if the real closed-notes desktop
    // form does not fit. Never shrink, inject styles, or crop the missing fields.
    const save = dialog.getByRole('button', { name: 'Änderungen speichern', exact: true });
    if (!await insideViewport(save)) {
      await dialog.evaluate(element => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }));
      await expect.poll(() => insideViewport(save)).toBe(true);
      await capture(page, info, 'customer-redesign-edit-bottom-light-1440.png', false);
    }
  } else {
    await capture(page, info, 'customer-redesign-edit-top-light-375.png', false);
    await dialog.getByText('Interner Hinweis', { exact: true }).click();
    await dialog.locator('#internalNote').fill('Synthetischer interner Hinweis, nur zur Darstellung und nicht gespeichert.');
    await dialog.locator('#noteVisibility').selectOption('BOTH');
    await dialog.evaluate(element => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }));
    await expect(dialog.locator('details')).toHaveAttribute('open', '');
    await expect.poll(() => insideViewport(dialog.locator('#internalNote'))).toBe(true);
    await expect.poll(() => insideViewport(dialog.locator('#noteVisibility'))).toBe(true);
    await expect.poll(() => insideViewport(dialog.getByRole('button', { name: 'Änderungen speichern', exact: true }))).toBe(true);
    await capture(page, info, 'customer-redesign-edit-bottom-light-375.png', false);
  }
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.setViewportSize({ width, height: width === 1440 ? 1000 : 812 });
}

async function directoryFeedback(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/customers', async route => { await gate; await route.continue(); }, { times: 1 });
  try {
    await page.goto('/customers');
    await expect(page.locator('.customer-directory').getByRole('status')).toContainText('Kunden werden geladen');
  } finally { release(); }
  await expect(page.getByRole('heading', { name: customerName, exact: true }).filter({ visible: true })).toBeVisible();
  await page.route('**/api/customers', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic customer read interruption' }) }), { times: 1 });
  await page.goto('/customers');
  await expect(page.locator('.customer-directory').getByRole('alert')).toContainText('Kunden konnten nicht geladen werden. Bitte versuchen Sie es erneut.');
  await page.getByRole('button', { name: 'Erneut laden', exact: true }).click();
  await expect(page.getByRole('heading', { name: customerName, exact: true }).filter({ visible: true })).toBeVisible();
  for (const width of [320, 768, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(visibleButton(page, `${customerName} bearbeiten`)).toBeVisible();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

function csv(kind: Kind) {
  if (kind === 'customers') return 'Name;E-Mail;Straße;PLZ;Stadt;Ansprechpartner;Telefon;Steuernummer\nSynthetischer CSV-Kontakt;csv@example.test;Synthetischer Importweg 1;00123;Musterort;Alex Beispiel;+49 30 123456;DE123456789\nSynthetischer CSV-Kontakt;csv@example.test;Synthetischer Importweg 1;00123;Musterort;Alex Beispiel;+49 30 123456;DE123456789\nSynthetischer fehlerhafter Kontakt;keine-email;;;;;;';
  return 'Name;Beschreibung;Einheit;Preis;Preisbasis;Steuersatz\nSynthetische CSV-Wartung;Synthetische Wartung vor Ort mit ausführlicher Dokumentation;Stunde;119,00;GROSS;19\nSynthetische CSV-Wartung;Doppelte Bezeichnung;Stunde;75,00;NET;0\nSynthetischer unbekannter Preis;Kein unbekannter Nullpreis;Stück;;NET;0';
}

async function importScreens(page: Page, info: TestInfo, kind: Kind, value: Theme, width: number) {
  const label = kind === 'customers' ? 'customer' : 'article';
  const isPreviewPost = (request: Request) => {
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/data-import') return false;
    const payload = request.postDataJSON() as { action?: unknown; kind?: unknown } | null;
    return payload?.action === 'preview' && payload.kind === kind;
  };
  await page.goto(`/customers/import${kind === 'articles' ? '?kind=articles' : ''}`);
  await expect(page.getByRole('heading', { name: 'Datei auswählen', exact: true })).toBeVisible();
  await expect(page.getByLabel('Datenart', { exact: true })).toHaveValue(kind);
  if (kind === 'articles' && value === 'light' && width === 1440) {
    await page.getByText('Preise und Steuersätze', { exact: true }).click();
    await capture(page, info, 'csv-redesign-article-setup-light-1440.png');
  }
  await page.getByLabel('CSV-Datei auswählen', { exact: true }).setInputFiles({ name: 'synthetic-redesign.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(kind), 'utf8') });
  await expect(page.getByRole('heading', { name: 'Spalten zuordnen', exact: true })).toBeVisible();
  if (kind === 'customers' && value === 'light' && width === 375) await capture(page, info, 'csv-redesign-customer-mapping-light-375.png');
  if (kind === 'articles' && value === 'dark' && width === 1440) await capture(page, info, 'csv-redesign-article-mapping-dark-1440.png');
  if (kind === 'customers' && value === 'light' && width === 1440) {
    const failPreview = (route: Route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetische Vorschau ist vorübergehend nicht erreichbar.' }) });
    await page.route('**/api/data-import', failPreview, { times: 1 });
    try {
      const [failedPreview] = await Promise.all([
        page.waitForResponse(response => isPreviewPost(response.request()), { timeout: 5000 }),
        page.getByRole('button', { name: 'Vorschau prüfen', exact: true }).click(),
      ]);
      expect(failedPreview.status()).toBe(503);
      expect(await failedPreview.finished()).toBeNull();
      await expect(page.getByRole('list', { name: 'Importschritte', exact: true }).locator('..').getByRole('alert')).toContainText('Synthetische Vorschau ist vorübergehend nicht erreichbar.');
      await expect(page.getByRole('button', { name: 'Vorschau prüfen', exact: true })).toBeEnabled();
      await expect(page.locator('fieldset')).toBeEnabled();
      await expect(page.getByLabel('Datenart', { exact: true })).toBeEnabled();
      await expect(page.getByLabel('CSV-Datei auswählen', { exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Vorschau wird geprüft …', exact: true })).toHaveCount(0);
    } finally {
      // Settle and remove the first interception before observing the retry.
      await page.unroute('**/api/data-import', failPreview);
    }
  }
  if (kind === 'customers' && value === 'light' && width === 1440) {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let held = false;
    let continued: Promise<void> | undefined;
    const holdPreview = async (route: Route) => {
      if (!isPreviewPost(route.request())) { await route.fallback(); return; }
      held = true;
      continued = gate.then(() => route.continue());
      await continued;
    };
    // Hold every preview request until all busy controls are inspected atomically.
    // A one-shot route can be consumed before a later request reaches the guard.
    await page.route('**/api/data-import', holdPreview);
    try {
      // Observe the genuine mouse-triggered preview POST, not a stale error or
      // an unrelated recovery GET; retain the independent held-handler proof.
      const [retriedPreview] = await Promise.all([
        page.waitForRequest(isPreviewPost, { timeout: 5000 }),
        page.getByRole('button', { name: 'Vorschau prüfen', exact: true }).click(),
      ]);
      expect(retriedPreview.postDataJSON()).toMatchObject({ action: 'preview', kind });
      await expect.poll(() => held).toBe(true);
      await expect(page.getByRole('button', { name: 'Vorschau wird geprüft …', exact: true })).toBeDisabled();
      const locked = await page.locator('fieldset').evaluate(fieldset => {
        const kind = fieldset.querySelector('#import-kind');
        const file = fieldset.querySelector('#import-file');
        return { fieldset: fieldset.matches(':disabled'), kind: kind?.matches(':disabled'),
          file: file?.matches(':disabled'), label: fieldset.querySelector('label[for="import-file"]')?.textContent };
      });
      expect(locked).toEqual({ fieldset: true, kind: true, file: true, label: 'CSV-Datei auswählen' });
    } finally {
      release();
      // Finish the intercepted request before removing interception; otherwise
      // Chromium can auto-continue it while this callback is still resuming.
      await continued;
      await page.unroute('**/api/data-import', holdPreview);
    }
  } else await page.getByRole('button', { name: 'Vorschau prüfen', exact: true }).click();
  const region = page.getByRole('region', { name: `Vorschau: ${kind === 'customers' ? 'Kunden' : 'Artikel und Leistungen'}`, exact: true });
  await expect(region).toBeVisible();
  await expect(region.getByRole('button', { name: '1 Datensätze jetzt importieren', exact: true })).toBeDisabled();
  const rows = region.locator('[aria-label="Alle Importzeilen"]');
  const row = rows.locator('details').nth(value === 'light' ? 0 : width === 1440 ? 1 : 2);
  await row.locator('summary').click();
  if (value === 'dark' && width === 1440) await region.getByText('Importregeln', { exact: true }).click();
  if (value === 'dark' && width === 375) await rows.evaluate(element => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }));
  await expect(region.getByRole('status').first()).toContainText('Noch nichts gespeichert');
  if (width === 375) {
    await expect.poll(() => rows.evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true);
    const finalLabel = kind === 'customers' ? 'Steuernummer' : value === 'light' ? 'Gespeicherter Netto-Einzelpreis' : 'Steuersatz 0 / 7 / 19';
    const finalValue = kind === 'customers' ? value === 'light' ? 'DE123456789' : 'Nicht angegeben' : value === 'light' ? '100,00 € · 19 % Steuer (Quelle)' : '0';
    const finalField = row.locator('dl > div').filter({ has: page.getByText(finalLabel, { exact: true }) });
    await expect(finalField).toHaveCount(1);
    await expect(finalField.locator('dd')).toHaveText(finalValue);
    await finalField.scrollIntoViewIfNeeded();
    await expect(finalField).toBeVisible();
    await expect(finalField).toBeInViewport({ ratio: 1 });
  }
  await capture(page, info, `csv-redesign-${label}-preview-${value}-${width}.png`);
  await region.getByRole('checkbox').check();
  await expect(region.getByRole('button', { name: '1 Datensätze jetzt importieren', exact: true })).toBeEnabled();
  await region.getByRole('button', { name: '1 Datensätze jetzt importieren', exact: true }).click();
  await expect(page.getByRole('heading', { name: `1 ${kind === 'customers' ? 'Kunden' : 'Artikel und Leistungen'} übernommen`, exact: true })).toBeVisible();
  if (kind === 'customers' && value === 'dark' && width === 375) await capture(page, info, 'csv-redesign-result-dark-375.png');
  await page.getByRole('button', { name: 'Weitere Datei importieren', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Datei auswählen', exact: true })).toBeVisible();
}

for (const value of ['light', 'dark'] as const) for (const { width, height } of shapes) {
  test(`customer directory and CSV redesign full-screen ${value} ${width}`, async ({ page }, info) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height });
    const { user, customer } = await account(page);
    try {
      await theme(page, value);
      await page.goto('/customers');
      await expect(page.getByRole('heading', { name: customerName, exact: true }).filter({ visible: true })).toBeVisible();
      await expect(page.locator('.customer-directory').getByText('Musterort', { exact: true }).filter({ visible: true })).toBeVisible();
      for (const link of await page.locator('.customer-directory').getByRole('link').filter({ visible: true }).all()) {
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await capture(page, info, `customer-redesign-directory-${value}-${width}.png`);
      if (value === 'light') await editScreens(page, info, width);
      // Filtering, selection and a cancelled destructive action remain read-only.
      await page.getByRole('textbox', { name: 'Kunden suchen', exact: true }).fill('SYNTHETISCH-KEIN-TREFFER');
      await expect(page.getByRole('heading', { name: 'Keine Kunden gefunden', exact: true })).toBeVisible();
      await page.getByRole('textbox', { name: 'Kunden suchen', exact: true }).fill('');
      await page.goto(`/customers?customer=${customer.id}`);
      await expect(page.getByText('Ausgewählter Kunde', { exact: true })).toBeVisible();
      const confirmation = page.waitForEvent('dialog');
      const deleting = visibleButton(page, `${customerName} löschen`).click();
      const prompt = await confirmation;
      expect(prompt.type()).toBe('confirm');
      expect(prompt.message()).toBe('Sind Sie sicher, dass Sie diesen Kunden löschen möchten? Dies kann zu Inkonsistenzen bei verknüpften Einnahmen/Rechnungen führen.');
      await prompt.dismiss(); await deleting;
      expect(await prisma.customer.count({ where: { userId: user.id } })).toBe(3);
      await page.getByRole('link', { name: 'Alle Kunden anzeigen', exact: true }).click();
      await expect(page).toHaveURL(/\/customers$/);
      if (value === 'light' && width === 1440) await directoryFeedback(page);
      await importScreens(page, info, 'customers', value, width);
      await importScreens(page, info, 'articles', value, width);
      expect(await prisma.customer.count({ where: { userId: user.id } })).toBe(4);
      expect(await prisma.serviceArticle.count({ where: { userId: user.id } })).toBe(1);
      const stored = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
      expect(stored.internalNote).toBe(''); expect(stored.noteVisibility).toBe('EDITOR'); expect(stored.paymentTermDays).toBe(30);
      expect(await prisma.invoice.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.income.count({ where: { userId: user.id } })).toBe(0);
    } finally {
      await prisma.dataImportBatch.deleteMany({ where: { userId: user.id } });
      await prisma.serviceArticle.deleteMany({ where: { userId: user.id } });
      await prisma.customer.deleteMany({ where: { userId: user.id } });
      await prisma.auditLog.deleteMany({ where: { userId: user.id } });
      await prisma.settings.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
}
