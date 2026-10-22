import { expect, test, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../lib/password';
import { EMPTY_REVIEW_DRAFT } from '../lib/purchase-documents/review-draft';
import type { IncomingDocument } from '../lib/purchase-documents/types';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// Prepared for the isolated synthetic acceptance runner, NOT executed during
// source recovery. Never use existing accounts, paid AI or real business files.
const review = (page: Page) => page.getByRole('dialog', { name: 'Eingangsbeleg prüfen', exact: true });
const chooser = (page: Page) => page.getByRole('alertdialog', { name: 'Ungespeicherter Prüfentwurf', exact: true });
const palette = (page: Page) => page.getByRole('dialog', { name: 'Befehlspalette', exact: true });

async function signIn(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticCrossNavigation123!';
  const user = await prisma.user.create({ data: { name: 'Synthetic receipt navigation owner', email: `receipt-navigation-${randomUUID()}@example.test`, password: await hashPassword(password), role: 'USER' } });
  await page.goto('/login'); await page.getByLabel('E-Mail').fill(user.email); await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click(); await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('button', { name: 'Befehlspalette öffnen', exact: true }).filter({ visible: true }).first()).toBeVisible();
  return user;
}
async function upload(page: Page, fileName: string, mimeType: string, bytes: Buffer) {
  const response = await page.request.post('/api/purchase-documents', { multipart: { file: { name: fileName, mimeType, buffer: bytes }, uploadRequestId: randomUUID(), analysisMode: 'manual' } });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).document as IncomingDocument;
}
async function note(page: Page) {
  const details = review(page).locator('summary').filter({ hasText: /^Prüfentwurf$/ }).locator('..');
  if ((await details.getAttribute('open')) === null) await details.locator(':scope > summary').click();
  return review(page).getByLabel('Prüfnotiz', { exact: true });
}
async function selectPalette(page: Page, query: string, label: string) {
  // The review is genuinely modal: no click-through sidebar or synthetic DOM
  // click is used. Ctrl+K is the reachable global shortcut above this modal.
  await page.keyboard.press('Control+k'); await expect(palette(page)).toBeVisible();
  await palette(page).getByRole('combobox').fill(query);
  await palette(page).getByRole('option', { name: label, exact: true }).click();
  await expect(palette(page)).toHaveCount(0);
  await expect(chooser(page)).toBeVisible(); await expect(chooser(page).getByRole('heading')).toBeFocused();
}
async function originalUnchanged(page: Page, document: IncomingDocument, bytes: Buffer) {
  const response = await page.request.get(`/api/purchase-documents/${document.id}/original`);
  expect(response.status()).toBe(200); expect(await response.body()).toEqual(bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(document.originalRef.sha256);
  expect(document.originalRef.bytes).toBe(bytes.length);
}
async function noFinancialWrites(userId: string) {
  expect(await Promise.all([prisma.expense.count({ where: { userId } }), prisma.income.count({ where: { userId } }), prisma.cashTransaction.count({ where: { userId } }), prisma.invoice.count({ where: { userId } }), prisma.paymentJournalEvent.count({ where: { userId } })])).toEqual([0, 0, 0, 0, 0]);
}

test('dirty receipt palette preflights customer/static/create/list/logout, saves before another receipt and discards before customer Back', async ({ page }) => {
  test.setTimeout(150_000); await page.setViewportSize({ width: 1440, height: 1000 });
  const user = await signIn(page);
  const customer = await prisma.customer.create({ data: { userId: user.id, name: `SYN-GUARD-${randomUUID()}`, internalNote: 'Must remain unchanged by receipt navigation.' } });
  const xml = await readFile('lib/__tests__/fixtures/incoming-validation/valid-ubl.xml', 'utf8');
  const sourceBytes = Buffer.from(xml.replace('SYNTHETIC-UBL-001', 'SYN-GUARD-SOURCE'));
  const targetBytes = Buffer.from(xml.replace('SYNTHETIC-UBL-001', 'SYN-GUARD-TARGET'));
  const source = await upload(page, 'SYN-GUARD-SOURCE.xml', 'application/xml', sourceBytes);
  const target = await upload(page, 'SYN-GUARD-TARGET.xml', 'application/xml', targetBytes);
  const sourceBefore = await prisma.purchaseDocument.findUniqueOrThrow({ where: { id: source.id } });
  const targetBefore = await prisma.purchaseDocument.findUniqueOrThrow({ where: { id: target.id } });
  const signouts: string[] = []; page.on('request', request => { if (new URL(request.url()).pathname === '/api/auth/signout') signouts.push(request.method()); });
  await page.locator('a[href="/purchases"]').first().click(); await page.locator(`[data-incoming-document-id="${source.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/purchases\\?document=${source.id}$`));
  const sourceUrl = page.url(); const savedNote = 'Save this source draft only after explicit confirmation.';
  await (await note(page)).fill(savedNote);
  await selectPalette(page, customer.name, customer.name);
  await expect(page).toHaveURL(sourceUrl); await chooser(page).getByRole('button', { name: 'Hier bleiben', exact: true }).click();
  await expect(await note(page)).toHaveValue(savedNote);
  for (const [query, label] of [['Kunden', 'Kunden'], ['Neue Rechnung erstellen', 'Neue Rechnung erstellen Öffnet den Editor'], ['Abmelden', 'Abmelden']]) {
    await selectPalette(page, query, label); await expect(page).toHaveURL(sourceUrl);
    await chooser(page).getByRole('button', { name: 'Hier bleiben', exact: true }).click(); await expect(await note(page)).toHaveValue(savedNote);
  }
  await selectPalette(page, customer.name, 'Alle Kunden öffnen (ungefiltert)');
  await chooser(page).getByRole('button', { name: 'Hier bleiben', exact: true }).click();
  expect(signouts).toEqual([]);
  expect(await prisma.purchaseDocument.findUniqueOrThrow({ where: { id: source.id } })).toEqual(sourceBefore);
  await noFinancialWrites(user.id);

  let saveRequests = 0;
  await page.route(`**/api/purchase-documents/${source.id}/review-draft`, async route => {
    saveRequests++;
    if (saveRequests === 1) await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    else await route.continue();
  });
  await selectPalette(page, 'SYN-GUARD-TARGET', target.invoiceNumber || target.originalRef.fileName);
  await chooser(page).getByRole('button', { name: 'Speichern & weiter', exact: true }).click();
  await expect(chooser(page)).toBeVisible(); await expect(page).toHaveURL(sourceUrl);
  await expect(review(page).getByRole('alert')).toContainText('Speicherung ist nicht bestätigt'); await expect(await note(page)).toHaveValue(savedNote);
  expect(await prisma.purchaseDocument.findUniqueOrThrow({ where: { id: source.id } })).toEqual(sourceBefore);
  await chooser(page).getByRole('button', { name: 'Speichern & weiter', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/purchases\\?document=${target.id}$`)); await expect(review(page)).toContainText(target.originalRef.fileName);
  expect(saveRequests).toBe(2);
  const sourceAfterSave = await prisma.purchaseDocument.findUniqueOrThrow({ where: { id: source.id } });
  expect(sourceAfterSave).toEqual({ ...sourceBefore, reviewDraft: { ...EMPTY_REVIEW_DRAFT, note: savedNote }, reviewDraftSearch: '', reviewDraftSavedAt: expect.any(Date), revision: sourceBefore.revision + 1, updatedAt: expect.any(Date) });

  const targetUrl = page.url(); await (await note(page)).fill('Discard this target note; do not save or post it.');
  await selectPalette(page, customer.name, customer.name); await expect(page).toHaveURL(targetUrl);
  await chooser(page).getByRole('button', { name: 'Änderungen verwerfen', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/customers\\?customer=${customer.id}$`));
  await expect(page.getByRole('button', { name: `${customer.name} bearbeiten`, exact: true }).filter({ visible: true })).toBeVisible();
  await page.goBack(); await expect(page).toHaveURL(targetUrl); await expect(review(page)).toBeVisible(); await expect(await note(page)).toHaveValue('');
  expect(await prisma.purchaseDocument.findUniqueOrThrow({ where: { id: target.id } })).toEqual(targetBefore);
  expect(await prisma.purchaseDocument.findUniqueOrThrow({ where: { id: source.id } })).toEqual(sourceAfterSave);
  expect(await prisma.customer.findMany({ where: { userId: user.id } })).toEqual([customer]);
  await originalUnchanged(page, source, sourceBytes); await originalUnchanged(page, target, targetBytes); await noFinancialWrites(user.id); expect(signouts).toEqual([]);
});

