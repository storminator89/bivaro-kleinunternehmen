import { expect, test, type Page } from '@playwright/test';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { createBackupManifest, PRE_PAYMENT_JOURNAL_SCHEMA_VERSION } from '../lib/backup-manifest';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';

const conflictMessage = 'Zusammenführen ohne eindeutige Rechnungsidentität ist bei vorhandenen unveränderlichen Zahlungsereignissen nicht möglich. Bitte den Altbeleg getrennt prüfen oder ein leeres Wiederherstellungsziel verwenden.';
const historicalDate = '2025-03-17T00:00:00.000Z';
const password = 'SyntheticRestorePass123!';

// Identity setup only. Every business mutation below goes through real HTTP
// routes, including both imports through the actual settings file/preview UI.
// The runner validates this path and owns removal of the entire fixture DB.
async function isolatedAccount(page: Page) {
  const databaseUrl = `file:${e2eDatabasePath()}`;
  expect(process.env.DATABASE_URL).toBe(databaseUrl);
  const db = prisma;
  const email = `restore-${randomUUID()}@example.test`;
  const user = await db.user.create({ data: { email, name: 'Synthetic restore fixture', password: await hashPassword(password), role: 'USER' } });
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return { db, userId: user.id };
}

function oldBackup(version: '2.0' | '3.0', invoiceNumber: string | null = null, withIncome = true) {
  const sourceUserId = 'synthetic-pre-journal-source';
  const data = {
    user: { id: sourceUserId, email: 'source@example.test', name: 'Synthetic old backup' },
    customers: [], suppliers: [], purchaseDocuments: [], expenses: [],
    invoices: [{ id: 91, type: 'INVOICE', invoiceNumber, fileName: 'historical-paid.pdf', storedFileName: 'historical-paid.pdf',
      uploadedAt: '2025-03-01T00:00:00.000Z', invoiceDate: '2025-03-01T00:00:00.000Z', status: 'PAID',
      totalAmount: 123.45, parsedData: { currency: 'EUR' } }],
    incomes: withIncome ? [{ id: 92, invoiceId: 91, description: 'Original historical payment', amount: 123.45, date: historicalDate, taxRelevant: true }] : [],
    templates: [], billingNotes: [], recurringExpenses: [], reminders: [], cashBooks: [], cashTransactions: [],
    documentations: [], apiKeys: [], auditLogs: [], invoiceNumberCounters: [],
  };
  const manifest = createBackupManifest({ sourceUserId, generatedAt: '2025-03-18T00:00:00.000Z', data });
  manifest.schemaVersion = PRE_PAYMENT_JOURNAL_SCHEMA_VERSION;
  manifest.modelCoverage = manifest.modelCoverage.filter(entry => !['PaymentJournalEvent', 'AiProviderSettings', 'ServiceArticle', 'DataImportBatch', 'ServiceBillingPlan', 'ServiceBillingPeriod'].includes(entry.model));
  return { version, type: 'json', exportedAt: '2025-03-18T00:00:00.000Z', data, ...(version === '3.0' ? { manifest } : {}) };
}

