import { calculateInvoiceAmounts, calculateInvoiceTaxGroups, roundInvoiceAmount } from './invoice-calculation';

export type ZugferdTaxMode = 'small-business' | 'standard';
export type ZugferdTaxCategory = 'S' | 'E' | 'Z';
export type ZugferdPaymentMeansCode = '30' | '58' | '10';

export interface ZugferdElectronicAddress {
  value: string;
  schemeId: string;
}

export interface ZugferdPartyAddress {
  name: string;
  /** Newline-separated address lines. Up to three street/address lines are supported. */
  address?: string;
  /** Optional structured form of `address`; use one or the other. */
  addressLines?: string[];
  countryCode: string;
  zipCode?: string;
  city?: string;
  email?: string;
  telephone?: string;
  taxNumber?: string;
  vatId?: string;
  iban?: string;
  bic?: string;
  electronicAddress?: ZugferdElectronicAddress;
}

export interface ZugferdData {
  invoiceNumber: string;
  date: Date;
  dueDate?: Date;
  deliveryDate?: Date;
  seller: ZugferdPartyAddress;
  buyer: Pick<ZugferdPartyAddress, 'name' | 'address' | 'addressLines' | 'countryCode' | 'zipCode' | 'city' | 'email' | 'electronicAddress'>;
  items: {
    description: string;
    quantity: number;
    unitPrice: number;
    /** Rounded net line amount supplied by the invoice form. */
    total: number;
    unit?: string;
    taxRate?: number;
    taxCategory?: ZugferdTaxCategory;
    exemptionReason?: string;
  }[];
  netAmount: number;
  taxAmount: number;
  currency: string;
  taxMode: ZugferdTaxMode;
  buyerReference?: string;
  paymentMeansCode?: ZugferdPaymentMeansCode;
  paymentTerms?: string;
}

export type ZugferdValidationIssue = { field: string; message: string };
export type ZugferdValidationResult = {
  isValid: boolean;
  errors: ZugferdValidationIssue[];
  warnings: ZugferdValidationIssue[];
};
export type ZugferdXmlProfile = 'factur-x' | 'xrechnung';
export type ZugferdValidationOptions = { profile?: ZugferdXmlProfile };
export type GenerateZugferdXmlOptions = ZugferdValidationOptions;
export type { ZugferdData as ZugferdInvoiceData };

export const SMALL_BUSINESS_EXEMPTION_REASON =
  'Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG.';
const FACTUR_X_GUIDELINE_ID = 'urn:cen.eu:en16931:2017';
const XRECHNUNG_GUIDELINE_ID =
  'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0';
const SUPPORTED_CURRENCY_CODES = new Set([
  'AED', 'ARS', 'AUD', 'BGN', 'BRL', 'CAD', 'CHF', 'CLP', 'CNY', 'COP', 'CZK', 'DKK', 'EUR', 'GBP',
  'HKD', 'HRK', 'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP',
  'PLN', 'RON', 'RUB', 'SAR', 'SEK', 'SGD', 'THB', 'TRY', 'UAH', 'USD', 'VND', 'ZAR',
]);
const SUPPORTED_COUNTRY_CODES = new Set([
  'AE', 'AR', 'AT', 'AU', 'BE', 'BG', 'BR', 'CA', 'CH', 'CL', 'CN', 'CO', 'CY', 'CZ', 'DE', 'DK', 'EE',
  'ES', 'FI', 'FR', 'GB', 'GR', 'HK', 'HR', 'HU', 'ID', 'IE', 'IL', 'IN', 'IS', 'IT', 'JP', 'KR', 'LI',
  'LT', 'LU', 'LV', 'MC', 'MT', 'MX', 'MY', 'NL', 'NO', 'NZ', 'PH', 'PL', 'PT', 'RO', 'RU', 'SA', 'SE',
  'SG', 'SI', 'SK', 'SM', 'TH', 'TR', 'UA', 'US', 'VA', 'VN', 'ZA',
]);
const SUPPORTED_ELECTRONIC_SCHEMES = new Set([
  'EM', '0088', '0192', '0204', '9901', '9910', '9913', '9914', '9915', '9918', '9919', '9920', '9921',
  '9922', '9923', '9924', '9925', '9926', '9927', '9928', '9929', '9930',
]);

function formatDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function formatAmount(value: number): string { return value.toFixed(2); }

