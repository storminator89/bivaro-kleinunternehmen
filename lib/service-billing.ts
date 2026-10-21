import { formatBusinessDate, parseBusinessDate } from '@/lib/business-date';
import { calculateInvoiceAmounts } from '@/lib/invoice-calculation';
import type { DocumentTaxMode } from '@/lib/document-tax-profile';
import { quoteBusinessToday } from '@/lib/quote-workflow';

export const SERVICE_BILLING_CADENCES = ['MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export type ServiceBillingCadence = typeof SERVICE_BILLING_CADENCES[number];
export type ServiceBillingItem = {
  description: string; quantity: number; unitPrice: number; unit: string; taxRate: number;
  taxCategory?: 'S' | 'E' | 'Z'; exemptionReason?: string;
};
export type ServiceBillingPlanInput = {
  name: string; customerId: number; cadence: ServiceBillingCadence; anchorDate: string;
  taxMode: DocumentTaxMode; items: ServiceBillingItem[];
};
export class ServiceBillingError extends Error {
  constructor(message: string, public status = 400, public code = 'INVALID_SERVICE_PLAN') { super(message); }
}
export const serviceBillingToday = quoteBusinessToday;
export function serviceBillingRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
export function serviceBillingText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ServiceBillingError(`${label} fehlt oder ist zu lang.`);
  return value.trim();
}
export function serviceBillingIndex(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 119_987) throw new ServiceBillingError('Ungültige Planperiode.');
  return value;
}
export function serviceBillingRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 2_147_483_646) throw new ServiceBillingError('Bitte den Plan neu laden. Eine gültige Revision ist erforderlich.');
  return value;
}
export function readServiceBillingItems(value: unknown, taxMode: DocumentTaxMode): ServiceBillingItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) throw new ServiceBillingError('Bitte 1 bis 50 Leistungspositionen angeben.');
  const items = value.map((raw, index): ServiceBillingItem => {
    if (!serviceBillingRecord(raw)) throw new ServiceBillingError('Ungültige Leistungsposition.');
    if (Object.hasOwn(raw, 'billingNoteId') || Object.hasOwn(raw, 'billingNoteIds')) throw new ServiceBillingError('Leistungsnotizen können in Serviceentwürfen nicht übernommen werden. Bitte dafür eine separate neue Rechnung verwenden.', 400, 'UNSUPPORTED_SERVICE_BILLING_NOTES');
    const description = serviceBillingText(raw.description, `Position ${index + 1}: Beschreibung`, 2000);
    const unit = serviceBillingText(raw.unit, `Position ${index + 1}: Einheit`, 100);
    const { quantity, unitPrice, taxRate } = raw;
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000 || !/^\d+(?:\.\d{1,6})?$/.test(String(quantity))) throw new ServiceBillingError('Die Menge muss positiv sein und höchstens 6 Nachkommastellen haben.');
    if (typeof unitPrice !== 'number' || !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 9_999_999.99 || !/^\d+(?:\.\d{1,2})?$/.test(String(unitPrice))) throw new ServiceBillingError('Der Netto-Einzelpreis muss ein nicht negativer Eurobetrag mit höchstens 2 Nachkommastellen sein.');
    if (typeof taxRate !== 'number' || ![0, 7, 19].includes(taxRate)) throw new ServiceBillingError('Nicht unterstützter Steuersatz.');
    const category = raw.taxCategory;
    const reason = raw.exemptionReason;
    if (category !== undefined && !['S', 'E', 'Z'].includes(String(category))) throw new ServiceBillingError('Nicht unterstützte Steuerkategorie.');
    if (reason !== undefined && (typeof reason !== 'string' || reason.length > 500)) throw new ServiceBillingError('Ungültiger Steuerbefreiungsgrund.');
    if (taxMode === 'small-business') {
      if (taxRate !== 0 || (category !== undefined && category !== 'E') || reason) throw new ServiceBillingError('Kleinunternehmer-Positionen müssen ohne Umsatzsteuer erfasst werden.');
      return { description, quantity, unitPrice, unit, taxRate: 0, taxCategory: 'E' };
    }
    if (taxRate === 0 && (!['E', 'Z'].includes(String(category)) || typeof reason !== 'string' || !reason.trim())) throw new ServiceBillingError('0 % benötigt eine ausdrücklich gewählte Steuerkategorie und einen eigenen Befreiungsgrund.');
    if (taxRate > 0 && ((category !== undefined && category !== 'S') || reason)) throw new ServiceBillingError('Steuersatz und Steuerkategorie passen nicht zusammen.');
    return { description, quantity, unitPrice, unit, taxRate, ...(category ? { taxCategory: category as 'S' | 'E' | 'Z' } : {}), ...(reason ? { exemptionReason: String(reason).trim() } : {}) };
  });
  // Reuse native decimal/BigInt rounding. Never accumulate binary line totals.
  const total = calculateInvoiceAmounts(items).grossAmount;
  if (total > 999_999_999.99) throw new ServiceBillingError('Der Planbetrag überschreitet den unterstützten Bereich.');
  return items;
}
export function readServiceBillingPlanInput(value: unknown): ServiceBillingPlanInput {
  if (!serviceBillingRecord(value)) throw new ServiceBillingError('Ein Planobjekt ist erforderlich.');
  const name = serviceBillingText(value.name, 'Planname', 200);
  if (typeof value.customerId !== 'number' || !Number.isSafeInteger(value.customerId) || value.customerId <= 0) throw new ServiceBillingError('Bitte einen Kunden auswählen.');
  if (!SERVICE_BILLING_CADENCES.includes(value.cadence as ServiceBillingCadence)) throw new ServiceBillingError('Bitte monatlich, quartalsweise oder jährlich auswählen.');
  try { parseBusinessDate(value.anchorDate); } catch { throw new ServiceBillingError('Bitte ein gültiges Startdatum angeben.'); }
  if (String(value.anchorDate) < '1900-01-01' || String(value.anchorDate) > '9998-12-31') throw new ServiceBillingError('Das Startdatum muss zwischen 1900 und 9998 liegen.');
  if (value.taxMode !== 'small-business' && value.taxMode !== 'standard') throw new ServiceBillingError('Bitte den Steuer-Modus ausdrücklich auswählen.');
  return { name, customerId: value.customerId, cadence: value.cadence as ServiceBillingCadence, anchorDate: String(value.anchorDate), taxMode: value.taxMode, items: readServiceBillingItems(value.items, value.taxMode) };
}

