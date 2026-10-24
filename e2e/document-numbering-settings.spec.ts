import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// Hosted-only functional acceptance: no route mocks, real cookie login, real
// settings/editor mutations and private PDFs, exclusively in the runner fixture.
const settingsPath = '/api/settings/document-numbering';
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function settled(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  expect(await page.evaluate(() => document.fonts.check('400 14px Inter'))).toBe(true);
}

async function navigate(page: Page, destination: string) {
  const session = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/auth/session'
    && new URL(page.url()).pathname === destination);
  await page.goto(destination);
  const response = await session;
  expect(response.status()).toBe(200);
  expect(await response.finished()).toBeNull();
  await settled(page);
}

async function account(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticNumbering123!';
  const user = await prisma.user.create({ data: {
    email: `numbering-${randomUUID()}@example.test`, name: 'Synthetic numbering',
    password: await hashPassword(password), role: 'USER',
  } });
  await navigate(page, '/login');
  await page.getByLabel('E-Mail').fill(user.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  const session = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/auth/session'
    && new URL(page.url()).pathname === '/dashboard');
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  const response = await session;
  expect(response.status()).toBe(200);
  expect(await response.finished()).toBeNull();
  await expect(page).toHaveURL(/\/dashboard/);
  await settled(page);
  return user;
}

function mutation(page: Page, path = settingsPath) {
  return page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === path);
}

async function unissued(userId: string, revisions: number) {
  expect(await prisma.documentNumberingPolicy.count({ where: { userId } })).toBe(revisions);
  expect(await prisma.invoiceNumberCounter.count({ where: { userId } })).toBe(0);
  expect(await prisma.invoice.count({ where: { userId } })).toBe(0);
  expect(await prisma.quoteCreateReceipt.count({ where: { userId } })).toBe(0);
}