test('reachable in-review provider settings link offers stay/discard without touching original, customer or finances', async ({ page }) => {
  test.setTimeout(90_000); const user = await signIn(page);
  const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = Buffer.from(await pdf.save());
  const source = await upload(page, 'SYN-GUARD-SETTINGS.pdf', 'application/pdf', bytes);
  const before = await prisma.purchaseDocument.findUniqueOrThrow({ where: { id: source.id } });
  await page.locator('a[href="/purchases"]').first().click(); await page.locator(`[data-incoming-document-id="${source.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/purchases\\?document=${source.id}$`));
  await review(page).locator('summary').filter({ hasText: 'Optionales KI-Auslesen' }).click();
  const settings = review(page).getByRole('link', { name: 'Anbieter einrichten', exact: true }); await expect(settings).toBeVisible();
  await (await note(page)).fill('Keep this until I explicitly discard it.'); const sourceUrl = page.url();
  await settings.click(); await expect(chooser(page)).toBeVisible(); await expect(page).toHaveURL(sourceUrl);
  await chooser(page).getByRole('button', { name: 'Hier bleiben', exact: true }).click();
  await expect(await note(page)).toHaveValue('Keep this until I explicitly discard it.'); await expect(settings).toBeFocused();
  await settings.click(); await expect(chooser(page)).toBeVisible();
  await chooser(page).getByRole('button', { name: 'Änderungen verwerfen', exact: true }).click();
  await expect(page).toHaveURL(/\/settings#ai-receipt-settings$/); await expect(review(page)).toHaveCount(0);
  expect(await prisma.purchaseDocument.findUniqueOrThrow({ where: { id: source.id } })).toEqual(before);
  expect(await prisma.customer.count({ where: { userId: user.id } })).toBe(0);
  expect(await prisma.aiProviderSettings.findUnique({ where: { userId: user.id } })).toBeNull();
  await originalUnchanged(page, source, bytes); await noFinancialWrites(user.id);
});

