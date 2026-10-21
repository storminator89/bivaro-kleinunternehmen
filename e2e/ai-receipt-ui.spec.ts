import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import type { AiProviderSettingsDto } from '../lib/ai-provider/types';
import type { AiExtractionJob, AiExtractionResult } from '../lib/purchase-documents/ai-types';
import type { IncomingDocument } from '../lib/purchase-documents/types';

// Mocked UI-contract coverage in the normal isolated Bivaro browser runner.
// The chromium project depends on its existing first-admin bootstrap suite.
// All AI endpoints are intercepted in the browser;
// no real API key, provider request, tenant credential configuration or posting.
// Server/lifecycle behavior must be verified separately; these screenshots are
// synthetic UI evidence, not a claim of real model/provider compatibility.
test('mocked optional AI settings and dirty-safe receipt suggestions', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const password = 'SyntheticAiReceiptUi123!';
  const user = await prisma.user.create({ data: { email: `ai-ui-${randomUUID()}@example.test`, name: 'Synthetic AI receipt UI', password: await hashPassword(password), role: 'USER' } });
  try {
    let settings: AiProviderSettingsDto = { enabled: false, autoAnalyzeNewUploads: false, baseUrl: '', model: '', hasKey: false, configured: false, encryptionAvailable: true, version: 0, configurationRevision: '' };
    let aiCalls = 0; let interruptFirstAnalysis = true; let testCalls = 0; let postingCalls = 0; let extraction: AiExtractionJob | null = null;
    const result: AiExtractionResult = { schemaVersion: 1, provenance: 'AI_UNREVIEWED', lineItemsComplete: true, supplierName: 'Synthetischer Lieferant', invoiceNumber: 'AI-SYNTHETIC-17', invoiceDate: '2026-10-20', currency: 'EUR', grossAmount: '0.29', netAmount: null, taxAmount: null, documentType: 'INVOICE', lineItems: [{ description: 'Synthetische Position mit langer Beschreibung zur mobilen Lesbarkeit', quantity: '1', unitPrice: '0.29', amount: '0.29', taxRate: null }], warnings: [{ code: 'UNCERTAIN', message: 'Synthetische Testdaten. Keine echte Beleganalyse.' }] };
    let document: IncomingDocument = { id: 87123, direction: 'INCOMING', reviewState: 'REVIEW', reviewStatus: 'REVIEW', parseStatus: 'FAILED', validationStatus: 'NOT_VALIDATED', revision: 1, originalRef: { id: 87123, fileName: 'synthetic-ai-receipt.png', sha256: 'a'.repeat(64), bytes: 100, mediaType: 'image/png', uploadedAt: '2026-10-21T08:00:00.000Z', downloadUrl: '/api/purchase-documents/87123/original' }, supplierName: null, invoiceNumber: null, invoiceDate: null, currency: null, totalAmount: null, supplierId: null, selectedSupplierSnapshot: null, supplierCandidate: null, buyerCandidate: null, parserWarnings: [], parserVersion: null, parseErrorCode: 'UNSUPPORTED_FILE', preview: null, businessDuplicates: [], linkedExpenseId: null, dismissedAt: null, dismissalReason: null, approvalSupported: false, reviewDraft: null, reviewDraftSavedAt: null };
    await page.route('**/api/settings/ai-provider', async route => {
      if (route.request().method() === 'PUT') {
        const payload = route.request().postDataJSON();
        expect(payload.expectedVersion).toBe(settings.version);
        const previousRevision = settings.configurationRevision;
        if (payload.keyAction !== 'replace') expect(payload).not.toHaveProperty('apiKey');
        if (payload.keyAction === 'replace') expect(payload.apiKey).toBe('synthetic-key-never-stored');
        settings = { ...settings, enabled: payload.enabled, autoAnalyzeNewUploads: payload.autoAnalyzeNewUploads, baseUrl: payload.baseUrl, model: payload.model, hasKey: payload.keyAction !== 'remove', configured: payload.keyAction !== 'remove', version: settings.version + 1, configurationRevision: randomUUID() };
        expect(settings.configurationRevision).not.toBe(previousRevision);
      }
      await route.fulfill({ json: settings });
    });
    await page.route('**/api/settings/ai-provider/test', async route => { testCalls++; expect(route.request().postDataJSON()).toEqual({ expectedVersion: settings.version, expectedConfigRevision: settings.configurationRevision, acknowledgeCost: true }); await route.fulfill({ json: { ok: true } }); });
    await page.route('**/api/purchase-documents/87123/ai-extraction', async route => {
      if (route.request().method() === 'POST') {
        aiCalls++; if (interruptFirstAnalysis) { interruptFirstAnalysis = false; await route.abort('failed'); return; }
        expect(route.request().postDataJSON()).toMatchObject({ expectedRevision: document.revision, expectedConfigVersion: settings.version, expectedConfigRevision: settings.configurationRevision, acknowledgeCost: true, retry: false });
        extraction = { id: 'synthetic-job', configVersion: settings.version, configRevision: settings.configurationRevision, sourceSha256: document.originalRef.sha256, sourceRevision: document.revision, status: 'completed', createdAt: '2026-10-21T08:00:00.000Z', deadlineAt: '2026-10-21T08:01:00.000Z', finishedAt: '2026-10-21T08:00:01.000Z', errorCode: null, result, draftApplied: false };
        await route.fulfill({ json: { extraction, document } });
      } else await route.fulfill({ json: { extraction } });
    });
    await page.route('**/api/purchase-documents/87123/ai-extraction/apply', async route => {
      const own = document.reviewDraft;
      document = { ...document, revision: document.revision + 1, reviewDraft: { supplierName: own?.supplierName || result.supplierName!, invoiceNumber: own?.invoiceNumber || result.invoiceNumber!, invoiceDate: own?.invoiceDate || result.invoiceDate!, amount: own?.amount || result.grossAmount!, paymentDate: own?.paymentDate || '', note: own?.note || '' }, reviewDraftSavedAt: '2026-10-21T08:00:02.000Z' };
      extraction = { ...extraction!, draftApplied: true };
      await route.fulfill({ json: { extraction, document } });
    });
    await page.route('**/api/purchase-documents/87123/review-draft', async route => { document = { ...document, reviewDraft: route.request().postDataJSON().draft, revision: document.revision + 1, reviewDraftSavedAt: '2026-10-21T08:00:01.000Z' }; await route.fulfill({ json: { document } }); });
    await page.route('**/api/purchase-documents/87123', route => route.fulfill({ json: { document } }));
    await page.route('**/api/purchase-documents?*', route => route.fulfill({ json: { documents: [document], total: 1, page: 1, limit: 25 } }));
    const photo = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="390" height="240"><rect width="390" height="240" fill="white"/><text x="20" y="100" font-size="20">SYNTHETISCHER TESTBELEG</text><text x="20" y="150" font-size="28">0,29 EUR</text></svg>')).png().toBuffer();
    await page.route('**/api/purchase-documents/87123/original', route => route.fulfill({ contentType: 'image/png', body: photo }));
    await page.route('**/approve-expense', async route => { postingCalls++; await route.abort(); });
    // Authenticate a fresh synthetic user in the runner-owned temporary database.
    // Configuration writes remain intercepted; no runtime provider credentials.
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(user.email);
    await page.getByLabel('Passwort', { exact: true }).fill(password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/settings');
    await expect(page).not.toHaveURL(/\/login/);
    const panel = page.locator('#ai-receipt-settings');
    await expect(panel.getByText('Noch nicht vollständig eingerichtet', { exact: false })).toBeVisible();
    await panel.getByLabel('Base URL (HTTPS)', { exact: true }).fill('https://synthetic-provider.example/v1');
    await panel.getByLabel('Modell', { exact: true }).fill('synthetic-vision');
    await panel.getByRole('radio', { name: 'Neuen Schlüssel speichern / ersetzen', exact: true }).check();
    await panel.getByLabel('Neuer API-Schlüssel', { exact: true }).fill('synthetic-key-never-stored');
    await expect(panel.getByLabel('Neuer API-Schlüssel', { exact: true })).toHaveAttribute('type', 'password');
    await panel.getByRole('switch', { name: 'KI-Auslesen aktivieren', exact: true }).click();
    await expect(panel.getByRole('switch', { name: 'Neue Uploads automatisch analysieren', exact: true })).not.toBeChecked();
    await panel.getByRole('switch', { name: 'Neue Uploads automatisch analysieren', exact: true }).click();
    await panel.getByRole('button', { name: 'KI-Einstellungen speichern', exact: true }).click();
    await expect(panel.getByText('Schlüssel gespeichert, wird nie angezeigt', { exact: false })).toBeVisible();
    await expect(panel.getByLabel('Neuer API-Schlüssel', { exact: true })).toHaveCount(0);
    await panel.getByText('Verbindung prüfen und Datenschutz', { exact: true }).click();
    const testButton = panel.getByRole('button', { name: 'Gespeicherte Verbindung testen', exact: true });
    await expect(testButton).toBeDisabled(); expect(testCalls).toBe(0);
    await panel.getByLabel('Mögliche Kosten für diesen Verbindungstest akzeptieren.', { exact: true }).check();
    await testButton.click(); await expect(panel.getByText(/Verbindung mit einem künstlichen Text erfolgreich/)).toBeVisible(); expect(testCalls).toBe(1);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await panel.screenshot({ path: testInfo.outputPath('ai-receipt-settings-desktop.png'), animations: 'disabled' });
    await panel.getByLabel('Base URL (HTTPS)', { exact: true }).fill('https://different-synthetic.example/v1');
    await expect(panel.getByRole('button', { name: 'KI-Einstellungen speichern', exact: true })).toBeDisabled();
    await panel.getByLabel('Base URL (HTTPS)', { exact: true }).fill(settings.baseUrl);
    await page.goto('/purchases?document=87123');
    const dialog = page.getByRole('dialog');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(dialog.getByText('Noch keine KI-Analyse', { exact: true })).toBeVisible(); expect(aiCalls).toBe(0);
    await dialog.getByLabel('Lieferant laut eigener Prüfung', { exact: true }).fill('Eigener unveränderlicher Entwurf');
    await expect(dialog.getByRole('button', { name: 'Diesen Beleg mit KI auslesen', exact: true })).toBeDisabled();
    page.once('dialog', confirmation => confirmation.dismiss());
    await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
    await expect(dialog.getByLabel('Lieferant laut eigener Prüfung', { exact: true })).toHaveValue('Eigener unveränderlicher Entwurf');
    await dialog.getByRole('button', { name: 'Prüfentwurf speichern', exact: true }).click();
    await expect(dialog.getByText('Prüfentwurf gespeichert · nicht gebucht', { exact: true })).toBeVisible();
    await dialog.getByLabel('Übermittlung und mögliche Kosten für diese Analyse freigeben.', { exact: true }).check();
    await dialog.getByRole('button', { name: 'Diesen Beleg mit KI auslesen', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Status zuerst prüfen');
    expect(aiCalls).toBe(1);
    await expect(dialog.getByRole('button', { name: 'Diesen Beleg mit KI auslesen', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Nur KI-Status aktualisieren', exact: true }).click();
    await expect(dialog.getByLabel('Übermittlung und mögliche Kosten für diese Analyse freigeben.', { exact: true })).not.toBeChecked();
    await dialog.getByLabel('Übermittlung und mögliche Kosten für diese Analyse freigeben.', { exact: true }).check();
    await dialog.getByRole('button', { name: 'Diesen Beleg mit KI auslesen', exact: true }).click();
    await expect(dialog.getByText('KI-Vorschläge ausgelesen · nicht gebucht', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Lieferant laut eigener Prüfung', { exact: true })).toHaveValue('Eigener unveränderlicher Entwurf');
    await dialog.getByRole('button', { name: 'Leere Entwurfsfelder ergänzen', exact: true }).click();
    await expect(dialog.getByLabel('Rechnungsnummer im Entwurf', { exact: true })).toHaveValue('AI-SYNTHETIC-17');
    await expect(dialog.getByLabel('Lieferant laut eigener Prüfung', { exact: true })).toHaveValue('Eigener unveränderlicher Entwurf');
    await expect(dialog.getByLabel('Tatsächliches Zahlungsdatum im Entwurf', { exact: true })).toHaveValue('');
    await dialog.getByText('1 Positionsvorschläge prüfen', { exact: true }).click();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await dialog.screenshot({ path: testInfo.outputPath('ai-receipt-review-mobile.png'), animations: 'disabled' });
    await page.reload();
    await expect(page.getByRole('dialog').getByText('KI-Vorschläge ausgelesen · nicht gebucht', { exact: true })).toBeVisible();
    expect(aiCalls).toBe(2); expect(postingCalls).toBe(0);
    expect(await prisma.expense.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.income.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.cashTransaction.count({ where: { userId: user.id } })).toBe(0);
  } finally { await prisma.$disconnect(); }
});
