import { expect, test, type Page, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';

// Only the supported hosted runner's temporary database. Every identity and
// invoice in this journey is synthetic; no mail, payments or real data.
async function fixture(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const password = 'SyntheticManualDuration123!';
  const user = await prisma.user.create({ data: { email: `service-times-${randomUUID()}@example.test`, name: 'Synthetic service times', password: await hashPassword(password) } });
  const customer = await prisma.customer.create({ data: { userId: user.id, name: 'Synthetische Projektkundin', email: 'synthetic-buyer@example.test', address: 'Testweg 1', zipCode: '10115', city: 'Berlin' } });
  const other = await prisma.customer.create({ data: { userId: user.id, name: 'Synthetischer anderer Kunde' } });
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(user.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  expect((await page.request.post('/api/settings', { data: {
    companyName: 'Synthetischer Dienstleister', companyAddress: 'Teststraße 1\n10115 Berlin',
    email: 'synthetic@example.test', taxNumber: '123/456/78901',
    fiscalTaxRegime: 'SMALL_BUSINESS', fiscalEffectiveFrom: '2020-01-01',
  } })).ok()).toBe(true);
  return { userId: user.id, customer, other };
}

async function noFinancialWrites(userId: string, invoiceCount = 0) {
  expect(await prisma.invoice.count({ where: { userId } })).toBe(invoiceCount);
  expect(await prisma.income.count({ where: { userId } })).toBe(0);
  expect(await prisma.paymentJournalEvent.count({ where: { userId } })).toBe(0);
  expect(await prisma.expense.count({ where: { userId } })).toBe(0);
}

async function geometry(page: Page, width: number) {
  const height = width === 1440 ? 1000 : 844;
  await page.setViewportSize({ width, height });
  expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width, height });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const dialog = page.getByRole('dialog');
  if (await dialog.count()) await expect.poll(() => dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
}

// Real scrolling and hit-testing: no crops, CSS changes or concealed content.
async function expectReachable(locator: Locator, scroll = true) {
  if (scroll) {
    await locator.scrollIntoViewIfNeeded();
    await locator.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const dialog = element.closest('[role="dialog"]');
      if (dialog) dialog.scrollBy({ top: rect.top - dialog.getBoundingClientRect().top - 24, behavior: 'instant' });
      else {
        const headerBottom = Math.max(0, ...Array.from(document.querySelectorAll('.app-topbar')).map(node => node.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0).map(rect => rect.bottom));
        window.scrollBy({ top: rect.top - headerBottom - 24, behavior: 'instant' });
      }
    });
  }
  await expect.poll(() => locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const dialog = element.closest('[role="dialog"]')?.getBoundingClientRect();
    const headerBottom = Math.max(0, ...Array.from(document.querySelectorAll('.app-topbar')).map(node => node.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0).map(rect => rect.bottom));
    const top = dialog ? Math.max(0, dialog.top) : headerBottom;
    const bottom = dialog ? Math.min(innerHeight, dialog.bottom) : innerHeight;
    const left = dialog ? Math.max(0, dialog.left) : 0;
    const right = dialog ? Math.min(innerWidth, dialog.right) : innerWidth;
    if (rect.width <= 0 || rect.height <= 0 || rect.top < top || rect.bottom > bottom || rect.left < left || rect.right > right) return false;
    return [[rect.left + 4, rect.top + 4], [rect.right - 4, rect.bottom - 4], [rect.left + rect.width / 2, rect.top + rect.height / 2]].every(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return hit !== null && (hit === element || element.contains(hit));
    });
  })).toBe(true);
}

