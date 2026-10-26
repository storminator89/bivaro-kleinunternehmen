import { parseBusinessDate } from '@/lib/business-date';

export type IncomingInvoiceDateFilter = {
  invoiceDateFrom: string;
  invoiceDateTo: string;
  invoiceDateMissing: 'any' | 'only';
};
export const EMPTY_INVOICE_DATE_FILTER: IncomingInvoiceDateFilter = {
  invoiceDateFrom: '', invoiceDateTo: '', invoiceDateMissing: 'any',
};
export class IncomingInvoiceDateFilterError extends Error {
  constructor(message = 'Bitte ein gültiges Rechnungsdatum von 0001-01-01 bis 9999-12-31 eingeben.') {
    super(message); this.name = 'IncomingInvoiceDateFilterError';
  }
}
function day(value: unknown): string {
  if (value === undefined || value === '') return '';
  try { parseBusinessDate(value); } catch { throw new IncomingInvoiceDateFilterError(); }
  return value as string;
}

/** Calendar-only source filters. Never replace an unknown source date with a draft or upload date. */
export function parseIncomingInvoiceDateFilter(input: {
  invoiceDateFrom?: unknown; invoiceDateTo?: unknown; invoiceDateMissing?: unknown;
}): IncomingInvoiceDateFilter {
  const invoiceDateFrom = day(input.invoiceDateFrom), invoiceDateTo = day(input.invoiceDateTo);
  const invoiceDateMissing = input.invoiceDateMissing === undefined ? 'any' : input.invoiceDateMissing;
  if (invoiceDateMissing !== 'any' && invoiceDateMissing !== 'only') throw new IncomingInvoiceDateFilterError('Ungültige Auswahl für Belege ohne ausgelesenes Rechnungsdatum.');
  if (invoiceDateFrom && invoiceDateTo && invoiceDateFrom > invoiceDateTo) throw new IncomingInvoiceDateFilterError('Das Von-Datum darf nicht nach dem Bis-Datum liegen.');
  if (invoiceDateMissing === 'only' && (invoiceDateFrom || invoiceDateTo)) throw new IncomingInvoiceDateFilterError('Ohne ausgelesenes Rechnungsdatum ist kein Datumsbereich möglich. Bitte den Bereich entfernen.');
  return { invoiceDateFrom, invoiceDateTo, invoiceDateMissing };
}

export function incomingInvoiceDateFilterFromParams(params: URLSearchParams): IncomingInvoiceDateFilter {
  const input: Record<string, string> = {};
  for (const key of Object.keys(EMPTY_INVOICE_DATE_FILTER)) {
    const values = params.getAll(key);
    if (values.length > 1) throw new IncomingInvoiceDateFilterError('Jeden Rechnungsdatumfilter nur einmal angeben.');
    if (values.length) input[key] = values[0];
  }
  return parseIncomingInvoiceDateFilter(input);
}

/** Inclusive calendar endpoints; no local timezone or next-year overflow at 9999-12-31. */
export function incomingInvoiceDateBounds(filter: IncomingInvoiceDateFilter): { gte?: Date; lte?: Date } {
  const result: { gte?: Date; lte?: Date } = {};
  if (filter.invoiceDateFrom) result.gte = parseBusinessDate(filter.invoiceDateFrom);
  if (filter.invoiceDateTo) { result.lte = parseBusinessDate(filter.invoiceDateTo); result.lte.setUTCHours(23, 59, 59, 999); }
  return result;
}
