import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import QRCode from 'qrcode';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString } from 'pdf-lib';

const fixture = vi.hoisted(() => ({ logoPath: null as string | null }));
// Database and tenant ownership are fixture boundaries only. PDFKit, fontkit,
// Sharp, pdf-lib and official veraPDF are deliberately NOT mocked in this suite.
vi.mock('@/lib/prisma', () => ({ prisma: { settings: { findUnique: vi.fn(async () => ({
  logoUrl: fixture.logoPath ? '/api/files/logo?file=synthetic-logo.png' : null,
})) } } }));
vi.mock('@/lib/upload-ownership', () => ({ findOwnedUploadedFile: vi.fn(async () => fixture.logoPath) }));

import { calculateInvoiceAmounts } from '@/lib/invoice-calculation';
import { ownInvoiceToZugferdData, parseOwnInvoiceSource, type OwnInvoiceSource } from '@/lib/own-invoice-source';
import { generateZugferdXml } from '@/lib/zugferd-generator';
import { normalizeOwnInvoiceImage, OwnInvoiceImageError } from '@/lib/server/own-invoice-image';
import { renderOwnInvoice } from '@/lib/server/own-invoice-renderer';
import { OWN_INVOICE_VERAPDF_VERSION, validateOwnInvoicePdfA3 } from '@/lib/server/own-invoice-pdfa-validator';

/**
 * Explicit release gate, not a capability-detecting skip. A normal unit run may
 * skip this expensive native matrix; RELEASE ACCEPTANCE MUST ENABLE IT:
 * BIVARO_RUN_OWN_INVOICE_PDFA_ACCEPTANCE=1 npm test -- lib/__tests__/own-invoice-pdfa-acceptance.test.ts
 * Once enabled, missing fonts, runtime or official pinned veraPDF MUST FAIL.
 * Run the enabled gate in both supported native container architectures and
 * inspect its exact output PDFs in desktop/mobile browser/rendering evidence.
 */
const acceptance = process.env.BIVARO_RUN_OWN_INVOICE_PDFA_ACCEPTANCE === '1' ? describe : describe.skip;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function source(overrides: Partial<OwnInvoiceSource> = {}): OwnInvoiceSource {
  return parseOwnInvoiceSource({
    version: 1, invoiceNumber: 'TEST-117-001', date: '2026-10-22', dueDate: '2026-11-05', deliveryDate: '2026-10-21',
    customerAddress: 'Synthetischer Empfänger\nTestweg 1\n12345 Teststadt', customerId: '117',
    buyerReference: 'SYNTHETIC-REF', buyerCountry: 'DE', buyerPostcode: '', buyerCity: '', buyerEmail: 'buyer@example.test',
    sellerCountry: 'DE', sellerPostcode: '', sellerCity: '', taxMode: 'small-business',
    items: [{ description: 'Synthetische Dienstleistung', quantity: 1.25, unitPrice: 80.12, unit: 'Stunde', taxRate: 0 }],
    settings: {
      companyName: 'Musterbetrieb', companyAddress: 'Musterweg 2\n54321 Musterstadt', taxNumber: '123/456/78901',
      iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', bankName: 'Synthetische Bank',
      footerText: 'Nur isolierte Testdaten', email: 'seller@example.test', telephone: '+49 000 000',
    },
    notes: 'Synthetischer Hinweis mit Umlauten: Ä Ö Ü ß und €.', includeQRCode: false, paymentMeansCode: '30',
    ...overrides,
  });
}

type MatrixCase = { name: string; invoice: () => OwnInvoiceSource; multipage?: boolean; logo?: boolean; qr?: boolean };
const cases: MatrixCase[] = [
  { name: 'small-business', invoice: () => source() },
  { name: 'standard-mixed-tax', invoice: () => source({ taxMode: 'standard', items: [
    { description: 'Leistung 19 %', quantity: 0.333, unitPrice: 100.1234, unit: 'Stunde', taxRate: 19, taxCategory: 'S' },
    { description: 'Leistung 7 %', quantity: 3, unitPrice: 25.55, unit: 'Stück', taxRate: 7, taxCategory: 'S' },
  ] }) },
  { name: 'multipage-description-notes', multipage: true, invoice: () => source({
    items: Array.from({ length: 45 }, (_, index) => ({ description: `Position ${index + 1}: ${'Suchbarer Beschreibungstext mit Umlauten. '.repeat(index === 0 ? 70 : 3)}`,
      quantity: 1, unitPrice: 13.37, unit: 'Stück', taxRate: 0 })),
    notes: 'Vollständiger synthetischer Hinweis.\n'.repeat(80),
  }) },
  { name: 'large-supported-total', multipage: true, invoice: () => source({
    items: Array.from({ length: 200 }, (_, index) => ({ description: `Synthetische Position ${index + 1}`,
      quantity: 1, unitPrice: 999_999_999.99, unit: 'Stück', taxRate: 0 })),
  }) },
  { name: 'unbroken-description-notes', multipage: true, invoice: () => source({
    items: [{ description: 'W'.repeat(4_000), quantity: 1, unitPrice: 12.34, unit: 'Stück', taxRate: 0 }],
    notes: 'N'.repeat(12_000),
  }) },
  { name: 'licensed-fonts-escaped-title', invoice: () => source({ invoiceNumber: 'TEST-&-001',
    notes: 'Ä Ö Ü ß € – Ελληνικά Пример; keine stillschweigend fehlenden Glyphen.' }) },
  { name: 'transparent-logo-white-card', logo: true, invoice: () => source() },
  { name: 'girocode-final-amount', qr: true, invoice: () => source({ invoiceNumber: 'TEST-QR-001', includeQRCode: true }) },
  { name: 'civil-year-0001', invoice: () => source({ date: '0001-01-01', dueDate: '0001-01-15', deliveryDate: '0001-01-01' }) },
  { name: 'civil-year-9999', invoice: () => source({ date: '9999-12-15', dueDate: '9999-12-31', deliveryDate: '9999-12-15' }) },
];

