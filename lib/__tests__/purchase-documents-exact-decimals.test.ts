import { describe, expect, it } from 'vitest';
import { parsePurchaseBytes } from '@/lib/purchase-documents/parser';
import { parseEInvoiceXml, parseEInvoiceXmlWithExactDecimals } from '@/lib/e-invoice-parser';

const ubl = (amount: string, extra = '', currency = 'EUR') => `<Invoice><ID>PRECISION</ID><IssueDate>2026-10-20</IssueDate><DocumentCurrencyCode>${currency}</DocumentCurrencyCode><LegalMonetaryTotal><TaxInclusiveAmount>${amount}</TaxInclusiveAmount><PayableAmount>${amount}</PayableAmount>${extra}</LegalMonetaryTotal></Invoice>`;
const cii = (amount: string, extra = '') => `<CrossIndustryInvoice><ExchangedDocument><ID>CII-EXACT</ID><TypeCode>380</TypeCode><IssueDateTime><DateTimeString>20261020</DateTimeString></IssueDateTime></ExchangedDocument><SupplyChainTradeTransaction><ApplicableHeaderTradeSettlement><InvoiceCurrencyCode>EUR</InvoiceCurrencyCode><SpecifiedTradeSettlementHeaderMonetarySummation><GrandTotalAmount>${amount}</GrandTotalAmount><DuePayableAmount>${amount}</DuePayableAmount>${extra}</SpecifiedTradeSettlementHeaderMonetarySummation></ApplicableHeaderTradeSettlement></SupplyChainTradeTransaction></CrossIndustryInvoice>`;
const parse = (xml: string) => parsePurchaseBytes('application/xml', Buffer.from(xml));

describe('exact source decimals in incoming previews', () => {
  it.each([ubl, cii])('preserves source cents and blocks a safe-integer-cent value that loses a cent in Float', async source => {
    const amount = '90071992547409.91';
    const result = await parse(source(amount));
    expect(result.parseStatus).toBe('PARSED');
    expect(result.preview).toMatchObject({ grossAmount: amount, dueAmount: amount, approvalSupported: false });
    expect(result.preview?.parserWarnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_AMOUNT' }));
  });
  it.each([ubl, cii])('never erases a subcent tail when Number conversion would round to an integer', async source => {
    const amount = '100.000000000000000001';
    const result = await parse(source(amount));
    expect(result.preview).toMatchObject({ grossAmount: amount, dueAmount: amount, approvalSupported: false });
    expect(result.preview?.parserWarnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_AMOUNT' }));
  });
  it.each(['119.00', '0.01', '100.000000000000000000', '+.50', '100.'])('accepts exact representable cent totals without reconstructing source digits (%s)', async amount => {
    const result = await parse(ubl(amount));
    expect(result.preview?.approvalSupported).toBe(true);
    expect(result.preview?.grossAmount).toBe(amount === '+.50' ? '0.50' : amount === '100.' ? '100' : amount);
    expect(result.preview?.parserWarnings.some(warning => warning.code === 'UNSUPPORTED_AMOUNT')).toBe(false);
  });
  it.each([
    '<PrepaidAmount>0.000000000000000001</PrepaidAmount>',
    '<PayableRoundingAmount>0.000000000000000001</PayableRoundingAmount>',
    '<TaxExclusiveAmount>100.000000000000000001</TaxExclusiveAmount>',
    '<LineExtensionAmount>100.000000000000000001</LineExtensionAmount>',
  ])('checks exact optional header money before permissive legacy tolerances (%s)', async extra => {
    const result = await parse(ubl('119.00', extra));
    expect(result.preview?.approvalSupported).toBe(false);
    expect(result.preview?.parserWarnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_AMOUNT' }));
  });
  it('preserves exact line quantity, price, amount and tax-rate lexemes independently of Number', async () => {
    const xml = ubl('119.00').replace('</Invoice>', '<InvoiceLine><InvoicedQuantity>1.000000000000000001</InvoicedQuantity><LineExtensionAmount>90071992547409.91</LineExtensionAmount><Price><PriceAmount>100.000000000000000001</PriceAmount></Price><Item><ClassifiedTaxCategory><Percent>19.000000000000000001</Percent></ClassifiedTaxCategory></Item></InvoiceLine></Invoice>');
    const result = await parse(xml);
    expect(result.preview?.lineItems[0]).toMatchObject({ quantity: '1.000000000000000001', amount: '90071992547409.91', unitPrice: '100.000000000000000001', taxRate: '19.000000000000000001' });
  });
  it('leaves the legacy parser shape unchanged while the new source helper captures exact strings', async () => {
    const source = ubl('100.000000000000000001');
    const legacy = await parseEInvoiceXml(source);
    const exact = await parseEInvoiceXmlWithExactDecimals(source);
    expect(legacy).toEqual(exact.parsed); expect(legacy).not.toHaveProperty('exactDecimals');
    expect(exact.exactDecimals.grossAmount).toBe('100.000000000000000001'); expect(legacy.grossAmount).toBe(100);
  });
  it.each([
    ubl('119.00', '', 'A'.repeat(3_000)),
    ubl('119.00').replace('<ID>PRECISION</ID>', `<ID>${'N'.repeat(256)}</ID>`),
    ubl('119.00').replace('<ID>PRECISION</ID>', `<InvoiceTypeCode>${'T'.repeat(129)}</InvoiceTypeCode><ID>PRECISION</ID>`),
  ])('retains oversize source metadata as FAILED rather than persisting an unrestorable preview', async source => {
    const result = await parse(source);
    expect(result).toMatchObject({ parseStatus: 'FAILED', parseErrorCode: 'PREVIEW_LIMIT_EXCEEDED', preview: null, parsed: null });
  });
});