test('manual project time stays explicit through filters, cancel, retry, invoice claim and archive', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const { userId, customer, other } = await fixture(page);
  await geometry(page, 1440);
  await page.route(url => url.pathname === '/api/billing-notes' && url.searchParams.get('customerId') === String(customer.id) && url.searchParams.get('includeLinked') === 'true', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetischer Bestandsladefehler' }) }), { times: 1 });
  await page.goto('/customers');
  const opener = page.getByRole('button', { name: `Leistungsnotizen für ${customer.name}`, exact: true });
  await opener.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: `Leistungsnotizen: ${customer.name}`, exact: true });
  await expect(dialog.getByRole('alert')).toContainText('Synthetischer Bestandsladefehler');
  await expect(dialog.getByRole('button', { name: /Leistungsnotiz hinzufügen/ })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Erneut laden', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Noch keine Leistungen', exact: true })).toBeVisible();
  await expect(dialog.getByText('Keine Rechnung, kein Preis, keine Zahlung wird automatisch angelegt.', { exact: true })).toBeVisible();
  const projectDisclosure = dialog.locator('summary').filter({ hasText: 'Projekte verwalten' });
  await projectDisclosure.focus(); await page.keyboard.press('Enter');
  await dialog.getByLabel('Neues Projekt', { exact: true }).fill('SYNTHETISCH · Website');
  await dialog.getByRole('button', { name: 'Projekt anlegen', exact: true }).click();
  await expect(dialog.getByLabel('Projekt', { exact: true }).locator('option').filter({ hasText: 'SYNTHETISCH · Website' })).toHaveCount(1);
  const project = await prisma.serviceProject.findFirstOrThrow({ where: { userId } });
  await expect(dialog.getByLabel('Projekt', { exact: true })).toHaveValue(String(project.id));
  await projectDisclosure.click();
  await dialog.getByLabel('Beschreibung', { exact: true }).fill('SYNTHETISCH · Konzept');
  await dialog.getByLabel('Leistungsdatum', { exact: true }).fill('2026-10-20');
  await dialog.getByRole('radio', { name: 'Manuelle Dauer', exact: true }).check();
  await dialog.getByLabel('Dauer (HH:MM)', { exact: true }).fill('1,5');
  await expect(dialog.getByText(/Dauer als HH:MM eingeben/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Leistungsnotiz hinzufügen/ })).toBeDisabled();
  await dialog.getByLabel('Dauer (HH:MM)', { exact: true }).fill('01:30');
  await expect(dialog.getByText('01:30 → 1,5 Stunde', { exact: true })).toBeVisible();
  await page.route('**/api/billing-notes', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetischer Speicherkonflikt' }) })
    : route.continue(), { times: 1 });
  await dialog.getByRole('button', { name: /Leistungsnotiz hinzufügen/ }).focus(); await page.keyboard.press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('Synthetischer Speicherkonflikt');
  await expect(dialog.getByLabel('Dauer (HH:MM)', { exact: true })).toHaveValue('01:30');
  await expect(dialog.getByLabel('Beschreibung', { exact: true })).toBeEnabled();
  expect(await prisma.billingNote.count({ where: { userId } })).toBe(0);
  await dialog.getByRole('button', { name: /Leistungsnotiz hinzufügen/ }).click();
  await expect(dialog.getByRole('heading', { name: 'SYNTHETISCH · Konzept', exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Beschreibung', { exact: true })).toBeFocused();
  const timed = await prisma.billingNote.findFirstOrThrow({ where: { userId } });
  expect(timed).toMatchObject({ projectId: project.id, durationMinutes: 90, quantity: 1.5, unit: 'Stunde', invoiceId: null });
  await dialog.getByRole('radio', { name: 'Menge', exact: true }).check();
  await dialog.getByLabel('Projekt', { exact: true }).selectOption('');
  await dialog.getByLabel('Beschreibung', { exact: true }).fill('SYNTHETISCH · Freie Menge');
  await dialog.getByLabel('Leistungsdatum', { exact: true }).fill('2026-10-21');
  await dialog.getByRole('spinbutton', { name: 'Menge', exact: true }).fill('1.5');
  await dialog.getByLabel('Einheit', { exact: true }).selectOption('Stunde');
  await dialog.getByRole('button', { name: /Leistungsnotiz hinzufügen/ }).click();
  await expect(dialog.getByRole('heading', { name: 'SYNTHETISCH · Freie Menge', exact: true })).toBeVisible();
  expect(await prisma.billingNote.findFirstOrThrow({ where: { userId, description: 'SYNTHETISCH · Freie Menge' } })).toMatchObject({ durationMinutes: null, quantity: 1.5, unit: 'Stunde', projectId: null });
  // HTML dl has no Playwright definitionlist role; keep its application label.
  const totals = dialog.locator('dl[aria-label="Summen der gefilterten Leistungen"]');
  await expect(dialog.getByText('Mengen ohne manuelle Dauer zählen nicht als 0 Stunden.', { exact: false })).toBeVisible();
  await expect(totals).toContainText('01:30'); await expect(totals).toContainText('1 Notiz');
  await dialog.getByLabel('Projekt filtern', { exact: true }).selectOption(String(project.id));
  await expect(dialog.getByRole('heading', { name: 'SYNTHETISCH · Freie Menge', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Filter zurücksetzen', exact: true }).click();
  await geometry(page, 1440);
  await dialog.evaluate(element => element.scrollTo({ top: 0, behavior: 'instant' }));
  await expectReachable(dialog.getByRole('heading', { name: 'Leistungsverlauf', exact: true }), false);
  await expectReachable(totals, false);
  await expectReachable(dialog.getByRole('heading', { name: 'SYNTHETISCH · Konzept', exact: true }), false);
  await expectReachable(dialog.getByRole('heading', { name: 'SYNTHETISCH · Freie Menge', exact: true }), false);
  await page.screenshot({ path: testInfo.outputPath('project-services-workbench-desktop-1440.png'), fullPage: false });
  for (const width of [360, 390]) {
    await geometry(page, width);
    await dialog.getByLabel('Status', { exact: true }).selectOption('open');
    await dialog.getByLabel('Von', { exact: true }).fill('2026-10-20');
    await dialog.getByLabel('Bis', { exact: true }).fill('2026-10-20');
    await expect(dialog.getByRole('heading', { name: 'SYNTHETISCH · Konzept', exact: true })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'SYNTHETISCH · Freie Menge', exact: true })).toHaveCount(0);
    for (const control of [dialog.getByLabel('Projekt filtern', { exact: true }), dialog.getByLabel('Status', { exact: true }), dialog.getByLabel('Von', { exact: true }), dialog.getByLabel('Bis', { exact: true }), dialog.getByRole('button', { name: 'Filter zurücksetzen', exact: true })]) await expectReachable(control);
    await expectReachable(totals);
    await geometry(page, width);
    await dialog.getByRole('button', { name: 'Filter zurücksetzen', exact: true }).click();
  }
  await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(opener).toBeFocused();
  // The same customer has distinct responsive opener nodes. Also exercise
  // mobile → desktop and the visible close button, not just Escape.
  await opener.click();
  await geometry(page, 1440);
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(dialog).toBeHidden(); await expect(opener).toBeFocused();
  await noFinancialWrites(userId);

  await page.goto('/dashboard/invoices/new');
  const customerSelect = page.getByRole('combobox', { name: 'Gespeicherten Kunden auswählen', exact: true });
  await page.route('**/api/billing-notes?customerId=*', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetischer Ladefehler' }) }), { times: 1 });
  await customerSelect.selectOption(String(customer.id));
  await expect(page.getByRole('alert').filter({ hasText: 'Synthetischer Ladefehler' })).toBeVisible();
  await page.getByRole('button', { name: 'Erneut laden', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Leistungsnotiz SYNTHETISCH · Konzept übernehmen', exact: true }).focus(); await page.keyboard.press('Space');
  const selection = page.locator('[aria-labelledby="invoice-service-selection-title"]');
  await expect(selection).toContainText('01:30'); await expect(selection).toContainText('0 ohne Zeitangabe');
  const quantityOnly = page.getByRole('checkbox', { name: 'Leistungsnotiz SYNTHETISCH · Freie Menge übernehmen', exact: true });
  await quantityOnly.check();
  await expect(selection).toContainText('1 ohne Zeitangabe');
  await expect(selection).toContainText('Ohne Zeitangabe · 1,5 Stunde');
  await expect(selection).toContainText('01:30');
  await quantityOnly.uncheck();
  await page.getByLabel('Projekt', { exact: true }).selectOption('none');
  await expect(selection).toContainText('1 davon nicht in der aktuellen Liste sichtbar');
  await expect(page.locator('#invoice-item-quantity-0')).toHaveValue('1.5');
  for (const width of [360, 390]) {
    await geometry(page, width);
    for (const control of [page.getByLabel('Projekt', { exact: true }), page.getByLabel('Leistung ab', { exact: true }), page.getByLabel('Leistung bis', { exact: true }), quantityOnly]) await expectReachable(control);
    await expectReachable(selection);
  }
  await expect(selection.getByText(/noch 0,00 € Einzelpreis/)).toBeVisible();
  await expectReachable(selection.getByRole('heading', { name: '1 Leistung ausgewählt', exact: true }), false);
  await expectReachable(selection.getByText(/Manuelle Quelldauer:/), false);
  await expectReachable(selection.getByText(/noch 0,00 € Einzelpreis/), false);
  await expectReachable(selection.getByText(/Quelle: Notiz/), false);
  await expectReachable(selection.getByText(/Aktuelle Position:/), false);
  await page.screenshot({ path: testInfo.outputPath('project-services-selection-mobile-390.png'), fullPage: false });
  await noFinancialWrites(userId);
  expect((await prisma.billingNote.findUniqueOrThrow({ where: { id: timed.id } })).invoiceId).toBeNull();
  await page.getByRole('button', { name: 'Filter zurücksetzen', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Leistungsnotiz SYNTHETISCH · Konzept übernehmen', exact: true })).toBeChecked();
  await customerSelect.selectOption(String(other.id));
  await expect(selection).toHaveCount(0); await expect(page.locator('#invoice-item-description-0')).toHaveValue('');
  await customerSelect.selectOption(String(customer.id));
  await expect(page.getByLabel('Projekt', { exact: true })).toHaveValue('all');
  await expect(page.getByRole('checkbox', { name: 'Leistungsnotiz SYNTHETISCH · Konzept übernehmen', exact: true })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Leistungsnotiz SYNTHETISCH · Konzept übernehmen', exact: true }).check();
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\?tab=invoices/);
  await noFinancialWrites(userId);
  expect((await prisma.billingNote.findUniqueOrThrow({ where: { id: timed.id } })).invoiceId).toBeNull();
  await page.goto('/dashboard/invoices/new');
  await customerSelect.selectOption(String(customer.id));
  await page.getByRole('checkbox', { name: 'Leistungsnotiz SYNTHETISCH · Konzept übernehmen', exact: true }).check();
  await page.getByLabel('Projekt', { exact: true }).selectOption('none');
  await page.reload();
  await expect(customerSelect).toHaveValue('');
  await expect(selection).toHaveCount(0);
  await customerSelect.selectOption(String(customer.id));
  await expect(page.getByLabel('Projekt', { exact: true })).toHaveValue('all');
  await expect(page.getByRole('checkbox', { name: 'Leistungsnotiz SYNTHETISCH · Konzept übernehmen', exact: true })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Leistungsnotiz SYNTHETISCH · Konzept übernehmen', exact: true }).check();
  await page.locator('#invoice-item-price-0').fill('95');
  await expect(selection).toContainText(/142,50\s*€ Positionsnetto/);
  await page.getByRole('combobox', { name: 'Ausgabeformat', exact: true }).selectOption('xml-only');
  await page.getByLabel('Käuferreferenz / Leitweg-ID', { exact: false }).fill('SYNTHETIC-PROJECT-ORDER');
  const savedInvoice = page.waitForResponse(response => new URL(response.url()).pathname === '/api/invoices/upload' && response.request().method() === 'POST');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'XML erstellen', exact: true }).click();
  const saved = await savedInvoice; expect(saved.ok(), await saved.text()).toBe(true);
  const invoice = await saved.json(); await download;
  await noFinancialWrites(userId, 1);
  expect((await prisma.billingNote.findUniqueOrThrow({ where: { id: timed.id } })).invoiceId).toBe(invoice.id);
  const originalResponse = await page.request.get(`/api/invoices/download?id=${invoice.id}`);
  expect(originalResponse.ok()).toBe(true);
  const originalBytes = await originalResponse.body();
  expect(originalBytes.toString('utf8')).toContain('SYNTHETISCH · Konzept');
  expect(originalBytes.toString('utf8')).toContain('>1.5</ram:BilledQuantity>');
  expect(invoice.totalAmount).toBe(142.5);
  await page.goto('/customers'); await opener.click();
  await dialog.getByLabel('Status', { exact: true }).selectOption('linked');
  await expect(dialog.getByRole('heading', { name: 'SYNTHETISCH · Konzept', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Leistungsnotiz SYNTHETISCH · Konzept löschen', exact: true })).toHaveCount(0);
  await projectDisclosure.click();
  await dialog.getByLabel('Bestehendes Projekt', { exact: true }).selectOption(String(project.id));
  await dialog.getByLabel('Projektname', { exact: true }).fill('SYNTHETISCH · Website abgeschlossen');
  await dialog.getByRole('button', { name: 'Umbenennen', exact: true }).click();
  await expect(dialog.getByLabel('Projekt filtern', { exact: true }).locator('option').filter({ hasText: 'SYNTHETISCH · Website abgeschlossen' })).toHaveCount(1);
  expect((await (await page.request.get(`/api/invoices/download?id=${invoice.id}`)).body()).equals(originalBytes)).toBe(true);
  const cancelArchive = page.waitForEvent('dialog').then(async confirm => {
    expect(confirm.message()).toContain('Bisherige Leistungen und Rechnungszuordnungen bleiben erhalten');
    await confirm.dismiss();
  });
  await dialog.getByRole('button', { name: 'Archivieren', exact: true }).click();
  await cancelArchive;
  expect((await prisma.serviceProject.findUniqueOrThrow({ where: { id: project.id } })).archivedAt).toBeNull();
  page.once('dialog', confirm => confirm.accept());
  await dialog.getByRole('button', { name: 'Archivieren', exact: true }).click();
  await expect(dialog.getByLabel('Projekt filtern', { exact: true }).locator('option').filter({ hasText: 'Website abgeschlossen · archiviert' })).toHaveCount(1);
  const afterResponse = await page.request.get(`/api/invoices/download?id=${invoice.id}`);
  expect(afterResponse.ok()).toBe(true);
  const afterBytes = await afterResponse.body();
  expect(afterBytes.equals(originalBytes)).toBe(true);
  await page.reload(); await opener.click();
  await dialog.getByLabel('Status', { exact: true }).selectOption('linked');
  await expect(dialog.getByRole('article').filter({ has: page.getByRole('heading', { name: 'SYNTHETISCH · Konzept', exact: true }) }).getByText('SYNTHETISCH · Website abgeschlossen · archiviert', { exact: true })).toBeVisible();
  expect((await prisma.billingNote.findUniqueOrThrow({ where: { id: timed.id } })).invoiceId).toBe(invoice.id);
  await noFinancialWrites(userId, 1);
});

test('recovers an uncertain manual capture with its original key and never revives a removed receipt', async ({ page }) => {
  test.setTimeout(90_000);
  const { userId, customer } = await fixture(page);
  await geometry(page, 360);
  await page.goto('/customers');
  const opener = page.getByRole('button', { name: `Leistungsnotizen für ${customer.name}`, exact: true });
  await opener.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: `Leistungsnotizen: ${customer.name}`, exact: true });
  await expect(dialog.getByRole('heading', { name: 'Noch keine Leistungen', exact: true })).toBeVisible();
  await dialog.getByLabel('Beschreibung', { exact: true }).fill('SYNTHETISCH · Antwort verloren');
  await dialog.getByLabel('Leistungsdatum', { exact: true }).fill('2026-10-20');
  await dialog.getByRole('radio', { name: 'Manuelle Dauer', exact: true }).check();
  await dialog.getByLabel('Dauer (HH:MM)', { exact: true }).fill('01:30');
  const submitted: Record<string, unknown>[] = [];
  let loseResponse = true;
  let releaseLostResponse!: () => void;
  let reportCommitted!: () => void;
  const lostResponseGate = new Promise<void>(resolve => { releaseLostResponse = resolve; });
  const serverCommitted = new Promise<void>(resolve => { reportCommitted = resolve; });
  await page.route('**/api/billing-notes', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    submitted.push(route.request().postDataJSON());
    if (loseResponse) {
      loseResponse = false;
      const committed = await route.fetch();
      expect(committed.status(), await committed.text()).toBe(201);
      reportCommitted();
      await lostResponseGate;
      await route.abort('failed');
    } else await route.continue();
  });
  const save = dialog.getByRole('button', { name: /Leistungsnotiz hinzufügen/ });
  await save.click();
  await serverCommitted;
  try {
    // The server has committed, but the first browser response is still pending.
    // Escape must not silently discard this in-flight command either.
    const cancelInFlightClose = page.waitForEvent('dialog').then(async confirm => {
      expect(confirm.message()).toContain('Speicherstatus noch unklar');
      await confirm.dismiss();
    });
    await page.keyboard.press('Escape'); await cancelInFlightClose;
    await expect(dialog).toBeVisible();
    await expect(save).toBeDisabled();
    await expect(dialog.getByLabel('Beschreibung', { exact: true })).toBeDisabled();
    expect(await prisma.billingNote.count({ where: { userId } })).toBe(1);
  } finally { releaseLostResponse(); }
  await expect(dialog.getByRole('status').filter({ hasText: 'Speicherstatus unklar.' })).toBeVisible();
  await expect(save).toHaveText('Speicherung prüfen');
  await expect(dialog.getByLabel('Beschreibung', { exact: true })).toHaveValue('SYNTHETISCH · Antwort verloren');
  await expect(dialog.getByLabel('Dauer (HH:MM)', { exact: true })).toHaveValue('01:30');
  for (const control of [dialog.getByLabel('Beschreibung', { exact: true }), dialog.getByLabel('Leistungsdatum', { exact: true }), dialog.getByLabel('Projekt', { exact: true }), dialog.getByLabel('Dauer (HH:MM)', { exact: true }), dialog.getByRole('radio', { name: 'Menge', exact: true })]) await expect(control).toBeDisabled();
  expect(await prisma.billingNote.count({ where: { userId } })).toBe(1);
  expect(submitted).toHaveLength(1);
  expect(submitted[0].captureKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  await noFinancialWrites(userId);
  const cancelClose = page.waitForEvent('dialog').then(async confirm => {
    expect(confirm.message()).toContain('Speicherstatus noch unklar');
    await confirm.dismiss();
  });
  await page.keyboard.press('Escape'); await cancelClose;
  await expect(dialog).toBeVisible();
  await expect(save).toHaveText('Speicherung prüfen');
  await expectReachable(save);
  const replay = page.waitForResponse(response => new URL(response.url()).pathname === '/api/billing-notes' && response.request().method() === 'POST');
  await save.focus(); await page.keyboard.press('Enter');
  expect((await replay).status()).toBe(200);
  await expect(dialog.getByRole('heading', { name: 'SYNTHETISCH · Antwort verloren', exact: true })).toHaveCount(1);
  await expect(dialog.getByLabel('Beschreibung', { exact: true })).toBeFocused();
  await expect(dialog.getByLabel('Beschreibung', { exact: true })).toBeEnabled();
  expect(submitted).toHaveLength(2);
  expect(submitted[1]).toEqual(submitted[0]);
  expect(await prisma.billingNote.count({ where: { userId } })).toBe(1);
  const captured = await prisma.billingNote.findFirstOrThrow({ where: { userId } });
  expect(captured).toMatchObject({ durationMinutes: 90, quantity: 1.5, captureKey: submitted[0].captureKey, deletedAt: null, invoiceId: null });
  const conflict = await page.request.post('/api/billing-notes', { data: { ...submitted[0], description: 'SYNTHETISCH · Widersprechender Befehl' } });
  expect(conflict.status()).toBe(409);
  expect(await prisma.billingNote.count({ where: { userId } })).toBe(1);

  const remove = dialog.getByRole('button', { name: 'Leistungsnotiz SYNTHETISCH · Antwort verloren löschen', exact: true });
  const cancelRemoval = page.waitForEvent('dialog').then(async confirm => {
    expect(confirm.message()).toContain('Der Erfassungsnachweis bleibt erhalten');
    await confirm.dismiss();
  });
  await remove.click(); await cancelRemoval;
  await expect(dialog.getByRole('heading', { name: 'SYNTHETISCH · Antwort verloren', exact: true })).toBeVisible();
  page.once('dialog', confirm => confirm.accept());
  await remove.click();
  await expect(dialog.getByRole('heading', { name: 'Noch keine Leistungen', exact: true })).toBeVisible();
  expect((await prisma.billingNote.findUniqueOrThrow({ where: { id: captured.id } })).deletedAt).not.toBeNull();
  const removedReplay = await page.request.post('/api/billing-notes', { data: submitted[0] });
  expect(removedReplay.status()).toBe(409);
  expect(await prisma.billingNote.count({ where: { userId } })).toBe(1);
  expect(await (await page.request.get(`/api/billing-notes?customerId=${customer.id}&includeLinked=true`)).json()).toEqual([]);
  await dialog.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Noch keine Leistungen', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(opener).toBeFocused();
  await page.reload(); await opener.click();
  await expect(dialog.getByRole('heading', { name: 'Noch keine Leistungen', exact: true })).toBeVisible();
  await dialog.getByLabel('Beschreibung', { exact: true }).fill('SYNTHETISCH · Neuer Erfassungsbefehl');
  await dialog.getByRole('radio', { name: 'Manuelle Dauer', exact: true }).check();
  await dialog.getByLabel('Dauer (HH:MM)', { exact: true }).fill('00:59');
  await save.click();
  await expect(dialog.getByRole('heading', { name: 'SYNTHETISCH · Neuer Erfassungsbefehl', exact: true })).toBeVisible();
  expect(submitted).toHaveLength(3);
  expect(submitted[2].captureKey).not.toBe(submitted[0].captureKey);
  expect(await prisma.billingNote.findFirstOrThrow({ where: { userId, deletedAt: null } })).toMatchObject({ durationMinutes: 59, quantity: 0.983333333333, unit: 'Stunde' });
  expect(await prisma.billingNote.count({ where: { userId } })).toBe(2);
  await noFinancialWrites(userId);
  await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
  await page.goto('/dashboard/invoices/new');
  await page.getByRole('combobox', { name: 'Gespeicherten Kunden auswählen', exact: true }).selectOption(String(customer.id));
  await page.getByRole('checkbox', { name: 'Leistungsnotiz SYNTHETISCH · Neuer Erfassungsbefehl übernehmen', exact: true }).check();
  await page.locator('#invoice-item-price-0').fill('0.30');
  const pricing = page.locator('[aria-labelledby="invoice-service-selection-title"]');
  await expect(pricing).toContainText('00:59 → 0,983333333333 Stunde');
  await expect(pricing).toContainText(/0,29\s*€ Positionsnetto/);
  await expect(pricing).toContainText('Cent-Abweichungen möglich');
  await expectReachable(pricing.getByText(/Aktuelle Position:/));
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await noFinancialWrites(userId);
});
