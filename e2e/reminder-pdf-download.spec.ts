import { expect, test, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from 'pdf-lib';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type ResponseWitness = { sha256: string; bytes: number; error?: string };
type ObservedWindow = Window & { __reminderPdfWitnesses?: Promise<ResponseWitness>[] };

async function observeNativePdfResponses(page: Page) {
  await page.addInitScript(() => {
    const observed = window as ObservedWindow;
    const witnesses: Promise<ResponseWitness>[] = [];
    observed.__reminderPdfWitnesses = witnesses;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await nativeFetch(...args);
      const url = new URL(response.url, window.location.href);
      if (url.origin === window.location.origin && url.pathname === '/api/reminders/download-pdf' && response.ok) {
        // Observe a clone of this exact real response. Never fulfill a route,
        // change the original response, or delay its return to the application.
        const witness = (async (): Promise<ResponseWitness> => {
          const bytes = await response.clone().arrayBuffer();
          const digest = await crypto.subtle.digest('SHA-256', bytes);
          return { bytes: bytes.byteLength, sha256: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') };
        })().catch(error => ({ bytes: 0, sha256: '', error: String(error) }));
        witnesses.push(witness);
      }
      return response;
    };
  });
}
async function account(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticReminderPdf47!';
  const user = await prisma.user.create({ data: { email: `reminder-pdf-${randomUUID()}@example.test`, name: 'Synthetic reminder PDF', password: await hashPassword(password), role: 'USER' } });
  await prisma.settings.create({ data: { userId: user.id, companyName: 'Synthetischer Mahnungsabsender' } });
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(user.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/u);
  return user.id;
}
async function payment(page: Page, invoiceId: number, amount: string, expectedPaidCents: string) {
  const response = await page.request.post(`/api/invoices/${invoiceId}/payments`, { data: { amount, expectedPaidCents, currency: 'EUR', paidAt: '2026-10-01', source: 'MANUAL', reference: 'Synthetic hosted fixture only, not a real payment', idempotencyKey: randomUUID() } });
  expect(response.status()).toBe(201);
}
async function snapshot(userId: string) {
  return {
    invoices: await prisma.invoice.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    incomes: await prisma.income.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    payments: await prisma.paymentJournalEvent.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    reminders: await prisma.reminder.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    outbox: await prisma.emailOutbox.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
  };
}
async function drawnText(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes), lines: string[] = [];
  for (const page of pdf.getPages()) {
    const contents = page.node.Contents();
    for (const reference of contents instanceof PDFArray ? contents.asArray() : [contents!]) {
      const stream = pdf.context.lookup(reference);
      if (!(stream instanceof PDFRawStream)) throw new Error('Expected actual PDF page content');
      const operators = Buffer.from(decodePDFRawStream(stream).decode()).toString('ascii');
      for (const text of operators.matchAll(/<([0-9A-F]+)> Tj/g)) lines.push(new TextDecoder('windows-1252').decode(Buffer.from(text[1], 'hex')));
    }
  }
  return { pdf, text: lines.join('\n') };
}

