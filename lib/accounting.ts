/**
 * Shared accounting rules used by the dashboard and the EÜR export.
 *
 * The application follows a cash-realized view for invoice incomes: a manual
 * income is booked on its own date, while an invoice income is booked only
 * after the invoice is paid. Legacy paid invoices without `paidAt` retain the
 * income date as their booking date.
 */

import { isPrivateWithdrawal } from '@/lib/private-categories';

export const ACCOUNTING_TIME_RANGES = [
  "all",
  "last3Months",
  "last6Months",
  "thisYear",
  "lastYear",
] as const;

export type AccountingTimeRange = (typeof ACCOUNTING_TIME_RANGES)[number];

export type AccountingInvoice = {
  status?: string | null;
  paidAt?: Date | string | null;
};

export type AccountingIncome = {
  id?: number;
  amount: number;
  date: Date | string;
  taxRelevant: boolean;
  description?: string | null;
  invoice?: AccountingInvoice | null;
  /** Fields returned by the paginated income API and useful for callers. */
  invoiceStatus?: string | null;
  invoicePaidAt?: Date | string | null;
};

export type AccountingExpense = {
  id?: number;
  description?: string;
  amount: number;
  date: Date | string;
  category?: string | null;
  taxRelevant: boolean;
  taxDeductiblePercentage?: number | null;
  depreciationYears?: number | null;
  /** Optional provenance fields used by correction-aware exports. */
  correctionOfId?: number | null;
  correctionReason?: string | null;
  entryKind?: "expense" | "refund" | "correction";
};

export type DateRange = {
  start?: Date;
  endExclusive?: Date;
};

export type DepreciationCalculation = {
  amount: number;
  months: number;
  monthlyAmount: number;
  explanation: string;
};

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Calendar fields used for accounting periods are stable UTC fields. */
export function getUTCYear(value: Date | string): number {
  return asDate(value).getUTCFullYear();
}

export function getUTCMonth(value: Date | string): number {
  return asDate(value).getUTCMonth();
}

export function isDateInCalendarYear(value: Date | string, year: number): boolean {
  return getUTCYear(value) === year;
}

export function getBusinessDate(value: Date | string): string {
  const date = asDate(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Ungültiges Buchungsdatum");
  return date.toISOString().slice(0, 10);
}

/** Return the cash booking date for an income. */
export function getIncomeAccountingDate(income: AccountingIncome): Date {
  const invoice = getInvoice(income);
  // A credit-note cancellation changes the original invoice's status after
  // payment. Keep the original cash booking date in that case; a refund is a
  // separate correction booking and must not erase realized cash here.
  if ((invoice?.status === "PAID" || invoice?.status === "CANCELLED") && invoice.paidAt) {
    return asDate(invoice.paidAt);
  }
  return asDate(income.date);
}

/**
 * An income linked to an invoice is realized only once that invoice is paid.
 * If a paid original is later cancelled by a credit note, its paidAt marker
 * keeps the original cash realization. A refund is a separate correction
 * booking. An income without an invoice is a manually entered cash booking.
 */
export function isCashRealizedIncome(income: AccountingIncome): boolean {
  const invoice = getInvoice(income);
  return !invoice || invoice.status === "PAID" ||
    (invoice.status === "CANCELLED" && invoice.paidAt != null);
}

export function isIncludedIncome(income: AccountingIncome): boolean {
  return income.taxRelevant && isCashRealizedIncome(income);
}

function getInvoice(income: AccountingIncome): AccountingInvoice | null {
  if (income.invoice) return income.invoice;
  if (income.invoiceStatus !== undefined && income.invoiceStatus !== null) {
    return {
      status: income.invoiceStatus,
      paidAt: income.invoicePaidAt,
    };
  }
  return null;
}

export function getDateRange(
  timeRange: AccountingTimeRange,
  now = new Date(),
): DateRange {
  if (timeRange === "all") return {};

  if (timeRange === "thisYear") {
    return {
      start: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
      endExclusive: new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1)),
    };
  }

  if (timeRange === "lastYear") {
    return {
      start: new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1)),
      endExclusive: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
    };
  }

  const months = timeRange === "last3Months" ? 3 : 6;
  const start = subtractMonthsClamped(now, months);
  return {
    start,
    endExclusive: new Date(now.getTime() + 1),
  };
}

/** Match date-fns subMonths semantics for dates such as 31 May -> 28 Feb. */
function subtractMonthsClamped(value: Date, months: number): Date {
  const result = new Date(value);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() - months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}

export function isDateInRange(
  value: Date | string,
  range: DateRange,
): boolean {
  const date = asDate(value);
  if (range.start && date < range.start) return false;
  if (range.endExclusive && date >= range.endExclusive) return false;
  return true;
}

/**
 * A missing percentage means the historical/default value of 100 %. A stored
 * zero is meaningful and must remain zero.
 */
export function getDeductiblePercentage(
  percentage: number | null | undefined,
): number {
  return percentage ?? 100;
}

export function applyDeductiblePercentage(
  amount: number,
  percentage: number | null | undefined,
): number {
  return amount * getDeductiblePercentage(percentage) / 100;
}

function getAcquisitionMonth(expense: AccountingExpense): number {
  return getUTCMonth(expense.date);
}

/**
 * Calculate straight-line AfA in whole calendar months. The acquisition
 * month is included, so a three-year asset bought in July has six months in
 * the acquisition year, two full years, and six months in the final year.
 */
