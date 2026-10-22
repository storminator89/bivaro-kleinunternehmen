import { expect, test, type Locator, type Page, type Request, type Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// Run solely through the supported isolated E2E fixture runner.
// A synthetic delayed 503 is NOT PDF/A,
// real-renderer, font, logo, QR or final-byte conformance evidence.
const renderRejection = 'Synthetic render rejection before any issuance write';
const lockedMessage = 'Rechnung wird erstellt. Angaben bleiben bis zum Abschluss gesperrt.';
const editorPath = '/dashboard/invoices/new';
const financialPath = /^\/api\/(?:invoices|incomes|expenses|cashbook|cash-books|payments|service-billing|email)(?:\/|$)/u;

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function account(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticOwnInvoiceLock123!';
  const user = await prisma.user.create({ data: {
    email: `own-invoice-lock-${randomUUID()}@example.test`, name: 'Synthetic issuance lock',
    role: 'USER', password: await hashPassword(password),
  } });
  await prisma.settings.create({ data: {
    userId: user.id, companyName: 'Synthetic lock issuer', companyAddress: 'Synthetic Road 1\n10115 Berlin',
    email: 'lock-issuer@example.test', telephone: '+49 000 000', taxNumber: '123/456/78901',
    iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', bankName: 'Synthetic bank',
    fiscalTaxRegime: 'STANDARD', fiscalEffectiveFrom: '2020-01-01', fiscalConfirmedAt: new Date('2026-10-01T12:00:00Z'),
  } });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(user.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/u);
  return user.id;
}

async function financialSnapshot(userId: string) {
  return {
    invoices: await prisma.invoice.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    counters: await prisma.invoiceNumberCounter.findMany({ where: { userId }, orderBy: [{ type: 'asc' }, { year: 'asc' }] }),
    incomes: await prisma.income.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    expenses: await prisma.expense.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    payments: await prisma.paymentJournalEvent.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    cash: await prisma.cashTransaction.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    outbox: await prisma.emailOutbox.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    templates: await prisma.invoiceTemplate.count({ where: { userId } }),
  };
}

async function installSyntheticRoutes(page: Page) {
  const received = deferred(), delivery = deferred();
  const renderBodies: Array<{ preview: boolean; source: Record<string, unknown> }> = [];
  const mutationAttempts: string[] = [];
  const routeFailures: string[] = [];
  const alerts: string[] = [];
  page.on('dialog', async dialog => { alerts.push(dialog.message()); await dialog.dismiss(); });
  const handler = async (route: Route) => {
    const request = route.request(), url = new URL(request.url());
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (url.pathname === '/api/invoices/render' && request.method() === 'POST') {
      const body = request.postDataJSON() as { preview: boolean; source: Record<string, unknown> };
      renderBodies.push(body);
      if (!body.preview) { received.release(); await delivery.promise; }
      try { await json({ error: renderRejection }, 503); }
      catch (error) { routeFailures.push(error instanceof Error ? error.message : 'Route delivery failed'); }
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method()) && (financialPath.test(url.pathname) || url.pathname.startsWith('/api/invoice-templates'))) {
      mutationAttempts.push(`${request.method()} ${url.pathname}`);
      await json({ error: 'Synthetic guard: unexpected write must not reach the server' }, 503);
      return;
    }
    if (request.method() === 'GET' && url.pathname === '/api/customers') {
      await json([{ id: 117042, name: 'Synthetic lock buyer', address: 'Buyer Road 2', zipCode: '10115', city: 'Berlin', email: 'lock-buyer@example.test' }]);
      return;
    }
    if (request.method() === 'GET' && url.pathname === '/api/invoice-templates') {
      await json([{ id: 117001, name: 'Synthetic lock template', data: {
        taxMode: 'standard', notes: 'Frozen synthetic notes', includeQRCode: true,
        items: [{ description: 'Frozen synthetic service', quantity: 2, unitPrice: 40, unit: 'Stunde', taxRate: 19 }],
      } }]);
      return;
    }
    if (request.method() === 'GET' && url.pathname === '/api/service-articles') {
      await json([{ id: 117003, name: 'Synthetic catalogue addition', description: 'Must not be applied during issuance', unit: 'Stunde', unitPriceCents: '7500', sourcePriceCents: '7500', sourcePriceBasis: 'NET', taxRate: '19' }]);
      return;
    }
    if (request.method() === 'GET' && url.pathname === '/api/customers/117042/price-history') {
      await json({ entries: [{ invoiceId: 117999, invoiceNumber: 'SYNTHETIC-HISTORY', invoiceDate: '2026-10-01', description: 'Frozen synthetic service', unit: 'Stunde', unitPrice: 55, taxRate: 19, taxCategory: 'S', currency: 'EUR' }] });
      return;
    }
    if (request.method() === 'GET' && url.pathname === '/api/billing-notes') { await json([]); return; }
    await route.continue();
  };
  await page.route('**/api/**', handler);
  return { received, delivery, renderBodies, mutationAttempts, routeFailures, alerts, cleanup: () => page.unroute('**/api/**', handler) };
}