function rawStream(value: unknown): PDFRawStream {
  expect(value).toBeInstanceOf(PDFRawStream);
  if (!(value instanceof PDFRawStream)) throw new Error('Expected a serialized PDF stream.');
  return value;
}

function embeddedXml(pdf: PDFDocument): string {
  const associated = pdf.catalog.lookup(PDFName.of('AF'), PDFArray);
  expect(associated.size()).toBe(1);
  const file = associated.lookup(0, PDFDict);
  expect(file.lookup(PDFName.of('AFRelationship'), PDFName).toString()).toBe('/Alternative');
  expect(file.lookup(PDFName.of('F'), PDFString).decodeText()).toBe('factur-x.xml');
  const stream = rawStream(file.lookup(PDFName.of('EF'), PDFDict).lookup(PDFName.of('F')));
  return new TextDecoder().decode(decodePDFRawStream(stream).decode());
}

function jpegStreams(pdf: PDFDocument): PDFRawStream[] {
  return pdf.context.enumerateIndirectObjects().map(([, object]) => object).filter((object): object is PDFRawStream => (
    object instanceof PDFRawStream
    && object.dict.lookupMaybe(PDFName.of('Subtype'), PDFName)?.toString() === '/Image'
    && object.dict.lookupMaybe(PDFName.of('Filter'), PDFName)?.toString() === '/DCTDecode'
  ));
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

acceptance.sequential('real controlled invoice PDF/A-3b release acceptance', () => {
  let directory: string;
  let transparentLogo: Buffer;
let malformedLogoPassed = false;
let overlongIdentifierPassed = false;
let overlongUnitPassed = false;
  const manifest: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    // Missing font files fail here rather than silently excluding font cases.
    const fonts = await Promise.all(['BivaroSans-Regular.ttf', 'BivaroSans-Bold.ttf'].map(name =>
      readFile(path.join(process.cwd(), 'public', 'fonts', 'invoice', name))));
    expect(fonts.every(bytes => bytes.length > 100_000)).toBe(true);
    directory = await mkdtemp(path.join(tmpdir(), 'bivaro-own-invoice-acceptance-'));
    transparentLogo = await sharp({ create: { width: 160, height: 80, channels: 4,
      background: { r: 20, g: 100, b: 200, alpha: 0.5 } } }).png().toBuffer();
    await writeFile(path.join(directory, 'logo.png'), transparentLogo, { flag: 'wx', mode: 0o600 });
  });

  afterAll(async () => {
    const evidence = process.env.BIVARO_OWN_INVOICE_EVIDENCE_DIR;
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await writeFile(path.join(evidence, 'manifest.json'), JSON.stringify({
        status: manifest.length === cases.length && malformedLogoPassed && overlongIdentifierPassed && overlongUnitPassed ? 'matrix-passed' : 'incomplete-or-failed',
        verifier: OWN_INVOICE_VERAPDF_VERSION,
        platform: process.platform, architecture: process.arch, node: process.version,
        expectedCases: cases.map(item => item.name), malformedLogoPassed, overlongIdentifierPassed, overlongUnitPassed, cases: manifest,
      }, null, 2));
    }
    fixture.logoPath = null;
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  for (const item of cases) {
    it(`${item.name}: independently validates the exact attached bytes`, async () => {
      const invoice = item.invoice();
      const original = JSON.stringify(invoice);
      fixture.logoPath = item.logo ? path.join(directory, 'logo.png') : null;
      const bytes = await renderOwnInvoice(invoice, { userId: 'synthetic-pdfa-117', preview: false });
      const finalHash = sha256(bytes);
      // An additional independent pass is intentionally over the returned bytes,
      // not a pre-attachment PDF or re-saved test copy. No verifier is mocked.
      await validateOwnInvoicePdfA3(bytes);
      expect(sha256(bytes)).toBe(finalHash);
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
      const previewBytes = await renderOwnInvoice(invoice, { userId: 'synthetic-pdfa-117', preview: true });
      const preview = await PDFDocument.load(previewBytes, { updateMetadata: false });
      // Compare maintained-library-decoded page streams, not whole-file bytes:
      // final output necessarily adds ICC/XMP/XML, while visible page content
      // (including logo and real GiroCode) must remain exactly the same.
      expect(pageContent(preview)).toEqual(pageContent(pdf));
      expect(preview.catalog.has(PDFName.of('AF'))).toBe(false);
      const xml = embeddedXml(pdf);
      expect(xml).toBe(generateZugferdXml(ownInvoiceToZugferdData(invoice), { profile: 'factur-x' }));
      expect(xml).toContain(invoice.date.replaceAll('-', ''));
      expect(pdf.getTitle()).toBe(`Rechnung ${invoice.invoiceNumber}`);
      expect(pdf.catalog.lookup(PDFName.of('OutputIntents'), PDFArray).size()).toBe(1);
      const metadata = rawStream(pdf.catalog.lookup(PDFName.of('Metadata'))).getContentsString();
      expect(metadata).toContain('<pdfaid:part>3</pdfaid:part>');
      expect(metadata).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
      const descriptors = pdf.context.enumerateIndirectObjects().map(([, object]) => object).filter((object): object is PDFDict => (
        object instanceof PDFDict && object.lookupMaybe(PDFName.of('Type'), PDFName)?.toString() === '/FontDescriptor'
      ));
      expect(descriptors.length).toBeGreaterThanOrEqual(2);
      expect(descriptors.every(font => font.has(PDFName.of('FontFile2')))).toBe(true);
      if (item.multipage) expect(pdf.getPageCount()).toBeGreaterThan(2);
      if (item.logo) {
        const expected = await normalizeOwnInvoiceImage(transparentLogo);
        expect(jpegStreams(pdf).some(stream => sha256(stream.getContents()) === sha256(expected.bytes))).toBe(true);
        expect(await readFile(path.join(directory, 'logo.png'))).toEqual(transparentLogo);
      }
      if (item.qr) {
        const payload = ['BCD', '002', '1', 'SCT', invoice.settings.bic, invoice.settings.companyName,
          invoice.settings.iban, `EUR${calculateInvoiceAmounts(invoice.items).grossAmount.toFixed(2)}`, '', '', invoice.invoiceNumber].join('\n');
        const png = await QRCode.toBuffer(payload, { errorCorrectionLevel: 'M', type: 'png', margin: 4 });
        const expected = await normalizeOwnInvoiceImage(png);
        expect(jpegStreams(pdf).some(stream => sha256(stream.getContents()) === sha256(expected.bytes))).toBe(true);
      }
      expect(JSON.stringify(invoice)).toBe(original);
      const evidence = process.env.BIVARO_OWN_INVOICE_EVIDENCE_DIR;
      if (evidence) {
        await mkdir(evidence, { recursive: true });
        await writeFile(path.join(evidence, `${item.name}.pdf`), bytes);
        await writeFile(path.join(evidence, `${item.name}-preview.pdf`), previewBytes);
      }
      manifest.push({ name: item.name, result: 'passed', sha256: finalHash, xmlSha256: sha256(new TextEncoder().encode(xml)),
        previewSha256: sha256(previewBytes), sourceSha256: sha256(new TextEncoder().encode(original)),
        pages: pdf.getPageCount(), bytes: bytes.byteLength });
    }, 120_000);
  }

  it('rejects a unit/price combination that cannot be represented completely and readably', async () => {
    await expect(renderOwnInvoice(source({ items: [{ description: 'Synthetische Position', quantity: 1,
      unitPrice: 999_999_999.99, unit: 'W'.repeat(40), taxRate: 0 }] }), {
      userId: 'synthetic-pdfa-117', preview: true,
    })).rejects.toThrow('Einheit und Einzelpreis sind für die Rechnung zu lang');
    overlongUnitPassed = true;
  });

  it('rejects an identifier that cannot be represented without truncation or overlap', async () => {
    await expect(renderOwnInvoice(source({ invoiceNumber: 'W'.repeat(200) }), {
      userId: 'synthetic-pdfa-117', preview: false,
    })).rejects.toThrow('Die Rechnungsnummer ist für das unterstützte Layout zu lang.');
    overlongIdentifierPassed = true;
  });

  it('an ordinary malformed saved logo fails before any final output is returned', async () => {
    const logo = path.join(directory, 'incomplete-logo.png');
    await writeFile(logo, transparentLogo.subarray(0, 16), { flag: 'wx', mode: 0o600 });
    fixture.logoPath = logo;
    await expect(renderOwnInvoice(source(), { userId: 'synthetic-pdfa-117', preview: false })).rejects.toBeInstanceOf(OwnInvoiceImageError);
    expect(await readFile(logo)).toEqual(transparentLogo.subarray(0, 16));
    fixture.logoPath = null;
    malformedLogoPassed = true;
  });
});
