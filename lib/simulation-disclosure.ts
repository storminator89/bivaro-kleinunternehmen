import { isSupportedTaxYear } from '@/lib/tax-calculator';
import type { TaxSummary, TaxSummaryPeriod } from '@/lib/tax-summary';

export type SimulationView = { year: number; timeRange: TaxSummaryPeriod };
export type SimulationDataCheck = {
  tone: 'info' | 'warning';
  title: string;
  description: string;
};

const ranges = new Set<TaxSummaryPeriod>(['thisYear', 'lastYear', 'last3Months', 'last6Months', 'all']);

/** URL state is presentation only; it never changes accounting or tax rules. */
export function readSimulationView(params: Pick<URLSearchParams, 'get'>, currentYear: number): SimulationView & { error: string | null } {
  const requestedYear = params.get('year');
  const year = requestedYear === null ? currentYear : Number(requestedYear);
  const requestedRange = params.get('timeRange') ?? 'thisYear';
  const yearValid = Number.isInteger(year) && isSupportedTaxYear(year);
  const rangeValid = ranges.has(requestedRange as TaxSummaryPeriod);
  return {
    year,
    timeRange: rangeValid ? requestedRange as TaxSummaryPeriod : 'thisYear',
    error: !yearValid
      ? 'Für das gewählte Steuerjahr ist kein unterstütztes Regelpaket hinterlegt. Bitte wählen Sie 2025 oder 2026.'
      : !rangeValid ? 'Der Analysezeitraum in der Adresse ist ungültig. Bitte wählen Sie einen Zeitraum.' : null,
  };
}

export function simulationPeriodLabel({ year, timeRange }: SimulationView): string {
  if (timeRange === 'thisYear' || timeRange === 'lastYear') return `01.01.${year} bis 31.12.${year} · Jahresansicht`;
  if (timeRange === 'all') return 'Gesamter erfasster Zeitraum · keine Jahresbasis';
  return `${timeRange === 'last3Months' ? 'Letzte 3 Monate' : 'Letzte 6 Monate'} relativ zum Server-Datenstand · keine Jahresbasis`;
}

export function simulationSummaryMatches(summary: TaxSummary | null, view: SimulationView): summary is TaxSummary {
  return summary !== null && summary.year === view.year && summary.timeRange === view.timeRange;
}

export const SIMULATION_SOURCE_SCOPE = 'Nur serverseitig geladene In-App-Buchungen nach Zahlungs-/EÜR-Zuordnung; erstellte Rechnungen allein sind keine Einnahmenbasis. Externe Einnahmen und Ausgaben fehlen. Jahreskontext wird nicht addiert; Kleinunternehmerstatus ungeprüft.';
export const SIMULATION_MODEL_SCOPE = 'Der Modelleingang ist nicht Ihr vollständiges persönliches zu versteuerndes Einkommen. Die Modellsteuern sind keine vollständige persönliche Steuerlast und keine Steuerstatusentscheidung.';
export const SIMULATION_EXCLUDED_CASES = 'Nicht abgebildet: Zusammenveranlagung, weitere Betriebe, sonstige persönliche Einkünfte, Sonder-/Auslandsfälle, individuelle Freibeträge und komplexe Verlustfälle. Die Abziehbarkeit Ihrer Annahmen wird nicht geprüft.';

/** Neutral observations about the available data, never optimization advice. */
export function simulationDataChecks(summary: TaxSummary, formatCurrency: (amount: number) => string): SimulationDataCheck[] {
  const checks: SimulationDataCheck[] = [{
    tone: 'info',
    title: 'Datenumfang abgleichen',
    description: `${summary.incomeCount} Einnahmen- und ${summary.expenseCount} Ausgabenpositionen wurden serverseitig berücksichtigt. Eine vollständige Abfrage bestätigt nicht die Vollständigkeit Ihrer Unternehmens- oder persönlichen Steuerdaten.`,
  }];
  if (!summary.annualBasis) checks.push({
    tone: 'warning', title: 'Keine Jahresbasis',
    description: 'Diese Periodenansicht wird nicht auf ein Jahr hochgerechnet. Es werden keine Modellsteuern berechnet.',
  });
  if (summary.profit < 0) checks.push({
    tone: 'warning', title: 'Verlustfall außerhalb des Modells',
    description: `Der erfasste Verlust beträgt ${formatCurrency(Math.abs(summary.profit))}. Verlustverrechnung sowie Vor- und Rückträge sind nicht berechnet.`,
  });
  if (summary.partialDeductionShortfall > 0) checks.push({
    tone: 'info', title: 'Erfasste Teilabzüge',
    description: `${formatCurrency(summary.partialDeductionShortfall)} sind aufgrund der gespeicherten Abzugsanteile nicht im Ausgabenabzug enthalten. Datenzuordnung und Belege können Sie abgleichen; daraus folgt keine Gestaltungsempfehlung.`,
  });
  if (summary.nonTaxRelevantExpenseCount > 0) checks.push({
    tone: 'info', title: 'Nicht berücksichtigte Ausgaben',
    description: `${summary.nonTaxRelevantExpenseCount} Ausgaben (${formatCurrency(summary.nonTaxRelevantExpenseAmount)}) sind als nicht steuerrelevant markiert. Das beschreibt nur die gespeicherte Zuordnung, nicht deren steuerliche Zulässigkeit.`,
  });
  if (summary.nonTaxRelevantIncomeCount > 0) checks.push({
    tone: 'warning', title: 'Nicht berücksichtigte Einnahmen',
    description: `${summary.nonTaxRelevantIncomeCount} Einnahmen (${formatCurrency(summary.nonTaxRelevantIncomeAmount)}) sind als nicht steuerrelevant markiert. Diese Markierung ist kein Nachweis einer Steuerbefreiung.`,
  });
  return checks;
}
