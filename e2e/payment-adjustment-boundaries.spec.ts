import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { allocate, createInvoice, isolatedAccount, loadJournal, openJournal, snapshot } from './helpers/payment-adjustments';

test('documents an actual refund against its full cancellation and keeps residual liability out of reminders', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const userId = await isolatedAccount(page);
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const number = 'ADJUSTMENT-REFUND-120';
    const invoice = await createInvoice(page, number);
    const payment = await allocate(page, invoice.id, '120.00', '2025-06-15', '0');
    const original = await snapshot(userId, invoice.id);
    const cancelled = await page.request.post('/api/invoices/cancel', { data: { invoiceId: invoice.id, cancellationReason: 'Synthetic complete cancellation' } });
    expect(cancelled.status()).toBe(200);
    const basis = (await cancelled.json()).creditNote;
    expect(await prisma.invoice.findUnique({ where: { id: basis.id }, select: { originalInvoiceId: true, type: true, status: true, issuanceState: true, totalAmount: true } })).toEqual({ originalInvoiceId: invoice.id, type: 'CREDIT_NOTE', status: 'SENT', issuanceState: 'ISSUED', totalAmount: -120 });
    const beforeRefund = await loadJournal(page, invoice.id);
    expect(beforeRefund.ledger).toMatchObject({ collectibleOpenCents: '0', refundDueCents: '12000', refundedCents: '0' });
    expect(beforeRefund.adjustments).toHaveLength(0);
    await page.goto('/dashboard?tab=invoices');
    const dialog = await openJournal(page, number);
    const panel = dialog.getByRole('region', { name: 'Zahlung korrigieren oder Erstattung dokumentieren', exact: true });
    await expect(panel.getByText('Noch einzuziehen', { exact: true }).locator('..').locator('dd')).toHaveText(/^0,00\s*€$/u);
    await expect(panel.getByText('Noch zu erstatten', { exact: true }).locator('..').locator('dd')).toHaveText(/^120,00\s*€$/u);
    await panel.getByRole('button', { name: 'Korrektur / Erstattung dokumentieren', exact: true }).click();
    await panel.getByRole('radio', { name: /Erstattung Bereits zurückgezahlt/ }).check();
    await expect(panel).toContainText(`Vollständiger Stornobeleg: ${basis.invoiceNumber}`);
    await panel.getByLabel('Ursprünglicher Zahlungsnachweis', { exact: true }).selectOption(String(payment.event.id));
    await panel.getByLabel('Tatsächlich ausgezahlter Betrag (EUR)', { exact: true }).fill('40.00');
    await expect(panel.getByLabel('Tatsächliches Auszahlungsdatum', { exact: true })).toHaveValue('');
    await panel.getByLabel('Tatsächliches Auszahlungsdatum', { exact: true }).fill('2026-03-03');
    await panel.getByLabel('Nachvollziehbarer Grund', { exact: true }).fill('Synthetic already-executed customer payout');
    await panel.getByLabel('Nachweis der tatsächlichen Auszahlung', { exact: true }).fill('Synthetic bank payout evidence 40');
    await panel.getByRole('checkbox', { name: /Der Kunde hat den Betrag tatsächlich zurückerhalten/ }).check();
    const saved = page.waitForResponse(response => response.url().endsWith(`/api/invoices/${invoice.id}/payments/adjustments`) && response.request().method() === 'POST');
    await panel.getByRole('button', { name: 'Erstattung verbindlich dokumentieren', exact: true }).focus();
    await page.keyboard.press('Enter');
    const response = await saved;
    expect(response.status()).toBe(201);
    expect(response.request().postDataJSON()).toMatchObject({ kind: 'CUSTOMER_REFUND', originalPaymentId: payment.event.id, cancellationInvoiceId: basis.id, amount: '40.00', actionDate: '2026-03-03' });
    await expect(panel.getByText('Erstattung dokumentiert', { exact: true })).toBeVisible();
    await expect(panel.getByText('Noch zu erstatten', { exact: true }).locator('..').locator('dd')).toHaveText(/^80,00\s*€$/u);
    await expect(panel.getByText('Noch einzuziehen', { exact: true }).locator('..').locator('dd')).toHaveText(/^0,00\s*€$/u);
    await expect(panel.getByLabel('Steuerliche Zuordnung: prüfpflichtig, nicht fachlich freigegeben')).toBeVisible();
    const ledger = await loadJournal(page, invoice.id);
    expect(ledger.ledger).toMatchObject({ documentState: 'CANCELLED', validReceivedCents: '12000', refundedCents: '4000', netRetainedCents: '8000', refundDueCents: '8000', collectibleOpenCents: '0' });
    const after = await snapshot(userId, invoice.id);
    expect(after.events).toEqual(original.events); expect(after.incomes).toEqual(original.incomes);
    expect(after.adjustments).toHaveLength(1);
    expect(after.audits.filter(audit => audit.action === 'CUSTOMER_REFUND')).toHaveLength(1);
    for (const path of [`/api/invoices/${invoice.id}/payments`, '/api/invoices']) {
      const oldReader = await page.request.get(path);
      expect(oldReader.status()).toBe(409);
      expect(await oldReader.json()).toHaveProperty('code', 'PAYMENT_CAPABILITY_REQUIRED');
    }
    await dialog.locator('[data-slot="dialog-footer"]').getByRole('button', { name: 'Schließen', exact: true }).click();
    await page.reload();
    const row = page.getByRole('row').filter({ hasText: number });
    await expect(row).toContainText('Noch zu erstatten 80,00');
    // No transport authority is present, and even a stale direct command fails
    // before any reminder evidence or customer communication can be created.
    expect(await prisma.smtpSettings.count()).toBe(0);
    expect(Boolean(process.env.SMTP_HOST || process.env.SMTP_USER || process.env.SMTP_PASSWORD)).toBe(false);
    const reminderResponse = await page.request.get('/api/reminders?includeAll=true');
    expect(reminderResponse.status()).toBe(200);
    const reminders = await reminderResponse.json();
    expect(reminders.invoices).toEqual([]); expect(reminders.stats.totalAmount).toBe(0);
    const dailyResponse = await page.request.get('/api/daily-actions');
    expect(dailyResponse.status()).toBe(200);
    const daily = await dailyResponse.json();
    expect(daily.actions).toEqual([]);
    const rejected = await page.request.post('/api/reminders', { data: { invoiceId: invoice.id, fee: 0, idempotencyKey: randomUUID() } });
    expect(rejected.status()).toBe(409); expect(await rejected.json()).toHaveProperty('code', 'INVOICE_NOT_OPEN');
    const preview = await page.request.post('/api/email/preview', { data: { documentType: 'reminder', id: invoice.id } });
    expect(preview.status()).toBe(400);
    await page.goto('/dashboard/reminders');
    await expect(page.getByRole('main').getByText(number, { exact: false })).toHaveCount(0);
    expect(await snapshot(userId, invoice.id)).toEqual(after);
    await testInfo.attach('refund-liability-http-db-evidence.json', { body: Buffer.from(JSON.stringify({ basisId: basis.id, ledger, reminders, daily, original, after }, null, 2)), contentType: 'application/json' });
  } finally { await prisma.$disconnect(); }
});

