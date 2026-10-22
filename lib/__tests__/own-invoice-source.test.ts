import { describe, expect, it } from 'vitest';
import {
  formatOwnInvoiceDate,
  MAX_OWN_INVOICE_ITEMS,
  OwnInvoiceInputError,
  ownInvoiceToZugferdData,
  parseOwnInvoiceCivilDate,
  parseOwnInvoiceSource,
  toOwnInvoiceLocalDate,
  type OwnInvoiceSource,
} from '../own-invoice-source';
import { generateZugferdXml, validateZugferdData } from '../zugferd-generator';

function invoice(overrides: Partial<OwnInvoiceSource> = {}): OwnInvoiceSource {
  return {
    version: 1,
    invoiceNumber: 'RE-2026-001',
    date: '2026-01-15',
    dueDate: '2026-02-15',
    deliveryDate: '2026-01-14',
    customerAddress: 'Kunde GmbH\nKundenweg 99\n54321 Kundenstadt',
    customerId: '123',
    buyerReference: 'REF-123',
    buyerCountry: 'DE',
    buyerPostcode: '',
    buyerCity: '',
    buyerEmail: 'kunde@example.test',
    sellerCountry: 'DE',
    sellerPostcode: '',
    sellerCity: '',
    taxMode: 'small-business',
    items: [{ description: 'Webentwicklung', quantity: 10, unitPrice: 100, unit: 'Stunde', taxRate: 0 }],
    settings: {
      companyName: 'Musterbetrieb',
      companyAddress: 'Musterstraße 1\n12345 Musterstadt',
      taxNumber: '123/456/78901',
      iban: 'DE89370400440532013000',
      bic: 'COBADEFFXXX',
      bankName: 'Musterbank',
      footerText: 'Vielen Dank',
      email: 'betrieb@example.test',
      telephone: '+49 123 456789',
    },
    notes: 'Hinweis mit Umlauten: Ä Ö Ü ß und €.',
    includeQRCode: true,
    paymentMeansCode: '30',
    ...overrides,
  };
}

