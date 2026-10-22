import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../lib/password';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';

// For the existing isolated hosted acceptance runner; never target real tenants.
// This spec does not change the workflow, launch a build or claim browser evidence.
async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login'); await page.getByLabel('E-Mail').fill(email); await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click(); await expect(page).toHaveURL(/\/dashboard/);
}
async function openPalette(page: Page) {
  // A hard navigation initially renders the SessionProvider loading shell,
  // before the authenticated palette and its key listener exist. Wait for the
  // real authenticated trigger; do not retry/toggle a missed shortcut.
  await expect(page.getByRole('button', { name: 'Befehlspalette öffnen', exact: true }).filter({ visible: true }).first()).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Befehlspalette', exact: true });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole('combobox'); await expect(input).toBeFocused();
  return { dialog, input };
}
async function snapshot(userId: string) {
  return { invoices: await prisma.invoice.findMany({ where: { userId }, orderBy: { id: 'asc' } }), receipts: await prisma.purchaseDocument.findMany({ where: { userId }, orderBy: { id: 'asc' } }), customers: await prisma.customer.findMany({ where: { userId }, orderBy: { id: 'asc' } }), audit: await prisma.auditLog.count({ where: { userId } }), payments: await prisma.paymentJournalEvent.count({ where: { userId } }), incomes: await prisma.income.count({ where: { userId } }), expenses: await prisma.expense.count({ where: { userId } }) };
}

