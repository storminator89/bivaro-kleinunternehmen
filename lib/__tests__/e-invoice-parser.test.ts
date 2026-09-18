import { describe, expect, it } from 'vitest'
import { generateZugferdXml, type ZugferdData } from '../zugferd-generator'
import { getEInvoiceImportRejection, getRawEInvoiceXml, parseEInvoiceXml } from '../e-invoice-parser'

function createZugferdData(overrides: Partial<ZugferdData> = {}): ZugferdData {
    return {
        invoiceNumber: 'RE-2025-001',
        date: new Date('2025-01-15'),
        dueDate: new Date('2025-02-14'),
        seller: {
            name: 'Bivaro Testfirma',
            address: 'Musterstraße 1\n12345 Musterstadt',
            countryCode: 'DE',
            email: 'rechnung@testfirma.de',
            taxNumber: '123/456/78901',
            iban: 'DE89370400440532013000',
        },
        buyer: {
            name: 'Kunde GmbH',
            address: 'Kundenweg 9',
            email: 'buchhaltung@kunde.de',
            zipCode: '54321',
            city: 'Kundenstadt',
            countryCode: 'DE',
        },
        items: [
            {
                description: 'Beratung',
                quantity: 2,
                unitPrice: 150,
                total: 300,
                unit: 'Stunde',
                taxRate: 0,
            },
        ],
        netAmount: 300,
        taxAmount: 0,
        currency: 'EUR',
        taxMode: 'small-business',
        ...overrides,
    }
}

const ublInvoiceXml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017</cbc:CustomizationID>
  <cbc:ID>XR-2025-77</cbc:ID>
  <cbc:IssueDate>2025-03-01</cbc:IssueDate>
  <cbc:DueDate>2025-03-15</cbc:DueDate>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>Lieferant GmbH</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>Lieferweg 1</cbc:StreetName>
        <cbc:CityName>Berlin</cbc:CityName>
        <cbc:PostalZone>10115</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:Contact><cbc:ElectronicMail>invoice@lieferant.de</cbc:ElectronicMail></cac:Contact>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>Kunde AG</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>Kundenstraße 5</cbc:StreetName>
        <cbc:CityName>Hamburg</cbc:CityName>
        <cbc:PostalZone>20095</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:Contact><cbc:ElectronicMail>rechnung@kunde-ag.de</cbc:ElectronicMail></cac:Contact>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">120.00</cbc:LineExtensionAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">120.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">120.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="HUR">3</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">120.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>Support</cbc:Name>
      <cac:ClassifiedTaxCategory><cbc:Percent>0</cbc:Percent></cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="EUR">40.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</Invoice>`

const ciiPrepaidXml = `<?xml version="1.0" encoding="UTF-8"?>
<CrossIndustryInvoice>
  <ExchangedDocument><ID>CII-PREPAID</ID><TypeCode>380</TypeCode><IssueDateTime><DateTimeString format="102">20250301</DateTimeString></IssueDateTime></ExchangedDocument>
  <SupplyChainTradeTransaction>
    <IncludedSupplyChainTradeLineItem>
      <AssociatedDocumentLineDocument><LineID>1</LineID></AssociatedDocumentLineDocument>
      <SpecifiedTradeProduct><Name>Support</Name></SpecifiedTradeProduct>
      <SpecifiedLineTradeAgreement><NetPriceProductTradePrice><ChargeAmount>5</ChargeAmount><BasisQuantity unitCode="C62">100</BasisQuantity></NetPriceProductTradePrice></SpecifiedLineTradeAgreement>
      <SpecifiedLineTradeDelivery><BilledQuantity unitCode="C62">200</BilledQuantity></SpecifiedLineTradeDelivery>
      <SpecifiedLineTradeSettlement><ApplicableTradeTax><RateApplicablePercent>0</RateApplicablePercent></ApplicableTradeTax><SpecifiedTradeSettlementLineMonetarySummation><LineTotalAmount>10</LineTotalAmount></SpecifiedTradeSettlementLineMonetarySummation></SpecifiedLineTradeSettlement>
    </IncludedSupplyChainTradeLineItem>
    <ApplicableHeaderTradeAgreement><BuyerTradeParty><Name>Kunde</Name><PostalTradeAddress><LineOne>Abteilung</LineOne><LineTwo>Straße 1</LineTwo><LineThree>12345 Ort</LineThree></PostalTradeAddress></BuyerTradeParty></ApplicableHeaderTradeAgreement>
    <ApplicableHeaderTradeSettlement><InvoiceCurrencyCode>USD</InvoiceCurrencyCode><SpecifiedTradeSettlementHeaderMonetarySummation><LineTotalAmount>10</LineTotalAmount><TaxBasisTotalAmount>10</TaxBasisTotalAmount><TaxTotalAmount currencyID="USD">0</TaxTotalAmount><GrandTotalAmount currencyID="USD">100</GrandTotalAmount><TotalPrepaidAmount currencyID="USD">40</TotalPrepaidAmount><DuePayableAmount currencyID="USD">60</DuePayableAmount></SpecifiedTradeSettlementHeaderMonetarySummation></ApplicableHeaderTradeSettlement>
  </SupplyChainTradeTransaction>
