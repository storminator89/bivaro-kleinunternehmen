import { describe, expect, it } from "vitest";
import {
  calculateDepreciationForYear,
  calculateExpenseDeductionForRange,
  calculateExpenseDeductionForYear,
  calculateRemainingDepreciableAmount,
  getDateRange,
  getIncomeAccountingDate,
  isIncludedIncome,
} from "../accounting";

describe("shared accounting rules", () => {
  it("keeps all 101 records in a complete server-side style aggregation", () => {
    const expenses = Array.from({ length: 101 }, (_, index) => ({
      amount: 10,
      date: "2026-01-15T12:00:00.000Z",
      taxRelevant: true,
      taxDeductiblePercentage: 100,
      id: index + 1,
    }));

    const total = expenses.reduce(
      (sum, expense) => sum + calculateExpenseDeductionForRange(expense, {}),
      0,
    );

    expect(total).toBe(1010);
  });

  it("uses paidAt for paid income and keeps a paid original after cancellation", () => {
    const paid = {
      amount: 120,
      date: "2026-01-01T12:00:00.000Z",
      taxRelevant: true,
      invoice: { status: "PAID", paidAt: "2026-02-10T12:00:00.000Z" },
    };
    const unpaid = { ...paid, invoice: { status: "SENT", paidAt: null } };
    const cancelled = { ...paid, invoice: { status: "CANCELLED", paidAt: null } };
    const cancelledAfterPayment = {
      ...paid,
      invoice: { status: "CANCELLED", paidAt: "2026-02-10T12:00:00.000Z" },
    };

    expect(isIncludedIncome(paid)).toBe(true);
    expect(getIncomeAccountingDate(paid).toISOString()).toContain("2026-02-10");
    expect(isIncludedIncome(unpaid)).toBe(false);
    expect(isIncludedIncome(cancelled)).toBe(false);
    expect(isIncludedIncome(cancelledAfterPayment)).toBe(true);
    expect(getIncomeAccountingDate(cancelledAfterPayment).toISOString()).toContain("2026-02-10");
  });

  it("preserves a zero deductible share", () => {
    const expense = {
      amount: 500,
      date: "2026-04-01T12:00:00.000Z",
      taxRelevant: true,
      taxDeductiblePercentage: 0,
    };

    expect(calculateExpenseDeductionForYear(expense, 2026)).toBe(0);
  });

  it("books every month of a linear schedule, including the final remainder year", () => {
    const expense = {
      amount: 3600,
      date: "2026-07-15T12:00:00.000Z",
      taxRelevant: true,
      taxDeductiblePercentage: 100,
      depreciationYears: 3,
    };

    expect(calculateDepreciationForYear(expense, 2026)?.amount).toBeCloseTo(600);
    expect(calculateDepreciationForYear(expense, 2027)?.amount).toBeCloseTo(1200);
    expect(calculateDepreciationForYear(expense, 2028)?.amount).toBeCloseTo(1200);
    expect(calculateDepreciationForYear(expense, 2029)?.amount).toBeCloseTo(600);
    expect(calculateExpenseDeductionForYear(expense, 2030)).toBe(0);
    expect(calculateRemainingDepreciableAmount(expense, 2029)).toBeCloseTo(0);
  });

  it("uses exclusive year boundaries", () => {
    const now = new Date(2026, 5, 18, 10, 30, 0);
    const current = getDateRange("thisYear", now);
    const previous = getDateRange("lastYear", now);

    expect(current.start?.getFullYear()).toBe(2026);
    expect(current.endExclusive?.getFullYear()).toBe(2027);
    expect(previous.start?.getFullYear()).toBe(2025);
    expect(previous.endExclusive?.getFullYear()).toBe(2026);
  });

  it("clamps rolling month ranges at the end of shorter months", () => {
    const range = getDateRange("last3Months", new Date(2026, 4, 31, 10, 30, 0));
    expect(range.start?.getFullYear()).toBe(2026);
    expect(range.start?.getMonth()).toBe(1);
    expect(range.start?.getDate()).toBe(28);
  });
});
