import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';
import { createBankMappingProfileConfiguration, type BankMappingProfile } from '../lib/bank-mapping-profile-contract';
import { inferBankCsvMapping, parseBankCsv } from '../lib/bank-csv';
import type { BankImportDetail, BankImportReceipt } from '../lib/bank-import-contract';
import type { BankAllocationInvoice, BankAllocationRowEnvelope } from '../lib/bank-allocation-contract';
import type { ServiceBillingPlanDto } from '../components/service-billing/service-billing-types';
import type { DailyActions } from '../lib/daily-actions/contract';

// Hosted acceptance only: the supported runner owns login/database isolation.
// Synthetic reads and explicitly rejected commands exercise presentation without
// persisting business records. Existing real bank/service mutation tests remain.
const ids = { receipt: '11111111-1111-4111-8111-111111111111', request: '22222222-2222-4222-8222-222222222222', row: '33333333-3333-4333-8333-333333333333', assignedRow: '44444444-4444-4444-8444-444444444444', binding: '55555555-5555-4555-8555-555555555555', profile: '66666666-6666-4666-8666-666666666666' };
const alias = 'SYNTHETISCHES Geschäftskonto mit ausführlicher nachvollziehbarer Bezeichnung';
const csv = 'Datum;Betrag;Währung;Gegenpartei;Verwendungszweck\n22.10.2026;40,01;EUR;SYNTHETISCHE Werkstatt mit langer Bezeichnung;SYNTHETISCH-RE-110 vollständige Referenz\n22.10.2026;-0,03;EUR;SYNTHETISCHE Bank;Synthetische Gebühr';
const receipt: BankImportReceipt = { version: 1, id: ids.receipt, requestId: ids.request, savedAt: '2026-10-24T12:00:00.000Z', accountAlias: alias, sourceSha256: 'a'.repeat(64), sourceBytes: 300, parserVersion: 'bank-csv-v1', mappingVersion: 'bank-csv-mapping-v1', counts: { total: 2, valid: 2, invalid: 0, incoming: 2, outgoing: 0, duplicates: 0, overlapRows: 0 }, totals: { incomingCents: '6501', outgoingCents: '0', netCents: '6501' }, period: { from: '2026-10-22', to: '2026-10-22' }, evidenceSha256: 'b'.repeat(64), sameFilePreviouslySaved: false, mappingProfile: { id: ids.profile, revision: 2, name: 'SYNTHETISCHES Kontoprofil' } };
const previewReceipt: BankImportReceipt = { ...receipt, counts: { ...receipt.counts, incoming: 1, outgoing: 1 }, totals: { incomingCents: '4001', outgoingCents: '3', netCents: '3998' } };
const invoice: BankAllocationInvoice = { invoiceId: 110, invoiceNumber: 'SYNTHETISCH-RE-110', customerName: 'SYNTHETISCHER Kunde mit langer Bezeichnung', ledgerVersion: 'c'.repeat(64), totalCents: '10000', paidCents: '0', openCents: '10000' };
const origin: BankAllocationInvoice = { ...invoice, invoiceId: 109, invoiceNumber: 'SYNTHETISCH-RE-109', paidCents: '2500', openCents: '7500' };
const row: BankAllocationRowEnvelope = { rowStableKey: ids.row, rowEvidenceHash: 'd'.repeat(64), assignmentState: 'UNASSIGNED', bindingStableKey: null, assignmentReviewReason: null, assignment: null, evidence: { rowNumber: 2, date: '2026-10-22', amountCents: '4001', currency: 'EUR', counterparty: invoice.customerName, reference: 'SYNTHETISCH-RE-110 · vollständige unveränderte Originalreferenz', externalId: 'SYNTHETISCH-ORIGINAL-2', errors: [], warnings: [], duplicateWarnings: [], duplicate: false, priorMatches: { external: 0, content: 0, dayAmount: 0 } } };
const assignedRow: BankAllocationRowEnvelope = { ...row, rowStableKey: ids.assignedRow, assignmentState: 'ASSIGNED', bindingStableKey: ids.binding, evidence: { ...row.evidence, rowNumber: 3, amountCents: '2500', reference: 'SYNTHETISCHE Originalreferenz für bestehende Zuordnung' }, assignment: { bindingStableKey: ids.binding, originalPaymentId: 901, originInvoiceId: 108, originInvoiceNumber: 'SYNTHETISCH-URSPRUNG-108', allocatedInvoice: origin, allocationRevision: 1, allocationChangeStableKey: '77777777-7777-4777-8777-777777777777', amountCents: '2500', currency: 'EUR', paidAt: '2026-10-22T00:00:00.000Z', canReallocate: true, reallocationReviewReason: null } };
const detail: BankImportDetail = { receipt, rows: [row.evidence, assignedRow.evidence], rowEnvelopes: [row, assignedRow], assignmentCount: 1, page: 0, pages: 1 };
const plan: ServiceBillingPlanDto = { id: 'synthetic-plan', stableKey: 'synthetic-plan-stable', name: 'SYNTHETISCHE IT-Betreuung mit ausführlicher Leistungsbezeichnung', customerId: 801, customer: { id: 801, name: invoice.customerName }, cadence: 'MONTHLY', anchorDate: '2026-01-31', nextPeriod: 1, status: 'ACTIVE', revision: 2, taxMode: 'standard', items: [{ description: 'SYNTHETISCHE Betreuung einschließlich ausführlicher Dokumentation', quantity: 2, unitPrice: 99, unit: 'Stunde', taxRate: 19, taxCategory: 'S' }], preview: { periodStart: '2026-02-28', periodEnd: '2026-03-30', nextDue: '2026-03-31' }, due: true, missed: true, periods: [{ periodIndex: 0, periodStart: '2026-01-31', periodEnd: '2026-02-27', action: 'SKIPPED', invoiceId: null }] };
const actions: DailyActions = { businessDate: '2026-10-24', timeZone: 'Europe/Berlin', generatedAt: '2026-10-24T12:00:00.000Z', actionCount: 3, isPartial: true, actions: [
  { id: 'synthetic-action-1', kind: 'INVOICE_OVERDUE', priority: 1, title: 'SYNTHETISCHE offene Rechnung einzeln prüfen', reason: 'Restbetrag und vorhandenen Zahlungsnachweis prüfen. Keine automatische Mahnung oder Buchung.', source: invoice.invoiceNumber, party: invoice.customerName, date: '2026-10-22', dateLabel: 'Fällig am', amountCents: '4001', amountLabel: 'Offener Rest', href: '/bank-csv', cta: 'Rechnung prüfen' },
  { id: 'synthetic-action-2', kind: 'QUOTE_READY', priority: 2, title: 'SYNTHETISCHEN Folgeauftrag prüfen', reason: 'Synthetische vollständige Begründung bleibt auf schmalen Bildschirmen lesbar.', source: 'SYNTHETISCH-ANG-120', party: 'SYNTHETISCHER Geschäftspartner', date: '2026-10-24', dateLabel: 'Prüftermin', amountCents: '9007199254740993', amountLabel: 'Angebotsbetrag', href: '/service-billing', cta: 'Angebot öffnen' },
  { id: 'synthetic-action-3', kind: 'RECEIPT_REVIEW', priority: 3, title: 'SYNTHETISCHEN Originalbeleg prüfen', reason: 'Unbekannter Betrag bleibt ausdrücklich unbekannt.', source: 'SYNTHETISCH-ORIGINAL.xml', party: null, date: '2026-10-24', dateLabel: 'Eingang', amountCents: null, amountLabel: 'Nicht bestätigt', href: '/purchases', cta: 'Belegprüfung fortsetzen' },
] };
async function settled(page: Page) {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  expect(await page.evaluate(() => document.fonts.check('400 14px Inter'))).toBe(true);
}
async function navigate(page: Page, destination: string) {
  const session = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/auth/session' && new URL(page.url()).pathname === destination);
  await page.goto(destination); const response = await session; expect(response.status()).toBe(200); expect(await response.finished()).toBeNull(); await settled(page);
}
async function account(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`); await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticWorkbench123!'; const user = await prisma.user.create({ data: { email: `workbench-${randomUUID()}@example.test`, name: 'Synthetic workbench', password: await hashPassword(password), role: 'USER' } });
  await navigate(page, '/login'); await page.getByLabel('E-Mail').fill(user.email); await page.getByLabel('Passwort', { exact: true }).fill(password);
  const session = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/auth/session' && new URL(page.url()).pathname === '/dashboard');
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click(); const response = await session; expect(response.status()).toBe(200); expect(await response.finished()).toBeNull(); await expect(page).toHaveURL(/\/dashboard/); await settled(page);
  const unexpected: string[] = [];
  await page.route('**/api/**', async route => { if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue(); unexpected.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`); await route.abort('blockedbyclient'); });
  return { user, unexpected };
}
async function noBusinessWrites(userId: string, unexpected: string[]) {
  expect(unexpected).toEqual([]);
  for (const count of await Promise.all([prisma.invoice.count({ where: { userId } }), prisma.income.count({ where: { userId } }), prisma.expense.count({ where: { userId } }), prisma.bankImportBatch.count({ where: { userId } }), prisma.bankMappingProfile.count({ where: { userId } }), prisma.serviceBillingPlan.count({ where: { userId } }), prisma.paymentJournalEvent.count({ where: { userId } })])) expect(count).toBe(0);
}
async function theme(page: Page, value: 'light' | 'dark') {
  // Use the persisted preference directly: the theme toggle outside an open
  // modal is deliberately inert and must not be force-clicked for screenshots.
  await page.evaluate(value => { localStorage.setItem('theme', value); document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(value); document.documentElement.style.colorScheme = value; }, value);
  await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${value}\\b`));
}
async function geometry(page: Page) {
  await settled(page); expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const root = page.getByRole('dialog').or(page.getByRole('main')).last();
  expect(await root.evaluate(root => [...root.querySelectorAll('button,a,input,select,summary')].filter(element => { const box = element.getBoundingClientRect(), style = getComputedStyle(element); return style.visibility !== 'hidden' && !(element.classList.contains('sr-only') && style.position === 'absolute') && box.width > 0 && box.height > 0 && (box.left < -1 || box.right > document.documentElement.clientWidth + 1); }).map(element => element.textContent?.trim().slice(0, 80)))).toEqual([]);
}
async function capture(page: Page, info: TestInfo, name: string) {
  expect(info.retry).toBe(0); await geometry(page); await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  const surface = await page.evaluate(() => ({ innerWidth, innerHeight, scrollY, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) }));
  expect(surface.scrollY).toBe(0); expect(surface.innerWidth * surface.height * 4).toBeLessThanOrEqual(16 * 1024 * 1024);
  const png = await page.screenshot({ path: info.outputPath(name), fullPage: true, animations: 'disabled' });
  expect(png.length).toBeLessThanOrEqual(1024 * 1024); expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(surface.clientWidth); expect(png.readUInt32BE(16)).toBeLessThanOrEqual(surface.innerWidth); expect(png.readUInt32BE(20)).toBeGreaterThanOrEqual(surface.height);
  process.stdout.write(`Bank billing capture proof: ${JSON.stringify({ name, ...surface, viewport: page.viewportSize(), fullPage: true, pngWidth: png.readUInt32BE(16), pngHeight: png.readUInt32BE(20), encodedBytes: png.length })}\n`);
}
async function matrix(page: Page, info: TestInfo, surface: string | null, verify?: (width: number) => Promise<void>) {
  for (const value of ['light', 'dark'] as const) for (const width of [1440, 390]) { await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await theme(page, value); await geometry(page); if (verify) await verify(width); if (surface) await capture(page, info, `bank-billing-${surface}-${value}-${width}.png`); }
}
async function bankReads(page: Page) {
  let historyError = false;
  await page.route('**/api/bank-imports?*', async route => { if (route.request().method() !== 'GET') return route.fallback(); await route.fulfill({ status: historyError ? 503 : 200, json: historyError ? { error: 'Synthetic history interruption' } : { receipts: [receipt], page: 0, hasMore: false } }); });
  await page.route(`**/api/bank-imports/${ids.receipt}?*`, route => route.request().method() === 'GET' ? route.fulfill({ json: detail }) : route.fallback());
  return { failHistory: (value: boolean) => { historyError = value; } };
}
async function chooseCsv(page: Page) {
  await page.getByLabel('Bank-CSV auswählen', { exact: true }).setInputFiles({ name: 'SYNTHETISCHER-langer-Dateiname-für-die-vollständige-Bankprüfung.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByLabel('Kontoalias *', { exact: true }).fill(alias);
}
// Real hosted hit-testing: visibility alone does not prove a control is outside
// the nested editor clip or unobscured by its fixed header/footer.
async function unobscuredEditorControl(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeInViewport();
  expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect.poll(() => control.evaluate(element => {
    const rect = element.getBoundingClientRect();
    let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor), box = ancestor.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/u.test(style.overflowX)) { left = Math.max(left, box.left); right = Math.min(right, box.right); }
      if (/(auto|scroll|hidden|clip)/u.test(style.overflowY)) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom); }
    }
    if (rect.width <= 0 || rect.height <= 0 || rect.left < left || rect.right > right || rect.top < top || rect.bottom > bottom) return false;
    return [[rect.left + 4, rect.top + 4], [rect.right - 4, rect.top + 4], [rect.left + 4, rect.bottom - 4], [rect.right - 4, rect.bottom - 4], [rect.left + rect.width / 2, rect.top + rect.height / 2]].every(([x, y]) => {
      const hit = document.elementFromPoint(x, y); return hit !== null && (hit === element || element.contains(hit));
    });
  })).toBe(true);
}
async function mobileEditorBottom(page: Page, info: TestInfo, editor: Locator) {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const value of ['light', 'dark'] as const) {
    await theme(page, value);
    for (const label of ['Leistungsbeschreibung 1', 'Menge 1', 'Einheit 1', 'Netto-Preis 1 (€)', 'USt. 1']) await unobscuredEditorControl(editor.getByLabel(label, { exact: true }));
    for (const name of ['Position ergänzen', 'Aus Artikelkatalog übernehmen']) await unobscuredEditorControl(editor.getByRole('button', { name, exact: true }));
    const total = editor.getByRole('region', { name: 'Leistungen und Vorschau', exact: true }).getByText('235,62 €', { exact: true });
    await total.scrollIntoViewIfNeeded(); await expect(total).toBeInViewport();
    const scroll = await total.evaluate(element => {
      let scroller = element.parentElement;
      while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/u.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
      return { scrollTop: scroller?.scrollTop ?? 0, scrollHeight: scroller?.scrollHeight ?? 0, clientHeight: scroller?.clientHeight ?? 0 };
    });
    expect(scroll.scrollTop).toBeGreaterThan(0); expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
    await dialogFooter(editor); await unobscuredEditorControl(editor.getByRole('button', { name: 'Serviceplan speichern', exact: true }));
    process.stdout.write(`Service editor actual scroll proof: ${JSON.stringify({ theme: value, width: 390, ...scroll })}\n`);
    await capture(page, info, `bank-billing-service-editor-bottom-${value}-390.png`);
  }
}
async function dialogFooter(dialog: Locator) { const cancel = dialog.getByRole('button', { name: 'Abbrechen', exact: true }); await cancel.scrollIntoViewIfNeeded(); await expect(cancel).toBeInViewport(); expect((await cancel.boundingBox())!.height).toBeGreaterThanOrEqual(44); }
test.afterAll(async () => { await prisma.$disconnect(); });

test('bank mapping profiles, preview and narrow saved receipt rail retain explicit review across repeated navigation', async ({ page }, info) => {
  test.setTimeout(120_000); const { user, unexpected } = await account(page); await bankReads(page);
  const parsed = parseBankCsv(csv), configuration = await createBankMappingProfileConfiguration('SYNTHETISCHES Kontoprofil', { ...inferBankCsvMapping(parsed.headers), accountAlias: alias }, parsed);
  const profile: BankMappingProfile = { id: ids.profile, revision: 2, latestRevision: 2, configuration };
  await page.route('**/api/bank-mapping-profiles*', route => route.request().method() !== 'GET' ? route.fallback() : route.fulfill({ json: new URL(route.request().url()).searchParams.has('id') ? { profile } : { profiles: [{ id: ids.profile, revision: 2, name: configuration.name, accountAlias: alias }] } }));
  await navigate(page, '/bank-csv'); await chooseCsv(page);
  const profiles = page.locator('details').filter({ has: page.locator('#bank-profile') });
  await profiles.locator('summary').click(); await profiles.getByRole('button', { name: 'Profilliste laden', exact: true }).click(); await profiles.getByLabel('Gespeichertes Profil', { exact: true }).selectOption(ids.profile);
  await profiles.getByRole('button', { name: 'Profil ausdrücklich laden', exact: true }).click(); await expect(profiles.getByRole('status')).toContainText('Revision 2 geladen');
  await matrix(page, info, null); await profiles.locator('summary').click();
  await page.getByRole('button', { name: 'Vorschau prüfen', exact: true }).click(); await expect(page.getByRole('article', { name: 'Bankzeile 2', exact: true })).toContainText('40,01 €');
  await matrix(page, info, 'bank-preview');
  await page.getByRole('button', { name: 'Zurück zur Zuordnung', exact: true }).click(); await expect(page.getByRole('button', { name: 'Vorschau prüfen', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Vorschau prüfen', exact: true }).click();
  let commands = 0; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/bank-imports', async route => { if (route.request().method() !== 'POST') return route.fallback(); commands++; await gate; await route.fulfill({ json: { receipt: previewReceipt } }); });
  await page.getByLabel(/Ich habe Kontoalias, Spalten, Vorzeichen und Kontrollsummen geprüft/u).check();
  try { await page.getByRole('button', { name: 'Geprüfte Umsätze speichern', exact: true }).click(); await expect.poll(() => commands).toBe(1); await expect(page.getByRole('button', { name: 'Quittung wird geprüft…', exact: true })).toBeDisabled(); await page.keyboard.press('Enter'); expect(commands).toBe(1); } finally { release(); }
  await expect(page.getByRole('heading', { name: 'Gespeicherte Quittung', exact: true })).toBeVisible();
  await matrix(page, info, null, async width => { const rail = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Gespeicherte Quittung', exact: true }) }).last(); const meta = rail.locator('time'); const bounds = await meta.boundingBox(), parent = await rail.boundingBox(); expect(bounds).not.toBeNull(); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(parent!.x + parent!.width); if (width === 1440) expect(parent!.width).toBeLessThan(400); });
  await page.getByRole('button', { name: 'Datei verwerfen', exact: true }).click(); await expect(page.getByLabel('Bank-CSV auswählen', { exact: true })).toBeFocused(); await noBusinessWrites(user.id, unexpected);
});

test('saved bank history uses desktop columns, retries without a false loading state and preserves allocation cancellation', async ({ page }, info) => {
  test.setTimeout(120_000); const { user, unexpected } = await account(page); const history = await bankReads(page);
  await page.route('**/preflight', async route => { if (route.request().method() !== 'POST') return route.fallback(); const moving = new URL(route.request().url()).pathname.startsWith('/api/bank-allocations/'); const selected = route.request().postDataJSON().invoiceId === invoice.invoiceId; await route.fulfill({ json: { version: 1, row: moving ? assignedRow : row, invoices: [invoice], nextCursor: null, selection: selected ? invoice : null, canConfirm: selected, reviewReasons: [], afterOpenCents: selected ? moving ? '7500' : '5999' : null, sourceAfterOpenCents: moving && selected ? '10000' : null } }); });
  await navigate(page, '/bank-csv'); const opener = page.getByRole('button', { name: 'Quittung öffnen', exact: true }); await opener.click();
  const saved = page.getByRole('article', { name: 'Gespeicherte Bankzeile 2', exact: true });
  await matrix(page, info, 'bank-history', async width => { const columns = await saved.locator('div').first().evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length); expect(columns).toBe(width === 1440 ? 3 : 2); });
  await expect(page.getByText('Original-Zahlungsnachweis #901 · Ursprung SYNTHETISCH-URSPRUNG-108 · Stand 1', { exact: true })).toBeVisible();
  await saved.getByRole('button', { name: 'Rechnung wählen', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Rechnung zuordnen', exact: true });
  await dialog.getByLabel('Rechnung', { exact: true }).selectOption(String(invoice.invoiceId)); await expect(dialog).toContainText('Offen 100,00 € → 59,99 €');
  await expect(dialog.getByRole('button', { name: 'Zahlung zuordnen', exact: true })).toBeDisabled(); await matrix(page, info, 'bank-allocation');
  await page.keyboard.press('Escape'); await expect(saved.getByRole('button', { name: 'Rechnung wählen', exact: true })).toBeFocused(); await saved.getByRole('button', { name: 'Rechnung wählen', exact: true }).click(); await expect(dialog.getByLabel('Rechnung', { exact: true })).toHaveValue(''); await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  const assigned = page.getByRole('article', { name: 'Gespeicherte Bankzeile 3', exact: true }); await assigned.getByRole('button', { name: 'Andere Rechnung', exact: true }).click(); const moving = page.getByRole('dialog', { name: 'Zuordnung ändern', exact: true }); await moving.getByLabel('Rechnung', { exact: true }).selectOption(String(invoice.invoiceId)); await expect(moving).toContainText('Offen 75,00 € → 100,00 €'); await expect(moving).toContainText('Offen 100,00 € → 75,00 €'); await matrix(page, info, null); await moving.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await page.getByRole('button', { name: 'Zurück zum Importverlauf', exact: true }).click(); await expect(opener).toBeFocused(); await opener.click(); await page.getByRole('button', { name: 'Zurück zum Importverlauf', exact: true }).click(); await expect(opener).toBeFocused();
  history.failHistory(true); await navigate(page, '/bank-csv'); const historyRegion = page.getByRole('region', { name: 'Gespeicherte Importe', exact: true }); await expect(historyRegion.getByRole('alert')).toContainText('Der Importverlauf konnte nicht geladen werden'); await expect(page.getByText('Importverlauf laden…', { exact: true })).toHaveCount(0);
  history.failHistory(false); await page.getByRole('button', { name: 'Verlauf erneut laden', exact: true }).click(); await expect(opener).toBeEnabled(); await noBusinessWrites(user.id, unexpected);
});

test('service plan ledger, editor and period review keep inputs, close guards and repeated rejected requests', async ({ page }, info) => {
  test.setTimeout(120_000); const { user, unexpected } = await account(page); let mode: 'populated' | 'empty' | 'error' = 'populated'; let commands = 0; const payloads: unknown[] = []; let releaseList!: () => void; const listGate = new Promise<void>(resolve => { releaseList = resolve; }); let listReleased = false; let releaseCommand!: () => void; const commandGate = new Promise<void>(resolve => { releaseCommand = resolve; });
  await page.route('**/api/service-billing', async route => { if (route.request().method() !== 'GET') { commands++; payloads.push(route.request().postDataJSON()); if (commands === 1) await commandGate; await route.abort('connectionreset'); return; } if (!listReleased) await listGate; await route.fulfill({ status: mode === 'error' ? 503 : 200, json: mode === 'error' ? { error: 'Synthetic service list interruption' } : { today: '2026-10-24', plans: mode === 'empty' ? [] : [plan] } }); });
  await page.route('**/api/customers', route => route.request().method() === 'GET' ? route.fulfill({ json: [plan.customer] }) : route.fallback()); await page.route('**/api/service-articles', route => route.request().method() === 'GET' ? route.fulfill({ json: [] }) : route.fallback());
  try { await navigate(page, '/service-billing'); await expect(page.getByRole('status').filter({ hasText: 'Servicepläne werden geladen' })).toBeVisible(); } finally { listReleased = true; releaseList(); } const card = page.getByRole('article', { name: `Serviceplan ${plan.name}`, exact: true }); await expect(card).toContainText('235,62'); await matrix(page, info, 'service-plans');
  const edit = card.getByRole('button', { name: 'Plan bearbeiten', exact: true }); await edit.click(); const editor = page.getByRole('dialog', { name: 'Serviceplan bearbeiten', exact: true }); await expect(editor.getByLabel('Rhythmus', { exact: true })).toHaveCount(0); await matrix(page, info, 'service-editor', async () => { await dialogFooter(editor); }); await mobileEditorBottom(page, info, editor);
  await editor.getByLabel('Planname', { exact: true }).fill('Unbestätigte synthetische Änderung'); await page.keyboard.press('Escape'); await expect(editor).toBeHidden(); await expect(edit).toBeFocused(); await edit.click(); await expect(editor.getByLabel('Planname', { exact: true })).toHaveValue(plan.name);
  await editor.getByRole('button', { name: 'Position ergänzen', exact: true }).click(); await expect(editor.getByLabel('Leistungsbeschreibung 2', { exact: true })).toBeVisible(); await editor.getByRole('button', { name: 'Position 2 entfernen', exact: true }).click(); await expect(editor.getByLabel('Leistungsbeschreibung 2', { exact: true })).toHaveCount(0);
  await editor.getByLabel('Netto-Preis 1 (€)', { exact: true }).fill('101.00'); try { await editor.getByRole('button', { name: 'Serviceplan speichern', exact: true }).click(); await expect.poll(() => commands).toBe(1); await expect(editor.getByRole('button', { name: 'Abbrechen', exact: true })).toBeDisabled(); await expect(editor.getByRole('button', { name: 'Wird gespeichert…', exact: true })).toBeDisabled(); await page.keyboard.press('Escape'); await expect(editor).toBeVisible(); } finally { releaseCommand(); } await expect(editor.getByRole('alert')).toContainText('Keine eindeutige Antwort erhalten'); await expect(editor.getByLabel('Netto-Preis 1 (€)', { exact: true })).toHaveValue('101.00'); await editor.getByRole('button', { name: 'Serviceplan speichern', exact: true }).click(); await expect.poll(() => commands).toBe(2); expect(payloads[0]).toEqual(payloads[1]); await editor.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await page.getByRole('button', { name: 'Neuer Serviceplan', exact: true }).click(); const fresh = page.getByRole('dialog', { name: 'Neuer Serviceplan', exact: true }); await expect(fresh.getByLabel('Umsatzsteuer', { exact: true })).toHaveValue(''); await expect(fresh.getByLabel('Rhythmus', { exact: true })).toBeVisible(); await fresh.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await card.getByRole('button', { name: 'Entwurf vorbereiten', exact: true }).click(); const review = page.getByRole('dialog', { name: 'Einen Rechnungsentwurf vorbereiten?', exact: true }); await expect(review.getByRole('button', { name: 'Nur diesen Entwurf anlegen', exact: true })).toBeDisabled(); await matrix(page, info, null); await page.keyboard.press('Escape'); await expect(review).toBeHidden(); await expect(card.getByRole('button', { name: 'Entwurf vorbereiten', exact: true })).toBeFocused();
  await card.getByRole('button', { name: 'Zeitraum überspringen', exact: true }).click(); const skip = page.getByRole('dialog', { name: 'Diesen Zeitraum überspringen?', exact: true }); await expect(skip.getByRole('button', { name: 'Nur diesen Zeitraum überspringen', exact: true })).toBeDisabled(); await skip.getByRole('button', { name: 'Abbrechen', exact: true }).click(); expect(commands).toBe(2);
  mode = 'error'; await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click(); await expect(page.getByRole('region', { name: 'Servicepläne', exact: true }).getByRole('alert')).toContainText('Synthetic service list interruption'); await expect(card).toHaveCount(0); mode = 'empty'; await page.getByRole('button', { name: 'Aktuellen Stand erneut laden', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Noch keine Servicepläne', exact: true })).toBeVisible(); await noBusinessWrites(user.id, unexpected);
});

test('Today full and compact queues preserve exact amounts, read-only recovery and Back/Forward destinations', async ({ page }, info) => {
  test.setTimeout(120_000); const { user, unexpected } = await account(page); await bankReads(page); let mode: 'populated' | 'empty' | 'error' = 'populated'; let reads = 0; let releaseRead!: () => void; const readGate = new Promise<void>(resolve => { releaseRead = resolve; }); let readReleased = false;
  await page.route('**/api/daily-actions', async route => { if (route.request().method() !== 'GET') return route.fallback(); reads++; if (!readReleased) await readGate; await route.fulfill({ status: mode === 'error' ? 503 : 200, json: mode === 'error' ? { error: 'Synthetic Today interruption' } : mode === 'empty' ? { ...actions, actions: [], actionCount: 0, isPartial: false } : actions }); });
  try { await navigate(page, '/dashboard/today'); await expect(page.getByRole('status').filter({ hasText: 'Nächste Schritte werden geladen' })).toBeVisible(); } finally { readReleased = true; releaseRead(); } const list = page.getByRole('list', { name: 'Priorisierte nächste Schritte', exact: true }); await expect(list.getByRole('listitem')).toHaveCount(3); await expect(list).toContainText('90.071.992.547.409,93 €'); await expect(list).toContainText('Nicht verfügbar'); await expect(page.getByText(/Unvollständige Auswahl:/u)).toBeVisible(); await matrix(page, info, 'today');
  const next = list.getByRole('link', { name: 'Rechnung prüfen: SYNTHETISCH-RE-110', exact: true }); await next.click(); await expect(page).toHaveURL(/\/bank-csv$/); await page.goBack(); await expect(page).toHaveURL(/\/dashboard\/today$/); await expect(list.getByRole('listitem')).toHaveCount(3); await page.goForward(); await expect(page).toHaveURL(/\/bank-csv$/); await page.goBack(); await expect(list.getByRole('listitem')).toHaveCount(3);
  const before = reads; await page.getByRole('button', { name: 'Nächste Schritte aktualisieren', exact: true }).click(); await expect.poll(() => reads).toBeGreaterThan(before); await expect(list.getByRole('listitem')).toHaveCount(3);
  mode = 'error'; await page.getByRole('button', { name: 'Nächste Schritte aktualisieren', exact: true }).click(); await expect(list).toHaveCount(0); await expect(page.getByRole('main').getByRole('alert')).toBeVisible(); mode = 'empty'; await page.getByRole('button', { name: 'Nächste Schritte aktualisieren', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Keine offenen Schritte', exact: true })).toBeVisible();
  mode = 'populated'; await navigate(page, '/dashboard'); const compact = page.locator('section[aria-labelledby="daily-actions-preview-title"]'); await expect(compact.getByRole('listitem')).toHaveCount(3); await matrix(page, info, 'today-compact', async () => { await expect(compact.getByRole('link', { name: 'Alle Schritte', exact: true })).toHaveAttribute('href', '/dashboard/today'); const columns = await compact.locator('article').first().evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length); expect(columns).toBe(1); }); await noBusinessWrites(user.id, unexpected);
});
