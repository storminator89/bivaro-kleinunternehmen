
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
    unit?: string;
    taxRate?: number;
  }[];
  netAmount: number;
  taxAmount: number; // Usually 0 for small businesses
  currency: string;
}

export type ZugferdValidationIssue = {
  field: string;
  message: string;
};

export type ZugferdValidationResult = {
  isValid: boolean;
  errors: ZugferdValidationIssue[];
  warnings: ZugferdValidationIssue[];
};

export type ZugferdXmlProfile = 'factur-x' | 'xrechnung';

export type ZugferdValidationOptions = {
  profile?: ZugferdXmlProfile;
};

export type GenerateZugferdXmlOptions = ZugferdValidationOptions;

// Keep backward compatibility
export type { ZugferdData as ZugferdInvoiceData };

const FACTUR_X_GUIDELINE_ID = 'urn:cen.eu:en16931:2017';
const XRECHNUNG_GUIDELINE_ID = 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0';

function formatDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatAmt(num: number): string {
  return num.toFixed(2);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function countDigits(value: string): number {
  const digits = value.match(/\d/g);
  return digits ? digits.length : 0;
}

function parsePostalAddress(addrStr?: string, partyName?: string) {
  const lines = (addrStr || '').split('\n').map(l => l.trim()).filter(l => l);
  const countryCode = 'DE';
  let cityName = '';
  let postcode = '';
  let lineOne = '';

  if (partyName && lines[0]?.toLowerCase() === partyName.trim().toLowerCase()) {
    lines.shift();
  }

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
}

function getBuyerAddress(data: ZugferdData) {
  const parsed = parsePostalAddress(data.buyer.address, data.buyer.name);
  return {
    lineOne: parsed.lineOne,
    postcode: data.buyer.zipCode || parsed.postcode,
    cityName: data.buyer.city || parsed.cityName,
    countryCode: parsed.countryCode,
  };
}

export function validateZugferdData(data: ZugferdData, options: ZugferdValidationOptions = {}): ZugferdValidationResult {
  const errors: ZugferdValidationIssue[] = [];
  const warnings: ZugferdValidationIssue[] = [];
  const profile = options.profile || 'factur-x';

  if (!isNonEmptyString(data.invoiceNumber)) {
    errors.push({ field: 'invoiceNumber', message: 'Rechnungsnummer fehlt.' });
  }
  if (!isValidDate(data.date)) {
    errors.push({ field: 'date', message: 'Rechnungsdatum fehlt oder ist ungültig.' });
  }
  if (!isNonEmptyString(data.currency) || !/^[A-Z]{3}$/.test(data.currency)) {
    errors.push({ field: 'currency', message: 'Währung muss als dreistelliger ISO-Code angegeben werden.' });
  }
  if (!isValidDate(data.dueDate)) {
    warnings.push({ field: 'dueDate', message: 'Fälligkeitsdatum fehlt; Zahlungsziel wird nicht strukturiert übermittelt.' });
  }

  if (!isNonEmptyString(data.seller.name)) {
    errors.push({ field: 'seller.name', message: 'Name des Rechnungsausstellers fehlt.' });
  }
  const sellerAddr = parsePostalAddress(data.seller.address, data.seller.name);
  if (!sellerAddr.lineOne || !sellerAddr.postcode || !sellerAddr.cityName) {
    errors.push({
      field: 'seller.address',
      message: 'Anschrift des Rechnungsausstellers muss Straße, PLZ und Ort enthalten.',
    });
  }
  if (!isNonEmptyString(data.seller.taxNumber) && !isNonEmptyString(data.seller.vatId)) {
    errors.push({
      field: 'seller.taxNumber',
      message: 'Steuernummer oder USt-IdNr. des Rechnungsausstellers fehlt.',
    });
  }
  if (!isNonEmptyString(data.seller.iban)) {
    warnings.push({ field: 'seller.iban', message: 'IBAN fehlt; Bankverbindung wird nicht strukturiert übermittelt.' });
  }
  if (profile === 'xrechnung') {
    if (!isNonEmptyString(data.seller.telephone)) {
      errors.push({
        field: 'seller.telephone',
        message: 'Telefonnummer des Rechnungsausstellers fehlt. Für XRechnung muss sie in den Einstellungen hinterlegt sein.',
      });
    } else if (countDigits(data.seller.telephone) < 3) {
      errors.push({
        field: 'seller.telephone',
        message: 'Telefonnummer des Rechnungsausstellers muss mindestens drei Ziffern enthalten.',
      });
    }
  }

  if (!isNonEmptyString(data.buyer.name)) {
    errors.push({ field: 'buyer.name', message: 'Name des Rechnungsempfängers fehlt.' });
  }
  const buyerAddr = getBuyerAddress(data);
  if (!buyerAddr.lineOne || !buyerAddr.postcode || !buyerAddr.cityName) {
    errors.push({
      field: 'buyer.address',
      message: 'Anschrift des Rechnungsempfängers muss Straße, PLZ und Ort enthalten.',
    });
  }

  if (!Array.isArray(data.items) || data.items.length === 0) {
    errors.push({ field: 'items', message: 'Mindestens eine Rechnungsposition ist erforderlich.' });
  } else {
    data.items.forEach((item, index) => {
      const prefix = `items.${index}`;
      if (!isNonEmptyString(item.description)) {
        errors.push({ field: `${prefix}.description`, message: `Beschreibung für Position ${index + 1} fehlt.` });
      }
      if (!isFiniteNumber(item.quantity) || item.quantity <= 0) {
        errors.push({ field: `${prefix}.quantity`, message: `Menge für Position ${index + 1} muss größer als 0 sein.` });
      }
      if (!isFiniteNumber(item.unitPrice) || item.unitPrice < 0) {
        errors.push({ field: `${prefix}.unitPrice`, message: `Einzelpreis für Position ${index + 1} darf nicht negativ sein.` });
      }
      if (!isFiniteNumber(item.total) || item.total < 0) {
        errors.push({ field: `${prefix}.total`, message: `Positionsbetrag für Position ${index + 1} darf nicht negativ sein.` });
      }
      if (item.taxRate !== undefined && (!isFiniteNumber(item.taxRate) || item.taxRate < 0)) {
        errors.push({ field: `${prefix}.taxRate`, message: `Steuersatz für Position ${index + 1} darf nicht negativ sein.` });
      }
    });
  }

  if (!isFiniteNumber(data.netAmount) || data.netAmount < 0) {
    errors.push({ field: 'netAmount', message: 'Nettobetrag fehlt oder ist ungültig.' });
  }
  if (!isFiniteNumber(data.taxAmount) || data.taxAmount < 0) {
    errors.push({ field: 'taxAmount', message: 'Steuerbetrag fehlt oder ist ungültig.' });
  }

  const lineTotal = data.items.reduce((sum, item) => sum + (isFiniteNumber(item.total) ? item.total : 0), 0);
  if (isFiniteNumber(data.netAmount) && Math.abs(lineTotal - data.netAmount) > 0.01) {
    warnings.push({
      field: 'netAmount',
      message: 'Summe der Positionen weicht vom Nettobetrag ab.',
    });
  }

  const taxTotal = data.items.reduce((sum, item) => {
    const rate = isFiniteNumber(item.taxRate) ? item.taxRate : 0;
    const total = isFiniteNumber(item.total) ? item.total : 0;
    return sum + total * (rate / 100);
  }, 0);
  if (isFiniteNumber(data.taxAmount) && Math.abs(taxTotal - data.taxAmount) > 0.01) {
    warnings.push({
      field: 'taxAmount',
      message: 'Berechnete Steuer aus den Positionen weicht vom Steuerbetrag ab.',
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

export function assertValidZugferdData(data: ZugferdData, options: ZugferdValidationOptions = {}): void {
  const validation = validateZugferdData(data, options);
  if (!validation.isValid) {
    const message = validation.errors.map(issue => issue.message).join(' ');
    throw new Error(`Ungültige E-Rechnungsdaten: ${message}`);
  }
}

export function generateZugferdXml(data: ZugferdData, options: GenerateZugferdXmlOptions = {}): string {
  assertValidZugferdData(data, options);

  const issueDate = formatDate(data.date);
  const dueDate = data.dueDate ? formatDate(data.dueDate) : '';
  const deliveryDate = data.deliveryDate ? formatDate(data.deliveryDate) : issueDate;
  const guidelineId = options.profile === 'xrechnung' ? XRECHNUNG_GUIDELINE_ID : FACTUR_X_GUIDELINE_ID;

  // Support both netAmount (new) and totalAmount (legacy/backward compat)
  const legacyTotalAmount = 'totalAmount' in data ? (data as { totalAmount?: number }).totalAmount : undefined;
  const netAmount = data.netAmount ?? legacyTotalAmount ?? 0;

  const sellerAddr = parsePostalAddress(data.seller.address, data.seller.name);
  const buyerAddr = getBuyerAddress(data);

  // Kleinunternehmer-Erkennung
  const isSmallBusiness = data.taxAmount === 0;
  const exemptionReason = isSmallBusiness ? "Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG." : "";

  const getUnitCode = (unit: string = 'Stück') => {
    const map: Record<string, string> = {
      'Stück': 'C62',
      'Stunde': 'HUR',
      'Tag': 'DAY',
      'Pauschal': 'LS'
    };
    return map[unit] || 'C62';
  };

  // Kleinunternehmer: Code "E" (Exempt from tax) — "O" is not allowed because BR-O-05 forbids RateApplicablePercent
  const taxCategoryForSmallBusiness = 'E';

  const itemsXml = data.items.map((item, index) => {
    const taxRate = item.taxRate || 0;
    const taxCategory = taxRate === 0 && isSmallBusiness ? taxCategoryForSmallBusiness : (taxRate === 0 ? 'E' : 'S');

    return `
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
          <ram:BilledQuantity unitCode="${getUnitCode(item.unit)}">${formatAmt(item.quantity)}</ram:BilledQuantity>
        </ram:SpecifiedLineTradeDelivery>
        <ram:SpecifiedLineTradeSettlement>
          <ram:ApplicableTradeTax>
            <ram:TypeCode>VAT</ram:TypeCode>
            <ram:CategoryCode>${taxCategory}</ram:CategoryCode>
            <ram:RateApplicablePercent>${formatAmt(taxRate)}</ram:RateApplicablePercent>
          </ram:ApplicableTradeTax>
          <ram:SpecifiedTradeSettlementLineMonetarySummation>
            <ram:LineTotalAmount>${formatAmt(item.total)}</ram:LineTotalAmount>
          </ram:SpecifiedTradeSettlementLineMonetarySummation>
        </ram:SpecifiedLineTradeSettlement>
      </ram:IncludedSupplyChainTradeLineItem>`;
  }).join('');

  // Fix 8: Steuersätze gruppiert für Header-Level ApplicableTradeTax
  const taxGroups = new Map<string, { rate: number; category: string; basisAmount: number; taxAmount: number }>();
  data.items.forEach(item => {
    const taxRate = item.taxRate || 0;
    const category = taxRate === 0 && isSmallBusiness ? taxCategoryForSmallBusiness : (taxRate === 0 ? 'E' : 'S');
    const key = `${category}_${taxRate}`;
    const existing = taxGroups.get(key);
    if (existing) {
      existing.basisAmount += item.total;
      existing.taxAmount += item.total * (taxRate / 100);
    } else {
      taxGroups.set(key, {
        rate: taxRate,
        category,
        basisAmount: item.total,
        taxAmount: item.total * (taxRate / 100),
      });
    }
  });

  const taxBlocksXml = Array.from(taxGroups.values()).map(group => {
    // ExemptionReason only for exempt categories — no ExemptionReasonCode (§ 19 UStG has no VATEX code)
    const exemptionXml = group.category === taxCategoryForSmallBusiness && isSmallBusiness
      ? `<ram:ExemptionReason>${escapeXml(exemptionReason)}</ram:ExemptionReason>`
      : '';

    return `
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${formatAmt(group.taxAmount)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        ${exemptionXml}
        <ram:BasisAmount>${formatAmt(group.basisAmount)}</ram:BasisAmount>
        <ram:CategoryCode>${group.category}</ram:CategoryCode>
        <ram:RateApplicablePercent>${formatAmt(group.rate)}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>`;
  }).join('');

  // Fix 4: DueDate-Block nur rendern wenn vorhanden
  const paymentTermsXml = dueDate ? `
      <ram:SpecifiedTradePaymentTerms>
        <ram:DueDateDateTime>
          <udt:DateTimeString format="102">${dueDate}</udt:DateTimeString>
        </ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>` : '';

  // Fix 5: BIC hinzufügen + Fix 9: Leeren IBAN absichern
  const paymentMeansXml = data.seller.iban ? `
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>30</ram:TypeCode>
        <ram:PayeePartyCreditorFinancialAccount>
          <ram:IBANID>${escapeXml(data.seller.iban)}</ram:IBANID>
        </ram:PayeePartyCreditorFinancialAccount>
        ${data.seller.bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution>
          <ram:BICID>${escapeXml(data.seller.bic)}</ram:BICID>
        </ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''}
      </ram:SpecifiedTradeSettlementPaymentMeans>` : `
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>30</ram:TypeCode>
      </ram:SpecifiedTradeSettlementPaymentMeans>`;

  const grandTotal = netAmount + data.taxAmount;

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:BusinessProcessSpecifiedDocumentContextParameter>
      <ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID>
    </ram:BusinessProcessSpecifiedDocumentContextParameter>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>${guidelineId}</ram:ID>
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
      <ram:BuyerReference>${escapeXml(data.invoiceNumber)}</ram:BuyerReference>
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
      ${paymentMeansXml}
      ${taxBlocksXml}
      ${paymentTermsXml}
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${formatAmt(netAmount)}</ram:LineTotalAmount>
        <ram:ChargeTotalAmount>0.00</ram:ChargeTotalAmount>
        <ram:AllowanceTotalAmount>0.00</ram:AllowanceTotalAmount>
        <ram:TaxBasisTotalAmount>${formatAmt(netAmount)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${data.currency}">${formatAmt(data.taxAmount)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${formatAmt(grandTotal)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${formatAmt(grandTotal)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
}
