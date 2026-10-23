import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { readBankAllocationPreflight } from '../lib/bank-allocation-client';
import { BANK_ALLOCATION_PENDING_KEY, type PendingBankAllocation } from '../components/bank-csv/bank-allocation-recovery';
import { openJournal } from './helpers/payment-adjustments';
import {
  allocationJournal, allocationRowState, allocationSnapshot, bankAllocationAccount,
  chooseAllocationInvoice, issueAllocationInvoice, noAllocationOverflow, openAllocationReceipt, saveAllocationRow,
} from './helpers/bank-allocations';

// Hosted acceptance only, through the supported isolated runner. Synthetic
// identity/master data is seeded; every invoice is really generated, downloaded
// and marked sent through UI. No fake financial success or status patch exists.
const recordPath = (row: string) => `/api/bank-imports/rows/${row}/allocation`;
const movePath = (binding: string) => `/api/bank-allocations/${binding}/changes`;
const panelName = 'Zahlung korrigieren oder Erstattung dokumentieren';
function observes(request: Request, path: string, method = 'POST') { return request.method() === method && new URL(request.url()).pathname === path; }
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

async function pending(page: Page, userId: string, rowStableKey: string, kind: 'record' | 'move') {
  const raw = await page.evaluate(key => sessionStorage.getItem(key), BANK_ALLOCATION_PENDING_KEY);
  expect(raw).not.toBeNull();
  const entries = JSON.parse(raw!) as PendingBankAllocation[];
  expect(entries).toHaveLength(1);
  const entry = entries[0];
  expect(Object.keys(entry).sort()).toEqual(['accountScope', 'bindingStableKey', 'expectedAllocationRevision', 'expectedSourceLedgerVersion', 'kind', 'operationKey', 'rowStableKey'].sort());
  expect(entry).toMatchObject({ accountScope: userId, rowStableKey, kind });
  expect(entry.operationKey).toMatch(/^[a-f0-9-]{36}$/u);
  expect(await page.evaluate(key => localStorage.getItem(key), BANK_ALLOCATION_PENDING_KEY)).toBeNull();
  return entry;
}
async function pendingCleared(page: Page) {
  await expect.poll(() => page.evaluate(key => sessionStorage.getItem(key), BANK_ALLOCATION_PENDING_KEY)).toBeNull();
}
async function recordDialog(page: Page, row: Locator) {
  await row.getByRole('button', { name: 'Rechnung wählen', exact: true }).click();
  return page.getByRole('dialog', { name: 'Rechnung zuordnen', exact: true });
}
async function moveDialog(page: Page, row: Locator) {
  await row.getByRole('button', { name: 'Andere Rechnung', exact: true }).click();
  return page.getByRole('dialog', { name: 'Zuordnung ändern', exact: true });
}
async function saveReviewed(page: Page, dialog: Locator, path: string, moving = false) {
  const saved = page.waitForResponse(response => observes(response.request(), path));
  await dialog.getByRole('button', { name: moving ? 'Zuordnung ändern' : 'Zahlung zuordnen', exact: true }).click();
  expect((await saved).status()).toBe(201);
  const success = page.getByRole('dialog', { name: 'Zuordnung gespeichert', exact: true });
  await expect(success.getByRole('status')).toBeFocused();
  await success.locator('[data-slot="dialog-footer"]').getByRole('button', { name: 'Schließen', exact: true }).click();
  return success;
}
async function assertMoved(page: Page, a: number, b: number, originalId: number) {
  const source = await allocationJournal(page, a), target = await allocationJournal(page, b);
  expect(source.ledger).toMatchObject({ originCash: { originalReceivedCents: '4000', validReceivedCents: '4000', netRetainedCents: '4000' }, allocation: { originalAllocatedCents: '0', validAllocatedCents: '0' }, collectibleOpenCents: '12000' });
  expect(target.ledger).toMatchObject({ originCash: { originalReceivedCents: '0', netRetainedCents: '0' }, allocation: { originalAllocatedCents: '4000', validAllocatedCents: '4000' }, collectibleOpenCents: '8000' });
  expect(source.events).toEqual(source.originEvents);
  expect(source.events).toHaveLength(1);
  expect(source.events[0]).toMatchObject({ id: originalId, invoiceId: a, amountCents: '4000' });
  expect(source.effectivePayments).toEqual([]);
  expect(source.originAssignments).toEqual([expect.objectContaining({ originalPaymentId: originalId, originInvoiceId: a, allocatedInvoiceId: b, allocationRevision: 1 })]);
  expect(target.events).toEqual([]); // Never manufacture an origin event for B.
  expect(target.effectivePayments).toEqual([expect.objectContaining({ originalPaymentId: originalId, originInvoiceId: a, allocatedInvoiceId: b, amountCents: '4000', allocationRevision: 1, provenance: 'BANK_CSV' })]);
  expect(target.allocationHistory).toHaveLength(1);
}
async function assertCashAndEvidenceUnchanged(before: Awaited<ReturnType<typeof allocationSnapshot>>, after: Awaited<ReturnType<typeof allocationSnapshot>>) {
  for (const field of ['payments', 'incomes', 'expenses', 'cash', 'batches', 'rows', 'bindings'] as const) expect(after[field], field).toEqual(before[field]);
}

