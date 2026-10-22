import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../lib/password';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import type { IncomingDocument } from '../lib/purchase-documents/types';

// Only the runner's isolated synthetic database is permitted. No original from
// an existing business/account is read, overwritten, or submitted for analysis.
async function signIn(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const password = 'SyntheticSequence123!';
  const user = await prisma.user.create({ data: { name: 'Synthetic sequence owner', email: `sequence-${randomUUID()}@example.test`, password: await hashPassword(password), role: 'USER' } });
  await page.goto('/login'); await page.getByLabel('E-Mail').fill(user.email); await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click(); await expect(page).toHaveURL(/\/dashboard/);
  return user;
}
async function upload(page: Page, number: number, prefix = 'sequence') {
  const fixture = await readFile('lib/__tests__/fixtures/incoming-validation/valid-ubl.xml', 'utf8');
  const response = await page.request.post('/api/purchase-documents', { multipart: { file: { name: `${prefix}-${number}.xml`, mimeType: 'application/xml', buffer: Buffer.from(fixture.replace('SYNTHETIC-UBL-001', `${prefix.toUpperCase()}-${number}`)) }, uploadRequestId: randomUUID(), analysisMode: 'manual' } });
  expect(response.status(), await response.text()).toBe(201); return (await response.json()).document as IncomingDocument;
}
const review = (page: Page) => page.getByRole('dialog', { name: 'Eingangsbeleg prüfen', exact: true });
const chooser = (page: Page) => page.getByRole('alertdialog', { name: 'Ungespeicherter Prüfentwurf', exact: true });
async function draft(page: Page) {
  const details = review(page).locator('summary').filter({ hasText: /^Prüfentwurf$/ }).locator('..');
  if ((await details.getAttribute('open')) === null) await details.locator(':scope > summary').click();
  return review(page).getByLabel('Prüfnotiz', { exact: true });
}
async function noFinancialWrites(userId: string) {
  expect(await Promise.all([prisma.expense.count({ where: { userId } }), prisma.income.count({ where: { userId } }), prisma.cashTransaction.count({ where: { userId } }), prisma.invoice.count({ where: { userId } })])).toEqual([0, 0, 0, 0]);
}

