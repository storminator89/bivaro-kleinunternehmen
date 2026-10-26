import { expect, test, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// Read the exact checked-out format identities without importing the server-only
// backup implementation into Playwright's Node test-discovery process.
const manifestSource = readFileSync('lib/backup-manifest.ts', 'utf8');
function sourceVersion(source: string, name: string): string {
  const match = source.match(new RegExp(`^export const ${name} = '([^']+)';$`, 'mu'));
  if (!match) throw new Error(`Expected exact source declaration for ${name}`);
  return match[1];
}
const CURRENT_BACKUP_VERSION = sourceVersion(manifestSource, 'CURRENT_BACKUP_VERSION');
const LEGACY_BACKUP_VERSION = sourceVersion(manifestSource, 'LEGACY_BACKUP_VERSION');
if (!/^export const CURRENT_SCHEMA_VERSION = MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION;$/mu.test(manifestSource)) throw new Error('Expected exact current backup capability alias');
const CURRENT_SCHEMA_VERSION = sourceVersion(readFileSync('lib/manual-financial-record-backup.ts', 'utf8'), 'MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION');

// Run through the supported fresh-fixture hosted E2E runner only.
// No restore endpoint, immutable-row cleanup, external service, or real backup.
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function settledNavigation(page: Page, destination: string, navigate: () => Promise<unknown>) {
  const session = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/auth/session' && new URL(page.url()).pathname === destination);
  await navigate();
  const response = await session;
  expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
  return response.json();
}
async function protectedState(userId: string) {
  const where = { userId };
  return Promise.all([
    prisma.purchaseDocument.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.invoice.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.income.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.expense.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.paymentJournalEvent.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.paymentAdjustment.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.paymentOperation.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.cashBook.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.cashTransaction.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.emailOutbox.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.emailOutboxAttempt.findMany({ where: { outbox: { userId } }, orderBy: { id: 'asc' } }),
    prisma.manualFinancialRecordEvent.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.bankPaymentBinding.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.paymentAllocationChange.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.invoiceNumberCounter.findMany({ where, orderBy: [{ type: 'asc' }, { year: 'asc' }] }),
    prisma.settings.findMany({ where, orderBy: { id: 'asc' } }),
  ]);
}
async function packed(source: JSZip) { return source.generateAsync({ type: 'nodebuffer', compression: 'STORE' }); }

test('ZIP inspection shows actual checks, blocks changed originals and never restores on discard or reload', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticBackupInspection123!';
  const user = await prisma.user.create({ data: { email: `backup-inspection-${randomUUID()}@example.test`, name: 'Synthetic backup inspection', password: await hashPassword(password), role: 'USER' } });
  await settledNavigation(page, '/login', () => page.goto('/login'));
  await page.getByLabel('E-Mail').fill(user.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  const session = await settledNavigation(page, '/dashboard', () => page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click());
  expect(session.user).toMatchObject({ id: user.id, role: user.role, sessionVersion: user.sessionVersion });

  const original = Buffer.from(`<Invoice><ID>SYNTHETIC-${randomUUID()}</ID><IssueDate>2026-10-26</IssueDate><InvoiceTypeCode>380</InvoiceTypeCode><DocumentCurrencyCode>EUR</DocumentCurrencyCode><AccountingSupplierParty><Party><PartyName><Name>Synthetic seller</Name></PartyName></Party></AccountingSupplierParty><LegalMonetaryTotal><TaxExclusiveAmount currencyID="EUR">10.00</TaxExclusiveAmount><TaxInclusiveAmount currencyID="EUR">10.00</TaxInclusiveAmount><PayableAmount currencyID="EUR">10.00</PayableAmount></LegalMonetaryTotal></Invoice>`);
  const uploaded = await page.request.post('/api/purchase-documents', { multipart: { uploadRequestId: randomUUID(), analysisMode: 'manual', file: { name: 'synthetic-inspection.xml', mimeType: 'application/xml', buffer: original } } });
  expect(uploaded.status()).toBe(201);
  const sourceDocument = (await uploaded.json()).document as { id: number };
  const exported = await page.request.get('/api/backup/full');
  expect(exported.status()).toBe(200);
  const good = await exported.body();
  const zip = await JSZip.loadAsync(good);
  const backup = JSON.parse(await zip.file('backup.json')!.async('string'));
  expect(backup.version).toBe(CURRENT_BACKUP_VERSION); expect(backup.type).toBe('full');
  expect(backup.manifest.schemaVersion).toBe(CURRENT_SCHEMA_VERSION); expect(backup.manifest.sourceUserId).toBe(user.id);
  expect(backup.manifest.fileManifest).toHaveLength(1);
  const path = backup.manifest.fileManifest[0].zipPath as string;
  expect(digest(await zip.file(path)!.async('uint8array'))).toBe(digest(original));

  await settledNavigation(page, '/settings', () => page.goto('/settings#backup-settings'));
  const before = await protectedState(user.id);
  const auditIds = new Set((await prisma.auditLog.findMany({ where: { userId: user.id }, select: { id: true } })).map(row => row.id));
  const unexpectedMutations: string[] = [], allowedArchives = new Set<string>();
  const authDiagnostics: { level: string; code: string }[] = [];
  let previewRequests = 0;
  await page.route('**/api/**', async route => {
    const request = route.request(), requestUrl = new URL(request.url()), requestPath = requestUrl.pathname;
    const sameOrigin = requestUrl.origin === new URL(page.url()).origin;
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue();
    if (request.method() === 'POST' && sameOrigin && requestUrl.search === '' && requestPath === '/api/auth/_log') {
      const value = new URLSearchParams(request.postData() ?? '');
      const level = value.get('level') ?? '', code = value.get('code') ?? '';
      authDiagnostics.push({ level: ['error', 'warn', 'debug'].includes(level) ? level : 'unrecognized', code: /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : 'UNRECOGNIZED' });
      return route.continue(); // Diagnostic only, never a blanket auth mutation exemption.
    }
    if (request.method() === 'POST' && sameOrigin && requestUrl.search === '' && requestPath === '/api/backup/full/preview') {
      const contentType = request.headers()['content-type'];
      expect(contentType).toMatch(/^multipart\/form-data; boundary=/u);
      const bytes = request.postDataBuffer(); expect(bytes).not.toBeNull();
      const form = await new Request(request.url(), { method: 'POST', headers: { 'Content-Type': contentType }, body: new Uint8Array(bytes!) }).formData();
      expect([...form.keys()]).toEqual(['file']);
      const file = form.get('file'); expect(file).toBeInstanceOf(File);
      expect(allowedArchives.has(digest(new Uint8Array(await (file as File).arrayBuffer())))).toBe(true);
      previewRequests++;
      return route.continue();
    }
    unexpectedMutations.push(`${request.method()} ${requestPath}`);
    return route.abort('blockedbyclient');
  });
  const panel = page.locator('#backup-settings');
  const disclosureSummary = panel.locator('summary', { hasText: /^Backup wiederherstellen$/u });
  const disclosure = disclosureSummary.locator('..');
  async function openRestoreDisclosure() {
    await expect(disclosureSummary).toBeVisible();
    await expect(disclosure).toHaveJSProperty('open', false);
    await disclosureSummary.focus(); await page.keyboard.press('Enter');
    await expect(disclosure).toHaveJSProperty('open', true);
    await expect(panel.getByRole('button', { name: 'ZIP-Backup importieren', exact: true })).toBeVisible();
  }
  const summary = panel.getByRole('region', { name: 'Dateiprüfung des ZIP-Backups', exact: true });
  const restore = panel.getByRole('button', { name: 'Geprüftes Backup importieren', exact: true });
  async function choose(bytes: Buffer, status: number) {
    allowedArchives.add(digest(bytes));
    const chooser = page.waitForEvent('filechooser');
    await panel.getByRole('button', { name: 'ZIP-Backup importieren', exact: true }).focus();
    await page.keyboard.press('Enter');
    const response = page.waitForResponse(value => value.request().method() === 'POST' && new URL(value.url()).pathname === '/api/backup/full/preview');
    await (await chooser).setFiles({ name: 'synthetic-inspection.zip', mimeType: 'application/zip', buffer: bytes });
    const result = await response; expect(result.status()).toBe(status); expect(await result.finished()).toBeNull();
  }
  async function noClipping() {
    await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const clipped = await summary.evaluate(element => element.scrollWidth > element.clientWidth + 1);
    expect(clipped).toBe(false);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openRestoreDisclosure();
  await choose(good, 200);
  await expect(summary.getByRole('heading', { name: 'Dateiprüfung gegen Manifest bestanden', exact: true })).toBeVisible();
  await expect(summary.getByText('SHA-256-geprüft:', { exact: true }).locator('..')).toContainText('1');
  await expect(summary).toContainText('keine Wiederherstellung und kein Abgleich mit dem Zielbestand');
  await noClipping();
  const desktop = await panel.screenshot({ path: testInfo.outputPath('backup-file-inspection-1440-verified.png'), animations: 'disabled' });
  await panel.getByRole('button', { name: 'Auswahl verwerfen', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(summary).toHaveCount(0); await expect(restore).toHaveCount(0);

  for (const kind of ['missing', 'tampered', 'truncated'] as const) {
    const changed = await JSZip.loadAsync(good);
    if (kind === 'missing') changed.remove(path);
    else { const bytes = Buffer.from(original); if (kind === 'tampered') bytes[0] ^= 1; changed.file(path, kind === 'truncated' ? bytes.subarray(0, -1) : bytes); }
    await choose(await packed(changed), 400);
    await expect(panel.getByRole('alert').filter({ hasText: 'Fehler' })).toContainText(/fehlt im ZIP|SHA-256|Größe/u);
    await expect(summary).toHaveCount(0); await expect(restore).toHaveCount(0);
  }
  await choose(good, 200); await expect(summary).toBeVisible();
  const extra = await JSZip.loadAsync(good); extra.file('unreferenced.txt', 'Synthetic excluded extra');
  await choose(await packed(extra), 200); await expect(summary).toContainText('1 zusätzliche ZIP-Dateien');
  await expect(summary).toContainText('Diese Dateien werden nicht wiederhergestellt.');
  const legacy = new JSZip();
  legacy.file('backup.json', JSON.stringify({ version: LEGACY_BACKUP_VERSION, type: 'full', data: {} }));
  await page.setViewportSize({ width: 390, height: 844 });
  await choose(await packed(legacy), 200);
  await expect(summary.getByRole('heading', { name: 'Legacy-Backup: Dateiverfügbarkeit geprüft', exact: true })).toBeVisible();
  await expect(summary).toContainText('ursprüngliche Prüfsummen bleiben unbekannt');
  await noClipping();
  const mobile = await panel.screenshot({ path: testInfo.outputPath('backup-file-inspection-390-legacy.png'), animations: 'disabled' });
  expect(desktop.length + mobile.length).toBeLessThanOrEqual(2 * 1024 * 1024);
  expect(previewRequests).toBe(7);
  const beforeReloadRequests = previewRequests;
  await settledNavigation(page, '/settings', () => page.reload());
  await expect(disclosureSummary).toBeVisible();
  await expect(disclosure).toHaveJSProperty('open', false);
  await expect(summary).toHaveCount(0); await expect(restore).toHaveCount(0); expect(previewRequests).toBe(beforeReloadRequests);
  await openRestoreDisclosure();
  await expect(summary).toHaveCount(0); await expect(restore).toHaveCount(0); expect(previewRequests).toBe(beforeReloadRequests);
  expect(unexpectedMutations).toEqual([]); expect(authDiagnostics).toEqual([]);
  expect(await protectedState(user.id)).toEqual(before);
  const preservedOriginal = await page.request.get(`/api/purchase-documents/${sourceDocument.id}/original`);
  expect(preservedOriginal.status()).toBe(200); expect(digest(await preservedOriginal.body())).toBe(digest(original));
  const newAudits = (await prisma.auditLog.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } })).filter(row => !auditIds.has(row.id));
  expect(newAudits).toHaveLength(4);
  for (const row of newAudits) {
    expect(row).toMatchObject({ action: 'SECURITY_EVENT', entityType: 'SecurityEvent', entityName: 'BACKUP_RESTORE_PREVIEW' });
    expect(JSON.parse(row.metadata!)).toMatchObject({ event: 'BACKUP_RESTORE_PREVIEW', outcome: 'success', backupType: 'full' });
  }
  // The runner removes its temporary DB. Synthetic uploads remain for disposable
  // workspace cleanup; do not delete immutable source files or rows here.
});
