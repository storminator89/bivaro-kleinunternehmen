import { describe, expect, it } from 'vitest';
import {
  calculateAccountingYear,
  calculateExpenseDeductionForYear,
  getBusinessDate,
  isDateInCalendarYear,
} from '../accounting';
import {
  generateElsterCSV,
  getEURLineForCategoryForYear,
  getEURLineDefinition,
  getSupportedEURYears,
  isSupportedEURYear,
} from '../eur-line-mapping';

describe('versioned EÜR working paper', () => {
  it('keeps negative expense corrections in the signed expense total', () => {
    const expenses = [
      { id: 1, amount: 100, date: '2025-03-01', category: 'Sonstiges', taxRelevant: true },
      { id: 2, amount: -20, date: '2025-04-01', category: 'Sonstiges', taxRelevant: true },
    ];
    const summary = calculateAccountingYear(2025, [], expenses);
    expect(summary.totalExpense).toBe(80);
    expect(summary.profit).toBe(-80);
    expect(calculateExpenseDeductionForYear(expenses[1], 2025)).toBe(-20);
  });

  it('does not classify a private refund as a business correction', () => {
    const summary = calculateAccountingYear(2025, [], [
      { amount: -20, date: '2025-04-01', category: 'Sonstiges', taxRelevant: false },
    ]);
    expect(summary.totalExpense).toBe(0);
  });

  it('uses UTC calendar years for date-only and boundary instants', () => {
    expect(getBusinessDate('2025-12-31T23:30:00-02:00')).toBe('2026-01-01');
    expect(isDateInCalendarYear('2025-12-31T23:30:00-02:00', 2026)).toBe(true);
    expect(isDateInCalendarYear('2025-12-31', 2025)).toBe(true);
  });

  it('blocks unverified years and uses the official 2025 row numbers', () => {
    expect(getSupportedEURYears()).toEqual([2024, 2025]);
    expect(isSupportedEURYear(2026)).toBe(false);
    expect(getEURLineForCategoryForYear('Wareneinkauf', 2025)).toBe(27);
    expect(getEURLineDefinition(90, 2025)?.type).toBe('result');
  });

  it('labels CSV as a working paper and includes correction drill-down', () => {
    const csv = generateElsterCSV([{ lineNumber: 60, name: 'Übrige BA', amount: -20 }], 2025, undefined, undefined, {
      mappingVersion: 'anlage-euer-2025-v1',
      corrections: [{ date: '2025-04-01', category: 'Sonstiges', amount: -20, lineNumber: 60, correctionReason: 'Erstattung' }],
    });
    expect(csv).toContain('CSV-Übertragungshilfe (keine ELSTER-Einreichung)');
    expect(csv).toContain('Korrekturen / Erstattungen (Prüfspur)');
    expect(csv).toContain('-20,00');
  });
});
