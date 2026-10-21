import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import type { CustomerTimelinePage, TimelineEntry } from '../lib/customer-timeline-contract';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';

// Browser execution is intentionally reserved for the hosted acceptance job.
// Its supported runner owns this fresh, temporary database; never a repository
// database, published customer account, SMTP service or external payment API.
test.skip(process.env.CI !== 'true', 'Hosted Chromium acceptance only.');

const recordedAt = new Date('2026-10-20T12:00:00.000Z');
const parsedData = { currency: 'EUR', taxMode: 'small-business', taxAmount: 0,
  buyerInfo: { name: 'SYNTHETISCH · historischer Name' } };

async function account(page: Page, count = 24) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const password = 'SyntheticCustomerTimeline123!';
  const user = await prisma.user.create({ data: { email: `customer-timeline-${randomUUID()}@example.test`, name: 'Synthetic timeline acceptance', password: await hashPassword(password), role: 'USER' } });
  const foreignUser = await prisma.user.create({ data: { email: `foreign-timeline-${randomUUID()}@example.test`, name: 'Synthetic other tenant', password: 'synthetic-account-not-used-for-login', role: 'USER' } });
  const customer = await prisma.customer.create({ data: { userId: user.id, name: 'SYNTHETISCH · Kundenakte', email: 'same-synthetic-contact@example.test' } });
  const empty = await prisma.customer.create({ data: { userId: user.id, name: 'SYNTHETISCH · Ohne Verlauf' } });
  const deleted = await prisma.customer.create({ data: { userId: user.id, name: 'SYNTHETISCH · Gelöschter Kunde' } });
  await prisma.customer.delete({ where: { id: deleted.id } });
  const foreignCustomer = await prisma.customer.create({ data: { userId: foreignUser.id, name: customer.name, email: customer.email } });
  await prisma.invoice.createMany({ data: Array.from({ length: count }, (_, index) => ({
    userId: user.id, customerId: customer.id, type: 'INVOICE', invoiceNumber: `SYNTHETIC-PAGE-${String(index + 1).padStart(2, '0')}`,
    fileName: 'synthetic-timeline.pdf', storedFileName: `synthetic-${randomUUID()}.pdf`, uploadedAt: recordedAt,
    invoiceDate: new Date('2026-01-01'), totalAmount: 100, status: 'SENT', issuanceState: 'ISSUED', parsedData,
  })) });
  const foreignInvoice = await prisma.invoice.create({ data: {
    userId: foreignUser.id, customerId: foreignCustomer.id, type: 'INVOICE', invoiceNumber: 'SYNTHETIC-FOREIGN-SECRET',
    fileName: 'synthetic-foreign.pdf', storedFileName: `synthetic-${randomUUID()}.pdf`, uploadedAt: recordedAt,
    totalAmount: 999, status: 'SENT', issuanceState: 'ISSUED', parsedData,
  } });
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(user.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return { user, foreignUser, customer, empty, deletedId: deleted.id, foreignCustomer, foreignInvoice };
}

async function createDocument(userId: string, customerId: number, number: string, changes: {
  type?: string; status?: string; totalAmount?: number; uploadedAt?: Date; convertedFromQuoteId?: number;
} = {}) {
  return prisma.invoice.create({ data: {
    userId, customerId, type: 'INVOICE', invoiceNumber: number,
    fileName: 'synthetic-timeline.pdf', storedFileName: `synthetic-${randomUUID()}.pdf`, uploadedAt: recordedAt,
    invoiceDate: new Date('2026-01-01'), totalAmount: 100, status: 'SENT', issuanceState: 'ISSUED', parsedData,
    ...changes,
  } });
}

