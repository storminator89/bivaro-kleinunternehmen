import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireUserId,
  UnauthorizedError,
  unauthorizedResponse,
} from "@/lib/get-user-id";

export async function GET() {
  try {
    const userId = await requireUserId();
    const [categories, customers] = await Promise.all([
      // Group in SQLite so repeated values never materialize one row per
      // expense/customer in the application. Keep the existing DB ordering.
      prisma.expense.groupBy({
        by: ["category"],
        where: { userId },
        orderBy: { category: "asc" },
      }),
      prisma.customer.groupBy({
        by: ["name"],
        where: { userId },
        orderBy: { name: "asc" },
      }),
    ]);

    return NextResponse.json({
      categories: categories
        // `expenses` currently filters categories by equality. Do not expose
        // a synthetic "Sonstiges" option for NULL values that the filter
        // endpoint cannot match.
        .map((item) => item.category)
        .filter((value): value is string => Boolean(value)),
      customers: customers.map((item) => item.name),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    console.error("Fehler beim Laden der Filteroptionen:", error);
    return NextResponse.json(
      { error: "Fehler beim Laden der Filteroptionen" },
      { status: 500 },
    );
  }
}
