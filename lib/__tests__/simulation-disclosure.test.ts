import { describe, expect, it } from 'vitest';
import { buildTaxSummary } from '@/lib/tax-summary';
import { readSimulationView, simulationDataChecks, simulationPeriodLabel, simulationSummaryMatches, SIMULATION_EXCLUDED_CASES, SIMULATION_MODEL_SCOPE, SIMULATION_SOURCE_SCOPE } from '@/lib/simulation-disclosure';

const currency = (amount: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount);
const date = new Date('2026-02-01T12:00:00.000Z');
const empty = () => buildTaxSummary({ year: 2026, timeRange: 'thisYear', incomes: [], expenses: [], now: date });

describe('simulation presentation disclosure (no tax-formula changes)', () => {
  it('retains explicit year and view rather than substituting the current year', () => {
    expect(readSimulationView(new URLSearchParams('year=2025&timeRange=all'), 2026)).toEqual({ year: 2025, timeRange: 'all', error: null });
    expect(readSimulationView(new URLSearchParams('year=2025&timeRange=last6Months'), 2026)).toEqual({ year: 2025, timeRange: 'last6Months', error: null });
    expect(readSimulationView(new URLSearchParams(), 2026)).toEqual({ year: 2026, timeRange: 'thisYear', error: null });
  });

  it.each(['2024', '2027', '', 'not-a-year', '2025.5'])('blocks unsupported/invalid year %s without a successful default', year => {
    expect(readSimulationView(new URLSearchParams({ year }), 2026).error).toContain('kein unterstütztes Regelpaket');
  });

  it('blocks an invalid view and an unsupported default calendar year', () => {
    expect(readSimulationView(new URLSearchParams('year=2026&timeRange=quarter'), 2026).error).toContain('ungültig');
    expect(readSimulationView(new URLSearchParams(), 2027).error).not.toBeNull();
  });

  it('labels the server-selected annual year exactly, including the legacy range name', () => {
    expect(simulationPeriodLabel({ year: 2025, timeRange: 'thisYear' })).toBe('01.01.2025 bis 31.12.2025 · Jahresansicht');
    // buildTaxSummary selects input.year for BOTH annual range names.
    expect(simulationPeriodLabel({ year: 2026, timeRange: 'lastYear' })).toBe('01.01.2026 bis 31.12.2026 · Jahresansicht');
    expect(simulationPeriodLabel({ year: 2025, timeRange: 'last3Months' })).toContain('relativ zum Server-Datenstand · keine Jahresbasis');
    expect(simulationPeriodLabel({ year: 2025, timeRange: 'last6Months' })).toContain('Letzte 6 Monate');
    expect(simulationPeriodLabel({ year: 2025, timeRange: 'all' })).toBe('Gesamter erfasster Zeitraum · keine Jahresbasis');
  });

  it('distinguishes unknown/unconfirmed data from a confirmed zero', () => {
    expect(simulationSummaryMatches(null, { year: 2026, timeRange: 'thisYear' })).toBe(false);
    const zero = empty();
    expect(simulationSummaryMatches(zero, { year: 2026, timeRange: 'thisYear' })).toBe(true);
    expect(simulationSummaryMatches(zero, { year: 2025, timeRange: 'thisYear' })).toBe(false);
    expect(simulationSummaryMatches(zero, { year: 2026, timeRange: 'all' })).toBe(false);
    const checks = simulationDataChecks(zero, currency);
    expect(checks).toHaveLength(1);
    expect(checks[0].description).toContain('0 Einnahmen- und 0 Ausgabenpositionen');
    expect(checks[0].description).toContain('bestätigt nicht die Vollständigkeit');
  });

  it('reports a one-cent partial exclusion instead of an arbitrary optimization threshold', () => {
    const summary = buildTaxSummary({ year: 2026, timeRange: 'thisYear', now: date, incomes: [], expenses: [
      { amount: 1, date, taxRelevant: true, taxDeductiblePercentage: 99 },
    ] });
    expect(summary.partialDeductionShortfall).toBeCloseTo(0.01);
    const check = simulationDataChecks(summary, currency).find(item => item.title === 'Erfasste Teilabzüge');
    expect(check?.description).toContain('0,01');
    expect(check?.description).toContain('keine Gestaltungsempfehlung');
    expect(simulationDataChecks({ ...summary, partialDeductionShortfall: 0 }, currency).some(item => item.title === 'Erfasste Teilabzüge')).toBe(false);
  });

  it('describes stored classifications without promising tax exemption or deduction', () => {
    const summary = buildTaxSummary({ year: 2026, timeRange: 'thisYear', now: date,
      incomes: [{ amount: 0, date, taxRelevant: false }],
      expenses: [{ amount: 7, date, taxRelevant: false }],
    });
    const checks = simulationDataChecks(summary, currency);
    expect(checks.find(item => item.title === 'Nicht berücksichtigte Einnahmen')?.description).toContain('1 Einnahmen (0,00');
    expect(checks.find(item => item.title === 'Nicht berücksichtigte Einnahmen')?.description).toContain('kein Nachweis einer Steuerbefreiung');
    expect(checks.find(item => item.title === 'Nicht berücksichtigte Ausgaben')?.description).toContain('nicht deren steuerliche Zulässigkeit');
  });

  it('states period/loss limitations without recommending investments, deductions or loss claims', () => {
    const loss = buildTaxSummary({ year: 2026, timeRange: 'all', now: date, incomes: [], expenses: [{ amount: 30, date, taxRelevant: true }] });
    const checks = simulationDataChecks(loss, currency);
    expect(checks.find(item => item.title === 'Keine Jahresbasis')?.description).toContain('nicht auf ein Jahr hochgerechnet');
    expect(checks.find(item => item.title === 'Verlustfall außerhalb des Modells')?.description).toContain('nicht berechnet');
    expect(checks.every(item => item.tone !== ('positive' as string))).toBe(true);
    expect(JSON.stringify(checks)).not.toMatch(/vorziehen|Verluste strategisch nutzen|Spitzensteuersatz|Zusätzliche Abzugsmöglichkeiten/);
  });

  it('keeps source omissions, model scope and excluded cases explicit', () => {
    expect(SIMULATION_SOURCE_SCOPE).toContain('erstellte Rechnungen allein sind keine Einnahmenbasis');
    expect(SIMULATION_SOURCE_SCOPE).toContain('Externe Einnahmen und Ausgaben fehlen');
    expect(SIMULATION_SOURCE_SCOPE).toContain('Jahreskontext wird nicht addiert');
    expect(SIMULATION_SOURCE_SCOPE).toContain('Kleinunternehmerstatus ungeprüft');
    expect(SIMULATION_MODEL_SCOPE).toContain('nicht Ihr vollständiges persönliches zu versteuerndes Einkommen');
    expect(SIMULATION_MODEL_SCOPE).toContain('keine vollständige persönliche Steuerlast');
    for (const excluded of ['Zusammenveranlagung', 'weitere Betriebe', 'Sonder-/Auslandsfälle', 'Verlustfälle', 'Abziehbarkeit']) expect(SIMULATION_EXCLUDED_CASES).toContain(excluded);
  });
});
