import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import type { BankMappingProfileMutation } from '../lib/bank-mapping-profile-contract';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// Hosted CI only: the supported runner supplies a fresh SQLite fixture. Profile
// writes go through the authenticated real route; no bank import is confirmed.
const confirmation = 'Die Datei hat benannte, eindeutige Überschriften. Kontoalias, Spalten, Vorzeichen (auch Soll/Haben), Dezimalzeichen und Währung habe ich geprüft.';
const eurConfirmation = 'Der gesamte Export ist in EUR. Ich habe die Kontowährung geprüft.';
const csv = 'Buchungsdatum;Betrag;Verwendungszweck\n24.10.2026;12,34;SYNTHETISCHE-BANKZEILE-NICHT-SPEICHERN';
async function settled(page: Page) {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  expect(await page.evaluate(() => document.fonts.check('400 14px Inter'))).toBe(true);
}
async function navigate(page: Page, destination: string, reload = false) {
  // File state belongs to the authenticated owner key. Wait for real session
  // hydration before selecting a file, otherwise its key remount can discard it.
  const session = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/auth/session'
    && new URL(page.url()).pathname === destination);
  if (reload) await page.reload(); else await page.goto(destination);
  const response = await session; expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
  await settled(page);
}
async function account(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticMappingProfiles123!';
  const user = await prisma.user.create({ data: { email: `mapping-profiles-${randomUUID()}@example.test`, name: 'Synthetic mapping profiles', password: await hashPassword(password), role: 'USER' } });
  await navigate(page, '/login');
  await page.getByLabel('E-Mail').fill(user.email); await page.getByLabel('Passwort', { exact: true }).fill(password);
  const session = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/auth/session' && new URL(page.url()).pathname === '/dashboard');
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  const response = await session; expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
  await expect(page).toHaveURL(/\/dashboard/); await settled(page);
  return user.id;
}
async function source(page: Page, contents = csv) {
  await page.getByLabel('Bank-CSV auswählen', { exact: true }).setInputFiles({ name: 'SYNTHETISCHES-Profil-ohne-Bankimport.csv', mimeType: 'text/csv', buffer: Buffer.from(contents) });
  await expect(page.getByRole('heading', { name: 'Spalten zuordnen', exact: true })).toBeVisible();
}
async function prepare(page: Page, name: string) {
  await navigate(page, '/bank-csv'); await source(page);
  await page.getByLabel('Kontoalias *', { exact: true }).fill('Synthetisches QA-Konto');
  await page.locator('#bank-map-date').selectOption('0'); await page.locator('#bank-map-amount').selectOption('1');
  await page.locator('#bank-map-reference').selectOption('2'); await page.getByLabel(eurConfirmation, { exact: true }).check();
  await page.getByText('Zuordnungsprofile · nur Einstellungen merken', { exact: true }).click();
  await page.getByLabel('Profilname', { exact: true }).fill(name); await page.getByLabel(confirmation, { exact: true }).check();
}
async function noBankOrFinancialWrites(userId: string) {
  const counts = await Promise.all([
    prisma.bankImportBatch.count({ where: { userId } }), prisma.bankImportRow.count({ where: { userId } }),
    prisma.invoice.count({ where: { userId } }), prisma.income.count({ where: { userId } }), prisma.expense.count({ where: { userId } }),
    prisma.paymentJournalEvent.count({ where: { userId } }), prisma.paymentOperation.count({ where: { userId } }),
    prisma.paymentAdjustment.count({ where: { userId } }), prisma.cashTransaction.count({ where: { userId } }),
  ]);
  expect(counts).toEqual(Array(counts.length).fill(0));
}
async function theme(page: Page, value: 'light' | 'dark') {
  if (await page.locator('html').evaluate(element => element.classList.contains('dark')) !== (value === 'dark')) {
    await page.getByRole('button', { name: value === 'dark' ? 'Dunkles Farbschema aktivieren' : 'Helles Farbschema aktivieren', exact: true }).click();
  }
  await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${value}\\b`));
}
async function capture(page: Page, info: TestInfo, name: string) {
  expect(info.retry).toBe(0); await settled(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const outside = await page.getByRole('main').evaluate(root => [...root.querySelectorAll('button,a,input,select,summary')].filter(element => {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element);
    if (style.visibility === 'hidden' || (element.classList.contains('sr-only') && style.position === 'absolute')) return false;
    return box.width > 0 && box.height > 0 && (box.left < -1 || box.right > document.documentElement.clientWidth + 1);
  }).map(element => element.textContent?.trim().slice(0, 80)));
  expect(outside).toEqual([]);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  const surface = await page.evaluate(() => ({ innerWidth, innerHeight, scrollY, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) }));
  expect(surface.scrollY).toBe(0); expect(surface.innerWidth * surface.height * 4).toBeLessThanOrEqual(16 * 1024 * 1024);
  const png = await page.screenshot({ path: info.outputPath(name), fullPage: true, animations: 'disabled' });
  expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(surface.clientWidth); expect(png.readUInt32BE(16)).toBeLessThanOrEqual(surface.innerWidth); expect(png.readUInt32BE(20)).toBeGreaterThanOrEqual(surface.height);
  process.stdout.write(`Mapping profiles capture proof: ${JSON.stringify({ name, ...surface, viewport: page.viewportSize(), fullPage: true, pngWidth: png.readUInt32BE(16), pngHeight: png.readUInt32BE(20), encodedBytes: png.length })}\n`);
}
test.afterAll(async () => { await prisma.$disconnect(); });

test('mapping profiles persist immutable revisions, explicitly load, invalidate mismatched headers and retain deletion history', async ({ page }, info) => {
  test.setTimeout(120_000); await page.setViewportSize({ width: 1440, height: 1000 });
  const userId = await account(page); await prepare(page, 'SYNTHETISCHES CSV-Profil · erste Revision');
  await page.getByRole('button', { name: 'Diese Zuordnung merken', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Profil als unveränderliche Revision 1 gespeichert.' })).toBeVisible();
  const first = await prisma.bankMappingProfileRevision.findFirstOrThrow({ where: { userId, revision: 1 } });
  const id = first.profileId;
  expect(JSON.stringify(first.configuration)).not.toContain('SYNTHETISCHE-BANKZEILE-NICHT-SPEICHERN');
  expect(JSON.stringify(first.configuration)).not.toContain('Buchungsdatum');
  expect(Object.keys(first.configuration as object).sort()).toEqual(['delimiter', 'headerHashes', 'mapping', 'mappingVersion', 'name', 'parserVersion', 'version']);
  await page.getByLabel('Profilname', { exact: true }).fill('SYNTHETISCHES CSV-Profil · zweite Revision');
  await page.getByLabel(confirmation, { exact: true }).check();
  await page.getByRole('button', { name: 'Als neue Revision aktualisieren', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Profil als unveränderliche Revision 2 gespeichert.' })).toBeVisible();
  const revisions = await prisma.bankMappingProfileRevision.findMany({ where: { userId, profileId: id }, orderBy: { revision: 'asc' } });
  expect(revisions.map(item => item.revision)).toEqual([1, 2]); expect(revisions[0]).toEqual(first);
  // A stale editor cannot replace either immutable revision through the API.
  const stale = await page.request.post('/api/bank-mapping-profiles', { data: { id, mutationId: randomUUID(), expectedRevision: 1, configuration: first.configuration } });
  expect(stale.status()).toBe(409);
  // Fresh navigation demonstrates that neither the file nor mapping is silently
  // loaded by the stored profile list; the user must select and load it again.
  await navigate(page, '/bank-csv', true); await source(page);
  await expect(page.getByLabel('Kontoalias *', { exact: true })).toHaveValue('');
  await expect(page.getByLabel(eurConfirmation, { exact: true })).not.toBeChecked();
  await page.getByText('Zuordnungsprofile · nur Einstellungen merken', { exact: true }).click();
  await page.getByRole('button', { name: 'Profilliste laden', exact: true }).click();
  await expect(page.locator('#bank-profile option')).toHaveCount(2);
  await page.getByLabel('Gespeichertes Profil', { exact: true }).selectOption(id);
  await page.getByLabel('Revision', { exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Profil ausdrücklich laden', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Revision 1 geladen.' })).toBeVisible();
  await expect(page.getByLabel('Profilname', { exact: true })).toHaveValue('SYNTHETISCHES CSV-Profil · erste Revision');
  await expect(page.getByLabel('Kontoalias *', { exact: true })).toHaveValue('Synthetisches QA-Konto');
  await expect(page.locator('#bank-map-date')).toHaveValue('0'); await expect(page.locator('#bank-map-amount')).toHaveValue('1');
  await expect(page.getByLabel(eurConfirmation, { exact: true })).toBeChecked();
  for (const value of ['light', 'dark'] as const) {
    await theme(page, value);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await capture(page, info, `feature-profiles-${value}-${width}.png`);
    }
  }
  await source(page, 'Betrag;Buchungsdatum;Verwendungszweck\n12,34;24.10.2026;SYNTHETISCHE-ANDERE-BANKZEILE');
  // Inference is initially usable, but explicitly applying a structurally
  // different saved layout must remove every role and the remembered EUR check.
  await page.getByRole('button', { name: 'Profil ausdrücklich laden', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Headerlayout passt nicht.' })).toBeVisible();
  for (const field of ['date', 'amount', 'reference', 'currency', 'counterparty', 'externalId']) await expect(page.locator(`#bank-map-${field}`)).toHaveValue('-1');
  await expect(page.getByLabel(eurConfirmation, { exact: true })).not.toBeChecked();
  await page.locator('#bank-amount-mode').selectOption('credit-debit');
  await expect(page.locator('#bank-map-credit')).toHaveValue('-1'); await expect(page.locator('#bank-map-debit')).toHaveValue('-1');
  await page.getByRole('button', { name: 'Vorschau prüfen', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Bitte die Datumsspalte zuordnen.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Vorschau prüfen', exact: true })).toHaveCount(0);
  await page.getByLabel('Dieses Profil löschen; historische Quittungen nicht verändern.', { exact: true }).check();
  await page.getByRole('button', { name: 'Profil löschen', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Profil gelöscht. Historische Revisionen und Importquittungen bleiben unverändert.' })).toBeVisible();
  await page.getByRole('button', { name: 'Profilliste laden', exact: true }).click(); await expect(page.locator('#bank-profile option')).toHaveCount(1);
  const deleted = await prisma.bankMappingProfile.findUniqueOrThrow({ where: { userId_id: { userId, id } } });
  expect(deleted.deletedAt).not.toBeNull(); expect(deleted.revision).toBe(2);
  expect(await prisma.bankMappingProfileRevision.findMany({ where: { userId, profileId: id }, orderBy: { revision: 'asc' } })).toEqual(revisions);
  expect((await page.request.get(`/api/bank-mapping-profiles?id=${id}&revision=1`)).status()).toBe(404);
  await noBankOrFinancialWrites(userId);
});

test('mapping profile unknown outcome retries the identical committed mutation and rejects foreign tenant access', async ({ page, browser }) => {
  test.setTimeout(90_000); const userId = await account(page); await prepare(page, 'SYNTHETISCHES Wiederholungsprofil');
  const attempts: BankMappingProfileMutation[] = [];
  await page.route('**/api/bank-mapping-profiles', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    attempts.push(route.request().postDataJSON() as BankMappingProfileMutation);
    if (attempts.length !== 1) { await route.continue(); return; }
    // The real authenticated request commits first. Only its response is made
    // unverifiable, so this cannot pass with mocked profile persistence.
    const committed = await route.fetch(); expect(committed.status()).toBe(200);
    expect((await committed.json()).profile.id).toBe(attempts[0].id);
    await route.fulfill({ status: 200, json: { profile: null } });
  });
  await page.getByRole('button', { name: 'Diese Zuordnung merken', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Ergebnis unklar. Nur dieselbe Aktion erneut prüfen;' })).toBeVisible();
  expect(attempts).toHaveLength(1);
  expect(await prisma.bankMappingProfileRevision.count({ where: { userId, profileId: attempts[0].id } })).toBe(1);
  await expect(page.getByLabel('Bank-CSV auswählen', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Profilliste laden', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Diese Zuordnung merken', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Profilname', { exact: true })).toBeDisabled();
  await expect(page.locator('#bank-map-date')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Datei verwerfen', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Dieselbe Profilaktion erneut prüfen', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Profil als unveränderliche Revision 1 gespeichert.' })).toBeVisible();
  expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0]);
  await expect(page.getByRole('button', { name: 'Dieselbe Profilaktion erneut prüfen', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Bank-CSV auswählen', { exact: true })).toBeEnabled();
  expect(await prisma.bankMappingProfile.count({ where: { userId } })).toBe(1);
  const original = await prisma.bankMappingProfileRevision.findFirstOrThrow({ where: { userId } });
  expect(original.revision).toBe(1); expect(original.mutationId).toBe(attempts[0].mutationId);
  const otherContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const other = await otherContext.newPage(), otherUserId = await account(other);
    const list = await other.request.get('/api/bank-mapping-profiles'); expect(list.status()).toBe(200); expect(await list.json()).toEqual({ profiles: [] });
    const foreign = await other.request.get(`/api/bank-mapping-profiles?id=${original.profileId}&revision=1`);
    const unknown = await other.request.get(`/api/bank-mapping-profiles?id=${randomUUID()}&revision=1`);
    expect(foreign.status()).toBe(404); expect(unknown.status()).toBe(404); expect(await foreign.json()).toEqual(await unknown.json());
    expect((await other.request.post('/api/bank-mapping-profiles', { data: { ...attempts[0], mutationId: randomUUID(), expectedRevision: 1 } })).status()).toBe(404);
    expect((await other.request.delete('/api/bank-mapping-profiles', { data: { id: original.profileId, mutationId: randomUUID(), expectedRevision: 1 } })).status()).toBe(404);
    expect(await prisma.bankMappingProfile.count({ where: { userId: otherUserId } })).toBe(0); await noBankOrFinancialWrites(otherUserId);
  } finally { await otherContext.close(); }
  expect(await prisma.bankMappingProfileRevision.findMany({ where: { userId } })).toEqual([original]);
  expect((await prisma.bankMappingProfile.findFirstOrThrow({ where: { userId } })).deletedAt).toBeNull();
  await noBankOrFinancialWrites(userId);
});
