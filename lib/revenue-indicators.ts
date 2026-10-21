import type { AnnualContextRevision } from '@/lib/annual-business-context';

/** Read-only orientation. Accounting receipts are not a validated §19 total. */
export type RevenueIndicatorBasis = {
  year: number;
  previousYear: number;
  asOf: string;
  period: 'TO_DATE' | 'FULL_YEAR';
  inAppRevenue: number;
  previousYearInAppRevenue: number;
  externalRevenue: null;
  businessTotal: null;
  context: AnnualContextRevision | null;
  pendingRevision: number | null;
  reference: { previousYear: number; currentYear: number | null; foundingYear: boolean } | null;
};

export function buildRevenueIndicatorBasis(input: {
  year: number;
  inAppRevenue: number;
  previousYearInAppRevenue: number;
  history: AnnualContextRevision[];
  now: Date;
}): RevenueIndicatorBasis {
  const currentYear = input.now.getFullYear();
  const date = input.year === currentYear
    ? `${currentYear}-${String(input.now.getMonth() + 1).padStart(2, '0')}-${String(input.now.getDate()).padStart(2, '0')}`
    : `${input.year}-12-31`;
  // Revision order breaks ties: a later correction can intentionally make a
  // formerly known amount unknown. Never fill blanks from an older revision.
  const history = input.history.filter(row => row.contextYear === input.year).slice().sort((a, b) => b.revision - a.revision);
  const context = history.find(row => row.effectiveFrom <= date) ?? null;
  const pending = history.find(row => row.effectiveFrom > date);
  const foundingYear = context?.foundingYear === input.year;
  // Deliberately bounded to the rule years reviewed for this UI. No old-year
  // fallback or future extrapolation, and no tax-status calculation.
  const reference = [2025, 2026].includes(input.year) ? {
    previousYear: 25000,
    currentYear: context?.foundingYear == null ? null : foundingYear ? 25000 : 100000,
    foundingYear,
  } : null;
  return {
    year: input.year, previousYear: input.year - 1, asOf: input.now.toISOString(),
    period: input.year === currentYear ? 'TO_DATE' : 'FULL_YEAR',
    inAppRevenue: input.inAppRevenue, previousYearInAppRevenue: input.previousYearInAppRevenue,
    externalRevenue: null, businessTotal: null, context,
    pendingRevision: pending && pending.revision > (context?.revision ?? 0) ? pending.revision : null,
    reference,
  };
}

/** Format declared integer cents without rounding large user-declared values. */
export function formatDeclaredTurnover(cents: string | null | undefined): string {
  if (cents == null) return 'Unbekannt';
  const value = BigInt(cents);
  return `${new Intl.NumberFormat('de-DE').format(value / BigInt(100))},${String(value % BigInt(100)).padStart(2, '0')} €`;
}