for (const width of [1440, 390, 360]) test(`bank allocation: 120 minus 40, whole-root move and interruption boundaries, ${width}px`, async ({ page, context }, info) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
  const { userId, customerId } = await bankAllocationAccount(page);
  let observer: Page | undefined;
  try {
    const suffix = `${width}-${randomUUID().slice(0, 8)}`;
    const a = await issueAllocationInvoice(page, userId, customerId, `BANK-A-${suffix}`);
    const b = await issueAllocationInvoice(page, userId, customerId, `BANK-B-${suffix}`);
    const originalPdf = await (await page.request.get(`/api/invoices/download?id=${a.id}&download=true`)).body();
    const csv = await saveAllocationRow(page, userId, a.invoiceNumber!);
    let row = await openAllocationReceipt(page);
    const imported = await allocationSnapshot(userId);
    let dialog = await recordDialog(page, row);
    await expect(dialog.getByRole('combobox', { name: 'Rechnung', exact: true })).toHaveValue('');
    await chooseAllocationInvoice(dialog, a.id, a.invoiceNumber!);
    await noAllocationOverflow(page, dialog);
    if (width === 1440) await page.screenshot({ path: info.outputPath('bank-allocation-confirmation-1440.png'), fullPage: false });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Rechnung wählen', exact: true })).toBeFocused();
    expect(await allocationSnapshot(userId)).toEqual(imported);
    dialog = await recordDialog(page, row);
    await expect(dialog.getByRole('combobox', { name: 'Rechnung', exact: true })).toHaveValue('');
    await expect(dialog.getByRole('checkbox')).not.toBeChecked();
    await chooseAllocationInvoice(dialog, a.id, a.invoiceNumber!);
    const path = recordPath(csv.stableKey);
    const recordPosts: unknown[] = [];
    page.on('request', request => { if (observes(request, path)) recordPosts.push(request.postDataJSON()); });
    // Delay only a real committed response to prove a pending command cannot be
    // dismissed or double-submitted. Nothing is fulfilled with fake success.
    const committed = deferred(), delivery = deferred();
    let status = 0, fetchFailure: unknown;
    await page.route(`**${path}`, async route => {
      try {
        const response = await route.fetch(); status = response.status(); committed.release();
        await delivery.promise; await route.fulfill({ response });
      } catch (failure) { fetchFailure = failure; committed.release(); await route.abort('connectionreset'); }
    }, { times: 1 });
    try {
      await dialog.getByRole('button', { name: 'Zahlung zuordnen', exact: true }).click();
      await committed.promise; expect(fetchFailure).toBeUndefined(); expect(status).toBe(201);
      await expect(dialog.locator('form')).toHaveAttribute('aria-busy', 'true');
      await expect(dialog.getByRole('button', { name: 'Abbrechen', exact: true })).toBeDisabled();
      await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
      await page.keyboard.press('Enter'); expect(recordPosts).toHaveLength(1);
    } finally { delivery.release(); }
    const recordedDialog = page.getByRole('dialog', { name: 'Zuordnung gespeichert', exact: true });
    await expect(recordedDialog.getByRole('status')).toContainText('Zahlung erfasst');
    await expect(recordedDialog.getByRole('status')).toBeFocused();
    await recordedDialog.locator('[data-slot="dialog-footer"]').getByRole('button', { name: 'Schließen', exact: true }).click();
    await pendingCleared(page);
    const recorded = await allocationSnapshot(userId);
    expect(recorded.payments).toHaveLength(1); expect(recorded.incomes).toHaveLength(1);
    expect(recorded.payments[0]).toMatchObject({ invoiceId: a.id, amountCents: '4000', source: 'MANUAL', dateCertainty: 'ACTUAL', paidAt: new Date('2026-02-01T00:00:00Z') });
    expect(recorded.incomes[0]).toMatchObject({ invoiceId: a.id, amount: 40 });
    expect(recorded.bindings).toHaveLength(1); expect(recorded.changes).toEqual([]);
    expect(recorded.batches).toEqual(imported.batches); expect(recorded.rows).toEqual(imported.rows);
    const initial = await allocationJournal(page, a.id);
    expect(initial.ledger).toMatchObject({ allocation: { validAllocatedCents: '4000' }, collectibleOpenCents: '8000' });
    expect((await allocationJournal(page, b.id)).ledger.collectibleOpenCents).toBe('12000');
    const binding = recorded.bindings[0], changePath = movePath(binding.stableKey);
    dialog = await moveDialog(page, row);
    await chooseAllocationInvoice(dialog, b.id, b.invoiceNumber!, true);
    await expect(dialog.locator('dl')).toContainText('120,00');
    await noAllocationOverflow(page, dialog);
    if (width === 390) await page.screenshot({ path: info.outputPath('bank-allocation-move-390.png'), fullPage: false });

    let staleInput: Record<string, unknown> | undefined;
    if (width === 1440) {
      observer = await context.newPage(); await observer.goto('/bank-csv');
      expect(await observer.evaluate(key => sessionStorage.getItem(key), BANK_ALLOCATION_PENDING_KEY)).toBeNull();
      const otherRow = await openAllocationReceipt(observer);
      const checked = observer.waitForResponse(response => observes(response.request(), `/api/bank-allocations/${binding.stableKey}/preflight`) && response.request().postDataJSON().invoiceId === b.id);
      const otherDialog = await moveDialog(observer, otherRow);
      await chooseAllocationInvoice(otherDialog, b.id, b.invoiceNumber!, true);
      const old = readBankAllocationPreflight(await (await checked).json());
      staleInput = { invoiceId: b.id, idempotencyKey: randomUUID(), expectedAllocationRevision: old.row.assignment!.allocationRevision, expectedSourceLedgerVersion: old.row.assignment!.allocatedInvoice.ledgerVersion, expectedTargetLedgerVersion: old.selection!.ledgerVersion, actionDate: '2026-02-02', reason: 'SYNTHETISCH · veralteter zweiter Tab', cashNeutralReviewed: true };
      await page.bringToFront();
    }
    const changePosts: Record<string, unknown>[] = [];
    page.on('request', request => { if (observes(request, changePath)) changePosts.push(request.postDataJSON() as Record<string, unknown>); });
    if (width !== 360) {
      // 1440: the command really commits, but its response is lost. 390: the
      // transport fails before any server request. Neither reload may POST.
      await page.route(`**${changePath}`, async route => {
        if (width === 1440) { const response = await route.fetch(); expect(response.status()).toBe(201); }
        await route.abort('connectionreset');
      }, { times: 1 });
      await dialog.getByRole('button', { name: 'Zuordnung ändern', exact: true }).click();
      await expect(dialog.getByRole('alert')).toContainText('Ergebnis noch unklar');
      const identity = await pending(page, userId, csv.stableKey, 'move');
      expect(identity).toMatchObject({ bindingStableKey: binding.stableKey, expectedAllocationRevision: 0, expectedSourceLedgerVersion: initial.ledgerVersion });
      expect(JSON.stringify(identity)).not.toContain(b.invoiceNumber!);
      expect(changePosts).toHaveLength(1);
      if (observer && staleInput) {
        const receipt = recorded.batches[0];
        const refreshed = observer.waitForResponse(response => new URL(response.url()).pathname === `/api/bank-imports/${receipt.stableKey}` && response.request().method() === 'GET');
        await observer.bringToFront();
        // The receipt heading is behind the open Radix modal. A real pointer
        // action on its own inert title returns trusted content focus instead.
        await observer.getByRole('dialog', { name: 'Zuordnung ändern', exact: true }).getByRole('heading', { name: 'Zuordnung ändern', exact: true }).click();
        expect((await refreshed).status()).toBe(200);
        const otherDialog = observer.getByRole('dialog', { name: 'Zuordnung ändern', exact: true });
        await expect(otherDialog.getByRole('button', { name: 'Zuordnung ändern', exact: true })).toBeDisabled();
        await expect(otherDialog.getByRole('checkbox')).not.toBeChecked();
        await expect(otherDialog.getByRole('alert')).toContainText('zwischenzeitlich geändert');
        const afterMove = await allocationSnapshot(userId);
        const stale = await observer.request.post(changePath, { headers: { 'X-Bivaro-Payment-Contract': '3' }, data: staleInput });
        expect(stale.status()).toBe(409); expect(await stale.json()).toHaveProperty('code', 'PAYMENT_STATE_CHANGED');
        expect(await allocationSnapshot(userId)).toEqual(afterMove);
        await observer.close(); observer = undefined;
      }
      await page.bringToFront(); await page.reload();
      const recovered = page.waitForResponse(response => observes(response.request(), changePath, 'GET') && new URL(response.url()).searchParams.get('idempotencyKey') === identity.operationKey);
      row = await openAllocationReceipt(page);
      expect((await recovered).status()).toBe(200);
      expect(changePosts).toHaveLength(1);
      if (width === 1440) {
        await pendingCleared(page);
        await row.getByRole('button', { name: 'Gespeicherten Vorgang ansehen', exact: true }).click();
        const success = page.getByRole('dialog', { name: 'Zuordnung gespeichert', exact: true });
        await expect(success).toContainText(`Gespeicherter Wechsel: ${a.invoiceNumber} → ${b.invoiceNumber}`);
        await expect(success).toContainText(`Aktuelle Zuordnung: ${b.invoiceNumber}`);
        await success.locator('[data-slot="dialog-footer"]').getByRole('button', { name: 'Schließen', exact: true }).click();
      } else {
        expect(await allocationSnapshot(userId)).toEqual(recorded);
        await row.getByRole('button', { name: 'Ergebnis prüfen', exact: true }).click();
        dialog = page.getByRole('dialog', { name: 'Zuordnung ändern', exact: true });
        await expect(dialog.getByRole('alert')).toContainText('Noch keine gespeicherte Bestätigung gefunden');
        await expect(dialog.getByRole('combobox', { name: 'Rechnung', exact: true })).toBeDisabled();
        await expect(dialog.getByLabel('Grund', { exact: true })).toHaveValue('');
        await dialog.getByRole('button', { name: 'Ergebnis sicher prüfen', exact: true }).click();
        await expect(dialog.getByRole('button', { name: 'Aktuellen Stand neu prüfen', exact: true })).toBeEnabled();
        expect(changePosts).toHaveLength(1); expect(await allocationSnapshot(userId)).toEqual(recorded);
        await dialog.getByRole('button', { name: 'Aktuellen Stand neu prüfen', exact: true }).click();
        await chooseAllocationInvoice(dialog, b.id, b.invoiceNumber!, true);
        await saveReviewed(page, dialog, changePath, true);
        expect(changePosts).toHaveLength(2);
        expect(changePosts[1].idempotencyKey).not.toBe(identity.operationKey);
        await pendingCleared(page);
      }
    } else await saveReviewed(page, dialog, changePath, true);

    await assertMoved(page, a.id, b.id, recorded.payments[0].id);
    const moved = await allocationSnapshot(userId);
    await assertCashAndEvidenceUnchanged(recorded, moved);
    expect(moved.changes).toEqual([expect.objectContaining({ fromInvoiceId: a.id, toInvoiceId: b.id, amountCents: '4000', revision: 1 })]);
    expect(moved.operations).toHaveLength(recorded.operations.length + 1);
    expect(moved.adjustments).toEqual([]);
    expect((await allocationRowState(page, csv.stableKey)).assignment).toMatchObject({ originInvoiceId: a.id, allocatedInvoice: { invoiceId: b.id }, allocationRevision: 1 });
    const physicalReceipt = await page.request.get(`${recordPath(csv.stableKey)}?idempotencyKey=${binding.idempotencyKey}`, { headers: { 'X-Bivaro-Payment-Contract': '3' } });
    expect(physicalReceipt.status()).toBe(200);
    expect(await physicalReceipt.json()).toMatchObject({ operation: { kind: 'BANK_PAYMENT_RECORDED', originInvoiceId: a.id, originalPaymentId: recorded.payments[0].id, amountCents: '4000' }, row: { assignment: { allocatedInvoice: { invoiceId: b.id }, allocationRevision: 1 } } });
    expect(await (await page.request.get(`/api/invoices/download?id=${a.id}&download=true`)).body()).toEqual(originalPdf);
    await noAllocationOverflow(page);
    if (width === 360) {
      await row.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath('bank-allocation-current-origin-360.png'), fullPage: false });
      await cancelAndRefund(page, userId, a.id, a.invoiceNumber!, b.id, b.invoiceNumber!, moved);
    }
  } finally { await observer?.close(); await prisma.$disconnect(); }
});

