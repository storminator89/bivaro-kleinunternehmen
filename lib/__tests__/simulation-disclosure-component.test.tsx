import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SimulationResultDisclosure, type SimulationDisclosureAssumptions } from '@/components/public-accounting/simulation-result-disclosure';
import { buildTaxSummary } from '@/lib/tax-summary';

const assumptions: SimulationDisclosureAssumptions = {
  healthInsurance: 4000, pensionInsurance: 0, careInsurance: 1000, otherDeductions: 0,
  tradeTaxHebesatz: 400, churchTaxRate: 8, grossSalary: 50000, employeeExpenses: 1230,
  businessType: 'gewerblich', employmentType: 'self-employed', autoCalcSocial: false,
  numberOfChildren: 0, includeSolidarity: true, includeChurchTax: false,
};
const summary = buildTaxSummary({ year: 2025, timeRange: 'thisYear', now: new Date('2026-02-01T12:00:00Z'),
  incomes: [{ amount: 30000, date: new Date('2025-02-01T12:00:00Z'), taxRelevant: true }], expenses: [],
});

describe('SimulationResultDisclosure rendered result-local contract', () => {
  it('renders year, actual period, source scope, model input and exclusions without hidden details', () => {
    const html = renderToStaticMarkup(<SimulationResultDisclosure view={{ year: 2025, timeRange: 'thisYear' }}
      summary={summary} taxableIncome={25000} calculationSupported assumptions={assumptions} />);
    expect(html).toContain('aria-label="Einordnung des Simulationsergebnisses"');
    expect(html).toContain('Regeljahr 2025');
    expect(html).toContain('01.01.2025 bis 31.12.2025');
    expect(html).toContain('1 Positionen · Serverstand');
    expect(html).toContain('de-tax-2025-limited-v1');
    expect(html).toContain('25.000,00');
    expect(html).toContain('nicht Ihr vollständiges persönliches zu versteuerndes Einkommen');
    expect(html).toContain('keine vollständige persönliche Steuerlast');
    expect(html).toContain('Externe Einnahmen und Ausgaben fehlen');
    expect(html).toContain('Jahreskontext wird nicht addiert');
    expect(html).toContain('Zusammenveranlagung');
    expect(html).toContain('Sonder-/Auslandsfälle');
    expect(html).toContain('komplexe Verlustfälle');
    expect(html).not.toMatch(/<details|hidden=|display:\s*none/);
  });

  it('renders editable local assumptions including salary, selected surcharges and social helper state', () => {
    const html = renderToStaticMarkup(<SimulationResultDisclosure view={{ year: 2025, timeRange: 'thisYear' }}
      summary={summary} taxableIncome={65000} calculationSupported assumptions={{ ...assumptions,
        employmentType: 'side-business', grossSalary: 65000, includeChurchTax: true, churchTaxRate: 9,
        autoCalcSocial: true, numberOfChildren: 2 }} />);
    for (const value of ['Krankenversicherung 4.000,00', 'Rentenversicherung 0,00', 'Pflegeversicherung 1.000,00',
      'sonstige Abzüge 0,00', 'Bruttogehalt 65.000,00', 'Werbungskosten 1.230,00',
      'Sozialabgaben-Näherung ein (2 Kinder)', 'mit Hebesatz 400 %', 'Soli ein', 'Kirchensteuer ein (9 %)']) expect(html).toContain(value);
    expect(html).toContain('href="#parameters-heading"');
    expect(html).toContain('Annahmen bearbeiten');
    expect(html).toContain('lokal veränderbar, nicht serverbestätigt');
    expect(html).toContain('Standardannahmen');
  });

  it('renders unavailable data as unconfirmed, not a confirmed zero or stale server basis', () => {
    const html = renderToStaticMarkup(<SimulationResultDisclosure view={{ year: 2026, timeRange: 'all' }}
      summary={null} taxableIncome={0} calculationSupported={false} assumptions={assumptions} />);
    expect(html).toContain('Regeljahr 2026');
    expect(html).toContain('Gesamter erfasster Zeitraum · keine Jahresbasis');
    expect(html).toContain('Nicht bestätigt · keine Berechnung');
    expect(html).toContain('nicht berechnet');
    expect(html).not.toContain('Serverstand');
    expect(html).not.toContain('Regelpaket de-tax');
    expect(html).not.toContain('Modelleingang nach Annahmen:</strong> 0,00');
  });

  it('labels invalid assumptions explicitly and does not render NaN as an amount', () => {
    const html = renderToStaticMarkup(<SimulationResultDisclosure view={{ year: 2025, timeRange: 'thisYear' }}
      summary={summary} taxableIncome={0} calculationSupported={false}
      assumptions={{ ...assumptions, healthInsurance: Number.NaN, churchTaxRate: 10, includeChurchTax: true }} />);
    expect(html).toContain('Krankenversicherung ungültige Eingabe');
    expect(html).toContain('Kirchensteuer ungültige Eingabe');
    expect(html).toContain('nicht berechnet');
    expect(html).not.toContain('NaN');
  });
});