function inTimeZone(zone: string, work: () => void): void {
  const previous = process.env.TZ;
  try {
    process.env.TZ = zone;
    work();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

describe('own invoice source boundary', () => {
  it('makes a fresh canonical copy without changing the supplied invoice', () => {
    const input = invoice();
    const original = JSON.stringify(input);
    const parsed = parseOwnInvoiceSource(input);
    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed.settings).not.toBe(input.settings);
    expect(parsed.items[0]).not.toBe(input.items[0]);
    expect(JSON.stringify(input)).toBe(original);
  });

  it('allows incomplete preview content while leaving final XML validation explicit', () => {
    const parsed = parseOwnInvoiceSource({
      ...invoice({ invoiceNumber: '', customerAddress: '', dueDate: '', deliveryDate: '' }),
      settings: {},
      items: [{ description: '', quantity: 1, unitPrice: 0, unit: 'Stück', taxRate: 0 }],
    });
    expect(parsed.settings.companyName).toBe('');
    expect(parsed.settings.iban).toBe('');
    expect(parsed.items[0].description).toBe('');
    expect(validateZugferdData(ownInvoiceToZugferdData(parsed)).isValid).toBe(false);
  });

  it.each([
    ['drawing instructions', { commands: [] }],
    ['an input PDF', { basePdfBytes: [] }],
    ['caller-provided XML', { xmlContent: '<invoice />' }],
    ['a path', { fontPath: '/not-a-rendering-input' }],
    ['an unsupported model version', { version: 2 }],
  ])('rejects %s', (_label, additions) => {
    expect(() => parseOwnInvoiceSource({ ...invoice(), ...additions })).toThrow(OwnInvoiceInputError);
  });

  it('rejects logo references and editor-only item snapshots instead of forwarding them', () => {
    expect(() => parseOwnInvoiceSource({ ...invoice(), settings: { ...invoice().settings, logoUrl: '/api/files/logo?file=x' } })).toThrow(OwnInvoiceInputError);
    expect(() => parseOwnInvoiceSource({ ...invoice(), items: [{ ...invoice().items[0], billingNoteId: 123 }] })).toThrow(OwnInvoiceInputError);
    expect(() => parseOwnInvoiceSource({ ...invoice(), items: [{ ...invoice().items[0], total: 0 }] })).toThrow(OwnInvoiceInputError);
  });

  it.each([null, [], 'invoice', 1, new Date()])('rejects non-object roots: %s', value => {
    expect(() => parseOwnInvoiceSource(value)).toThrow(OwnInvoiceInputError);
  });

  it('enforces line, per-field and aggregate text budgets', () => {
    expect(() => parseOwnInvoiceSource(invoice({ items: [] }))).toThrow(OwnInvoiceInputError);
    expect(() => parseOwnInvoiceSource(invoice({ items: Array.from({ length: MAX_OWN_INVOICE_ITEMS + 1 }, () => invoice().items[0]) }))).toThrow(OwnInvoiceInputError);
    expect(() => parseOwnInvoiceSource(invoice({ notes: 'a'.repeat(20_001) }))).toThrow(OwnInvoiceInputError);
    expect(() => parseOwnInvoiceSource(invoice({ items: [{ ...invoice().items[0], description: 'a'.repeat(4_001) }] }))).toThrow(OwnInvoiceInputError);
    expect(() => parseOwnInvoiceSource(invoice({ items: Array.from({ length: 26 }, () => ({ ...invoice().items[0], description: 'a'.repeat(4_000) })) }))).toThrow(OwnInvoiceInputError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 1e100])('rejects unsupported monetary inputs: %s', unitPrice => {
    expect(() => parseOwnInvoiceSource(invoice({ items: [{ ...invoice().items[0], unitPrice }] }))).toThrow(OwnInvoiceInputError);
  });

  it('rejects zero quantities, nonnumeric prices, invalid categories and invalid flags', () => {
    expect(() => parseOwnInvoiceSource(invoice({ items: [{ ...invoice().items[0], quantity: 0 }] }))).toThrow(OwnInvoiceInputError);
    expect(() => parseOwnInvoiceSource({ ...invoice(), items: [{ ...invoice().items[0], unitPrice: '100' }] })).toThrow(OwnInvoiceInputError);
    expect(() => parseOwnInvoiceSource({ ...invoice(), items: [{ ...invoice().items[0], taxCategory: 'Q' }] })).toThrow(OwnInvoiceInputError);
    expect(() => parseOwnInvoiceSource({ ...invoice(), includeQRCode: 'true' })).toThrow(OwnInvoiceInputError);
    expect(() => parseOwnInvoiceSource({ ...invoice(), paymentMeansCode: '58' })).toThrow(OwnInvoiceInputError);
  });

  it.each(['A\u0000B', 'A\u001fB', 'A\ud800B', 'A\udfffB', 'A\ufffeB', 'A\uffffB'])('rejects malformed text safely', notes => {
    expect(() => parseOwnInvoiceSource(invoice({ notes }))).toThrow(OwnInvoiceInputError);
  });

  it('preserves multiline notes, accents and supplementary Unicode without normalizing content', () => {
    const notes = 'Ä Ö Ü ß €\nGrüße\tmit Akzent e\u0301 und Zeichen \u{1f600}';
    expect(parseOwnInvoiceSource(invoice({ notes })).notes).toBe(notes);
  });

  it('rejects line breaks in fixed single-line invoice fields', () => {
    expect(() => parseOwnInvoiceSource(invoice({ invoiceNumber: 'RE-1\nRE-2' }))).toThrow(OwnInvoiceInputError);
    expect(() => parseOwnInvoiceSource({ ...invoice(), settings: { ...invoice().settings, companyName: 'First\nSecond' } })).toThrow(OwnInvoiceInputError);
    expect(() => parseOwnInvoiceSource({ ...invoice(), items: [{ ...invoice().items[0], unit: 'Stück\nStunde' }] })).toThrow(OwnInvoiceInputError);
  });
});

describe('own invoice civil dates', () => {
  it.each([
    ['0001-01-01', '01.01.0001'],
    ['0099-12-31', '31.12.0099'],
    ['0100-03-01', '01.03.0100'],
    ['2000-02-29', '29.02.2000'],
    ['2026-10-22', '22.10.2026'],
    ['9999-12-31', '31.12.9999'],
  ])('preserves %s without remapping years 0001–0099', (value, expected) => {
    expect(parseOwnInvoiceCivilDate(value).toISOString().slice(0, 10)).toBe(value);
    expect(formatOwnInvoiceDate(value)).toBe(expected);
  });

  it.each([
    '0000-01-01', '10000-01-01', '1900-02-29', '2026-02-29', '2026-04-31',
    '2026-00-01', '2026-13-01', '2026-01-00', '2026-01-32', '2026-1-01',
    '26-01-01', '2026-01-01T00:00:00Z', ' 2026-01-01', 'not a date', '',
  ])('rejects invalid or non-civil date %s', value => {
    expect(() => parseOwnInvoiceCivilDate(value)).toThrow(OwnInvoiceInputError);
    expect(() => toOwnInvoiceLocalDate(value)).toThrow(OwnInvoiceInputError);
    expect(() => parseOwnInvoiceSource(invoice({ date: value }))).toThrow(OwnInvoiceInputError);
  });

  it('uses a dash only for an absent optional display date', () => {
    expect(formatOwnInvoiceDate()).toBe('-');
    expect(formatOwnInvoiceDate('')).toBe('-');
  });

  it.each(['UTC', 'Europe/Berlin', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Honolulu'])('keeps display and local-calendar XML dates aligned in %s', zone => {
    inTimeZone(zone, () => {
      for (const value of ['0001-01-01', '0099-12-31', '2026-01-01', '2026-07-01', '9999-12-31']) {
        const local = toOwnInvoiceLocalDate(value);
        expect(String(local.getFullYear()).padStart(4, '0')).toBe(value.slice(0, 4));
        expect(String(local.getMonth() + 1).padStart(2, '0')).toBe(value.slice(5, 7));
        expect(String(local.getDate()).padStart(2, '0')).toBe(value.slice(8, 10));
        expect(formatOwnInvoiceDate(value)).toBe(`${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}`);
      }
      const data = ownInvoiceToZugferdData(parseOwnInvoiceSource(invoice()));
      const xml = generateZugferdXml(data);
      expect(xml).toContain('20260115');
      expect(xml).toContain('20260215');
      expect(xml).toContain('20260114');
    });
  });

  it('never silently rolls a historically skipped local calendar day into the next day', () => {
    inTimeZone('Pacific/Apia', () => {
      expect(formatOwnInvoiceDate('2011-12-30')).toBe('30.12.2011');
      expect(() => toOwnInvoiceLocalDate('2011-12-30')).toThrow(/Server-Zeitzone/u);
    });
  });

  it('checks optional dates with the same strict calendar rules', () => {
    expect(() => parseOwnInvoiceSource(invoice({ dueDate: '2026-02-30' }))).toThrow(OwnInvoiceInputError);
    expect(() => parseOwnInvoiceSource(invoice({ deliveryDate: '0000-01-01' }))).toThrow(OwnInvoiceInputError);
  });
});

describe('own invoice XML source', () => {
  it('recalculates identical rounded line and header totals for standard tax', () => {
    const source = parseOwnInvoiceSource(invoice({
      taxMode: 'standard',
      items: [
        { description: 'A', quantity: 1, unitPrice: 0.03, unit: 'Stück', taxRate: 19, taxCategory: 'S' },
        { description: 'B', quantity: 1, unitPrice: 0.03, unit: 'Stück', taxRate: 19, taxCategory: 'S' },
      ],
    }));
    const data = ownInvoiceToZugferdData(source);
    expect(data.items.map(item => item.total)).toEqual([0.03, 0.03]);
    expect(data.netAmount).toBe(0.06);
    expect(data.taxAmount).toBe(0.01);
    const xml = generateZugferdXml(data);
    expect(xml).toContain('<ram:GrandTotalAmount>0.07</ram:GrandTotalAmount>');
  });

  it('preserves decimal precision, address contract and zero-tax semantics', () => {
    const source = parseOwnInvoiceSource(invoice({
      buyerCountry: 'FR', buyerPostcode: '75001', buyerCity: ' Paris ',
      sellerCountry: 'AT', sellerPostcode: '1010', sellerCity: ' Wien ',
      items: [{ description: 'Teilmenge', quantity: 0.333, unitPrice: 100.1234, unit: 'Stunde', taxRate: 0 }],
    }));
    const data = ownInvoiceToZugferdData(source);
    expect(data.items[0]).toMatchObject({ quantity: 0.333, unitPrice: 100.1234, total: 33.34, taxCategory: 'E' });
    expect(data.seller).toMatchObject({ name: source.settings.companyName, address: source.settings.companyAddress, zipCode: '1010', city: 'Wien' });
    expect(data.buyer).toMatchObject({ name: 'Kunde GmbH', address: source.customerAddress, zipCode: '75001', city: 'Paris' });
    expect(data.currency).toBe('EUR');
  });

  it('preserves cash-payment and absent-date behavior without inventing an IBAN', () => {
    const source = parseOwnInvoiceSource(invoice({ paymentMeansCode: '10', dueDate: '', deliveryDate: '', settings: { ...invoice().settings, iban: '', bic: '' } }));
    const data = ownInvoiceToZugferdData(source);
    expect(data.dueDate).toBeUndefined();
    expect(data.deliveryDate).toBeUndefined();
    expect(data.paymentTerms).toBe('Zahlbar nach Erhalt der Rechnung');
    expect(data.paymentMeansCode).toBe('10');
    expect(generateZugferdXml(data)).not.toContain('<ram:IBANID>');
  });
});