const form = (page: Page) => page.locator('fieldset[aria-label="Rechnungsangaben"]');

async function openReadyEditor(page: Page) {
  const defaultNumber = page.waitForResponse(response => new URL(response.url()).pathname === '/api/invoices/next-number');
  await page.goto(editorPath);
  expect((await defaultNumber).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Neue Rechnung', exact: true })).toBeVisible();
  const fields = form(page);
  await fields.locator('details.invoice-template-drawer > summary').click();
  await fields.locator('select[aria-label="Rechnungsvorlage auswählen"]').selectOption('117001');
  await fields.locator('select[aria-label="Gespeicherten Kunden auswählen"]').selectOption('117042');
  await fields.locator('#invoice-number').fill(`LOCK-${randomUUID().slice(0, 8)}`);
  await fields.locator('#date').fill('2026-10-22');
  await fields.locator('#due-date').fill('2026-11-05');
  await fields.locator('#delivery-date').fill('2026-10-21');
  await fields.getByRole('button', { name: 'Aus Artikelkatalog übernehmen', exact: true }).click();
  await expect(fields.locator('button[aria-label="Synthetic catalogue addition als Position übernehmen"]')).toBeVisible();
  await expect(fields.locator('button[aria-label^="Preis übernehmen:"]')).toHaveCount(1);
  await expect(fields.getByRole('button', { name: 'PDF erstellen', exact: true })).toBeEnabled();
  return fields;
}

async function values(fields: Locator) {
  return fields.locator('input, select, textarea').evaluateAll(elements => elements.map(element => {
    const control = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    return { id: control.id, label: control.getAttribute('aria-label'), value: control.value, checked: control instanceof HTMLInputElement ? control.checked : null };
  }));
}

async function availability(fields: Locator) {
  return fields.locator('input, select, textarea, button').evaluateAll(elements => elements.map(element => ({
    id: element.id, label: element.getAttribute('aria-label'), disabled: element.matches(':disabled'),
  })));
}

async function assertLocked(page: Page, fields: Locator) {
  await expect(fields).toBeDisabled();
  await expect(fields).toHaveAttribute('inert', '');
  await expect(fields).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('status').filter({ hasText: lockedMessage })).toBeVisible();
  // Inert descendants are intentionally absent from the accessibility tree.
  for (const control of await fields.locator('input, select, textarea, button').all()) await expect(control).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Live-Vorschau', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Zu den Rechnungen', exact: true })).toBeDisabled();
}

