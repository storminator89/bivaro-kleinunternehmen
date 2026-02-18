import { describe, it, expect } from 'vitest'
import { generateZugferdXml, ZugferdData } from '../zugferd-generator'

// Helper to create minimal valid ZUGFeRD data
function createTestInvoice(overrides: Partial<ZugferdData> = {}): ZugferdData {
    return {
        invoiceNumber: 'RE-2024-001',
        date: new Date('2024-01-15'),
        dueDate: new Date('2024-02-15'),
        seller: {
            name: 'Max Mustermann',
            address: 'Musterstraße 1\n12345 Musterstadt',
            email: 'max@example.de',
            telephone: '+49 123 456789',
            taxNumber: '123/456/78901',
            iban: 'DE89370400440532013000',
            bic: 'COBADEFFXXX',
        },
        buyer: {
            name: 'Kunde GmbH',
            address: 'Kundenweg 99',
            email: 'info@kunde.de',
            zipCode: '54321',
            city: 'Kundenstadt',
        },
        items: [
            {
                description: 'Webentwicklung',
                quantity: 10,
                unitPrice: 100,
                total: 1000,
                unit: 'Stunde',
                taxRate: 0,
            },
        ],
        netAmount: 1000,
        taxAmount: 0, // Kleinunternehmer
        currency: 'EUR',
        ...overrides,
    }
}

