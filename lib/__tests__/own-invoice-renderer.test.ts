import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_LOGO_UPLOAD_BYTES, MAX_PDF_INPUT_BYTES, RequestBodyLimitError } from '@/lib/resource-limits';
import { OwnInvoiceInputError, parseOwnInvoiceSource, type OwnInvoiceSource } from '@/lib/own-invoice-source';

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(), open: vi.fn(), settings: vi.fn(), privateLogoUrl: vi.fn(), ownership: vi.fn(),
  slot: vi.fn(), createFont: vi.fn(), layout: vi.fn(), xmlValidation: vi.fn(), xmlGeneration: vi.fn(),
  normalize: vi.fn(), loadPdf: vi.fn(), metadata: vi.fn(), savePdf: vi.fn(), verify: vi.fn(),
  registerFont: vi.fn(), end: vi.fn(), destroy: vi.fn(),
  constructorOptions: [] as Record<string, unknown>[],
  sequence: [] as string[],
  chunks: [] as Buffer[],
  streamFailure: null as Error | null,
  closeWithoutEnd: false,
  logoBytes: new Uint8Array(),
  logoStatSize: 0,
  logoReadChunkLimit: 3,
  logoIsFile: true,
  readFailure: null as Error | null,
  handles: [] as Array<{ stat: ReturnType<typeof vi.fn>; read: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }>,
}));

vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile, open: mocks.open }));
vi.mock('@/lib/prisma', () => ({ prisma: { settings: { findUnique: mocks.settings } } }));
vi.mock('@/lib/upload-path', () => ({ privateLogoUrl: mocks.privateLogoUrl }));
vi.mock('@/lib/upload-ownership', () => ({ findOwnedUploadedFile: mocks.ownership }));
vi.mock('@/lib/processing-limit', () => ({ withProcessingSlot: mocks.slot }));
vi.mock('fontkit', () => ({ create: mocks.createFont }));
vi.mock('pdf-lib', () => ({ PDFDocument: { load: mocks.loadPdf } }));
vi.mock('@/lib/pdfa3', () => ({ addFacturXPdfA3Metadata: mocks.metadata }));
vi.mock('@/lib/zugferd-generator', () => ({
  validateZugferdData: mocks.xmlValidation,
  generateZugferdXml: mocks.xmlGeneration,
}));
vi.mock('@/lib/server/own-invoice-layout', () => ({ renderOwnInvoiceLayout: mocks.layout }));
vi.mock('@/lib/server/own-invoice-pdfa-validator', () => ({ validateOwnInvoicePdfA3: mocks.verify }));
vi.mock('@/lib/server/own-invoice-image', () => ({
  normalizeOwnInvoiceImage: mocks.normalize,
  OwnInvoiceImageError: class OwnInvoiceImageError extends Error { readonly status = 422; },
}));
vi.mock('pdfkit', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    default: class MockPdfDocument extends EventEmitter {
      private destroyed = false;
      constructor(options: Record<string, unknown>) {
        super();
        mocks.constructorOptions.push(options);
      }
      registerFont(name: string, bytes: Buffer) {
        mocks.registerFont(name, bytes);
        return this;
      }
      end() {
        mocks.sequence.push('end-layout-stream');
        mocks.end();
        queueMicrotask(() => {
          if (mocks.streamFailure) this.emit('error', mocks.streamFailure);
          else if (!mocks.closeWithoutEnd) {
            for (const chunk of mocks.chunks) {
              this.emit('data', chunk);
              if (this.destroyed) return;
            }
            this.emit('end');
          }
          this.emit('close');
        });
      }
      destroy(error?: Error) {
        this.destroyed = true;
        mocks.destroy(error);
        queueMicrotask(() => {
          if (error) this.emit('error', error);
          this.emit('close');
        });
        return this;
      }
    },
  };
});

import { renderOwnInvoice } from '@/lib/server/own-invoice-renderer';
import { OwnInvoiceImageError } from '@/lib/server/own-invoice-image';

const regularFont = Buffer.from('synthetic regular font bytes');
const boldFont = Buffer.from('synthetic bold font bytes');
const layoutBytes = Buffer.from('synthetic layout PDF stream');
const finalBytes = new Uint8Array([37, 80, 68, 70, 45, 102, 105, 110, 97, 108]);
const xmlFixture = '<synthetic-server-built-invoice />';
const normalizedLogo = { bytes: Buffer.from('synthetic freshly encoded JPEG'), width: 200, height: 100 };
const finalPdf = { save: mocks.savePdf };
const options = { userId: 'tenant-a-unit', preview: false };

