import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import PDFKitDocument from 'pdfkit';
import { PDFDocument } from 'pdf-lib';
import { OwnInvoiceInputError, ownInvoiceToZugferdData, parseOwnInvoiceSource, type OwnInvoiceSource } from '@/lib/own-invoice-source';
import { validateZugferdData } from '@/lib/zugferd-generator';
import { renderOwnInvoiceLayout } from '@/lib/server/own-invoice-layout';

const fonts = ['BivaroSans-Regular.ttf', 'BivaroSans-Bold.ttf'].map(name =>
  readFileSync(path.join(process.cwd(), 'public', 'fonts', 'invoice', name)));
const documents: InstanceType<typeof PDFKitDocument>[] = [];
const normalize = (value: string) => value.replace(/\s+/gu, ' ').trim();

function source(overrides: Partial<OwnInvoiceSource> = {}): OwnInvoiceSource {
  return parseOwnInvoiceSource({
    version: 1, invoiceNumber: 'SYNTHETIC-ADDRESS-001', date: '2026-10-26', dueDate: '2026-11-09', deliveryDate: '2026-10-26',
    customerAddress: 'Musterempfänger GmbH\nTestweg 1\n12345 Teststadt',
    buyerReference: 'SYNTHETIC', buyerCountry: 'DE', buyerPostcode: '', buyerCity: '', buyerEmail: 'buyer@example.test',
    sellerCountry: 'DE', sellerPostcode: '', sellerCity: '', taxMode: 'small-business',
    items: [{ description: 'Synthetische Leistung', quantity: 1, unitPrice: 100, unit: 'Stück', taxRate: 0 }],
    settings: { companyName: 'Musterbetrieb GmbH', companyAddress: 'Musterweg 2\n54321 Musterstadt', taxNumber: '123/456/78901',
      iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', bankName: 'Synthetische Bank', footerText: 'Nur isolierte Testdaten',
      email: 'seller@example.test', telephone: '+49 000 000' },
    notes: 'Ausschließlich synthetische Testdaten', includeQRCode: false, paymentMeansCode: '30', ...overrides,
  });
}

function document() {
  const doc = new PDFKitDocument({ autoFirstPage: false, bufferPages: true });
  documents.push(doc);
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  doc.registerFont('InvoiceRegular', fonts[0]);
  doc.registerFont('InvoiceBold', fonts[1]);
  const pageText = new Map<object, string[]>();
  const positioned: Array<{ text: string; y: number }> = [];
  const originalText = doc.text.bind(doc);
  const text = vi.spyOn(doc, 'text').mockImplementation(((...args: unknown[]) => {
    if (typeof args[2] === 'number') positioned.push({ text: String(args[0]), y: args[2] });
    const values = pageText.get(doc.page) ?? [];
    values.push(String(args[0]));
    pageText.set(doc.page, values);
    return Reflect.apply(originalText, doc, args);
  }) as typeof doc.text);
  return { doc, bytes: () => new Promise<Buffer>((resolve, reject) => {
    doc.once('end', () => resolve(Buffer.concat(chunks)));
    doc.once('error', reject);
    doc.end();
  }), visible: () => normalize(text.mock.calls.map(call => String(call[0])).join(' ')),
    positioned: () => positioned,
    visiblePages: () => [...pageText.values()].map(values => normalize(values.join(' '))) };
}

afterEach(() => {
  documents.splice(0).forEach(doc => doc.destroy());
});