async function previewInSettings(page: Page, backup: unknown, name: string) {
  await page.goto('/settings');
  await expect(page.getByRole('checkbox', { name: 'Bestehende Daten überschreiben', exact: true })).not.toBeChecked();
  const previewed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/backup/preview' && response.request().method() === 'POST');
  await page.locator('#restore-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  expect((await previewed).status()).toBe(200);
  await expect(page.getByText('Backup-Vorschau bereit', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Geprüftes Backup importieren', exact: true })).toBeEnabled();
}

async function importPreview(page: Page, expectedStatus: number) {
  const restored = page.waitForResponse(response => new URL(response.url()).pathname === '/api/backup/restore' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Geprüftes Backup importieren', exact: true }).click();
  const response = await restored;
  expect(response.request().postDataJSON().confirmOverwrite).toBe(false);
  expect(response.status()).toBe(expectedStatus);
  return response.json();
}

async function snapshot(db: PrismaClient, userId: string) {
  return {
    invoices: await db.invoice.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    incomes: await db.income.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    events: await db.paymentJournalEvent.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    customers: await db.customer.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    auditCount: await db.auditLog.count({ where: { userId } }),
  };
}

for (const scenario of [{ version: '2.0', width: 1440 }, { version: '3.0', width: 375 }] as const) {
  test(`rejects ambiguous pre-journal ${scenario.version} merge atomically at ${scenario.width}px and keeps retry/cancel usable`, async ({ page }, testInfo) => {
    const { db, userId } = await isolatedAccount(page);
    try {
      await page.setViewportSize({ width: scenario.width, height: 1000 });
      const backup = oldBackup(scenario.version);
      await previewInSettings(page, backup, 'synthetic-old-paid.json');
      const firstImport = await importPreview(page, 200);
      expect(firstImport.results.invoices.imported).toBe(1);
      expect(firstImport.results.incomes.imported).toBe(1);
      const initial = await snapshot(db, userId);
      expect(initial.invoices).toHaveLength(1);
      expect(initial.incomes).toHaveLength(1);
      expect(initial.events).toHaveLength(0);
      const invoiceId = initial.invoices[0].id;
      const adoption = await page.request.post(`/api/invoices/${invoiceId}/payments`, { data: { kind: 'LEGACY_IMPORT' } });
      expect(adoption.status()).toBe(200);
      expect((await adoption.json()).event).toMatchObject({ invoiceId, amountCents: '12345', source: 'LEGACY_IMPORT',
        dateCertainty: 'LEGACY_INCOME', paidAt: historicalDate, incomeId: initial.incomes[0].id, reference: `invoice:${invoiceId}` });
      // The mobile v3 regression additionally exercises a whitespace-only
      // source identity against the adopted target's original null identity.
      const mergeBackup = scenario.version === '3.0' ? oldBackup('3.0', '   ') : backup;
      await previewInSettings(page, mergeBackup, 'same-old-paid.json');
      // Successful preview legitimately audits its read; freeze the comparison
      // after that audit so rejection itself must leave every row unchanged.
      const before = await snapshot(db, userId);
      expect(before.events).toHaveLength(1);
      expect(before.invoices[0].totalAmount).toBe(123.45);
      expect(before.incomes[0].date.toISOString()).toBe(historicalDate);
      const rejected = await importPreview(page, 400);
      expect(rejected.error).toBe(conflictMessage);
      const error = page.getByRole('alert').filter({ hasText: conflictMessage });
      await expect(error).toBeVisible();
      await expect(page.getByText('Backup-Vorschau bereit', { exact: true })).toBeVisible();
      const after = await snapshot(db, userId);
      expect(after).toEqual(before);
      // Error remains announced via role=alert; the existing inline preview
      // does not steal focus. Both recovery actions remain keyboard focusable.
      const retry = page.getByRole('button', { name: 'Geprüftes Backup importieren', exact: true });
      await retry.focus();
      await expect(retry).toBeFocused();
      const retried = page.waitForResponse(response => new URL(response.url()).pathname === '/api/backup/restore' && response.request().method() === 'POST');
      await page.keyboard.press('Enter');
      const retryResponse = await retried;
      expect(retryResponse.status()).toBe(400);
      expect((await retryResponse.json()).error).toBe(conflictMessage);
      await expect(retry).toBeEnabled();
      await expect(error).toBeVisible();
      expect(await snapshot(db, userId)).toEqual(before);
      const cancel = page.getByRole('button', { name: 'Auswahl verwerfen', exact: true });
      await cancel.focus();
      await expect(cancel).toBeFocused();
      await error.screenshot({ path: testInfo.outputPath(`conflict-alert-${scenario.width}.png`) });
      await page.getByRole('alert').filter({ hasText: 'Backup-Vorschau bereit' }).screenshot({ path: testInfo.outputPath(`retry-discard-preview-${scenario.width}.png`) });
      await page.screenshot({ path: testInfo.outputPath(`old-merge-error-${scenario.width}.png`), fullPage: true });
      await page.keyboard.press('Enter');
      await expect(page.getByText('Backup-Vorschau bereit', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'JSON-Backup importieren', exact: true })).toBeEnabled();
      expect(await snapshot(db, userId)).toEqual(before);
      // A rejected unnamed row must not block an independently numbered import.
      await previewInSettings(page, oldBackup(scenario.version, `UNRELATED-${scenario.version}`, false), 'unrelated-numbered.json');
      expect((await importPreview(page, 200)).results.invoices.imported).toBe(1);
      const compatible = await snapshot(db, userId);
      expect(compatible.invoices).toHaveLength(2);
      expect(compatible.incomes).toEqual(before.incomes);
      expect(compatible.events).toEqual(before.events);
      expect(compatible.invoices.find(invoice => invoice.id === invoiceId)).toEqual(before.invoices[0]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await testInfo.attach('atomic-restore-evidence.json', { body: Buffer.from(JSON.stringify({
        version: scenario.version, viewport: scenario.width,
        before, after, compatible: { invoices: compatible.invoices.length, incomes: compatible.incomes.length, events: compatible.events.length },
      }, null, 2)), contentType: 'application/json' });
    } finally { await db.$disconnect(); }
  });
}

for (const invoiceNumber of ['', '   ']) {
  test(`adopts ${invoiceNumber.length ? 'whitespace' : 'empty'} invoice number with stable fallback and no invented Income/date`, async ({ page }, testInfo) => {
    const { db, userId } = await isolatedAccount(page);
    try {
      await previewInSettings(page, oldBackup('2.0', invoiceNumber, false), 'blank-number-unknown-date.json');
      await importPreview(page, 200);
      const initial = await snapshot(db, userId);
      expect(initial.invoices).toHaveLength(1);
      expect(initial.incomes).toHaveLength(0);
      const invoiceId = initial.invoices[0].id;
      const adopted = await page.request.post(`/api/invoices/${invoiceId}/payments`, { data: { kind: 'LEGACY_IMPORT' } });
      expect(adopted.status()).toBe(200);
      expect((await adopted.json()).event).toMatchObject({ reference: `invoice:${invoiceId}`, amountCents: '12345', dateCertainty: 'UNKNOWN', paidAt: null, incomeId: null });
      const before = await snapshot(db, userId);
      const exported = await page.request.get('/api/backup');
      expect(exported.status()).toBe(200);
      const currentBackup = await exported.json();
      await previewInSettings(page, currentBackup, 'current-journal-roundtrip.json');
      expect((await importPreview(page, 200)).results.paymentJournalEvents.imported).toBe(0);
      const after = await snapshot(db, userId);
      expect(after.invoices).toEqual(before.invoices);
      expect(after.incomes).toEqual([]);
      expect(after.events).toEqual(before.events);
      await testInfo.attach('blank-number-roundtrip.json', { body: Buffer.from(JSON.stringify({ invoiceNumber, before, after }, null, 2)), contentType: 'application/json' });
    } finally { await db.$disconnect(); }
  });
}