function source(): OwnInvoiceSource {
  return parseOwnInvoiceSource({
    version: 1, invoiceNumber: 'UNIT-117', date: '2026-10-22', dueDate: '2026-11-05', deliveryDate: '2026-10-21',
    customerAddress: 'Synthetic Buyer\nBuyer Road 2\n12345 Berlin', customerId: '42',
    buyerReference: 'UNIT-REFERENCE', buyerCountry: 'DE', buyerPostcode: '', buyerCity: '', buyerEmail: 'buyer@example.test',
    sellerCountry: 'DE', sellerPostcode: '', sellerCity: '', taxMode: 'standard',
    items: [
      { description: 'Synthetic service A', quantity: 1.5, unitPrice: 19.99, unit: 'Stunde', taxRate: 19 },
      { description: 'Synthetic service B', quantity: 2, unitPrice: 3.33, unit: 'Stück', taxRate: 19 },
    ],
    settings: {
      companyName: 'Synthetic Seller', companyAddress: 'Seller Road 1\n12345 Berlin', taxNumber: '123/456/78901',
      iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', bankName: 'Synthetic Bank', footerText: 'Synthetic footer',
      email: 'seller@example.test', telephone: '+49 000 000',
    },
    notes: 'Synthetic visible note', includeQRCode: true, paymentMeansCode: '30',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.constructorOptions = [];
  mocks.sequence = [];
  mocks.chunks = [layoutBytes.subarray(0, 9), layoutBytes.subarray(9)];
  mocks.streamFailure = null;
  mocks.closeWithoutEnd = false;
  mocks.logoBytes = new Uint8Array([1, 2, 3, 4, 5]);
  mocks.logoStatSize = mocks.logoBytes.byteLength;
  mocks.logoReadChunkLimit = 3;
  mocks.logoIsFile = true;
  mocks.readFailure = null;
  mocks.handles = [];
  mocks.slot.mockImplementation(async (_userId: string, work: () => Promise<unknown>) => work());
  mocks.readFile.mockImplementation(async (fontPath: string) => fontPath.endsWith('BivaroSans-Regular.ttf') ? regularFont : boldFont);
  mocks.settings.mockResolvedValue({ logoUrl: null });
  mocks.privateLogoUrl.mockImplementation((value: string | null | undefined) => value || null);
  mocks.ownership.mockResolvedValue('/synthetic/tenant-a/owned-logo.png');
  mocks.normalize.mockResolvedValue(normalizedLogo);
  mocks.createFont.mockReturnValue({ hasGlyphForCodePoint: () => true });
  mocks.xmlValidation.mockImplementation(() => {
    mocks.sequence.push('validate-xml-data');
    return { isValid: true, errors: [], warnings: [] };
  });
  mocks.xmlGeneration.mockImplementation(() => { mocks.sequence.push('generate-xml'); return xmlFixture; });
  mocks.layout.mockImplementation(async () => { mocks.sequence.push('render-layout'); });
  mocks.loadPdf.mockImplementation(async () => { mocks.sequence.push('load-final-pdf'); return finalPdf; });
  mocks.metadata.mockImplementation(async () => { mocks.sequence.push('attach-xml-metadata'); });
  mocks.savePdf.mockImplementation(async () => { mocks.sequence.push('save-final-bytes'); return finalBytes; });
  mocks.verify.mockImplementation(async () => { mocks.sequence.push('verify-final-bytes'); });
  mocks.open.mockImplementation(async () => {
    let offset = 0;
    const handle = {
      stat: vi.fn(async () => ({ isFile: () => mocks.logoIsFile, size: mocks.logoStatSize })),
      read: vi.fn(async (buffer: Buffer, destinationOffset: number, length: number, position: null) => {
        expect(position).toBeNull();
        if (mocks.readFailure) throw mocks.readFailure;
        const count = Math.min(length, mocks.logoBytes.byteLength - offset, mocks.logoReadChunkLimit);
        buffer.set(mocks.logoBytes.subarray(offset, offset + count), destinationOffset);
        offset += count;
        return { bytesRead: count, buffer };
      }),
      close: vi.fn(async () => undefined),
    };
    mocks.handles.push(handle);
    return handle;
  });
});

describe('own-invoice renderer orchestration (mocked PDF/image runtimes)', () => {
  it('derives XML and visible layout from one bounded source and verifies the exact last saved buffer', async () => {
    const input = source();
    const result = await renderOwnInvoice(input, options);

    expect(mocks.slot).toHaveBeenCalledWith(options.userId, expect.any(Function));
    const xmlData = mocks.xmlValidation.mock.calls[0][0];
    expect(xmlData).toMatchObject({
      invoiceNumber: input.invoiceNumber, netAmount: 36.65, taxAmount: 6.96,
      seller: { name: input.settings.companyName }, buyer: { name: 'Synthetic Buyer' },
      items: [
        { description: input.items[0].description, quantity: 1.5, unitPrice: 19.99, total: 29.99 },
        { description: input.items[1].description, quantity: 2, unitPrice: 3.33, total: 6.66 },
      ],
    });
    expect(mocks.xmlValidation.mock.calls[0][1]).toEqual({ profile: 'factur-x' });
    expect(mocks.xmlGeneration).toHaveBeenCalledExactlyOnceWith(xmlData, { profile: 'factur-x' });
    expect(mocks.xmlGeneration.mock.calls[0][0]).toBe(xmlData);
    expect(mocks.layout.mock.calls[0][1]).toBe(input);
    expect(mocks.loadPdf).toHaveBeenCalledExactlyOnceWith(layoutBytes, { updateMetadata: false });
    expect(mocks.metadata).toHaveBeenCalledExactlyOnceWith(finalPdf, xmlFixture, {
      invoiceNumber: input.invoiceNumber, createdAt: expect.any(Date), modifiedAt: expect.any(Date),
    });
    expect(mocks.metadata.mock.calls[0][2].createdAt).toBe(mocks.metadata.mock.calls[0][2].modifiedAt);
    expect(mocks.savePdf).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.verify).toHaveBeenCalledExactlyOnceWith(finalBytes);
    expect(mocks.verify.mock.calls[0][0]).toBe(finalBytes);
    expect(result).toBe(finalBytes);
    expect(mocks.sequence).toEqual([
      'validate-xml-data', 'generate-xml', 'render-layout', 'end-layout-stream',
      'load-final-pdf', 'attach-xml-metadata', 'save-final-bytes', 'verify-final-bytes',
    ]);
    expect(mocks.constructorOptions[0]).toMatchObject({ autoFirstPage: false, bufferPages: true, pdfVersion: '1.7', subset: 'PDF/A-3b' });
  });

  it('never releases a finalized invoice when independent final-byte validation rejects', async () => {
    const rejection = new Error('synthetic independent verifier rejection');
    mocks.verify.mockRejectedValue(rejection);

    await expect(renderOwnInvoice(source(), options)).rejects.toBe(rejection);
    expect(mocks.savePdf).toHaveBeenCalledTimes(1);
    expect(mocks.verify).toHaveBeenCalledExactlyOnceWith(finalBytes);
    expect(mocks.metadata).toHaveBeenCalledTimes(1);
  });

  it('shares layout and fonts for preview, without XML attachment or a PDF/A acceptance claim', async () => {
    const input = source();
    const result = await renderOwnInvoice(input, { ...options, preview: true });

    expect(result).toEqual(new Uint8Array(layoutBytes));
    expect(mocks.layout.mock.calls[0][1]).toBe(input);
    expect(mocks.xmlValidation).not.toHaveBeenCalled();
    expect(mocks.xmlGeneration).not.toHaveBeenCalled();
    expect(mocks.loadPdf).not.toHaveBeenCalled();
    expect(mocks.metadata).not.toHaveBeenCalled();
    expect(mocks.savePdf).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.constructorOptions[0]).not.toHaveProperty('subset');
    expect(mocks.registerFont.mock.calls).toEqual([['InvoiceRegular', regularFont], ['InvoiceBold', boldFont]]);
    expect(mocks.readFile.mock.calls.map(call => call[0])).toEqual([
      expect.stringMatching(/public\/fonts\/invoice\/BivaroSans-Regular\.ttf$/u),
      expect.stringMatching(/public\/fonts\/invoice\/BivaroSans-Bold\.ttf$/u),
    ]);
  });

  it('stops before PDF construction when server-side XML-data validation fails', async () => {
    mocks.xmlValidation.mockReturnValue({ isValid: false, errors: [{ field: 'buyer', message: 'Synthetic missing buyer' }], warnings: [] });

    await expect(renderOwnInvoice(source(), options)).rejects.toBeInstanceOf(OwnInvoiceInputError);
    expect(mocks.xmlGeneration).not.toHaveBeenCalled();
    expect(mocks.constructorOptions).toHaveLength(0);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('rejects oversized finalized bytes before attempting validation or returning them', async () => {
    mocks.savePdf.mockResolvedValue(new Uint8Array(MAX_PDF_INPUT_BYTES + 1));

    await expect(renderOwnInvoice(source(), options)).rejects.toBeInstanceOf(RequestBodyLimitError);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('propagates an observed stream error without an unhandled error/rejected collector promise', async () => {
    const streamError = new Error('synthetic PDF stream error');
    mocks.streamFailure = streamError;

    await expect(renderOwnInvoice(source(), options)).rejects.toBe(streamError);
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
    expect(mocks.loadPdf).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('settles a prematurely closed stream and destroys/settles the collector if layout fails', async () => {
    mocks.closeWithoutEnd = true;
    await expect(renderOwnInvoice(source(), options)).rejects.toThrow('PDF-Erstellung wurde abgebrochen.');
    const layoutError = new Error('synthetic layout failure');
    mocks.layout.mockRejectedValue(layoutError);
    await expect(renderOwnInvoice(source(), options)).rejects.toBe(layoutError);
    expect(mocks.destroy).toHaveBeenCalledTimes(2);
    expect(mocks.loadPdf).not.toHaveBeenCalled();
  });

  it('destroys an output stream when its actual chunks exceed the PDF-byte budget', async () => {
    mocks.chunks = [Buffer.alloc(MAX_PDF_INPUT_BYTES + 1)];

    await expect(renderOwnInvoice(source(), options)).rejects.toBeInstanceOf(RequestBodyLimitError);
    expect(mocks.destroy.mock.calls[0][0]).toBeInstanceOf(RequestBodyLimitError);
    expect(mocks.loadPdf).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});

describe('authenticated tenant logo handoff (mocked file and decoder)', () => {
  function useSavedLogo() {
    mocks.settings.mockResolvedValue({ logoUrl: '/api/files/logo?file=tenant-logo.png' });
  }

  it('resolves only the saved authenticated tenant logo, reads a bounded handle, then passes normalized bytes to layout', async () => {
    useSavedLogo();
    const originalLogo = Uint8Array.from(mocks.logoBytes);
    await renderOwnInvoice(source(), options);

    expect(mocks.settings).toHaveBeenCalledExactlyOnceWith({ where: { userId: options.userId }, select: { logoUrl: true } });
    expect(mocks.privateLogoUrl).toHaveBeenCalledExactlyOnceWith('/api/files/logo?file=tenant-logo.png');
    expect(mocks.ownership).toHaveBeenCalledExactlyOnceWith(options.userId, 'tenant-logo.png');
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith('/synthetic/tenant-a/owned-logo.png', 'r');
    expect(mocks.handles[0].stat).toHaveBeenCalledTimes(1);
    expect(mocks.handles[0].read).toHaveBeenCalled();
    for (const [buffer, offset, length, position] of mocks.handles[0].read.mock.calls) {
      expect(buffer.byteLength).toBe(MAX_LOGO_UPLOAD_BYTES + 1);
      expect(offset + length).toBeLessThanOrEqual(MAX_LOGO_UPLOAD_BYTES + 1);
      expect(position).toBeNull();
    }
    expect(mocks.handles[0].close).toHaveBeenCalledTimes(1);
    expect(mocks.normalize).toHaveBeenCalledExactlyOnceWith(Buffer.from(originalLogo));
    expect(mocks.layout.mock.calls[0][2]).toEqual({ logo: normalizedLogo });
    expect(mocks.layout.mock.calls[0][2].logo).toBe(normalizedLogo);
    expect(mocks.layout.mock.calls[0][2].logo.bytes).not.toEqual(Buffer.from(originalLogo));
    expect(mocks.logoBytes).toEqual(originalLogo);
  });

  it('does not read or normalize an image when no saved logo exists', async () => {
    await renderOwnInvoice(source(), { ...options, preview: true });

    expect(mocks.ownership).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.normalize).not.toHaveBeenCalled();
    expect(mocks.layout.mock.calls[0][2]).toEqual({ logo: undefined });
  });

  it('rejects caller asset/path fields at the bounded source boundary', () => {
    const input = source();
    expect(() => parseOwnInvoiceSource({ ...input, logoPath: '/synthetic/caller-selected-file' })).toThrow(OwnInvoiceInputError);
    expect(() => parseOwnInvoiceSource({ ...input, settings: { ...input.settings, logoUrl: 'https://example.test/logo.png' } })).toThrow(OwnInvoiceInputError);
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.ownership).not.toHaveBeenCalled();
  });

  it('fails explicitly instead of silently dropping an invalid saved logo reference', async () => {
    useSavedLogo();
    mocks.privateLogoUrl.mockReturnValue(null);
    await expect(renderOwnInvoice(source(), options)).rejects.toBeInstanceOf(OwnInvoiceImageError);
    expect(mocks.ownership).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.layout).not.toHaveBeenCalled();
  });

  it('rejects a saved logo without exclusive tenant ownership before opening a file', async () => {
    useSavedLogo();
    mocks.ownership.mockResolvedValue(null);

    await expect(renderOwnInvoice(source(), options)).rejects.toBeInstanceOf(OwnInvoiceImageError);
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.normalize).not.toHaveBeenCalled();
    expect(mocks.layout).not.toHaveBeenCalled();
  });

  it.each([0, MAX_LOGO_UPLOAD_BYTES + 1])('rejects a saved file with stat size outside the logo budget (%i)', async size => {
    useSavedLogo();
    mocks.logoStatSize = size;

    await expect(renderOwnInvoice(source(), options)).rejects.toBeInstanceOf(OwnInvoiceImageError);
    expect(mocks.handles[0].read).not.toHaveBeenCalled();
    expect(mocks.handles[0].close).toHaveBeenCalledTimes(1);
    expect(mocks.normalize).not.toHaveBeenCalled();
  });

  it('rejects a non-file and closes its opened handle', async () => {
    useSavedLogo();
    mocks.logoIsFile = false;

    await expect(renderOwnInvoice(source(), options)).rejects.toBeInstanceOf(OwnInvoiceImageError);
    expect(mocks.handles[0].read).not.toHaveBeenCalled();
    expect(mocks.handles[0].close).toHaveBeenCalledTimes(1);
  });

  it('enforces actual-read bytes even when a file grows beyond its earlier acceptable stat size', async () => {
    useSavedLogo();
    mocks.logoStatSize = 5;
    mocks.logoBytes = new Uint8Array(MAX_LOGO_UPLOAD_BYTES + 1);
    mocks.logoReadChunkLimit = MAX_LOGO_UPLOAD_BYTES + 1;

    await expect(renderOwnInvoice(source(), options)).rejects.toBeInstanceOf(OwnInvoiceImageError);
    expect(mocks.handles[0].read).toHaveBeenCalledTimes(1);
    expect(mocks.handles[0].read.mock.calls[0][2]).toBe(MAX_LOGO_UPLOAD_BYTES + 1);
    expect(mocks.handles[0].close).toHaveBeenCalledTimes(1);
    expect(mocks.normalize).not.toHaveBeenCalled();
    expect(mocks.layout).not.toHaveBeenCalled();
  });

  it('closes the original logo handle when full decode/re-encoding rejects, without handing uploaded bytes to layout', async () => {
    useSavedLogo();
    const rejection = new OwnInvoiceImageError();
    mocks.normalize.mockRejectedValue(rejection);

    await expect(renderOwnInvoice(source(), options)).rejects.toBe(rejection);
    expect(mocks.handles[0].close).toHaveBeenCalledTimes(1);
    expect(mocks.layout).not.toHaveBeenCalled();
    expect(mocks.constructorOptions).toHaveLength(0);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('closes the logo handle if bounded reading fails', async () => {
    useSavedLogo();
    const rejection = new Error('synthetic file read failure');
    mocks.readFailure = rejection;

    await expect(renderOwnInvoice(source(), options)).rejects.toBe(rejection);
    expect(mocks.handles[0].close).toHaveBeenCalledTimes(1);
    expect(mocks.normalize).not.toHaveBeenCalled();
    expect(mocks.layout).not.toHaveBeenCalled();
  });
});
