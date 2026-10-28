export type InvoiceListSort = {
  sortBy: 'date' | 'invoiceNumber' | 'amount';
  sortOrder: 'asc' | 'desc';
};

export class InvoiceListSortError extends Error {
  constructor() {
    super('Ungültige Rechnungssortierung.');
    this.name = 'InvoiceListSortError';
  }
}

/** Omitted options preserve the historical API upload ordering. */
export function parseInvoiceListSort(sortBy: unknown, sortOrder: unknown): InvoiceListSort | undefined {
  if (sortBy === undefined && sortOrder === undefined) return undefined;
  const by = sortBy === undefined ? 'date' : sortBy;
  const order = sortOrder === undefined ? 'desc' : sortOrder;
  if (!['date', 'invoiceNumber', 'amount'].includes(by as string) || !['asc', 'desc'].includes(order as string)) {
    throw new InvoiceListSortError();
  }
  return { sortBy: by as InvoiceListSort['sortBy'], sortOrder: order as InvoiceListSort['sortOrder'] };
}

type SortableInvoice = {
  id: number;
  invoiceDate: Date | null;
  uploadedAt: Date;
  invoiceNumber: string | null;
  totalAmount: number | null;
};

/** Order the entire filtered selection before slicing; IDs make ties stable. */
export function compareInvoiceListRows(a: SortableInvoice, b: SortableInvoice, sort: InvoiceListSort): number {
  let comparison: number;
  if (sort.sortBy === 'invoiceNumber') {
    comparison = (a.invoiceNumber ?? '').localeCompare(b.invoiceNumber ?? '', 'de', { numeric: true });
  } else if (sort.sortBy === 'amount') {
    comparison = (a.totalAmount ?? 0) - (b.totalAmount ?? 0);
  } else {
    comparison = (a.invoiceDate ?? a.uploadedAt).getTime() - (b.invoiceDate ?? b.uploadedAt).getTime();
  }
  return (sort.sortOrder === 'asc' ? 1 : -1) * (comparison || a.id - b.id);
}
