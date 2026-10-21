import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildEURCSVFromFreshSummary } from '@/lib/eur-csv-export';

const summary = { timeRange: 'thisYear', totalIncome: 120, totalExpense: 20, profit: 100, expenseCategories: [{ category: 'Fresh category', amount: 20 }] };
describe('fresh guarded client EÜR CSV', () => {
  it('uses only the returned exact period totals and categories', () => {
    const csv = buildEURCSVFromFreshSummary(summary, 'thisYear');
    for (const value of ['Einnahmen (steuerpflichtig);120,00', 'Fresh category;20,00', 'Summe Betriebsausgaben;20,00', 'GEWINN/VERLUST;100,00']) expect(csv).toContain(value);
    expect(() => buildEURCSVFromFreshSummary(summary, 'lastYear')).toThrow(/keine CSV/);
  });
  it.each([null, {}, { ...summary, totalIncome: NaN }, { ...summary, totalExpense: Infinity }, { ...summary, profit: undefined }, { ...summary, expenseCategories: [{ category: 'Missing amount' }] }])('rejects incomplete fresh values without silently manufacturing zeros: %j', value => {
    expect(() => buildEURCSVFromFreshSummary(value, 'thisYear')).toThrow(/keine CSV/);
  });
  it('quotes CSV category delimiters and neutralizes spreadsheet formula cells', () => {
    const csv = buildEURCSVFromFreshSummary({ ...summary, expenseCategories: [{ category: '=SUM(A1)', amount: 1 }, { category: 'with;"quote"', amount: 2 }] }, 'thisYear');
    expect(csv).toContain("'=SUM(A1);1,00"); expect(csv).toContain('"with;""quote""";2,00');
  });
  it('requests a fresh guarded query before creating any Blob, blocks cached UI during refetch/error and preserves range identity', () => {
    const dashboard = readFileSync('components/dashboard/dashboard-content.tsx', 'utf8');
    const handler = dashboard.slice(dashboard.indexOf('const handleExportEUR ='), dashboard.indexOf('// CSV-Export für das GWG-Verzeichnis'));
    expect(handler).toContain('await reloadSummary()');
    expect(handler).toContain('buildEURCSVFromFreshSummary(freshSummary, requestedRange)');
    expect(handler.indexOf('await reloadSummary()')).toBeLessThan(handler.indexOf('new Blob'));
    expect(handler).toContain('currentEURRange.current !== requestedRange');
    expect(handler).toContain("currentEURView.current !== 'eur'");
    expect(handler).toContain('if (eurExportInFlight.current) return');
    expect(handler).not.toContain('categoryChartData'); expect(handler).not.toContain('totalIncome.toFixed');
    expect(dashboard).toContain('summaryIsLoading || summaryIsFetching || isExportingEUR');
    expect(dashboard).toContain('summaryIsError || eurExportError || !summary');
    const hook = readFileSync('hooks/use-dashboard-data.ts', 'utf8');
    expect(hook).toContain('summaryQuery.refetch({ throwOnError: true })');
    expect(hook).toContain('cache: "no-store"');
    expect(hook).toContain('/api/dashboard/summary?timeRange=');
  });
});
