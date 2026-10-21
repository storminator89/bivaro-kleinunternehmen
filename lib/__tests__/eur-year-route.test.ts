import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getEURYearContract } from '../eur-line-mapping';
import type { EURExportPreview } from '@/types/eur-export';

const state = vi.hoisted(() => ({
  userId: 'eur-owner' as string | null,
  incomes: [] as Array<{ id: number; amount: number; date: string; taxRelevant: boolean; invoice: { status: string; paidAt: string } | null }>,
  expenses: [] as Array<{ id: number; description: string; amount: number; date: string; category: string; taxRelevant: boolean; taxDeductiblePercentage: number; depreciationYears: number | null }>,
  snapshot: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('@/lib/get-user-id', () => ({ getUserId: async () => state.userId }));
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: state.snapshot } }));
vi.mock('@/lib/audit-log', () => ({ auditExport: state.audit }));
import { GET } from '@/app/api/eur-export/route';

beforeEach(() => {
  state.userId = 'eur-owner';
  state.incomes = [];
  state.expenses = [];
  state.audit.mockReset();
  state.audit.mockResolvedValue(undefined);
  state.snapshot.mockReset();
  state.snapshot.mockImplementation(async (read: (tx: unknown) => Promise<unknown>) => read({
    income: { findMany: async () => state.incomes },
    expense: { findMany: async () => state.expenses },
    settings: { findUnique: async () => ({ companyName: 'Synthetic EUR fixture', taxNumber: null }) },
  }));
});

const request = (query: string) => new NextRequest(`http://localhost/api/eur-export?${query}`);
function expense(id: number, category: string, amount: number, year: number, depreciationYears: number | null = null) {
  return { id, description: `Synthetic ${category}`, amount, date: `${year}-01-01`, category, taxRelevant: true, taxDeductiblePercentage: 100, depreciationYears };
}
function seed(year: number) {
  state.incomes = [
    { id: 1, amount: 1000, date: `${year}-01-01`, taxRelevant: true, invoice: null },
    // The paid date, not the earlier invoice income date, belongs to this year.
    { id: 2, amount: 500, date: `${year - 1}-12-01`, taxRelevant: true, invoice: { status: 'PAID', paidAt: `${year}-01-02` } },
    { id: 3, amount: 999, date: `${year}-12-31`, taxRelevant: true, invoice: { status: 'PAID', paidAt: `${year + 1}-01-01` } },
    { id: 4, amount: 99, date: `${year}-01-01`, taxRelevant: false, invoice: null },
  ];
  state.expenses = [
    expense(1, 'Wareneinkauf', 100, year), expense(2, 'Wareneinkauf', -20, year),
    expense(3, 'Personal', 200, year), expense(4, 'Unbekannter Fall', 30, year),
    expense(5, 'Anlageart ungeklärt', 120, year, 1),
    expense(6, 'Privatentnahme', 50, year), expense(7, 'Telefon', 999, year - 1),
    { ...expense(8, 'Bürobedarf', 40, year), taxDeductiblePercentage: 0 },
  ];
}

