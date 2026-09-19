import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AccountingTimeRange,
  calculateAccountingYear,
  calculateDepreciationForYear,
  calculateExpenseDeductionForMonth,
  calculateExpenseDeductionForRange,
  calculateExpenseDeductionForYear,
  calculateRemainingDepreciableAmount,
  getDateRange,
  getDeductiblePercentage,
  getIncomeAccountingDate,
  isDateInRange,
  isIncludedIncome,
} from "@/lib/accounting";
import {
  requireUserId,
  UnauthorizedError,
  unauthorizedResponse,
} from "@/lib/get-user-id";
import { isPrivateWithdrawal } from "@/lib/private-categories";

type Month = { year: number; month: number };

function parseTimeRange(value: string | null): AccountingTimeRange {
  if (
    value === "last3Months" ||
    value === "last6Months" ||
    value === "thisYear" ||
    value === "lastYear"
  ) {
    return value;
  }
  return "all";
}

function getChartMonths(timeRange: AccountingTimeRange, now: Date): Month[] {
  let start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  let count = 12;

  if (timeRange === "last3Months") {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
    count = 3;
  } else if (timeRange === "last6Months") {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
    count = 6;
  } else if (timeRange === "lastYear") {
    start = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
  } else if (timeRange === "thisYear") {
    start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  }

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
  });
}

function isPrivateDeposit(description: string | null | undefined, taxRelevant: boolean) {
  const normalized = description?.toLowerCase() ?? "";
  return normalized.includes("privateinlage") ||
    (!taxRelevant && normalized.includes("privat"));
}

function periodAmountForExpense(
  expense: Parameters<typeof calculateExpenseDeductionForRange>[0],
  timeRange: AccountingTimeRange,
  range: ReturnType<typeof getDateRange>,
  now: Date,
) {
  if (timeRange === "thisYear") {
    return calculateExpenseDeductionForYear(expense, now.getUTCFullYear());
  }
  if (timeRange === "lastYear") {
    return calculateExpenseDeductionForYear(expense, now.getUTCFullYear() - 1);
  }
  return calculateExpenseDeductionForRange(expense, range);
}

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(request.url);
    const timeRange = parseTimeRange(searchParams.get("timeRange"));
    const now = new Date();
    const range = getDateRange(timeRange, now);

    // Only accounting columns are selected. In particular, this endpoint does
    // not load invoice parsedData or any receipt contents.
    const [incomes, expenses] = await prisma.$transaction([
      prisma.income.findMany({
        where: { userId },
        select: {
          amount: true,
          date: true,
          description: true,
          taxRelevant: true,
          invoice: { select: { status: true, paidAt: true } },
        },
      }),
      prisma.expense.findMany({
        where: { userId },
        select: {
          id: true,
          description: true,
          amount: true,
          date: true,
          category: true,
          taxRelevant: true,
          taxDeductiblePercentage: true,
          depreciationYears: true,
        },
      }),
    ]);

    const includedIncomes = incomes.filter(isIncludedIncome);
    const incomeInRange = includedIncomes.filter((income) =>
      isDateInRange(getIncomeAccountingDate(income), range),
    );

    const targetYear = timeRange === "thisYear"
      ? now.getUTCFullYear()
      : timeRange === "lastYear" ? now.getUTCFullYear() - 1 : null;
    const annual = targetYear === null ? null : calculateAccountingYear(targetYear, incomes, expenses);
    const totalIncome = annual?.totalIncome ?? incomeInRange.reduce((sum, income) => sum + income.amount, 0);
    const expenseAmounts = expenses
      .map((expense) => ({
        expense,
        amount: periodAmountForExpense(expense, timeRange, range, now),
      }))
      .filter(({ amount }) => amount !== 0);
    const totalExpense = annual?.totalExpense ?? expenseAmounts.reduce((sum, item) => sum + item.amount, 0);

    const categoryMap = new Map<string, number>();
    for (const { expense, amount } of expenseAmounts) {
      const category = expense.category || "Sonstiges";
      categoryMap.set(category, (categoryMap.get(category) ?? 0) + amount);
    }
    const expenseCategories = Array.from(categoryMap.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

    const depreciationDetails = targetYear === null
      ? []
      : expenses.flatMap((expense) => {
        if (!expense.taxRelevant || (expense.depreciationYears ?? 0) <= 0) return [];
        const calculation = calculateDepreciationForYear(expense, targetYear);
        if (!calculation || calculation.amount === 0) return [];
        const percentage = getDeductiblePercentage(expense.taxDeductiblePercentage);
        const percentageSuffix = percentage === 100 ? "" : ` × ${percentage} %`;
        return [{
          id: expense.id,
          description: expense.description,
          date: expense.date,
          totalAmount: expense.amount,
          years: expense.depreciationYears ?? 0,
          currentYearAmount: calculation.amount * percentage / 100,
          remainingAmount: calculateRemainingDepreciableAmount(expense, targetYear),
          calculationExplanation: `${calculation.explanation}${percentageSuffix}`,
        }];
      });

    const months = getChartMonths(timeRange, now);
    const monthlyData = months.map(({ year, month }) => {
      const monthStart = new Date(Date.UTC(year, month, 1));
      const monthEnd = new Date(Date.UTC(year, month + 1, 1));
      const monthIncomes = includedIncomes
        .filter((income) => {
          const date = getIncomeAccountingDate(income);
          return date >= monthStart && date < monthEnd && isDateInRange(date, range);
        })
        .reduce((sum, income) => sum + income.amount, 0);
      const yearlyAccounting = timeRange === "thisYear" || timeRange === "lastYear";
      const monthExpenses = expenses.reduce((sum, expense) => {
        if (!yearlyAccounting && !isDateInRange(expense.date, range)) return sum;
        return sum + calculateExpenseDeductionForMonth(
          expense,
          year,
          month,
          yearlyAccounting,
        );
      }, 0);

      return {
        month: month + 1,
        year,
        monthName: new Intl.DateTimeFormat("de-DE", { month: "short", timeZone: "UTC" }).format(monthStart),
        revenue: monthIncomes,
        expenses: monthExpenses,
        profit: monthIncomes - monthExpenses,
      };
    });

    const privateWithdrawals = expenses.reduce((sum, expense) => {
      if (!isPrivateWithdrawal(expense.category)) return sum;
      return isDateInRange(expense.date, range) ? sum + expense.amount : sum;
    }, 0);
    const privateDeposits = incomes.reduce((sum, income) => {
      if (!isPrivateDeposit(income.description, income.taxRelevant)) return sum;
      return isDateInRange(getIncomeAccountingDate(income), range) ? sum + income.amount : sum;
    }, 0);

    return NextResponse.json({
      timeRange,
      totalIncome,
      totalExpense,
      profit: totalIncome - totalExpense,
      expenseCategories,
      monthlyData,
      depreciationDetails,
      privateWithdrawals,
      privateDeposits,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    console.error("Fehler beim Laden der Dashboard-Auswertung:", error);
    return NextResponse.json(
      { error: "Fehler beim Laden der Dashboard-Auswertung" },
      { status: 500 },
    );
  }
}
