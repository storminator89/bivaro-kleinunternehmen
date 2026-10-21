import { expect, test, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../lib/password';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { PURCHASE_RULES_VERSION, PURCHASE_VALIDATION_VERSION, XRECHNUNG_PROFILE, type PurchaseTechnicalReport } from '../lib/purchase-documents/validation-contract';
import { technicalReportFingerprint } from '../lib/purchase-documents/validation-evidence';
import type { IncomingDocument } from '../lib/purchase-documents/types';

async function upload(page: Page, name: string, bytes: Buffer): Promise<IncomingDocument> {
  const response = await page.request.post('/api/purchase-documents', { multipart: { file: { name, mimeType: 'application/xml', buffer: bytes }, uploadRequestId: randomUUID() } });
  expect(response.status(), await response.text()).toBe(201); return (await response.json()).document;
}
async function open(page: Page, name: string) {
  await page.goto('/purchases');
  const trigger = page.getByRole('list', { name: 'Eingangsbelege', exact: true }).getByRole('button').filter({ hasText: name });
  await expect(trigger).toBeVisible(); await trigger.focus(); await page.keyboard.press('Enter');
  const panel = page.getByRole('region', { name: 'Technische E-Rechnungsprüfung', exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Prüfhistorie wird geladen…', { exact: true })).toHaveCount(0);
  return { panel, trigger };
}
async function validate(page: Page, id: number) {
  const panel = page.getByRole('region', { name: 'Technische E-Rechnungsprüfung', exact: true });
  const response = page.waitForResponse(value => new URL(value.url()).pathname === `/api/purchase-documents/${id}/validation` && value.request().method() === 'POST');
  const button = panel.getByRole('button', { name: /^(Technisch prüfen|Erneut technisch prüfen|Prüfung sicher erneut versuchen)$/ });
  await expect(button).toBeEnabled(); await button.focus(); await page.keyboard.press('Enter');
  const result = await response; expect(result.status(), await result.text()).toBe(200);
  await expect(panel.getByRole('heading', { name: 'Technische E-Rechnungsprüfung', exact: true })).toBeFocused();
  return result.json();
}
test('offline incoming validation preserves originals, separates historic results and stays unposted on desktop/mobile/keyboard/retry', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  expect(process.env.BIVARO_EINVOICE_ASSETS, 'Install the pinned official offline assets before this acceptance test.').toBeTruthy();
  const password = 'SyntheticValidation123!';
  const user = await prisma.user.create({ data: { name: 'Synthetic validation owner', email: `validation-${randomUUID()}@example.test`, password: await hashPassword(password), role: 'USER' } });
  try {
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/login'); await page.getByLabel('E-Mail').fill(user.email); await page.getByLabel('Passwort', { exact: true }).fill(password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click(); await expect(page).toHaveURL(/\/dashboard/);
    const fixtures = path.resolve('lib/__tests__/fixtures/incoming-validation');
    const cii = await readFile(path.join(fixtures, 'valid-cii.xml'));
    const ubl = await readFile(path.join(fixtures, 'valid-ubl.xml'));
    const first = await upload(page, 'synthetic-validation-cii.xml', cii);
    expect(await prisma.purchaseValidationReport.count({ where: { userId: user.id } })).toBe(0);
    const { panel, trigger } = await open(page, first.originalRef.fileName);
    await expect(panel).toContainText('Noch kein technischer Prüfbericht');
    const requests: string[] = []; let interrupted = false;
    await page.route(`**/api/purchase-documents/${first.id}/validation`, async route => {
      if (route.request().method() === 'POST') {
        requests.push(route.request().postDataJSON().requestId);
        if (!interrupted) { interrupted = true; await route.abort('failed'); return; }
      }
      await route.continue();
    });
    await panel.getByRole('button', { name: 'Technisch prüfen', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(panel.getByRole('alert')).toContainText('Verbindung');
    await validate(page, first.id); expect(requests).toHaveLength(2); expect(requests[0]).toBe(requests[1]);
    await expect(panel.getByText('Technisch geprüft · unterstützte Regeln erfüllt', { exact: true })).toBeVisible();
    expect(await prisma.purchaseValidationReport.count({ where: { userId: user.id } })).toBe(1);
    const details = panel.locator('summary').filter({ hasText: /^Prüfdetails und Regeln$/ }); await details.focus(); await page.keyboard.press('Enter');
    await expect(panel.getByText(first.originalRef.sha256, { exact: true })).toBeVisible();
    await expect(panel).toContainText(PURCHASE_RULES_VERSION); await expect(panel).toContainText('nicht Identität, Zahlung oder steuerliche Freigabe');
    const original = await page.request.get(first.originalRef.downloadUrl); expect(original.status()).toBe(200);
    expect(createHash('sha256').update(await original.body()).digest('hex')).toBe(first.originalRef.sha256);
    await panel.scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath('incoming-validation-desktop-1440.png'), fullPage: true });
    for (const extra of [{ rulesVersion: 'old-rules' }, { expectedSha256: 'f'.repeat(64) }, { expectedRevision: first.revision + 1 }]) {
      const rejected = await page.request.post(`/api/purchase-documents/${first.id}/validation`, { data: { expectedRevision: first.revision, expectedSha256: first.originalRef.sha256, requestId: randomUUID(), checkerVersion: PURCHASE_VALIDATION_VERSION, rulesVersion: PURCHASE_RULES_VERSION, ...extra } });
      expect(rejected.status()).toBe(409);
    }
    await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(trigger).toBeFocused();
    const validUbl = await upload(page, 'synthetic-validation-ubl.xml', ubl); await open(page, validUbl.originalRef.fileName);
    await validate(page, validUbl.id); await expect(page.getByRole('region', { name: 'Technische E-Rechnungsprüfung', exact: true })).toContainText('Technisch geprüft · unterstützte Regeln erfüllt');
    const local = await prisma.purchaseValidationReport.findFirstOrThrow({ where: { userId: user.id, originalSha256: validUbl.originalRef.sha256 } });
    const historic = { ...(local.report as unknown as PurchaseTechnicalReport), checkerVersion: 'incoming-xrechnung-v0' };
    await prisma.purchaseValidationReport.create({ data: { stableKey: randomUUID(), userId: user.id, originalSha256: validUbl.originalRef.sha256, sourceDocumentIdAtCheck: 999999, requestId: randomUUID(), fingerprint: technicalReportFingerprint(historic), provenance: 'IMPORTED_HISTORIC', report: historic, checkedAt: new Date(historic.checkedAt) } });
    await page.reload(); const ublPanel = page.getByRole('region', { name: 'Technische E-Rechnungsprüfung', exact: true });
    await ublPanel.locator('summary').filter({ hasText: /^Weitere Prüfberichte/ }).click(); await expect(ublPanel).toContainText('Historischer Bericht · keine aktuelle Freigabe');
    const before = await prisma.purchaseDocument.findUniqueOrThrow({ where: { id: first.id } });
    const broken = Buffer.from(ubl.toString().replace('<cbc:TaxInclusiveAmount currencyID="EUR">119.00', '<cbc:TaxInclusiveAmount currencyID="EUR">129.00'));
    const invalid = await upload(page, 'synthetic-validation-invalid.xml', broken);
    await page.setViewportSize({ width: 390, height: 844 }); const invalidUi = await open(page, invalid.originalRef.fileName); await validate(page, invalid.id);
    await expect(invalidUi.panel.getByText('Technische Prüfung fehlgeschlagen', { exact: true })).toBeVisible(); await expect(invalidUi.panel).toContainText('BR-CO-15');
    await expect(invalidUi.panel.getByText('Technisch geprüft · unterstützte Regeln erfüllt', { exact: true })).toHaveCount(0);
    await invalidUi.panel.scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath('incoming-validation-mobile-390.png'), fullPage: true });
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
    const unsupported = await upload(page, 'synthetic-validation-unsupported.xml', Buffer.from(ubl.toString().replace(XRECHNUNG_PROFILE, 'urn:synthetic:unsupported')));
    const unsupportedUi = await open(page, unsupported.originalRef.fileName); await validate(page, unsupported.id);
    await expect(unsupportedUi.panel.getByText('Prüfung nicht unterstützt', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape'); await expect(unsupportedUi.trigger).toBeFocused();
    const hints = await upload(page, 'synthetic-validation-schema-hints.xml', Buffer.from(ubl.toString().replace('<Invoice ', '<Invoice xmlns:hint="http://www.w3.org/2001/XMLSchema-instance" hint:noNamespaceSchemaLocation="file:///synthetic/not-read.xsd" ')));
    const hintsUi = await open(page, hints.originalRef.fileName); await validate(page, hints.id);
    await expect(hintsUi.panel.getByText('Prüfung nicht unterstützt', { exact: true })).toBeVisible();
    await expect(hintsUi.panel).toContainText('Diese Prüfung unterstützt keine XML-Dateien mit externen Schema-Verweisen.');
    await expect(hintsUi.panel.getByText('Technisch geprüft · unterstützte Regeln erfüllt', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape'); await expect(hintsUi.trigger).toBeFocused();
    await page.goBack(); await page.goForward();
    expect(await prisma.purchaseDocument.findUniqueOrThrow({ where: { id: first.id } })).toEqual(before);
    expect(await Promise.all([prisma.expense.count({ where: { userId: user.id } }), prisma.income.count({ where: { userId: user.id } }), prisma.invoice.count({ where: { userId: user.id } }), prisma.cashTransaction.count({ where: { userId: user.id } })])).toEqual([0, 0, 0, 0]);
  } finally { await prisma.$disconnect(); }
});
