import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserId, UnauthorizedError, unauthorizedResponse } from "@/lib/get-user-id";
import { buildTaxSummary, type TaxSummaryPeriod } from "@/lib/tax-summary";
import { getTaxRulePack } from "@/lib/tax-calculator";

const VALID_RANGES = new Set<TaxSummaryPeriod>([
  "all",
  "last3Months",
  "last6Months",
  "thisYear",
  "lastYear",
]);

function parseYear(value: string | null): number {
  const year = Number(value ?? new Date().getFullYear());
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error("Ungültiges Veranlagungsjahr");
  }
  return year;
}

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(request.url);
    const year = parseYear(searchParams.get("year"));
    const requestedRange = searchParams.get("timeRange") ?? "thisYear";
    if (!VALID_RANGES.has(requestedRange as TaxSummaryPeriod)) {
      return NextResponse.json({ error: "Ungültiger Analysezeitraum" }, { status: 400 });
    }
    if (!getTaxRulePack(year)) {
      return NextResponse.json({
        error: `Für das Veranlagungsjahr ${year} ist kein geprüfter Parametersatz hinterlegt. Unterstützt: 2025, 2026.`,
        code: "UNSUPPORTED_TAX_YEAR",
        supportedYears: [2025, 2026],
      }, { status: 400 });
    }

    // Fetch only accounting projections. The query intentionally has no
    // pagination: this endpoint is the complete server-side aggregation
    // source and returns only the compact summary DTO to the browser.
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

    const summary = buildTaxSummary({
      year,
      timeRange: requestedRange as TaxSummaryPeriod,
      incomes,
      expenses,
    });
    return NextResponse.json(summary, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    if (error instanceof Error && (error.message === "Ungültiges Veranlagungsjahr" || error.message.startsWith("Nicht unterstütztes"))) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Fehler beim Laden der Steuer-Summary:", error);
    return NextResponse.json({ error: "Fehler beim Laden der Steuer-Summary" }, { status: 500 });
  }
}
