import { describe, expect, it } from 'vitest'
import { generateZugferdXml, validateZugferdData, type ZugferdData } from '../zugferd-generator'

function createTestInvoice(overrides: Partial<ZugferdData> = {}): ZugferdData {
  return {
    invoiceNumber: 'RE-2026-001', date: new Date('2026-01-15T12:00:00'), dueDate: new Date('2026-02-15T12:00:00'),
    seller: { name: 'Max Mustermann', address: 'Musterstraße 1\n12345 Musterstadt', countryCode: 'DE', email: 'max@example.de', telephone: '+49 123 456789', taxNumber: '123/456/78901', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' },
    buyer: { name: 'Kunde GmbH', address: 'Kundenweg 99', countryCode: 'DE', email: 'info@kunde.de', zipCode: '54321', city: 'Kundenstadt' },
    items: [{ description: 'Webentwicklung', quantity: 10, unitPrice: 100, total: 1000, unit: 'Stunde', taxRate: 0 }],
    netAmount: 1000, taxAmount: 0, currency: 'EUR', taxMode: 'small-business', ...overrides,
  }
}

describe('generateZugferdXml', () => {
  it('writes the EN 16931 guideline and does not invent a buyer reference', () => {
    const xml = generateZugferdXml(createTestInvoice())
    expect(xml).toMatch(/^\s*<\?xml version="1\.0" encoding="UTF-8"\?>/)
    expect(xml).toContain('urn:cen.eu:en16931:2017')
    expect(xml).not.toContain('<ram:BuyerReference>')
  })

  it('writes a supplied buyer reference and the XRechnung profile ID', () => {
    const xml = generateZugferdXml(createTestInvoice({ buyerReference: '04011000-12345-67' }), { profile: 'xrechnung' })
    expect(xml).toContain('urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0')
    expect(xml).toContain('<ram:BuyerReference>04011000-12345-67</ram:BuyerReference>')
  })

  it('preserves date and omits an absent optional delivery event', () => {
    const xml = generateZugferdXml(createTestInvoice({ deliveryDate: undefined }))
    expect(xml).toContain('20260115')
    expect(xml).toContain('<ram:ApplicableHeaderTradeDelivery></ram:ApplicableHeaderTradeDelivery>')
    expect(xml).not.toContain('ActualDeliverySupplyChainEvent')
  })

  it('preserves structured country and up to three address lines', () => {
    const xml = generateZugferdXml(createTestInvoice({ seller: { ...createTestInvoice().seller, address: 'Abteilung\nHauptstraße 1\nGebäude B', countryCode: 'DE', zipCode: '80331', city: 'München' }, buyer: { ...createTestInvoice().buyer, address: 'Rue Principale 4\nEtage 2', countryCode: 'FR', zipCode: '75001', city: 'Paris' } }))
    expect(xml).toContain('<ram:LineOne>Abteilung</ram:LineOne>')
    expect(xml).toContain('<ram:LineTwo>Hauptstraße 1</ram:LineTwo>')
    expect(xml).toContain('<ram:LineThree>Gebäude B</ram:LineThree>')
    expect(xml).toContain('<ram:CountryID>FR</ram:CountryID>')
    expect(xml).toContain('<ram:PostcodeCode>75001</ram:PostcodeCode>')
  })

  it('rejects unsupported country/currency codes instead of exporting them', () => {
    const validation = validateZugferdData(createTestInvoice({ currency: 'ZZZ', seller: { ...createTestInvoice().seller, countryCode: 'ZZ' } }))
    expect(validation.isValid).toBe(false)
    expect(validation.errors.map(issue => issue.field)).toEqual(expect.arrayContaining(['currency', 'seller.countryCode']))
  })

  it('keeps quantity and price precision while using the rounded line net', () => {
    const xml = generateZugferdXml(createTestInvoice({ items: [{ description: 'Teilmenge', quantity: 0.333, unitPrice: 100.1234, total: 33.34, taxRate: 0 }], netAmount: 33.34 }))
    expect(xml).toContain('<ram:BilledQuantity unitCode="C62">0.333</ram:BilledQuantity>')
    expect(xml).toContain('<ram:ChargeAmount>100.1234</ram:ChargeAmount>')
    expect(xml).toContain('<ram:LineTotalAmount>33.34</ram:LineTotalAmount>')
  })

  it('rounds tax once per category and rate after grouping rounded line bases', () => {
    const xml = generateZugferdXml(createTestInvoice({ taxMode: 'standard', items: [{ description: 'A', quantity: 1, unitPrice: 0.03, total: 0.03, taxRate: 19, taxCategory: 'S' }, { description: 'B', quantity: 1, unitPrice: 0.03, total: 0.03, taxRate: 19, taxCategory: 'S' }], netAmount: 0.06, taxAmount: 0.01 }))
    expect(xml).toContain('<ram:BasisAmount>0.06</ram:BasisAmount>')
    expect(xml).toContain('<ram:CalculatedAmount>0.01</ram:CalculatedAmount>')
    expect(xml).toContain('<ram:TaxTotalAmount currencyID="EUR">0.01</ram:TaxTotalAmount>')
    expect(xml).toContain('<ram:GrandTotalAmount>0.07</ram:GrandTotalAmount>')
  })

  it('requires explicit standard zero-tax semantics and preserves the exemption reason', () => {
    const missingReason = validateZugferdData(createTestInvoice({ taxMode: 'standard', items: [{ description: 'E', quantity: 1, unitPrice: 100, total: 100, taxRate: 0, taxCategory: 'E' }], netAmount: 100 }))
    expect(missingReason.isValid).toBe(false)
    const xml = generateZugferdXml(createTestInvoice({ taxMode: 'standard', items: [{ description: 'E', quantity: 1, unitPrice: 100, total: 100, taxRate: 0, taxCategory: 'E', exemptionReason: 'Steuerbefreit nach nationalem Recht' }], netAmount: 100 }))
    expect(xml).toContain('Steuerbefreit nach nationalem Recht')
  })

  it('requires §19 semantics in small-business mode', () => {
    const validation = validateZugferdData(createTestInvoice({ items: [{ description: 'Nicht zulässig', quantity: 1, unitPrice: 100, total: 100, taxRate: 19, taxCategory: 'S' }], netAmount: 100, taxAmount: 19 }))
    expect(validation.isValid).toBe(false)
    expect(validation.errors.some(issue => issue.field === 'items.0')).toBe(true)
  })

  it('requires an account for transfer and payment terms for a positive payable amount', () => {
    const validation = validateZugferdData(createTestInvoice({ seller: { ...createTestInvoice().seller, iban: undefined }, dueDate: undefined, paymentTerms: undefined }))
    expect(validation.isValid).toBe(false)
    expect(validation.errors.map(issue => issue.field)).toEqual(expect.arrayContaining(['seller.iban', 'paymentTerms']))
  })

  it('supports cash payment without an IBAN', () => {
    const xml = generateZugferdXml(createTestInvoice({ paymentMeansCode: '10', seller: { ...createTestInvoice().seller, iban: undefined } }))
    expect(xml).toContain('<ram:TypeCode>10</ram:TypeCode>')
    expect(xml).not.toContain('<ram:IBANID>')
  })

  it('accepts a separate electronic buyer address for XRechnung', () => {
    const xml = generateZugferdXml(createTestInvoice({ buyerReference: '04011000-12345-67', buyer: { ...createTestInvoice().buyer, email: undefined, electronicAddress: { value: '991-123456789', schemeId: '9930' } } }), { profile: 'xrechnung' })
    expect(xml).toContain('schemeID="9930"')
    expect(xml).toContain('991-123456789')
  })

  it('rejects XRechnung without seller contact email or buyer electronic address', () => {
    const validation = validateZugferdData(createTestInvoice({ buyerReference: '04011000-12345-67', seller: { ...createTestInvoice().seller, email: undefined }, buyer: { ...createTestInvoice().buyer, email: undefined } }), { profile: 'xrechnung' })
    expect(validation.isValid).toBe(false)
    expect(validation.errors.map(issue => issue.field)).toEqual(expect.arrayContaining(['seller.email', 'buyer.electronicAddress']))
  })

  it('escapes XML text and attribute values', () => {
    const xml = generateZugferdXml(createTestInvoice({
      invoiceNumber: 'RE&<>' + '"\'',
      seller: { ...createTestInvoice().seller, name: 'Müller & <Partner>', bic: 'BIC&"' },
      buyer: { ...createTestInvoice().buyer, name: 'Kunde <AG> & Co.' },
      items: [{ description: 'Leistung "A" & B <C>', quantity: 1, unitPrice: 10, total: 10, taxRate: 0 }],
      netAmount: 10,
    }))
    expect(xml).toContain('RE&amp;&lt;&gt;&quot;&apos;')
    expect(xml).toContain('Müller &amp; &lt;Partner&gt;')
    expect(xml).toContain('Leistung &quot;A&quot; &amp; B &lt;C&gt;')
    expect(xml).toContain('BIC&amp;&quot;')
  })

  it('hard-fails missing required fields, invalid dates, non-finite values, and inconsistent totals', () => {
    const base = createTestInvoice()
    const validation = validateZugferdData({
      ...base,
      invoiceNumber: '',
      date: new Date('invalid'),
      items: [{ ...base.items[0], quantity: Number.NaN, total: 1 }],
      netAmount: 999,
    })
    expect(validation.isValid).toBe(false)
    expect(validation.errors.map(issue => issue.field)).toEqual(expect.arrayContaining(['invoiceNumber', 'date', 'items.0.quantity', 'items']))
  })

  it('rejects an address with more than three lines or an unknown unit', () => {
    const validation = validateZugferdData(createTestInvoice({
      seller: { ...createTestInvoice().seller, address: 'A\nB\nC\nD', zipCode: '12345', city: 'Berlin' },
      items: [{ ...createTestInvoice().items[0], unit: 'Kiste' }],
    }))
    expect(validation.errors.map(issue => issue.field)).toEqual(expect.arrayContaining(['seller.address', 'items.0.unit']))
  })

  it('normalizes grouped IBAN whitespace and supports SEPA credit transfer code 58', () => {
    const xml = generateZugferdXml(createTestInvoice({
      paymentMeansCode: '58',
      seller: { ...createTestInvoice().seller, iban: 'DE89 3704 0044 0532 0130 00' },
    }))
    expect(xml).toContain('<ram:TypeCode>58</ram:TypeCode>')
    expect(xml).toContain('<ram:IBANID>DE89370400440532013000</ram:IBANID>')
  })

  it('requires a bank account for transfer even when the amount is zero', () => {
    const validation = validateZugferdData(createTestInvoice({
      seller: { ...createTestInvoice().seller, iban: undefined },
      netAmount: 0,
      taxAmount: 0,
      items: [{ description: 'Nullbetrag', quantity: 1, unitPrice: 0, total: 0, taxRate: 0 }],
    }))
    expect(validation.errors.map(issue => issue.field)).toContain('seller.iban')
  })
})
