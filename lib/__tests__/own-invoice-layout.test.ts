import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import PDFKitDocument from 'pdfkit';
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
  doc.on('data', () => undefined);
  doc.registerFont('InvoiceRegular', fonts[0]);
  doc.registerFont('InvoiceBold', fonts[1]);
  const pageText = new Map<object, string[]>();
  const originalText = doc.text.bind(doc);
  const text = vi.spyOn(doc, 'text').mockImplementation(((...args: unknown[]) => {
    const values = pageText.get(doc.page) ?? [];
    values.push(String(args[0]));
    pageText.set(doc.page, values);
    return Reflect.apply(originalText, doc, args);
  }) as typeof doc.text);
  return { doc, visible: () => normalize(text.mock.calls.map(call => String(call[0])).join(' ')),
    visiblePages: () => [...pageText.values()].map(values => normalize(values.join(' '))) };
}

afterEach(() => {
  documents.splice(0).forEach(doc => doc.destroy());
});

describe('own-invoice essential party layout (real PDFKit/font metrics)', () => {
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