async function captureCard(page: Page, card: Locator, info: TestInfo, color: 'light' | 'dark', width: number) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  if (await page.locator('html').evaluate(element => element.classList.contains('dark')) !== (color === 'dark')) {
    await page.getByRole('button', { name: color === 'dark'
      ? 'Dunkles Farbschema aktivieren' : 'Helles Farbschema aktivieren', exact: true }).click();
  }
  await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${color}\\b`));
  // Locator screenshots scroll the tall card into view, where the real sticky
  // app header can cover it. Keep the natural page at its origin instead.
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await settled(page);
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const overlays = await card.evaluate(root => {
    const cardBox = root.getBoundingClientRect();
    return [...document.querySelectorAll('body *')].filter(element => {
      const style = getComputedStyle(element);
      if (!['fixed', 'sticky'].includes(style.position) || style.visibility === 'hidden') return false;
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.left < cardBox.right && box.right > cardBox.left
        && box.top < cardBox.bottom && box.bottom > cardBox.top;
    }).map(element => ({ tag: element.tagName, className: element.className }));
  });
  expect(overlays).toEqual([]);
  const clipped = await card.evaluate(root => [...root.querySelectorAll('button,input,label,fieldset')].filter(element => {
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height || getComputedStyle(element).visibility === 'hidden') return false;
    const parent = root.getBoundingClientRect();
    return box.left < parent.left - 1 || box.right > parent.right + 1
      || box.top < parent.top - 1 || box.bottom > parent.bottom + 1;
  }).map(element => element.textContent?.trim()));
  expect(clipped).toEqual([]);
  const bounds = await card.boundingBox();
  expect(bounds).not.toBeNull();
  const clip = { x: Math.floor(bounds!.x), y: Math.floor(bounds!.y),
    width: Math.ceil(bounds!.x + bounds!.width) - Math.floor(bounds!.x),
    height: Math.ceil(bounds!.y + bounds!.height) - Math.floor(bounds!.y) };
  expect(clip.width * clip.height * 4).toBeLessThanOrEqual(16 * 1024 * 1024);
  expect(info.retry).toBe(0);
  const name = `feature-numbering-${color}-${width}.png`;
  // Page fullPage+clip uses document coordinates without locator auto-scroll.
  // Capture the entire natural card, including its open form; never hide or
  // move the header, alter styles/fonts, or crop any of the card's content.
  const png = await page.screenshot({ path: info.outputPath(name), fullPage: true, clip, animations: 'disabled' });
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 });
  expect(Math.abs(png.readUInt32BE(16) - bounds!.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(png.readUInt32BE(20) - bounds!.height)).toBeLessThanOrEqual(2);
  expect(png.length).toBeLessThanOrEqual(1024 * 1024);
  process.stdout.write(`Numbering card capture proof: ${JSON.stringify({ name, viewport: page.viewportSize(), fullElement: true, documentClip: clip, naturalScroll: { x: 0, y: 0 }, overlays, bounds, pngWidth: png.readUInt32BE(16), pngHeight: png.readUInt32BE(20), encodedBytes: png.length, interLoaded: true, noHorizontalOverflow: true })}\n`);
}

async function syntheticPdf(label: string) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([300, 200]).drawText(label, { x: 20, y: 150, font, size: 12 });
  return Buffer.from(await pdf.save());
}

async function downloadedPdf(page: Page, id: number) {
  const response = await page.request.get(`/api/quotes/download?id=${id}`);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/pdf');
  return response.body();
}

test.afterAll(async () => { await prisma.$disconnect(); });

test('real numbering previews are non-reserving; explicit settings save, immutable revisions, collision and complete responsive card', async ({ page }, info) => {
  test.setTimeout(120_000);
  const user = await account(page);
  await navigate(page, '/settings');
  const card = page.locator('#document-numbering-settings');
  await expect(card.getByRole('button', { name: 'Ändern', exact: true })).toHaveCount(3);
  const initial = await page.request.get(settingsPath);
  expect(initial.status()).toBe(200);
  expect(initial.headers()['cache-control']).toContain('no-store');
  const defaults = await initial.json();
  expect(defaults.version).toBe(1);
  expect(defaults.rows.map((row: { revision: number }) => row.revision)).toEqual([0, 0, 0]);
  for (const path of [settingsPath, '/api/invoices/next-number', '/api/quotes/next-number']) {
    expect((await page.request.get(path)).status()).toBe(200);
    expect((await page.request.get(path)).status()).toBe(200);
  }
  await unissued(user.id, 0);

  const invoiceToggle = card.locator('button[aria-controls="numbering-INVOICE"]');
  await invoiceToggle.click();
  const form = page.locator('#numbering-INVOICE');
  await form.getByLabel('Präfix (max. 16 Zeichen)').fill('RE-');
  await form.getByLabel('Mindestbreite der Sequenz').fill('4');
  await form.getByLabel('Nächster Startwert').fill('25');
  const checking = mutation(page);
  await form.getByRole('button', { name: 'Vorschau prüfen', exact: true }).click();
  const checked = await checking;
  expect(checked.status()).toBe(200);
  expect(await checked.json()).toMatchObject({ saved: false, revision: 0, nextNumber: `RE-${defaults.year}-0025` });
  await expect(form.getByRole('status')).toContainText(`Geprüft, nicht reserviert: RE-${defaults.year}-0025`);
  await unissued(user.id, 0);
  const confirm = form.getByRole('button', { name: 'Nummernformat bestätigen', exact: true });
  await expect(confirm).toBeDisabled();
  await form.getByRole('checkbox', { name: 'Dieses Format und den Startwert ausschließlich für künftige Nummernvergaben verwenden.', exact: true }).check();
  const saving = mutation(page);
  await confirm.click();
  const saved = await saving;
  expect(saved.status()).toBe(201);
  expect(await saved.json()).toMatchObject({ saved: true, revision: 1 });
  await expect(card).toContainText('Nummernformat gespeichert. Offene Editorvorschauen müssen ausdrücklich aktualisiert werden.');
  await expect(card).toContainText(`Nächste Nummer: RE-${defaults.year}-0025 · Revision 1/100`);
  await unissued(user.id, 1);
  const revisionOne = await prisma.documentNumberingPolicy.findFirstOrThrow({ where: { userId: user.id, type: 'INVOICE', revision: 1 } });
  expect(revisionOne).toMatchObject({ prefix: 'RE-', sequenceWidth: 4, startSequence: 25 });
  expect(await prisma.auditLog.count({ where: { userId: user.id, entityType: 'DocumentNumberingPolicy', action: 'SETTINGS_CHANGED' } })).toBe(1);

  await invoiceToggle.click();
  await form.getByLabel('Nächster Startwert').fill('26');
  const rechecking = mutation(page);
  await form.getByRole('button', { name: 'Vorschau prüfen', exact: true }).click();
  expect((await rechecking).status()).toBe(200);
  for (const color of ['light', 'dark'] as const) {
    for (const width of [1440, 390]) await captureCard(page, card, info, color, width);
  }
  await unissued(user.id, 1);
  await form.getByRole('checkbox', { name: 'Dieses Format und den Startwert ausschließlich für künftige Nummernvergaben verwenden.', exact: true }).check();
  const resaving = mutation(page);
  await form.getByRole('button', { name: 'Nummernformat bestätigen', exact: true }).click();
  expect((await resaving).status()).toBe(201);
  await expect(card).toContainText('Revision 2/100');
  expect(await prisma.documentNumberingPolicy.findFirstOrThrow({ where: { userId: user.id, type: 'INVOICE', revision: 1 } })).toEqual(revisionOne);
  await unissued(user.id, 2);

  await invoiceToggle.click();
  await form.getByLabel('Präfix (max. 16 Zeichen)').fill('DISCARDED-');
  await invoiceToggle.click();
  await expect(invoiceToggle).toBeFocused();
  await invoiceToggle.click();
  await expect(form.getByLabel('Präfix (max. 16 Zeichen)')).toHaveValue('RE-');
  await invoiceToggle.click();
  await card.locator('button[aria-controls="numbering-QUOTE"]').click();
  const quoteForm = page.locator('#numbering-QUOTE');
  await quoteForm.getByLabel('Präfix (max. 16 Zeichen)').fill('RE-');
  const collision = mutation(page);
  await quoteForm.getByRole('button', { name: 'Vorschau prüfen', exact: true }).click();
  const rejected = await collision;
  expect(rejected.status()).toBe(409);
  expect(await rejected.json()).toMatchObject({ code: 'NUMBERING_COLLISION' });
  await expect(quoteForm.getByRole('alert')).toBeVisible();
  await expect(quoteForm.getByLabel('Präfix (max. 16 Zeichen)')).toBeDisabled();
  await quoteForm.getByRole('button', { name: 'Neuesten Stand laden', exact: true }).click();
  await expect(card.locator('button[aria-controls="numbering-QUOTE"]')).toHaveAttribute('aria-expanded', 'false');
  await unissued(user.id, 2);
});

test('stale real quote editor cannot consume or rewrite numbers; explicit refresh, durable UUID replay and deleted receipt', async ({ page }) => {
  test.setTimeout(120_000);
  const user = await account(page);
  const originalPdf = await syntheticPdf('SYNTHETIC original issued quote');
  const seedPreviewResponse = await page.request.get('/api/quotes/next-number');
  expect(seedPreviewResponse.status()).toBe(200);
  const seedPreview = await seedPreviewResponse.json();
  const year = seedPreview.numberingSelection.year;
  const quoteDate = `${year}-01-15`;
  const seedResponse = await page.request.post('/api/quotes', { data: {
    fileName: 'SYNTHETIC-issued.pdf', quoteNumber: seedPreview.nextQuoteNumber,
    generatedRequestId: randomUUID(), numberingSelection: seedPreview.numberingSelection,
    quoteDate, totalAmount: 12, parsedData: { createdBy: 'bivaro', taxMode: 'small-business', customerAddress: 'SYNTHETIC customer', items: [{ description: 'Synthetic service', quantity: 1, unitPrice: 12, taxRate: 0 }] },
    pdfBytes: originalPdf.toString('base64'),
  } });
  expect(seedResponse.status()).toBe(200);
  const issued = await seedResponse.json();
  expect(await downloadedPdf(page, issued.id)).toEqual(originalPdf);
  expect(await prisma.invoiceNumberCounter.findMany({ where: { userId: user.id } })).toMatchObject([{ type: 'QUOTE', year, value: 1 }]);

  await navigate(page, '/dashboard/quotes/new');
  await expect(page.getByRole('heading', { name: 'Neues Angebot', exact: true })).toBeVisible();
  const number = page.getByLabel('Angebotsnummer', { exact: true });
  await expect(number).toHaveValue(`AN-${year}-02`);
  await page.getByLabel('Empfänger (Name & Anschrift)', { exact: true }).fill('SYNTHETIC Kunde\nTestweg 1\n10115 Berlin');
  await page.getByLabel('Umsatzsteuer', { exact: true }).selectOption('small-business');
  await page.getByLabel('Steuerbehandlung für dieses Dokument bestätigen.', { exact: true }).check();
  await page.locator('#quote-item-0-description').fill('SYNTHETIC neue Leistung');
  await page.locator('#quote-item-0-unit-price').fill('23');
  const save = page.getByRole('button', { name: 'Angebot erstellen & speichern', exact: true });
  await expect(save).toBeEnabled();
  const change = { version: 1, type: 'QUOTE', expectedRevision: 0, formatVersion: 1, prefix: 'AQ-', includeYear: true, sequenceWidth: 2, startSequence: 7, effectiveYear: year };
  const previewResponse = await page.request.post(settingsPath, { data: { ...change, action: 'preview' } });
  expect(previewResponse.status()).toBe(200);
  const preview = await previewResponse.json();
  expect(preview.nextNumber).toBe(`AQ-${year}-07`);
  const saved = await page.request.post(settingsPath, { data: { ...change, action: 'save', confirmed: true, expectedNumber: preview.nextNumber } });
  expect(saved.status()).toBe(201);
  await expect(number).toHaveValue(`AN-${year}-02`);

  const staleResponsePromise = mutation(page, '/api/quotes');
  const staleDialog = page.waitForEvent('dialog');
  await save.click();
  const staleResponse = await staleResponsePromise;
  expect(staleResponse.status()).toBe(409);
  const dialog = await staleDialog;
  expect(dialog.message()).toContain('Fehler beim Speichern des Angebots:');
  // The editor's native alert pauses Chromium; dismiss the expected dialog
  // before asking Playwright to retrieve the response body over that page.
  await dialog.accept();
  expect(await staleResponse.json()).toMatchObject({ code: 'NUMBERING_STALE' });
  const stalePayload = staleResponse.request().postDataJSON();
  await expect(save).toBeEnabled();
  await expect(number).toHaveValue(`AN-${year}-02`);
  expect(await prisma.invoice.count({ where: { userId: user.id } })).toBe(1);
  expect(await prisma.quoteCreateReceipt.count({ where: { userId: user.id } })).toBe(1);
  expect(await prisma.invoiceNumberCounter.findMany({ where: { userId: user.id } })).toMatchObject([{ type: 'QUOTE', year, value: 1 }]);
  expect(await prisma.invoice.findFirstOrThrow({ where: { userId: user.id, id: issued.id } })).toMatchObject({ invoiceNumber: seedPreview.nextQuoteNumber, storedFileName: issued.storedFileName });
  expect(await downloadedPdf(page, issued.id)).toEqual(originalPdf);

  await page.getByRole('button', { name: 'Nummer aktualisieren', exact: true }).click();
  await expect(number).toHaveValue(`AQ-${year}-07`);
  const createResponsePromise = mutation(page, '/api/quotes');
  await save.click();
  const createdResponse = await createResponsePromise;
  expect(createdResponse.status()).toBe(200);
  const created = await createdResponse.json();
  const payload = createdResponse.request().postDataJSON();
  expect(payload.generatedRequestId).toBe(stalePayload.generatedRequestId);
  expect(payload.generatedRequestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(payload.numberingSelection).toMatchObject({ revision: 1, automatic: true, number: `AQ-${year}-07` });
  await expect(page).toHaveURL(/\/dashboard\?tab=quotes/);
  const exactBytes = await downloadedPdf(page, created.id);
  expect(exactBytes.subarray(0, 5).toString()).toBe('%PDF-');
  const receipt = await prisma.quoteCreateReceipt.findUniqueOrThrow({ where: { userId_requestId: { userId: user.id, requestId: payload.generatedRequestId } } });
  expect(receipt).toMatchObject({ invoiceUserId: user.id, invoiceId: created.id, pdfSha256: sha256(exactBytes) });
  expect(await prisma.invoiceNumberCounter.findMany({ where: { userId: user.id } })).toMatchObject([{ type: 'QUOTE', year, value: 7 }]);

  // A repeated request with different valid PDF bytes must replay the committed
  // original, not replace it or reserve another number.
  const replay = await page.request.post('/api/quotes', { data: { ...payload, pdfBytes: originalPdf.toString('base64') } });
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toMatchObject({ id: created.id, idempotent: true, storedFileName: created.storedFileName });
  expect(await downloadedPdf(page, created.id)).toEqual(exactBytes);
  expect(await prisma.quoteCreateReceipt.findUniqueOrThrow({ where: { userId_requestId: { userId: user.id, requestId: payload.generatedRequestId } } })).toEqual(receipt);
  const changed = await page.request.post('/api/quotes', { data: { ...payload, totalAmount: 999 } });
  expect(changed.status()).toBe(409);
  expect(await changed.json()).toMatchObject({ code: 'QUOTE_REQUEST_CONFLICT' });
  expect(await prisma.invoice.count({ where: { userId: user.id } })).toBe(2);
  expect((await page.request.delete(`/api/quotes?id=${created.id}`)).status()).toBe(200);
  expect(await prisma.quoteCreateReceipt.findUniqueOrThrow({ where: { userId_requestId: { userId: user.id, requestId: payload.generatedRequestId } } })).toMatchObject({ ...receipt, invoiceUserId: null, invoiceId: null });
  const retired = await page.request.post('/api/quotes', { data: payload });
  expect(retired.status()).toBe(410);
  expect(await retired.json()).toMatchObject({ code: 'QUOTE_REQUEST_RETIRED' });
  expect(await prisma.invoice.count({ where: { userId: user.id } })).toBe(1);
  expect(await prisma.quoteCreateReceipt.count({ where: { userId: user.id } })).toBe(2);
  expect(await prisma.invoiceNumberCounter.findMany({ where: { userId: user.id } })).toMatchObject([{ type: 'QUOTE', year, value: 7 }]);
  expect(await downloadedPdf(page, issued.id)).toEqual(originalPdf);
});
