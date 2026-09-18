import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFStream, PDFString } from 'pdf-lib';
import { parseStringPromise } from 'xml2js';
import zlib from 'zlib';
import { MAX_XML_INPUT_BYTES, MAX_INVOICE_UPLOAD_BYTES, RequestBodyLimitError } from '@/lib/resource-limits';

type XmlObject = Record<string, unknown>;

export type EInvoiceFormat = 'CII' | 'UBL';

export type EInvoiceDocumentType = 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'UNKNOWN';

export type ParsedEInvoiceAdjustment = {
  amount: number | null;
  baseAmount: number | null;
  percentage: number | null;
  reason: string | null;
  kind: 'CHARGE' | 'ALLOWANCE';
  currency: string | null;
};

export type ParsedEInvoiceParty = {
  name: string | null;
  email: string | null;
  address: string | null;
  zipCode: string | null;
  city: string | null;
  country: string | null;
  /** Every address line in source order. `address` is the newline-joined view. */
  addressLines: string[];
};

export type ParsedEInvoiceLineItem = {
  positionNumber: string | null;
  description: string | null;
  details: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  /** Price basis (BT-149 / cbc:BaseQuantity). */
  baseQuantity: number | null;
  baseUnit: string | null;
  amount: number | null;
  taxRate: number | null;
  charges: ParsedEInvoiceAdjustment[];
  allowances: ParsedEInvoiceAdjustment[];
};

export type ParsedEInvoice = {
  format: EInvoiceFormat;
  /** XML extraction result only. No XSD or Schematron validation is performed here. */
  extractionStatus: 'PARSED';
  validationStatus: 'NOT_VALIDATED';
  documentType: EInvoiceDocumentType;
  documentTypeCode: string | null;
  currency: string | null;
  invoiceNumber: string | null;
  invoiceDate: Date | null;
  dueDate: Date | null;
  /** BT-112, the gross invoice total. This is the canonical totalAmount. */
  grossAmount: number | null;
  /** BT-113, the amount already prepaid. */
  prepaidAmount: number | null;
  /** BT-114, payable rounding adjustment. */
  roundingAmount: number | null;
  /** BT-115, the amount remaining payable after prepayment/rounding. */
  dueAmount: number | null;
  netAmount: number | null;
  taxAmount: number | null;
  lineTotalAmount: number | null;
  chargeTotalAmount: number | null;
  allowanceTotalAmount: number | null;
  totalAmount: number | null;
  customerName: string | null;
  lineItems: ParsedEInvoiceLineItem[];
  buyerInfo: ParsedEInvoiceParty;
  sellerInfo: ParsedEInvoiceParty;
  rawXml: string;
};

type PdfAttachment = {
  name: string;
  data: Uint8Array;
};

const emptyParty: ParsedEInvoiceParty = {
  name: null,
  email: null,
  address: null,
  zipCode: null,
  city: null,
  country: null,
  addressLines: [],
};

function isRecord(value: unknown): value is XmlObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function localName(name: string): string {
  const parts = name.split(':');
  return parts[parts.length - 1];
}

function getChild(obj: unknown, name: string): unknown {
  if (!isRecord(obj)) return undefined;
  if (obj[name] !== undefined) return obj[name];

  const entry = Object.entries(obj).find(([key]) => localName(key) === name);
  return entry?.[1];
}

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (Array.isArray(acc)) {
      return getChild(acc[0], segment);
    }
    return getChild(acc, segment);
  }, obj);
}

function getAttribute(value: unknown, attributeName: string): string | null {
  if (!isRecord(value)) return null;
  const attrs = getChild(value, '$');
  if (!isRecord(attrs)) return null;
  const raw = attrs[attributeName];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function normalizeCurrency(value: string | null): string | null {
  return value ? value.trim().toUpperCase() : null;
}

function getCurrencyFromAmount(value: unknown): string | null {
  return normalizeCurrency(getAttribute(value, 'currencyID') || getAttribute(value, 'currencyId'));
}

function asText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = asText(item);
      if (text) return text;
    }
    return null;
  }
  if (isRecord(value)) {
    const text = value._ ?? value['#text'];
    return asText(text);
  }
  return null;
}

