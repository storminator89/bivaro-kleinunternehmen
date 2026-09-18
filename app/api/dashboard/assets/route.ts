import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AccountingTimeRange,
  calculateDepreciationForYear,
  getDateRange,
  isDateInRange,
} from "@/lib/accounting";
import {
  requireUserId,
  UnauthorizedError,
  unauthorizedResponse,
} from "@/lib/get-user-id";

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

/**
 * Return the small, display-only asset projection used by the GWG tab. The
 * normal expense list remains paginated; this endpoint deliberately selects
 * only asset columns and never loads parsed documents.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(request.url);
    const kind = searchParams.get("kind") || "gwg";
    const timeRange = parseTimeRange(searchParams.get("timeRange"));
    const range = getDateRange(timeRange);

    const expenses = await prisma.expense.findMany({
      where: {
        userId,
        taxRelevant: true,
        ...(kind === "depreciation"
          ? { depreciationYears: { gt: 0 } }
          : { amount: { gt: 250, lte: 1000 } }),
      },
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
      orderBy: { date: "desc" },
    });

    // GWG entries are acquired on their transaction date. Depreciable assets
    // remain relevant for a target year even when they were acquired earlier.
    const items = expenses.filter((expense) => {
      if (kind === "depreciation" && (timeRange === "thisYear" || timeRange === "lastYear")) {
        const year = timeRange === "thisYear" ? new Date().getFullYear() : new Date().getFullYear() - 1;
        return (calculateDepreciationForYear(expense, year)?.amount ?? 0) > 0;
      }
      return isDateInRange(expense.date, range);
    });

    return NextResponse.json({
      kind,
      timeRange,
      items,
      total: items.length,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    console.error("Fehler beim Laden der Anlagendaten:", error);
    return NextResponse.json(
      { error: "Fehler beim Laden der Anlagendaten" },
      { status: 500 },
    );
  }
}
