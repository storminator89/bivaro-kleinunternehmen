import { expect, test, type BrowserContext, type Locator, type Page, type Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../lib/password';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// AUTHORING ONLY. Use solely with the existing isolated hosted acceptance
// runner. This file neither changes a workflow nor constitutes browser evidence.
const GROUPS = [
  { type: 'customer', title: 'Kunden', path: 'customers', retry: 'Erneut laden', ordinary: '#customer-search' },
  { type: 'outbound', title: 'Ausgangsbelege', path: 'invoices', retry: 'Erneut laden', ordinary: '#invoice-search' },
  { type: 'inbound', title: 'Eingangsbelege', path: 'purchase-documents', retry: 'Erneut versuchen', ordinary: '#incoming-search' },
] as const;
type Group = typeof GROUPS[number];
type SearchRequest = { url: string; method: string; data: Record<string, unknown> };
const notice = (page: Page, group: Group) => page.getByRole('region', { name: `Suchfilter · ${group.title}`, exact: true });
const review = (page: Page) => page.getByRole('dialog', { name: 'Eingangsbeleg prüfen', exact: true });
const chooser = (page: Page) => page.getByRole('alertdialog', { name: 'Ungespeicherter Prüfentwurf', exact: true });

async function signIn(page: Page, email: string, password: string) {
  await isolateSyntheticLoginIpBudget();
  await page.goto('/login'); await page.getByLabel('E-Mail').fill(email); await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click(); await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('button', { name: 'Befehlspalette öffnen', exact: true }).filter({ visible: true }).first()).toBeVisible();
}
async function openPalette(page: Page) {
  await expect(page.getByRole('button', { name: 'Befehlspalette öffnen', exact: true }).filter({ visible: true }).first()).toBeVisible();
  await page.mouse.move(0, 0); await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Befehlspalette', exact: true });
  await expect(dialog).toBeVisible(); const input = dialog.getByRole('combobox'); await expect(input).toBeFocused();
  return { dialog, input };
}
/** Real arrow/Enter selection, never an artificial DOM click or cmdk value. */
async function chooseWithKeyboard(page: Page, input: Locator, option: Locator) {
  await expect(option).toBeVisible(); await input.focus(); await page.keyboard.press('Home');
  for (let index = 0; index < 30 && await option.getAttribute('aria-selected') !== 'true'; index++) await page.keyboard.press('ArrowDown');
  await expect(option).toHaveAttribute('aria-selected', 'true'); await expect(option).toBeInViewport();
  await expect(input).toHaveAttribute('aria-activedescendant', (await option.getAttribute('id'))!);
  await page.keyboard.press('Enter');
}
async function beginList(page: Page, group: Group, query: string) {
  const { dialog, input } = await openPalette(page); await input.fill(query);
  await chooseWithKeyboard(page, input, dialog.getByRole('option', { name: `Passende Liste öffnen · ${group.title}`, exact: true }));
  await expect(dialog).toBeHidden(); await expect(notice(page, group)).toBeVisible(); await expect(notice(page, group)).toBeFocused();
  await expect(notice(page, group)).toContainText(`Suchtreffer für „${query}“`);
  await expect(page.locator(group.ordinary)).toHaveCount(0);
}
/** Native capture scroll only: keep the real query label clear of the sticky shell. */
async function clearFilteredListCaptureHeader(page: Page, group: Group, query: string) {
  const filterNotice = notice(page, group);
  const topbar = page.locator('header.app-topbar').filter({ visible: true });
  await expect(topbar).toHaveCount(1);
  await expect(topbar).toBeVisible();
  await filterNotice.evaluate(element => element.scrollIntoView({ block: 'start' }));
  const headerBounds = await topbar.boundingBox(); expect(headerBounds).not.toBeNull();
  await page.evaluate(clearance => window.scrollBy({ top: -clearance, behavior: 'instant' }), headerBounds!.height + 8);
  const queryLabel = filterNotice.getByText(`Suchtreffer für „${query}“`, { exact: true });
  await expect(queryLabel).toBeInViewport({ ratio: 1 });
  const queryBounds = await queryLabel.boundingBox(), visibleHeaderBounds = await topbar.boundingBox();
  expect(queryBounds).not.toBeNull(); expect(visibleHeaderBounds).not.toBeNull();
  expect(queryBounds!.y).toBeGreaterThanOrEqual(visibleHeaderBounds!.y + visibleHeaderBounds!.height);
}
async function snapshot(userId: string) {
  return { invoices: await prisma.invoice.findMany({ where: { userId }, orderBy: { id: 'asc' } }), receipts: await prisma.purchaseDocument.findMany({ where: { userId }, orderBy: { id: 'asc' } }), customers: await prisma.customer.findMany({ where: { userId }, orderBy: { id: 'asc' } }), audit: await prisma.auditLog.count({ where: { userId } }), payments: await prisma.paymentJournalEvent.count({ where: { userId } }), adjustments: await prisma.paymentAdjustment.count({ where: { userId } }), allocations: await prisma.paymentAllocationChange.count({ where: { userId } }), incomes: await prisma.income.count({ where: { userId } }), expenses: await prisma.expense.count({ where: { userId } }), cash: await prisma.cashTransaction.count({ where: { userId } }) };
}
async function fixture(page: Page, count = 27) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const password = 'SyntheticFilteredLists123!'; const query = `SYN-FILTER-${randomUUID().slice(0, 8)}`;
  const owner = await prisma.user.create({ data: { email: `filtered-owner-${randomUUID()}@example.test`, name: 'Synthetic filtered-list owner', password: await hashPassword(password), role: 'USER' } });
  const foreign = await prisma.user.create({ data: { email: `filtered-other-${randomUUID()}@example.test`, name: 'Synthetic other list owner', password: await hashPassword(password), role: 'USER' } });
  const customers: { id: number; name: string }[] = [];
  for (let index = 0; index < count; index++) {
    const suffix = String(index).padStart(2, '0');
    customers.push(await prisma.customer.create({ data: { userId: owner.id, name: `${query} Kunde ${suffix}`, internalNote: 'PRIVATE-NOTE-NOT-A-MATCH-FIELD' } }));
    await prisma.invoice.create({ data: { userId: owner.id, type: index === count - 1 ? 'CREDIT_NOTE' : 'INVOICE', invoiceNumber: `${query}-OUT-${suffix}`, uploadedAt: new Date(`2000-01-01T00:00:${suffix}.000Z`), fileName: 'synthetic-unopened.pdf', storedFileName: 'synthetic-unopened.pdf', totalAmount: 10, parsedData: { currency: 'EUR' } } });
    await prisma.purchaseDocument.create({ data: { userId: owner.id, invoiceNumber: `${query}-IN-${suffix}`, originalFileName: `${query}-original-${suffix}.pdf`, storedFileName: 'synthetic-unopened.pdf', uploadedAt: new Date(`2000-01-01T00:00:${suffix}.000Z`), originalSha256: `${index}`.padStart(64, '0'), originalByteCount: 12, mediaType: 'application/pdf', uploadRequestId: randomUUID(), reviewStatus: index === count - 1 ? 'DISMISSED' : 'REVIEW', ...(index < 2 ? { supplierTaskKind: 'CLARIFY', supplierTaskFollowUpDate: index === 0 ? '2000-01-01' : '9999-12-31' } : {}) } });
  }
  const foreignCustomer = await prisma.customer.create({ data: { userId: foreign.id, name: `${query} FOREIGN-CUSTOMER` } });
  const foreignInvoice = await prisma.invoice.create({ data: { userId: foreign.id, invoiceNumber: `${query}-FOREIGN-OUT`, fileName: 'foreign-private.pdf', storedFileName: 'foreign-private.pdf', totalAmount: 10, parsedData: { currency: 'EUR' } } });
  const foreignReceipt = await prisma.purchaseDocument.create({ data: { userId: foreign.id, invoiceNumber: `${query}-FOREIGN-IN`, originalFileName: 'foreign-private.pdf', storedFileName: 'foreign-private.pdf', originalSha256: 'f'.repeat(64), originalByteCount: 12, mediaType: 'application/pdf', uploadRequestId: randomUUID() } });
  await prisma.customer.create({ data: { userId: owner.id, name: 'PRIVATE-FIELD-CUSTOMER', email: `${query}@synthetic.invalid`, internalNote: query, city: query } });
  await prisma.invoice.create({ data: { userId: owner.id, invoiceNumber: 'PRIVATE-FIELD-OUTBOUND', fileName: `${query}-private-filename.pdf`, storedFileName: 'synthetic-private.pdf', totalAmount: 10, parsedData: { currency: 'EUR', note: query } } });
  await prisma.invoice.createMany({ data: ['QUOTE', 'PROFORMA'].map(type => ({ userId: owner.id, type, invoiceNumber: `${query}-${type}-EXCLUDED`, fileName: 'synthetic-excluded.pdf', storedFileName: 'synthetic-excluded.pdf', parsedData: {} })) });
  await prisma.purchaseDocument.create({ data: { userId: owner.id, invoiceNumber: 'PRIVATE-FIELD-INBOUND', originalFileName: 'private-source.pdf', storedFileName: 'synthetic-private.pdf', originalSha256: 'e'.repeat(64), originalByteCount: 12, mediaType: 'application/pdf', uploadRequestId: randomUUID(), supplierName: query, reviewDraftSearch: query, parsedData: { note: query } } });
  await signIn(page, owner.email, password);
  const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = Buffer.from(await pdf.save());
  const outgoingResponse = await page.request.post('/api/invoices', { data: { fileName: 'synthetic-filtered-real.pdf', invoiceNumber: `${query}-REAL-OUT`, parsedData: { currency: 'EUR' }, totalAmount: 10, pdfBytes: bytes.toString('base64') } });
  expect(outgoingResponse.status()).toBe(200); const outgoing = await outgoingResponse.json() as { id: number; invoiceNumber: string };
  const incomingResponse = await page.request.post('/api/purchase-documents', { multipart: { file: { name: `${query}-REAL-IN.pdf`, mimeType: 'application/pdf', buffer: bytes }, uploadRequestId: randomUUID(), analysisMode: 'manual' } });
  expect(incomingResponse.status()).toBe(201); const incoming = (await incomingResponse.json()).document as { id: number };
  return { owner, foreign, password, query, customers, outgoing, incoming, bytes, count, foreignIds: { customer: foreignCustomer.id, outbound: foreignInvoice.id, inbound: foreignReceipt.id } };
}
async function privacyProbe(page: Page) {
  const urls: string[] = [], searches: SearchRequest[] = [];
  await page.addInitScript(() => {
    const windowWithTrace = window as Window & { filteredListHistory?: string[] };
    windowWithTrace.filteredListHistory = [];
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method].bind(history);
      history[method] = (state, unused, url) => { windowWithTrace.filteredListHistory!.push(JSON.stringify({ state, url })); return original(state, unused, url); };
    }
  });
  // Also install on the current authenticated document (addInitScript owns Reload).
  await page.evaluate(() => {
    const windowWithTrace = window as Window & { filteredListHistory?: string[] };
    windowWithTrace.filteredListHistory = [];
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method].bind(history);
      history[method] = (state, unused, url) => { windowWithTrace.filteredListHistory!.push(JSON.stringify({ state, url })); return original(state, unused, url); };
    }
  });
  page.on('request', request => {
    urls.push(request.url());
    if (/^\/api\/(?:customers|invoices|purchase-documents)\/search$/.test(new URL(request.url()).pathname)) searches.push({ url: request.url(), method: request.method(), data: request.postDataJSON() });
  });
  return { urls, searches };
}
async function assertPrivateTransport(page: Page, query: string, probe: Awaited<ReturnType<typeof privacyProbe>>) {
  for (const url of probe.urls.concat(page.url())) { expect(url).not.toContain(query); expect(url).not.toContain(encodeURIComponent(query)); }
  for (const request of probe.searches) { expect(request.method).toBe('POST'); expect(new URL(request.url).search).toBe(''); expect(request.data.query).toBe(query); expect(Object.keys(request.data)).not.toContain('userId'); }
  expect(await page.evaluate(term => ({ stored: Object.entries(localStorage).concat(Object.entries(sessionStorage)).some(entry => JSON.stringify(entry).includes(term)), history: ((window as Window & { filteredListHistory?: string[] }).filteredListHistory ?? []).some(value => value.includes(term)) }), query)).toEqual({ stored: false, history: false });
}
async function staticDashboard(page: Page) {
  const { dialog, input } = await openPalette(page); await input.fill(''); await dialog.getByRole('option', { name: 'Dashboard öffnen', exact: true }).click(); await expect(page).toHaveURL(/\/dashboard$/);
}
async function holdNextList(page: Page, group: Group, query: string, marker: string) {
  let release!: () => void, started!: () => void, finished!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const held = new Promise<void>(resolve => { started = resolve; });
  const done = new Promise<void>(resolve => { finished = resolve; });
  const handler = async (route: Route) => {
    try {
      expect(route.request().postDataJSON().query).toBe(query);
      const response = await route.fetch(); expect(response.status()).toBe(200); const body = await response.json();
      if (group.type === 'customer') body[0].name = marker;
      else if (group.type === 'outbound') body.items[0].invoiceNumber = marker;
      else body.documents[0].invoiceNumber = marker;
      started(); await gate;
      try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }); } catch { /* A discarded request may already be aborted. */ }
    } finally { finished(); }
  };
  await page.route(`**/api/${group.path}/search`, handler, { times: 1 });
  return { held, release, done };
}