function getText(obj: unknown, path: string): string | null {
  return asText(getPath(obj, path));
}

function asNumber(value: unknown): number | null {
  const text = asText(value);
  if (!text) return null;
  // XML monetary/quantity values use the decimal lexical space. Do not use
  // parseFloat here: it would silently turn values such as `100garbage` into
  // 100 and comma decimals into a value that was never present in the XML.
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function getNumber(obj: unknown, path: string): number | null {
  return asNumber(getPath(obj, path));
}

function asDate(value: unknown): Date | null {
  const text = asText(value);
  if (!text) return null;

  const compactDate = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactDate) {
    return validCalendarDate(Number(compactDate[1]), Number(compactDate[2]), Number(compactDate[3]));
  }

  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) {
    return validCalendarDate(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]));
  }

  return null;
}

function validCalendarDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function getDate(obj: unknown, path: string): Date | null {
  return asDate(getPath(obj, path));
}

function firstText(obj: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const text = getText(obj, path);
    if (text) return text;
  }
  return null;
}

function firstNumber(obj: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const number = getNumber(obj, path);
    if (number !== null) return number;
  }
  return null;
}

function firstDate(obj: unknown, paths: string[]): Date | null {
  for (const path of paths) {
    const date = getDate(obj, path);
    if (date) return date;
  }
  return null;
}

function getAddressLines(addressNode: unknown, paths: string[]): string[] {
  const read = (value: unknown, segments: string[]): unknown[] => {
    if (segments.length === 0) return toArray(value);
    if (Array.isArray(value)) return value.flatMap(item => read(item, segments));
    return read(getChild(value, segments[0]), segments.slice(1));
  };
  return paths.flatMap(path => read(addressNode, path.split('.')).map(asText).filter((value): value is string => Boolean(value)));
}

function getDescendantNodes(value: unknown, wantedName: string): unknown[] {
  if (Array.isArray(value)) return value.flatMap(item => getDescendantNodes(item, wantedName));
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(key !== '$' && localName(key) === wantedName ? toArray(child) : []),
    ...getDescendantNodes(child, wantedName),
  ]);
}

function parseAdjustment(node: unknown, fallbackKind: 'CHARGE' | 'ALLOWANCE'): ParsedEInvoiceAdjustment {
  const indicator = firstText(node, ['ChargeIndicator', 'ChargeIndicator.Indicator', 'ChargeIndicatorIndicator']);
  const isCharge = indicator === null
    ? fallbackKind === 'CHARGE'
    : ['true', '1', 'yes'].includes(indicator.toLowerCase());
  const amountNode = getChild(node, 'ActualAmount') ?? getChild(node, 'Amount');
  const baseAmountNode = getChild(node, 'BasisAmount') ?? getChild(node, 'BaseAmount');

  return {
    amount: asNumber(amountNode),
    baseAmount: asNumber(baseAmountNode),
    percentage: firstNumber(node, ['CalculationPercent', 'MultiplierFactorNumeric']),
    reason: firstText(node, ['Reason', 'AllowanceChargeReason']),
    kind: isCharge ? 'CHARGE' : 'ALLOWANCE',
    currency: getCurrencyFromAmount(amountNode) || getCurrencyFromAmount(baseAmountNode),
  };
}

function parseDocumentType(code: string | null, rootType?: 'Invoice' | 'CreditNote'): EInvoiceDocumentType {
  if (code !== null) {
    if (code === '383') return 'DEBIT_NOTE';
    if (code === '381') return 'CREDIT_NOTE';
    if (code === '380') return rootType === 'CreditNote' ? 'UNKNOWN' : 'INVOICE';
    return 'UNKNOWN';
  }
  if (rootType === 'Invoice') return 'INVOICE';
  if (rootType === 'CreditNote') return 'CREDIT_NOTE';
  return 'UNKNOWN';
}