// No route is fulfilled/mocked. All writes below are deliberate setup in the
// runner's exact fresh synthetic fixture; downloads must not write or send.
for (const width of [1440, 390]) test(`real reminder PDF download, stale confirmation and settlement at ${width}px`, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width, height: 1000 });
  await observeNativePdfResponses(page);
  const userId = await account(page);
  const emailRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/email/')) emailRequests.push(request.url()); });
  try {
    const original = await PDFDocument.create(); original.addPage();
    const originalBytes = await original.save(), invoiceNumber = `SYNTHETIC-REMINDER-PDF-${width}`;
    const created = await page.request.post('/api/invoices', { data: { fileName: `${invoiceNumber}.pdf`, invoiceNumber, totalAmount: 120, invoiceDate: '2026-09-01', dueDate: '2026-09-15', parsedData: { currency: 'EUR' }, pdfBytes: Buffer.from(originalBytes).toString('base64') } });
    expect(created.status()).toBe(200);
    const invoice = await created.json() as { id: number };
    await payment(page, invoice.id, '40', '0');
    const before = await snapshot(userId);
    const originalDownload = await page.request.get(`/api/invoices/download?id=${invoice.id}&download=true`);
    expect(originalDownload.status()).toBe(200); expect(sha256(await originalDownload.body())).toBe(sha256(originalBytes));
    await page.goto('/dashboard/reminders');
    const record = page.getByRole(width < 1280 ? 'article' : 'row').filter({ hasText: invoiceNumber });
    await expect(record).toContainText('80,00');
    const trigger = record.getByRole('button', { name: 'Restbetrag prüfen', exact: true });
    await trigger.focus(); await page.keyboard.press('Enter');
    let dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Aktuellen Restbetrag prüfen und Entwurf laden', exact: true }).click();
    await expect(dialog.getByLabel('Geprüfter Zahlungsstand')).toContainText('80,00');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(await snapshot(userId)).toEqual(before); expect(emailRequests).toEqual([]);
    await page.reload();
    await trigger.click(); dialog = page.getByRole('dialog');
    const notes = width === 390 ? `${'Synthetischer Hinweis zur unveränderten Originalrechnung. '.repeat(65)}Ende des freigegebenen Hinweises.` : 'Synthetischer Hinweis zur unveränderten Originalrechnung.';
    await dialog.getByLabel('Hinweis im Entwurf (optional)').fill(notes);
    const previewResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/reminders/preview' && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Aktuellen Restbetrag prüfen und Entwurf laden', exact: true }).click();
    const preview = await (await previewResponse).json() as { balanceVersion: string; documentVersion: string; previewAsOf: string; text: string };
    const pdfButton = dialog.getByRole('button', { name: 'PDF-Entwurf herunterladen', exact: true });
    await expect(pdfButton).toBeDisabled();
    for (const value of ['120,00', '40,00', '80,00']) await expect(dialog.getByLabel('Geprüfter Zahlungsstand')).toContainText(value);
    await expect(dialog.getByRole('button', { name: 'Im E-Mail-Client öffnen', exact: true })).toHaveCount(0);
    const evidence = testInfo.outputPath(`reminder-pdf-evidence-${width}`); await mkdir(evidence, { recursive: true });
    await dialog.getByLabel('Geprüfter Zahlungsstand').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidence, 'review.png'), fullPage: false });
    const checkbox = dialog.getByRole('checkbox');
    await checkbox.focus(); await page.keyboard.press('Space'); await expect(checkbox).toBeChecked();
    await pdfButton.scrollIntoViewIfNeeded(); await expect(pdfButton).toBeInViewport();
    await page.screenshot({ path: path.join(evidence, 'actions.png'), fullPage: false });
    const downloadEvent = page.waitForEvent('download');
    const pdfResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/reminders/download-pdf' && response.request().method() === 'POST');
    await pdfButton.focus(); await page.keyboard.press('Enter');
    const download = await downloadEvent, response = await pdfResponse;
    expect(response.status()).toBe(200); expect(download.suggestedFilename()).toBe(`mahnentwurf-${invoice.id}.pdf`);
    const downloadedPath = await download.path(); expect(downloadedPath).not.toBeNull();
    const downloadedBytes = await readFile(downloadedPath!), parsed = await drawnText(downloadedBytes);
    // Playwright's protocol Response.body() may be empty for this browser blob
    // flow. Compare against a passive clone of the same native fetch instead.
    const witnesses = await page.evaluate(async () => Promise.all((window as ObservedWindow).__reminderPdfWitnesses ?? []));
    expect(witnesses).toHaveLength(1);
    const witness = witnesses[0];
    expect(witness.error).toBeUndefined(); expect(witness.bytes).toBeGreaterThan(0);
    expect(witness.bytes).toBe(downloadedBytes.byteLength);
    expect(sha256(downloadedBytes)).toBe(witness.sha256);
    for (const value of ['Rechnungsbetrag: 120,00 €', 'Bereits eingegangen: 40,00 €', 'Offener Restbetrag: 80,00 €', 'Zahlbetrag: 80,00 €', preview.previewAsOf, preview.documentVersion, 'keine neue Rechnung, kein Versandnachweis']) expect(parsed.text).toContain(value);
    if (width === 390) expect(parsed.pdf.getPageCount()).toBeGreaterThan(1);
    expect(parsed.pdf.getPageCount()).toBeLessThanOrEqual(8);
    await expect(dialog.getByRole('status')).toContainText('Keine Nachricht versendet');
    expect(await snapshot(userId)).toEqual(before); expect(emailRequests).toEqual([]);
    const unchanged = await page.request.get(`/api/invoices/download?id=${invoice.id}&download=true`);
    expect(sha256(await unchanged.body())).toBe(sha256(originalBytes));
    await writeFile(path.join(evidence, 'reminder.pdf'), downloadedBytes);
    const expired = await page.request.post('/api/reminders/download-pdf', { data: { ...response.request().postDataJSON(), previewAsOf: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() } });
    expect(expired.status()).toBe(409); expect((await expired.json()).code).toBe('REMINDER_PREVIEW_EXPIRED');
    await payment(page, invoice.id, '10', '4000');
    const afterPayment = await snapshot(userId);
    const stale = page.waitForResponse(result => new URL(result.url()).pathname === '/api/reminders/download-pdf' && result.request().method() === 'POST');
    await pdfButton.click(); expect((await stale).status()).toBe(409);
    const staleAlert = dialog.getByRole('alert').filter({ hasText: 'Zahlungsstand hat sich geändert' });
    await expect(staleAlert).toHaveCount(1); await expect(staleAlert).toBeVisible();
    await expect(dialog.getByRole('region', { name: 'Geprüfter Mahnentwurf', exact: true })).toHaveCount(0); await expect(pdfButton).toBeDisabled();
    expect(await snapshot(userId)).toEqual(afterPayment);
    await dialog.getByRole('button', { name: 'Aktuellen Restbetrag prüfen und Entwurf laden', exact: true }).click();
    await expect(dialog.getByLabel('Geprüfter Zahlungsstand')).toContainText('70,00');
    await dialog.getByRole('checkbox').check();
    const current = page.waitForEvent('download'); await pdfButton.click();
    const currentPath = await (await current).path(); expect(currentPath).not.toBeNull();
    expect((await drawnText(await readFile(currentPath!))).text).toContain('Zahlbetrag: 70,00 €');
    expect(await snapshot(userId)).toEqual(afterPayment);
    await payment(page, invoice.id, '70', '5000');
    const settled = await snapshot(userId);
    const closed = page.waitForResponse(result => new URL(result.url()).pathname === '/api/reminders/download-pdf' && result.request().method() === 'POST');
    await pdfButton.click(); expect((await closed).status()).toBe(409); await expect(pdfButton).toBeDisabled();
    expect(await snapshot(userId)).toEqual(settled); expect(emailRequests).toEqual([]);
    await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click(); await page.reload();
    await expect(page.getByRole(width < 1280 ? 'article' : 'row').filter({ hasText: invoiceNumber })).toHaveCount(0);
    expect(settled.reminders).toEqual([]); expect(settled.outbox).toEqual([]);
    const finalOriginal = await page.request.get(`/api/invoices/download?id=${invoice.id}&download=true`);
    expect(finalOriginal.status()).toBe(200);
    const finalOriginalSha256 = sha256(await finalOriginal.body());
    expect(finalOriginalSha256).toBe(sha256(originalBytes));
    await writeFile(path.join(evidence, 'manifest.json'), JSON.stringify({ version: 1, status: 'passed', width, pages: parsed.pdf.getPageCount(), pdfSha256: sha256(downloadedBytes), responseSha256: witness.sha256, responseBytes: witness.bytes, originalSha256: sha256(originalBytes), originalAfterSha256: finalOriginalSha256, previewAsOf: preview.previewAsOf, documentVersion: preview.documentVersion, balance: { totalCents: '12000', paidCents: '4000', openCents: '8000' }, downloadsChangedFinancialState: false, emailRequests, correctionAwareReminders: false, note: 'Synthetic fixture only; actual download bytes match a passive clone of the exact native HTTP response. No original-PDF/PDF-A or delivery claim. Rendered-page visual review remains separate.' }, null, 2));
  } finally { await prisma.$disconnect(); }
});
