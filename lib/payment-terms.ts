/** Calendar-day suggestions only: no discounts, interest, collection or payment effects. */
export type PaymentTermSource = 'CUSTOMER' | 'COMPANY' | 'FALLBACK' | 'MANUAL';
export type PaymentTermSelection = {
  version: 1;
  source: PaymentTermSource;
  days: number | null;
  invoiceDate: string;
  dueDate: string | null;
  customerId: number | null;
};
export class PaymentTermError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = 'PaymentTermError'; }
}
export function parsePaymentTermDays(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 365) {
    throw new PaymentTermError('Zahlungsziel muss leer oder eine ganze Zahl von 0 bis 365 Tagen sein.');
  }
  return value;
}
export function isPaymentBusinessDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && Number(value.slice(0, 4)) >= 1;
}
/** Render a stored calendar date without the viewer's timezone moving its day. */
export function formatPaymentBusinessDate(value?: string): string {
  return isPaymentBusinessDate(value)
    ? new Date(`${value}T00:00:00.000Z`).toLocaleDateString('de-DE', { timeZone: 'UTC' })
    : '-';
}
export function addPaymentCalendarDays(date: string, days: number): string {
  if (!isPaymentBusinessDate(date)) throw new PaymentTermError('Ungültiges Rechnungsdatum.');
  parsePaymentTermDays(days);
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  const value = result.toISOString().slice(0, 10);
  if (!isPaymentBusinessDate(value)) throw new PaymentTermError('Zahlungsziel liegt außerhalb des unterstützten Datumsbereichs.');
  return value;
}
export function paymentToday(now = new Date()): string {
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function resolvePaymentTerm(customerDays?: number | null, companyDays?: number | null): { source: Exclude<PaymentTermSource, 'MANUAL'>; days: number } {
  if (customerDays != null) return { source: 'CUSTOMER', days: parsePaymentTermDays(customerDays)! };
  if (companyDays != null) return { source: 'COMPANY', days: parsePaymentTermDays(companyDays)! };
  return { source: 'FALLBACK', days: 14 };
}
export function paymentTermSuggestion(invoiceDate: string, customerId: number | null, customerDays?: number | null, companyDays?: number | null): PaymentTermSelection {
  const term = resolvePaymentTerm(customerDays, companyDays);
  return { version: 1, ...term, invoiceDate, dueDate: addPaymentCalendarDays(invoiceDate, term.days), customerId };
}
export function validatePaymentTermSelection(value: unknown): PaymentTermSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PaymentTermError('Ungültige Zahlungszielherkunft.');
  const row = value as Record<string, unknown>;
  const fields = ['version', 'source', 'days', 'invoiceDate', 'dueDate', 'customerId'];
  if (Object.keys(row).length !== fields.length || fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !fields.includes(field)) || row.version !== 1 || typeof row.source !== 'string' || !['CUSTOMER', 'COMPANY', 'FALLBACK', 'MANUAL'].includes(row.source)) throw new PaymentTermError('Ungültige Zahlungszielherkunft.');
  if (!isPaymentBusinessDate(row.invoiceDate) || (row.dueDate !== null && !isPaymentBusinessDate(row.dueDate))) throw new PaymentTermError('Ungültiges Zahlungszieldatum.');
  if (row.customerId !== null && (typeof row.customerId !== 'number' || !Number.isSafeInteger(row.customerId) || row.customerId <= 0)) throw new PaymentTermError('Ungültiger Zahlungszielkunde.');
  const days = parsePaymentTermDays(row.days);
  if (row.source === 'MANUAL') {
    if (days !== null) throw new PaymentTermError('Manuelle Fälligkeit darf keine Tagesvorgabe behaupten.');
  } else {
    if (days === null || (row.source === 'FALLBACK' && days !== 14) || (row.source === 'CUSTOMER' && row.customerId === null) || row.dueDate !== addPaymentCalendarDays(row.invoiceDate, days)) throw new PaymentTermError('Zahlungsziel und Vorgabe widersprechen sich.');
  }
  return { version: 1, source: row.source as PaymentTermSource, days, invoiceDate: row.invoiceDate, dueDate: row.dueDate as string | null, customerId: row.customerId as number | null };
}
export function assertPaymentTermDocument(selection: PaymentTermSelection, document: { invoiceDate: string | Date | null; dueDate: string | Date | null; customerId: number | null }): void {
  const calendar = (value: string | Date | null) => value === null ? null : value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
  if (selection.invoiceDate !== calendar(document.invoiceDate) || selection.dueDate !== calendar(document.dueDate) || selection.customerId !== document.customerId) throw new PaymentTermError('Zahlungszielherkunft passt nicht zum Dokument.');
}
export function assertCurrentPaymentTerm(selection: PaymentTermSelection, customerDays?: number | null, companyDays?: number | null): void {
  if (selection.source === 'MANUAL') return;
  const current = resolvePaymentTerm(customerDays, companyDays);
  if (selection.source !== current.source || selection.days !== current.days) throw new PaymentTermError('Die Zahlungszielvorgabe wurde geändert. Bitte Vorgabe erneut anwenden oder das Fälligkeitsdatum bewusst manuell bestätigen.', 409);
}