function parseCiiParty(party: unknown): ParsedEInvoiceParty {
  if (!party) return { ...emptyParty };

  const addressNode = getPath(party, 'PostalTradeAddress');
  const addressLines = getAddressLines(addressNode, ['LineOne', 'LineTwo', 'LineThree']);
  return {
    name: getText(party, 'Name'),
    email: firstText(party, [
      'DefinedTradeContact.EmailURIUniversalCommunication.URIID',
      'URIUniversalCommunication.URIID',
    ]),
    address: addressLines.length ? addressLines.join('\n') : null,
    zipCode: getText(addressNode, 'PostcodeCode'),
    city: getText(addressNode, 'CityName'),
    country: getText(addressNode, 'CountryID'),
    addressLines,
  };
}

function parseUblParty(party: unknown): ParsedEInvoiceParty {
  if (!party) return { ...emptyParty };

  const addressNode = getPath(party, 'PostalAddress');
  const addressLines = getAddressLines(addressNode, [
    'StreetName',
    'BuildingName',
    'BuildingNumber',
    'AddressLine.Line',
  ]);
  return {
    name: firstText(party, [
      'PartyName.Name',
      'PartyLegalEntity.RegistrationName',
      'EndpointID',
    ]),
    email: getText(party, 'Contact.ElectronicMail'),
    address: addressLines.length ? addressLines.join('\n') : null,
    zipCode: getText(addressNode, 'PostalZone'),
    city: getText(addressNode, 'CityName'),
    country: getText(addressNode, 'Country.IdentificationCode'),
    addressLines,
  };
}

function parseCiiLineItem(item: unknown): ParsedEInvoiceLineItem {
  const quantityNode = getPath(item, 'SpecifiedLineTradeDelivery.BilledQuantity');
  const baseQuantityNode = getPath(item, 'SpecifiedLineTradeAgreement.NetPriceProductTradePrice.BasisQuantity');
  const adjustments = getDescendantNodes(getPath(item, 'SpecifiedLineTradeAgreement'), 'AppliedTradeAllowanceCharge')
    .map(node => parseAdjustment(node, 'ALLOWANCE'));

  return {
    positionNumber: getText(item, 'AssociatedDocumentLineDocument.LineID'),
    description: firstText(item, [
      'SpecifiedTradeProduct.Name',
      'SpecifiedTradeProduct.Description',
    ]),
    details: getText(item, 'SpecifiedTradeProduct.Description'),
    quantity: asNumber(quantityNode),
    unit: getAttribute(quantityNode, 'unitCode'),
    unitPrice: getNumber(item, 'SpecifiedLineTradeAgreement.NetPriceProductTradePrice.ChargeAmount'),
    baseQuantity: asNumber(baseQuantityNode),
    baseUnit: getAttribute(baseQuantityNode, 'unitCode'),
    amount: getNumber(item, 'SpecifiedLineTradeSettlement.SpecifiedTradeSettlementLineMonetarySummation.LineTotalAmount'),
    taxRate: getNumber(item, 'SpecifiedLineTradeSettlement.ApplicableTradeTax.RateApplicablePercent'),
    charges: adjustments.filter(adjustment => adjustment.kind === 'CHARGE'),
    allowances: adjustments.filter(adjustment => adjustment.kind === 'ALLOWANCE'),
  };
}