test('refuses real fiscal outputs and rechecks a cached EÜR before any CSV download', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const userId = await isolatedAccount(page);
  try {
    const invoice = await createInvoice(page, 'ADJUSTMENT-FISCAL-120');
    const payment = await allocate(page, invoice.id, '120.00', '2025-06-15', '0');
    const initialSummary = page.waitForResponse(response => response.url().includes('/api/dashboard/summary?') && response.status() === 200);
    await page.goto('/dashboard?tab=eur');
    await initialSummary;
    const exportButton = page.getByRole('button', { name: 'CSV exportieren', exact: true });
    await expect(exportButton).toBeVisible();
    // Another real client writes while this tab deliberately retains its old
    // successful summary. No mocked fiscal response or synthetic cached total.
    const journal = await loadJournal(page, invoice.id);
    const correction = await page.request.post(`/api/invoices/${invoice.id}/payments/adjustments`, { data: {
      kind: 'PAYMENT_CORRECTION', originalPaymentId: payment.event.id, amount: '20.00', actionDate: '2026-03-03',
      reason: 'Synthetic missing receipt found in bank reconciliation', reference: 'Synthetic fiscal guard reconciliation',
      declarationNeverReceived: true, expectedLedgerVersion: journal.ledgerVersion, idempotencyKey: randomUUID(),
    } });
    expect(correction.status()).toBe(201);
    await expect(exportButton).toBeVisible();
    const downloads: string[] = [];
    page.on('download', download => downloads.push(download.suggestedFilename()));
    const freshGate = page.waitForResponse(response => response.url().includes('/api/dashboard/summary?') && response.request().method() === 'GET' && response.status() === 409);
    await exportButton.click();
    const guarded = await freshGate;
    expect(await guarded.json()).toMatchObject({ code: 'PAYMENT_ADJUSTMENTS_REVIEW_REQUIRED', fiscalMappingStatus: 'UNREVIEWED' });
    const error = page.getByRole('alert').filter({ hasText: 'Kein Export aus zwischengespeicherten Zahlen.' });
    await expect(error).toBeVisible();
    await expect(exportButton).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'EÜR-Übertragungshilfe öffnen', exact: true })).toHaveCount(0);
    expect(downloads).toEqual([]);
    const evidence: unknown[] = [];
    for (const path of ['/api/eur-export?year=2025&format=csv', '/api/eur-export?year=2026&format=json', '/api/tax-summary?year=2026&timeRange=thisYear', '/api/incomes', '/api/incomes/export']) {
      const response = await page.request.get(path);
      expect(response.status()).toBe(409);
      expect(response.headers()['content-disposition']).toBeUndefined();
      const body = await response.json();
      expect(body).toMatchObject({ code: 'PAYMENT_ADJUSTMENTS_REVIEW_REQUIRED', fiscalMappingStatus: 'UNREVIEWED' });
      expect(body.data).toBeUndefined();
      evidence.push({ path, status: response.status(), body });
    }
    await page.goto('/steuer-simulation');
    await expect(page.getByRole('alert').filter({ hasText: 'Steuerzuordnung und betroffene Vorperioden' })).toBeVisible();
    await expect(page.getByText('Nicht verfügbar / fachlich zu prüfen', { exact: true })).toBeVisible();
    await expect(page.getByText('Keine bestätigte steuerliche Datenbasis', { exact: true })).toBeVisible();
    expect(downloads).toEqual([]);
    // Neutral evidence remains reviewable under its exact current contract;
    // it must not be mistaken for the blocked fiscal calculation.
    await page.goto('/handoff?year=2026');
    const handoffResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/accountant-export' && new URL(response.url()).searchParams.get('preview') === '1');
    await page.getByRole('button', { name: 'Vorschau laden', exact: true }).click();
    const handoff = await handoffResponse; expect(handoff.status()).toBe(200);
    expect((await handoff.json()).manifest).toMatchObject({ formatVersion: 2, paymentContractVersion: 2, fiscalMappingStatus: 'UNREVIEWED', counts: { payments: 1, adjustments: 1 } });
    await expect(page.locator('#handoff-review-heading')).toBeFocused();
    await expect(page.getByText('Steuerlich nicht freigegeben', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ZIP herunterladen', exact: true })).toBeDisabled();
    expect(downloads).toEqual([]);
    const db = await snapshot(userId, invoice.id);
    expect(db.adjustments).toHaveLength(1);
    await testInfo.attach('adjustment-fiscal-fail-closed-evidence.json', { body: Buffer.from(JSON.stringify({ evidence, downloads, adjustmentId: db.adjustments[0].id }, null, 2)), contentType: 'application/json' });
  } finally { await prisma.$disconnect(); }
});