function expandDecimalString(value: number): string {
  const source = String(value);
  if (!/[eE]/.test(source)) return source;
  const match = source.match(/^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (!match) return source;
  const sign = match[1];
  const digits = `${match[2]}${match[3] || ''}`;
  const point = match[2].length + Number(match[4]);
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/** Preserve precision for quantities, prices, and percentages. */
function formatDecimal(value: number, minimumFractionDigits = 0): string {
  const expanded = expandDecimalString(value);
  const [whole, fraction = ''] = expanded.split('.');
  return minimumFractionDigits === 0
    ? (fraction ? `${whole}.${fraction}` : whole)
    : `${whole}.${fraction.padEnd(minimumFractionDigits, '0')}`;
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

type ParsedAddress = { lines: string[]; postcode: string; city: string; countryCode: string };

function getAddressLines(party: ZugferdPartyAddress): string[] {
  if (party.addressLines) return party.addressLines.map(line => line.trim()).filter(Boolean);
  return (party.address || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function parsePostalAddress(party: ZugferdPartyAddress): ParsedAddress {
  const lines = getAddressLines(party);
  if (lines[0]?.toLowerCase() === party.name.trim().toLowerCase()) lines.shift();
  let postcode = (party.zipCode || '').trim();
  let city = (party.city || '').trim();
  if (postcode && city && lines[lines.length - 1] === `${postcode} ${city}`) lines.pop();
  // Infer only an unambiguous German postal line. Other countries must supply
  // zipCode and city explicitly, so no address text is silently reinterpreted.
  if ((!postcode || !city) && lines.length > 0) {
    const match = lines[lines.length - 1].match(/^(\d{5})\s+(.+)$/);
    if (match) {
      postcode ||= match[1];
      city ||= match[2].trim();
      lines.pop();
    }
  }
  return { lines, postcode, city, countryCode: party.countryCode };
}

function addError(errors: ZugferdValidationIssue[], field: string, message: string): void {
  errors.push({ field, message });
}

function validatePartyAddress(
  party: ZugferdPartyAddress,
  field: 'seller' | 'buyer',
  errors: ZugferdValidationIssue[],
): ParsedAddress {
  const address = parsePostalAddress(party);
  if (!isNonEmptyString(party.countryCode) || !SUPPORTED_COUNTRY_CODES.has(party.countryCode)) {
    addError(errors, `${field}.countryCode`, 'Länderkennzeichen wird nicht unterstützt; bitte einen gültigen ISO-Code verwenden.');
  }
  if (address.lines.length === 0 || address.lines.length > 3) {
    addError(errors, `${field}.address`, 'Anschrift muss zwischen einer und drei Adresszeilen enthalten.');
  }
  if (!isNonEmptyString(address.postcode) || !isNonEmptyString(address.city)) {
    addError(errors, `${field}.address`, 'Anschrift muss PLZ und Ort enthalten (separat oder in einer deutschen Postleitzahlzeile).');
  }
  return address;
}

function effectiveCategory(item: ZugferdData['items'][number], mode: ZugferdTaxMode): ZugferdTaxCategory | undefined {
  const rate = item.taxRate ?? 0;
  if (mode === 'small-business') return item.taxCategory || 'E';
  if (rate > 0) return item.taxCategory || 'S';
  return item.taxCategory;
}

function validateTaxItems(data: ZugferdData, errors: ZugferdValidationIssue[]): void {
  if (data.taxMode !== 'small-business' && data.taxMode !== 'standard') {
    addError(errors, 'taxMode', 'Steuermodus muss small-business oder standard sein.');
  }
  const exemptionReasons = new Map<string, string>();
  data.items.forEach((item, index) => {
    const field = `items.${index}`;
    const rate = item.taxRate ?? 0;
    if (!isFiniteNumber(rate) || rate < 0) {
      addError(errors, `${field}.taxRate`, `Steuersatz für Position ${index + 1} darf nicht negativ sein.`);
      return;
    }
    if (item.taxCategory !== undefined && !['S', 'E', 'Z'].includes(item.taxCategory)) {
      addError(errors, `${field}.taxCategory`, `Steuerkategorie für Position ${index + 1} ist nicht unterstützt.`);
      return;
    }
    const category = effectiveCategory(item, data.taxMode);
    if (data.taxMode === 'small-business') {
      if (rate !== 0 || category !== 'E') addError(errors, field, 'Im Kleinunternehmermodus müssen alle Positionen Steuersatz 0 und Kategorie E haben.');
      if (item.exemptionReason && !item.exemptionReason.includes('§ 19 UStG')) addError(errors, `${field}.exemptionReason`, 'Der Befreiungsgrund muss § 19 UStG nennen.');
      return;
    }
    if (rate > 0 && category !== 'S') addError(errors, field, 'Positive Steuersätze müssen die Steuerkategorie S verwenden.');
    if (rate === 0 && category !== 'E' && category !== 'Z') addError(errors, `${field}.taxCategory`, 'Nullsteuersätze benötigen ausdrücklich Kategorie E oder Z.');
    if (rate === 0 && category === 'E' && !isNonEmptyString(item.exemptionReason)) addError(errors, `${field}.exemptionReason`, 'Kategorie E benötigt einen Befreiungsgrund.');
    if (category) {
      const reason = item.exemptionReason?.trim() || '';
      const key = `${category}:${rate}`;
      if (reason && exemptionReasons.has(key) && exemptionReasons.get(key) !== reason) addError(errors, `${field}.exemptionReason`, 'Befreiungsgrund muss je Steuerkategorie und Steuersatz einheitlich sein.');
      else if (reason) exemptionReasons.set(key, reason);
    }
  });
}

function validateCalculatedAmounts(data: ZugferdData, errors: ZugferdValidationIssue[]): ReturnType<typeof calculateInvoiceAmounts> | undefined {
  try {
    const calculated = calculateInvoiceAmounts(data.items);
    data.items.forEach((item, index) => {
      if (!isFiniteNumber(item.total) || item.total < 0) addError(errors, `items.${index}.total`, `Positionsbetrag für Position ${index + 1} darf nicht negativ sein.`);
      else if (roundInvoiceAmount(item.total) !== calculated.lines[index].netAmount) addError(errors, `items.${index}.total`, `Positionsbetrag für Position ${index + 1} stimmt nicht mit Menge × Einzelpreis überein.`);
    });
    if (!isFiniteNumber(data.netAmount) || data.netAmount < 0) addError(errors, 'netAmount', 'Nettobetrag fehlt oder ist ungültig.');
    else if (roundInvoiceAmount(data.netAmount) !== calculated.netAmount) addError(errors, 'netAmount', 'Nettobetrag stimmt nicht mit der Summe der gerundeten Positionen überein.');
    if (!isFiniteNumber(data.taxAmount) || data.taxAmount < 0) addError(errors, 'taxAmount', 'Steuerbetrag fehlt oder ist ungültig.');
    else if (roundInvoiceAmount(data.taxAmount) !== calculated.taxAmount) addError(errors, 'taxAmount', 'Steuerbetrag stimmt nicht mit der Summe der gerundeten Steuergruppen überein.');
    return calculated;
  } catch (error) {
    addError(errors, 'items', error instanceof Error ? error.message : 'Positionen konnten nicht berechnet werden.');
    return undefined;
  }
}

export function validateZugferdData(data: ZugferdData, options: ZugferdValidationOptions = {}): ZugferdValidationResult {
  const errors: ZugferdValidationIssue[] = [];
  const warnings: ZugferdValidationIssue[] = [];
  const profile = options.profile || 'factur-x';
  if (!isNonEmptyString(data.invoiceNumber)) addError(errors, 'invoiceNumber', 'Rechnungsnummer fehlt.');
  if (!isValidDate(data.date)) addError(errors, 'date', 'Rechnungsdatum fehlt oder ist ungültig.');
  if (!isNonEmptyString(data.currency) || !SUPPORTED_CURRENCY_CODES.has(data.currency)) addError(errors, 'currency', 'Währung wird nicht unterstützt; bitte einen gültigen ISO-4217-Code verwenden.');
  if (data.dueDate !== undefined && !isValidDate(data.dueDate)) addError(errors, 'dueDate', 'Fälligkeitsdatum ist ungültig.');
  if (isValidDate(data.date) && isValidDate(data.dueDate) && data.dueDate < data.date) addError(errors, 'dueDate', 'Fälligkeitsdatum darf nicht vor dem Rechnungsdatum liegen.');
  if (data.deliveryDate !== undefined && !isValidDate(data.deliveryDate)) addError(errors, 'deliveryDate', 'Leistungsdatum ist ungültig.');
  if (!isNonEmptyString(data.taxMode)) addError(errors, 'taxMode', 'Steuermodus fehlt.');

  if (!isNonEmptyString(data.seller.name)) addError(errors, 'seller.name', 'Name des Rechnungsausstellers fehlt.');
  validatePartyAddress(data.seller, 'seller', errors);
  if (!isNonEmptyString(data.seller.taxNumber) && !isNonEmptyString(data.seller.vatId)) addError(errors, 'seller.taxNumber', 'Steuernummer oder USt-IdNr. des Rechnungsausstellers fehlt.');
  if (profile === 'xrechnung') {
    if (!isNonEmptyString(data.seller.email)) addError(errors, 'seller.email', 'Für XRechnung ist eine E-Mail des Rechnungsausstellers erforderlich.');
    if (!isNonEmptyString(data.seller.telephone)) addError(errors, 'seller.telephone', 'Telefonnummer des Rechnungsausstellers fehlt. Für XRechnung muss sie hinterlegt sein.');
    else if (countDigits(data.seller.telephone) < 3) addError(errors, 'seller.telephone', 'Telefonnummer des Rechnungsausstellers muss mindestens drei Ziffern enthalten.');
    if (!isNonEmptyString(data.buyer.email) && !isNonEmptyString(data.buyer.electronicAddress?.value)) addError(errors, 'buyer.electronicAddress', 'Für XRechnung ist eine elektronische Käuferadresse erforderlich.');
    if (!isNonEmptyString(data.buyerReference)) addError(errors, 'buyerReference', 'Für XRechnung ist eine Käuferreferenz erforderlich.');
  }
  if (data.seller.electronicAddress && (!isNonEmptyString(data.seller.electronicAddress.value) || !SUPPORTED_ELECTRONIC_SCHEMES.has(data.seller.electronicAddress.schemeId))) addError(errors, 'seller.electronicAddress', 'Elektronische Verkäuferadresse benötigt einen unterstützten schemeId.');
  if (data.buyer.electronicAddress && (!isNonEmptyString(data.buyer.electronicAddress.value) || !SUPPORTED_ELECTRONIC_SCHEMES.has(data.buyer.electronicAddress.schemeId))) addError(errors, 'buyer.electronicAddress', 'Elektronische Käuferadresse benötigt einen unterstützten schemeId.');
  if (!isNonEmptyString(data.buyer.name)) addError(errors, 'buyer.name', 'Name des Rechnungsempfängers fehlt.');
  validatePartyAddress(data.buyer, 'buyer', errors);

  if (!Array.isArray(data.items) || data.items.length === 0) addError(errors, 'items', 'Mindestens eine Rechnungsposition ist erforderlich.');
  else {
    data.items.forEach((item, index) => {
      if (!isNonEmptyString(item.description)) addError(errors, `items.${index}.description`, `Beschreibung für Position ${index + 1} fehlt.`);
      if (!isFiniteNumber(item.quantity) || item.quantity <= 0) addError(errors, `items.${index}.quantity`, `Menge für Position ${index + 1} muss größer als 0 sein.`);
      if (!isFiniteNumber(item.unitPrice) || item.unitPrice < 0) addError(errors, `items.${index}.unitPrice`, `Einzelpreis für Position ${index + 1} darf nicht negativ sein.`);
      if (item.unit && !['Stück', 'Stunde', 'Tag', 'Pauschal', 'C62', 'HUR', 'DAY', 'LS'].includes(item.unit)) addError(errors, `items.${index}.unit`, `Einheit für Position ${index + 1} wird nicht unterstützt.`);
    });
    validateTaxItems(data, errors);
  }

  const calculated = data.items?.length ? validateCalculatedAmounts(data, errors) : undefined;
  const paymentMeansCode = data.paymentMeansCode || '30';
  if (!['30', '58', '10'].includes(paymentMeansCode)) addError(errors, 'paymentMeansCode', 'Zahlungsmittelcode wird nicht unterstützt.');
  if (paymentMeansCode === '30' || paymentMeansCode === '58') {
    if (!isNonEmptyString(data.seller.iban?.replace(/\s+/g, ''))) addError(errors, 'seller.iban', `Für Zahlungsmittelcode ${paymentMeansCode} ist ein Zahlungskonto erforderlich.`);
  }
  if (calculated && calculated.grossAmount > 0) {
    if (!isValidDate(data.dueDate) && !isNonEmptyString(data.paymentTerms)) addError(errors, 'paymentTerms', 'Bei positivem Zahlbetrag ist ein Fälligkeitsdatum oder eine Zahlungsbedingung erforderlich.');
  }
  return { isValid: errors.length === 0, errors, warnings };
}

export function assertValidZugferdData(data: ZugferdData, options: ZugferdValidationOptions = {}): void {
  const validation = validateZugferdData(data, options);
  if (!validation.isValid) throw new Error(`Ungültige E-Rechnungsdaten: ${validation.errors.map(issue => issue.message).join(' ')}`);
}

function getUnitCode(unit?: string): string {
  const map: Record<string, string> = { Stück: 'C62', Stunde: 'HUR', Tag: 'DAY', Pauschal: 'LS' };
  return map[unit || 'Stück'] || unit || 'C62';
}

type TaxGroup = { rate: number; category: ZugferdTaxCategory; basisAmount: number; taxAmount: number; exemptionReason?: string };

function buildTaxGroups(data: ZugferdData): TaxGroup[] {
  return calculateInvoiceTaxGroups(data.items).map(group => {
    const source = data.items.find(item => {
      const rate = item.taxRate ?? 0;
      return rate === group.rate && effectiveCategory(item, data.taxMode) === group.category;
    });
    return {
      rate: group.rate,
      category: group.category,
      basisAmount: group.basisAmount,
      taxAmount: group.taxAmount,
      exemptionReason: group.category === 'E'
        ? (data.taxMode === 'small-business' ? SMALL_BUSINESS_EXEMPTION_REASON : source?.exemptionReason?.trim())
        : undefined,
    };
  });
}

function renderAddress(address: ParsedAddress): string {
  return [
    `<ram:PostcodeCode>${escapeXml(address.postcode)}</ram:PostcodeCode>`,
    ...address.lines.map((line, index) => {
      const tag = index === 0 ? 'LineOne' : index === 1 ? 'LineTwo' : 'LineThree';
      return `<ram:${tag}>${escapeXml(line)}</ram:${tag}>`;
    }),
    `<ram:CityName>${escapeXml(address.city)}</ram:CityName>`,
    `<ram:CountryID>${escapeXml(address.countryCode)}</ram:CountryID>`,
  ].join('\n          ');
}

function renderElectronicAddress(address?: ZugferdElectronicAddress, fallbackEmail?: string): string {
  if (address) return `<ram:URIUniversalCommunication><ram:URIID schemeID="${escapeXml(address.schemeId)}">${escapeXml(address.value)}</ram:URIID></ram:URIUniversalCommunication>`;
  if (fallbackEmail) return `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${escapeXml(fallbackEmail)}</ram:URIID></ram:URIUniversalCommunication>`;
  return '';
}

export function generateZugferdXml(data: ZugferdData, options: GenerateZugferdXmlOptions = {}): string {
  assertValidZugferdData(data, options);
  const calculated = calculateInvoiceAmounts(data.items);
  const sellerAddr = parsePostalAddress(data.seller);
  const buyerAddr = parsePostalAddress(data.buyer);
  const profile = options.profile || 'factur-x';
  const guidelineId = profile === 'xrechnung' ? XRECHNUNG_GUIDELINE_ID : FACTUR_X_GUIDELINE_ID;
  const issueDate = formatDate(data.date);
  const dueDate = data.dueDate ? formatDate(data.dueDate) : '';
  const paymentMeansCode = data.paymentMeansCode || '30';
  const taxGroups = buildTaxGroups(data);

  const itemsXml = data.items.map((item, index) => {
    const rate = item.taxRate ?? 0;
    const category = effectiveCategory(item, data.taxMode) as ZugferdTaxCategory;
    return `
      <ram:IncludedSupplyChainTradeLineItem>
        <ram:AssociatedDocumentLineDocument><ram:LineID>${index + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
        <ram:SpecifiedTradeProduct><ram:Name>${escapeXml(item.description)}</ram:Name></ram:SpecifiedTradeProduct>
        <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${formatDecimal(item.unitPrice, 2)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
        <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${getUnitCode(item.unit)}">${formatDecimal(item.quantity)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
        <ram:SpecifiedLineTradeSettlement>
          <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${category}</ram:CategoryCode><ram:RateApplicablePercent>${formatDecimal(rate, 2)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
          <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${formatAmount(calculated.lines[index].netAmount)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
        </ram:SpecifiedLineTradeSettlement>
      </ram:IncludedSupplyChainTradeLineItem>`;
  }).join('');

  const taxBlocksXml = taxGroups.map(group => `
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${formatAmount(group.taxAmount)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>
        ${group.exemptionReason ? `<ram:ExemptionReason>${escapeXml(group.exemptionReason)}</ram:ExemptionReason>` : ''}
        <ram:BasisAmount>${formatAmount(group.basisAmount)}</ram:BasisAmount><ram:CategoryCode>${group.category}</ram:CategoryCode><ram:RateApplicablePercent>${formatDecimal(group.rate, 2)}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>`).join('');
  const paymentTermsXml = data.dueDate || data.paymentTerms ? `
      <ram:SpecifiedTradePaymentTerms>${data.paymentTerms ? `<ram:Description>${escapeXml(data.paymentTerms.trim())}</ram:Description>` : ''}${data.dueDate ? `<ram:DueDateDateTime><udt:DateTimeString format="102">${dueDate}</udt:DateTimeString></ram:DueDateDateTime>` : ''}</ram:SpecifiedTradePaymentTerms>` : '';
  const normalizedIban = data.seller.iban?.replace(/\s+/g, '');
  const paymentAccountXml = (paymentMeansCode === '30' || paymentMeansCode === '58') && normalizedIban ? `<ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${escapeXml(normalizedIban)}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>${data.seller.bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${escapeXml(data.seller.bic)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''}` : '';
  const paymentMeansXml = `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>${paymentMeansCode}</ram:TypeCode>${paymentAccountXml}</ram:SpecifiedTradeSettlementPaymentMeans>`;
  const sellerContactEmail = data.seller.email ? `<ram:EmailURIUniversalCommunication><ram:URIID>${escapeXml(data.seller.email)}</ram:URIID></ram:EmailURIUniversalCommunication>` : '';

  const deliveryXml = data.deliveryDate
    ? `<ram:ApplicableHeaderTradeDelivery><ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${formatDate(data.deliveryDate)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent></ram:ApplicableHeaderTradeDelivery>`
    : '<ram:ApplicableHeaderTradeDelivery></ram:ApplicableHeaderTradeDelivery>';

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${guidelineId}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument><ram:ID>${escapeXml(data.invoiceNumber)}</ram:ID><ram:TypeCode>380</ram:TypeCode><ram:IssueDateTime><udt:DateTimeString format="102">${issueDate}</udt:DateTimeString></ram:IssueDateTime></rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    ${itemsXml}
    <ram:ApplicableHeaderTradeAgreement>
      ${data.buyerReference ? `<ram:BuyerReference>${escapeXml(data.buyerReference.trim())}</ram:BuyerReference>` : ''}
      <ram:SellerTradeParty>
        ${data.seller.taxNumber ? `<ram:ID>${escapeXml(data.seller.taxNumber)}</ram:ID>` : ''}<ram:Name>${escapeXml(data.seller.name)}</ram:Name>
        <ram:DefinedTradeContact><ram:PersonName>${escapeXml(data.seller.name)}</ram:PersonName>${data.seller.telephone ? `<ram:TelephoneUniversalCommunication><ram:CompleteNumber>${escapeXml(data.seller.telephone)}</ram:CompleteNumber></ram:TelephoneUniversalCommunication>` : ''}${sellerContactEmail}</ram:DefinedTradeContact>
        <ram:PostalTradeAddress>${renderAddress(sellerAddr)}</ram:PostalTradeAddress>
        ${renderElectronicAddress(data.seller.electronicAddress, data.seller.email)}
        ${data.seller.taxNumber ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${escapeXml(data.seller.taxNumber)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}${data.seller.vatId ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${escapeXml(data.seller.vatId)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty><ram:Name>${escapeXml(data.buyer.name)}</ram:Name><ram:PostalTradeAddress>${renderAddress(buyerAddr)}</ram:PostalTradeAddress>${renderElectronicAddress(data.buyer.electronicAddress, data.buyer.email)}</ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    ${deliveryXml}
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${escapeXml(data.currency)}</ram:InvoiceCurrencyCode>${paymentMeansXml}${taxBlocksXml}${paymentTermsXml}
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:LineTotalAmount>${formatAmount(calculated.netAmount)}</ram:LineTotalAmount><ram:ChargeTotalAmount>0.00</ram:ChargeTotalAmount><ram:AllowanceTotalAmount>0.00</ram:AllowanceTotalAmount><ram:TaxBasisTotalAmount>${formatAmount(calculated.netAmount)}</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="${escapeXml(data.currency)}">${formatAmount(calculated.taxAmount)}</ram:TaxTotalAmount><ram:GrandTotalAmount>${formatAmount(calculated.grossAmount)}</ram:GrandTotalAmount><ram:DuePayableAmount>${formatAmount(calculated.grossAmount)}</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
}