test('record search is bounded, owned and read-only with keyboard/mobile/navigation/retry/stale/session handling', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const password = 'SyntheticRecordSearch123!';
  const owner = await prisma.user.create({ data: { email: `record-owner-${randomUUID()}@example.test`, name: 'Synthetic search owner', password: await hashPassword(password), role: 'USER' } });
  const foreign = await prisma.user.create({ data: { email: `record-foreign-${randomUUID()}@example.test`, name: 'Synthetic other account', password: await hashPassword(password), role: 'USER' } });
  try {
    const customers: { id: number; name: string }[] = [];
    for (let i = 0; i < 7; i++) customers.push(await prisma.customer.create({ data: { userId: owner.id, name: `SYN-SEARCH Kunde ${i}`, internalNote: 'PRIVATE-NOTE-NOT-SEARCHABLE' } }));
    const foreignCustomer = await prisma.customer.create({ data: { userId: foreign.id, name: 'SYN-SEARCH FOREIGN-PRIVATE' } });
    await prisma.customer.create({ data: { userId: owner.id, name: 'SYN-東京 %_\\' } });
    const foreignInvoice = await prisma.invoice.create({ data: { userId: foreign.id, invoiceNumber: 'SYN-SEARCH-OUT', fileName: 'foreign-private.pdf', storedFileName: 'foreign-private.pdf', parsedData: {} } });
    await page.setViewportSize({ width: 1440, height: 1000 }); await signIn(page, owner.email, password);
    const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = await pdf.save();
    const outboundResponse = await page.request.post('/api/invoices', { data: { fileName: 'synthetic-search.pdf', invoiceNumber: 'SYN-SEARCH-OUT', parsedData: { currency: 'EUR' }, totalAmount: 10, pdfBytes: Buffer.from(bytes).toString('base64') } });
    expect(outboundResponse.status()).toBe(200); const outbound = await outboundResponse.json();
    const upload = await page.request.post('/api/purchase-documents', { multipart: { file: { name: 'SYN-SEARCH-IN.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) }, uploadRequestId: randomUUID() } });
    expect(upload.status()).toBe(201); const inbound = (await upload.json()).document;
    const foreignReceipt = await prisma.purchaseDocument.create({ data: { userId: foreign.id, invoiceNumber: 'SYN-SEARCH-OUT', originalFileName: 'SYN-SEARCH-FOREIGN.pdf', storedFileName: 'foreign-private.pdf', originalSha256: 'a'.repeat(64), originalByteCount: 12, mediaType: 'application/pdf', uploadRequestId: randomUUID() } });
    const before = await snapshot(owner.id);
    const original = await (await page.request.get(`/api/invoices/download?id=${outbound.id}&download=true`)).body();
    const requests: { url: string; method: string; data: unknown }[] = [];
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/record-search') requests.push({ url: request.url(), method: request.method(), data: request.postDataJSON() }); });

    let { dialog, input } = await openPalette(page);
    await expect(dialog.getByRole('option', { name: 'Dashboard öffnen', exact: true })).toBeVisible();
    await input.fill('ab'); await page.waitForTimeout(350); expect(requests).toHaveLength(0);
    await expect(dialog.getByRole('status')).toContainText('ab 3 Zeichen');
    await input.fill('SYN-SEARCH');
    await expect(dialog.locator('[cmdk-group]').filter({ hasText: 'Datensätze · Kunden' }).getByRole('option')).toHaveCount(6);
    await expect(dialog.getByText('Weitere Treffer vorhanden · Alle Kunden öffnen (ungefiltert)', { exact: true })).toBeVisible();
    await expect(dialog).not.toContainText('FOREIGN-PRIVATE');
    await expect(dialog.getByRole('option', { name: 'SYN-SEARCH-OUT', exact: false })).toBeVisible();
    await expect(dialog.getByRole('option', { name: 'SYN-SEARCH-IN.pdf', exact: false })).toBeVisible();
    expect(requests.every(request => request.method === 'POST' && !request.url.includes('SYN-SEARCH') && !request.url.includes('?'))).toBe(true);
    const isolation = await page.request.post('/api/record-search', { data: { query: 'SYN-SEARCH' } }); const projected = await isolation.json();
    expect(projected.groups.flatMap((group: { items: { id: number; type: string }[] }) => group.items).some((item: { id: number; type: string }) => item.type === 'customer' && item.id === foreignCustomer.id || item.type === 'outbound' && item.id === foreignInvoice.id || item.type === 'inbound' && item.id === foreignReceipt.id)).toBe(false);
    expect((await page.request.get(`/api/invoices?document=${foreignInvoice.id}`)).status()).toBe(200);
    expect((await (await page.request.get(`/api/invoices?document=${foreignInvoice.id}`)).json()).items).toEqual([]);
    expect((await page.request.get(`/api/purchase-documents/${foreignReceipt.id}`)).status()).toBe(404);
    expect((await page.request.get(`/api/invoices/download?id=${foreignInvoice.id}&download=true`)).status()).toBe(404);

    for (const width of [360, 390, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await expect(input).toBeInViewport(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width !== 360) await page.screenshot({ path: testInfo.outputPath(`record-search-${width}.png`), fullPage: false });
    }
    await input.fill('SYN-SEARCH '); await expect(dialog.getByRole('option', { name: 'SYN-SEARCH-OUT', exact: false })).toBeVisible();
    await input.fill(' SYN-SEARCH'); await expect(dialog.getByRole('option', { name: 'SYN-SEARCH-OUT', exact: false })).toBeVisible();
    await page.keyboard.press('Escape'); await page.goto('/customers');
    ({ dialog, input } = await openPalette(page));
    await input.fill('SYN-SEARCH Kunde 0');
    await expect(dialog.getByRole('option', { name: 'SYN-SEARCH Kunde 0', exact: false })).toBeVisible();
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/customers\\?customer=${customers[0].id}`));
    await expect(page.getByText('Ausgewählter Kunde', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'SYN-SEARCH Kunde 0 bearbeiten', exact: true }).filter({ visible: true })).toBeVisible();
    // App Router history transitions do not perform a document load. Observe
    // each destination before issuing the next history operation or Reload.
    await page.goBack(); await expect(page).toHaveURL(/\/customers$/);
    await expect(page.getByRole('button', { name: 'SYN-SEARCH Kunde 1 bearbeiten', exact: true }).filter({ visible: true })).toBeVisible();
    await page.goForward(); await expect(page).toHaveURL(new RegExp(`/customers\\?customer=${customers[0].id}`));
    await expect(page.getByText('Ausgewählter Kunde', { exact: true })).toBeVisible();
    await page.reload(); await expect(page).toHaveURL(new RegExp(`/customers\\?customer=${customers[0].id}`));
    await expect(page.getByText('Ausgewählter Kunde', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'SYN-SEARCH Kunde 0 bearbeiten', exact: true }).filter({ visible: true })).toBeVisible();
    await page.goto(`/customers?customer=${foreignCustomer.id}`); await expect(page.getByText('Kunde nicht gefunden oder nicht verfügbar.', { exact: true })).toBeVisible(); await expect(page.getByText(foreignCustomer.name, { exact: true })).toHaveCount(0);
    await page.goto('/dashboard');
    ({ dialog, input } = await openPalette(page)); await input.fill('SYN-SEARCH-OUT');
    const selectedRead = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === '/api/invoices' && url.searchParams.get('document') === String(outbound.id); });
    await dialog.getByRole('option', { name: 'SYN-SEARCH-OUT', exact: false }).click();
    await expect(page).toHaveURL(new RegExp(`tab=invoices&document=${outbound.id}`));
    const selectedResponse = await selectedRead; expect(selectedResponse.status()).toBe(200); const selectedData = await selectedResponse.json(); expect(selectedData.items.map((item: { id: number }) => item.id)).toEqual([outbound.id]);
    await page.getByRole('button', { name: 'Details', exact: true }).filter({ visible: true }).click();
    const details = page.getByRole('dialog', { name: 'Rechnungsdetails', exact: true }); await expect(details).toBeVisible(); await expect(details).toContainText('Rechnung SYN-SEARCH-OUT'); await expect(details).toContainText('synthetic-search.pdf'); await page.keyboard.press('Escape');
    // The existing selected-list API deliberately uses 200 + empty items for
    // unavailable IDs. Its original-download endpoint rejects the same foreign
    // ID with 404; neither the list nor real detail surface may reveal a row.
    const foreignRead = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === '/api/invoices' && url.searchParams.get('document') === String(foreignInvoice.id); });
    await page.goto(`/dashboard?tab=invoices&document=${foreignInvoice.id}`);
    const foreignResponse = await foreignRead; expect(foreignResponse.status()).toBe(200); expect((await foreignResponse.json()).items).toEqual([]);
    await expect(page.getByRole('button', { name: 'Details', exact: true }).filter({ visible: true })).toHaveCount(0);
    await expect(page.getByText('foreign-private.pdf', { exact: true })).toHaveCount(0);
    ({ dialog, input } = await openPalette(page)); await input.fill('SYN-SEARCH-IN'); await dialog.getByRole('option', { name: 'SYN-SEARCH-IN.pdf', exact: false }).click(); await expect(page).toHaveURL(new RegExp(`/purchases\\?document=${inbound.id}`)); await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape');
    ({ dialog, input } = await openPalette(page)); await input.fill('no-synthetic-match'); await expect(dialog.getByRole('status')).toContainText('Keine eigenen Datensätze');
    await input.fill('%_\\'); await expect(dialog.getByRole('option', { name: 'SYN-東京 %_\\', exact: false })).toBeVisible();
    await input.fill('東京 %'); await expect(dialog.getByRole('option', { name: 'SYN-東京 %_\\', exact: false })).toBeVisible();
    await input.fill('x'.repeat(110)); expect((await input.inputValue()).length).toBe(100);

    await page.route('**/api/record-search', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }), { times: 1 });
    await input.fill('SYN-SEARCH'); await expect(dialog.getByRole('status')).toContainText('Suche nicht verfügbar');
    await dialog.getByRole('option', { name: 'Suche erneut versuchen', exact: true }).click(); await expect(dialog.getByRole('option', { name: 'SYN-SEARCH-OUT', exact: false })).toBeVisible();
    // A late old result must not replace newer input, even if transport ignores abort.
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    let started!: () => void; const held = new Promise<void>(resolve => { started = resolve; });
    await page.route('**/api/record-search', async route => { if (route.request().postDataJSON().query === 'OLD-SYNTHETIC') { started(); await gate; try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ groups: [{ type: 'customer', hasMore: false, items: [{ type: 'customer', id: 999999, label: 'OLD-PRIVATE-RESULT', href: '/customers?customer=999999' }] }] }) }); } catch { /* Browser may cancel aborted route. */ } } else await route.continue(); });
    await input.fill('OLD-SYNTHETIC'); await held; await input.fill('SYN-SEARCH'); await expect(dialog.getByRole('option', { name: 'SYN-SEARCH-OUT', exact: false })).toBeVisible(); release(); await page.waitForTimeout(100); await expect(dialog).not.toContainText('OLD-PRIVATE-RESULT');
    let closeRelease!: () => void; const closeGate = new Promise<void>(resolve => { closeRelease = resolve; });
    let closeStarted!: () => void; const closeHeld = new Promise<void>(resolve => { closeStarted = resolve; });
    await page.route('**/api/record-search', async route => { if (route.request().postDataJSON().query === 'CLOSE-SYNTHETIC') { closeStarted(); await closeGate; try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ groups: [{ type: 'customer', hasMore: false, items: [{ type: 'customer', id: 999999, label: 'CLOSED-PRIVATE-RESULT', href: '/customers?customer=999999' }] }] }) }); } catch { /* Aborted browser request. */ } } else await route.continue(); });
    await input.fill('CLOSE-SYNTHETIC'); await closeHeld;
    await page.keyboard.press('Escape'); ({ dialog, input } = await openPalette(page)); closeRelease(); await expect(input).toHaveValue(''); await expect(dialog).not.toContainText('SYN-SEARCH-OUT'); await expect(dialog).not.toContainText('CLOSED-PRIVATE-RESULT');
    await input.fill('SYN-SEARCH'); await expect(dialog.getByRole('option', { name: 'SYN-SEARCH-OUT', exact: false })).toBeVisible();
    await page.route('**/api/record-search', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }), { times: 1 });
    await input.fill('EXPIRED-SYNTHETIC'); await expect(dialog.getByRole('status')).toContainText('Sitzung abgelaufen'); await expect(dialog).not.toContainText('SYN-SEARCH-OUT');
    await page.keyboard.press('Escape');
    const trigger = page.getByRole('button', { name: 'Befehlspalette öffnen', exact: true }).filter({ visible: true }).first();
    await trigger.focus(); await trigger.click(); await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
    expect(await snapshot(owner.id)).toEqual(before);
    expect((await (await page.request.get(`/api/invoices/download?id=${outbound.id}&download=true`)).body()).equals(original)).toBe(true);
    expect(await page.evaluate(() => Object.values(localStorage).concat(Object.values(sessionStorage)).some(value => String(value).includes('SYN-SEARCH')))).toBe(false);

    // Keep actual logout separate from authenticated account replacement.
    // The real palette action must end the owner session, redirect to the
    // public page and clear search content; a login never masks that assertion.
    ({ dialog, input } = await openPalette(page)); await input.fill('SYN-SEARCH');
    await expect(dialog.getByRole('option', { name: 'SYN-SEARCH-OUT', exact: false })).toBeVisible();
    await input.fill(''); await dialog.getByRole('option', { name: 'Abmelden', exact: true }).click();
    await expect(page).toHaveURL(new URL('/', testInfo.project.use.baseURL).href);
    await expect(dialog).toBeHidden();
    const loggedOut = await (await page.request.get('/api/auth/session')).json();
    expect(loggedOut.user).toBeUndefined();
    await expect(page.locator('body')).not.toContainText('SYN-SEARCH');
    await signIn(page, owner.email, password);

    // Replace an authenticated cookie directly through a real independent UI
    // login, without an intervening anonymous-session redirect race. Revalidate
    // the original SessionProvider without navigating that page; old in-flight
    // results must not render under the newly authenticated identity.
    ({ dialog, input } = await openPalette(page)); await input.fill('SYN-SEARCH'); await expect(dialog.getByRole('option', { name: 'SYN-SEARCH-OUT', exact: false })).toBeVisible();
    let accountRelease!: () => void; const accountGate = new Promise<void>(resolve => { accountRelease = resolve; });
    let accountStarted!: () => void; const accountHeld = new Promise<void>(resolve => { accountStarted = resolve; });
    await page.route('**/api/record-search', async route => { if (route.request().postDataJSON().query === 'ACCOUNT-OLD') { accountStarted(); await accountGate; try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ groups: [{ type: 'customer', hasMore: false, items: [{ type: 'customer', id: customers[0].id, label: 'ACCOUNT-PRIVATE-OLD', href: `/customers?customer=${customers[0].id}` }] }] }) }); } catch { /* Aborted prior-account transport. */ } } else await route.continue(); });
    await input.fill('ACCOUNT-OLD'); await accountHeld;
    const unchangedUrl = page.url();
    const sibling = await page.context().newPage();
    await signIn(sibling, foreign.email, password);
    const replacement = await (await sibling.request.get('/api/auth/session')).json();
    expect(replacement.user.id).toBe(foreign.id);
    await page.bringToFront(); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(dialog).toBeHidden(); accountRelease();
    await expect(page).toHaveURL(unchangedUrl);
    ({ dialog, input } = await openPalette(page)); await expect(input).toHaveValue(''); await input.fill('SYN-SEARCH'); await expect(dialog.getByRole('option', { name: foreignCustomer.name, exact: false })).toBeVisible(); await expect(dialog).not.toContainText('SYN-SEARCH Kunde 0'); await expect(dialog).not.toContainText('SYN-SEARCH-IN.pdf'); await expect(dialog).not.toContainText('ACCOUNT-PRIVATE-OLD');
    await sibling.close();
  } finally { await prisma.$disconnect(); }
});