function parseUblLineItem(item: unknown): ParsedEInvoiceLineItem {
  const quantityNode = getPath(item, 'InvoicedQuantity');
  const creditQuantityNode = quantityNode ?? getPath(item, 'CreditedQuantity');
  const baseQuantityNode = getPath(item, 'Price.BaseQuantity');
  const adjustments = toArray(getPath(item, 'AllowanceCharge')).map(node => parseAdjustment(node, 'ALLOWANCE'));

  return {
    positionNumber: getText(item, 'ID'),
    description: firstText(item, [
      'Item.Name',
      'Item.Description',
    ]),
    details: getText(item, 'Item.Description'),
    quantity: asNumber(creditQuantityNode),
    unit: getAttribute(creditQuantityNode, 'unitCode'),
    unitPrice: getNumber(item, 'Price.PriceAmount'),
    baseQuantity: asNumber(baseQuantityNode),
    baseUnit: getAttribute(baseQuantityNode, 'unitCode'),
    amount: getNumber(item, 'LineExtensionAmount'),
    taxRate: firstNumber(item, [
      'Item.ClassifiedTaxCategory.Percent',
      'TaxTotal.TaxSubtotal.TaxCategory.Percent',
    ]),
    charges: adjustments.filter(adjustment => adjustment.kind === 'CHARGE'),
    allowances: adjustments.filter(adjustment => adjustment.kind === 'ALLOWANCE'),
  };
}

function parseCiiInvoice(root: unknown, rawXml: string): ParsedEInvoice {
  const exchangedDoc = getPath(root, 'ExchangedDocument');
  const tradeTransaction = getPath(root, 'SupplyChainTradeTransaction');
  const agreement = getPath(tradeTransaction, 'ApplicableHeaderTradeAgreement');
  const settlement = getPath(tradeTransaction, 'ApplicableHeaderTradeSettlement');
  const summation = getPath(settlement, 'SpecifiedTradeSettlementHeaderMonetarySummation');

  const buyerInfo = parseCiiParty(getPath(agreement, 'BuyerTradeParty'));
  const sellerInfo = parseCiiParty(getPath(agreement, 'SellerTradeParty'));
  const documentTypeCode = getText(exchangedDoc, 'TypeCode');
  const grossAmount = firstNumber(summation, ['GrandTotalAmount']);
  const prepaidAmount = firstNumber(summation, ['TotalPrepaidAmount']);
  const roundingAmount = firstNumber(summation, ['RoundingAmount']);
  const dueAmount = firstNumber(summation, ['DuePayableAmount']);
  const currency = normalizeCurrency(
    firstText(settlement, ['InvoiceCurrencyCode'])
      || getCurrencyFromAmount(getPath(summation, 'GrandTotalAmount'))
      || getCurrencyFromAmount(getPath(summation, 'DuePayableAmount')),
  );

  return {
    format: 'CII',
    extractionStatus: 'PARSED',
    validationStatus: 'NOT_VALIDATED',
    documentType: parseDocumentType(documentTypeCode),
    documentTypeCode,
    currency,
    invoiceNumber: getText(exchangedDoc, 'ID'),
    invoiceDate: getDate(exchangedDoc, 'IssueDateTime.DateTimeString'),
    dueDate: getDate(settlement, 'SpecifiedTradePaymentTerms.DueDateDateTime.DateTimeString'),
    grossAmount,
    prepaidAmount,
    roundingAmount,
    dueAmount,
    netAmount: firstNumber(summation, ['TaxBasisTotalAmount']),
    taxAmount: firstNumber(summation, ['TaxTotalAmount']),
    lineTotalAmount: firstNumber(summation, ['LineTotalAmount']),
    chargeTotalAmount: firstNumber(summation, ['ChargeTotalAmount']),
    allowanceTotalAmount: firstNumber(summation, ['AllowanceTotalAmount']),
    totalAmount: grossAmount,
    customerName: buyerInfo.name,
    lineItems: toArray(getPath(tradeTransaction, 'IncludedSupplyChainTradeLineItem'))
      .filter(Boolean)
      .map(parseCiiLineItem),
    buyerInfo,
    sellerInfo,
    rawXml,
  };
}