describe('own-invoice essential party layout (real PDFKit/font metrics)', () => {
  it.each(['', 'Vielen Dank für Ihren Auftrag!'])('keeps four two-line items, GiroCode and complete tax notes on one page (notes: %s)', async notes => {
    const input = source({ invoiceNumber: 'TEST-2026-05', buyerReference: '', customerId: '1', includeQRCode: true, notes,
      items: [9, 16, 23, 30].map(day => ({
        description: `IHK - Training KI Manager K17 (FJ26/K17) ${day}.10.2026 4. Modul Tag 1`,
        quantity: 3, unit: 'Stunde', unitPrice: 114, taxRate: 0,
      })),
    });
    const output = document();
    await renderOwnInvoiceLayout(output.doc, input, {});
    expect(output.doc.bufferedPageRange().count).toBe(1);
    const visible = output.visiblePages()[0];
    for (const item of input.items) expect(visible).toContain(item.description);
    for (const text of ['GiroCode', '1.368,00 €', 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.', 'Seite 1 von 1']) {
      expect(visible).toContain(text);
    }
    if (notes) expect(visible).toContain(notes);
    for (const entry of output.positioned().filter(entry => entry.text.includes('§ 19') || (notes && entry.text === notes))) {
      expect(entry.y).toBeLessThanOrEqual(841.89 - 128);
    }
    const pdf = await output.bytes();
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });

  it('paginates long notes without losing their final line or the required tax sentence', async () => {
    const notes = Array.from({ length: 85 }, (_, index) => `Vollständiger Hinweis ${index + 1}`).join('\n');
    const output = document();
    await renderOwnInvoiceLayout(output.doc, source({ notes }), {});
    expect(output.doc.bufferedPageRange().count).toBeGreaterThan(1);
    for (const note of notes.split('\n')) expect(output.visible()).toContain(note);
    expect(output.visiblePages().at(-1)).toContain('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.');
    for (const entry of output.positioned().filter(entry => entry.text.startsWith('Vollständiger Hinweis') || entry.text.includes('§ 19'))) {
      expect(entry.y).toBeLessThanOrEqual(841.89 - 128);
    }
  });

  it('retains ordinary party fields and one-page geometry', async () => {
    const input = source();
    const output = document();
    await renderOwnInvoiceLayout(output.doc, input, {});
    expect(output.doc.bufferedPageRange().count).toBe(1);
    for (const value of [input.settings.companyName, ...input.settings.companyAddress.split('\n'), ...input.customerAddress.split('\n')]) {
      expect(output.visible()).toContain(value);
    }
  });

  it('wraps complete accepted names, streets/house numbers and cities instead of adding ellipses', async () => {
    const original = source();
    const input = source({
      customerAddress: 'Synthetische Empfängergesellschaft für internationale Forschungsdienstleistungen und Beratung mbH\nLanger synthetischer Straßenname mit eindeutigem Hausnummernsuffix 98765\n12345 Synthetische Teststadt mit eindeutigem Ortsteil Nord',
      settings: { ...original.settings,
        companyName: 'Synthetischer Musterbetrieb für internationale Forschungsdienstleistungen und Beratung GmbH',
        companyAddress: 'Langer synthetischer Musterstraßenname mit eindeutigem Hausnummernsuffix 12345\n54321 Synthetische Musterstadt mit eindeutigem Ortsteil Süd' },
    });
    expect(validateZugferdData(ownInvoiceToZugferdData(input)).isValid).toBe(true);
    const output = document();
    await renderOwnInvoiceLayout(output.doc, input, {});
    expect(output.doc.bufferedPageRange().count).toBe(1);
    for (const value of [input.settings.companyName, ...input.settings.companyAddress.split('\n'), ...input.customerAddress.split('\n')]) {
      expect(output.visible()).toContain(normalize(value));
    }
  });

  it('keeps the complete wrapped seller address on every continuation page', async () => {
    const original = source();
    const input = source({ settings: { ...original.settings,
      companyAddress: 'Langer synthetischer Musterstraßenname mit eindeutigem Hausnummernsuffix 12345\n54321 Synthetische Musterstadt mit eindeutigem Ortsteil Süd' },
    items: Array.from({ length: 45 }, (_, index) => ({ ...original.items[0], description: `Synthetische Position ${index + 1}` })) });
    const output = document();
    await renderOwnInvoiceLayout(output.doc, input, {});
    const pages = output.doc.bufferedPageRange().count;
    expect(pages).toBeGreaterThan(1);
    expect(output.visiblePages()).toHaveLength(pages);
    for (const visible of output.visiblePages()) {
      for (const value of input.settings.companyAddress.split('\n')) expect(visible).toContain(normalize(value));
    }
  });

  it('explicitly rejects accepted source text that cannot fit the recipient block', async () => {
    const input = source({ customerAddress: `${'W'.repeat(1_800)}\nTestweg 1\n12345 Teststadt` });
    expect(validateZugferdData(ownInvoiceToZugferdData(input)).isValid).toBe(true);
    await expect(renderOwnInvoiceLayout(document().doc, input, {})).rejects.toThrow('Die Empfängeranschrift ist für das unterstützte Rechnungslayout zu lang.');
  });

  it('explicitly rejects accepted seller text rather than crossing the reserved footer boundary', async () => {
    const original = source();
    const input = source({ settings: { ...original.settings, companyAddress: `${'Musterstraße '.repeat(100)}12345\n54321 Musterstadt` } });
    expect(validateZugferdData(ownInvoiceToZugferdData(input)).isValid).toBe(true);
    await expect(renderOwnInvoiceLayout(document().doc, input, {})).rejects.toBeInstanceOf(OwnInvoiceInputError);
    await expect(renderOwnInvoiceLayout(document().doc, input, {})).rejects.toThrow('Die Ausstelleranschrift und Kontaktdaten sind für das unterstützte Rechnungslayout zu lang.');
  });
});
