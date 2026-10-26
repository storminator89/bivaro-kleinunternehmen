import { expect, test, type CDPSession, type Locator, type Page, type Request } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { allocate, createInvoice, isolatedAccount, loadJournal, openJournal, snapshot } from './helpers/payment-adjustments';

// Authoritative browser journeys for the supported isolated E2E runner only.
// Financial mutations go through the actual authenticated UI/HTTP routes.
// No response is fulfilled with fabricated success or component fixtures.
const originalDate = '2025-06-15';
const correctionDate = '2026-03-03';
const replacementDate = '2026-03-04';
const panelName = 'Zahlung korrigieren oder Erstattung dokumentieren';
type Payload = Record<string, unknown>;
type FiscalFocusObservation = { sequence: number; event: string; trusted: boolean | null; at: number; visibilityState: DocumentVisibilityState; hasFocus: boolean };

async function observeFiscalFocus(page: Page, disableBroadcastChannel = false) {
  await page.addInitScript(({ disableBroadcastChannel }) => {
    if (disableBroadcastChannel) Object.defineProperty(window, 'BroadcastChannel', { value: undefined, configurable: true });
    const events: FiscalFocusObservation[] = [];
    Object.defineProperty(window, '__bivaroFiscalFocus', { value: events, configurable: true });
    let sequence = 0;
    const record = (event: string, trusted: boolean | null) => {
      events.push({ sequence: ++sequence, event, trusted, at: performance.now(), visibilityState: document.visibilityState, hasFocus: document.hasFocus() });
      if (events.length > 80) events.shift();
    };
    record('installed', null);
    // Passive observations only: never dispatch or intercept a lifecycle event.
    for (const name of ['focus', 'blur', 'pageshow']) window.addEventListener(name, event => record(name, event.isTrusted));
    for (const name of ['visibilitychange', 'focusin', 'focusout', 'pointerdown']) document.addEventListener(name, event => record(name, event.isTrusted));
  }, { disableBroadcastChannel });
}
async function fiscalFocusSnapshot(page: Page) {
  return page.evaluate(() => ({
    path: location.pathname, visibilityState: document.visibilityState, hasFocus: document.hasFocus(), readyState: document.readyState,
    broadcastChannel: typeof window.BroadcastChannel,
    events: [...((window as typeof window & { __bivaroFiscalFocus?: FiscalFocusObservation[] }).__bivaroFiscalFocus ?? [])],
  }));
}
function fiscalFocusCheckpoint(snapshot: Awaited<ReturnType<typeof fiscalFocusSnapshot>>) {
  const { events, ...state } = snapshot;
  return { ...state, eventCount: events.length, lastSequence: events.at(-1)?.sequence ?? 0 };
}

