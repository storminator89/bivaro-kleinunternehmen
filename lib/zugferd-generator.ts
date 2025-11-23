
export interface ZugferdData {
  invoiceNumber: string;
  date: Date;
  dueDate?: Date;
  deliveryDate?: Date;
  seller: {
    name: string;
    address?: string;
    email?: string;
    telephone?: string;
    taxNumber?: string;
    vatId?: string;
    iban?: string;
    bic?: string;
  };
  buyer: {
    name: string;
    address?: string;
    email?: string;
    zipCode?: string;
    city?: string;
  };
  items: {
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }[];
  totalAmount: number;
  taxAmount: number; // Usually 0 for small businesses
  currency: string;
}

function formatDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

export function generateZugferdXml(data: ZugferdData): string {
  const issueDate = formatDate(data.date);
  const dueDate = data.dueDate ? formatDate(data.dueDate) : '';
  const deliveryDate = data.deliveryDate ? formatDate(data.deliveryDate) : issueDate;

  // Hilfsfunktion zum Escapen von Sonderzeichen (für ALLE Textfelder nutzen!)
  const escapeXml = (str: string) => str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  const formatAmt = (num: number) => num.toFixed(2);

  // Adress-Parsing (wie gehabt, nur mit escapeXml beim Einfügen)
  const parseAddress = (addrStr?: string) => {
    const lines = (addrStr || '').split('\n').map(l => l.trim()).filter(l => l);
    const countryCode = 'DE'; 
    let cityName = '';
    let postcode = '';
    let lineOne = '';
    
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1];
      const match = lastLine.match(/^(\d{5})\s+(.+)$/);
      if (match) {
        postcode = match[1];
        cityName = match[2];
        lines.pop(); 
      }
      lineOne = lines[0] || '';
    }
    return { lineOne, postcode, cityName, countryCode };
  };

  const sellerAddr = parseAddress(data.seller.address);
  const buyerAddr = data.buyer.zipCode && data.buyer.city 
    ? { 
        lineOne: data.buyer.address?.split('\n')[0] || '', // Fallback if address is just street
        postcode: data.buyer.zipCode, 
        cityName: data.buyer.city, 
        countryCode: 'DE' 
      }
    : parseAddress(data.buyer.address);

  // WICHTIG für Kleinunternehmer: Der Hinweistext
  // Dies muss exakt der Text sein, der auch auf der PDF steht (oder sinngemäß)
  const exemptionReason = "Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG.";

  const itemsXml = data.items.map((item, index) => `
      <ram:IncludedSupplyChainTradeLineItem>
        <ram:AssociatedDocumentLineDocument>
          <ram:LineID>${index + 1}</ram:LineID>
        </ram:AssociatedDocumentLineDocument>
        <ram:SpecifiedTradeProduct>
          <ram:Name>${escapeXml(item.description)}</ram:Name>
        </ram:SpecifiedTradeProduct>
        <ram:SpecifiedLineTradeAgreement>
          <ram:NetPriceProductTradePrice>
            <ram:ChargeAmount>${formatAmt(item.unitPrice)}</ram:ChargeAmount>
          </ram:NetPriceProductTradePrice>
        </ram:SpecifiedLineTradeAgreement>
        <ram:SpecifiedLineTradeDelivery>
          <ram:BilledQuantity unitCode="C62">${formatAmt(item.quantity)}</ram:BilledQuantity>
        </ram:SpecifiedLineTradeDelivery>
        <ram:SpecifiedLineTradeSettlement>
          <ram:ApplicableTradeTax>
            <ram:TypeCode>VAT</ram:TypeCode>
            <ram:CategoryCode>E</ram:CategoryCode>
            <ram:RateApplicablePercent>0.00</ram:RateApplicablePercent>
          </ram:ApplicableTradeTax>
          <ram:SpecifiedTradeSettlementLineMonetarySummation>
            <ram:LineTotalAmount>${formatAmt(item.total)}</ram:LineTotalAmount>
          </ram:SpecifiedTradeSettlementLineMonetarySummation>
        </ram:SpecifiedLineTradeSettlement>
      </ram:IncludedSupplyChainTradeLineItem>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:BusinessProcessSpecifiedDocumentContextParameter>
      <ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID>
    </ram:BusinessProcessSpecifiedDocumentContextParameter>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_3.0</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${escapeXml(data.invoiceNumber)}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">${issueDate}</udt:DateTimeString>
    </ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    ${itemsXml}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:BuyerReference>Leitweg-ID</ram:BuyerReference>
      <ram:SellerTradeParty>
        ${data.seller.taxNumber ? `<ram:ID>${escapeXml(data.seller.taxNumber)}</ram:ID>` : ''}
        <ram:Name>${escapeXml(data.seller.name)}</ram:Name>
        <ram:DefinedTradeContact>
          <ram:PersonName>${escapeXml(data.seller.name)}</ram:PersonName>
          ${data.seller.telephone ? `<ram:TelephoneUniversalCommunication>
            <ram:CompleteNumber>${escapeXml(data.seller.telephone)}</ram:CompleteNumber>
          </ram:TelephoneUniversalCommunication>` : ''}
          ${data.seller.email ? `<ram:EmailURIUniversalCommunication>
            <ram:URIID>${escapeXml(data.seller.email)}</ram:URIID>
          </ram:EmailURIUniversalCommunication>` : ''}
        </ram:DefinedTradeContact>
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>${escapeXml(sellerAddr.postcode)}</ram:PostcodeCode>
          <ram:LineOne>${escapeXml(sellerAddr.lineOne)}</ram:LineOne>
          <ram:CityName>${escapeXml(sellerAddr.cityName)}</ram:CityName>
          <ram:CountryID>${sellerAddr.countryCode}</ram:CountryID>
        </ram:PostalTradeAddress>
        ${data.seller.email ? `<ram:URIUniversalCommunication>
            <ram:URIID schemeID="EM">${escapeXml(data.seller.email)}</ram:URIID>
        </ram:URIUniversalCommunication>` : ''}
        ${data.seller.taxNumber ? `<ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="FC">${escapeXml(data.seller.taxNumber)}</ram:ID>
        </ram:SpecifiedTaxRegistration>` : ''}
        ${data.seller.vatId ? `<ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">${escapeXml(data.seller.vatId)}</ram:ID>
        </ram:SpecifiedTaxRegistration>` : ''}
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${escapeXml(data.buyer.name)}</ram:Name>
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>${escapeXml(buyerAddr.postcode)}</ram:PostcodeCode>
          <ram:LineOne>${escapeXml(buyerAddr.lineOne)}</ram:LineOne>
          <ram:CityName>${escapeXml(buyerAddr.cityName)}</ram:CityName>
          <ram:CountryID>${buyerAddr.countryCode}</ram:CountryID>
        </ram:PostalTradeAddress>
        ${data.buyer.email ? `<ram:URIUniversalCommunication>
          <ram:URIID schemeID="EM">${escapeXml(data.buyer.email)}</ram:URIID>
        </ram:URIUniversalCommunication>` : ''}
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery>
      <ram:ActualDeliverySupplyChainEvent>
        <ram:OccurrenceDateTime>
          <udt:DateTimeString format="102">${deliveryDate}</udt:DateTimeString>
        </ram:OccurrenceDateTime>
      </ram:ActualDeliverySupplyChainEvent>
    </ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${data.currency}</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>30</ram:TypeCode>
        <ram:PayeePartyCreditorFinancialAccount>
          <ram:IBANID>${escapeXml(data.seller.iban || '')}</ram:IBANID>
        </ram:PayeePartyCreditorFinancialAccount>
      </ram:SpecifiedTradeSettlementPaymentMeans>
      
      <!-- STEUERBLOCK (Header Level) -->
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${formatAmt(data.taxAmount)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <!-- HIER FEHLTE DER GRUND: -->
        <ram:ExemptionReason>${escapeXml(exemptionReason)}</ram:ExemptionReason> 
        <ram:BasisAmount>${formatAmt(data.totalAmount)}</ram:BasisAmount>
        <ram:CategoryCode>E</ram:CategoryCode>
        <ram:RateApplicablePercent>0.00</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>

      <ram:SpecifiedTradePaymentTerms>
        <ram:DueDateDateTime>
          <udt:DateTimeString format="102">${dueDate}</udt:DateTimeString>
        </ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${formatAmt(data.totalAmount)}</ram:LineTotalAmount>
        <ram:ChargeTotalAmount>0.00</ram:ChargeTotalAmount>
        <ram:AllowanceTotalAmount>0.00</ram:AllowanceTotalAmount>
        <ram:TaxBasisTotalAmount>${formatAmt(data.totalAmount)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${data.currency}">${formatAmt(data.taxAmount)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${formatAmt(data.totalAmount)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${formatAmt(data.totalAmount)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
}
