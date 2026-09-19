import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { createTestDatabase } from "./helpers/database";

const state = vi.hoisted(() => ({
  client: null as PrismaClient | null,
  userId: "tax-summary-a",
  authenticated: true,
}));

vi.mock("@/lib/prisma", () => ({ get prisma() { return state.client; } }));
vi.mock("@/lib/get-user-id", () => {
  class TestUnauthorizedError extends Error {
    constructor() {
      super("Unauthorized");
      this.name = "UnauthorizedError";
    }
  }

  return {
    requireUserId: vi.fn(async () => {
      if (!state.authenticated) throw new TestUnauthorizedError();
      return state.userId;
    }),
    UnauthorizedError: TestUnauthorizedError,
    unauthorizedResponse: () => new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
  };
});

import { GET as getTaxSummary } from "@/app/api/tax-summary/route";

let database: ReturnType<typeof createTestDatabase>;

beforeAll(async () => {
  database = createTestDatabase();
  state.client = database.client;

  await database.client.user.createMany({
    data: [
      { id: "tax-summary-a", email: "tax-summary-a@test.invalid", password: "unused" },
      { id: "tax-summary-b", email: "tax-summary-b@test.invalid", password: "unused" },
    ],
  });

  await database.client.income.createMany({
    data: Array.from({ length: 101 }, (_, index) => ({
      userId: "tax-summary-a",
      description: `Tenant A income ${index + 1}`,
      amount: 10,
      date: new Date("2026-01-15T12:00:00.000Z"),
      taxRelevant: true,
    })),
  });
  await database.client.expense.createMany({
    data: [{
      userId: "tax-summary-a",
      description: "Tenant A expense",
      amount: 25,
      date: new Date("2026-02-15T12:00:00.000Z"),
      taxRelevant: true,
    }],
  });
  await database.client.income.createMany({
    data: [
      {
        userId: "tax-summary-b",
        description: "Tenant B income",
        amount: 999,
        date: new Date("2026-01-15T12:00:00.000Z"),
        taxRelevant: true,
      },
    ],
  });
}, 40_000);

afterAll(async () => {
  await database?.cleanup();
});

function request(query = "year=2026&timeRange=thisYear") {
  return new NextRequest(`http://localhost/api/tax-summary?${query}`);
}

describe("tax summary API integration", () => {
  it("returns 401 without an authenticated user", async () => {
    state.authenticated = false;
    const response = await getTaxSummary(request());
    state.authenticated = true;

    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("Unauthorized");
  });

  it("aggregates all rows beyond pagination and keeps tenants isolated", async () => {
    state.userId = "tax-summary-a";
    const tenantAResponse = await getTaxSummary(request());
    expect(tenantAResponse.status).toBe(200);
    const tenantA = await tenantAResponse.json();
    expect(tenantA.complete).toBe(true);
    expect(tenantA.totalIncome).toBe(1_010);
    expect(tenantA.totalExpenses).toBe(25);
    expect(tenantA.profit).toBe(985);
    expect(tenantA.incomeCount).toBe(101);
    expect(tenantA.expenseCount).toBe(1);
    expect(tenantA.items).toBeUndefined();

    state.userId = "tax-summary-b";
    const tenantBResponse = await getTaxSummary(request());
    expect(tenantBResponse.status).toBe(200);
    const tenantB = await tenantBResponse.json();
    expect(tenantB.totalIncome).toBe(999);
    expect(tenantB.incomeCount).toBe(1);
    expect(tenantB.totalIncome).not.toBe(tenantA.totalIncome);
  });

  it("rejects an unsupported tax year instead of falling back", async () => {
    state.userId = "tax-summary-a";
    const response = await getTaxSummary(request("year=2024&timeRange=thisYear"));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("UNSUPPORTED_TAX_YEAR");
    expect(body.supportedYears).toEqual([2025, 2026]);
  });
});

