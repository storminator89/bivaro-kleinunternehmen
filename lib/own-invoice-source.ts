import { calculateInvoiceAmounts } from './invoice-calculation';
import type { ZugferdData, ZugferdTaxCategory, ZugferdTaxMode } from './zugferd-generator';

/** The rendering endpoint accepts invoice data, never PDF drawing commands or paths. */
export const MAX_OWN_INVOICE_JSON_BYTES = 512 * 1024;
export const MAX_OWN_INVOICE_ITEMS = 200;
export const MAX_OWN_INVOICE_TEXT_LENGTH = 100_000;

export type OwnInvoiceItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  unit: string;
  taxRate: number;
  taxCategory?: ZugferdTaxCategory;
  exemptionReason?: string;
};

export type OwnInvoiceSettings = {
  companyName: string;
  companyAddress: string;
  taxNumber: string;
  iban: string;
  bic: string;
  bankName: string;
  footerText: string;
  email: string;
  telephone: string;
};

export type OwnInvoiceSource = {
  version: 1;
  invoiceNumber: string;
  /** A Gregorian civil date, not an instant or a user-supplied time zone. */
  date: string;
  dueDate: string;
  deliveryDate: string;
  customerAddress: string;
  customerId?: string;
  buyerReference: string;
  buyerCountry: string;
  buyerPostcode: string;
  buyerCity: string;
  buyerEmail: string;
  sellerCountry: string;
  sellerPostcode: string;
  sellerCity: string;
  taxMode: ZugferdTaxMode;
  items: OwnInvoiceItem[];
  settings: OwnInvoiceSettings;
  notes: string;
  includeQRCode: boolean;
  paymentMeansCode: '30' | '10';
};

export class OwnInvoiceInputError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'OwnInvoiceInputError';
  }
}

function invalid(field: string): never {
  throw new OwnInvoiceInputError(`Ungültiger Wert für ${field}.`);
}

function objectWithKeys(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(field);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid(field);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key))) return invalid(field);
  return result;
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return invalid(field);
  return value;
}

function civilDateParts(value: string): { year: number; month: number; day: number } {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return invalid('Datum');
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || year > 9999 || month < 1 || month > 12) return invalid('Datum');
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > days[month - 1]) return invalid('Datum');
  return { year, month, day };
}

/** Explicit UTC construction avoids both host-zone shifts and Date.UTC's 0–99 year remapping. */
export function parseOwnInvoiceCivilDate(value: string): Date {
  const { year, month, day } = civilDateParts(value);
  const result = new Date(0);
  result.setUTCHours(12, 0, 0, 0);
  result.setUTCFullYear(year, month - 1, day);
  return result;
}

export function formatOwnInvoiceDate(value?: string): string {
  if (!value) return '-';
  const date = parseOwnInvoiceCivilDate(value);
  return `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}.${String(date.getUTCFullYear()).padStart(4, '0')}`;
}

/**
 * The existing XML builder deliberately reads local calendar fields. Preserve
 * that contract rather than passing a UTC midnight that can become yesterday.
 * A zone with a historically skipped entire day cannot represent that date as
 * a local Date; reject explicitly instead of silently exporting another day.
 */
export function toOwnInvoiceLocalDate(value: string): Date {
  const { year, month, day } = civilDateParts(value);
  const result = new Date(0);
  result.setHours(12, 0, 0, 0);
  result.setFullYear(year, month - 1, day);
  if (result.getFullYear() !== year || result.getMonth() !== month - 1 || result.getDate() !== day) {
    throw new OwnInvoiceInputError('Das Datum kann in der Server-Zeitzone nicht unverändert dargestellt werden.');
  }
  return result;
}