test('freezes every invoice source/action during one delayed render and retains/unlocks it after a terminal rejection', async ({ page }) => {
  test.setTimeout(90_000);
  const userId = await account(page), routes = await installSyntheticRoutes(page);
  try {
    const fields = await openReadyEditor(page), beforeValues = await values(fields), beforeAvailability = await availability(fields), before = await financialSnapshot(userId);
    const summary = fields.locator('details.invoice-template-drawer');
    await fields.getByRole('button', { name: 'PDF erstellen', exact: true }).click();
    await routes.received.promise;
    await assertLocked(page, fields);

    for (const selector of [
      'button[aria-label="Ausgewählte Vorlage löschen"]',
      'button[aria-label="Synthetic catalogue addition als Position übernehmen"]',
      'button[aria-label^="Preis übernehmen:"]',
    ]) await fields.locator(selector).dispatchEvent('click');
    await fields.locator('button').filter({ hasText: 'Als Vorlage speichern' }).dispatchEvent('click');
    await fields.locator('button').filter({ hasText: 'Position hinzufügen' }).dispatchEvent('click');
    await fields.locator('button').filter({ hasText: 'Erstelle PDF' }).dispatchEvent('click');
    await fields.locator('button').filter({ hasText: 'Abbrechen' }).dispatchEvent('click');
    await page.getByRole('button', { name: 'Zu den Rechnungen', exact: true }).dispatchEvent('click');
    await page.getByRole('button', { name: 'Live-Vorschau', exact: true }).dispatchEvent('click');
    await summary.locator('summary').dispatchEvent('click');
    await fields.locator('a[href="/customers/articles"]').dispatchEvent('click');
    await page.keyboard.press('Escape');
    await page.mouse.click(4, 4);
    await fields.locator('#invoice-item-description-0').evaluate(element => (element as HTMLElement).focus());
    await page.keyboard.type('Must not edit an inert invoice');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    expect(await fields.evaluate(element => element.contains(document.activeElement))).toBe(false);

    await expect(page).toHaveURL(new RegExp(`${editorPath}$`));
    expect(await values(fields)).toEqual(beforeValues);
    await expect(fields.locator('.invoice-line')).toHaveCount(1);
    expect(routes.renderBodies).toHaveLength(1);
    expect(routes.renderBodies[0].preview).toBe(false);
    expect(routes.mutationAttempts).toEqual([]);
    expect(await financialSnapshot(userId)).toEqual(before);

    const responded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/invoices/render');
    routes.delivery.release();
    expect((await responded).status()).toBe(503);
    await expect.poll(() => routes.alerts).toContain(renderRejection);
    await expect(fields).not.toBeDisabled();
    await expect(fields).not.toHaveAttribute('inert', '');
    await expect(fields).toHaveAttribute('aria-busy', 'false');
    expect(await values(fields)).toEqual(beforeValues);
    expect(await availability(fields)).toEqual(beforeAvailability);
    for (const selector of ['#invoice-number', '#invoice-item-description-0', '#invoice-item-quantity-0', '#invoice-item-unit-0', '#invoice-item-price-0', '#includeQRCode', '#notes', '#invoice-output-mode']) {
      await expect(fields.locator(selector)).toBeEnabled();
    }
    await expect(fields.locator('button[aria-label^="Preis übernehmen:"]')).toBeEnabled();
    await expect(fields.locator('button[aria-label="Synthetic catalogue addition als Position übernehmen"]')).toBeEnabled();
    await expect(fields.locator('button[aria-label="Ausgewählte Vorlage löschen"]')).toBeEnabled();
    await expect(fields.getByRole('button', { name: 'PDF erstellen', exact: true })).toBeEnabled();
    expect(routes.renderBodies).toHaveLength(1);
    expect(routes.mutationAttempts).toEqual([]);
    expect(routes.routeFailures).toEqual([]);
    expect(await financialSnapshot(userId)).toEqual(before);
    await fields.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\?tab=invoices$/u);
  } finally { routes.delivery.release(); await routes.cleanup(); await prisma.$disconnect(); }
});

