import { expect, test, type Page, type Response } from '@playwright/test';
import { constants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import QRCode from 'qrcode';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString } from 'pdf-lib';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { calculateInvoiceAmounts } from '../lib/invoice-calculation';
import { ownInvoiceToZugferdData, parseOwnInvoiceSource } from '../lib/own-invoice-source';
import { generateZugferdXml } from '../lib/zugferd-generator';
import { normalizeOwnInvoiceImage } from '../lib/server/own-invoice-image';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// Run ONLY through npm run test:e2e. General browser runs may skip this native
// gate; release acceptance must enable it explicitly and may not count a skip.
// No render/upload route is mocked. Missing native prerequisites fail when
// enabled. A real final 200 also requires the server's exact-byte pinned
// official veraPDF gate; the test then proves download/storage byte identity.
const nativeSuite = process.env.BIVARO_RUN_OWN_INVOICE_PDFA_BROWSER === '1' ? test.describe : test.describe.skip;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function account(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticFinalBytes117!';
  const user = await prisma.user.create({ data: {
    email: `own-invoice-bytes-${randomUUID()}@example.test`, name: 'Synthetic final bytes issuer',
    role: 'USER', password: await hashPassword(password),
  } });
  await prisma.settings.create({ data: {
    userId: user.id, companyName: 'Synthetic browser issuer', companyAddress: 'Synthetic Road 1\n10115 Berlin',
    email: 'issuer@example.test', telephone: '+49 000 000', taxNumber: '123/456/78901',
    iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', bankName: 'Synthetic bank',
    footerText: 'Synthetic browser acceptance only', fiscalTaxRegime: 'STANDARD',
    fiscalEffectiveFrom: '2020-01-01', fiscalConfirmedAt: new Date('2026-10-01T12:00:00Z'),
  } });
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(user.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/u);
  return user.id;
}

async function financialSnapshot(userId: string) {
  return {
    invoices: await prisma.invoice.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    counters: await prisma.invoiceNumberCounter.findMany({ where: { userId }, orderBy: [{ type: 'asc' }, { year: 'asc' }] }),
    incomes: await prisma.income.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    expenses: await prisma.expense.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    payments: await prisma.paymentJournalEvent.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    cash: await prisma.cashTransaction.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    outbox: await prisma.emailOutbox.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
  };
}

function isRender(response: Response, preview: boolean, invoiceNumber: string): boolean {
  if (new URL(response.url()).pathname !== '/api/invoices/render' || response.request().method() !== 'POST') return false;
  const body = response.request().postDataJSON() as { preview?: unknown; source?: { invoiceNumber?: unknown } };
  return body.preview === preview && body.source?.invoiceNumber === invoiceNumber;
}

function rawStream(value: unknown): PDFRawStream {
  expect(value).toBeInstanceOf(PDFRawStream);
  if (!(value instanceof PDFRawStream)) throw new Error('Expected a serialized PDF stream.');
  return value;
}

function pageContent(pdf: PDFDocument): string[][] {
  return pdf.getPages().map(page => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray
      ? contents.asArray().map(ref => rawStream(pdf.context.lookup(ref)))
      : contents instanceof PDFRawStream ? [contents] : [];
    expect(streams.length).toBeGreaterThan(0);
    return streams.map(stream => Buffer.from(decodePDFRawStream(stream).decode()).toString('base64'));
  });
}

function embeddedXml(pdf: PDFDocument): string {
  const files = pdf.catalog.lookup(PDFName.of('AF'), PDFArray);
  expect(files.size()).toBe(1);
  const file = files.lookup(0, PDFDict);
  expect(file.lookup(PDFName.of('AFRelationship'), PDFName).toString()).toBe('/Alternative');
  expect(file.lookup(PDFName.of('F'), PDFString).decodeText()).toBe('factur-x.xml');
  const bytes = rawStream(file.lookup(PDFName.of('EF'), PDFDict).lookup(PDFName.of('F')));
  return new TextDecoder().decode(decodePDFRawStream(bytes).decode());
}

