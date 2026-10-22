import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, rgb } from 'pdf-lib';
import { createHash, randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';

// Dedicated production-derived container only. No route interception, provider
// library mock, renderer substitute, unconfined fallback or real credential.
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const colors = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0]] as const;
async function receipt(pages: number, blank = false) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pages; index++) {
    const page = pdf.addPage([360, 400]);
    if (!blank) {
      page.drawText(`SYNTHETIC PDF PAGE ${index + 1}`, { x: 30, y: 360, size: 14 });
      const color = colors[index % colors.length];
      page.drawRectangle({ x: 40, y: 140, width: 280, height: 120, color: rgb(color[0], color[1], color[2]) });
      page.drawText('Original must remain unchanged', { x: 30, y: 60, size: 12 });
    }
  }
  return Buffer.from(await pdf.save());
}
async function upload(page: Page, bytes: Buffer, name: string) {
  const response = await page.request.post('/api/purchase-documents', { multipart: {
    file: { name, mimeType: 'application/pdf', buffer: bytes }, uploadRequestId: randomUUID(), analysisMode: 'manual',
  } });
  expect(response.status()).toBe(201);
  const { document } = await response.json();
  expect(document.originalRef.sha256).toBe(digest(bytes));
  return document;
}
async function original(page: Page, id: number) {
  const response = await page.request.get(`/api/purchase-documents/${id}/original`);
  expect(response.status()).toBe(200); return response.body();
}
async function startAnalysis(page: Page, id: number) {
  await page.goto(`/purchases?document=${id}`);
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Optionales KI-Auslesen', { exact: true }).click();
  const consent = dialog.getByLabel('Übermittlung und mögliche Kosten für diese Analyse freigeben.', { exact: true });
  const button = dialog.getByRole('button', { name: 'Diesen Beleg mit KI auslesen', exact: true });
  await expect(consent).not.toBeChecked(); await expect(button).toBeDisabled();
  await consent.check();
  const completed = page.waitForResponse(response => response.url().endsWith(`/api/purchase-documents/${id}/ai-extraction`) && response.request().method() === 'POST');
  await button.click();
  const response = await completed; expect(response.status()).toBe(200);
  return { dialog, result: await response.json() };
}

test('real PDF AI consent, ordered complete pages, fail-closed limits and preserved original', async ({ page }) => {
  expect(process.env.BIVARO_AI_BROWSER_FIXTURE).toBe('1');
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const password = 'SyntheticNativeAiBrowser123!';
  const user = await prisma.user.create({ data: { email: `ai-native-${randomUUID()}@example.test`, name: 'Synthetic native PDF user', password: await hashPassword(password), role: 'ADMIN' } });
  try {
    await page.goto('/login'); await page.getByLabel('E-Mail').fill(user.email);
    await page.getByLabel('Passwort', { exact: true }).fill(password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    const settingsResponse = await page.request.put('/api/settings/ai-provider', { data: {
      expectedVersion: 0, enabled: true, autoAnalyzeNewUploads: false,
      baseUrl: 'http://127.0.0.1:3200/v1', model: 'synthetic-browser-vision',
      keyAction: 'replace', apiKey: 'synthetic-ai-browser-key-not-a-real-credential',
    } });
    expect(settingsResponse.status()).toBe(200);
    const settings = await settingsResponse.json(); expect(settings.configured).toBe(true);
    const stats = async () => (await page.request.get('http://127.0.0.1:3200/stats')).json();
    expect((await stats()).calls).toBe(0);
    const bytes = await receipt(4), sourceHash = digest(bytes);
    const document = await upload(page, bytes, 'synthetic-four-complete-pages.pdf');
    expect(digest(await original(page, document.id))).toBe(sourceHash);
    const noConsent = await page.request.post(`/api/purchase-documents/${document.id}/ai-extraction`, { data: {
      expectedRevision: document.revision, expectedConfigVersion: settings.version,
      expectedConfigRevision: settings.configurationRevision, acknowledgeCost: false,
    } });
    expect(noConsent.status()).toBe(400); expect((await stats()).calls).toBe(0);
    const { dialog, result } = await startAnalysis(page, document.id);
    expect(result.extraction.status).toBe('completed');
    expect(result.extraction.sourceSha256).toBe(sourceHash);
    await expect(dialog.getByText('KI-Vorschläge ausgelesen · nicht gebucht', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Zahlungsdatum', { exact: true })).toHaveValue('');
    const sent = await stats(); expect(sent.calls).toBe(1); expect(sent.imageCounts).toEqual([4]);
    expect(sent.centers[0]).toHaveLength(4);
    // Distinct center colors independently identify the original page order,
    // rather than accepting four duplicated or reordered JPEG data URLs.
    for (const [index, color] of colors.entries()) for (let channel = 0; channel < 3; channel++) {
      expect(Math.abs(sent.centers[0][index][channel] - color[channel] * 255)).toBeLessThanOrEqual(12);
    }
    expect(digest(await original(page, document.id))).toBe(sourceHash);
    await page.reload();
    await expect(page.getByRole('dialog').getByText('KI-Vorschläge ausgelesen · nicht gebucht', { exact: true })).toBeVisible();
    expect((await stats()).calls).toBe(1); // Reload never re-sends a paid request.
    for (const [name, rejected, code] of [
      ['five', await receipt(5), 'AI_PDF_LIMIT'], ['blank', await receipt(1, true), 'AI_RENDER_FAILED'],
    ] as const) {
      const source = await upload(page, rejected, `synthetic-${name}.pdf`);
      const failure = await startAnalysis(page, source.id);
      expect(failure.result.extraction.status).toBe('failed'); expect(failure.result.extraction.errorCode).toBe(code);
      await expect(failure.dialog.getByText('KI-Analyse fehlgeschlagen', { exact: true })).toBeVisible();
      expect((await stats()).calls).toBe(1); expect(digest(await original(page, source.id))).toBe(digest(rejected));
    }
    expect(await prisma.expense.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.income.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.cashTransaction.count({ where: { userId: user.id } })).toBe(0);
  } finally { await prisma.$disconnect(); }
});