test('locks template-save children and discards a delayed old response after client unmount/reopen without stale upload', async ({ page }) => {
  test.setTimeout(90_000);
  const userId = await account(page), routes = await installSyntheticRoutes(page);
  try {
    const fields = await openReadyEditor(page);
    await fields.getByRole('button', { name: 'Als Vorlage speichern', exact: true }).click();
    await fields.getByLabel('Name der neuen Rechnungsvorlage', { exact: true }).fill('Synthetic unsaved template');
    const before = await financialSnapshot(userId);
    await fields.getByRole('button', { name: 'PDF erstellen', exact: true }).click();
    await routes.received.promise;
    await assertLocked(page, fields);
    await expect(fields.locator('input[aria-label="Name der neuen Rechnungsvorlage"]')).toBeDisabled();
    await expect(fields.locator('button').filter({ hasText: /^Vorlage speichern$/u })).toBeDisabled();
    await fields.locator('button').filter({ hasText: /^Vorlage speichern$/u }).dispatchEvent('click');
    expect(routes.mutationAttempts).toEqual([]);
    expect(await financialSnapshot(userId)).toEqual(before);

    // Deliberate route replacement is distinct from the blocked in-editor Back
    // action: the unmounted editor must never issue/upload from a late result.
    await page.locator('aside a[href="/dashboard?tab=invoices"]').first().click();
    await expect(page).toHaveURL(/\/dashboard\?tab=invoices$/u);
    await page.getByRole('button', { name: 'Rechnung erstellen', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${editorPath}$`));
    const reopened = form(page);
    await expect(reopened).not.toBeDisabled();
    await expect(reopened.locator('#invoice-item-description-0')).toHaveValue('');
    await reopened.locator('#notes').fill('Fresh reopened editor must survive the old response');
    const reopenedValues = await values(reopened);
    const responded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/invoices/render');
    routes.delivery.release();
    const response = await responded;
    expect(response.status()).toBe(503);
    expect(await response.finished()).toBeNull();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

    expect(await values(reopened)).toEqual(reopenedValues);
    await expect(reopened).not.toBeDisabled();
    expect(routes.alerts).toEqual([]);
    expect(routes.renderBodies).toHaveLength(1);
    expect(routes.renderBodies[0].preview).toBe(false);
    expect(routes.mutationAttempts).toEqual([]);
    expect(routes.routeFailures).toEqual([]);
    expect(await financialSnapshot(userId)).toEqual(before);
  } finally { routes.delivery.release(); await routes.cleanup(); await prisma.$disconnect(); }
});

test('discards a payment-term refresh started before issuance and permits an explicit fresh reapply after rejection', async ({ page }) => {
  test.setTimeout(90_000);
  const userId = await account(page), routes = await installSyntheticRoutes(page);
  const refreshReceived = deferred(), refreshDelivery = deferred();
  const writes: string[] = [];
  const recordWrite = (request: Request) => {
    if (!['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
  };
  let refreshRequests = 0;
  const settings = await prisma.settings.findUniqueOrThrow({ where: { userId } });
  const changedSettings = { ...settings, companyName: 'Explicitly refreshed synthetic issuer', paymentTermDays: 30 };
  const refreshHandler = async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Unexpected settings mutation' }) });
      return;
    }
    refreshRequests += 1;
    if (refreshRequests === 1) { refreshReceived.release(); await refreshDelivery.promise; }
    try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(changedSettings) }); }
    catch (error) { routes.routeFailures.push(error instanceof Error ? error.message : 'Refresh delivery failed'); }
  };

  try {
    const fields = await openReadyEditor(page), beforeValues = await values(fields), before = await financialSnapshot(userId);
    await page.route('**/api/settings', refreshHandler);
    page.on('request', recordWrite);
    await fields.getByRole('button', { name: 'Vorgabe erneut anwenden', exact: true }).click();
    await refreshReceived.promise;
    await expect(fields.getByRole('button', { name: 'Vorgabe wird geladen …', exact: true })).toBeDisabled();
    await fields.getByRole('button', { name: 'PDF erstellen', exact: true }).click();
    await routes.received.promise;
    await assertLocked(page, fields);
    expect(routes.renderBodies).toHaveLength(1);
    const frozenSource = structuredClone(routes.renderBodies[0].source);
    expect(frozenSource).toMatchObject({
      date: '2026-10-22', dueDate: '2026-11-05', settings: { companyName: settings.companyName },
    });

    const staleSettingsResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/settings');
    refreshDelivery.release();
    const staleResponse = await staleSettingsResponse;
    expect(staleResponse.status()).toBe(200);
    expect(await staleResponse.finished()).toBeNull();
    // Flush the completed fetch/json promise and React paint, not an arbitrary
    // delay: the synthetic render is still held throughout these assertions.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await assertLocked(page, fields);
    expect(await values(fields)).toEqual(beforeValues);
    await expect(fields.locator('#due-date')).toHaveValue('2026-11-05');
    expect(routes.renderBodies[0].source).toEqual(frozenSource);
    expect(await financialSnapshot(userId)).toEqual(before);
    expect(await prisma.settings.findUniqueOrThrow({ where: { userId } })).toEqual(settings);

    const rejectedRender = page.waitForResponse(response => new URL(response.url()).pathname === '/api/invoices/render');
    routes.delivery.release();
    expect((await rejectedRender).status()).toBe(503);
    await expect.poll(() => routes.alerts).toEqual([renderRejection]);
    await expect(fields).not.toBeDisabled();
    expect(await values(fields)).toEqual(beforeValues);
    await expect(fields.locator('#payment-term-source')).toHaveText('Manuell festgelegt · bleibt bei Änderungen erhalten');

    // The company is not an editable field here. Inspect the next read-only
    // preview source to prove the discarded response did not secretly replace
    // it while the PDF source was frozen or after the rejection unlocked it.
    const retainedPreview = page.waitForResponse(response => new URL(response.url()).pathname === '/api/invoices/render');
    await page.getByRole('button', { name: 'Live-Vorschau', exact: true }).click();
    expect((await retainedPreview).status()).toBe(503);
    expect(routes.renderBodies).toHaveLength(2);
    expect(routes.renderBodies[1].preview).toBe(true);
    expect(routes.renderBodies[1].source).toEqual(frozenSource);

    const freshPreview = page.waitForResponse(response => {
      if (new URL(response.url()).pathname !== '/api/invoices/render') return false;
      const body = response.request().postDataJSON() as { preview?: boolean; source?: { dueDate?: string; settings?: { companyName?: string } } };
      return body.preview === true && body.source?.dueDate === '2026-11-21'
        && body.source.settings?.companyName === changedSettings.companyName;
    });
    const reappliedSettings = page.waitForResponse(response => new URL(response.url()).pathname === '/api/settings');
    await fields.getByRole('button', { name: 'Vorgabe erneut anwenden', exact: true }).click();
    expect((await reappliedSettings).status()).toBe(200);
    await expect(fields.locator('#due-date')).toHaveValue('2026-11-21');
    await expect(fields.locator('#payment-term-source')).toHaveText('Firmenvorgabe: 30 Kalendertage');
    expect((await freshPreview).status()).toBe(503);
    expect(refreshRequests).toBe(2);
    expect(routes.renderBodies).toHaveLength(3);
    expect(routes.renderBodies[2]).toMatchObject({ preview: true, source: {
      date: '2026-10-22', dueDate: '2026-11-21', settings: { companyName: changedSettings.companyName },
    } });
    expect(writes).toEqual(Array(3).fill('POST /api/invoices/render'));
    expect(routes.mutationAttempts).toEqual([]);
    expect(routes.routeFailures).toEqual([]);
    expect(routes.alerts).toEqual([renderRejection]);
    expect(await financialSnapshot(userId)).toEqual(before);
    expect(await prisma.settings.findUniqueOrThrow({ where: { userId } })).toEqual(settings);
  } finally {
    refreshDelivery.release(); routes.delivery.release();
    page.off('request', recordWrite);
    await page.unroute('**/api/settings', refreshHandler);
    await routes.cleanup(); await prisma.$disconnect();
  }
});