function adjustmentPath(invoiceId: number) { return `/api/invoices/${invoiceId}/payments/adjustments`; }
function observesPost(request: Request, path: string) { return request.method() === 'POST' && new URL(request.url()).pathname === path; }
function metric(panel: Locator, label: string) {
  return panel.locator('dt').filter({ hasText: new RegExp(`^${label}$`) }).locator('..').locator('dd');
}
// UI preflights negotiate v3. Keep loadJournal's explicit v2 compatibility
// reads, but compare UI concurrency tokens with the same negotiated state.
async function uiLedgerVersion(page: Page, invoiceId: number) {
  const response = await page.request.get(`/api/invoices/${invoiceId}/payments`, { headers: { 'X-Bivaro-Payment-Contract': '3' } });
  expect(response.status()).toBe(200);
  const journal = await response.json() as { paymentContractVersion: number; ledgerVersion: string };
  expect(journal.paymentContractVersion).toBe(3);
  expect(journal.ledgerVersion).toMatch(/^[a-f0-9]{64}$/u);
  return journal.ledgerVersion;
}
async function openJournalWithKeyboard(page: Page, invoiceNumber: string) {
  const trigger = page.getByRole('button', { name: `Weitere Aktionen fuer Rechnung ${invoiceNumber}`, exact: true });
  await trigger.focus(); await page.keyboard.press('Enter');
  const menuItem = page.getByRole('menuitem', { name: 'Zahlungsverlauf ansehen', exact: true });
  await menuItem.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Zahlungen und Korrekturen', exact: true });
  await expect(dialog.getByRole('region', { name: panelName, exact: true })).toBeVisible();
  return dialog;
}
async function enterCorrection(page: Page, dialog: Locator, keyboard = false) {
  const panel = dialog.getByRole('region', { name: panelName, exact: true });
  const entry = panel.getByRole('button', { name: 'Korrektur / Erstattung dokumentieren', exact: true });
  await expect(entry).toBeEnabled();
  if (keyboard) { await entry.focus(); await page.keyboard.press('Enter'); } else await entry.click();
  await expect(panel.getByRole('radio', { name: /Korrektur/ })).toBeChecked();
  await expect(panel.getByRole('radio', { name: /Korrektur/ })).toBeFocused();
  return panel;
}
async function fillCorrection(panel: Locator, originalPaymentId: number, amount: string, reason: string, reference: string, actionDate = correctionDate) {
  await panel.getByLabel('Ursprünglicher Zahlungsnachweis', { exact: true }).selectOption(String(originalPaymentId));
  await panel.getByLabel('Nie erhaltener Betrag (EUR)', { exact: true }).fill(amount);
  await panel.getByLabel('Datum der entdeckten Fehlbuchung', { exact: true }).fill(actionDate);
  await panel.getByLabel('Nachvollziehbarer Grund', { exact: true }).fill(reason);
  await panel.getByLabel('Prüfbarer Korrekturbezug', { exact: true }).fill(reference);
}
async function fillCorrectionWithKeyboard(page: Page, panel: Locator, originalPaymentId: number, reason: string, reference: string) {
  await page.keyboard.press('Tab');
  const original = panel.getByLabel('Ursprünglicher Zahlungsnachweis', { exact: true });
  await expect(original).toBeFocused(); await original.selectOption(String(originalPaymentId));
  await page.keyboard.press('Tab');
  const amount = panel.getByLabel('Nie erhaltener Betrag (EUR)', { exact: true });
  await expect(amount).toBeFocused(); await amount.pressSequentially('120,00');
  await page.keyboard.press('Tab');
  const date = panel.getByLabel('Datum der entdeckten Fehlbuchung', { exact: true });
  await expect(date).toBeFocused(); await date.fill(correctionDate);
  // Native date segment tab stops differ by Chromium locale; resume the app's
  // tested keyboard chain at the next labelled control, not an OS subfield.
  const reasonInput = panel.getByLabel('Nachvollziehbarer Grund', { exact: true });
  await reasonInput.focus();
  await expect(reasonInput).toBeFocused(); await reasonInput.pressSequentially(reason);
  await page.keyboard.press('Tab');
  const evidence = panel.getByLabel('Prüfbarer Korrekturbezug', { exact: true });
  await expect(evidence).toBeFocused(); await evidence.pressSequentially(reference);
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('checkbox', { name: /Dieser Betrag ist nie eingegangen/ })).toBeFocused();
}
async function expectNoHorizontalOverflow(page: Page, dialog: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}
async function expectSuccessfulCorrection(panel: Locator, amount: string) {
  const confirmation = panel.getByRole('status').filter({ hasText: 'Korrektur gespeichert' });
  await expect(confirmation).toBeVisible(); await expect(confirmation).toBeFocused();
  await expect(confirmation).toContainText(amount);
  await expect(panel.getByText('Steuerlich nicht freigegeben', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Korrektur verbindlich speichern', exact: true })).toHaveCount(0);
  return confirmation;
}

test('mobile keyboard correction is cancellable, immutable, reloadable and replaceable by a real receipt', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const userId = await isolatedAccount(page);
  let releaseDelayedJournal: (() => void) | undefined, delayedJournalPath: string | undefined;
  try {
    const invoiceNumber = 'ADJUSTMENT-UI-MOBILE-120';
    const invoice = await createInvoice(page, invoiceNumber);
    const original = await allocate(page, invoice.id, '120.00', originalDate, '0');
    const before = await snapshot(userId, invoice.id);
    const initialJournal = await loadJournal(page, invoice.id);
    const initialUiVersion = await uiLedgerVersion(page, invoice.id);
    const path = adjustmentPath(invoice.id), posts: Payload[] = [];
    page.on('request', request => { if (observesPost(request, path)) posts.push(request.postDataJSON() as Payload); });
    await page.goto(`/dashboard?tab=invoices&document=${invoice.id}`);

    let dialog = await openJournalWithKeyboard(page, invoiceNumber);
    let panel = await enterCorrection(page, dialog, true);
    const reason = 'Synthetic original receipt was never received';
    const reference = 'Synthetic bank reconciliation original 120';
    await fillCorrectionWithKeyboard(page, panel, original.event.id, reason, reference);
    const declaration = panel.getByRole('checkbox', { name: /Dieser Betrag ist nie eingegangen/ });
    await page.keyboard.press('Tab');
    const submit = panel.getByRole('button', { name: 'Korrektur verbindlich speichern', exact: true });
    await expect(submit).toBeFocused(); await page.keyboard.press('Enter');
    await expect(declaration).toBeFocused();
    expect(await declaration.evaluate(element => (element as HTMLInputElement).validity.valueMissing)).toBe(true);
    expect(posts).toHaveLength(0);
    await page.keyboard.press('Space'); await expect(declaration).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => page.evaluate(id => { const active = document.activeElement; return active instanceof HTMLElement && active.getClientRects().length > 0 && !active.closest('[role="dialog"], [role="menu"]') && (active.getAttribute('aria-label') === 'Weitere Aktionen fuer Rechnung ADJUSTMENT-UI-MOBILE-120' || active.dataset.invoicePaymentReturn === String(id) || active.dataset.invoiceReturn === String(id)); }, invoice.id)).toBe(true);
    expect(await snapshot(userId, invoice.id)).toEqual(before);

    dialog = await openJournalWithKeyboard(page, invoiceNumber);
    panel = await enterCorrection(page, dialog, true);
    for (const label of ['Nie erhaltener Betrag (EUR)', 'Datum der entdeckten Fehlbuchung', 'Nachvollziehbarer Grund', 'Prüfbarer Korrekturbezug']) await expect(panel.getByLabel(label, { exact: true })).toHaveValue('');
    await expect(panel.getByRole('checkbox', { name: /Dieser Betrag ist nie eingegangen/ })).not.toBeChecked();
    await fillCorrectionWithKeyboard(page, panel, original.event.id, reason, reference);
    await page.keyboard.press('Space'); await page.keyboard.press('Tab');
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === 'POST');
    await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
    const response = await saved;
    expect(response.status()).toBe(201);
    const savedBody = await response.json();
    await expectSuccessfulCorrection(panel, '120,00');
    await expect(metric(panel, 'Gültig zugeordnet')).toHaveText(/^0,00\s*€$/u);
    await expect(metric(panel, 'Noch einzuziehen')).toHaveText(/^120,00\s*€$/u);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ kind: 'PAYMENT_CORRECTION', originalPaymentId: original.event.id, amount: '120.00', actionDate: correctionDate, reason, reference, declarationNeverReceived: true, expectedLedgerVersion: initialUiVersion });
    expect(savedBody.adjustment).toMatchObject({ originalPaymentId: original.event.id, kind: 'PAYMENT_CORRECTION', amountCents: '12000', accountingEffectiveOn: `${originalDate}T00:00:00.000Z`, fiscalMappingStatus: 'UNREVIEWED' });
    const corrected = await loadJournal(page, invoice.id);
    const correctedUiVersion = await uiLedgerVersion(page, invoice.id);
    expect(corrected.events).toEqual(initialJournal.events);
    expect(corrected.ledger).toMatchObject({ originalReceivedCents: '12000', correctedCents: '12000', validReceivedCents: '0', refundedCents: '0', collectibleOpenCents: '12000', refundDueCents: '0' });
    const afterCorrection = await snapshot(userId, invoice.id);
    expect(afterCorrection.events).toEqual(before.events); expect(afterCorrection.incomes).toEqual(before.incomes);
    expect(afterCorrection.adjustments).toHaveLength(1); expect(afterCorrection.operations).toHaveLength(before.operations.length + 1);
    await expectNoHorizontalOverflow(page, dialog);


    await dialog.locator('[data-slot="dialog-footer"]').getByRole('button', { name: 'Schließen', exact: true }).click();
    await page.reload();
    dialog = await openJournalWithKeyboard(page, invoiceNumber);
    await expect(dialog.getByText('Korrektur gespeichert', { exact: true })).toHaveCount(0);
    const history = dialog.getByRole('region', { name: 'Zahlungsverlauf', exact: true });
    await expect(history).toContainText('Korrektur: nie erhalten');
    await history.getByText('Folgebeleg ansehen', { exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(history.getByText(`Nachweis: ${reference}`, { exact: true })).toBeVisible();
    await expect(history.getByText(/Buchungszuordnung: 15\.06\.2025/)).toBeVisible();
    expect(await snapshot(userId, invoice.id)).toEqual(afterCorrection);
    await page.keyboard.press('Escape');

    const paymentAction = page.getByRole('button', { name: 'Zahlung erfassen', exact: true });
    await paymentAction.focus(); await page.keyboard.press('Enter');
    dialog = page.getByRole('dialog', { name: 'Zahlungen und Korrekturen', exact: true });
    await expect(dialog.getByLabel('Eingegangener Betrag (EUR)', { exact: true })).toHaveValue('120.00');
    await dialog.getByLabel('Tatsächliches Zahlungsdatum', { exact: true }).fill(replacementDate);
    await dialog.getByLabel('Zahlungsreferenz', { exact: true }).fill('Synthetic actual replacement receipt');
    delayedJournalPath = `/api/invoices/${invoice.id}/payments`;
    let journalFetched!: () => void, heldJournal = false, replacementPosts = 0;
    const realJournalFetched = new Promise<void>(resolve => { journalFetched = resolve; });
    const journalDelivery = new Promise<void>(resolve => { releaseDelayedJournal = resolve; });
    await page.route(`**${delayedJournalPath}`, async route => {
      if (route.request().method() === 'POST') { replacementPosts += 1; return route.continue(); }
      if (route.request().method() !== 'GET' || heldJournal) return route.continue();
      heldJournal = true;
      const actualResponse = await route.fetch();
      expect(actualResponse.status()).toBe(200);
      journalFetched();
      await journalDelivery;
      await route.fulfill({ response: actualResponse }); // Delay only the real authoritative response.
    });
    const received = page.waitForResponse(result => new URL(result.url()).pathname === delayedJournalPath && result.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Zahlung verbindlich erfassen', exact: true }).focus(); await page.keyboard.press('Enter');
    const receiptResponse = await received; expect(receiptResponse.status()).toBe(201);
    expect(receiptResponse.request().postDataJSON()).toMatchObject({ amount: '120.00', paidAt: replacementDate, expectedPaidCents: '0', expectedLedgerVersion: correctedUiVersion });
    const savedProof = dialog.getByRole('status').filter({ has: page.getByText('Zahlung gespeichert', { exact: true }) });
    await expect(savedProof).toBeFocused();
    await expect(savedProof.getByText('Zahlung gespeichert', { exact: true })).toBeInViewport({ ratio: 1 });
    await expect(savedProof.locator('p.text-2xl')).toBeInViewport({ ratio: 1 });
    await realJournalFetched;
    await expect(dialog.getByText('Aktueller Journalstand wird geprüft …', { exact: true })).toBeVisible();
    const userClose = dialog.locator('[data-slot="dialog-footer"]').getByRole('button', { name: 'Schließen', exact: true });
    await expect(userClose).toBeEnabled();
    await page.keyboard.press('Tab');
    await expect(userClose).toBeFocused();
    const deliveredJournal = page.waitForResponse(result => new URL(result.url()).pathname === delayedJournalPath && result.request().method() === 'GET');
    releaseDelayedJournal!();
    expect((await deliveredJournal).status()).toBe(200);
    const replacementPanel = dialog.getByRole('region', { name: panelName, exact: true });
    await expect(metric(replacementPanel, 'Gültig zugeordnet')).toHaveText(/^120,00\s*€$/u);
    await expect(metric(replacementPanel, 'Noch einzuziehen')).toHaveText(/^0,00\s*€$/u);
    await expect(userClose).toBeFocused(); // A late journal must not take focus back from the user.
    expect(replacementPosts).toBe(1);
    const settled = await loadJournal(page, invoice.id), after = await snapshot(userId, invoice.id);
    expect(settled.ledger).toMatchObject({ documentState: 'PAID', originalReceivedCents: '24000', correctedCents: '12000', validReceivedCents: '12000', refundedCents: '0', collectibleOpenCents: '0' });
    expect(settled.events).toHaveLength(2); expect(settled.adjustments).toHaveLength(1);
    expect(after.events[0]).toEqual(before.events[0]); expect(after.incomes.find(income => income.id === before.incomes[0].id)).toEqual(before.incomes[0]);
    expect(after.adjustments).toEqual(afterCorrection.adjustments); expect(after.operations).toHaveLength(before.operations.length + 2);
    await testInfo.attach('payment-adjustment-mobile-http-db-evidence.json', { body: Buffer.from(JSON.stringify({ before, posts, savedBody, corrected, afterCorrection, settled, after }, null, 2)), contentType: 'application/json' });
  } finally { releaseDelayedJournal?.(); if (delayedJournalPath) await page.unroute(`**${delayedJournalPath}`); await prisma.$disconnect(); }
});