function jpegHashes(pdf: PDFDocument): string[] {
  return pdf.context.enumerateIndirectObjects().map(([, value]) => value).filter((value): value is PDFRawStream => (
    value instanceof PDFRawStream
    && value.dict.lookupMaybe(PDFName.of('Subtype'), PDFName)?.toString() === '/Image'
    && value.dict.lookupMaybe(PDFName.of('Filter'), PDFName)?.toString() === '/DCTDecode'
  )).map(value => sha256(value.getContents())).sort();
}

nativeSuite('real standalone own-invoice final bytes', () => {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000, multipage: false },
    { name: 'mobile', width: 390, height: 844, multipage: true },
  ]) {
    test(`${viewport.name}: real preview, transparent logo, GiroCode and stored download`, async ({ page }, testInfo) => {
      test.setTimeout(180_000);
      const verifier = process.env.BIVARO_VERAPDF_BIN ?? '/opt/verapdf/verapdf';
      expect(process.platform).toBe('linux');
      expect(path.isAbsolute(verifier)).toBe(true);
      await access(verifier, constants.X_OK);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const userId = await account(page);
      const alerts: string[] = [];
      const foreignConversionRequests: string[] = [];
      page.on('dialog', async dialog => { alerts.push(dialog.message()); await dialog.dismiss(); });
      page.on('request', request => {
        if (new URL(request.url()).pathname === '/api/pdfa3') foreignConversionRequests.push(request.method());
      });

      try {
        const logo = await sharp({ create: {
          width: 96, height: 48, channels: 4, background: { r: 30, g: 90, b: 150, alpha: 0.5 },
        } }).png().toBuffer();
        const uploadedLogo = await page.request.post('/api/settings/upload-logo', {
          headers: { Origin: new URL(page.url()).origin },
          multipart: { file: { name: `synthetic-alpha-${randomUUID()}.png`, mimeType: 'image/png', buffer: logo } },
        });
        expect(uploadedLogo.status()).toBe(200);
        const { url: logoUrl } = await uploadedLogo.json() as { url: string };
        expect(logoUrl).toMatch(/^\/api\/files\/logo\?file=/u);
        await prisma.settings.update({ where: { userId }, data: { logoUrl } });
        const originalLogo = await page.request.get(logoUrl);
        expect(originalLogo.status()).toBe(200);
        expect(sha256(await originalLogo.body())).toBe(sha256(logo));

        const defaultNumber = page.waitForResponse(response => new URL(response.url()).pathname === '/api/invoices/next-number');
        await page.goto('/dashboard/invoices/new');
        expect((await defaultNumber).status()).toBe(200);
        await expect(page.getByRole('heading', { name: 'Neue Rechnung', exact: true })).toBeVisible();
        const fields = page.locator('fieldset[aria-label="Rechnungsangaben"]');
        const invoiceNumber = `WEB117-${viewport.name}-${randomUUID().slice(0, 8)}`;
        await fields.locator('#customer').fill('Synthetic browser buyer\nBuyer Road 2\n10115 Berlin');
        await fields.locator('#invoice-number').fill(invoiceNumber);
        await fields.locator('#date').fill('2026-10-22');
        await fields.locator('#due-date').fill('2026-11-05');
        await fields.locator('#delivery-date').fill('2026-10-21');
        await fields.locator('#invoice-buyer-email').fill('buyer@example.test');
        await fields.locator('#invoice-buyer-reference').fill('SYNTHETIC-BROWSER-117');
        await expect(fields.getByRole('button', { name: 'PDF erstellen', exact: true })).toBeEnabled();
        await fields.locator('#invoice-item-description-0').fill('Synthetic standard service: Ä Ö Ü ß and €');
        await fields.locator('#invoice-item-quantity-0').fill('0.333');
        await fields.locator('#invoice-item-unit-0').selectOption('Stunde');
        await fields.locator('#invoice-item-price-0').fill('100.1234');
        await fields.locator('#invoice-item-tax-0').fill('19');
        await fields.getByRole('button', { name: 'Position hinzufügen', exact: true }).click();
        await fields.locator('#invoice-item-description-1').fill('Synthetic reduced-rate service');
        await fields.locator('#invoice-item-quantity-1').fill('3');
        await fields.locator('#invoice-item-unit-1').selectOption('Stück');
        await fields.locator('#invoice-item-price-1').fill('25.55');
        await fields.locator('#invoice-item-tax-1').fill('7');
        const notes = viewport.multipage
          ? Array.from({ length: 45 }, (_, i) => `Synthetic continuation ${String(i + 1).padStart(2, '0')}: complete readable notes with Ä Ö Ü ß and €.`).join('\n')
          : 'Synthetic browser note: Ä Ö Ü ß and €; originals stay unchanged.';
        await fields.locator('#notes').fill(notes);
        await fields.locator('#includeQRCode').check();
        await fields.locator('#invoice-output-mode').selectOption('zugferd-pdf');
        const beforePreview = await financialSnapshot(userId);
        const beforeCustomers = await prisma.customer.count({ where: { userId } });

        const previewResponsePromise = page.waitForResponse(response => isRender(response, true, invoiceNumber), { timeout: 60_000 });
        await page.getByRole('button', { name: 'Live-Vorschau', exact: true }).click();
        const previewResponse = await previewResponsePromise;
        expect(previewResponse.status(), previewResponse.ok() ? '' : await previewResponse.text()).toBe(200);
        const previewBytes = await previewResponse.body();
        await expect(page.locator('iframe[title="Rechnungsvorschau"]')).toHaveAttribute('src', /^blob:/u);
        expect(await financialSnapshot(userId)).toEqual(beforePreview);
        expect(await prisma.customer.count({ where: { userId } })).toBe(beforeCustomers);

        const finalResponsePromise = page.waitForResponse(response => isRender(response, false, invoiceNumber), { timeout: 90_000 });
        const uploadResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/invoices/upload' && response.request().method() === 'POST', { timeout: 100_000 });
        const downloadPromise = page.waitForEvent('download', { timeout: 110_000 });
        // Ensure a terminal server failure does not leave unhandled promises;
        // assertions below still fail instead of accepting a missing upload.
        void uploadResponsePromise.catch(() => undefined);
        void downloadPromise.catch(() => undefined);
        await fields.getByRole('button', { name: 'PDF erstellen', exact: true }).click();
        const finalResponse = await finalResponsePromise;
        expect(finalResponse.status(), finalResponse.ok() ? '' : await finalResponse.text()).toBe(200);
        const finalBytes = await finalResponse.body();
        const source = parseOwnInvoiceSource(finalResponse.request().postDataJSON().source);
        expect(source).toEqual(parseOwnInvoiceSource(previewResponse.request().postDataJSON().source));
        expect(source.invoiceNumber).toBe(invoiceNumber);
        expect(source.date).toBe('2026-10-22');
        expect(source.dueDate).toBe('2026-11-05');
        expect(source.notes).toBe(notes);
        expect(source.includeQRCode).toBe(true);
        expect(calculateInvoiceAmounts(source.items).grossAmount).toBe(121.69);
        const uploadResponse = await uploadResponsePromise;
        expect(uploadResponse.status(), uploadResponse.ok() ? '' : await uploadResponse.text()).toBe(200);
        const saved = await uploadResponse.json() as { id: number; idempotent?: boolean };
        expect(Number.isSafeInteger(saved.id)).toBe(true);
        expect(saved.idempotent).not.toBe(true);
        const download = await downloadPromise;
        expect(await download.failure()).toBeNull();
        expect(download.suggestedFilename()).toBe(`Rechnung_${invoiceNumber}.pdf`);
        const downloadPath = await download.path();
        expect(downloadPath).not.toBeNull();
        const downloadedBytes = await readFile(downloadPath!);
        const stored = await page.request.get(`/api/invoices/download?id=${saved.id}&download=true`);
        expect(stored.status()).toBe(200);
        const storedBytes = await stored.body();
        expect(downloadedBytes.equals(finalBytes)).toBe(true);
        expect(storedBytes.equals(finalBytes)).toBe(true);

        const previewPdf = await PDFDocument.load(previewBytes), finalPdf = await PDFDocument.load(finalBytes);
        expect(pageContent(previewPdf)).toEqual(pageContent(finalPdf));
        expect(jpegHashes(previewPdf)).toEqual(jpegHashes(finalPdf));
        expect(embeddedXml(finalPdf)).toBe(generateZugferdXml(ownInvoiceToZugferdData(source), { profile: 'factur-x' }));
        if (viewport.multipage) expect(finalPdf.getPageCount()).toBeGreaterThan(1);
        const normalizedLogo = await normalizeOwnInvoiceImage(logo);
        expect(jpegHashes(finalPdf)).toContain(sha256(normalizedLogo.bytes));
        const qr = await QRCode.toBuffer([
          'BCD', '002', '1', 'SCT', source.settings.bic, source.settings.companyName,
          source.settings.iban.replace(/\s/g, '').toUpperCase(), 'EUR121.69', '', '', invoiceNumber,
        ].join('\n'), { errorCorrectionLevel: 'M', type: 'png', margin: 4 });
        const normalizedQr = await normalizeOwnInvoiceImage(qr);
        expect(jpegHashes(finalPdf)).toContain(sha256(normalizedQr.bytes));
        const unchangedLogo = await page.request.get(logoUrl);
        expect(unchangedLogo.status()).toBe(200);
        expect(sha256(await unchangedLogo.body())).toBe(sha256(logo));
        const after = await financialSnapshot(userId);
        expect(after.invoices).toHaveLength(1);
        expect(after.invoices[0].id).toBe(saved.id);
        expect(after.invoices[0].invoiceNumber).toBe(invoiceNumber);
        expect(after.invoices[0].status).toBe('DRAFT');
        expect(after.invoices[0].issuanceState).toBe('UNKNOWN');
        const paymentTermSelection = (after.invoices[0].parsedData as Record<string, unknown>).paymentTermSelection;
        expect(paymentTermSelection).toEqual({
          version: 1, source: 'MANUAL', days: null, invoiceDate: '2026-10-22', dueDate: '2026-11-05', customerId: null,
        });
        expect({ ...after, invoices: [] }).toEqual({ ...beforePreview, invoices: [] });
        expect(alerts).toEqual([]);
        expect(foreignConversionRequests).toEqual([]);

        const directory = process.env.BIVARO_OWN_INVOICE_BROWSER_EVIDENCE_DIR
          ? path.join(process.env.BIVARO_OWN_INVOICE_BROWSER_EVIDENCE_DIR, viewport.name)
          : testInfo.outputPath('own-invoice-final-bytes');
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, 'preview.pdf'), previewBytes);
        await writeFile(path.join(directory, 'final.pdf'), finalBytes);
        await writeFile(path.join(directory, 'factur-x.xml'), embeddedXml(finalPdf));
        await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({
          status: 'passed', viewport, pages: finalPdf.getPageCount(), source, paymentTermSelection,
          previewSha256: sha256(previewBytes), finalSha256: sha256(finalBytes),
          downloadedSha256: sha256(downloadedBytes), storedSha256: sha256(storedBytes),
          originalLogoSha256: sha256(logo), normalizedLogoSha256: sha256(normalizedLogo.bytes), normalizedQrSha256: sha256(normalizedQr.bytes),
          note: 'Real standalone endpoint required its pinned official veraPDF final-byte gate. Pixel review of these retained pages is a separate release check.',
        }, null, 2));
      } finally { await prisma.$disconnect(); }
    });
  }
});