</CrossIndustryInvoice>`

const ublPrepaidXml = ublInvoiceXml
    .replace('<cbc:IssueDate>2025-03-01</cbc:IssueDate>', '<cbc:IssueDate>2025-03-01</cbc:IssueDate><cbc:DocumentCurrencyCode>USD</cbc:DocumentCurrencyCode>')
    .replace('<cbc:TaxInclusiveAmount currencyID="EUR">120.00</cbc:TaxInclusiveAmount>', '<cbc:TaxInclusiveAmount currencyID="USD">100.00</cbc:TaxInclusiveAmount>')
    .replace('<cbc:PayableAmount currencyID="EUR">120.00</cbc:PayableAmount>', '<cbc:PrepaidAmount currencyID="USD">40.00</cbc:PrepaidAmount><cbc:PayableAmount currencyID="USD">60.00</cbc:PayableAmount>')

const ublCreditNoteXml = ublInvoiceXml
    .replace('<Invoice xmlns=', '<CreditNote xmlns=')
    .replace('</Invoice>', '</CreditNote>')
    .replace('<cbc:ID>XR-2025-77</cbc:ID>', '<cbc:ID>CN-2025-77</cbc:ID><cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>')
    .replace(/InvoiceLine/g, 'CreditNoteLine')
    .replace(/InvoicedQuantity/g, 'CreditedQuantity')

describe('parseEInvoiceXml', () => {
    it('parses ZUGFeRD/Factur-X CII XML generated by the app', async () => {
        const xml = generateZugferdXml(createZugferdData())
        const parsed = await parseEInvoiceXml(xml)

        expect(parsed.format).toBe('CII')
        expect(parsed.invoiceNumber).toBe('RE-2025-001')
        expect(parsed.invoiceDate?.toISOString()).toContain('2025-01-15')
        expect(parsed.dueDate?.toISOString()).toContain('2025-02-14')
        expect(parsed.totalAmount).toBe(300)
        expect(parsed.customerName).toBe('Kunde GmbH')
        expect(parsed.buyerInfo).toMatchObject({
            email: 'buchhaltung@kunde.de',
            address: 'Kundenweg 9',
            zipCode: '54321',
            city: 'Kundenstadt',
            country: 'DE',
        })
        expect(parsed.sellerInfo.name).toBe('Bivaro Testfirma')
        expect(parsed.lineItems).toEqual([
            expect.objectContaining({
                positionNumber: '1',
                description: 'Beratung',
                quantity: 2,
                unit: 'HUR',
                unitPrice: 150,
                amount: 300,
                taxRate: 0,
            }),
        ])
        expect(parsed.rawXml).toContain('<rsm:CrossIndustryInvoice')
    })

    it('parses standalone XRechnung UBL invoice XML', async () => {
        const parsed = await parseEInvoiceXml(ublInvoiceXml)

        expect(parsed.format).toBe('UBL')
        expect(parsed.invoiceNumber).toBe('XR-2025-77')
        expect(parsed.invoiceDate?.toISOString()).toContain('2025-03-01')
        expect(parsed.dueDate?.toISOString()).toContain('2025-03-15')
        expect(parsed.totalAmount).toBe(120)
        expect(parsed.customerName).toBe('Kunde AG')
        expect(parsed.buyerInfo).toMatchObject({
            email: 'rechnung@kunde-ag.de',
            address: 'Kundenstraße 5',
            zipCode: '20095',
            city: 'Hamburg',
            country: 'DE',
        })
        expect(parsed.sellerInfo.name).toBe('Lieferant GmbH')
        expect(parsed.lineItems[0]).toMatchObject({
            positionNumber: '1',
            description: 'Support',
            quantity: 3,
            unit: 'HUR',
            unitPrice: 40,
            amount: 120,
            taxRate: 0,
        })
    })

    it('keeps gross total separate from prepayment in both syntaxes', async () => {
        const cii = await parseEInvoiceXml(ciiPrepaidXml)
        const ubl = await parseEInvoiceXml(ublPrepaidXml)

        expect(cii).toMatchObject({ currency: 'USD', grossAmount: 100, prepaidAmount: 40, dueAmount: 60, totalAmount: 100 })
        expect(ubl).toMatchObject({ currency: 'USD', grossAmount: 100, prepaidAmount: 40, dueAmount: 60, totalAmount: 100 })
        expect(getEInvoiceImportRejection(cii)).toContain('währung')
        expect(cii.lineItems[0]).toMatchObject({ quantity: 200, unitPrice: 5, baseQuantity: 100, amount: 10 })
        expect(cii.buyerInfo.addressLines).toEqual(['Abteilung', 'Straße 1', '12345 Ort'])
    })

    it('represents UBL CreditNote as a credit note instead of an invoice', async () => {
        const parsed = await parseEInvoiceXml(ublCreditNoteXml)

        expect(parsed.documentType).toBe('CREDIT_NOTE')
        expect(parsed.documentTypeCode).toBe('381')
        expect(getEInvoiceImportRejection(parsed)).toContain('Gutschriften')
    })

    it('does not infer invoice type for an unknown explicit document code', async () => {
        const parsed = await parseEInvoiceXml(ublInvoiceXml.replace('<cbc:ID>XR-2025-77</cbc:ID>', '<cbc:InvoiceTypeCode>999</cbc:InvoiceTypeCode><cbc:ID>XR-2025-77</cbc:ID>'))

        expect(parsed.documentType).toBe('UNKNOWN')
        expect(getEInvoiceImportRejection(parsed)).toContain('Dokumenttyp')
    })

    it('rejects unsupported XML structures', async () => {
        await expect(parseEInvoiceXml('<root><id>1</id></root>')).rejects.toThrow('Unbekannte E-Rechnungsstruktur')
    })
})

describe('getRawEInvoiceXml', () => {
    it('returns stored raw XML from objects and JSON strings', () => {
        expect(getRawEInvoiceXml({ rawXml: '<Invoice />' })).toBe('<Invoice />')
        expect(getRawEInvoiceXml(JSON.stringify({ rawXml: '<Invoice />' }))).toBe('<Invoice />')
    })

    it('returns null when no raw XML is available', () => {
        expect(getRawEInvoiceXml({ rawXml: 'not xml' })).toBeNull()
        expect(getRawEInvoiceXml('{invalid json')).toBeNull()
        expect(getRawEInvoiceXml(null)).toBeNull()
    })
})