test('protects unsupported historical tax evidence from adjustment writes and leaves originals unchanged', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  expect((await page.request.get('/api/invoices/999999999/payments', { headers: { 'X-Bivaro-Payment-Contract': '2' } })).status()).toBe(401);
  const userId = await isolatedAccount(page);
  try {
    const number = 'ADJUSTMENT-UNSUPPORTED-120';
    const invoice = await createInvoice(page, number, { parsedData: { currency: 'EUR', taxMode: 'standard', grossAmount: 120, netAmount: 100.84, taxAmount: 19.16 } });
    const payment = await allocate(page, invoice.id, '120.00', '2025-06-15', '0');
    const original = await snapshot(userId, invoice.id);
    const beforePdf = await page.request.get(`/api/invoices/download?id=${invoice.id}&download=true`);
    expect(beforePdf.status()).toBe(200);
    const bytes = await beforePdf.body();
    const journal = await loadJournal(page, invoice.id);
    expect(journal.canRecordAdjustment).toBe(false);
    expect(journal.adjustmentReviewReason).toBeTruthy();
    await page.goto('/dashboard?tab=invoices');
    const dialog = await openJournal(page, number);
    const panel = dialog.getByRole('region', { name: 'Zahlung korrigieren oder Erstattung dokumentieren', exact: true });
    await expect(panel.getByRole('button', { name: 'Korrektur / Erstattung dokumentieren', exact: true })).toBeDisabled();
    await expect(panel.getByRole('status')).toContainText('Nur lesbar');
    await panel.getByText('Hinweise und Grenzen', { exact: true }).click();
    await expect(panel).toContainText(journal.adjustmentReviewReason!);
    const rejection = await page.request.post(`/api/invoices/${invoice.id}/payments/adjustments`, { data: {
      kind: 'PAYMENT_CORRECTION', originalPaymentId: payment.event.id, amount: '20.00', actionDate: '2026-03-03', reason: 'Synthetic unsupported adjustment attempt', reference: 'Synthetic no mutation proof',
      declarationNeverReceived: true, expectedLedgerVersion: journal.ledgerVersion, idempotencyKey: randomUUID(),
    } });
    expect(rejection.status()).toBe(409);
    const body = await rejection.json();
    expect(body.code).toBe('PAYMENT_REVIEW_REQUIRED');
    expect(await snapshot(userId, invoice.id)).toEqual(original);
    expect(await (await page.request.get(`/api/invoices/download?id=${invoice.id}&download=true`)).body()).toEqual(bytes);
    await testInfo.attach('unsupported-adjustment-no-mutation-evidence.json', { body: Buffer.from(JSON.stringify({ status: rejection.status(), body, original }, null, 2)), contentType: 'application/json' });
  } finally { await prisma.$disconnect(); }
});