function parseUblInvoice(root: unknown, rawXml: string, rootType: 'Invoice' | 'CreditNote'): ParsedEInvoice {
  const buyerInfo = parseUblParty(getPath(root, 'AccountingCustomerParty.Party'));
  const sellerInfo = parseUblParty(getPath(root, 'AccountingSupplierParty.Party'));
  const summation = getPath(root, 'LegalMonetaryTotal');
  const documentTypeCode = firstText(root, ['InvoiceTypeCode', 'CreditNoteTypeCode']);
  const grossAmount = firstNumber(summation, ['TaxInclusiveAmount']);
  const prepaidAmount = firstNumber(summation, ['PrepaidAmount']);
  const roundingAmount = firstNumber(summation, ['PayableRoundingAmount']);
  const dueAmount = firstNumber(summation, ['PayableAmount']);
  const currency = normalizeCurrency(
    firstText(root, ['DocumentCurrencyCode'])
      || getCurrencyFromAmount(getPath(summation, 'TaxInclusiveAmount'))
      || getCurrencyFromAmount(getPath(summation, 'PayableAmount')),
  );

  return {
    format: 'UBL',
    extractionStatus: 'PARSED',
    validationStatus: 'NOT_VALIDATED',
    documentType: parseDocumentType(documentTypeCode, rootType),
    documentTypeCode,
    currency,
    invoiceNumber: getText(root, 'ID'),
    invoiceDate: firstDate(root, ['IssueDate', 'TaxPointDate']),
    dueDate: getDate(root, 'DueDate'),
    grossAmount,
    prepaidAmount,
    roundingAmount,
    dueAmount,
    netAmount: firstNumber(summation, ['TaxExclusiveAmount']),
    taxAmount: firstNumber(root, ['TaxTotal.TaxAmount']),
    lineTotalAmount: firstNumber(summation, ['LineExtensionAmount']),
    chargeTotalAmount: firstNumber(summation, ['ChargeTotalAmount']),
    allowanceTotalAmount: firstNumber(summation, ['AllowanceTotalAmount']),
    totalAmount: grossAmount,
    customerName: buyerInfo.name,
    lineItems: toArray(getPath(root, rootType === 'CreditNote' ? 'CreditNoteLine' : 'InvoiceLine'))
      .filter(Boolean)
      .map(parseUblLineItem),
    buyerInfo,
    sellerInfo,
    rawXml,
  };
}

function decodeXmlCandidate(data: Uint8Array): string | null {
  try {
    const text = new TextDecoder().decode(data);
    return text.trim().startsWith('<') ? text : null;
  } catch {
    return null;
  }
}

function inflateXmlCandidate(data: Uint8Array): string | null {
  try {
    const inflated = zlib.inflateSync(Buffer.from(data), { maxOutputLength: MAX_XML_INPUT_BYTES });
    const text = new TextDecoder().decode(inflated);
    return text.trim().startsWith('<') ? text : null;
  } catch {
    return null;
  }
}

function gunzipXmlCandidate(data: Uint8Array): string | null {
  try {
    const gunzipped = zlib.gunzipSync(Buffer.from(data), { maxOutputLength: MAX_XML_INPUT_BYTES });
    const text = new TextDecoder().decode(gunzipped);
    return text.trim().startsWith('<') ? text : null;
  } catch {
    return null;
  }
}

async function extractAttachments(pdfDoc: PDFDocument): Promise<PdfAttachment[]> {
  const rawAttachments = (() => {
    if (!pdfDoc.catalog.has(PDFName.of('Names'))) return [];
    const names = pdfDoc.catalog.lookup(PDFName.of('Names'), PDFDict);

    if (!names.has(PDFName.of('EmbeddedFiles'))) return [];
    const embeddedFiles = names.lookup(PDFName.of('EmbeddedFiles'), PDFDict);

    if (!embeddedFiles.has(PDFName.of('Names'))) return [];
    const efNames = embeddedFiles.lookup(PDFName.of('Names'), PDFArray);

    if (efNames.size() > 128) throw new RequestBodyLimitError('Zu viele PDF-Anhänge');
    const attachments: { fileName: PDFHexString | PDFString; fileSpec: PDFDict }[] = [];
    for (let idx = 0, len = efNames.size(); idx < len; idx += 2) {
      const fileName = efNames.lookup(idx) as PDFHexString | PDFString;
      const fileSpec = efNames.lookup(idx + 1, PDFDict);
      attachments.push({ fileName, fileSpec });
    }
    return attachments;
  })();

  return rawAttachments.map(({ fileName, fileSpec }) => {
    const stream = fileSpec.lookup(PDFName.of('EF'), PDFDict).lookup(PDFName.of('F'), PDFStream);
    return {
      name: fileName.decodeText(),
      data: stream.getContents(),
    };
  });
}