/** Always derive from original anchor: Jan 31 -> Feb 28 -> Mar 31, not Mar 28. */
function anchoredDate(anchor: Date, months: number): string {
  const target = new Date(0);
  target.setUTCFullYear(anchor.getUTCFullYear(), anchor.getUTCMonth() + months + 1, 0);
  target.setUTCHours(0, 0, 0, 0);
  const day = Math.min(anchor.getUTCDate(), target.getUTCDate());
  target.setUTCDate(day);
  if (target.getUTCFullYear() > 9999) throw new ServiceBillingError('Der nächste Zeitraum liegt außerhalb des unterstützten Kalenders.');
  return formatBusinessDate(target);
}
export function getServiceBillingPeriod(anchorDate: string, cadence: string, index: number) {
  const anchor = parseBusinessDate(anchorDate);
  serviceBillingIndex(index);
  const months = cadence === 'MONTHLY' ? 1 : cadence === 'QUARTERLY' ? 3 : cadence === 'YEARLY' ? 12 : 0;
  if (!months) throw new ServiceBillingError('Ungültiges Planintervall.');
  const periodStart = anchoredDate(anchor, index * months);
  const nextDue = anchoredDate(anchor, (index + 1) * months);
  const end = parseBusinessDate(nextDue); end.setUTCDate(end.getUTCDate() - 1);
  return { periodStart, periodEnd: formatBusinessDate(end), nextDue };
}
export type ServiceBillingDraftSeed = {
  version: 1; planStableKey: string; periodIndex: number; periodStart: string; periodEnd: string;
  taxMode: DocumentTaxMode; items: ServiceBillingItem[]; customerAddress: string; notes: string;
};
const SERVICE_DRAFT_PARSED_FIELDS = ['_serviceBillingDraft', 'currency', 'documentType', 'netAmount', 'taxAmount', 'grossAmount', 'totalAmount', 'lineItems'] as const;
const SERVICE_DRAFT_ROW_FIELDS = new Set(['id', 'userId', 'customerId', 'type', 'fileName', 'storedFileName', 'uploadedAt', 'invoiceDate', 'dueDate', 'invoiceNumber', 'parsedData', 'totalAmount', 'status', 'issuanceState', 'paidAt', 'validUntil', 'quoteFollowUpOn', 'quoteResponseNote', 'originalInvoiceId', 'cancellationReason', 'convertedFromQuoteId', 'customer', 'originalInvoice', 'creditNotes', 'convertedFromQuote', 'convertedInvoice', 'incomes', 'paymentJournalEvents', 'paymentAdjustments', 'refundBasisAdjustments', 'billingNotes', 'reminders', 'serviceBillingPeriod']);
const SERVICE_DRAFT_MARKER_FIELDS = ['version', 'planStableKey', 'periodIndex', 'periodStart', 'periodEnd', 'taxMode', 'items', 'customerAddress', 'notes'] as const;
function hasExactlyServiceDraftFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}
function sameServiceDraftItem(value: unknown, expected: Record<string, unknown>): boolean {
  return serviceBillingRecord(value) && hasExactlyServiceDraftFields(value, Object.keys(expected)) && Object.entries(expected).every(([key, item]) => value[key] === item);
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function readServiceBillingDraftSeed(parsedData: unknown): ServiceBillingDraftSeed | null {
  if (!serviceBillingRecord(parsedData) || !hasExactlyServiceDraftFields(parsedData, SERVICE_DRAFT_PARSED_FIELDS) || !serviceBillingRecord(parsedData._serviceBillingDraft)) return null;
  const value = parsedData._serviceBillingDraft;
  if (!hasExactlyServiceDraftFields(value, SERVICE_DRAFT_MARKER_FIELDS)) return null;
  try {
    if (value.version !== 1 || typeof value.planStableKey !== 'string' || !UUID.test(value.planStableKey)) return null;
    const periodIndex = serviceBillingIndex(value.periodIndex);
    parseBusinessDate(value.periodStart); parseBusinessDate(value.periodEnd);
    if (String(value.periodStart) > String(value.periodEnd) || !['small-business','standard'].includes(String(value.taxMode))) return null;
    if (typeof value.customerAddress !== 'string' || value.customerAddress.length > 4000 || typeof value.notes !== 'string' || value.notes.length > 4000) return null;
    const taxMode = value.taxMode as DocumentTaxMode;
    const items = readServiceBillingItems(value.items, taxMode);
    if (!Array.isArray(value.items) || !value.items.every((item, index) => sameServiceDraftItem(item, items[index]))) return null;
    return { version: 1, planStableKey: value.planStableKey, periodIndex, periodStart: String(value.periodStart), periodEnd: String(value.periodEnd), taxMode, items, customerAddress: value.customerAddress, notes: value.notes };
  } catch { return null; }
}
/** Invalid markers must also block issuance rather than disguise an incomplete draft. */
export function hasServiceBillingDraftMarker(parsedData: unknown): boolean {
  // Legacy JSON strings are not canonical planning seeds, but must not bypass
  // marker-based issue/send/payment guards either. Never reinterpret or strip them.
  let value = parsedData;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return false; } }
  return serviceBillingRecord(value) && Object.hasOwn(value, '_serviceBillingDraft');
}
export function isUnrenderedServiceBillingDraft(row: unknown): boolean {
  if (!serviceBillingRecord(row) || row.type !== 'INVOICE' || row.status !== 'DRAFT' || row.issuanceState !== 'UNISSUED'
    || Object.keys(row).some(field => !SERVICE_DRAFT_ROW_FIELDS.has(field))
    || row.storedFileName !== '' || row.invoiceNumber !== null || row.invoiceDate !== null || row.dueDate !== null || row.paidAt != null) return false;
  if (['validUntil', 'originalInvoiceId', 'convertedFromQuoteId', 'cancellationReason', 'quoteFollowUpOn', 'quoteResponseNote', 'originalInvoice', 'convertedFromQuote', 'convertedInvoice'].some(field => row[field] != null)) return false;
  for (const field of ['creditNotes', 'incomes', 'paymentJournalEvents', 'paymentAdjustments', 'refundBasisAdjustments', 'reminders', 'billingNotes']) {
    const relation = row[field];
    if (Object.hasOwn(row, field) && (!Array.isArray(relation) || relation.length !== 0)) return false;
  }
  if (Object.hasOwn(row, 'customer')) {
    const customer = row.customer;
    if (!serviceBillingRecord(customer) || customer.id !== row.customerId || (customer.userId !== undefined && customer.userId !== row.userId)) return false;
  }
  const seed = readServiceBillingDraftSeed(row.parsedData);
  if (!seed || !serviceBillingRecord(row.parsedData)) return false;
  if (Object.hasOwn(row, 'serviceBillingPeriod')) {
    const receipt = row.serviceBillingPeriod;
    if (!serviceBillingRecord(receipt) || receipt.action !== 'GENERATED' || receipt.invoiceId !== row.id || typeof row.userId !== 'string' || receipt.userId !== row.userId
      || receipt.periodIndex !== seed.periodIndex || receipt.periodStart !== seed.periodStart || receipt.periodEnd !== seed.periodEnd) return false;
    if (Object.hasOwn(receipt, 'plan')) {
      const plan = receipt.plan;
      if (!serviceBillingRecord(plan) || plan.id !== receipt.planId || plan.userId !== row.userId || plan.stableKey !== seed.planStableKey) return false;
    }
  }
  const data = row.parsedData; const amounts = calculateInvoiceAmounts(seed.items);
  const lineItems = seed.items.map((item, index) => ({ ...item, positionNumber: String(index + 1), amount: amounts.lines[index].netAmount }));
  return row.totalAmount === amounts.grossAmount && data.currency === 'EUR' && data.documentType === 'INVOICE'
    && data.netAmount === amounts.netAmount && data.taxAmount === amounts.taxAmount && data.grossAmount === amounts.grossAmount
    && data.totalAmount === amounts.grossAmount && Array.isArray(data.lineItems) && data.lineItems.length === lineItems.length
    && data.lineItems.every((line, index) => sameServiceDraftItem(line, lineItems[index]));
}
