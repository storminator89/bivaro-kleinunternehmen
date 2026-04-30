import { describe, expect, it } from 'vitest'
import { buildEInvoiceViewerHtml } from '../e-invoice-viewer'

describe('buildEInvoiceViewerHtml', () => {
    it('renders a simple E-Rechnung preview from parsed XML data', () => {
        const html = buildEInvoiceViewerHtml({
            fileName: 'rechnung.xml',
            invoiceNumber: 'XR-2026-001',
            invoiceDate: new Date('2026-04-30'),
            dueDate: new Date('2026-05-14'),
            totalAmount: 238,
            parsedData: {
                eInvoiceFormat: 'UBL',
                buyerInfo: {
                    name: 'Kunde GmbH',
                    address: 'Kundenstraße 5',
                    zipCode: '20095',
                    city: 'Hamburg',
                    email: 'rechnung@kunde.de',
                },
                sellerInfo: {
                    name: 'Bivaro Testfirma',
                    address: 'Musterstraße 1',
                    zipCode: '12345',
                    city: 'Musterstadt',
                    email: 'rechnung@testfirma.de',
                },
                lineItems: [
                    {
                        positionNumber: '1',
                        description: 'Beratung',
                        quantity: 2,
                        unit: 'HUR',
                        unitPrice: 100,
                        amount: 200,
                        taxRate: 19,
                    },
                ],
            },
        })

        expect(html).toContain('XRechnung / UBL Vorschau')
        expect(html).toContain('XR-2026-001')
        expect(html).toContain('Kunde GmbH')
        expect(html).toContain('Bivaro Testfirma')
        expect(html).toContain('Beratung')
        expect(html).toContain('238,00')
    })

    it('escapes invoice data before rendering HTML', () => {
        const html = buildEInvoiceViewerHtml({
            fileName: 'rechnung.xml',
            invoiceNumber: '<script>alert(1)</script>',
            invoiceDate: null,
            dueDate: null,
            totalAmount: null,
            parsedData: {
                rawXml: '<Invoice />',
                buyerInfo: { name: '<img src=x onerror=alert(1)>' },
                lineItems: [{ description: '<b>Position</b>' }],
            },
        })

        expect(html).not.toContain('<script>alert(1)</script>')
        expect(html).not.toContain('<img src=x onerror=alert(1)>')
        expect(html).not.toContain('<b>Position</b>')
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
        expect(html).toContain('&lt;b&gt;Position&lt;/b&gt;')
    })
})