describe('EÜR year API contract', () => {
  it.each(['2027', '2030'])('rejects unsupported %s before reading financial data and offers a bounded unmapped export', async year => {
    const response = await GET(request(`year=${year}&format=json`));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      supportedYears: [2024, 2025, 2026],
      alternativeExport: { href: `/handoff?year=${year}`, previewUrl: `/api/accountant-export?year=${year}&preview=1` },
    });
    expect(state.snapshot).not.toHaveBeenCalled();
    expect(state.audit).not.toHaveBeenCalled();
  });

  it.each(['', 'year=26', 'year=2026oops', 'year=2026.0', 'year=0000', 'year=0001', 'year=0999', 'year=2026&year=2025'])('rejects missing/malformed/ambiguous years before snapshot: %s', async query => {
    expect((await GET(request(query))).status).toBe(400);
    expect(state.snapshot).not.toHaveBeenCalled();
  });

  it.each([2024, 2025, 2026])('keeps signed totals, cash year and private/zero-share boundaries for %i', async year => {
    seed(year);
    const response = await GET(request(`year=${year}&format=json`));
    expect(response.status).toBe(200);
    const body = await response.json() as EURExportPreview;
    const contract = getEURYearContract(year);
    const goods = year === 2026 ? 29 : 27;
    const personnel = year === 2026 ? 31 : 30;
    expect(body.data).toMatchObject({
      year, mappingVersion: `anlage-euer-${year}-v1`, sourceVersion: contract.sourceVersion,
      checkedScope: contract.checkedScope, sourceReferences: contract.sourceReferences,
      exportKind: 'csv-working-paper', totalIncome: 1500, totalExpense: 430, profit: 1070,
      controlTotals: { incomeCount: 2, expenseCount: 5, correctionCount: 1, incomeAmount: 1500, expenseAmount: 430, profit: 1070 },
    });
    expect(body.data.lines).toEqual([
      expect.objectContaining({ lineNumber: 12, amount: 1500, type: 'income' }),
      expect.objectContaining({ lineNumber: goods, amount: 80, type: 'expense' }),
      expect.objectContaining({ lineNumber: personnel, amount: 200, type: 'expense' }),
      expect.objectContaining({ lineNumber: contract.roles.movableDepreciation, amount: 120, type: 'expense' }),
      expect.objectContaining({ lineNumber: contract.roles.fallbackExpense, amount: 30, type: 'expense' }),
      expect.objectContaining({ lineNumber: contract.roles.intermediateResult, amount: 1070, type: 'result' }),
    ]);
    expect(body.data.corrections).toEqual([expect.objectContaining({ expenseId: 2, lineNumber: goods, amount: -20 })]);
    expect(body.unmappedCategories).toEqual([{ category: 'Unbekannter Fall', amount: 30, count: 1 }]);
    expect(body.warnings).toContain(`AfA-Buchung 5 wurde mangels Anlageart vorläufig Zeile ${contract.roles.movableDepreciation} (bewegliche Wirtschaftsgüter) zugeordnet; bitte Anlageverzeichnis prüfen.`);
    expect(body.warnings).toContain(`1 Kategorie(n) ohne belastbare Zuordnung; vor Übertragung bitte prüfen (vorläufig Zeile ${contract.roles.fallbackExpense}).`);
    expect(body.warnings).toContain(contract.resultCaveat);
    expect(body.warnings.some(warning => warning.includes('Kontrollsummenabweichung'))).toBe(false);
  });

  it('uses the same 2026 labels and source identity in JSON and CSV, without stale expense/result rows', async () => {
    seed(2026);
    const body = await (await GET(request('year=2026&format=json'))).json() as EURExportPreview;
    const response = await GET(request('year=2026&format=csv'));
    const csv = await response.text();
    expect(csv).toContain('keine ELSTER-Einreichung');
    expect(csv).toContain(`Quellen-SHA256: ${body.data.sourceSha256}`);
    expect(csv).toContain(`Mappingversion: ${body.data.mappingVersion}`);
    expect(csv).toContain(`Quellenversion: ${body.data.sourceVersion}`);
    expect(csv).toContain(`Prüfumfang: "${body.data.checkedScope}"`);
    for (const line of body.data.lines) expect(csv).toContain(`${line.lineNumber};${line.name};`);
    expect(csv).toContain('Zeilen 93, 96 und 98');
    expect(csv).not.toMatch(/\n(?:27|28|33|60|90);/);
    expect(response.headers.get('content-disposition')).toContain('2026.csv');
  });

  it('retains authentication before exposing exports or alternatives', async () => {
    state.userId = null;
    expect((await GET(request('year=2027&format=json'))).status).toBe(401);
    expect(state.snapshot).not.toHaveBeenCalled();
  });
});