test('stale correction preserves the draft, rejects without writes and requires explicit fresh-ledger review', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1100 });
  const userId = await isolatedAccount(page);
  try {
    const invoice = await createInvoice(page, 'ADJUSTMENT-UI-STALE-120');
    const original = await allocate(page, invoice.id, '120.00', originalDate, '0');
    const baseline = await loadJournal(page, invoice.id), path = adjustmentPath(invoice.id), posts: Payload[] = [];
    const baselineUiVersion = await uiLedgerVersion(page, invoice.id);
    page.on('request', request => { if (observesPost(request, path)) posts.push(request.postDataJSON() as Payload); });
    await page.goto(`/dashboard?tab=invoices&document=${invoice.id}`);
    const dialog = await openJournal(page, invoice.invoiceNumber), panel = await enterCorrection(page, dialog);
    const reason = 'Synthetic retained correction draft', reference = 'Synthetic second statement correction';
    await fillCorrection(panel, original.event.id, '40,00', reason, reference);
    await panel.getByRole('checkbox', { name: /Dieser Betrag ist nie eingegangen/ }).check();
    const concurrent = await page.request.post(path, { data: { kind: 'PAYMENT_CORRECTION', originalPaymentId: original.event.id, amount: '20.00', actionDate: correctionDate, reason: 'Synthetic concurrent never-received portion', reference: 'Synthetic concurrent statement', idempotencyKey: randomUUID(), expectedLedgerVersion: baseline.ledgerVersion, declarationNeverReceived: true } });
    expect(concurrent.status()).toBe(201);
    const concurrentBody = await concurrent.json(), afterConcurrent = await snapshot(userId, invoice.id);
    const concurrentUiVersion = await uiLedgerVersion(page, invoice.id);
    const rejected = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === 'POST');
    await panel.getByRole('button', { name: 'Korrektur verbindlich speichern', exact: true }).click();
    const staleResponse = await rejected; expect(staleResponse.status()).toBe(409);
    const staleBody = await staleResponse.json(); expect(staleBody.code).toBe('PAYMENT_STATE_CHANGED');
    expect(await snapshot(userId, invoice.id)).toEqual(afterConcurrent);
    await expect(panel.getByLabel('Nie erhaltener Betrag (EUR)', { exact: true })).toHaveValue('40,00');
    await expect(panel.getByLabel('Datum der entdeckten Fehlbuchung', { exact: true })).toHaveValue(correctionDate);
    await expect(panel.getByLabel('Nachvollziehbarer Grund', { exact: true })).toHaveValue(reason);
    await expect(panel.getByLabel('Prüfbarer Korrekturbezug', { exact: true })).toHaveValue(reference);
    await expect(panel.getByRole('button', { name: 'Korrektur verbindlich speichern', exact: true })).toHaveCount(0);
    const reviewed = panel.getByRole('button', { name: 'Aktuellen Journalstand geprüft', exact: true });
    await expect(reviewed).toBeEnabled();
    await expect(metric(panel, 'Gültig zugeordnet')).toHaveText(/^100,00\s*€$/u);
    expect(posts).toHaveLength(1); expect(posts[0].expectedLedgerVersion).toBe(baselineUiVersion);
    await reviewed.focus(); await page.keyboard.press('Enter');
    const retried = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === 'POST');
    await panel.getByRole('button', { name: 'Korrektur verbindlich speichern', exact: true }).focus(); await page.keyboard.press('Enter');
    const retryResponse = await retried; expect(retryResponse.status()).toBe(201);
    await expectSuccessfulCorrection(panel, '40,00');
    expect(posts).toHaveLength(2); expect(posts[1].idempotencyKey).not.toBe(posts[0].idempotencyKey);
    expect(posts[1]).toMatchObject({ amount: '40.00', reason, reference, expectedLedgerVersion: concurrentUiVersion });
    const after = await snapshot(userId, invoice.id), journal = await loadJournal(page, invoice.id);
    expect(after.events).toEqual(afterConcurrent.events); expect(after.incomes).toEqual(afterConcurrent.incomes);
    expect(after.adjustments).toHaveLength(2); expect(after.operations).toHaveLength(afterConcurrent.operations.length + 1);
    expect(journal.ledger).toMatchObject({ correctedCents: '6000', validReceivedCents: '6000', collectibleOpenCents: '6000', refundedCents: '0' });
    await expectNoHorizontalOverflow(page, dialog);
    await testInfo.attach('payment-adjustment-stale-http-db-evidence.json', { body: Buffer.from(JSON.stringify({ baseline, concurrentBody, staleBody, posts, afterConcurrent, after, journal }, null, 2)), contentType: 'application/json' });
  } finally { await prisma.$disconnect(); }
});

