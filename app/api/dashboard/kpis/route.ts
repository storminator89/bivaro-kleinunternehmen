import { readAnnualContextRevision } from '@/lib/annual-business-context';
import { buildRevenueIndicatorBasis } from '@/lib/revenue-indicators';
import { ledgerSummary } from '@/lib/payment-journal/service';
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  requireUserId,
  UnauthorizedError,
  unauthorizedResponse,
} from "@/lib/get-user-id";

type MonthlyAggregateRow = {
  year: string;
  month: string;
  total: number | bigint;
  currentYearToDate: number | bigint;
  lastYearToDate: number | bigint;
};

type RecentIncomeRow = {
  id: number;
  description: string;
  amount: number | bigint;
  bookingDate: bigint | number;
};

type RecentExpenseRow = {
  id: number;
  description: string;
  amount: number | bigint;
  bookingDate: bigint | number;
};

type RecentActivity = {
  id: number;
  description: string;
  amount: number;
  date: Date;
  type: "income" | "expense";
};

function sumRows(rows: MonthlyAggregateRow[], year?: number): number {
  return rows.reduce((sum, row) => {
    if (year !== undefined && Number(row.year) !== year) return sum;
    return sum + Number(row.total ?? 0);
  }, 0);
}

function sumToDate(rows: MonthlyAggregateRow[], field: "currentYearToDate" | "lastYearToDate"): number {
  return rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0);
}

function monthTotal(rows: MonthlyAggregateRow[], year: number, month: number): number {
  const row = rows.find((item) => Number(item.year) === year && Number(item.month) === month);
  return Number(row?.total ?? 0);
}

function toDate(value: bigint | number): Date {
  return new Date(Number(value));
}

function buildMonthlyData(
  year: number,
  incomeRows: MonthlyAggregateRow[],
  expenseRows: MonthlyAggregateRow[],
) {
  return Array.from({ length: 12 }, (_, monthIndex) => {
    const month = monthIndex + 1;
    const revenue = monthTotal(incomeRows, year, month);
    const expenses = monthTotal(expenseRows, year, month);
    return {
      month,
      monthName: new Date(year, monthIndex, 1).toLocaleString("de-DE", { month: "short" }),
      revenue,
      expenses,
      profit: revenue - expenses,
    };
  });
}

function normalizeDateTimeToEpochMs(value: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`CASE
    WHEN typeof(${value}) IN ('integer', 'real') THEN ${value}
    ELSE round((julianday(${value}) - 2440587.5) * 86400000.0)
  END`;
}

/**
 * KPI aggregation uses epoch milliseconds because Prisma stores SQLite
 * DateTime columns as INTEGER. This avoids string-format comparisons and
 * keeps exact JavaScript Date boundaries, including the one-millisecond end
 * used by the existing cash-basis calculations.
 */
function buildMonthlyAggregateQuery(
  table: "Income" | "Expense",
  userId: string,
  currentYearStartMs: number,
  nowPlusOneMs: number,
  lastYearStartMs: number,
  sameDayLastYearMs: number,
) {
  const isIncome = table === "Income";
  const source = isIncome
    ? Prisma.sql`
        FROM "Income" AS entry
        LEFT JOIN "Invoice" AS invoice ON invoice."id" = entry."invoiceId"
        LEFT JOIN "PaymentJournalEvent" AS payment ON payment."incomeId" = entry."id"
          AND payment."userId" = entry."userId" AND payment."invoiceId" = entry."invoiceId"
        WHERE entry."userId" = ${userId}
          AND entry."taxRelevant" = 1
          AND (
            entry."invoiceId" IS NULL
            OR invoice."id" IS NULL
            OR (payment."dateCertainty" = 'ACTUAL' AND payment."paidAt" IS NOT NULL)
            OR invoice."status" = 'PAID'
            OR (invoice."status" = 'CANCELLED' AND invoice."paidAt" IS NOT NULL)
          )
      `
    : Prisma.sql`
        FROM "Expense" AS entry
        WHERE entry."userId" = ${userId}
      `;
  const rawBookingDate = isIncome
    ? Prisma.sql`CASE
        WHEN payment."dateCertainty" = 'ACTUAL' AND payment."paidAt" IS NOT NULL THEN payment."paidAt"
        WHEN invoice."status" IN ('PAID', 'CANCELLED') AND invoice."paidAt" IS NOT NULL
          THEN invoice."paidAt"
        ELSE entry."date"
      END`
    : Prisma.sql`entry."date"`;
  const bookingDate = normalizeDateTimeToEpochMs(rawBookingDate);

  return Prisma.sql`
    WITH entries AS (
      SELECT entry."amount" AS amount, ${bookingDate} AS bookingDate
      ${source}
    )
    SELECT
      strftime('%Y', datetime(entries.bookingDate / 1000.0, 'unixepoch', 'localtime')) AS year,
      strftime('%m', datetime(entries.bookingDate / 1000.0, 'unixepoch', 'localtime')) AS month,
      COALESCE(SUM(CAST(entries.amount AS REAL)), 0.0) AS total,
      COALESCE(SUM(CASE
        WHEN entries.bookingDate >= ${currentYearStartMs} AND entries.bookingDate < ${nowPlusOneMs}
          THEN CAST(entries.amount AS REAL) ELSE 0.0 END), 0.0) AS "currentYearToDate",
      COALESCE(SUM(CASE
        WHEN entries.bookingDate >= ${lastYearStartMs} AND entries.bookingDate < ${sameDayLastYearMs}
          THEN CAST(entries.amount AS REAL) ELSE 0.0 END), 0.0) AS "lastYearToDate"
    FROM entries
    GROUP BY year, month
    ORDER BY year, month
  `;
}