export function parseOwnInvoiceSource(value: unknown): OwnInvoiceSource {
  const source = objectWithKeys(value, [
    'version', 'invoiceNumber', 'date', 'dueDate', 'deliveryDate', 'customerAddress', 'customerId',
    'buyerReference', 'buyerCountry', 'buyerPostcode', 'buyerCity', 'buyerEmail', 'sellerCountry',
    'sellerPostcode', 'sellerCity', 'taxMode', 'items', 'settings', 'notes', 'includeQRCode', 'paymentMeansCode',
  ], 'Rechnungsdaten');
  if (source.version !== 1) return invalid('version');
  let textLength = 0;
  const text = (record: Record<string, unknown>, key: string, maxLength: number, required = true): string => {
    const candidate = record[key];
    if (candidate === undefined && !required) return '';
    if (typeof candidate !== 'string' || candidate.length > maxLength) return invalid(key);
    const multilineFields = ['description', 'exemptionReason', 'notes', 'companyAddress', 'customerAddress', 'footerText', 'buyerReference'];
    if (!multilineFields.includes(key) && /[\r\n\t\u2028\u2029]/u.test(candidate)) return invalid(key);
    // XML 1.0 and the embedded fonts must never receive malformed Unicode or controls.
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ufffe\uffff]/u.test(candidate)) return invalid(key);
    for (const character of candidate) {
      const codePoint = character.codePointAt(0)!;
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) return invalid(key);
    }
    textLength += candidate.length;
    if (textLength > MAX_OWN_INVOICE_TEXT_LENGTH) {
      throw new OwnInvoiceInputError('Die Rechnung enthält zu viel Text.');
    }
    return candidate;
  };
  const settings = objectWithKeys(source.settings, [
    'companyName', 'companyAddress', 'taxNumber', 'iban', 'bic', 'bankName', 'footerText', 'email', 'telephone',
  ], 'settings');
  if (source.taxMode !== 'small-business' && source.taxMode !== 'standard') return invalid('taxMode');
  if (source.paymentMeansCode !== '30' && source.paymentMeansCode !== '10') return invalid('paymentMeansCode');
  if (typeof source.includeQRCode !== 'boolean') return invalid('includeQRCode');
  if (!Array.isArray(source.items) || source.items.length === 0 || source.items.length > MAX_OWN_INVOICE_ITEMS) return invalid('items');
  const items = source.items.map((value, index): OwnInvoiceItem => {
    const item = objectWithKeys(value, ['description', 'quantity', 'unitPrice', 'unit', 'taxRate', 'taxCategory', 'exemptionReason'], `items.${index}`);
    const taxCategory = item.taxCategory;
    if (taxCategory !== undefined && taxCategory !== 'S' && taxCategory !== 'E' && taxCategory !== 'Z') return invalid(`items.${index}.taxCategory`);
    return {
      description: text(item, 'description', 4_000),
      quantity: finiteNumber(item.quantity, `items.${index}.quantity`),
      unitPrice: finiteNumber(item.unitPrice, `items.${index}.unitPrice`),
      unit: text(item, 'unit', 40),
      taxRate: finiteNumber(item.taxRate, `items.${index}.taxRate`),
      ...(taxCategory === undefined ? {} : { taxCategory }),
      ...(item.exemptionReason === undefined ? {} : { exemptionReason: text(item, 'exemptionReason', 2_000) }),
    };
  });
  const parsed: OwnInvoiceSource = {
    version: 1,
    invoiceNumber: text(source, 'invoiceNumber', 200),
    date: text(source, 'date', 10),
    dueDate: text(source, 'dueDate', 10),
    deliveryDate: text(source, 'deliveryDate', 10),
    customerAddress: text(source, 'customerAddress', 2_000),
    ...(source.customerId === undefined ? {} : { customerId: text(source, 'customerId', 100) }),
    buyerReference: text(source, 'buyerReference', 200),
    buyerCountry: text(source, 'buyerCountry', 2),
    buyerPostcode: text(source, 'buyerPostcode', 40),
    buyerCity: text(source, 'buyerCity', 200),
    buyerEmail: text(source, 'buyerEmail', 320),
    sellerCountry: text(source, 'sellerCountry', 2),
    sellerPostcode: text(source, 'sellerPostcode', 40),
    sellerCity: text(source, 'sellerCity', 200),
    taxMode: source.taxMode,
    items,
    settings: {
      companyName: text(settings, 'companyName', 200, false),
      companyAddress: text(settings, 'companyAddress', 2_000, false),
      taxNumber: text(settings, 'taxNumber', 200, false),
      iban: text(settings, 'iban', 100, false),
      bic: text(settings, 'bic', 40, false),
      bankName: text(settings, 'bankName', 200, false),
      footerText: text(settings, 'footerText', 4_000, false),
      email: text(settings, 'email', 320, false),
      telephone: text(settings, 'telephone', 100, false),
    },
    notes: text(source, 'notes', 20_000),
    includeQRCode: source.includeQRCode,
    paymentMeansCode: source.paymentMeansCode,
  };
  parseOwnInvoiceCivilDate(parsed.date);
  if (parsed.dueDate) parseOwnInvoiceCivilDate(parsed.dueDate);
  if (parsed.deliveryDate) parseOwnInvoiceCivilDate(parsed.deliveryDate);
  if (!/^[A-Z]{2}$/u.test(parsed.buyerCountry) || !/^[A-Z]{2}$/u.test(parsed.sellerCountry)) return invalid('country');
  try {
    calculateInvoiceAmounts(parsed.items);
  } catch {
    throw new OwnInvoiceInputError('Die Rechnungsbeträge liegen außerhalb des unterstützten Zahlenbereichs.');
  }
  if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength > MAX_OWN_INVOICE_JSON_BYTES) {
    throw new OwnInvoiceInputError('Die Rechnungsdaten sind zu groß.');
  }
  return parsed;
}

