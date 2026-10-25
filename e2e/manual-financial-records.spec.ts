import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { prisma } from '../lib/prisma';
import { isolatedAccount, allocate, createInvoice } from './helpers/payment-adjustments';
import { correctionAmount, readManualRecordResponse } from '../components/manual-financial-records/manual-record-client';
import type { ManualFinancialRecordDto, ManualFinancialRecordKind } from '../lib/manual-financial-record-contract';

// AUTHORED, NOT EXECUTED in this preparation. Run only with the supported
// isolated-fixture E2E server. Never point at production/user data. All positive
// financial commands use the real authenticated server. Interception below is
// limited to deliberate failures/delays of real responses, never fake success.
const paymentDate = '2025-06-15';
const endpoint = '/api/manual-financial-records';
const isLifecycle = (url: string) => new URL(url).pathname === endpoint;
async function createManual(page: Page, kind: ManualFinancialRecordKind, description: string, original = false) {
  if (kind === 'expense' && original) {
    const pdf = await PDFDocument.create(); pdf.addPage();
    const response = await page.request.post('/api/expenses', { multipart: { description, amount: '100.00', date: `${paymentDate}T00:00:00.000Z`, taxRelevant: 'true', category: 'Büro', taxDeductiblePercentage: '100', receipt: { name: 'synthetic-original.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) } } });
    expect(response.status()).toBe(200); return await response.json() as { id: number; description: string };
  }
  const response = await page.request.post(`/api/${kind === 'income' ? 'incomes' : 'expenses'}`, { data: { description, amount: 100, date: paymentDate, taxRelevant: true, ...(kind === 'expense' ? { category: 'Büro', taxDeductiblePercentage: 100 } : {}) } });
  expect(response.status()).toBe(200); return await response.json() as { id: number; description: string };
}
async function fresh(page: Page, kind: ManualFinancialRecordKind, id: number) {
  const response = await page.request.get(`${endpoint}?kind=${kind}&id=${id}`); expect(response.status()).toBe(200);
  return readManualRecordResponse(await response.json(), kind, id);
}
async function sums(page: Page) {
  const response = await page.request.get('/api/dashboard/summary?timeRange=all'); expect(response.status()).toBe(200);
  const data = await response.json() as { totalIncome: number; totalExpense: number; profit: number };
  return { totalIncome: data.totalIncome, totalExpense: data.totalExpense, profit: data.profit };
}
async function unrelatedFinancialState(userId: string) {
  const orderBy = { id: 'asc' as const };
  return {
    invoices: await prisma.invoice.findMany({ where: { userId }, orderBy }),
    cash: await prisma.cashTransaction.findMany({ where: { userId }, orderBy }),
    journal: await prisma.paymentJournalEvent.findMany({ where: { userId }, orderBy }),
    adjustments: await prisma.paymentAdjustment.findMany({ where: { userId }, orderBy }),
    operations: await prisma.paymentOperation.findMany({ where: { userId }, orderBy }),
    purchases: await prisma.purchaseDocument.findMany({ where: { userId }, orderBy }),
    recurring: await prisma.recurringExpense.findMany({ where: { userId }, orderBy }),
  };
}
async function openRecord(page: Page, kind: ManualFinancialRecordKind, description: string, navigate = true) {
  if (navigate) await page.goto(`/dashboard?tab=${kind === 'income' ? 'incomes' : 'expenses'}`);
  const opener = page.getByRole('button', { name: `${description}: Status, Original und Verlauf`, exact: true }).filter({ visible: true });
  await expect(opener).toBeVisible(); await opener.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: `${kind === 'income' ? 'Einnahme' : 'Ausgabe'}: Status, Original und Verlauf`, exact: true });
  await expect(dialog.getByRole('region', { name: 'Aktuelle Datensatzdetails', exact: true })).toBeVisible();
  return { dialog, opener };
}
async function finalize(dialog: Locator) {
  const declaration = dialog.getByRole('checkbox', { name: /Ich bestätige: Dies ist ein einzelner manueller Altbestand/ });
  if (await declaration.count()) await declaration.check();
  await dialog.getByRole('button', { name: 'Festschreibung prüfen', exact: true }).click();
  const preview = dialog.getByRole('region', { name: 'Verbindliche Änderungsvorschau', exact: true });
  await expect(preview).toBeFocused();
  await expect(preview).toContainText('Betrag unverändert');
  await preview.getByRole('checkbox', { name: /Ich habe die frischen Angaben geprüft/ }).check();
  await preview.getByRole('button', { name: 'Jetzt ausdrücklich festschreiben', exact: true }).click();
  await expect(dialog.getByRole('status').filter({ hasText: /^Gespeichert\./ })).toBeVisible();
}
async function correctionPreview(dialog: Locator, amount = '80,00', reason = 'Synthetischer Erfassungsfehler: Betrag war 80 statt 100 EUR.') {
  await dialog.getByLabel('Neuer wirksamer Betrag (EUR)', { exact: true }).fill(amount);
  await dialog.getByLabel('Nachvollziehbarer Korrekturgrund', { exact: true }).fill(reason);
  await dialog.getByRole('button', { name: 'Betragskorrektur prüfen', exact: true }).click();
  const preview = dialog.getByRole('region', { name: 'Verbindliche Änderungsvorschau', exact: true });
  await expect(preview).toBeFocused();
  await preview.getByRole('checkbox', { name: /Ich habe die frischen Angaben geprüft/ }).check();
  return preview.getByRole('button', { name: 'Betragskorrektur speichern', exact: true });
}
function heldResponse() {
  let release!: () => void; let arrived!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const accepted = new Promise<void>(resolve => { arrived = resolve; });
  return { release, accepted, handle: async (route: Route) => { const response = await route.fetch(); expect(response.status()).toBe(200); arrived(); await waiting; await route.fulfill({ response }); } };
}
async function directFinalize(page: Page, record: ManualFinancialRecordDto) {
  const response = await page.request.post(endpoint, { data: { kind: record.kind, id: record.id, operation: 'FINALIZE', expectedRevision: record.revision, fingerprint: record.fingerprint, mutationId: randomUUID(), ...(record.requiresLegacyDeclaration ? { legacyManualDeclaration: true } : {}) } });
  expect(response.status()).toBe(200);
}

test.describe('bounded manual financial lifecycle #54a', () => {
  for (const kind of ['income', 'expense'] as const) {
    for (const width of [360, 390, 1440]) {
      test(`${kind}: original 100 retained, one effective 80 and unchanged payment day at ${width}px`, async ({ page }, testInfo) => {
        const userId = await isolatedAccount(page); const description = `Synthetic ${kind} ${randomUUID()}`;
        const viewport = { width, height: width === 1440 ? 1000 : 844 };
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: 'light' });
        const row = await createManual(page, kind, description, kind === 'expense');
        const unrelated = await unrelatedFinancialState(userId); const before = await sums(page);
        let getCount = 0; page.on('request', request => { if (isLifecycle(request.url()) && request.method() === 'GET') getCount++; });
        await page.goto(`/dashboard?tab=${kind === 'income' ? 'incomes' : 'expenses'}`);
        expect(getCount).toBe(0); // List rendering must not stampede per-row GET.
        const { dialog, opener } = await openRecord(page, kind, description, false);
        expect(getCount).toBe(1);
        await expect(dialog).toContainText('bereits in den Auswertungen berücksichtigt');
        if (kind === 'expense') await expect(dialog.getByRole('region', { name: 'Originalnachweis' })).toContainText(/SHA-256: [a-f0-9]{64}/);
        await finalize(dialog);
        expect(await sums(page)).toEqual(before); // Finalization is not a second booking.
        const original = await fresh(page, kind, row.id); expect(original.history).toHaveLength(1); expect(correctionAmount(original.history[0].amount)).toBe('100.00');
        const save = await correctionPreview(dialog);
        await expect(dialog.getByRole('region', { name: 'Verbindliche Änderungsvorschau' })).toContainText('100,00 EUR → neu 80,00 EUR');
        await save.focus(); await page.keyboard.press('Enter');
        await expect(dialog.getByRole('status').filter({ hasText: /^Gespeichert\./ })).toBeVisible();
        const corrected = await fresh(page, kind, row.id);
        expect(corrected).toMatchObject({ state: 'FINALIZED', paymentDate: original.paymentDate, original: original.original });
        expect(corrected.history).toHaveLength(2); expect(corrected.history[0]).toEqual(original.history[0]);
        expect(corrected.history[1]).toMatchObject({ paymentDate: original.paymentDate });
        expect(correctionAmount(corrected.effectiveAmount!)).toBe('80.00'); expect(correctionAmount(corrected.history[1].originalAmount)).toBe('100.00'); expect(correctionAmount(corrected.history[1].amount)).toBe('80.00');
        expect(await unrelatedFinancialState(userId)).toEqual(unrelated);
        const projected = kind === 'income' ? await prisma.income.findMany({ where: { userId } }) : await prisma.expense.findMany({ where: { userId } });
        expect(projected).toHaveLength(1); expect(projected[0].amount).toBe(80); expect(projected[0].date.toISOString().slice(0, 10)).toBe(paymentDate);
        const after = await sums(page); expect(after[kind === 'income' ? 'totalIncome' : 'totalExpense']).toBe(before[kind === 'income' ? 'totalIncome' : 'totalExpense'] - 20);
        await expect(dialog.getByRole('region', { name: 'Vollständiger Änderungsverlauf' })).toContainText('Ursprünglicher Betrag: 100,00 EUR');
        expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        for (const colorScheme of ['light', 'dark'] as const) {
          // Wait for next-themes' asynchronous system-theme reaction, then
          // prove the real browser viewport before each eventual capture.
          // Authored source only: no local rendering or passing result is claimed.
          await page.emulateMedia({ colorScheme });
          await expect(page.locator('html')).toHaveClass(new RegExp(`(?:^|\\s)${colorScheme}(?:\\s|$)`));
          expect(page.viewportSize()).toEqual(viewport);
          await expect.poll(() => page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))).toEqual(viewport);
          const captureName = `manual-record-${kind}-${width}-${colorScheme}.png`;
          // Normal CSS-scale browser viewport, not a cropped or full-page modal.
          const png = await page.screenshot({ path: testInfo.outputPath(captureName), fullPage: false, scale: 'css', animations: 'disabled' });
          expect(png.byteLength).toBeGreaterThanOrEqual(33);
          expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
          expect(png.readUInt32BE(8)).toBe(13); expect(png.toString('ascii', 12, 16)).toBe('IHDR');
          const encodedGeometry = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
          expect(encodedGeometry).toEqual(viewport);
          expect(png.byteLength).toBeLessThanOrEqual(1 * 1024 * 1024);
          expect(encodedGeometry.width * encodedGeometry.height * 4).toBeLessThanOrEqual(16 * 1024 * 1024);
          process.stdout.write(`Manual financial record viewport proof: ${JSON.stringify({ name: captureName, encodedBytes: png.byteLength, encodedSha256: createHash('sha256').update(png).digest('hex'), ...encodedGeometry, colorScheme })}\n`);
        }
        await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
        await expect(opener).toBeFocused();
        const visibleRow = width >= 1280 ? opener.locator('xpath=ancestor::tr') : opener.locator('xpath=ancestor::article');
        await expect(visibleRow.getByRole('button', { name: /bearbeiten|duplizieren|löschen/i })).toHaveCount(0);
        // Generic server routes remain protected even if an obsolete control survives.
        const genericPut = await page.request.put(`/api/${kind === 'income' ? 'incomes' : 'expenses'}`, { data: {
          id: row.id, description, amount: 999, date: paymentDate, taxRelevant: true,
          ...(kind === 'expense' ? { category: 'Büro', taxDeductiblePercentage: 100, depreciationYears: null, receiptUrl: null } : {}),
        } });
        expect(genericPut.status()).toBe(409); expect((await genericPut.json()).code).toBe('FINALIZED_RECORD');
        expect((await page.request.delete(`/api/${kind === 'income' ? 'incomes' : 'expenses'}?id=${row.id}`)).status()).toBe(409);
      });
    }
  }

  test('legacy needs explicit declaration; journal, recurring and AfA eligibility stays server-authoritative', async ({ page }) => {
    const userId = await isolatedAccount(page);
    // Historical fixture only. The positive FINALIZE below still uses the real server.
    const legacy = await prisma.income.create({ data: { userId, description: `Synthetic legacy ${randomUUID()}`, amount: 100, date: new Date(`${paymentDate}T00:00:00.000Z`), taxRelevant: true } });
    const { dialog } = await openRecord(page, 'income', legacy.description);
    await expect(dialog).toContainText('Altbestand · noch nicht geprüft');
    await dialog.getByRole('button', { name: 'Festschreibung prüfen', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('ausdrücklich');
    await expect(dialog.getByRole('alert')).toBeFocused();
    expect((await fresh(page, 'income', legacy.id)).history).toHaveLength(0);
    await finalize(dialog); await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
    const afaResponse = await page.request.post('/api/expenses', { data: { description: `Synthetic AfA ${randomUUID()}`, amount: 100, date: paymentDate, depreciationYears: 3 } });
    expect(afaResponse.status()).toBe(200); const afa = await afaResponse.json() as { id: number; description: string };
    const recurringResponse = await page.request.post('/api/recurring-expenses', { data: { description: `Synthetic series ${randomUUID()}`, amount: 100, interval: 'YEARLY', dayOfMonth: 1, startDate: '2026-01-01', endDate: '2026-01-01' } });
    expect(recurringResponse.status()).toBe(200); const recurring = await recurringResponse.json() as { id: number };
    const execute = await page.request.post('/api/recurring-expenses/execute', { data: { id: recurring.id } }); expect(execute.status()).toBe(200);
    const series = (await execute.json() as { expenses: { id: number; description: string }[] }).expenses[0]; expect(series).toBeDefined();
    const invoice = await createInvoice(page, `SYNTHETIC-SOURCE-${randomUUID()}`, { totalAmount: 100 });
    await allocate(page, invoice.id, '100.00', paymentDate, '0');
    const source = await prisma.income.findFirstOrThrow({ where: { userId, invoiceId: invoice.id } });
    for (const item of [{ kind: 'expense' as const, ...afa }, { kind: 'expense' as const, ...series }, { kind: 'income' as const, ...source }]) {
      const dto = await fresh(page, item.kind, item.id); expect(dto.canFinalize).toBe(false); expect(dto.canCorrectAmount).toBe(false); expect(dto.readOnlyReason).toBeTruthy();
      const opened = await openRecord(page, item.kind, item.description);
      await expect(opened.dialog.getByRole('button', { name: 'Festschreibung prüfen', exact: true })).toHaveCount(0);
      await expect(opened.dialog.getByRole('button', { name: 'Betragskorrektur prüfen', exact: true })).toHaveCount(0);
      await expect(opened.dialog).toContainText(dto.readOnlyReason!);
      await opened.dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
    }
  });

  test('earlier recorded detail observation cannot weaken a fresh finalized list observation', async ({ page, context }) => {
    await isolatedAccount(page); await page.setViewportSize({ width: 1440, height: 1000 });
    const row = await createManual(page, 'income', `Synthetic monotonic status ${randomUUID()}`);
    const { dialog, opener } = await openRecord(page, 'income', row.description);
    await expect(dialog).toContainText('Erfasst · bereits berücksichtigt');
    await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
    const other = await context.newPage();
    try { await directFinalize(other, await fresh(other, 'income', row.id)); } finally { await other.close(); }
    await page.locator('#incomes-page-size').selectOption('20');
    const rowElement = opener.locator('xpath=ancestor::tr'); await expect(rowElement).toContainText('Festgeschrieben');
    await expect(rowElement.getByRole('button', { name: /bearbeiten|duplizieren|löschen/i })).toHaveCount(0);
  });

  test('two fresh tabs conflict with 409 rather than overwriting another correction', async ({ page, context }) => {
    await isolatedAccount(page); const row = await createManual(page, 'income', `Synthetic stale ${randomUUID()}`);
    await directFinalize(page, await fresh(page, 'income', row.id));
    const second = await context.newPage();
    try {
      const a = await openRecord(page, 'income', row.description); const b = await openRecord(second, 'income', row.description);
      const saveA = await correctionPreview(a.dialog, '80.00'); const saveB = await correctionPreview(b.dialog, '70.00');
      await saveA.click(); await expect(a.dialog.getByRole('status').filter({ hasText: /^Gespeichert\./ })).toBeVisible();
      const rejected = second.waitForResponse(response => isLifecycle(response.url()) && response.request().method() === 'POST');
      await saveB.click(); expect((await rejected).status()).toBe(409);
      await expect(b.dialog.getByRole('alert')).toContainText('zwischenzeitlich');
      await expect(b.dialog.getByLabel('Neuer wirksamer Betrag (EUR)', { exact: true })).toHaveValue('70.00');
      expect((await fresh(page, 'income', row.id)).history).toHaveLength(2);
    } finally { await second.close(); }
  });

  test('lost committed response recovers by GET mutationId with no second POST', async ({ page }) => {
    await isolatedAccount(page); const row = await createManual(page, 'income', `Synthetic lost reply ${randomUUID()}`);
    await directFinalize(page, await fresh(page, 'income', row.id)); const { dialog } = await openRecord(page, 'income', row.description);
    let posts = 0; let uuid: string | undefined;
    await page.route('**/api/manual-financial-records', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      posts++; uuid = (route.request().postDataJSON() as { mutationId: string }).mutationId;
      const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed');
    });
    await (await correctionPreview(dialog)).click();
    await expect(dialog.getByRole('status').filter({ hasText: /^Gespeichert\./ })).toBeVisible();
    expect(posts).toBe(1); const dto = await fresh(page, 'income', row.id);
    expect(dto.history.filter(entry => entry.mutationId === uuid)).toHaveLength(1); expect(correctionAmount(dto.effectiveAmount!)).toBe('80.00');
  });

  for (const laterAmount of ['90.00', '100.00']) {
    test(`delayed real response preserves newer keyboard draft ${laterAmount}, including exact old-value reversion`, async ({ page }) => {
      await isolatedAccount(page); const row = await createManual(page, 'income', `Synthetic delayed ${randomUUID()}`);
      await directFinalize(page, await fresh(page, 'income', row.id)); const { dialog } = await openRecord(page, 'income', row.description);
      const held = heldResponse(); await page.route('**/api/manual-financial-records', held.handle, { times: 1 });
      const save = await correctionPreview(dialog); await save.click(); await held.accepted;
      const amount = dialog.getByLabel('Neuer wirksamer Betrag (EUR)', { exact: true });
      await amount.focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type(laterAmount);
      await dialog.getByLabel('Nachvollziehbarer Korrekturgrund', { exact: true }).fill('Neuere noch ungespeicherte Eingabe');
      held.release();
      await expect(dialog.getByRole('status').filter({ hasText: /neueren Eingaben/ })).toBeVisible();
      await expect(amount).toHaveValue(laterAmount);
      await expect(dialog.getByLabel('Nachvollziehbarer Korrekturgrund', { exact: true })).toHaveValue('Neuere noch ungespeicherte Eingabe');
      expect(correctionAmount((await fresh(page, 'income', row.id)).effectiveAmount!)).toBe('80.00');
      await page.keyboard.press('Escape'); await expect(dialog.getByRole('alertdialog')).toBeVisible();
      await dialog.getByRole('button', { name: 'Hier bleiben', exact: true }).click(); await expect(amount).toHaveValue(laterAmount);
    });
  }

  test('delayed read preserves a newer dirty draft even when it returns to exact old server amount', async ({ page }) => {
    await isolatedAccount(page); const row = await createManual(page, 'income', `Synthetic read generation ${randomUUID()}`);
    await directFinalize(page, await fresh(page, 'income', row.id)); const { dialog } = await openRecord(page, 'income', row.description);
    await dialog.getByLabel('Neuer wirksamer Betrag (EUR)', { exact: true }).fill('80.00');
    const held = heldResponse(); await page.route('**/api/manual-financial-records?**', held.handle, { times: 1 });
    await dialog.getByRole('button', { name: 'Details frisch laden', exact: true }).click(); await held.accepted;
    const amount = dialog.getByLabel('Neuer wirksamer Betrag (EUR)', { exact: true });
    await amount.focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('100.00');
    await dialog.getByLabel('Nachvollziehbarer Korrekturgrund', { exact: true }).fill('Bewusst auf alten Wert zurückgeändert');
    held.release(); await expect(dialog.getByText('Aktuelle Details und vollständigen Verlauf laden …', { exact: true })).toHaveCount(0);
    await expect(amount).toHaveValue('100.00'); await expect(dialog.getByLabel('Nachvollziehbarer Korrekturgrund', { exact: true })).toHaveValue('Bewusst auf alten Wert zurückgeändert');
    await dialog.getByRole('button', { name: 'Betragskorrektur prüfen', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('abweichen');
    expect((await fresh(page, 'income', row.id)).history).toHaveLength(1);
  });

  test('uncertain noncommitted retry keeps exact UUID/body; failed recovery read cannot become success', async ({ page }) => {
    await isolatedAccount(page); const row = await createManual(page, 'income', `Synthetic retry identity ${randomUUID()}`);
    await directFinalize(page, await fresh(page, 'income', row.id)); const { dialog } = await openRecord(page, 'income', row.description);
    const bodies: unknown[] = [];
    page.on('request', request => { if (isLifecycle(request.url()) && request.method() === 'POST') bodies.push(request.postDataJSON()); });
    await page.route('**/api/manual-financial-records', route => route.abort('failed'), { times: 1 });
    await (await correctionPreview(dialog)).click();
    const retry = dialog.getByRole('button', { name: 'Dieselbe bestätigte Anfrage wiederholen', exact: true }); await expect(retry).toBeVisible();
    await page.route('**/api/manual-financial-records?**', route => route.abort('failed'), { times: 1 });
    await retry.click(); await expect(dialog.getByRole('alert')).toBeFocused(); expect(bodies).toHaveLength(1);
    await expect(dialog.getByRole('status').filter({ hasText: /^Gespeichert\./ })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Nachweis erneut prüfen', exact: true }).click(); await expect(retry).toBeVisible(); await retry.click();
    await expect(dialog.getByRole('status').filter({ hasText: /^Gespeichert\./ })).toBeVisible();
    expect(bodies).toHaveLength(2); expect(bodies[1]).toEqual(bodies[0]); expect((await fresh(page, 'income', row.id)).history).toHaveLength(2);
  });

  test('synchronous duplicate clicks send one exact command; pending close explains server acceptance', async ({ page }) => {
    await isolatedAccount(page); const row = await createManual(page, 'income', `Synthetic duplicate ${randomUUID()}`);
    await directFinalize(page, await fresh(page, 'income', row.id)); const { dialog } = await openRecord(page, 'income', row.description);
    const held = heldResponse(); let posts = 0;
    page.on('request', request => { if (isLifecycle(request.url()) && request.method() === 'POST') posts++; });
    await page.route('**/api/manual-financial-records', held.handle, { times: 1 });
    const save = await correctionPreview(dialog);
    await save.evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
    await held.accepted; expect(posts).toBe(1);
    await dialog.getByRole('button', { name: 'Warten beenden / schließen …', exact: true }).click();
    await expect(dialog.getByRole('alertdialog')).toContainText('nicht rückgängig');
    await dialog.getByRole('button', { name: 'Hier bleiben', exact: true }).click(); held.release();
    await expect(dialog.getByRole('status').filter({ hasText: /^Gespeichert\./ })).toBeVisible();
    expect((await fresh(page, 'income', row.id)).history).toHaveLength(2);
  });

  test('reload after never-committed request requires fresh complete read and explicit local abandonment before new preview', async ({ page }) => {
    await isolatedAccount(page); const row = await createManual(page, 'income', `Synthetic reload recovery ${randomUUID()}`);
    await directFinalize(page, await fresh(page, 'income', row.id)); const baseline = await fresh(page, 'income', row.id);
    const { dialog } = await openRecord(page, 'income', row.description); let posts = 0;
    await page.route('**/api/manual-financial-records', async route => { posts++; await route.abort('failed'); }, { times: 1 });
    await (await correctionPreview(dialog)).click();
    await expect(dialog.getByRole('heading', { name: 'Speicherstatus noch ungeklärt' })).toBeVisible();
    page.once('dialog', prompt => prompt.accept()); await page.reload();
    const reloaded = await openRecord(page, 'income', row.description, false);
    await expect(reloaded.dialog.getByRole('heading', { name: 'Speicherstatus noch ungeklärt' })).toBeVisible();
    await expect(reloaded.dialog.getByRole('button', { name: 'Dieselbe bestätigte Anfrage wiederholen', exact: true })).toHaveCount(0);
    expect(posts).toBe(1); expect((await fresh(page, 'income', row.id)).history).toHaveLength(1);
    await reloaded.dialog.getByRole('button', { name: 'Lokalen Versuch nach frischer Prüfung verwerfen …', exact: true }).click();
    await expect(reloaded.dialog).toContainText(`Geprüfter Stand: Revision ${baseline.revision}`); await expect(reloaded.dialog).toContainText(baseline.fingerprint);
    await expect(reloaded.dialog.getByRole('button', { name: 'Nur lokalen Versuch verwerfen', exact: true })).toBeDisabled();
    await reloaded.dialog.getByRole('checkbox', { name: /Ich verstehe: kein Rückgängigmachen/ }).check();
    await reloaded.dialog.getByRole('button', { name: 'Nur lokalen Versuch verwerfen', exact: true }).click(); expect(posts).toBe(1);
    const save = await correctionPreview(reloaded.dialog, '75.00'); expect(posts).toBe(1);
    const request = page.waitForRequest(request => isLifecycle(request.url()) && request.method() === 'POST'); await save.click();
    const body = (await request).postDataJSON() as { expectedRevision: number; fingerprint: string };
    expect(body.expectedRevision).toBe(baseline.revision); expect(body.fingerprint).toBe(baseline.fingerprint);
    await expect(reloaded.dialog.getByRole('status').filter({ hasText: /^Gespeichert\./ })).toBeVisible();
    expect(correctionAmount((await fresh(page, 'income', row.id)).effectiveAmount!)).toBe('75.00');
  });

  test('read/retry failure is not success; list refresh failure retries only GET, not POST', async ({ page }) => {
    await isolatedAccount(page); const row = await createManual(page, 'income', `Synthetic refresh error ${randomUUID()}`);
    await directFinalize(page, await fresh(page, 'income', row.id)); const { dialog } = await openRecord(page, 'income', row.description);
    let posts = 0; page.on('request', request => { if (isLifecycle(request.url()) && request.method() === 'POST') posts++; });
    await page.route('**/api/incomes?**', route => route.abort('failed'));
    await (await correctionPreview(dialog)).click();
    await expect(dialog.getByRole('alert')).toContainText('Änderung gespeichert; Listen'); expect(posts).toBe(1);
    await page.unroute('**/api/incomes?**'); await dialog.getByRole('button', { name: 'Nur Listen erneut laden', exact: true }).click(); expect(posts).toBe(1);
    await page.route('**/api/manual-financial-records?**', route => route.abort('failed'), { times: 1 });
    await dialog.getByRole('button', { name: 'Details frisch laden', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeFocused(); await expect(dialog.getByRole('alert')).toContainText(/fetch|Netz|laden|Anfrage/i);
    expect(posts).toBe(1);
  });

  test('dirty cancel, overlay, native Back/Forward and reload preserve explicit choice and actual opener focus', async ({ page }) => {
    await isolatedAccount(page); const row = await createManual(page, 'income', `Synthetic navigation ${randomUUID()}`);
    await directFinalize(page, await fresh(page, 'income', row.id));
    await page.goto('/dashboard?tab=expenses'); await page.goto('/dashboard?tab=incomes');
    const { dialog, opener } = await openRecord(page, 'income', row.description, false);
    await dialog.getByLabel('Neuer wirksamer Betrag (EUR)', { exact: true }).fill('81.00');
    await dialog.getByLabel('Nachvollziehbarer Korrekturgrund', { exact: true }).fill('Noch nicht gespeichert');
    await page.mouse.click(2, 2); await expect(dialog.getByRole('alertdialog')).toBeFocused();
    await dialog.getByRole('button', { name: 'Hier bleiben', exact: true }).click();
    await page.goBack(); await expect(dialog.getByRole('alertdialog')).toBeVisible();
    await dialog.getByRole('button', { name: 'Hier bleiben', exact: true }).click(); await expect(page).toHaveURL(/tab=incomes/);
    await expect(dialog.getByLabel('Neuer wirksamer Betrag (EUR)', { exact: true })).toHaveValue('81.00');
    page.once('dialog', prompt => prompt.dismiss()); await page.reload().catch(() => {});
    await expect(dialog).toBeVisible(); await expect(dialog.getByLabel('Neuer wirksamer Betrag (EUR)', { exact: true })).toHaveValue('81.00');
    await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
    await dialog.getByRole('button', { name: 'Trotzdem verlassen', exact: true }).click(); await expect(opener).toBeFocused();
    await page.goBack(); await expect(page).toHaveURL(/tab=expenses/); await page.goForward(); await expect(page).toHaveURL(/tab=incomes/);
    // Establish a real forward destination, then enter the dirty dialog at the
    // middle entry. Neither cancellation nor confirmation may rewrite entries.
    await page.goto('/dashboard?tab=expenses'); await page.goBack(); await expect(page).toHaveURL(/tab=incomes/);
    const forward = await openRecord(page, 'income', row.description, false);
    await forward.dialog.getByLabel('Neuer wirksamer Betrag (EUR)', { exact: true }).fill('82.00');
    await page.goForward(); await expect(forward.dialog.getByRole('alertdialog')).toBeVisible();
    await forward.dialog.getByRole('button', { name: 'Hier bleiben', exact: true }).click(); await expect(page).toHaveURL(/tab=incomes/);
    await expect(forward.dialog.getByLabel('Neuer wirksamer Betrag (EUR)', { exact: true })).toHaveValue('82.00');
    await page.goForward(); await expect(forward.dialog.getByRole('alertdialog')).toBeVisible();
    await forward.dialog.getByRole('button', { name: 'Trotzdem verlassen', exact: true }).click(); await expect(page).toHaveURL(/tab=expenses/);
    await page.goBack(); await expect(page).toHaveURL(/tab=incomes/);
    expect((await fresh(page, 'income', row.id)).history).toHaveLength(1);
  });
});