export function calculateDepreciationForMonth(
  expense: AccountingExpense,
  year: number,
  month: number,
): DepreciationCalculation | null {
  const years = expense.depreciationYears ?? 0;
  if (years <= 0) return null;

  const acquisitionDate = asDate(expense.date);
  const acquisitionYear = acquisitionDate.getUTCFullYear();
  const acquisitionMonth = getAcquisitionMonth(expense);
  const monthIndex = (year - acquisitionYear) * 12 + month - acquisitionMonth;
  const totalMonths = years * 12;

  if (monthIndex < 0 || monthIndex >= totalMonths) return null;

  const monthlyAmount = expense.amount / totalMonths;
  return {
    amount: monthlyAmount,
    months: 1,
    monthlyAmount,
    explanation: `${formatAmount(expense.amount)} / ${totalMonths} Monate`,
  };
}

export function calculateDepreciationForYear(
  expense: AccountingExpense,
  year: number,
): DepreciationCalculation | null {
  const months: DepreciationCalculation[] = [];
  for (let month = 0; month < 12; month += 1) {
    const calculation = calculateDepreciationForMonth(expense, year, month);
    if (calculation) months.push(calculation);
  }

  if (months.length === 0) return null;
  const amount = months.reduce((sum, item) => sum + item.amount, 0);
  const monthlyAmount = expense.amount / ((expense.depreciationYears ?? 0) * 12);
  return {
    amount,
    months: months.length,
    monthlyAmount,
    explanation: months.length === 12
      ? `${formatAmount(expense.amount)} / ${expense.depreciationYears} Jahre`
      : `${formatAmount(expense.amount)} / ${(expense.depreciationYears ?? 0) * 12} Mon. * ${months.length}`,
  };
}

/** Base (before the deductible percentage) amount in a calendar year. */
export function calculateExpenseBaseForYear(
  expense: AccountingExpense,
  year: number,
): number {
  if (!expense.taxRelevant || isPrivateWithdrawal(expense.category)) return 0;

  if ((expense.depreciationYears ?? 0) > 0) {
    return calculateDepreciationForYear(expense, year)?.amount ?? 0;
  }

  return isDateInCalendarYear(expense.date, year) ? expense.amount : 0;
}

/** Deductible amount in a calendar year, including a stored 0 % share. */
export function calculateExpenseDeductionForYear(
  expense: AccountingExpense,
  year: number,
): number {
  return applyDeductiblePercentage(
    calculateExpenseBaseForYear(expense, year),
    expense.taxDeductiblePercentage,
  );
}

/**
 * Amount for the dashboard's non-yearly ranges. These ranges retain the
 * application's existing cash-basis behavior: an expense is booked in full
 * on its transaction date. Yearly reports use the AfA schedule above.
 */
export function calculateExpenseDeductionForRange(
  expense: AccountingExpense,
  range: DateRange,
): number {
  if (!expense.taxRelevant || isPrivateWithdrawal(expense.category) || !isDateInRange(expense.date, range)) return 0;
  return applyDeductiblePercentage(expense.amount, expense.taxDeductiblePercentage);
}

/** Amount for one dashboard chart month using the same yearly AfA rules. */
export function calculateExpenseDeductionForMonth(
  expense: AccountingExpense,
  year: number,
  month: number,
  yearlyAccounting = false,
): number {
  if (!expense.taxRelevant || isPrivateWithdrawal(expense.category)) return 0;

  const base = yearlyAccounting
    ? ((expense.depreciationYears ?? 0) > 0
      ? calculateDepreciationForMonth(expense, year, month)?.amount ?? 0
        : (getUTCYear(expense.date) === year && getUTCMonth(expense.date) === month
        ? expense.amount
        : 0))
    : (getUTCYear(expense.date) === year && getUTCMonth(expense.date) === month
      ? expense.amount
      : 0);

  return applyDeductiblePercentage(base, expense.taxDeductiblePercentage);
}

export function calculateRemainingDepreciableAmount(
  expense: AccountingExpense,
  throughYear: number,
): number {
  if ((expense.depreciationYears ?? 0) <= 0) return 0;
  const acquisitionYear = getUTCYear(expense.date);
  let booked = 0;
  for (let year = acquisitionYear; year <= throughYear; year += 1) {
    booked += calculateDepreciationForYear(expense, year)?.amount ?? 0;
  }
  return Math.max(0, expense.amount - booked);
}

export type AccountingYearSummary = {
  year: number;
  totalIncome: number;
  totalExpense: number;
  profit: number;
  incomeIds: number[];
  expenseIds: number[];
};

/**
 * Canonical cash-basis yearly aggregation shared by EÜR and simulations.
 * Expense corrections retain their stored sign. A negative expense is not
 * guessed to be income; it remains a correction on its expense line and is
 * visible to the export's correction drill-down.
 */
export function calculateAccountingYear(
  year: number,
  incomes: AccountingIncome[],
  expenses: AccountingExpense[],
): AccountingYearSummary {
  const includedIncomes = incomes.filter((income) =>
    isIncludedIncome(income) && isDateInCalendarYear(getIncomeAccountingDate(income), year),
  );
  const includedExpenses = expenses
    .map((expense) => ({ expense, amount: calculateExpenseDeductionForYear(expense, year) }))
    .filter(({ amount }) => amount !== 0);

  const totalIncome = includedIncomes.reduce((sum, income) => sum + income.amount, 0);
  const totalExpense = includedExpenses.reduce((sum, item) => sum + item.amount, 0);
  return {
    year,
    totalIncome,
    totalExpense,
    profit: totalIncome - totalExpense,
    incomeIds: includedIncomes.flatMap((income) => income.id === undefined ? [] : [income.id]),
    expenseIds: includedExpenses.flatMap(({ expense }) => expense.id === undefined ? [] : [expense.id]),
  };
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
