import { open, readFile } from 'node:fs/promises';
import path from 'node:path';
import PDFKitDocument from 'pdfkit';
import { create as createFont } from 'fontkit';
import { PDFDocument } from 'pdf-lib';
import { prisma } from '@/lib/prisma';
import { privateLogoUrl } from '@/lib/upload-path';
import { findOwnedUploadedFile } from '@/lib/upload-ownership';
import { withProcessingSlot } from '@/lib/processing-limit';
import { MAX_LOGO_UPLOAD_BYTES, MAX_PDF_INPUT_BYTES, RequestBodyLimitError } from '@/lib/resource-limits';
import { addFacturXPdfA3Metadata } from '@/lib/pdfa3';
import { generateZugferdXml, validateZugferdData } from '@/lib/zugferd-generator';
import { ownInvoiceToZugferdData, OwnInvoiceInputError, type OwnInvoiceSource } from '@/lib/own-invoice-source';
import { normalizeOwnInvoiceImage, OwnInvoiceImageError, type NormalizedInvoiceImage } from '@/lib/server/own-invoice-image';
import { renderOwnInvoiceLayout } from '@/lib/server/own-invoice-layout';
import { validateOwnInvoicePdfA3 } from '@/lib/server/own-invoice-pdfa-validator';

// Application-owned paths. Neither a request nor company settings can select a
// font, image path, executable, arbitrary PDF, drawing program or XML payload.
const FONT_DIRECTORY = path.join(process.cwd(), 'public', 'fonts', 'invoice');
const REGULAR_FONT = path.join(FONT_DIRECTORY, 'BivaroSans-Regular.ttf');
const BOLD_FONT = path.join(FONT_DIRECTORY, 'BivaroSans-Bold.ttf');

async function loadOwnedLogo(userId: string): Promise<NormalizedInvoiceImage | undefined> {
  const settings = await prisma.settings.findUnique({ where: { userId }, select: { logoUrl: true } });
  if (!settings?.logoUrl) return undefined;
  const logoUrl = privateLogoUrl(settings?.logoUrl);
  if (!logoUrl) throw new OwnInvoiceImageError();
  const storedName = new URL(logoUrl, 'https://bivaro.invalid').searchParams.get('file');
  if (!storedName) throw new OwnInvoiceImageError();
  const filePath = await findOwnedUploadedFile(userId, storedName);
  if (!filePath) throw new OwnInvoiceImageError();
  const file = await open(filePath, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_LOGO_UPLOAD_BYTES) throw new OwnInvoiceImageError();
    // Bound actual bytes too: a file growing after stat cannot make readFile()
    // allocate an unbounded buffer or evade the limit.
    const bytes = Buffer.alloc(MAX_LOGO_UPLOAD_BYTES + 1);
    let size = 0;
    while (size < bytes.length) {
      const result = await file.read(bytes, size, bytes.length - size, null);
      if (result.bytesRead === 0) break;
      size += result.bytesRead;
    }
    if (size > MAX_LOGO_UPLOAD_BYTES) throw new OwnInvoiceImageError();
    return await normalizeOwnInvoiceImage(bytes.subarray(0, size));
  } finally {
    await file.close();
  }
}

function collectPdf(doc: InstanceType<typeof PDFKitDocument>): Promise<{ bytes?: Buffer; error?: Error }> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (result: { bytes?: Buffer; error?: Error }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    doc.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_PDF_INPUT_BYTES) {
        doc.destroy(new RequestBodyLimitError('Die erzeugte Rechnung ist zu groß.'));
        return;
      }
      chunks.push(chunk);
    });
    doc.once('error', error => finish({ error }));
    doc.once('end', () => finish({ bytes: Buffer.concat(chunks, size) }));
    doc.once('close', () => finish({ error: new Error('PDF-Erstellung wurde abgebrochen.') }));
  });
}

function assertSupportedCharacters(source: OwnInvoiceSource, regularBytes: Buffer, boldBytes: Buffer): void {
  const regular = createFont(regularBytes);
  const bold = createFont(boldBytes);
  if (!('hasGlyphForCodePoint' in regular) || !('hasGlyphForCodePoint' in bold)) {
    throw new Error('Die Rechnungszeichensätze sind ungültig.');
  }
  // The model contains no opaque assets or programs. Check all its text so a
  // missing glyph never silently becomes an empty box in an issued invoice.
  const values: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === 'string') values.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(source);
  for (const value of values) {
    for (const character of value) {
      if (/\s/u.test(character)) continue;
      const codePoint = character.codePointAt(0)!;
      if (!regular.hasGlyphForCodePoint(codePoint) || !bold.hasGlyphForCodePoint(codePoint)) {
        throw new OwnInvoiceInputError('Die Rechnung enthält ein Zeichen, das der eingebettete Zeichensatz nicht unterstützt.');
      }
    }
  }
}

/** Read-only derivation. Does not reserve numbers, post, save or mutate invoices. */
export async function renderOwnInvoice(
  source: OwnInvoiceSource,
  options: { userId: string; preview: boolean },
): Promise<Uint8Array> {
  return withProcessingSlot(options.userId, async () => {
    // Build invoice XML here from the same bounded source used for the visible
    // layout. A caller cannot attach unrelated XML to a controlled invoice.
    let xml: string | undefined;
    if (!options.preview) {
      const data = ownInvoiceToZugferdData(source);
      const validation = validateZugferdData(data, { profile: 'factur-x' });
      if (!validation.isValid) throw new OwnInvoiceInputError(validation.errors.map(issue => issue.message).join(' '));
      xml = generateZugferdXml(data, { profile: 'factur-x' });
    }
    const [regular, bold, logo] = await Promise.all([
      readFile(REGULAR_FONT), readFile(BOLD_FONT), loadOwnedLogo(options.userId),
    ]);
    assertSupportedCharacters(source, regular, bold);
    const now = new Date();
    const doc = new PDFKitDocument({
      autoFirstPage: false,
      bufferPages: true,
      pdfVersion: '1.7',
      ...(options.preview ? {} : { subset: 'PDF/A-3b' }),
      // Only static text enters PDFKit's unescaped automatic XMP serializer.
      // Final user-specific metadata is safely replaced by pdf-lib below.
      info: { Title: 'Bivaro invoice', Creator: 'Bivaro', Producer: 'Bivaro', CreationDate: now, ModDate: now },
    });
    const output = collectPdf(doc);
    let basePdf: Buffer;
    try {
      doc.registerFont('InvoiceRegular', regular);
      doc.registerFont('InvoiceBold', bold);
      await renderOwnInvoiceLayout(doc, source, { logo });
      doc.end();
      const result = await output;
      if (result.error || !result.bytes) throw result.error ?? new Error('PDF-Erstellung fehlgeschlagen.');
      basePdf = result.bytes;
    } catch (error) {
      doc.destroy();
      await output;
      throw error;
    }
    if (options.preview) return new Uint8Array(basePdf);
    const finalPdf = await PDFDocument.load(basePdf, { updateMetadata: false });
    await addFacturXPdfA3Metadata(finalPdf, xml!, { invoiceNumber: source.invoiceNumber, createdAt: now, modifiedAt: now });
    const finalBytes = await finalPdf.save();
    if (finalBytes.byteLength > MAX_PDF_INPUT_BYTES) throw new RequestBodyLimitError('Die erzeugte Rechnung ist zu groß.');
    // Validate the exact post-attachment bytes returned/uploaded by the client.
    // No mutation, rewrite or metadata operation is permitted after this gate.
    await validateOwnInvoicePdfA3(finalBytes);
    return finalBytes;
  });
}