async function cancelAndRefund(page: Page, userId: string, originId: number, originNumber: string, invoiceId: number, number: string, before: Awaited<ReturnType<typeof allocationSnapshot>>) {
  await page.goto('/dashboard?tab=invoices');
  await page.getByRole('button', { name: `Weitere Aktionen fuer Rechnung ${number}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rechnung stornieren', exact: true }).click();
  const cancellation = page.getByRole('dialog', { name: 'Rechnung stornieren', exact: true });
  await cancellation.getByLabel('Stornierungsgrund (erforderlich)', { exact: true }).fill('SYNTHETISCH · Leistung vollständig storniert; erhaltene 40 EUR noch nicht zurückgezahlt.');
  const cancelled = page.waitForResponse(response => observes(response.request(), '/api/invoices/cancel'));
  await cancellation.getByRole('button', { name: 'Rechnung stornieren', exact: true }).click();
  const response = await cancelled; expect(response.status()).toBe(200);
  const { creditNote } = await response.json() as { creditNote: { id: number; invoiceNumber: string } };
  await expect(cancellation).toHaveCount(0);
  expect(await prisma.invoice.findUnique({ where: { id: creditNote.id }, select: { originalInvoiceId: true, type: true, status: true, issuanceState: true, totalAmount: true } })).toEqual({ originalInvoiceId: invoiceId, type: 'CREDIT_NOTE', status: 'SENT', issuanceState: 'ISSUED', totalAmount: -120 });
  const cancelledJournal = await allocationJournal(page, invoiceId);
  expect(cancelledJournal.ledger).toMatchObject({ documentState: 'CANCELLED', collectibleOpenCents: '0', refundDueCents: '4000', allocation: { validAllocatedCents: '4000', refundedAllocatedCents: '0' } });
  expect(cancelledJournal.eligibleCancellationBasis).toMatchObject({ invoiceId: creditNote.id, invoiceNumber: creditNote.invoiceNumber });
  const afterCancel = await allocationSnapshot(userId);
  await assertCashAndEvidenceUnchanged(before, afterCancel); expect(afterCancel.adjustments).toEqual([]);
  const dialog = await openJournal(page, number);
  const panel = dialog.getByRole('region', { name: panelName, exact: true });
  await panel.getByRole('button', { name: 'Korrektur / Erstattung dokumentieren', exact: true }).click();
  await panel.getByRole('radio', { name: /Erstattung Bereits zurückgezahlt/u }).check();
  await panel.getByLabel('Ursprünglicher Zahlungsnachweis', { exact: true }).selectOption(String(before.payments[0].id));
  await panel.getByLabel('Tatsächlich ausgezahlter Betrag (EUR)', { exact: true }).fill('40.00');
  await panel.getByLabel('Tatsächliches Auszahlungsdatum', { exact: true }).fill('2026-02-03');
  await panel.getByLabel('Nachvollziehbarer Grund', { exact: true }).fill('SYNTHETISCH · bereits tatsächlich ausgezahlte Rückzahlung nach Vollstorno.');
  await panel.getByLabel('Nachweis der tatsächlichen Auszahlung', { exact: true }).fill('SYNTHETISCH · Bank-Auszahlungsbeleg 2026-02-03');
  await panel.getByRole('checkbox', { name: /Der Kunde hat den Betrag tatsächlich zurückerhalten/u }).check();
  const saved = page.waitForResponse(result => observes(result.request(), `/api/invoices/${invoiceId}/payments/adjustments`));
  await panel.getByRole('button', { name: 'Erstattung verbindlich dokumentieren', exact: true }).click();
  const result = await saved; expect(result.status()).toBe(201);
  expect(result.request().postDataJSON()).toMatchObject({ originalPaymentId: before.payments[0].id, expectedAllocationRevision: 1, cancellationInvoiceId: creditNote.id });
  await expect(panel.getByText('Erstattung dokumentiert', { exact: true })).toBeVisible();
  const after = await allocationSnapshot(userId); await assertCashAndEvidenceUnchanged(before, after);
  expect(after.adjustments).toEqual([expect.objectContaining({ invoiceId, originalPaymentId: before.payments[0].id, kind: 'CUSTOMER_REFUND', amountCents: '4000', contractVersion: 3, allocationRevision: 1, allocationBindingId: before.bindings[0].id, allocationChangeId: before.changes[0].id, accountingEffectiveOn: new Date('2026-02-03T00:00:00Z'), allocationBasisSnapshot: expect.objectContaining({ bindingStableKey: before.bindings[0].stableKey, rowStableKey: before.rows[0].stableKey, allocationRevision: 1, originInvoiceNumber: originNumber, currentInvoiceNumber: number }) })]);
  expect((await allocationJournal(page, originId)).ledger.originCash).toMatchObject({ originalReceivedCents: '4000', refundedCents: '4000', netRetainedCents: '0' });
  expect((await allocationJournal(page, invoiceId)).ledger).toMatchObject({ originCash: { originalReceivedCents: '0' }, allocation: { validAllocatedCents: '4000', refundedAllocatedCents: '4000', retainedAllocatedCents: '0' }, refundDueCents: '0', collectibleOpenCents: '0' });
  expect((await allocationRowState(page, before.rows[0].stableKey)).assignment).toMatchObject({ canReallocate: false });
}

for (const committed of [true, false]) test(`bank allocation: reload recovers ${committed ? 'lost recorded success' : 'a never-committed receipt'} by GET only`, async ({ page }) => {
  test.setTimeout(180_000);
  const { userId, customerId } = await bankAllocationAccount(page);
  try {
    const a = await issueAllocationInvoice(page, userId, customerId, `BANK-RECOVERY-${randomUUID().slice(0, 8)}`);
    const csv = await saveAllocationRow(page, userId, a.invoiceNumber!);
    let row = await openAllocationReceipt(page);
    let dialog = await recordDialog(page, row);
    await chooseAllocationInvoice(dialog, a.id, a.invoiceNumber!);
    const before = await allocationSnapshot(userId), path = recordPath(csv.stableKey), posts: Record<string, unknown>[] = [];
    page.on('request', request => { if (observes(request, path)) posts.push(request.postDataJSON() as Record<string, unknown>); });
    await page.route(`**${path}`, async route => {
      if (committed) { const actual = await route.fetch(); expect(actual.status()).toBe(201); }
      await route.abort('connectionreset');
    }, { times: 1 });
    await dialog.getByRole('button', { name: 'Zahlung zuordnen', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Ergebnis noch unklar');
    const identity = await pending(page, userId, csv.stableKey, 'record');
    expect(identity).toMatchObject({ bindingStableKey: null, expectedAllocationRevision: null, expectedSourceLedgerVersion: null });
    expect(JSON.stringify(identity)).not.toContain(a.invoiceNumber!);
    const uncertain = await allocationSnapshot(userId);
    if (!committed) expect(uncertain).toEqual(before);
    await page.reload();
    const recovered = page.waitForResponse(response => observes(response.request(), path, 'GET') && new URL(response.url()).searchParams.get('idempotencyKey') === identity.operationKey);
    row = await openAllocationReceipt(page); expect((await recovered).status()).toBe(200);
    expect(posts).toHaveLength(1); expect(await allocationSnapshot(userId)).toEqual(uncertain);
    if (committed) {
      await pendingCleared(page);
      await row.getByRole('button', { name: 'Gespeicherten Vorgang ansehen', exact: true }).click();
      const success = page.getByRole('dialog', { name: 'Zuordnung gespeichert', exact: true });
      await expect(success).toContainText(`Ursprünglich bestätigt für ${a.invoiceNumber}`);
      await expect(success).toContainText(`Aktuelle Zuordnung: ${a.invoiceNumber}`);
      expect((await allocationJournal(page, a.id)).ledger.collectibleOpenCents).toBe('8000');
    } else {
      await row.getByRole('button', { name: 'Ergebnis prüfen', exact: true }).click();
      dialog = page.getByRole('dialog', { name: 'Rechnung zuordnen', exact: true });
      await expect(dialog.getByRole('alert')).toContainText('Noch keine gespeicherte Bestätigung gefunden');
      await expect(dialog.getByRole('combobox', { name: 'Rechnung', exact: true })).toBeDisabled();
      await dialog.getByRole('button', { name: 'Ergebnis sicher prüfen', exact: true }).click();
      await expect(dialog.getByRole('button', { name: 'Aktuellen Stand neu prüfen', exact: true })).toBeEnabled();
      expect(posts).toHaveLength(1); expect(await allocationSnapshot(userId)).toEqual(before);
      await dialog.getByRole('button', { name: 'Aktuellen Stand neu prüfen', exact: true }).click();
      await chooseAllocationInvoice(dialog, a.id, a.invoiceNumber!);
      await saveReviewed(page, dialog, path);
      expect(posts).toHaveLength(2); expect(posts[1].idempotencyKey).not.toBe(identity.operationKey);
      await pendingCleared(page);
    }
    const after = await allocationSnapshot(userId);
    expect(after.payments).toHaveLength(1); expect(after.incomes).toHaveLength(1); expect(after.bindings).toHaveLength(1);
    expect(after.changes).toEqual([]); expect(after.adjustments).toEqual([]); expect(after.operations).toHaveLength(1);
    expect(after.batches).toEqual(before.batches); expect(after.rows).toEqual(before.rows);
  } finally { await prisma.$disconnect(); }
});

test('bank allocation: a wrong CSV amount is truthfully corrected, never disguised as a refund or reallocation', async ({ page }) => {
  test.setTimeout(240_000);
  const { userId, customerId } = await bankAllocationAccount(page);
  try {
    const suffix = randomUUID().slice(0, 8);
    const a = await issueAllocationInvoice(page, userId, customerId, `BANK-WRONG-A-${suffix}`);
    const b = await issueAllocationInvoice(page, userId, customerId, `BANK-WRONG-B-${suffix}`);
    const csv = await saveAllocationRow(page, userId, a.invoiceNumber!);
    const row = await openAllocationReceipt(page);
    let dialog = await recordDialog(page, row);
    await chooseAllocationInvoice(dialog, a.id, a.invoiceNumber!);
    await saveReviewed(page, dialog, recordPath(csv.stableKey));
    const initial = await allocationSnapshot(userId);
    dialog = await moveDialog(page, row);
    await chooseAllocationInvoice(dialog, b.id, b.invoiceNumber!, true);
    await saveReviewed(page, dialog, movePath(initial.bindings[0].stableKey), true);
    const moved = await allocationSnapshot(userId);
    await page.goto('/dashboard?tab=invoices');
    dialog = await openJournal(page, b.invoiceNumber!);
    const panel = dialog.getByRole('region', { name: panelName, exact: true });
    await panel.getByRole('button', { name: 'Korrektur / Erstattung dokumentieren', exact: true }).click();
    await panel.getByRole('radio', { name: /Korrektur/u }).check();
    await panel.getByLabel('Ursprünglicher Zahlungsnachweis', { exact: true }).selectOption(String(initial.payments[0].id));
    await panel.getByLabel('Nie erhaltener Betrag (EUR)', { exact: true }).fill('10.00');
    await panel.getByLabel('Datum der entdeckten Fehlbuchung', { exact: true }).fill('2026-02-04');
    await panel.getByLabel('Nachvollziehbarer Grund', { exact: true }).fill('SYNTHETISCH · CSV zeigte irrtümlich 40 EUR; tatsächlich nur 30 EUR erhalten. Die übrigen 10 EUR sind nie eingegangen.');
    await panel.getByLabel('Prüfbarer Korrekturbezug', { exact: true }).fill('SYNTHETISCH · korrigierter Banknachweis: Eingang 30 EUR am 01.02.2026');
    await panel.getByRole('checkbox', { name: /Dieser Betrag ist nie eingegangen/u }).check();
    const saved = page.waitForResponse(response => observes(response.request(), `/api/invoices/${b.id}/payments/adjustments`));
    await panel.getByRole('button', { name: 'Korrektur verbindlich speichern', exact: true }).click();
    const result = await saved; expect(result.status()).toBe(201);
    expect(result.request().postDataJSON()).toMatchObject({ originalPaymentId: initial.payments[0].id, expectedAllocationRevision: 1, kind: 'PAYMENT_CORRECTION', amount: '10.00', declarationNeverReceived: true });
    await expect(panel.getByText('Korrektur gespeichert', { exact: true })).toBeVisible();
    const corrected = await allocationSnapshot(userId); await assertCashAndEvidenceUnchanged(moved, corrected);
    expect(corrected.changes).toEqual(moved.changes);
    expect(corrected.adjustments).toEqual([expect.objectContaining({ invoiceId: b.id, originalPaymentId: initial.payments[0].id, kind: 'PAYMENT_CORRECTION', amountCents: '1000', contractVersion: 3, allocationRevision: 1, accountingEffectiveOn: new Date('2026-02-01T00:00:00Z'), allocationBasisSnapshot: expect.objectContaining({ originInvoiceNumber: a.invoiceNumber, currentInvoiceNumber: b.invoiceNumber }) })]);
    expect((await allocationJournal(page, a.id)).ledger.originCash).toMatchObject({ originalReceivedCents: '4000', correctedCents: '1000', validReceivedCents: '3000', refundedCents: '0', netRetainedCents: '3000' });
    expect((await allocationJournal(page, b.id)).ledger).toMatchObject({ originCash: { originalReceivedCents: '0' }, allocation: { originalAllocatedCents: '4000', correctedAllocatedCents: '1000', validAllocatedCents: '3000', refundedAllocatedCents: '0' }, collectibleOpenCents: '9000', refundDueCents: '0' });
    expect((await allocationRowState(page, csv.stableKey)).assignment).toMatchObject({ canReallocate: false, allocationRevision: 1, amountCents: '4000' });
    await page.reload();
    expect(await allocationSnapshot(userId)).toEqual(corrected);
  } finally { await prisma.$disconnect(); }
});
