export type LedgerSortBy = 'date' | 'amount' | 'description';
export type LedgerSortOrder = 'asc' | 'desc';
export type LedgerSort = { sortBy: LedgerSortBy; sortOrder: LedgerSortOrder };

export const LEDGER_SORT_OPTIONS: ReadonlyArray<LedgerSort & { label: string }> = [
  { sortBy: 'date', sortOrder: 'desc', label: 'Datum: neueste zuerst' },
  { sortBy: 'date', sortOrder: 'asc', label: 'Datum: älteste zuerst' },
  { sortBy: 'amount', sortOrder: 'desc', label: 'Betrag: höchste zuerst' },
  { sortBy: 'amount', sortOrder: 'asc', label: 'Betrag: niedrigste zuerst' },
  { sortBy: 'description', sortOrder: 'asc', label: 'Beschreibung: A–Z' },
  { sortBy: 'description', sortOrder: 'desc', label: 'Beschreibung: Z–A' },
];

export class LedgerSortError extends Error {
  constructor() {
    super('Ungültige Sortierung. Erlaubt sind date, amount oder description sowie asc oder desc.');
    this.name = 'LedgerSortError';
  }
}

/** Only validated column names reach Prisma; omission preserves date descending. */
export function parseLedgerSort(params: URLSearchParams): LedgerSort {
  const sortBy = params.get('sortBy') ?? 'date';
  const sortOrder = params.get('sortOrder') ?? 'desc';
  const option = LEDGER_SORT_OPTIONS.find(item => item.sortBy === sortBy && item.sortOrder === sortOrder);
  if (!option) throw new LedgerSortError();
  return { sortBy: option.sortBy, sortOrder: option.sortOrder };
}
