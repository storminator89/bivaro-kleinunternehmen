import { afterAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDatabase } from "./helpers/database";

const benchmarkEnabled = process.env.BIVARO_RUN_BENCHMARK === "1";
const benchmark = benchmarkEnabled ? describe : describe.skip;
const USER_ID = "benchmark-user";
const SIZES = [100, 10_000, 100_000] as const;
const RUNS = 7;

const state = vi.hoisted(() => ({
  client: null as PrismaClient | null,
  userId: "benchmark-user",
}));

vi.mock("@/lib/prisma", () => ({ get prisma() { return state.client; } }));
vi.mock("@/lib/get-user-id", () => ({
  getUserId: vi.fn(async () => state.userId),
  requireUserId: vi.fn(async () => state.userId),
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: vi.fn(),
}));

import { GET as getKpis } from "@/app/api/dashboard/kpis/route";

type Measurement = {
  milliseconds: number;
  responseBytes: number;
  selectQueries: number;
  rssDeltaMiB: number;
};

type SizeResult = {
  rowsPerTable: number;
  measurements: Measurement[];
  p50Milliseconds: number;
  p95Milliseconds: number;
  p50ResponseBytes: number;
  p95ResponseBytes: number;
  maxRssDeltaMiB: number;
  queryCounts: number[];
  explain: string[];
};

let database: ReturnType<typeof createTestDatabase> | undefined;
let selectQueryCount = 0;

function percentile(values: number[], percentileValue: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1);
  return sorted[index] ?? 0;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function seed(size: number) {
  if (!database) throw new Error("Benchmark database is not ready");
  await database.client.user.create({
    data: { id: USER_ID, email: "benchmark@example.test", password: "unused" },
  });

  const chunkSize = 2_000;
  for (let start = 0; start < size; start += chunkSize) {
    const end = Math.min(size, start + chunkSize);
    await database.client.income.createMany({
      data: Array.from({ length: end - start }, (_, offset) => ({
        userId: USER_ID,
        description: `Benchmark income ${start + offset}`,
        amount: 1,
        date: new Date(Date.UTC(2026, (start + offset) % 12, ((start + offset) % 27) + 1, 12)),
        taxRelevant: true,
      })),
    });
    await database.client.expense.createMany({
      data: Array.from({ length: end - start }, (_, offset) => ({
        userId: USER_ID,
        description: `Benchmark expense ${start + offset}`,
        amount: 1,
        date: new Date(Date.UTC(2026, (start + offset) % 12, ((start + offset) % 27) + 1, 12)),
        taxRelevant: true,
      })),
    });
  }
}

async function explainIncomePage() {
  if (!database) throw new Error("Benchmark database is not ready");
  const rows = await database.client.$queryRaw<Array<{ detail: string }>>`
    EXPLAIN QUERY PLAN
    SELECT "id", "date"
    FROM "Income"
    WHERE "userId" = ${USER_ID}
    ORDER BY "date" DESC
    LIMIT 10 OFFSET 0
  `;
  return rows.map((row) => row.detail);
}

async function measureKpi(): Promise<Measurement> {
  if (!database) throw new Error("Benchmark database is not ready");
  selectQueryCount = 0;
  const rssBefore = process.memoryUsage().rss;
  const started = performance.now();
  const response = await getKpis();
  const body = await response.text();
  const elapsed = performance.now() - started;
  const rssAfter = process.memoryUsage().rss;
  return {
    milliseconds: round(elapsed),
    responseBytes: Buffer.byteLength(body, "utf8"),
    selectQueries: selectQueryCount,
    rssDeltaMiB: round(Math.max(0, rssAfter - rssBefore) / (1024 * 1024)),
  };
}

benchmark("dashboard KPI performance baseline (opt-in)", () => {
  afterAll(async () => {
    await database?.cleanup();
  });

  it("measures 100, 10k and 100k rows without changing product code", async () => {
    const results: SizeResult[] = [];

    for (const size of SIZES) {
    database = createTestDatabase();
    state.client = database.client;
    database.client.$on("query", (event) => {
      if (/^\s*(SELECT|WITH)\b/i.test(event.query)) selectQueryCount += 1;
    });
      try {
        await seed(size);
        // Warm up the route once; only the following seven calls are reported.
        const warmup = await getKpis();
        await warmup.text();

        const measurements: Measurement[] = [];
        for (let run = 0; run < RUNS; run += 1) {
          measurements.push(await measureKpi());
        }

        const explain = await explainIncomePage();
        const milliseconds = measurements.map((measurement) => measurement.milliseconds);
        const responseBytes = measurements.map((measurement) => measurement.responseBytes);
        results.push({
          rowsPerTable: size,
          measurements,
          p50Milliseconds: percentile(milliseconds, 0.5),
          p95Milliseconds: percentile(milliseconds, 0.95),
          p50ResponseBytes: percentile(responseBytes, 0.5),
          p95ResponseBytes: percentile(responseBytes, 0.95),
          maxRssDeltaMiB: Math.max(...measurements.map((measurement) => measurement.rssDeltaMiB)),
          queryCounts: measurements.map((measurement) => measurement.selectQueries),
          explain,
        });
      } finally {
        await database.cleanup();
        database = undefined;
        state.client = null;
      }
    }

    expect(results).toHaveLength(SIZES.length);
    expect(results.every((result) => result.queryCounts.every((count) => count <= 10))).toBe(true);
    expect(results.every((result) => result.explain.some((detail) => detail.includes("Income_userId_date_idx")))).toBe(true);
    console.warn(JSON.stringify({ rowsPerTable: SIZES, runs: RUNS, results }, null, 2));
  }, 240_000);
});