/** Hold the real replacement-account GET, not a synthetic stale marker. */
async function holdNextOrdinaryInvoiceList(page: Page, foreignInvoiceId: number) {
  let release!: () => void, started!: () => void, finished!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const held = new Promise<void>(resolve => { started = resolve; });
  const done = new Promise<void>(resolve => { finished = resolve; });
  await page.route(/\/api\/invoices(?:\?.*)?$/, async route => {
    try {
      expect(route.request().method()).toBe('GET');
      const response = await route.fetch(); expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.items.map((invoice: { id: number }) => invoice.id)).toEqual([foreignInvoiceId]);
      started(); await gate;
      try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }); } catch { /* Account/logout disposal may cancel the held ordinary read. */ }
    } finally { finished(); }
  }, { times: 1 });
  return { held, release, done };
}

for (const width of [1440, 360, 390]) {
  test(`matching-list keyboard handoffs preserve owned full lists and privacy at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(180_000); await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    const data = await fixture(page); const before = await snapshot(data.owner.id); const otherBefore = await snapshot(data.foreign.id); const probe = await privacyProbe(page);
    const customer = GROUPS[0], outbound = GROUPS[1], inbound = GROUPS[2];
    await beginList(page, customer, data.query);
    await expect(page.getByRole('button', { name: new RegExp(`^${data.query} Kunde \\d+ bearbeiten$`) }).filter({ visible: true })).toHaveCount(data.count);
    await expect(page.getByRole('button', { name: 'PRIVATE-FIELD-CUSTOMER bearbeiten', exact: true }).filter({ visible: true })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('FOREIGN-CUSTOMER');
    const edit = page.getByRole('button', { name: `${data.customers[0].name} bearbeiten`, exact: true }).filter({ visible: true });
    await clearFilteredListCaptureHeader(page, customer, data.query);
    await expect(notice(page, customer)).toBeFocused();
    await expect(page.getByRole('button', { name: new RegExp(`^${data.query} Kunde \\d+ bearbeiten$`) }).filter({ visible: true }).first()).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`record-search-filtered-customer-${width}.png`), fullPage: false });
    await edit.click(); await expect(page.getByRole('dialog', { name: 'Kunden bearbeiten', exact: true })).toBeVisible(); await page.keyboard.press('Escape');
    await expect(notice(page, customer)).toBeVisible(); await expect(edit).toBeFocused();
    await notice(page, customer).getByRole('button', { name: 'Suchfilter löschen', exact: true }).click();
    await expect(notice(page, customer)).toHaveCount(0); await expect(page.locator(customer.ordinary)).toBeVisible(); await expect(page.locator(customer.ordinary)).toBeFocused();
    await expect(page.getByRole('button', { name: 'PRIVATE-FIELD-CUSTOMER bearbeiten', exact: true }).filter({ visible: true })).toBeVisible();

    await beginList(page, outbound, data.query); const ledger = page.getByRole('region', { name: 'Ihre Rechnungen', exact: true });
    await expect(ledger).toContainText(`von ${data.count + 1} Rechnungen`); await expect(page.locator('#invoice-date-filter')).toHaveCount(0);
    await expect(ledger.locator('[aria-label="Zahlungsstatus"]')).toHaveCount(0); await expect(ledger).not.toContainText('PRIVATE-FIELD-OUTBOUND');
    await expect(ledger).not.toContainText('QUOTE-EXCLUDED'); await expect(ledger).not.toContainText('PROFORMA-EXCLUDED'); await expect(ledger).not.toContainText('FOREIGN-OUT');
    const detailsTrigger = page.locator(`[data-invoice-return="${data.outgoing.id}"]`).filter({ visible: true }).first();
    await clearFilteredListCaptureHeader(page, outbound, data.query);
    await expect(notice(page, outbound)).toBeFocused(); await expect(detailsTrigger).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`record-search-filtered-outbound-${width}.png`), fullPage: false });
    await detailsTrigger.click(); await expect(page.getByRole('dialog', { name: 'Rechnungsdetails', exact: true })).toContainText(data.outgoing.invoiceNumber); await page.keyboard.press('Escape');
    await expect(notice(page, outbound)).toBeVisible(); await expect(detailsTrigger).toBeFocused();
    await page.getByLabel('Pro Seite', { exact: true }).selectOption('10'); await ledger.getByRole('button', { name: 'Weiter', exact: true }).click();
    await expect(ledger).toContainText(`11–20 von ${data.count + 1} Rechnungen`);
    expect(probe.searches.some(request => new URL(request.url).pathname === '/api/invoices/search' && request.data.page === 2 && request.data.pageSize === 10)).toBe(true);
    await notice(page, outbound).getByRole('button', { name: 'Suchfilter löschen', exact: true }).click(); await expect(page.locator(outbound.ordinary)).toBeFocused();
    await expect(page.locator('#invoice-date-filter')).toBeVisible(); await expect(ledger.locator('[aria-label="Zahlungsstatus"]')).toBeVisible();

    await beginList(page, inbound, data.query); const sourceList = page.getByRole('list', { name: 'Eingangsbelege', exact: true });
    await expect(page.getByLabel('Prüfstatus', { exact: true })).toHaveValue('ALL'); await expect(page.getByLabel('Aufgabenart filtern', { exact: true })).toBeVisible(); await expect(page.getByLabel('Wiedervorlage filtern', { exact: true })).toBeVisible();
    await expect(sourceList.getByRole('button')).toHaveCount(25); await expect(sourceList).not.toContainText('PRIVATE-FIELD-INBOUND'); await expect(sourceList).not.toContainText('FOREIGN-IN');
    const sourceTrigger = page.locator(`[data-incoming-document-id="${data.incoming.id}"]`);
    await clearFilteredListCaptureHeader(page, inbound, data.query);
    await expect(notice(page, inbound)).toBeFocused(); await expect(sourceTrigger).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`record-search-filtered-inbound-${width}.png`), fullPage: false });
    await sourceTrigger.click(); await expect(review(page)).toBeVisible();
    await review(page).getByRole('button', { name: 'Zur Liste', exact: true }).click(); await expect(review(page)).toHaveCount(0); await expect(notice(page, inbound)).toBeVisible(); await expect(sourceTrigger).toBeFocused();
    await page.getByRole('button', { name: 'Nächste Belegseite', exact: true }).click(); await expect(page.getByRole('navigation', { name: 'Belegseiten', exact: true })).toContainText('Seite 2 von 2'); await expect(sourceList.getByRole('button')).toHaveCount(3);
    expect(probe.searches.some(request => new URL(request.url).pathname === '/api/purchase-documents/search' && request.data.page === 2)).toBe(true);
    await page.getByLabel('Aufgabenart filtern', { exact: true }).selectOption('CLARIFY'); await expect(sourceList.getByRole('button')).toHaveCount(2);
    await page.getByLabel('Wiedervorlage filtern', { exact: true }).selectOption('due'); await expect(sourceList.getByRole('button')).toHaveCount(1);
    await page.getByLabel('Prüfstatus', { exact: true }).selectOption('DISMISSED'); await expect(sourceList.getByRole('button')).toHaveCount(1); await expect(notice(page, inbound)).toBeVisible();
    await notice(page, inbound).getByRole('button', { name: 'Suchfilter löschen', exact: true }).click(); await expect(page.locator(inbound.ordinary)).toBeVisible(); await expect(page.locator(inbound.ordinary)).toBeFocused(); await expect(page.getByLabel('Prüfstatus', { exact: true })).toHaveValue('DISMISSED');

    // Memory is not a persisted filter, including history traversal and Reload.
    await staticDashboard(page); await beginList(page, customer, data.query); await staticDashboard(page);
    await page.goBack(); await expect(page).toHaveURL(/\/customers$/); await expect(notice(page, customer)).toHaveCount(0); await expect(page.locator(customer.ordinary)).toBeVisible();
    await page.goForward(); await expect(page).toHaveURL(/\/dashboard$/); await expect(page.getByRole('region', { name: /^Suchfilter ·/ })).toHaveCount(0);
    await beginList(page, inbound, data.query); await page.reload(); await expect(notice(page, inbound)).toHaveCount(0); await expect(page.locator(inbound.ordinary)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const group of GROUPS) {
      const requests = probe.searches.filter(request => new URL(request.url).pathname === `/api/${group.path}/search`); expect(requests.length).toBeGreaterThan(0);
      const response = await page.request.post(`/api/${group.path}/search`, { data: { query: data.query }, headers: group.type === 'outbound' ? { 'X-Bivaro-Payment-Contract': '3' } : {} });
      expect(response.status()).toBe(200); expect(response.headers()['cache-control']).toBe('private, no-store'); const body = await response.json();
      const rows = group.type === 'customer' ? body : group.type === 'outbound' ? body.items : body.documents;
      expect(rows.every((row: { id: number }) => row.id !== data.foreignIds[group.type])).toBe(true);
    }
    await assertPrivateTransport(page, data.query, probe); expect(await snapshot(data.owner.id)).toEqual(before); expect(await snapshot(data.foreign.id)).toEqual(otherBefore);
    expect(await (await page.request.get(`/api/invoices/download?id=${data.outgoing.id}&download=true`)).body()).toEqual(data.bytes);
    expect(await (await page.request.get(`/api/purchase-documents/${data.incoming.id}/original`)).body()).toEqual(data.bytes);
  });
}

for (const group of GROUPS) {
  test(`${group.title} empty matching list remains honestly filtered and explicitly clearable`, async ({ page }) => {
    test.setTimeout(90_000); const data = await fixture(page, 7); const before = await snapshot(data.owner.id); const probe = await privacyProbe(page);
    await page.route(`**/api/${group.path}/search`, async route => {
      const response = await route.fetch(); expect(response.status()).toBe(200); const body = await response.json();
      const empty = group.type === 'customer' ? [] : group.type === 'outbound' ? { ...body, items: [], total: 0 } : { ...body, documents: [], total: 0 };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(empty) });
    }, { times: 1 });
    await beginList(page, group, data.query);
    await expect(page.getByRole('heading', { name: group.type === 'customer' ? 'Keine Kunden gefunden' : group.type === 'outbound' ? 'Keine passenden Rechnungen' : 'Keine passenden Belege', exact: true })).toBeVisible();
    if (group.type === 'customer') await expect(page.getByRole('button', { name: 'Ersten Kunden anlegen', exact: true })).toHaveCount(0);
    await expect(notice(page, group)).toBeVisible();
    await notice(page, group).getByRole('button', { name: 'Suchfilter löschen', exact: true }).click();
    await expect(notice(page, group)).toHaveCount(0); await expect(page.locator(group.ordinary)).toBeVisible(); await expect(page.locator(group.ordinary)).toBeFocused();
    await assertPrivateTransport(page, data.query, probe); expect(await snapshot(data.owner.id)).toEqual(before);
  });

  test(`${group.title} list errors retry the same private POST and keep 401/stale data fail-closed`, async ({ page }) => {
    test.setTimeout(90_000); const data = await fixture(page, 7); const before = await snapshot(data.owner.id); const probe = await privacyProbe(page);
    await page.route(`**/api/${group.path}/search`, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"PRIVATE-EXCEPTION-DO-NOT-RENDER"}' }), { times: 1 });
    await beginList(page, group, data.query); const alert = page.getByRole('alert').filter({ visible: true }).last(); await expect(alert).toBeVisible(); await expect(alert).not.toContainText('PRIVATE-EXCEPTION');
    expect(probe.searches).toHaveLength(1); const first = probe.searches[0].data;
    await alert.getByRole('button', { name: group.retry, exact: true }).click();
    if (group.type === 'customer') await expect(page.getByRole('button', { name: `${data.customers[0].name} bearbeiten`, exact: true }).filter({ visible: true })).toBeVisible();
    else if (group.type === 'outbound') await expect(page.getByRole('region', { name: 'Ihre Rechnungen', exact: true })).toContainText(`von ${data.count + 1} Rechnungen`);
    else await expect(page.getByRole('list', { name: 'Eingangsbelege', exact: true }).getByRole('button')).toHaveCount(data.count + 1);
    expect(probe.searches.at(-1)!.data).toEqual(first);
    await page.route(`**/api/${group.path}/search`, route => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"PRIVATE-EXPIRED"}' }), { times: 1 });
    const expired = page.waitForResponse(response => new URL(response.url()).pathname === `/api/${group.path}/search` && response.status() === 401);
    await beginList(page, group, data.query); await expired; await expect(alert).toBeVisible(); await expect(alert).not.toContainText('PRIVATE-EXPIRED');
    if (group.type === 'customer') { await expect(alert).toContainText('Sitzung abgelaufen'); await expect(page.getByRole('button', { name: `${data.customers[0].name} bearbeiten`, exact: true }).filter({ visible: true })).toHaveCount(0); }
    else if (group.type === 'outbound') { await expect(alert).toContainText('Rechnungen konnten nicht geladen werden'); await expect(page.locator('[data-invoice-return]').filter({ visible: true })).toHaveCount(0); }
    else { await expect(alert).toContainText('Sitzung abgelaufen'); await expect(page.getByRole('list', { name: 'Eingangsbelege', exact: true })).toHaveCount(0); }
    await assertPrivateTransport(page, data.query, probe); expect(await snapshot(data.owner.id)).toEqual(before);
  });

  for (const discard of ['clear', 'navigation'] as const) {
    test(`held ${group.title} list cannot revive after ${discard}`, async ({ page }) => {
      test.setTimeout(90_000); const data = await fixture(page, 7); const before = await snapshot(data.owner.id); const probe = await privacyProbe(page);
      const marker = `STALE-${group.type}-${discard}-PRIVATE`; const pending = await holdNextList(page, group, data.query, marker);
      try {
        await beginList(page, group, data.query); await pending.held;
        if (discard === 'clear') { await notice(page, group).getByRole('button', { name: 'Suchfilter löschen', exact: true }).click(); await expect(page.locator(group.ordinary)).toBeVisible(); }
        else await staticDashboard(page);
        await expect(notice(page, group)).toHaveCount(0); pending.release(); await pending.done; await expect(page.locator('body')).not.toContainText(marker);
        await expect(page.getByRole('region', { name: /^Suchfilter ·/ })).toHaveCount(0);
        await assertPrivateTransport(page, data.query, probe); expect(await snapshot(data.owner.id)).toEqual(before);
      } finally { pending.release(); }
    });
  }

  test(`held ${group.title} list is discarded on real account replacement and real logout`, async ({ page, browser }, testInfo) => {
    test.setTimeout(120_000); const data = await fixture(page, 7); const before = await snapshot(data.owner.id); const probe = await privacyProbe(page);
    // Prime the real ordinary owner GET before the filtered handoff. Otherwise
    // a stale normal-list cache cannot be distinguished from a safe empty load.
    if (group.type === 'outbound') {
      const { dialog, input } = await openPalette(page); await input.fill('');
      await dialog.getByRole('option', { name: 'Rechnungen', exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard\?tab=invoices$/);
      await expect(page.locator(`[data-invoice-return="${data.outgoing.id}"]`).filter({ visible: true }).first()).toBeVisible();
      await expect(page.getByRole('region', { name: 'Ihre Rechnungen', exact: true })).toContainText(data.outgoing.invoiceNumber);
    }
    let siblingContext: BrowserContext | undefined;
    const old = await holdNextList(page, group, data.query, `OLD-OWNER-${group.type}-PRIVATE`);
    let ordinary: Awaited<ReturnType<typeof holdNextOrdinaryInvoiceList>> | undefined;
    let logout: Awaited<ReturnType<typeof holdNextList>> | undefined;
    try {
      await beginList(page, group, data.query); await old.held; const unchangedUrl = page.url();
      siblingContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL }); const sibling = await siblingContext.newPage(); await signIn(sibling, data.foreign.email, data.password);
      const session = await (await sibling.request.get('/api/auth/session')).json(); expect(session.user.id).toBe(data.foreign.id);
      const cookies = (await siblingContext.cookies()).filter(cookie => /^(?:__Secure-)?next-auth\.session-token(?:\.\d+)?$/.test(cookie.name)); expect(cookies.length).toBeGreaterThan(0);
      // Install before replacing cookies/revalidation, and intercept just one
      // normal invoice GET. The old filtered POST remains held throughout.
      if (group.type === 'outbound') ordinary = await holdNextOrdinaryInvoiceList(page, data.foreignIds.outbound);
      await page.context().addCookies(cookies);
      expect((await (await page.request.get('/api/auth/session')).json()).user.id).toBe(data.foreign.id);
      const foreignBefore = await snapshot(data.foreign.id);
      await page.bringToFront(); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      if (ordinary) {
        await ordinary.held; await expect(notice(page, group)).toHaveCount(0);
        // These are the real primed owner row and invoice number, not merely
        // the synthetic marker held in the separate filtered response.
        await expect(page.locator(`[data-invoice-return="${data.outgoing.id}"]`).filter({ visible: true })).toHaveCount(0);
        await expect(page.locator('body')).not.toContainText(data.outgoing.invoiceNumber);
        await expect(page).toHaveURL(unchangedUrl);
        ordinary.release(); await ordinary.done;
        await expect(page.locator(`[data-invoice-return="${data.foreignIds.outbound}"]`).filter({ visible: true }).first()).toBeVisible();
        await expect(page.getByRole('region', { name: 'Ihre Rechnungen', exact: true })).toContainText(`${data.query}-FOREIGN-OUT`);
        await expect(page).toHaveURL(unchangedUrl);
      } else await expect(notice(page, group)).toHaveCount(0);
      old.release(); await old.done; await expect(page).toHaveURL(unchangedUrl); await expect(page.locator('body')).not.toContainText(`OLD-OWNER-${group.type}-PRIVATE`);
      await expect(page.getByRole('region', { name: /^Suchfilter ·/ })).toHaveCount(0);
      logout = await holdNextList(page, group, data.query, `LOGGED-OUT-${group.type}-PRIVATE`); await beginList(page, group, data.query); await logout.held;
      const { dialog, input } = await openPalette(page); await input.fill(''); await dialog.getByRole('option', { name: 'Abmelden', exact: true }).click();
      await expect(page).toHaveURL(new URL('/', testInfo.project.use.baseURL).href); expect((await (await page.request.get('/api/auth/session')).json()).user).toBeUndefined();
      logout.release(); await logout.done; await expect(page.locator('body')).not.toContainText(`LOGGED-OUT-${group.type}-PRIVATE`); await expect(page.locator('body')).not.toContainText(`OLD-OWNER-${group.type}-PRIVATE`);
      await expect(page.getByRole('region', { name: /^Suchfilter ·/ })).toHaveCount(0); await assertPrivateTransport(page, data.query, probe);
      expect(await snapshot(data.owner.id)).toEqual(before); expect(await snapshot(data.foreign.id)).toEqual(foreignBefore);
    } finally { old.release(); ordinary?.release(); logout?.release(); await siblingContext?.close(); }
  });
}

test('dirty incoming Stay prevents all matching-list handoffs before any filtered read or navigation', async ({ page }) => {
  test.setTimeout(120_000); await page.setViewportSize({ width: 390, height: 844 }); const data = await fixture(page, 7); const before = await snapshot(data.owner.id); const probe = await privacyProbe(page);
  await page.goto(`/purchases?document=${data.incoming.id}`); await expect(review(page)).toBeVisible();
  const details = review(page).locator('summary').filter({ hasText: /^Prüfentwurf$/ }).locator('..');
  if ((await details.getAttribute('open')) === null) await details.locator(':scope > summary').click();
  const note = review(page).getByLabel('Prüfnotiz', { exact: true }); const draft = 'Keep this unsaved draft; a refused handoff must not begin.'; await note.fill(draft); const sourceUrl = page.url();
  for (const group of GROUPS) {
    const { dialog, input } = await openPalette(page); await input.fill(data.query);
    await chooseWithKeyboard(page, input, dialog.getByRole('option', { name: `Passende Liste öffnen · ${group.title}`, exact: true }));
    await expect(dialog).toBeHidden(); await expect(chooser(page)).toBeVisible(); await expect(chooser(page).getByRole('heading')).toBeFocused();
    await expect(page).toHaveURL(sourceUrl); expect(probe.searches).toHaveLength(0); await expect(page.getByRole('region', { name: /^Suchfilter ·/ })).toHaveCount(0);
    await chooser(page).getByRole('button', { name: 'Hier bleiben', exact: true }).click(); await expect(note).toHaveValue(draft); await expect(page).toHaveURL(sourceUrl); expect(probe.searches).toHaveLength(0);
  }
  const { dialog, input } = await openPalette(page); await input.fill(data.query); await chooseWithKeyboard(page, input, dialog.getByRole('option', { name: 'Passende Liste öffnen · Kunden', exact: true }));
  await expect(chooser(page)).toBeVisible(); await chooser(page).getByRole('button', { name: 'Änderungen verwerfen', exact: true }).click();
  await expect(notice(page, GROUPS[0])).toBeFocused(); await expect(page).toHaveURL(/\/customers$/); await expect(page.getByRole('button', { name: `${data.customers[0].name} bearbeiten`, exact: true }).filter({ visible: true })).toBeVisible(); expect(probe.searches).toHaveLength(1);
  await assertPrivateTransport(page, data.query, probe); expect(await snapshot(data.owner.id)).toEqual(before);
  expect(await (await page.request.get(`/api/purchase-documents/${data.incoming.id}/original`)).body()).toEqual(data.bytes);
});


test('open real invoice Details dispose owner selection synchronously on account replacement', async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000); await page.setViewportSize({ width: 1440, height: 1000 });
  const data = await fixture(page, 7); const ownerBefore = await snapshot(data.owner.id); const probe = await privacyProbe(page); const outbound = GROUPS[1];
  let siblingContext: BrowserContext | undefined;
  let ordinary: Awaited<ReturnType<typeof holdNextOrdinaryInvoiceList>> | undefined;
  try {
    await beginList(page, outbound, data.query);
    const ownerTrigger = page.locator(`[data-invoice-return="${data.outgoing.id}"]`).filter({ visible: true }).first();
    await expect(ownerTrigger).toBeVisible(); await ownerTrigger.click();
    const details = page.getByRole('dialog', { name: 'Rechnungsdetails', exact: true });
    await expect(details).toBeVisible(); await expect(details).toContainText(data.outgoing.invoiceNumber);
    const unchangedUrl = page.url();

    // Authenticate through real UI credentials in a sibling. Copy only its
    // server-issued session cookies; never forge a session or navigate/remount
    // the original page while the owner's actual Details selection is open.
    siblingContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
    const sibling = await siblingContext.newPage(); await signIn(sibling, data.foreign.email, data.password);
    expect((await (await sibling.request.get('/api/auth/session')).json()).user.id).toBe(data.foreign.id);
    const cookies = (await siblingContext.cookies()).filter(cookie => /^(?:__Secure-)?next-auth\.session-token(?:\.\d+)?$/.test(cookie.name));
    expect(cookies.length).toBeGreaterThan(0);
    const foreignBefore = await snapshot(data.foreign.id);
    ordinary = await holdNextOrdinaryInvoiceList(page, data.foreignIds.outbound);
    await page.context().addCookies(cookies);
    expect((await (await page.request.get('/api/auth/session')).json()).user.id).toBe(data.foreign.id);
    await page.bringToFront(); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

    // The foreign GET is genuine but still held. Privacy must not wait for its
    // response to hide either the old modal selection or the actual owner row.
    await ordinary.held; await expect(details).toHaveCount(0); await expect(notice(page, outbound)).toHaveCount(0);
    await expect(page.locator(`[data-invoice-return="${data.outgoing.id}"]`)).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(data.outgoing.invoiceNumber);
    await expect(page).toHaveURL(unchangedUrl);
    ordinary.release(); await ordinary.done;

    const foreignTrigger = page.locator(`[data-invoice-return="${data.foreignIds.outbound}"]`).filter({ visible: true }).first();
    await expect(foreignTrigger).toBeVisible(); await expect(page.getByRole('region', { name: 'Ihre Rechnungen', exact: true })).toContainText(`${data.query}-FOREIGN-OUT`);
    await expect(details).toHaveCount(0); await expect(page).toHaveURL(unchangedUrl);
    await foreignTrigger.click(); await expect(details).toBeVisible();
    await expect(details).toContainText(`${data.query}-FOREIGN-OUT`); await expect(details).not.toContainText(data.outgoing.invoiceNumber);
    await page.keyboard.press('Escape'); await expect(details).toHaveCount(0); await expect(foreignTrigger).toBeFocused();
    await expect(notice(page, outbound)).toHaveCount(0); await expect(page).toHaveURL(unchangedUrl);
    await assertPrivateTransport(page, data.query, probe);
    expect(await snapshot(data.owner.id)).toEqual(ownerBefore); expect(await snapshot(data.foreign.id)).toEqual(foreignBefore);
  } finally { ordinary?.release(); await siblingContext?.close(); }
});

test('filtered invoice notice spans both wide-screen columns without shrinking the ledger', async ({ page }) => {
  test.setTimeout(90_000); await page.setViewportSize({ width: 1920, height: 1080 });
  const data = await fixture(page, 7); const before = await snapshot(data.owner.id);
  await beginList(page, GROUPS[1], data.query);
  const ledger = page.getByRole('region', { name: 'Ihre Rechnungen', exact: true });
  await expect(page.locator(`[data-invoice-return="${data.outgoing.id}"]`).filter({ visible: true }).first()).toBeVisible();
  const tools = page.getByRole('complementary', { name: 'Weitere Rechnungswerkzeuge', exact: true });
  const [noticeBox, ledgerBox, toolsBox] = await Promise.all([notice(page, GROUPS[1]).boundingBox(), ledger.boundingBox(), tools.boundingBox()]);
  expect(noticeBox).not.toBeNull(); expect(ledgerBox).not.toBeNull(); expect(toolsBox).not.toBeNull();
  expect(ledgerBox!.width).toBeGreaterThan(900);
  expect(noticeBox!.width).toBeGreaterThan(ledgerBox!.width);
  expect(Math.abs(ledgerBox!.x - noticeBox!.x)).toBeLessThan(2);
  expect(toolsBox!.x).toBeGreaterThanOrEqual(ledgerBox!.x + ledgerBox!.width - 1);
  expect(ledgerBox!.y).toBeGreaterThanOrEqual(noticeBox!.y + noticeBox!.height - 1);
  expect(await snapshot(data.owner.id)).toEqual(before);
});

test.afterAll(async () => { await prisma.$disconnect(); });