test('a real committed correction with a lost response recovers after close/reload without a second financial POST', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1100 });
  const userId = await isolatedAccount(page);
  let path = '';
  try {
    const invoice = await createInvoice(page, 'ADJUSTMENT-UI-LOST-120');
    const original = await allocate(page, invoice.id, '120.00', originalDate, '0');
    const before = await snapshot(userId, invoice.id);
    path = adjustmentPath(invoice.id);
    const posts: Payload[] = [];
    page.on('request', request => { if (observesPost(request, path)) posts.push(request.postDataJSON() as Payload); });
    await page.goto(`/dashboard?tab=invoices&document=${invoice.id}`);
    let dialog = await openJournal(page, invoice.invoiceNumber), panel = await enterCorrection(page, dialog);
    const reason = 'Synthetic response-loss correction', reference = 'Synthetic response-loss bank reconciliation';
    await fillCorrection(panel, original.event.id, '20.00', reason, reference);
    await panel.getByRole('checkbox', { name: /Dieser Betrag ist nie eingegangen/ }).check();
    let resolveCommit!: (value: { status: number; body: unknown }) => void;
    let rejectCommit!: (reason: unknown) => void;
    const committed = new Promise<{ status: number; body: unknown }>((resolve, reject) => { resolveCommit = resolve; rejectCommit = reject; });
    // Forward the real authenticated request, wait for its real transaction to
    // commit, then lose only the browser response. Never fabricate a response.
    await page.route(`**${path}`, async route => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      try {
        const response = await route.fetch();
        const result = { status: response.status(), body: await response.json() };
        await route.abort('failed'); resolveCommit(result);
      } catch (failure) { rejectCommit(failure); await route.abort('failed').catch(() => {}); }
    }, { times: 1 });
    await panel.getByRole('button', { name: 'Korrektur verbindlich speichern', exact: true }).click();
    const commit = await committed; expect(commit.status).toBe(201);
    await expect(panel.getByRole('status').filter({ hasText: 'Anfrage noch ungeklärt' })).toBeVisible();
    await expect(panel.getByLabel('Nie erhaltener Betrag (EUR)', { exact: true })).toBeDisabled();
    await expect(panel.getByLabel('Prüfbarer Korrekturbezug', { exact: true })).toBeDisabled();
    await expect(panel.getByRole('button', { name: 'Zurück zum Zahlungseingang', exact: true })).toBeDisabled();
    expect(posts).toHaveLength(1);
    const pendingKey = `bivaro:payment-adjustment-pending:${encodeURIComponent(userId)}:${invoice.id}`;
    const pending = await page.evaluate(key => sessionStorage.getItem(key), pendingKey);
    expect(pending).not.toBeNull();
    const opaque = JSON.parse(pending!) as { idempotencyKey: string; fingerprintHash: string; expectedLedgerVersion: string };
    expect(opaque.idempotencyKey).toBe(posts[0].idempotencyKey); expect(opaque.fingerprintHash).toMatch(/^[a-f0-9]{64}$/);
    for (const evidence of [reason, reference, '20.00', correctionDate]) expect(pending).not.toContain(evidence);
    const afterCommit = await snapshot(userId, invoice.id);
    expect(afterCommit.events).toEqual(before.events); expect(afterCommit.incomes).toEqual(before.incomes);
    expect(afterCommit.adjustments).toHaveLength(1); expect(afterCommit.operations).toHaveLength(before.operations.length + 1);
    await dialog.locator('[data-slot="dialog-footer"]').getByRole('button', { name: 'Schließen', exact: true }).click();
    await page.reload();
    dialog = await openJournal(page, invoice.invoiceNumber);
    panel = dialog.getByRole('region', { name: panelName, exact: true });
    const confirmation = await expectSuccessfulCorrection(panel, '20,00');
    await expect.poll(() => page.evaluate(key => sessionStorage.getItem(key), pendingKey)).toBeNull();
    expect(posts).toHaveLength(1);
    const afterRecovery = await snapshot(userId, invoice.id), journal = await loadJournal(page, invoice.id);
    expect(afterRecovery).toEqual(afterCommit);
    expect(journal.adjustments).toHaveLength(1); expect(journal.adjustments[0].idempotencyKey).toBe(opaque.idempotencyKey);
    expect(journal.ledger).toMatchObject({ correctedCents: '2000', validReceivedCents: '10000', collectibleOpenCents: '2000', refundedCents: '0' });
    // One natural desktop whole-page PNG. The independent keyboard/mobile
    // journey stays390x844; no crop, hiding, mask, styles or lossy conversion.
    await expect(metric(panel, 'Noch einzuziehen')).toHaveText(/^20,00\s*€$/u);
    await panel.scrollIntoViewIfNeeded();
    await expect(confirmation.locator('p.text-2xl')).toBeInViewport({ ratio: 1 });
    await expect(confirmation.getByText(`Original-Zahlungsnachweis #${original.event.id}`, { exact: false })).toBeInViewport({ ratio: 1 });
    await expect(panel.getByText('Steuerlich nicht freigegeben', { exact: true })).toBeInViewport({ ratio: 1 });
    await expect(metric(panel, 'Noch einzuziehen')).toBeInViewport({ ratio: 1 });
    await expect(metric(panel, 'Noch zu erstatten')).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath('payment-adjustment-confirmation-desktop-1440.png'), fullPage: true });
    await testInfo.attach('payment-adjustment-response-loss-http-db-evidence.json', { body: Buffer.from(JSON.stringify({ before, posts, commit, opaque, afterCommit, afterRecovery, journal }, null, 2)), contentType: 'application/json' });
  } finally { if (path) await page.unroute(`**${path}`); await prisma.$disconnect(); }
});