async function financialState(userIds: string[]) {
  const where = { userId: { in: userIds } };
  return {
    invoices: await prisma.invoice.findMany({ where, orderBy: { id: 'asc' } }),
    incomes: await prisma.income.findMany({ where, orderBy: { id: 'asc' } }),
    payments: await prisma.paymentJournalEvent.findMany({ where, orderBy: { id: 'asc' } }),
    adjustments: await prisma.paymentAdjustment.findMany({ where, orderBy: { id: 'asc' } }),
    operations: await prisma.paymentOperation.findMany({ where, orderBy: { id: 'asc' } }),
    counters: await prisma.invoiceNumberCounter.findMany({ where, orderBy: [{ userId: 'asc' }, { type: 'asc' }, { year: 'asc' }] }),
    audit: await prisma.auditLog.findMany({ where, orderBy: { id: 'asc' } }),
    outbox: await prisma.emailOutbox.findMany({ where, orderBy: { id: 'asc' } }),
    expenses: await prisma.expense.findMany({ where, orderBy: { id: 'asc' } }),
    notes: await prisma.billingNote.findMany({ where, orderBy: { id: 'asc' } }),
    projects: await prisma.serviceProject.findMany({ where, orderBy: { id: 'asc' } }),
  };
}

async function timeline(page: Page, customerId: number, cursor?: string) {
  const response = await page.request.get(`/api/customers/${customerId}/timeline${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()['cache-control']).toBe('private, no-store');
  return response.json() as Promise<CustomerTimelinePage>;
}

function opener(page: Page, name: string) {
  return page.getByRole('button', { name: `Verlauf für ${name}`, exact: true });
}

function dialogFor(page: Page, name: string) {
  return page.getByRole('dialog', { name: `Verlauf: ${name}`, exact: true });
}

async function geometry(page: Page, width: number) {
  const height = width === 1440 ? 1000 : 844;
  await page.setViewportSize({ width, height });
  await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width, height });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect.poll(() => page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
}

async function reachable(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect.poll(() => locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const viewport = element.closest('[role="dialog"]')?.getBoundingClientRect();
    if (!viewport || rect.width <= 0 || rect.height < 43 || rect.top < Math.max(0, viewport.top)
      || rect.bottom > Math.min(innerHeight, viewport.bottom) || rect.left < 0 || rect.right > innerWidth) return false;
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit !== null && (hit === element || element.contains(hit));
  })).toBe(true);
}

async function screenshot(page: Page, testInfo: TestInfo, filename: string) {
  // Exactly two unchanged, normal-viewport PNGs across this suite; no crops,
  // injected CSS, concealed content, postprocessing or retry duplicates.
  if (testInfo.retry !== 0) return;
  const path = testInfo.outputPath(filename);
  await page.screenshot({ path, fullPage: false });
  expect((await stat(path)).size).toBeLessThan(5 * 1024 * 1024);
  await testInfo.attach(filename, { path, contentType: 'image/png' });
}

test('customer timeline is tenant-scoped, paged and read-only through desktop/mobile navigation and safe retry', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const fixture = await account(page);
  const { user, foreignUser, customer, empty, deletedId, foreignCustomer, foreignInvoice } = fixture;
  const main = await createDocument(user.id, customer.id, 'SYNTHETIC-ADJUSTED');
  await createDocument(user.id, customer.id, 'SYNTHETIC-ACCEPTED-QUOTE', { type: 'QUOTE', status: 'ACCEPTED' });
  await createDocument(user.id, customer.id, 'SYNTHETIC-CANCELLED', { status: 'CANCELLED' });
  await createDocument(user.id, customer.id, 'SYNTHETIC-ZERO-REVIEW', { totalAmount: 0 });
  await createDocument(user.id, customer.id, 'SYNTHETIC-DRAFT', { status: 'DRAFT' });
  const convertedQuote = await createDocument(user.id, customer.id, 'SYNTHETIC-CONVERTED-QUOTE', { type: 'QUOTE', status: 'ACCEPTED' });
  const convertedInvoice = await createDocument(user.id, customer.id, 'SYNTHETIC-FROM-QUOTE', { convertedFromQuoteId: convertedQuote.id });
  const paymentResponse = await page.request.post(`/api/invoices/${main.id}/payments`, { data: {
    amount: '40.00', expectedPaidCents: '0', currency: 'EUR', paidAt: '2026-10-19', source: 'MANUAL',
    reference: 'SYNTHETIC · existing receipt', idempotencyKey: randomUUID(),
  } });
  expect(paymentResponse.status(), await paymentResponse.text()).toBe(201);
  const payment = await paymentResponse.json();
  const journal = await page.request.get(`/api/invoices/${main.id}/payments`, { headers: { 'X-Bivaro-Payment-Contract': '2' } });
  expect(journal.ok()).toBe(true);
  const correction = await page.request.post(`/api/invoices/${main.id}/payments/adjustments`, { data: {
    kind: 'PAYMENT_CORRECTION', originalPaymentId: payment.event.id, amount: '20.00', actionDate: '2026-10-20',
    reason: 'SYNTHETIC · this recorded portion never arrived', reference: 'SYNTHETIC · correction proof',
    idempotencyKey: randomUUID(), expectedLedgerVersion: (await journal.json()).ledgerVersion, declarationNeverReceived: true,
  } });
  expect(correction.status(), await correction.text()).toBe(201);
  const before = await financialState([user.id, foreignUser.id]);
  const mutations: string[] = [];
  page.on('request', observed => {
    if (new URL(observed.url()).pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(observed.method())) mutations.push(`${observed.method()} ${new URL(observed.url()).pathname}`);
  });

  expect((await request.get(`/api/customers/${customer.id}/timeline`)).status()).toBe(401);
  expect((await page.request.get(`/api/customers/${foreignCustomer.id}/timeline`)).status()).toBe(404);
  expect((await page.request.get(`/api/customers/${deletedId}/timeline`)).status()).toBe(404);
  expect((await page.request.get('/api/customers/0/timeline')).status()).toBe(400);
  expect((await page.request.get(`/api/customers/${customer.id}/timeline?limit=99999`)).status()).toBe(400);
  expect((await page.request.get(`/api/customers/${customer.id}/timeline?cursor=invalid!`)).status()).toBe(400);
  expect((await timeline(page, empty.id)).entries).toEqual([]);
  const first = await timeline(page, customer.id);
  expect(first.entries).toHaveLength(20);
  expect(first.nextCursor).not.toBeNull();
  const second = await timeline(page, customer.id, first.nextCursor!);
  expect(second.nextCursor).toBeNull();
  const all = [...first.entries, ...second.entries];
  expect(all).toHaveLength(33);
  expect(new Set(all.map(entry => entry.key)).size).toBe(all.length);
  expect(all.every(entry => entry.document.id !== foreignInvoice.id)).toBe(true);
  expect(JSON.stringify(all)).not.toContain('SYNTHETIC-FOREIGN-SECRET');
  const order = (entry: TimelineEntry) => ({ at: new Date(entry.recordedAt).getTime(), rank: entry.kind === 'DOCUMENT' ? 0 : entry.kind === 'PAYMENT' ? 1 : 2, id: Number(entry.key.split(':')[1]) });
  for (let index = 1; index < all.length; index++) {
    const previous = order(all[index - 1]); const current = order(all[index]);
    expect(previous.at > current.at || (previous.at === current.at && (previous.rank > current.rank || (previous.rank === current.rank && previous.id > current.id)))).toBe(true);
  }
  expect(all.find(entry => entry.kind === 'DOCUMENT' && entry.document.id === main.id)).toMatchObject({ balance: { state: 'KNOWN', openCents: '8000' }, statusLabel: 'Teilweise bezahlt' });
  expect(all.find(entry => entry.kind === 'ADJUSTMENT')).toMatchObject({ amountCents: '2000', statusLabel: 'Zahlungskorrektur · fachlich ungeprüft' });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/customers');
  await page.getByRole('textbox', { name: 'Kunden suchen', exact: true }).fill('Kundenakte');
  const launch = opener(page, customer.name);
  await launch.focus(); await page.keyboard.press('Enter');
  const dialog = dialogFor(page, customer.name);
  const list = dialog.getByRole('list', { name: 'Kundenverlauf', exact: true });
  await expect(list.getByRole('listitem')).toHaveCount(20);
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await dialog.getByRole('button', { name: 'Verlauf neu laden', exact: true }).focus();
  await expect(dialog.getByRole('button', { name: 'Verlauf neu laden', exact: true })).toBeFocused();
  const mainRow = list.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Rechnung SYNTHETIC-ADJUSTED', exact: true }) });
  await expect(mainRow).toContainText('Aktueller Rest 80,00 €');
  const acceptedQuoteRow = list.getByRole('listitem').filter({ hasText: 'Angebot SYNTHETIC-ACCEPTED-QUOTE' });
  await expect(acceptedQuoteRow).toContainText('Keine Forderung');
  const acceptedQuote = all.find(entry => entry.document.number === 'SYNTHETIC-ACCEPTED-QUOTE')!;
  await expect(acceptedQuoteRow.getByRole('link')).toHaveAttribute('href', `/api/quotes/download?id=${acceptedQuote.document.id}`);
  await expect(list.getByRole('listitem').filter({ hasText: 'Rechnung SYNTHETIC-CANCELLED' })).not.toContainText('Aktueller Rest');
  await expect(list.getByRole('listitem').filter({ hasText: 'Rechnung SYNTHETIC-ZERO-REVIEW' })).toContainText('Zahlungsstand zu prüfen');
  await expect(list.getByRole('listitem').filter({ hasText: 'Rechnung SYNTHETIC-DRAFT' })).toContainText('kein Umsatznachweis');
  const convertedRow = list.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Angebot SYNTHETIC-CONVERTED-QUOTE', exact: true }) });
  await expect(convertedRow).toContainText('In Rechnung übernommen');
  await convertedRow.locator('summary').click();
  const convertedLink = convertedRow.getByRole('link', { name: 'Übernommene Rechnung SYNTHETIC-FROM-QUOTE öffnen (neuer Tab)', exact: true });
  await expect(convertedLink).toHaveAttribute('href', `/history?invoiceId=${convertedInvoice.id}`);
  await expect(convertedLink).toHaveAttribute('target', '_blank');
  await expect(convertedLink).toHaveAttribute('rel', 'noopener noreferrer');
  const details = mainRow.locator('summary');
  await reachable(details); await details.focus(); await page.keyboard.press('Enter');
  await expect(mainRow.locator('details')).toHaveAttribute('open', '');
  await expect(mainRow).toContainText('2026'); await expect(mainRow).toContainText('UTC');
  const direct = mainRow.getByRole('link', { name: 'Rechnung SYNTHETIC-ADJUSTED öffnen (neuer Tab)', exact: true });
  await expect(direct).toHaveAttribute('href', `/history?invoiceId=${main.id}`);
  await expect(direct).toHaveAttribute('target', '_blank');
  await expect(direct).toHaveAttribute('rel', 'noopener noreferrer');
  const newPage = page.context().waitForEvent('page');
  await direct.click(); const detailPage = await newPage;
  await expect(detailPage).toHaveURL(url => url.pathname === '/history' && url.searchParams.get('invoiceId') === String(main.id));
  await expect(detailPage.getByRole('heading', { name: 'Original und Korrektur', exact: true })).toBeVisible();
  await detailPage.close();
  await expect(dialog).toBeVisible();
  await dialog.evaluate(element => element.scrollTo({ top: 0, behavior: 'instant' }));
  await geometry(page, 1440);
  await screenshot(page, testInfo, 'customer-timeline-desktop-1440.png');

  // A failed next-page GET preserves all already visible rows and its cursor.
  await page.route(url => url.pathname === `/api/customers/${customer.id}/timeline` && url.searchParams.has('cursor'), route => route.fulfill({ status: 502, contentType: 'text/html', body: '<html>synthetic gateway failure</html>' }), { times: 1 });
  await dialog.getByRole('button', { name: 'Ältere Einträge laden', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Der Verlauf konnte nicht geladen werden. Bitte erneut versuchen.');
  await expect(dialog.getByRole('alert')).not.toContainText(/Unexpected|JSON|<html>/);
  await expect(list.getByRole('listitem')).toHaveCount(20);
  await dialog.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
  await expect(list.getByRole('listitem')).toHaveCount(33);
  await dialog.getByRole('button', { name: 'Verlauf neu laden', exact: true }).click();
  await expect(list.getByRole('listitem')).toHaveCount(20);
  let pageRequests = 0;
  page.on('request', observed => { const url = new URL(observed.url()); if (url.pathname === `/api/customers/${customer.id}/timeline` && url.searchParams.has('cursor')) pageRequests++; });
  await dialog.getByRole('button', { name: 'Ältere Einträge laden', exact: true }).click({ clickCount: 2 });
  await expect(list.getByRole('listitem')).toHaveCount(33);
  expect(pageRequests).toBe(1);

  for (const width of [360, 390]) {
    await geometry(page, width);
    await reachable(dialog.getByRole('button', { name: 'Verlauf neu laden', exact: true }));
    await reachable(list.getByRole('listitem').first().locator('summary'));
    await reachable(list.getByRole('listitem').first().getByRole('link'));
    await reachable(dialog.getByRole('button', { name: 'Schließen', exact: true }));
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden(); await expect(launch).toBeFocused();
    await expect(page.getByRole('textbox', { name: 'Kunden suchen', exact: true })).toHaveValue('Kundenakte');
    await launch.focus(); await page.keyboard.press('Enter');
    await expect(list.getByRole('listitem')).toHaveCount(20);
    await geometry(page, width);
    if (width === 360) {
      await dialog.evaluate(element => element.scrollTo({ top: 0, behavior: 'instant' }));
      await screenshot(page, testInfo, 'customer-timeline-mobile-360.png');
    }
  }
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(launch).toBeFocused();
  await page.reload();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await opener(page, customer.name).click();
  await expect(list.getByRole('listitem')).toHaveCount(20);
  await page.keyboard.press('Escape');
  await expect(opener(page, customer.name)).toBeFocused();
  expect(mutations).toEqual([]);
  expect(await financialState([user.id, foreignUser.id])).toEqual(before);
});

test('customer timeline refresh observes current facts, freezes paging membership and discards closed-customer responses', async ({ page }) => {
  test.setTimeout(90_000);
  const { user, foreignUser, customer, empty } = await account(page, 23);
  const before = await financialState([user.id, foreignUser.id]);
  const first = await timeline(page, customer.id);
  expect(first.entries).toHaveLength(20);
  const second = await timeline(page, customer.id, first.nextCursor!);
  expect(second.entries).toHaveLength(3);
  expect(await financialState([user.id, foreignUser.id])).toEqual(before);

  // Deliberate fixture changes represent a different tab/operator, not a read
  // action. The existing cursor must not acquire the newly inserted source.
  const inserted = await createDocument(user.id, customer.id, 'SYNTHETIC-NEW-SINCE-PAGE', { uploadedAt: new Date('2026-10-21T12:00:00.000Z') });
  const frozen = await timeline(page, customer.id, first.nextCursor!);
  expect(frozen.entries.map(entry => entry.key)).toEqual(second.entries.map(entry => entry.key));
  expect(frozen.entries.every(entry => entry.document.id !== inserted.id)).toBe(true);
  const afterInsert = await financialState([user.id, foreignUser.id]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/customers');
  await opener(page, customer.name).click();
  const dialog = dialogFor(page, customer.name);
  const list = dialog.getByRole('list', { name: 'Kundenverlauf', exact: true });
  await expect(list.getByRole('listitem')).toHaveCount(20);
  const updated = list.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Rechnung SYNTHETIC-NEW-SINCE-PAGE', exact: true }) });
  await expect(updated).toContainText('Aktueller Rest 100,00 €');
  expect(await financialState([user.id, foreignUser.id])).toEqual(afterInsert);
  await prisma.invoice.update({ where: { id: inserted.id }, data: { status: 'CANCELLED' } });
  const afterStatusChange = await financialState([user.id, foreignUser.id]);
  await dialog.getByRole('button', { name: 'Verlauf neu laden', exact: true }).click();
  await expect(updated).toContainText('Storniert · keine offene Forderung');
  await expect(updated).not.toContainText('Aktueller Rest');
  await expect(list.getByRole('listitem')).toHaveCount(20);
  await page.keyboard.press('Escape');
  expect(await financialState([user.id, foreignUser.id])).toEqual(afterStatusChange);

  // Both JSON and HTML initial-load failures are recoverable GETs. No empty
  // success or raw parser message may replace the explicit failure state.
  await page.route(`**/api/customers/${empty.id}/timeline`, route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetischer Verlaufsfehler' }) }), { times: 1 });
  await opener(page, empty.name).click();
  const emptyDialog = dialogFor(page, empty.name);
  await expect(emptyDialog.getByRole('alert')).toContainText('Synthetischer Verlaufsfehler');
  await expect(emptyDialog.getByRole('heading', { name: 'Noch kein Verlauf', exact: true })).toHaveCount(0);
  await page.route(`**/api/customers/${empty.id}/timeline`, route => route.fulfill({ status: 502, contentType: 'text/html', body: '<html>synthetic gateway failure</html>' }), { times: 1 });
  await emptyDialog.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
  await expect(emptyDialog.getByRole('alert')).toContainText('Der Verlauf konnte nicht geladen werden. Bitte erneut versuchen.');
  await emptyDialog.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
  await expect(emptyDialog.getByRole('heading', { name: 'Noch kein Verlauf', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(opener(page, empty.name)).toBeFocused();

  let release!: () => void; let intercepted!: () => void; let settled!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { intercepted = resolve; });
  const completed = new Promise<void>(resolve => { settled = resolve; });
  await page.route(`**/api/customers/${customer.id}/timeline`, async route => {
    const response = await route.fetch();
    intercepted(); await gate;
    try { await route.fulfill({ response }); } catch { /* Closing aborts this superseded GET. */ } finally { settled(); }
  }, { times: 1 });
  await opener(page, customer.name).click(); await started;
  await expect(dialog.getByRole('status')).toContainText('Verlauf wird geladen');
  await page.keyboard.press('Escape'); await expect(opener(page, customer.name)).toBeFocused();
  await opener(page, empty.name).click();
  await expect(emptyDialog.getByRole('heading', { name: 'Noch kein Verlauf', exact: true })).toBeVisible();
  release(); await completed;
  await expect(emptyDialog.getByRole('heading', { name: 'Noch kein Verlauf', exact: true })).toBeVisible();
  await expect(emptyDialog.getByRole('list', { name: 'Kundenverlauf', exact: true })).toHaveCount(0);
  await expect(emptyDialog).not.toContainText('SYNTHETIC-NEW-SINCE-PAGE');
  await page.keyboard.press('Escape');

  const renamed = 'SYNTHETISCH · Kundenakte umbenannt';
  await prisma.customer.update({ where: { id: customer.id }, data: { name: renamed } });
  await page.reload(); await opener(page, renamed).click();
  await expect(dialogFor(page, renamed).getByRole('heading', { name: 'Rechnung SYNTHETIC-NEW-SINCE-PAGE', exact: true })).toBeVisible();
  expect((await timeline(page, customer.id)).customer.name).toBe(renamed);
  expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inserted.id } })).parsedData).toEqual(parsedData);
  await page.keyboard.press('Escape'); await expect(opener(page, renamed)).toBeFocused();
  expect(await financialState([user.id, foreignUser.id])).toEqual(afterStatusChange);
});