describe('generateZugferdXml', () => {
    describe('XML Structure', () => {
        it('should generate valid XML with correct declaration', () => {
            const xml = generateZugferdXml(createTestInvoice())
            expect(xml).toMatch(/^\s*<\?xml version="1\.0" encoding="UTF-8"\?>/)
        })

        it('should include Factur-X EN 16931 guideline ID', () => {
            const xml = generateZugferdXml(createTestInvoice())
            expect(xml).toContain('urn:cen.eu:en16931:2017')
            // Should NOT contain the old XRechnung or extended Factur-X URIs
            expect(xml).not.toContain('xrechnung')
        })

        it('should use CrossIndustryInvoice namespace', () => {
            const xml = generateZugferdXml(createTestInvoice())
            expect(xml).toContain('xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"')
        })
    })

    describe('Invoice Number and Dates', () => {
        it('should include invoice number', () => {
            const xml = generateZugferdXml(createTestInvoice({ invoiceNumber: 'RE-2024-TEST-123' }))
            expect(xml).toContain('<ram:ID>RE-2024-TEST-123</ram:ID>')
        })

        it('should use invoice number as BuyerReference', () => {
            const xml = generateZugferdXml(createTestInvoice({ invoiceNumber: 'RE-2024-REF' }))
            expect(xml).toContain('<ram:BuyerReference>RE-2024-REF</ram:BuyerReference>')
        })

        it('should format date as YYYYMMDD (format 102)', () => {
            const xml = generateZugferdXml(createTestInvoice({ date: new Date('2024-03-15') }))
            expect(xml).toContain('<udt:DateTimeString format="102">20240315</udt:DateTimeString>')
        })

        it('should include due date when provided', () => {
            const xml = generateZugferdXml(createTestInvoice({ dueDate: new Date('2024-04-30') }))
            expect(xml).toContain('20240430')
            expect(xml).toContain('SpecifiedTradePaymentTerms')
        })

        it('should omit payment terms block when dueDate is not set', () => {
            const xml = generateZugferdXml(createTestInvoice({ dueDate: undefined }))
            expect(xml).not.toContain('SpecifiedTradePaymentTerms')
        })
    })

    describe('Seller Information', () => {
        it('should include seller name', () => {
            const xml = generateZugferdXml(createTestInvoice({
                seller: { ...createTestInvoice().seller, name: 'Musterfirma GmbH' }
            }))
            expect(xml).toContain('<ram:Name>Musterfirma GmbH</ram:Name>')
        })

        it('should include seller tax number with FC scheme', () => {
            const xml = generateZugferdXml(createTestInvoice({
                seller: { ...createTestInvoice().seller, taxNumber: '123/456/78901' }
            }))
            expect(xml).toContain('<ram:ID schemeID="FC">123/456/78901</ram:ID>')
        })

        it('should not duplicate tax number as party ID', () => {
            const xml = generateZugferdXml(createTestInvoice({
                seller: { ...createTestInvoice().seller, taxNumber: '123/456/78901' }
            }))
            // taxNumber should appear as ram:ID (seller identifier for BR-CO-26) AND in SpecifiedTaxRegistration
            expect(xml).toContain('<ram:ID>123/456/78901</ram:ID>')
            expect(xml).toContain('<ram:ID schemeID="FC">123/456/78901</ram:ID>')
        })

        it('should include IBAN in payment means', () => {
            const xml = generateZugferdXml(createTestInvoice({
                seller: { ...createTestInvoice().seller, iban: 'DE89370400440532013000' }
            }))
            expect(xml).toContain('<ram:IBANID>DE89370400440532013000</ram:IBANID>')
        })

        it('should include BIC in payment means', () => {
            const xml = generateZugferdXml(createTestInvoice({
                seller: { ...createTestInvoice().seller, bic: 'COBADEFFXXX' }
            }))
            expect(xml).toContain('<ram:BICID>COBADEFFXXX</ram:BICID>')
        })

        it('should parse address into postcode and city', () => {
            const xml = generateZugferdXml(createTestInvoice({
                seller: { ...createTestInvoice().seller, address: 'Hauptstr. 10\n80331 München' }
            }))
            expect(xml).toContain('<ram:PostcodeCode>80331</ram:PostcodeCode>')
            expect(xml).toContain('<ram:CityName>München</ram:CityName>')
        })
    })

    describe('Buyer Information', () => {
        it('should include buyer name', () => {
            const xml = generateZugferdXml(createTestInvoice({
                buyer: { name: 'Test Käufer AG', zipCode: '12345', city: 'Berlin' }
            }))
            expect(xml).toContain('<ram:Name>Test Käufer AG</ram:Name>')
        })

        it('should use separate zipCode and city if provided', () => {
            const xml = generateZugferdXml(createTestInvoice({
                buyer: { name: 'Kunde', address: 'Straße 1', zipCode: '87654', city: 'Hamburg' }
            }))
            expect(xml).toContain('<ram:PostcodeCode>87654</ram:PostcodeCode>')
            expect(xml).toContain('<ram:CityName>Hamburg</ram:CityName>')
        })
    })

    describe('Line Items', () => {
        it('should include item description', () => {
            const xml = generateZugferdXml(createTestInvoice({
                items: [{ description: 'Beratungsleistung', quantity: 5, unitPrice: 150, total: 750, taxRate: 0 }]
            }))
            expect(xml).toContain('<ram:Name>Beratungsleistung</ram:Name>')
        })

        it('should format amounts with 2 decimal places', () => {
            const xml = generateZugferdXml(createTestInvoice({
                items: [{ description: 'Test', quantity: 1, unitPrice: 99.99, total: 99.99, taxRate: 0 }]
            }))
            expect(xml).toContain('<ram:ChargeAmount>99.99</ram:ChargeAmount>')
            expect(xml).toContain('<ram:LineTotalAmount>99.99</ram:LineTotalAmount>')
        })

        it('should use correct unit codes', () => {
            const xml = generateZugferdXml(createTestInvoice({
                items: [{ description: 'Test', quantity: 8, unitPrice: 100, total: 800, unit: 'Stunde', taxRate: 0 }]
            }))
            expect(xml).toContain('unitCode="HUR"') // HUR = Hour
        })

        it('should use C62 (piece) as default unit code', () => {
            const xml = generateZugferdXml(createTestInvoice({
                items: [{ description: 'Test', quantity: 1, unitPrice: 100, total: 100, taxRate: 0 }]
            }))
            expect(xml).toContain('unitCode="C62"')
        })

        it('should number line items sequentially', () => {
            const xml = generateZugferdXml(createTestInvoice({
                items: [
                    { description: 'Item 1', quantity: 1, unitPrice: 100, total: 100, taxRate: 0 },
                    { description: 'Item 2', quantity: 2, unitPrice: 50, total: 100, taxRate: 0 },
                ]
            }))
            expect(xml).toContain('<ram:LineID>1</ram:LineID>')
            expect(xml).toContain('<ram:LineID>2</ram:LineID>')
        })
    })

    describe('Kleinunternehmer (Small Business) Handling', () => {
        it('should include § 19 UStG exemption reason when taxAmount is 0', () => {
            const xml = generateZugferdXml(createTestInvoice({ taxAmount: 0 }))
            expect(xml).toContain('Kleinunternehmer gemäß § 19 UStG')
        })

        it('should use tax category code E (exempt) for Kleinunternehmer', () => {
            const xml = generateZugferdXml(createTestInvoice({ taxAmount: 0 }))
            expect(xml).toContain('<ram:CategoryCode>E</ram:CategoryCode>')
        })

        it('should NOT include ExemptionReasonCode (§ 19 UStG has no VATEX code)', () => {
            const xml = generateZugferdXml(createTestInvoice({ taxAmount: 0 }))
            expect(xml).not.toContain('ExemptionReasonCode')
        })

        it('should set tax rate to 0.00 for Kleinunternehmer', () => {
            const xml = generateZugferdXml(createTestInvoice({ taxAmount: 0 }))
            expect(xml).toContain('<ram:RateApplicablePercent>0.00</ram:RateApplicablePercent>')
        })

        it('should NOT include exemption reason when tax applies', () => {
            const xml = generateZugferdXml(createTestInvoice({
                taxAmount: 190,
                netAmount: 1000,
                items: [{ description: 'Test', quantity: 1, unitPrice: 1000, total: 1000, taxRate: 19 }]
            }))
            expect(xml).not.toContain('§ 19 UStG')
            expect(xml).toContain('<ram:CategoryCode>S</ram:CategoryCode>') // Standard rate
        })
    })

    describe('Monetary Totals', () => {
        it('should include all required monetary summation fields', () => {
            const xml = generateZugferdXml(createTestInvoice({ netAmount: 1500, taxAmount: 0 }))
            expect(xml).toContain('<ram:LineTotalAmount>1500.00</ram:LineTotalAmount>')
            expect(xml).toContain('<ram:TaxBasisTotalAmount>1500.00</ram:TaxBasisTotalAmount>')
            expect(xml).toContain('<ram:GrandTotalAmount>1500.00</ram:GrandTotalAmount>')
            expect(xml).toContain('<ram:DuePayableAmount>1500.00</ram:DuePayableAmount>')
        })

        it('should include tax total with currency attribute', () => {
            const xml = generateZugferdXml(createTestInvoice({ currency: 'EUR', taxAmount: 0 }))
            expect(xml).toContain('<ram:TaxTotalAmount currencyID="EUR">0.00</ram:TaxTotalAmount>')
        })

        it('should calculate GrandTotalAmount as netAmount + taxAmount', () => {
            const xml = generateZugferdXml(createTestInvoice({
                netAmount: 1000,
                taxAmount: 190,
                items: [{ description: 'Test', quantity: 1, unitPrice: 1000, total: 1000, taxRate: 19 }]
            }))
            expect(xml).toContain('<ram:GrandTotalAmount>1190.00</ram:GrandTotalAmount>')
        })
    })

    describe('Tax Grouping (Header Level)', () => {
        it('should group taxes by category and rate', () => {
            const xml = generateZugferdXml(createTestInvoice({
                netAmount: 900,
                taxAmount: 133,
                items: [
                    { description: 'Item 1', quantity: 1, unitPrice: 500, total: 500, taxRate: 19 },
                    { description: 'Item 2', quantity: 1, unitPrice: 400, total: 400, taxRate: 7 },
                ]
            }))
            // Should have two separate ApplicableTradeTax blocks
            const taxBlocks = xml.match(/<ram:ApplicableTradeTax>/g)
            // Header-level blocks + line-level blocks = at least 4
            expect(taxBlocks!.length).toBeGreaterThanOrEqual(4)
            expect(xml).toContain('<ram:RateApplicablePercent>19.00</ram:RateApplicablePercent>')
            expect(xml).toContain('<ram:RateApplicablePercent>7.00</ram:RateApplicablePercent>')
        })
    })

    describe('XML Escaping (Security)', () => {
        it('should escape special characters in invoice number', () => {
            const xml = generateZugferdXml(createTestInvoice({ invoiceNumber: 'RE&<>"\'2024' }))
            expect(xml).toContain('RE&amp;&lt;&gt;&quot;&apos;2024')
        })

        it('should escape special characters in seller name', () => {
            const xml = generateZugferdXml(createTestInvoice({
                seller: { ...createTestInvoice().seller, name: 'Müller & Partner <GmbH>' }
            }))
            expect(xml).toContain('Müller &amp; Partner &lt;GmbH&gt;')
        })

        it('should escape special characters in item descriptions', () => {
            const xml = generateZugferdXml(createTestInvoice({
                items: [{ description: 'Entwicklung "App" & Beratung', quantity: 1, unitPrice: 500, total: 500, taxRate: 0 }]
            }))
            expect(xml).toContain('Entwicklung &quot;App&quot; &amp; Beratung')
        })
    })

    describe('Currency', () => {
        it('should include invoice currency code', () => {
            const xml = generateZugferdXml(createTestInvoice({ currency: 'EUR' }))
            expect(xml).toContain('<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>')
        })
    })

    describe('Payment Means', () => {
        it('should omit IBAN when not provided', () => {
            const xml = generateZugferdXml(createTestInvoice({
                seller: { ...createTestInvoice().seller, iban: undefined, bic: undefined }
            }))
            expect(xml).not.toContain('<ram:IBANID>')
            expect(xml).toContain('<ram:TypeCode>30</ram:TypeCode>')
        })
    })
})