export async function extractEmbeddedEInvoiceXml(pdfBuffer: Buffer): Promise<string | null> {
  if (pdfBuffer.byteLength > MAX_INVOICE_UPLOAD_BYTES) throw new RequestBodyLimitError('PDF ist zu groß');
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const attachments = await extractAttachments(pdfDoc);
  const candidates = attachments.filter(attachment => {
    const name = attachment.name.toLowerCase();
    return name.includes('zugferd') || name.includes('factur') || name.includes('xrechnung') || name.endsWith('.xml');
  });

  for (const attachment of candidates) {
    if (attachment.data.byteLength > MAX_XML_INPUT_BYTES) continue;
    const decoded = decodeXmlCandidate(attachment.data);
    if (decoded) return decoded;

    const inflated = inflateXmlCandidate(attachment.data);
    if (inflated) return inflated;

    const gunzipped = gunzipXmlCandidate(attachment.data);
    if (gunzipped) return gunzipped;
  }

  return null;
}

export async function parseEInvoiceXml(xmlContent: string): Promise<ParsedEInvoice> {
  if (Buffer.byteLength(xmlContent, 'utf8') > MAX_XML_INPUT_BYTES) throw new RequestBodyLimitError('XML ist zu groß');
  const rawXml = xmlContent.trim();
  if (!rawXml.startsWith('<')) {
    throw new Error('Die E-Rechnungsdatei enthält kein XML.');
  }

  const parsedXml = await parseStringPromise(rawXml, { explicitArray: false, trim: true }) as XmlObject;
  const ciiRoot = getChild(parsedXml, 'CrossIndustryInvoice');
  if (ciiRoot && getPath(ciiRoot, 'SupplyChainTradeTransaction')) {
    return parseCiiInvoice(ciiRoot, rawXml);
  }

  const ublRoot = getChild(parsedXml, 'Invoice');
  if (ublRoot && getPath(ublRoot, 'LegalMonetaryTotal')) {
    return parseUblInvoice(ublRoot, rawXml, 'Invoice');
  }

  const creditNoteRoot = getChild(parsedXml, 'CreditNote');
  if (creditNoteRoot && getPath(creditNoteRoot, 'LegalMonetaryTotal')) {
    return parseUblInvoice(creditNoteRoot, rawXml, 'CreditNote');
  }

  throw new Error('Unbekannte E-Rechnungsstruktur. Unterstützt werden ZUGFeRD/Factur-X CII und XRechnung-UBL.');
}

/**
 * Returns a user-facing reason when the current EUR-only invoice ledger cannot
 * safely book the extracted document. Parsing remains format tolerant, but the
 * upload boundary must not turn unsupported values into EUR invoices.
 */