test('new palette intent during a held traversal save cannot replay the older Back afterward', async ({ page }) => {
  test.setTimeout(120_000); const user = await signIn(page);
  const customer = await prisma.customer.create({ data: { userId: user.id, name: `SYN-NEWER-INTENT-${randomUUID()}` } });
  const bytes = Buffer.from((await readFile('lib/__tests__/fixtures/incoming-validation/valid-ubl.xml', 'utf8')).replace('SYNTHETIC-UBL-001', 'SYN-HELD-TRAVERSAL'));
  const source = await upload(page, 'SYN-HELD-TRAVERSAL.xml', 'application/xml', bytes);
  const before = await prisma.purchaseDocument.findUniqueOrThrow({ where: { id: source.id } });
  await page.locator('a[href="/purchases"]').first().click(); await page.locator(`[data-incoming-document-id="${source.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/purchases\\?document=${source.id}$`));
  const sourceUrl = page.url(); const savedNote = 'Save the draft, but never revive the older Back intent.';
  await (await note(page)).fill(savedNote); await page.evaluate(() => window.history.back()); await expect(chooser(page)).toBeVisible();
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void; const held = new Promise<void>(resolve => { started = resolve; }); let saveRequests = 0;
  await page.route(`**/api/purchase-documents/${source.id}/review-draft`, async route => {
    saveRequests++; const response = await route.fetch(); expect(response.status()).toBe(200); started(); await gate; await route.fulfill({ response });
  });
  try {
    await chooser(page).getByRole('button', { name: 'Speichern & weiter', exact: true }).click(); await held;
    await page.keyboard.press('Control+k'); await expect(palette(page)).toBeVisible(); await palette(page).getByRole('combobox').fill(customer.name);
    await palette(page).getByRole('option', { name: customer.name, exact: true }).click(); await expect(palette(page)).toHaveCount(0);
    await expect(page).toHaveURL(sourceUrl); await expect(chooser(page)).toBeVisible();
    release(); await expect(chooser(page)).toHaveCount(0); await expect(page).toHaveURL(sourceUrl); await expect(await note(page)).toHaveValue(savedNote);
    expect(saveRequests).toBe(1);
    const sourceAfterSave = await prisma.purchaseDocument.findUniqueOrThrow({ where: { id: source.id } });
    expect(sourceAfterSave).toEqual({ ...before, reviewDraft: { ...EMPTY_REVIEW_DRAFT, note: savedNote }, reviewDraftSearch: '', reviewDraftSavedAt: expect.any(Date), revision: before.revision + 1, updatedAt: expect.any(Date) });
    // A later fresh request still works; only the stale traversal was cancelled.
    await (await note(page)).fill('A later unsaved edit to discard.'); await selectPalette(page, customer.name, customer.name);
    await chooser(page).getByRole('button', { name: 'Änderungen verwerfen', exact: true }).click(); await expect(page).toHaveURL(new RegExp(`/customers\\?customer=${customer.id}$`));
    await page.goBack(); await expect(page).toHaveURL(sourceUrl); await expect(await note(page)).toHaveValue(savedNote);
    expect(await prisma.purchaseDocument.findUniqueOrThrow({ where: { id: source.id } })).toEqual(sourceAfterSave);
    expect(await prisma.customer.findMany({ where: { userId: user.id } })).toEqual([customer]); await originalUnchanged(page, source, bytes); await noFinancialWrites(user.id);
  } finally { release(); }
});

test.afterAll(async () => { await prisma.$disconnect(); });