function buildRecentIncomeQuery(userId: string) {
  const bookingDate = normalizeDateTimeToEpochMs(Prisma.sql`CASE
    WHEN payment."dateCertainty" = 'ACTUAL' AND payment."paidAt" IS NOT NULL THEN payment."paidAt"
        WHEN invoice."status" IN ('PAID', 'CANCELLED') AND invoice."paidAt" IS NOT NULL
      THEN invoice."paidAt"
    ELSE entry."date"
  END`);
  return Prisma.sql`
    SELECT
      entry."id" AS id,
      entry."description" AS description,
      entry."amount" AS amount,
      ${bookingDate} AS "bookingDate"
    FROM "Income" AS entry
    LEFT JOIN "Invoice" AS invoice ON invoice."id" = entry."invoiceId"
        LEFT JOIN "PaymentJournalEvent" AS payment ON payment."incomeId" = entry."id"
          AND payment."userId" = entry."userId" AND payment."invoiceId" = entry."invoiceId"
    WHERE entry."userId" = ${userId}
      AND entry."taxRelevant" = 1
      AND (
        entry."invoiceId" IS NULL
        OR invoice."id" IS NULL
        OR (payment."dateCertainty" = 'ACTUAL' AND payment."paidAt" IS NOT NULL)
            OR invoice."status" = 'PAID'
        OR (invoice."status" = 'CANCELLED' AND invoice."paidAt" IS NOT NULL)
      )
    ORDER BY "bookingDate" DESC, entry."id" DESC
    LIMIT 5
  `;
}

