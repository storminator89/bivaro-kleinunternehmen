import {
  AccountingExpense,
  AccountingIncome,
  calculateExpenseDeductionForRange,
  calculateExpenseDeductionForYear,
  getDateRange,
  getIncomeAccountingDate,
  isDateInRange,
  isIncludedIncome,
  type AccountingTimeRange,
} from "@/lib/accounting";
import { isPrivateWithdrawal } from "@/lib/private-categories";
import { getTaxRulePack, isSupportedTaxYear, type SupportedTaxYear } from "@/lib/tax-calculator";

export type TaxSummaryPeriod = Extract<AccountingTimeRange, "all" | "last3Months" | "last6Months" | "thisYear" | "lastYear">;

export type TaxSummaryInput = {
  year: number;
  timeRange: TaxSummaryPeriod;
  incomes: AccountingIncome[];
  expenses: AccountingExpense[];
  now?: Date;
};

export type TaxSummary = {
  year: SupportedTaxYear;
  timeRange: TaxSummaryPeriod;
  annualBasis: boolean;
  complete: true;
  ruleVersion: string;
  ruleSource: string;
  generatedAt: string;
  dataAsOf: string;
  totalIncome: number;
  totalExpenses: number;
  profit: number;
  incomeCount: number;
  expenseCount: number;
  sourceCount: number;
  nonTaxRelevantIncomeCount: number;
  nonTaxRelevantIncomeAmount: number;
  nonTaxRelevantExpenseCount: number;
  nonTaxRelevantExpenseAmount: number;
  partialDeductionShortfall: number;
  warnings: string[];
};

function dateOnlyRange(year: number) {
  return {
    start: new Date(year, 0, 1),
    endExclusive: new Date(year + 1, 0, 1),
  };
}

function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Aggregate the complete server-side accounting input into a compact DTO.
 * No list endpoint or client pagination is involved here. The function is
 * pure, so the API and regression tests use exactly the same accounting view.
 */
export function buildTaxSummary(input: TaxSummaryInput): TaxSummary {
  const rules = getTaxRulePack(input.year);
  if (!rules || !isSupportedTaxYear(input.year)) {
    throw new Error(`Nicht unterstütztes Veranlagungsjahr: ${input.year}`);
  }

  const now = input.now ?? new Date();
  const timeRange = input.timeRange;
  const annualBasis = timeRange === "thisYear" || timeRange === "lastYear";
  const targetYear = input.year;
  const range = annualBasis ? dateOnlyRange(targetYear) : getDateRange(timeRange, now);

  const allIncomesInRange = input.incomes.filter((income) =>
    isDateInRange(getIncomeAccountingDate(income), range),
  );
  const periodExpenses = input.expenses.filter((expense) =>
    isDateInRange(expense.date, range),
  );
  // An AfA asset acquired before the selected year remains part of the
  // annual accounting view while a one-off expense is selected by its
  // transaction date. Non-tax-relevant counts still use the period only.
  const accountingExpenses = annualBasis
    ? input.expenses.filter((expense) =>
      (expense.depreciationYears ?? 0) > 0
        ? calculateExpenseDeductionForYear(expense, targetYear) !== 0
        : isDateInRange(expense.date, range),
    )
    : periodExpenses;

  const includedIncomes = allIncomesInRange.filter(isIncludedIncome);
  const includedExpenses = accountingExpenses.filter((expense) => {
    if (isPrivateWithdrawal(expense.category)) return false;
    if (!annualBasis) return isDateInRange(expense.date, range);
    return expense.taxRelevant && calculateExpenseDeductionForYear(expense, targetYear) !== 0;
  });

  const totalIncome = includedIncomes.reduce((sum, income) => sum + income.amount, 0);
  const totalExpenses = includedExpenses.reduce((sum, expense) => sum + (
    annualBasis
      ? calculateExpenseDeductionForYear(expense, targetYear)
      : calculateExpenseDeductionForRange(expense, range)
  ), 0);

  const partialDeductionShortfall = accountingExpenses.reduce((sum, expense) => {
    if (!expense.taxRelevant || isPrivateWithdrawal(expense.category)) return sum;
    const percentage = expense.taxDeductiblePercentage ?? 100;
    if (percentage >= 100) return sum;
    const base = annualBasis
      ? ((expense.depreciationYears ?? 0) > 0
        ? calculateExpenseDeductionForYear({ ...expense, taxDeductiblePercentage: 100 }, targetYear)
        : (new Date(expense.date).getFullYear() === targetYear ? expense.amount : 0))
      : expense.amount;
    return sum + base * (1 - percentage / 100);
  }, 0);

  const nonTaxRelevantIncomes = allIncomesInRange.filter((income) => !income.taxRelevant);
  const nonTaxRelevantExpenses = periodExpenses.filter((expense) =>
    !expense.taxRelevant && !isPrivateWithdrawal(expense.category),
  );

  const warnings: string[] = [
    "Die Summary basiert auf dem vollständigen serverseitig geladenen Datenstand.",
    "Das Regelpaket ist auf eine natürliche Person mit Einzelveranlagung und einen Betrieb begrenzt; Zusammenveranlagung, Sonder-/Auslandseinkünfte und komplexe Verlustfälle sind nicht enthalten.",
  ];
  if (!annualBasis) {
    warnings.push("Der ausgewählte Zeitraum ist kein vollständiges Veranlagungsjahr; Steuerwerte sind eine Periodenansicht.");
  }
  if (totalIncome - totalExpenses < 0) {
    warnings.push("Verlustfälle, Verlustvortrag und Verlustrücktrag werden nicht als endgültige Einkommensteuer berechnet.");
  }

  return {
    year: input.year,
    timeRange,
    annualBasis,
    complete: true,
    ruleVersion: `de-tax-${rules.year}-limited-v1`,
    ruleSource: rules.source,
    generatedAt: new Date().toISOString(),
    dataAsOf: now.toISOString(),
    totalIncome: roundCents(totalIncome),
    totalExpenses: roundCents(totalExpenses),
    profit: roundCents(totalIncome - totalExpenses),
    incomeCount: includedIncomes.length,
    expenseCount: includedExpenses.length,
    sourceCount: includedIncomes.length + includedExpenses.length,
    nonTaxRelevantIncomeCount: nonTaxRelevantIncomes.length,
    nonTaxRelevantIncomeAmount: roundCents(nonTaxRelevantIncomes.reduce((sum, income) => sum + income.amount, 0)),
    nonTaxRelevantExpenseCount: nonTaxRelevantExpenses.length,
    nonTaxRelevantExpenseAmount: roundCents(nonTaxRelevantExpenses.reduce((sum, expense) => sum + expense.amount, 0)),
    partialDeductionShortfall: roundCents(partialDeductionShortfall),
    warnings,
  };
}

// Stable service name for API callers and integration tests.
export const getTaxSummary = buildTaxSummary;
