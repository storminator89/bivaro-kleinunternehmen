import { expect, test } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import JSZip from 'jszip';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';

// Hosted acceptance only uses a fresh runner-owned fixture and synthetic data.
// Never point this test at a user's database or a production account.
test('mobile photo intake, retry, explicit draft, reload, search return and full-original export stay unposted', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const password = 'SyntheticPhotoDraft123!';
  const email = `photo-draft-${randomUUID()}@example.test`;
  const user = await prisma.user.create({ data: { email, name: 'Synthetic photo review', password: await hashPassword(password), role: 'USER' } });
  const photo = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="780" height="1120"><rect width="780" height="1120" fill="#faf6ed"/><g fill="#20372b" font-family="sans-serif"><text x="60" y="110" font-size="40">SYNTHETISCHER BELEG</text><text x="60" y="180" font-size="28">Foto Lieferant · PHOTO-17</text><text x="60" y="250" font-size="28">20.10.2026</text><text x="60" y="360" font-size="48">119,00 EUR</text><text x="60" y="450" font-size="24">Kein echter Geschäftsvorfall.</text></g></svg>')).png().toBuffer();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(email);
    await page.getByLabel('Passwort', { exact: true }).fill(password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/purchases');
    const uploadRegion = page.locator('section[aria-labelledby="incoming-upload-heading"]');
    await expect(page.getByRole('button', { name: 'Foto aufnehmen', exact: true })).toBeVisible();
    const input = page.getByLabel('Foto, PDF- oder XML-Original auswählen', { exact: true });
    await input.setInputFiles({ name: 'too-large.png', mimeType: 'image/png', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
    await expect(uploadRegion.getByRole('alert')).toContainText('10 MB');
    await input.setInputFiles({ name: 'synthetic-mobile.png', mimeType: 'image/png', buffer: photo });
    let interrupted = false;
    await page.route('**/api/purchase-documents', async route => {
      if (route.request().method() === 'POST' && !interrupted) { interrupted = true; await route.abort('failed'); }
      else await route.continue();
    });
    await page.getByRole('button', { name: 'Original hochladen', exact: true }).click();
    await expect(uploadRegion.getByRole('alert')).toContainText('Verbindung');
    expect(await prisma.purchaseDocument.count({ where: { userId: user.id } })).toBe(0);
    await page.getByRole('button', { name: 'Original hochladen', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Eingangsbeleg prüfen', exact: true })).toBeVisible();
    await expect(dialog.getByRole('img', { name: /Unverändertes Foto-Original/ })).toBeVisible();
    await dialog.getByRole('button', { name: 'Foto vergrößern', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog.getByText('150%', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Foto verkleinern', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Prüfentwurf · nicht gebucht', exact: true })).toBeVisible();
    await dialog.getByLabel('Lieferant laut eigener Prüfung', { exact: true }).fill('Foto Lieferant');
    await dialog.getByLabel('Rechnungsnummer im Entwurf', { exact: true }).fill('PHOTO-17');
    await dialog.getByLabel('Rechnungsdatum im Entwurf', { exact: true }).fill('2026-10-20');
    await dialog.getByLabel('Tatsächliches Zahlungsdatum im Entwurf', { exact: true }).fill('2026-10-21');
    await dialog.getByLabel('Bruttobetrag im Entwurf (EUR)', { exact: true }).fill('119,00');
    await dialog.getByLabel('Prüfnotiz', { exact: true }).fill('Mobil geprüft; Entwurf, noch keine Ausgabe.');
    await expect(dialog.getByText('Ungespeicherte Änderungen', { exact: true })).toBeVisible();
    page.once('dialog', prompt => prompt.dismiss());
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    expect((await prisma.purchaseDocument.findFirstOrThrow({ where: { userId: user.id } })).reviewDraft).toBeNull();
    await dialog.getByRole('button', { name: 'Prüfentwurf speichern', exact: true }).click();
    await expect(dialog.getByText('Prüfentwurf gespeichert · nicht gebucht', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Als Ausgabe erfassen', exact: true })).toBeDisabled();
    const source = await prisma.purchaseDocument.findFirstOrThrow({ where: { userId: user.id } });
    expect(source).toMatchObject({ reviewStatus: 'REVIEW', expenseId: null, parseErrorCode: 'PHOTO_MANUAL_REVIEW', reviewDraft: { amount: '119.00', paymentDate: '2026-10-21' } });
    await page.reload();
    await expect(dialog.getByLabel('Lieferant laut eigener Prüfung', { exact: true })).toHaveValue('Foto Lieferant');
    await expect(dialog.getByLabel('Bruttobetrag im Entwurf (EUR)', { exact: true })).toHaveValue('119.00');
    // Interrupted dismissal: the already-open confirmation must freeze draft edits/save.
    await dialog.getByRole('button', { name: 'Beleg verwerfen', exact: true }).click();
    await expect(dialog.getByLabel('Prüfnotiz', { exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Prüfentwurf speichern', exact: true })).toBeDisabled();
    await expect(dialog.getByText(/Entwurf vorübergehend gesperrt:/)).toBeVisible();
    await dialog.getByLabel('Warum wird dieser Beleg verworfen?', { exact: true }).fill('Synthetic interrupted confirmation');
    await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await expect(dialog.getByLabel('Prüfnotiz', { exact: true })).toBeEnabled();
    const updatedNote = 'Mobil geprüft; Entwurf, noch keine Ausgabe. Unterbrechung geprüft.';
    await dialog.getByLabel('Prüfnotiz', { exact: true }).fill(updatedNote);
    let releaseSave!: () => void;
    let enteredSave!: () => void;
    const saveStarted = new Promise<void>(resolve => { enteredSave = resolve; });
    const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
    await page.route('**/review-draft', async route => { enteredSave(); await saveGate; await route.continue(); }, { times: 1 });
    await dialog.getByRole('button', { name: 'Prüfentwurf speichern', exact: true }).click();
    await saveStarted;
    try {
      await expect(dialog.getByRole('button', { name: 'Beleg verwerfen', exact: true })).toBeDisabled();
      expect((await prisma.purchaseDocument.findUniqueOrThrow({ where: { id: source.id } })).reviewStatus).toBe('REVIEW');
    } finally { releaseSave(); }
    await expect(dialog.getByText('Prüfentwurf gespeichert · nicht gebucht', { exact: true })).toBeVisible();
    expect((await prisma.purchaseDocument.findUniqueOrThrow({ where: { id: source.id } })).reviewDraft).toMatchObject({ note: updatedNote });
    await dialog.getByRole('button', { name: 'Beleg verwerfen', exact: true }).click();
    await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await expect(dialog.getByLabel('Prüfnotiz', { exact: true })).toHaveValue(updatedNote);
    await dialog.getByRole('heading', { name: 'Prüfentwurf · nicht gebucht', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('receipt-draft-mobile.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await page.getByLabel('Lieferant, Rechnungsnummer oder Dateiname', { exact: true }).fill('Foto Lieferant');
    await page.getByRole('button', { name: 'Belege suchen', exact: true }).click();
    const row = page.getByRole('list', { name: 'Eingangsbelege', exact: true }).getByRole('button');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Prüfentwurf gespeichert');
    await row.click();
    await expect(dialog.getByLabel('Prüfnotiz', { exact: true })).toHaveValue(updatedNote);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await dialog.getByRole('heading', { name: 'Eingangsbeleg prüfen', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('receipt-draft-desktop.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/search=Foto\+Lieferant/);
    await expect(page.getByLabel('Lieferant, Rechnungsnummer oder Dateiname', { exact: true })).toHaveValue('Foto Lieferant');
    const original = await page.request.get(`/api/purchase-documents/${source.id}/original`);
    expect(original.status()).toBe(200); expect(original.headers()['cache-control']).toBe('private, no-store');
    expect(createHash('sha256').update(await original.body()).digest('hex')).toBe(createHash('sha256').update(photo).digest('hex'));
    const archiveResponse = await page.request.get('/api/backup/full'); expect(archiveResponse.status()).toBe(200);
    const archive = await JSZip.loadAsync(await archiveResponse.body());
    const backup = JSON.parse(await archive.file('backup.json')!.async('string'));
    const document = backup.data.purchaseDocuments.find((candidate: { id: number }) => candidate.id === source.id);
    expect(document.reviewDraft).toMatchObject({ supplierName: 'Foto Lieferant', amount: '119.00' });
    const entry = backup.manifest.fileManifest.find((candidate: { kind: string; sourceName: string }) => candidate.kind === 'purchase-document' && candidate.sourceName === document.storedFileName);
    expect(await archive.file(entry.zipPath)!.async('nodebuffer')).toEqual(photo);
    expect(await prisma.purchaseDocument.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.expense.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.income.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.cashTransaction.count({ where: { userId: user.id } })).toBe(0);
  } finally {
    // Runner removes the isolated fixture and private files; do not delete ledger/audit evidence here.
    await prisma.$disconnect();
  }
});