export function getEInvoiceImportRejection(parsed: ParsedEInvoice): string | null {
  if (parsed.documentType === 'CREDIT_NOTE') {
    return 'Der Import von Gutschriften (Dokumenttyp 381) wird derzeit nicht unterstützt.';
  }
  if (parsed.documentType === 'DEBIT_NOTE') {
    return 'Der Import von Belastungsanzeigen (Dokumenttyp 383) wird derzeit nicht unterstützt.';
  }
  if (parsed.documentType !== 'INVOICE') {
    return 'Der Dokumenttyp der E-Rechnung ist nicht unterstützt.';
  }
  if (!parsed.invoiceDate || Number.isNaN(parsed.invoiceDate.getTime())) {
    return 'Das Rechnungsdatum fehlt oder ist ungültig.';
  }
  if (!parsed.currency) {
    return 'Die Rechnungswährung fehlt. Nur E-Rechnungen mit eindeutig angegebener Währung können importiert werden.';
  }
  if (parsed.currency !== 'EUR') {
    return `Die Rechnungswährung ${parsed.currency} wird nicht unterstützt. Der Import ist derzeit nur für EUR möglich.`;
  }
  if (parsed.grossAmount === null || !Number.isFinite(parsed.grossAmount) || parsed.grossAmount < 0) {
    return 'Der Bruttogesamtbetrag (BT-112) fehlt. Die E-Rechnung kann nicht sicher verbucht werden.';
  }
  if (parsed.dueAmount === null || !Number.isFinite(parsed.dueAmount)) {
    return 'Der fällige Betrag (BT-115) fehlt. Die E-Rechnung kann nicht sicher verbucht werden.';
  }
  if (parsed.prepaidAmount !== null && Math.abs(parsed.prepaidAmount) > 0.000001) {
    return 'E-Rechnungen mit Vorauszahlungen (BT-113) werden derzeit nicht unterstützt.';
  }
  if (parsed.roundingAmount !== null && Math.abs(parsed.roundingAmount) > 0.000001) {
    return 'E-Rechnungen mit Rundungsbetrag (BT-114) werden derzeit nicht unterstützt.';
  }
  if (Math.abs(parsed.dueAmount - parsed.grossAmount) > 0.005) {
    return 'Der fällige Betrag (BT-115) weicht vom Bruttogesamtbetrag (BT-112) ab. Diese Zahlungsabzüge werden derzeit nicht unterstützt.';
  }
  return null;
}

/** Validate an already stored import before it enters payment bookkeeping. */
export async function getEInvoiceBookingRejection(parsedData: unknown): Promise<string | null> {
  const rawXml = getRawEInvoiceXml(parsedData);
  if (rawXml) {
    try {
      return getEInvoiceImportRejection(await parseEInvoiceXml(rawXml));
    } catch {
      return 'Die gespeicherte E-Rechnungs-XML konnte nicht erneut gelesen werden.';
    }
  }

  let data = parsedData;
  if (typeof data === 'string') {
    try { data = JSON.parse(data) as unknown; } catch { return null; }
  }
  if (!isRecord(data)) return null;

  const format = typeof data.eInvoiceFormat === 'string' || typeof data.documentType === 'string';
  if (!format) return null;
  const documentType = typeof data.documentType === 'string' ? data.documentType : 'INVOICE';
  if (documentType !== 'INVOICE') return 'Dieser gespeicherte E-Rechnungsbeleg ist keine unterstützte Rechnung.';
  const currency = typeof data.currency === 'string' ? data.currency.toUpperCase() : null;
  if (!currency) return 'Die Währung der gespeicherten E-Rechnung ist nicht bekannt. Eine Buchung ist nicht sicher möglich.';
  if (currency !== 'EUR') return `Die Rechnungswährung ${currency} wird nicht unterstützt. Buchungen sind derzeit nur für EUR möglich.`;
  const prepaidAmount = typeof data.prepaidAmount === 'number' ? data.prepaidAmount : null;
  if (prepaidAmount !== null && Math.abs(prepaidAmount) > 0.000001) return 'E-Rechnungen mit Vorauszahlungen werden derzeit nicht unterstützt.';
  const roundingAmount = typeof data.roundingAmount === 'number' ? data.roundingAmount : null;
  if (roundingAmount !== null && Math.abs(roundingAmount) > 0.000001) return 'E-Rechnungen mit Rundungsbetrag werden derzeit nicht unterstützt.';
  return null;
}

export function getRawEInvoiceXml(parsedData: unknown): string | null {
  let data = parsedData;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data) as unknown;
    } catch {
      return null;
    }
  }

  if (!isRecord(data)) return null;
  const rawXml = data.rawXml;
  return typeof rawXml === 'string' && rawXml.trim().startsWith('<') ? rawXml : null;
}