function buildRecentExpenseQuery(userId: string) {
  const bookingDate = normalizeDateTimeToEpochMs(Prisma.sql`entry."date"`);
  return Prisma.sql`
    SELECT
      entry."id" AS id,
      entry."description" AS description,
      -entry."amount" AS amount,
      ${bookingDate} AS "bookingDate"
    FROM "Expense" AS entry
    WHERE entry."userId" = ${userId}
    ORDER BY ${bookingDate} DESC, entry."id" DESC
    LIMIT 5
  `;
}

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth();
    const yearParam = new URL(request.url).searchParams.get('year');
    const selectedYear = yearParam === null ? currentYear : Number(yearParam);
    if (yearParam !== null && (!/^\d{4}$/.test(yearParam) || !Number.isInteger(selectedYear) || selectedYear < 1900 || selectedYear > currentYear)) {
      return NextResponse.json({ error: `Das Vergleichsjahr muss zwischen 1900 und ${currentYear} liegen.` }, { status: 400 });
    }
    const isCurrentYear = selectedYear === currentYear;
    const firstDayOfYear = new Date(currentYear, 0, 1);
    const firstDayOfLastYear = new Date(currentYear - 1, 0, 1);
    const sameDayLastYear = new Date(
      currentYear - 1,
      currentMonth,
      today.getDate() + 1,
    );
    const currentYearStartMs = firstDayOfYear.getTime();
    const nowPlusOneMs = today.getTime() + 1;
    const lastYearStartMs = firstDayOfLastYear.getTime();
    const sameDayLastYearMs = sameDayLastYear.getTime();

    // Four compact raw projections plus the open-invoice aggregate replace
    // loading every income and expense row into Node.js.
    const [incomeRows, expenseRows, recentIncomes, recentExpenses, openInvoices, annualContext] = await Promise.all([
      prisma.$queryRaw<MonthlyAggregateRow[]>(buildMonthlyAggregateQuery(
        "Income",
        userId,
        currentYearStartMs,
        nowPlusOneMs,
        lastYearStartMs,
        sameDayLastYearMs,
      )),
      prisma.$queryRaw<MonthlyAggregateRow[]>(buildMonthlyAggregateQuery(
        "Expense",
        userId,
        currentYearStartMs,
        nowPlusOneMs,
        lastYearStartMs,
        sameDayLastYearMs,
      )),
      prisma.$queryRaw<RecentIncomeRow[]>(buildRecentIncomeQuery(userId)),
      prisma.$queryRaw<RecentExpenseRow[]>(buildRecentExpenseQuery(userId)),
      prisma.invoice.findMany({
        where: { userId, type: 'INVOICE', status: { in: ['DRAFT', 'SENT'] } },
        include: { incomes: { include: { cashTransaction: true } }, paymentJournalEvents: { orderBy: { id: 'asc' } } },
      }),
      prisma.annualBusinessContextRevision.findMany({ where: { userId, contextYear: currentYear }, orderBy: { revision: 'asc' } }),
    ]);

    let openCents = BigInt(0);
    let openInvoicesReviewRequired = 0;
    for (const invoice of openInvoices) {
      try { openCents += BigInt(ledgerSummary(invoice).openCents); }
      catch { openInvoicesReviewRequired++; }
    }
    const recentActivities: RecentActivity[] = [
      ...recentIncomes.map((item) => ({
        id: item.id,
        description: item.description,
        amount: Number(item.amount),
        date: toDate(item.bookingDate),
        type: "income" as const,
      })),
      ...recentExpenses.map((item) => ({
        id: item.id,
        description: item.description,
        amount: Number(item.amount),
        date: toDate(item.bookingDate),
        type: "expense" as const,
      })),
    ]
      .sort((a, b) => b.date.getTime() - a.date.getTime() || b.id - a.id)
      .slice(0, 5);

    const revenueThisMonth = monthTotal(incomeRows, currentYear, currentMonth + 1);
    const expensesThisMonth = monthTotal(expenseRows, currentYear, currentMonth + 1);
    const revenueThisYearTotal = sumRows(incomeRows, currentYear);
    const revenueThisYearToDate = sumToDate(incomeRows, "currentYearToDate");
    const revenueLastYearToDate = sumToDate(incomeRows, "lastYearToDate");
    const expensesThisYearToDate = sumToDate(expenseRows, "currentYearToDate");
    const expensesLastYearToDate = sumToDate(expenseRows, "lastYearToDate");
    const totalRevenue = sumRows(incomeRows);
    const totalExpenses = sumRows(expenseRows);

    return NextResponse.json({
      revenueThisMonth,
      revenueThisYear: revenueThisYearTotal,
      expensesThisMonth,
      openInvoices: Number(openCents) / 100,
      openInvoicesReviewRequired,
      totalRevenue,
      totalExpenses,
      recentActivities,
      revenueBasis: buildRevenueIndicatorBasis({ year: currentYear, inAppRevenue: revenueThisYearToDate, previousYearInAppRevenue: sumRows(incomeRows, currentYear - 1), history: annualContext.map(readAnnualContextRevision), now: today }),
      yearComparison: {
        currentYear: selectedYear,
        lastYear: selectedYear - 1,
        period: isCurrentYear ? 'toDate' : 'fullYear',
        comparisonThroughMonth: isCurrentYear ? currentMonth : 11,
        availableYears: [...new Set([currentYear, ...incomeRows.map(row => Number(row.year)), ...expenseRows.map(row => Number(row.year))])]
          .filter(year => Number.isInteger(year) && year >= 1900 && year <= currentYear)
          .sort((a, b) => b - a),
        revenueThisYearTotal: sumRows(incomeRows, selectedYear),
        revenueLastYearTotal: sumRows(incomeRows, selectedYear - 1),
        expensesThisYearTotal: sumRows(expenseRows, selectedYear),
        expensesLastYearTotal: sumRows(expenseRows, selectedYear - 1),
        revenueThisYearToDate: isCurrentYear ? revenueThisYearToDate : sumRows(incomeRows, selectedYear),
        revenueLastYearToDate: isCurrentYear ? revenueLastYearToDate : sumRows(incomeRows, selectedYear - 1),
        expensesThisYearToDate: isCurrentYear ? expensesThisYearToDate : sumRows(expenseRows, selectedYear),
        expensesLastYearToDate: isCurrentYear ? expensesLastYearToDate : sumRows(expenseRows, selectedYear - 1),
        monthlyDataThisYear: buildMonthlyData(selectedYear, incomeRows, expenseRows),
        monthlyDataLastYear: buildMonthlyData(selectedYear - 1, incomeRows, expenseRows),
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    console.error("Fehler beim Laden der KPI-Daten:", error);
    return NextResponse.json({ error: "Fehler beim Laden der KPI-Daten" }, { status: 500 });
  }
}