test('page-bounded filtered receipt sequence saves safely after unknown response and skips changed originals', async ({ page }, testInfo) => {
  test.setTimeout(180_000); const user = await signIn(page);
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.emulateMedia({ colorScheme: 'light' });
  const originals: IncomingDocument[] = [];
  for (let number = 1; number <= 28; number++) originals.push(await upload(page, number));
  await upload(page, 1, 'unrelated');
  await page.goto('/purchases?search=sequence&page=2');
  const rows = page.getByRole('list', { name: 'Eingangsbelege', exact: true }).getByRole('button');
  await expect(rows).toHaveCount(3); const trigger = rows.first(); await trigger.scrollIntoViewIfNeeded();
  const originalScroll = await page.evaluate(() => window.scrollY); await trigger.focus(); await page.keyboard.press('Enter');
  await expect(review(page)).toContainText('Prüffolge dieser Listenseite · 1 von 3');
  await expect(review(page)).toContainText('sequence-3.xml');
  await (await draft(page)).fill('Synthetic sequential review; not posted.');
  await review(page).getByLabel('Bruttobetrag (EUR)', { exact: true }).fill('not-money');
  await review(page).getByRole('button', { name: 'Entwurf speichern & nächster', exact: true }).click();
  await expect(review(page).getByRole('alert')).toContainText('positiver EUR-Betrag');
  await expect(page).toHaveURL(new RegExp(`document=${originals[2].id}`));
  await review(page).getByLabel('Bruttobetrag (EUR)', { exact: true }).fill('0,29');
  let saveWrites = 0;
  await page.route(`**/api/purchase-documents/${originals[2].id}/review-draft`, async route => {
    saveWrites++;
    if (saveWrites === 1) { const saved = await route.fetch(); expect(saved.status()).toBe(200); await route.abort('failed'); }
    else await route.continue();
  });
  await review(page).getByRole('button', { name: 'Entwurf speichern & nächster', exact: true }).click();
  await expect(review(page).getByRole('alert')).toContainText('Speicherung ist nicht bestätigt');
  await expect(review(page).getByLabel('Prüfnotiz', { exact: true })).toHaveValue('Synthetic sequential review; not posted.');
  const saved = await prisma.purchaseDocument.findUniqueOrThrow({ where: { id: originals[2].id } });
  await review(page).getByRole('button', { name: 'Entwurf speichern & nächster', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(review(page)).toContainText('sequence-2.xml'); expect(saveWrites).toBe(1);
  expect((await prisma.purchaseDocument.findUniqueOrThrow({ where: { id: saved.id } })).revision).toBe(saved.revision);
  const dismissed = await page.request.post(`/api/purchase-documents/${originals[0].id}/dismiss`, { data: { expectedRevision: originals[0].revision, reason: 'Synthetic changed in another tab' } }); expect(dismissed.status()).toBe(200);
  await upload(page, 99); // New arrival must not enter or reorder the active snapshot.
  await review(page).getByRole('button', { name: 'Nächster', exact: true }).click();
  await expect(review(page)).toContainText('Ende dieser Prüffolge'); await expect(review(page)).toContainText('sequence-2.xml');
  await review(page).getByRole('button', { name: 'Vorheriger', exact: true }).click(); await expect(review(page)).toContainText('sequence-3.xml');
  await expect(review(page).getByLabel('Bruttobetrag (EUR)', { exact: true })).toHaveValue('0.29');
  let nextReads = 0; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/purchase-documents/${originals[1].id}`, async route => {
    nextReads++; if (nextReads === 1) { await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }); return; }
    await gate; await route.continue();
  });
  await review(page).getByRole('button', { name: 'Nächster', exact: true }).click();
  await expect(review(page)).toContainText('Navigation erneut versuchen'); await expect(review(page)).toContainText('sequence-3.xml');
  await review(page).getByRole('button', { name: 'Nächster', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect.poll(() => nextReads).toBe(2);
  await expect(review(page).getByRole('button', { name: 'Als Ausgabe erfassen', exact: true })).toBeDisabled();
  release(); await expect(review(page)).toContainText('sequence-2.xml');
  await review(page).getByRole('button', { name: 'Vorheriger', exact: true }).click(); await expect(review(page)).toContainText('sequence-3.xml');
  await review(page).getByRole('button', { name: 'Zur Liste', exact: true }).click(); await expect(review(page)).toHaveCount(0);
  const returningRow = page.locator(`[data-incoming-document-id="${originals[2].id}"]`);
  await expect(returningRow).toBeFocused();
  const restoredScroll = await page.evaluate(() => ({ y: scrollY, max: document.documentElement.scrollHeight - innerHeight }));
  expect(Math.abs(restoredScroll.y - Math.min(originalScroll, restoredScroll.max))).toBeLessThanOrEqual(2);
  await returningRow.click();
  await expect(page).toHaveURL(new RegExp(`document=${originals[2].id}`));
  await expect(review(page)).toContainText('sequence-3.xml');
  await page.reload(); await expect(review(page).getByLabel('Prüfnotiz', { exact: true })).toHaveValue('Synthetic sequential review; not posted.');
  await review(page).locator('footer[aria-label="Belegnavigation"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('receipt-sequence-desktop-1440.png'), animations: 'disabled' });
  await review(page).getByRole('button', { name: 'Zur Liste', exact: true }).click(); await expect(review(page)).toHaveCount(0);
  await expect(page).toHaveURL(/search=sequence&page=2$/); await expect(page.getByLabel('Lieferant, Rechnungsnummer oder Dateiname', { exact: true })).toHaveValue('sequence');
  // Reload has intentionally rebuilt DOM/queue: focus returns to the list heading.
  await expect(page.getByRole('heading', { name: 'Offene Prüfung', exact: true })).toBeFocused();
  await noFinancialWrites(user.id);
});

test('dirty keyboard Back/Forward preserves entries, allows stay/discard and keeps failed-save input on mobile', async ({ page }, testInfo) => {
  test.setTimeout(120_000); const user = await signIn(page); const first = await upload(page, 1); await upload(page, 2);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => {
    const state = window as Window & { navigation?: { currentEntry?: { index: number } }; receiptTraversalTrace?: Array<{ path: string; index?: number; kind: string }> };
    const trace = (kind: string) => (state.receiptTraversalTrace ??= []).push({ kind, path: location.pathname + location.search, index: state.navigation?.currentEntry?.index });
    trace('dashboard'); window.addEventListener('popstate', () => trace('pop'), true);
  });
  // This link stays in the same app document, exercising the actual app-router popstate boundary.
  await page.locator('a[href="/purchases"]').first().click(); await expect(page).toHaveURL(/\/purchases$/);
  await page.getByRole('list', { name: 'Eingangsbelege', exact: true }).getByRole('button').first().click();
  await page.setViewportSize({ width: 390, height: 844 });
  await (await draft(page)).fill('Keep this draft while deciding.');
  await page.evaluate(() => {
    const state = window as Window & { navigation?: { currentEntry?: { index: number } }; receiptTraversalTrace?: Array<{ path: string; index?: number; kind: string }> };
    state.receiptTraversalTrace?.push({ kind: 'before-back', path: location.pathname + location.search, index: state.navigation?.currentEntry?.index });
    window.history.back();
  });
  try { await expect(chooser(page)).toBeVisible(); } catch (failure) {
    const diagnostic = await page.evaluate(() => {
      const state = window as Window & { navigation?: { currentEntry?: { index: number } }; receiptTraversalTrace?: unknown };
      return { path: location.pathname + location.search, index: state.navigation?.currentEntry?.index, trace: state.receiptTraversalTrace, reviewOpen: !!document.querySelector('[role=dialog]'), unsavedLabel: document.body.textContent?.includes('Ungespeicherte Änderungen'), noteRetained: (document.querySelector('#review-draft-note') as HTMLTextAreaElement | null)?.value === 'Keep this draft while deciding.' };
    });
    throw new Error(`Dirty Back must retain review and show explicit choices: ${JSON.stringify(diagnostic)}`, { cause: failure });
  }
  await expect(chooser(page).getByRole('heading')).toBeFocused(); await chooser(page).getByRole('button', { name: 'Hier bleiben', exact: true }).click();
  await expect(review(page).getByLabel('Prüfnotiz', { exact: true })).toHaveValue('Keep this draft while deciding.');
  const sourceEntry = page.url();
  await review(page).getByRole('button', { name: 'Zur Liste', exact: true }).click();
  await expect(chooser(page)).toBeVisible(); await expect(page).toHaveURL(sourceEntry);
  await chooser(page).getByRole('button', { name: 'Hier bleiben', exact: true }).click();
  await expect(page).toHaveURL(sourceEntry); // preflight never tentatively replaces the source entry
  await page.evaluate(() => window.history.back()); await expect(chooser(page)).toBeVisible();
  await page.route('**/review-draft', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }), { times: 1 });
  await chooser(page).getByRole('button', { name: 'Speichern & weiter', exact: true }).click();
  await expect(chooser(page)).toBeVisible(); await expect(review(page).getByRole('alert')).toContainText('Speicherung ist nicht bestätigt');
  await expect(review(page).getByLabel('Prüfnotiz', { exact: true })).toHaveValue('Keep this draft while deciding.');
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await review(page).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
  await chooser(page).scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath('receipt-sequence-mobile-390.png'), animations: 'disabled' });
  await chooser(page).getByRole('button', { name: 'Hier bleiben', exact: true }).click();
  // Reload stays native: cancelling the browser warning must retain the draft.
  page.once('dialog', prompt => prompt.dismiss()); await page.reload().catch(() => {});
  await expect(review(page).getByLabel('Prüfnotiz', { exact: true })).toHaveValue('Keep this draft while deciding.');
  await page.evaluate(() => window.history.back()); await expect(chooser(page)).toBeVisible();
  await chooser(page).getByRole('button', { name: 'Änderungen verwerfen', exact: true }).click(); await expect(page).toHaveURL(/\/dashboard$/);
  await page.goForward(); await expect(review(page)).toBeVisible(); await expect(await draft(page)).toHaveValue('');
  await page.keyboard.press('Escape'); await expect(review(page)).toHaveCount(0);
  expect((await prisma.purchaseDocument.findUniqueOrThrow({ where: { id: first.id } })).reviewDraft).toBeNull();
  await noFinancialWrites(user.id);
});

test.afterAll(async () => { await prisma.$disconnect(); });

test('unsupported browser keeps existing single-document draft editing and only gates the new sequence', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => { Object.defineProperty(window, 'navigation', { configurable: true, value: undefined }); });
  const user = await signIn(page); const source = await upload(page, 1);
  await page.goto('/purchases'); await page.getByRole('list', { name: 'Eingangsbelege', exact: true }).getByRole('button').first().click();
  await expect(review(page)).toContainText('Serienprüfung benötigt einen aktuellen Browser; Einzelprüfung weiterhin verfügbar.');
  await expect(review(page).getByRole('button', { name: 'Entwurf speichern & nächster', exact: true })).toHaveCount(0);
  await (await draft(page)).fill('Existing single review remains editable.');
  await review(page).getByRole('button', { name: 'Prüfentwurf speichern', exact: true }).click();
  await expect(review(page).getByText('Prüfentwurf gespeichert · nicht gebucht', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(review(page)).toHaveCount(0);
  expect((await prisma.purchaseDocument.findUniqueOrThrow({ where: { id: source.id } })).reviewDraft).toMatchObject({ note: 'Existing single review remains editable.' });
  await noFinancialWrites(user.id);
});

test('unsupported-index same-workspace Back/Forward never compensates by replacing another history entry', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => { Object.defineProperty(window, 'navigation', { configurable: true, value: undefined }); });
  const user = await signIn(page); const older = await upload(page, 1); const newer = await upload(page, 2);
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/purchases');
  await page.locator(`[data-incoming-document-id="${newer.id}"]`).click();
  await expect(review(page)).toContainText('sequence-2.xml'); const firstEntry = page.url();
  // Invoke the existing Next Link to add a genuine client-router list entry,
  // without fabricating/mutating Next's history state through the test.
  await page.locator('a[href="/purchases"]').first().evaluate(link => (link as HTMLAnchorElement).click());
  await expect(review(page)).toHaveCount(0);
  await page.locator(`[data-incoming-document-id="${older.id}"]`).click();
  await expect(review(page)).toContainText('sequence-1.xml'); const secondEntry = page.url();
  await (await draft(page)).fill('Unsupported browser: unsaved single-review note.');
  // The preexisting fallback permits native same-document traversal. It must
  // not offer a false "stay" that replaces the firstEntry destination.
  await page.goBack(); await expect(page).toHaveURL(firstEntry);
  await expect(review(page)).toContainText('sequence-2.xml'); await expect(chooser(page)).toHaveCount(0);
  await page.goForward(); await expect(page).toHaveURL(secondEntry);
  await expect(review(page)).toContainText('sequence-1.xml'); await expect(await draft(page)).toHaveValue('');
  // The traversal allowance is consumed by that exact query, not leaked to a
  // later explicit close where save/discard/stay remains supported.
  await (await draft(page)).fill('Keep this later explicit-close draft.');
  await review(page).getByRole('button', { name: 'Zur Liste', exact: true }).click();
  await expect(chooser(page)).toBeVisible(); await chooser(page).getByRole('button', { name: 'Hier bleiben', exact: true }).click();
  await expect(page).toHaveURL(secondEntry); await expect(review(page).getByLabel('Prüfnotiz', { exact: true })).toHaveValue('Keep this later explicit-close draft.');
  await page.goBack(); await expect(page).toHaveURL(firstEntry); await page.goForward(); await expect(page).toHaveURL(secondEntry);
  expect((await prisma.purchaseDocument.findUniqueOrThrow({ where: { id: older.id } })).reviewDraft).toBeNull();
  await noFinancialWrites(user.id);
});

test('reverting to an old saved baseline cannot bypass reconciliation after an uncertain newer save', async ({ page }) => {
  test.setTimeout(90_000);
  const user = await signIn(page); await upload(page, 1); const source = await upload(page, 2);
  const baseline = { supplierName: '', invoiceNumber: '', invoiceDate: '', paymentDate: '', amount: '', note: 'Previously confirmed baseline.' };
  const initial = await page.request.post(`/api/purchase-documents/${source.id}/review-draft`, { data: { expectedRevision: source.revision, draft: baseline } });
  expect(initial.status()).toBe(200);
  await page.goto('/purchases'); await page.locator(`[data-incoming-document-id="${source.id}"]`).click();
  await expect(review(page).getByLabel('Prüfnotiz', { exact: true })).toHaveValue(baseline.note);
  await (await draft(page)).fill('Newer save with a lost response.');
  let writes = 0;
  await page.route(`**/api/purchase-documents/${source.id}/review-draft`, async route => {
    writes++; const result = await route.fetch(); expect(result.status()).toBe(200); await route.abort('failed');
  });
  await review(page).getByRole('button', { name: 'Entwurf speichern & nächster', exact: true }).click();
  await expect(review(page).getByRole('alert')).toContainText('Speicherung ist nicht bestätigt');
  await review(page).getByLabel('Prüfnotiz', { exact: true }).fill(baseline.note);
  await review(page).getByRole('button', { name: 'Entwurf speichern & nächster', exact: true }).click();
  await expect(review(page).getByRole('alert')).toContainText('inzwischen geändert');
  await expect(page).toHaveURL(new RegExp(`document=${source.id}`));
  await expect(review(page).getByLabel('Prüfnotiz', { exact: true })).toHaveValue(baseline.note);
  expect(writes).toBe(1);
  expect((await prisma.purchaseDocument.findUniqueOrThrow({ where: { id: source.id } })).reviewDraft).toMatchObject({ note: 'Newer save with a lost response.' });
  await noFinancialWrites(user.id);
});
