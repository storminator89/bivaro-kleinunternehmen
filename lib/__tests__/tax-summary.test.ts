import { describe, expect, it } from "vitest";
import { buildTaxSummary } from "@/lib/tax-summary";

const annualNow = new Date("2026-06-15T12:00:00.000Z");

describe("buildTaxSummary", () => {
  it("aggregates more than the list API page size", () => {
    const incomes = Array.from({ length: 101 }, (_, id) => ({
      amount: 10,
      date: new Date("2026-01-15T12:00:00.000Z"),
      taxRelevant: true,
      description: `Einnahme ${id}`,
    }));
    const expenses = Array.from({ length: 1_001 }, (_, id) => ({
      id,
      amount: 1,
      date: new Date("2026-02-15T12:00:00.000Z"),
      taxRelevant: true,
      description: `Ausgabe ${id}`,
    }));

    const summary = buildTaxSummary({
      year: 2026,
      timeRange: "thisYear",
      incomes,
      expenses,
      now: annualNow,
    });

    expect(summary.complete).toBe(true);
    expect(summary.totalIncome).toBe(1_010);
    expect(summary.totalExpenses).toBe(1_001);
    expect(summary.incomeCount).toBe(101);
    expect(summary.expenseCount).toBe(1_001);
    expect(summary.sourceCount).toBe(1_102);
  });

  it("uses the cash realization date and the shared AfA schedule", () => {
    const summary = buildTaxSummary({
      year: 2026,
      timeRange: "thisYear",
      now: annualNow,
      incomes: [
        {
          amount: 100,
          date: new Date("2025-12-31T12:00:00.000Z"),
          taxRelevant: true,
          invoice: { status: "PAID", paidAt: new Date("2026-01-02T12:00:00.000Z") },
        },
        {
          amount: 50,
          date: new Date("2026-01-02T12:00:00.000Z"),
          taxRelevant: true,
          invoice: { status: "OPEN", paidAt: null },
        },
      ],
      expenses: [
        {
          id: 1,
          amount: 1_200,
          date: new Date("2025-07-01T12:00:00.000Z"),
          taxRelevant: true,
          depreciationYears: 3,
          taxDeductiblePercentage: 100,
        },
      ],
    });

    expect(summary.totalIncome).toBe(100);
    // The asset was acquired in the prior year, so 2026 contains twelve
    // monthly AfA amounts: 1,200 / 36 * 12.
    expect(summary.totalExpenses).toBe(400);
    expect(summary.profit).toBe(-300);
    expect(summary.warnings.some((warning) => warning.includes("Verlustfälle"))).toBe(true);
  });

  it("does not treat a private withdrawal as a business expense", () => {
    const summary = buildTaxSummary({
      year: 2026,
      timeRange: "thisYear",
      now: annualNow,
      incomes: [{ amount: 100, date: annualNow, taxRelevant: true }],
      expenses: [{ amount: 100, date: annualNow, taxRelevant: true, category: "Privatentnahme" }],
    });

    expect(summary.totalIncome).toBe(100);
    expect(summary.totalExpenses).toBe(0);
    expect(summary.profit).toBe(100);
  });

  it("marks nonannual views as a period view instead of an annual tax basis", () => {
    const summary = buildTaxSummary({
      year: 2026,
      timeRange: "last3Months",
      now: annualNow,
      incomes: [],
      expenses: [],
    });

    expect(summary.annualBasis).toBe(false);
    expect(summary.warnings.some((warning) => warning.includes("kein vollständiges Veranlagungsjahr"))).toBe(true);
  });

  it("does not silently reuse a rule pack for an unknown year", () => {
    expect(() => buildTaxSummary({
      year: 2024,
      timeRange: "thisYear",
      incomes: [],
      expenses: [],
    })).toThrow("Nicht unterstütztes Veranlagungsjahr");
  });
});