/** Recompute amounts from the same bounded source that supplies the visual invoice. */
export function ownInvoiceToZugferdData(source: OwnInvoiceSource): ZugferdData {
  const amounts = calculateInvoiceAmounts(source.items);
  return {
    invoiceNumber: source.invoiceNumber,
    buyerReference: source.buyerReference.trim() || undefined,
    taxMode: source.taxMode,
    paymentMeansCode: source.paymentMeansCode,
    date: toOwnInvoiceLocalDate(source.date),
    dueDate: source.dueDate ? toOwnInvoiceLocalDate(source.dueDate) : undefined,
    paymentTerms: source.dueDate ? undefined : 'Zahlbar nach Erhalt der Rechnung',
    deliveryDate: source.deliveryDate ? toOwnInvoiceLocalDate(source.deliveryDate) : undefined,
    seller: {
      name: source.settings.companyName,
      address: source.settings.companyAddress,
      countryCode: source.sellerCountry,
      zipCode: source.sellerCountry === 'DE' ? undefined : source.sellerPostcode.trim(),
      city: source.sellerCountry === 'DE' ? undefined : source.sellerCity.trim(),
      email: source.settings.email,
      telephone: source.settings.telephone,
      taxNumber: source.settings.taxNumber,
      iban: source.settings.iban,
      bic: source.settings.bic,
    },
    buyer: {
      name: source.customerAddress.split('\n')[0]?.trim() || '',
      address: source.customerAddress,
      countryCode: source.buyerCountry,
      zipCode: source.buyerCountry === 'DE' ? undefined : source.buyerPostcode.trim(),
      city: source.buyerCountry === 'DE' ? undefined : source.buyerCity.trim(),
      email: source.buyerEmail.trim() || undefined,
    },
    items: source.items.map((item, index) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      unit: item.unit,
      taxRate: item.taxRate,
      taxCategory: source.taxMode === 'small-business' ? 'E' : item.taxCategory,
      exemptionReason: item.exemptionReason,
      total: amounts.lines[index].netAmount,
    })),
    netAmount: amounts.netAmount,
    taxAmount: amounts.taxAmount,
    currency: 'EUR',
  };
}
