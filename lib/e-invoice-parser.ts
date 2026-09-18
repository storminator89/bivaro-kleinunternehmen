import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFStream, PDFString } from 'pdf-lib';
import { parseStringPromise } from 'xml2js';
import zlib from 'zlib';
import { MAX_XML_INPUT_BYTES, MAX_INVOICE_UPLOAD_BYTES, RequestBodyLimitError } from '@/lib/resource-limits';

type XmlObject = Record<string, unknown>;

export type EInvoiceFormat = 'CII' | 'UBL';

export type ParsedEInvoiceParty = {
  name: string | null;
  email: string | null;
  address: string | null;
  zipCode: string | null;
  city: string | null;
  country: string | null;
};

export type ParsedEInvoiceLineItem = {
  positionNumber: string | null;
  description: string | null;
  details: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  amount: number | null;
  taxRate: number | null;
};

export type ParsedEInvoice = {
  format: EInvoiceFormat;
  invoiceNumber: string | null;
  invoiceDate: Date | null;
  dueDate: Date | null;
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
  const number = Number.parseFloat(text.replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function getNumber(obj: unknown, path: string): number | null {
  return asNumber(getPath(obj, path));
}

function asDate(value: unknown): Date | null {
  const text = asText(value);
  if (!text) return null;

  const compactDate = text.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compactDate) {
    return new Date(`${compactDate[1]}-${compactDate[2]}-${compactDate[3]}`);
  }

  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) {
    return new Date(`${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`);
  }

  return null;
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

function parseCiiParty(party: unknown): ParsedEInvoiceParty {
  if (!party) return { ...emptyParty };

  const addressNode = getPath(party, 'PostalTradeAddress');
  return {
    name: getText(party, 'Name'),
    email: firstText(party, [
      'DefinedTradeContact.EmailURIUniversalCommunication.URIID',
      'URIUniversalCommunication.URIID',
    ]),
    address: firstText(addressNode, ['LineOne', 'LineTwo', 'LineThree']),
    zipCode: getText(addressNode, 'PostcodeCode'),
    city: getText(addressNode, 'CityName'),
    country: getText(addressNode, 'CountryID'),
  };
}

function parseUblParty(party: unknown): ParsedEInvoiceParty {
  if (!party) return { ...emptyParty };

  const addressNode = getPath(party, 'PostalAddress');
  return {
    name: firstText(party, [
      'PartyName.Name',
      'PartyLegalEntity.RegistrationName',
      'EndpointID',
    ]),
    email: getText(party, 'Contact.ElectronicMail'),
    address: firstText(addressNode, [
      'StreetName',
      'AddressLine.Line',
    ]),
    zipCode: getText(addressNode, 'PostalZone'),
    city: getText(addressNode, 'CityName'),
    country: getText(addressNode, 'Country.IdentificationCode'),
  };
}

function parseCiiLineItem(item: unknown): ParsedEInvoiceLineItem {
  const quantityNode = getPath(item, 'SpecifiedLineTradeDelivery.BilledQuantity');

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
    amount: getNumber(item, 'SpecifiedLineTradeSettlement.SpecifiedTradeSettlementLineMonetarySummation.LineTotalAmount'),
    taxRate: getNumber(item, 'SpecifiedLineTradeSettlement.ApplicableTradeTax.RateApplicablePercent'),
  };
}

function parseUblLineItem(item: unknown): ParsedEInvoiceLineItem {
  const quantityNode = getPath(item, 'InvoicedQuantity');

  return {
    positionNumber: getText(item, 'ID'),
    description: firstText(item, [
      'Item.Name',
      'Item.Description',
    ]),
    details: getText(item, 'Item.Description'),
    quantity: asNumber(quantityNode),
    unit: getAttribute(quantityNode, 'unitCode'),
    unitPrice: getNumber(item, 'Price.PriceAmount'),
    amount: getNumber(item, 'LineExtensionAmount'),
    taxRate: firstNumber(item, [
      'Item.ClassifiedTaxCategory.Percent',
      'TaxTotal.TaxSubtotal.TaxCategory.Percent',
    ]),
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

  return {
    format: 'CII',
    invoiceNumber: getText(exchangedDoc, 'ID'),
    invoiceDate: getDate(exchangedDoc, 'IssueDateTime.DateTimeString'),
    dueDate: getDate(settlement, 'SpecifiedTradePaymentTerms.DueDateDateTime.DateTimeString'),
    totalAmount: firstNumber(summation, ['GrandTotalAmount', 'DuePayableAmount']),
    customerName: buyerInfo.name,
    lineItems: toArray(getPath(tradeTransaction, 'IncludedSupplyChainTradeLineItem'))
      .filter(Boolean)
      .map(parseCiiLineItem),
    buyerInfo,
    sellerInfo,
    rawXml,
  };
}

function parseUblInvoice(root: unknown, rawXml: string): ParsedEInvoice {
  const buyerInfo = parseUblParty(getPath(root, 'AccountingCustomerParty.Party'));
  const sellerInfo = parseUblParty(getPath(root, 'AccountingSupplierParty.Party'));

  return {
    format: 'UBL',
    invoiceNumber: getText(root, 'ID'),
    invoiceDate: firstDate(root, ['IssueDate', 'TaxPointDate']),
    dueDate: getDate(root, 'DueDate'),
    totalAmount: firstNumber(root, [
      'LegalMonetaryTotal.PayableAmount',
      'LegalMonetaryTotal.TaxInclusiveAmount',
      'LegalMonetaryTotal.LineExtensionAmount',
    ]),
    customerName: buyerInfo.name,
    lineItems: toArray(getPath(root, 'InvoiceLine'))
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
    return parseUblInvoice(ublRoot, rawXml);
  }

  throw new Error('Unbekannte E-Rechnungsstruktur. Unterstützt werden ZUGFeRD/Factur-X CII und XRechnung-UBL.');
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