for (const view of ['eur', 'tax-focus-fallback'] as const) {
  test(`two-tab ${view} revalidates a cached fiscal120 after a real correction in the other tab`, async ({ page, context }, testInfo) => {
    test.setTimeout(120_000);
    const userId = await isolatedAccount(page);
    let editor: Page | undefined;
    let observerFocusSession: CDPSession | undefined, editorFocusSession: CDPSession | undefined;
    let completed = false;
    const focusCheckpoints: Record<string, unknown> = {};
    const fiscalResponses: { status: number; method: string }[] = [];
    const focusEmulation = { observerDisableAcknowledged: false, editorDisableAcknowledged: false };
    try {
      const invoice = await createInvoice(page, `ADJUSTMENT-TWO-TAB-${view.toUpperCase()}`);
      const today = new Date().toISOString().slice(0, 10);
      const original = await allocate(page, invoice.id, '120.00', today, '0');
      const fiscalPath = view === 'eur' ? '/api/dashboard/summary' : '/api/tax-summary';
      // Disable the channel only in the tax observer, before its app JS loads.
      // All HTTP responses and browser lifecycle events remain real/unmodified.
      await observeFiscalFocus(page, view === 'tax-focus-fallback');
      if (view === 'tax-focus-fallback') {
        // Playwright's Chromium main-frame initialization forces every page to
        // appear focused/active. Restore native focus, not fabricated DOM state.
        observerFocusSession = await context.newCDPSession(page);
        await observerFocusSession.send('Emulation.setFocusEmulationEnabled', { enabled: false });
        focusEmulation.observerDisableAcknowledged = true;
      }
      page.on('response', response => {
        if (new URL(response.url()).pathname !== fiscalPath) return;
        fiscalResponses.push({ status: response.status(), method: response.request().method() });
        if (fiscalResponses.length > 80) fiscalResponses.shift();
      });
      const initiallyLoaded = page.waitForResponse(response => new URL(response.url()).pathname === fiscalPath && response.status() === 200);
      await page.goto(view === 'eur' ? '/dashboard?tab=eur' : '/steuer-simulation');
      const initialResponse = await initiallyLoaded, initialBody = await initialResponse.json();
      expect(initialBody.totalIncome).toBe(120); expect(initialBody.profit).toBe(120);
      if (view === 'eur') {
        await expect(page.locator('.report-balance').getByText('120,00 €', { exact: true }).first()).toBeVisible();
        await expect(page.getByRole('button', { name: 'CSV exportieren', exact: true })).toBeVisible();
      } else {
        await expect(page.locator('.tax-source-profit strong')).toContainText('120,00');
        expect(await page.evaluate(() => typeof window.BroadcastChannel)).toBe('undefined');
        await page.getByRole('heading', { name: 'Steuer-Simulation', exact: true }).click();
        await expect.poll(async () => { const state = await fiscalFocusSnapshot(page); return { visibilityState: state.visibilityState, hasFocus: state.hasFocus }; }).toEqual({ visibilityState: 'visible', hasFocus: true });
        await expect(page.locator('.tax-source-profit strong')).toContainText('120,00');
      }
      const beforeEditor = await fiscalFocusSnapshot(page);
      focusCheckpoints.observerBeforeEditor = fiscalFocusCheckpoint(beforeEditor);
      editor = await context.newPage();
      if (view === 'tax-focus-fallback') {
        editorFocusSession = await context.newCDPSession(editor);
        await editorFocusSession.send('Emulation.setFocusEmulationEnabled', { enabled: false });
        focusEmulation.editorDisableAcknowledged = true;
      }
      await observeFiscalFocus(editor);
      await editor.bringToFront();
      await editor.goto(`/dashboard?tab=invoices&document=${invoice.id}`);
      const dialog = await openJournal(editor, invoice.invoiceNumber), panel = await enterCorrection(editor, dialog);
      await fillCorrection(panel, original.event.id, '20.00', 'Synthetic other-tab never-received portion', `Synthetic two-tab ${view} evidence`, today);
      await panel.getByRole('checkbox', { name: /Dieser Betrag ist nie eingegangen/ }).check();
      if (view === 'tax-focus-fallback') {
        await expect.poll(async () => { const state = await fiscalFocusSnapshot(editor!); return { visibilityState: state.visibilityState, hasFocus: state.hasFocus }; }).toEqual({ visibilityState: 'visible', hasFocus: true });
        await expect.poll(async () => { const state = await fiscalFocusSnapshot(page); return state.visibilityState !== 'visible' || !state.hasFocus; }).toBe(true);
        const away = await fiscalFocusSnapshot(page), sequence = beforeEditor.events.at(-1)?.sequence ?? 0;
        focusCheckpoints.observerAway = fiscalFocusCheckpoint(away);
        expect(away.events.some(event => event.sequence > sequence && event.trusted && ['blur', 'visibilitychange'].includes(event.event) && (event.visibilityState !== 'visible' || !event.hasFocus))).toBe(true);
      }
      const remoteRevalidation = view === 'eur' ? page.waitForResponse(response => new URL(response.url()).pathname === fiscalPath && response.status() === 409) : null;
      const saved = editor.waitForResponse(response => new URL(response.url()).pathname === adjustmentPath(invoice.id) && response.request().method() === 'POST');
      await panel.getByRole('button', { name: 'Korrektur verbindlich speichern', exact: true }).click();
      expect((await saved).status()).toBe(201); await expectSuccessfulCorrection(panel, '20,00');
      const afterMutation = await snapshot(userId, invoice.id);
      if (remoteRevalidation) {
        // The BroadcastChannel signal must reach the mounted hidden observer,
        // without waiting for user focus or publishing payment data.
        expect((await remoteRevalidation).status()).toBe(409);
      } else {
        // No bridge exists in this observer; its hidden old result is invalidated
        // by the real focus/visibility return, not a fabricated UI event.
        await expect(page.locator('.tax-source-profit strong')).toContainText('120,00');
      }
      const focusRevalidation = view === 'tax-focus-fallback' ? page.waitForResponse(response => new URL(response.url()).pathname === fiscalPath && response.status() === 409) : null;
      const beforeReturn = await fiscalFocusSnapshot(page);
      focusCheckpoints.observerBeforeReturn = fiscalFocusCheckpoint(beforeReturn);
      await page.bringToFront();
      if (view === 'tax-focus-fallback') {
        // Target activation alone need not focus Chromium's content under Xvfb.
        // Return with a real pointer action on an inert heading, never a DOM event.
        await page.getByRole('heading', { name: 'Steuer-Simulation', exact: true }).click();
        await expect.poll(async () => { const state = await fiscalFocusSnapshot(page); return { visibilityState: state.visibilityState, hasFocus: state.hasFocus }; }).toEqual({ visibilityState: 'visible', hasFocus: true });
        const returned = await fiscalFocusSnapshot(page), sequence = beforeReturn.events.at(-1)?.sequence ?? 0;
        focusCheckpoints.observerReturned = fiscalFocusCheckpoint(returned);
        expect(returned.events.some(event => event.sequence > sequence && event.trusted && ['focus', 'visibilitychange'].includes(event.event) && event.visibilityState === 'visible')).toBe(true);
        expect(returned.events.some(event => event.sequence > sequence && event.event === 'pointerdown' && event.trusted)).toBe(true);
      }
      if (focusRevalidation) expect((await focusRevalidation).status()).toBe(409);
      if (view === 'eur') {
        await expect(page.getByRole('alert').filter({ hasText: 'Die EÜR-Auswertung ist nicht verfügbar' })).toBeVisible();
        await expect(page.locator('.report-balance')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'CSV exportieren', exact: true })).toHaveCount(0);
      } else {
        await expect(page.locator('.tax-source-profit strong')).toContainText('Nicht verfügbar / fachlich zu prüfen');
        await expect(page.locator('.tax-source-context')).not.toContainText('120,00');
        await expect(page.locator('.tax-source-context').getByText('Nicht verfügbar', { exact: true })).toHaveCount(3);
        await expect(page.getByRole('alert').filter({ hasText: 'Zahlungsberichtigungen oder tatsächliche Rückzahlungen' })).toBeVisible();
      }
      expect(await snapshot(userId, invoice.id)).toEqual(afterMutation);
      await testInfo.attach(`payment-adjustment-two-tab-${view}-evidence.json`, { body: Buffer.from(JSON.stringify({ initialBody, observer: view, afterMutation, afterReturn: await snapshot(userId, invoice.id), journal: await loadJournal(page, invoice.id) }, null, 2)), contentType: 'application/json' });
      completed = true;
    } finally {
      try {
        // Available on failures too; no input text, account IDs or bank evidence.
        const observerState = await fiscalFocusSnapshot(page).catch(() => ({ unavailable: true }));
        const editorState = editor ? await fiscalFocusSnapshot(editor).catch(() => ({ unavailable: true })) : null;
        const diagnostics = { observer: view, focusEmulation, focusCheckpoints, observerState, editorState, fiscalResponses };
        // The hosted workflow uploads only allowlisted PNGs. Preserve bounded,
        // nonfinancial failure diagnostics in its log without changing that policy.
        if (!completed) console.warn('Synthetic fiscal focus diagnostics:', JSON.stringify(diagnostics));
        await testInfo.attach(`payment-adjustment-two-tab-${view}-focus-diagnostics.json`, { body: Buffer.from(JSON.stringify(diagnostics, null, 2)), contentType: 'application/json' });
      } finally {
        await editorFocusSession?.detach().catch(() => {});
        await observerFocusSession?.detach().catch(() => {});
        await editor?.close(); await prisma.$disconnect();
      }
    }
  });
}
