import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { createTestDatabase } from "./helpers/database";

const state = vi.hoisted(() => ({
  client: null as PrismaClient | null,
  userId: "alice",
}));

vi.mock("@/lib/prisma", () => ({ get prisma() { return state.client; } }));
vi.mock("@/lib/get-user-id", () => ({
  getUserId: vi.fn(async () => state.userId),
  requireUserId: vi.fn(async () => state.userId),
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: vi.fn(),
}));
vi.mock("@/lib/audit-log", () => ({
  auditExport: vi.fn(),
}));

import { GET as getSummary } from "@/app/api/dashboard/summary/route";
import { GET as getKpis } from "@/app/api/dashboard/kpis/route";
import { GET as getEurExport } from "@/app/api/eur-export/route";

let database: ReturnType<typeof createTestDatabase>;
let selectQueryCount = 0;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-18T12:00:00Z"));
  database = createTestDatabase();
  state.client = database.client;
  database.client.$on("query", (event) => {
    if (/^\s*(SELECT|WITH)\b/i.test(event.query)) selectQueryCount += 1;
  });
  await database.client.user.create({
    data: { id: "alice", email: "alice@dashboard.test", password: "unused" },
  });

  await database.client.income.createMany({
    data: Array.from({ length: 101 }, (_, index) => ({
      userId: "alice",
      description: `Income ${index + 1}`,
      amount: 10,
      date: new Date("2026-01-15T12:00:00Z"),
      taxRelevant: true,
    })),
  });
  // Legacy SQLite rows can carry an ISO/CURRENT_TIMESTAMP text value even
  // though current Prisma writes use epoch-millisecond integers.
  await database.client.$executeRaw`
    INSERT INTO "Income" ("description", "amount", "date", "taxRelevant", "userId")
    VALUES ('Legacy ISO income', 7, '2026-05-04T10:00:00.123Z', 1, 'alice')
  `;

  const unpaid = await database.client.invoice.create({
    data: {
      userId: "alice",
      type: "INVOICE",
      fileName: "unpaid.pdf",
      storedFileName: "unpaid.pdf",
      parsedData: {},
      totalAmount: 99,
      status: "SENT",
    },
  });
  await database.client.income.create({
    data: {
      userId: "alice",
      invoiceId: unpaid.id,
      description: "Unpaid invoice",
      amount: 99,
      date: new Date("2026-01-01T12:00:00Z"),
      taxRelevant: true,
    },
  });

  await database.client.invoice.create({
    data: {
      userId: "alice",
      type: "QUOTE",
      fileName: "quote.pdf",
      storedFileName: "quote.pdf",
      parsedData: {},
      totalAmount: 500,
      status: "SENT",
    },
  });
  await database.client.invoice.create({
    data: {
      userId: "alice",
      type: "INVOICE",
      fileName: "cancelled.pdf",
      storedFileName: "cancelled.pdf",
      parsedData: {},
      totalAmount: 300,
      status: "CANCELLED",
    },
  });

  const paid = await database.client.invoice.create({
    data: {
      userId: "alice",
      type: "INVOICE",
      fileName: "paid.pdf",
      storedFileName: "paid.pdf",
      parsedData: {},
      totalAmount: 20,
      status: "PAID",
      paidAt: new Date("2026-03-10T12:00:00Z"),
    },
  });
  await database.client.income.create({
    data: {
      userId: "alice",
      invoiceId: paid.id,
      description: "Paid invoice",
      amount: 20,
      date: new Date("2025-12-01T12:00:00Z"),
      taxRelevant: true,
    },
  });

  const cancelledAfterPayment = await database.client.invoice.create({
    data: {
      userId: "alice",
      type: "INVOICE",
      fileName: "cancelled-after-payment.pdf",
      storedFileName: "cancelled-after-payment.pdf",
      parsedData: {},
      totalAmount: 30,
      status: "CANCELLED",
      paidAt: new Date("2026-04-01T12:00:00Z"),
    },
  });
  await database.client.income.create({
    data: {
      userId: "alice",
      invoiceId: cancelledAfterPayment.id,
      description: "Paid then cancelled invoice",
      amount: 30,
      date: new Date("2025-12-15T12:00:00Z"),
      taxRelevant: true,
    },
  });

  await database.client.expense.create({
    data: {
      userId: "alice",
      description: "Older asset",
      amount: 3600,
      date: new Date("2025-07-15T12:00:00Z"),
      category: "AfA",
      taxRelevant: true,
      taxDeductiblePercentage: 50,
      depreciationYears: 3,
    },
  });
}, 40_000);

afterAll(async () => {
  await database?.cleanup();
  vi.useRealTimers();
});

describe("dashboard accounting routes", () => {
  it("aggregates more than the paginated list limit and applies payment dates", async () => {
    const response = await getSummary(new NextRequest("http://localhost/api/dashboard/summary?timeRange=all"));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.totalIncome).toBe(1067);
    expect(data.totalExpense).toBe(1800);
    expect(data.profit).toBe(-733);

    const currentYearResponse = await getSummary(new NextRequest("http://localhost/api/dashboard/summary?timeRange=thisYear"));
    const currentYear = await currentYearResponse.json();
    expect(currentYear.totalExpense).toBe(600);
  });

  it("keeps KPI SQL work bounded and excludes quotes from open invoices", async () => {
    const rawQuery = vi.spyOn(database.client, "$queryRaw");
    const invoiceAggregate = vi.spyOn(database.client.invoice, "aggregate");
    selectQueryCount = 0;
    const response = await getKpis();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.totalRevenue).toBe(1067);
    expect(data.revenueThisMonth).toBe(0);
    expect(data.expensesThisMonth).toBe(0);
    expect(data.openInvoices).toBe(99);
    expect(data.yearComparison.revenueThisYearTotal).toBe(1067);
    expect(data.yearComparison.expensesThisYearTotal).toBe(0);
    expect(data.yearComparison.expensesLastYearTotal).toBe(3600);
    expect(data.yearComparison.monthlyDataThisYear[0].revenue).toBe(1010);
    expect(data.yearComparison.monthlyDataThisYear[2].revenue).toBe(20);
    expect(data.yearComparison.monthlyDataThisYear[3].revenue).toBe(30);
    expect(data.yearComparison.monthlyDataThisYear[4].revenue).toBe(7);
    expect(data.yearComparison.monthlyDataThisYear[6].expenses).toBe(0);
    expect(data.yearComparison.monthlyDataLastYear[6].expenses).toBe(3600);
    expect(rawQuery).toHaveBeenCalledTimes(4);
    expect(invoiceAggregate).toHaveBeenCalledTimes(1);
    // Four compact raw projections plus the open-invoice aggregate; the
    // complete KPI response stays bounded and does not scale with row count.
    expect(selectQueryCount).toBeGreaterThan(0);
    expect(selectQueryCount).toBeLessThanOrEqual(10);
  });

  it("includes an older active asset in the export year and preserves 50 %", async () => {
    const response = await getEurExport(new NextRequest("http://localhost/api/eur-export?year=2026&format=json"));
    expect(response.status).toBe(200);
    const data = await response.json();
    const afaLine = data.data.lines.find((line: { lineNumber: number }) => line.lineNumber === 31);
    expect(afaLine.amount).toBe(600);
    expect(data.data.totalIncome).toBe(1067);
  });
});
