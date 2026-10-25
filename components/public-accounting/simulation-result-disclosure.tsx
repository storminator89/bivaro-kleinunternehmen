import { simulationPeriodLabel, SIMULATION_SOURCE_SCOPE, SIMULATION_MODEL_SCOPE, SIMULATION_EXCLUDED_CASES, type SimulationView } from '@/lib/simulation-disclosure';
import type { TaxSummary } from '@/lib/tax-summary';
import { simulationNumberError, type SimulationNumberField, type SimulationNumberValues } from '@/app/steuer-simulation/validation';

export type SimulationDisclosureAssumptions = SimulationNumberValues & {
  businessType: 'gewerblich' | 'freiberuflich';
  employmentType: 'self-employed' | 'side-business';
  autoCalcSocial: boolean;
  numberOfChildren: number;
  includeSolidarity: boolean;
  includeChurchTax: boolean;
};

type SimulationResultDisclosureProps = {
  view: SimulationView;
  /** Only the matched, confirmed server summary; unavailable/stale = null. */
  summary: TaxSummary | null;
  taxableIncome: number;
  calculationSupported: boolean;
  assumptions: SimulationDisclosureAssumptions;
};

const formatCurrency = (value: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
const formatAssumption = (field: SimulationNumberField, value: number) =>
  simulationNumberError(field, value) ? 'ungültige Eingabe' : formatCurrency(value);

/** Presentation only. All accounting and tax arithmetic remains in its existing caller. */
export function SimulationResultDisclosure({ view, summary, taxableIncome, calculationSupported, assumptions }: SimulationResultDisclosureProps) {
  const taxYear = view.year;
  const periodLabel = simulationPeriodLabel(view);
  const sourceAvailable = summary !== null;
  const formatSimulationValue = (value: number) => calculationSupported ? formatCurrency(value) : 'nicht berechnet';
  const { healthInsurance, pensionInsurance, careInsurance, otherDeductions, businessType, employmentType,
    grossSalary, employeeExpenses, autoCalcSocial, numberOfChildren, tradeTaxHebesatz,
    includeSolidarity, includeChurchTax, churchTaxRate } = assumptions;
  return (
    <div aria-label="Einordnung des Simulationsergebnisses" className="space-y-3 text-sm leading-relaxed [overflow-wrap:anywhere]">
      <p><strong>Regeljahr {taxYear} · Zeitraum:</strong> {periodLabel}</p>
      <p><strong>Datenbasis:</strong> {sourceAvailable && summary ? `${summary.sourceCount} Positionen · Serverstand ${new Date(summary.dataAsOf).toLocaleString("de-DE")}` : "Nicht bestätigt · keine Berechnung"}. {SIMULATION_SOURCE_SCOPE}</p>
      <p><strong>Modelleingang nach Annahmen:</strong> {formatSimulationValue(taxableIncome)}. {SIMULATION_MODEL_SCOPE}</p>
      <p><strong>Aktive Jahresannahmen:</strong> Krankenversicherung {formatAssumption("healthInsurance", healthInsurance)}, Rentenversicherung {formatAssumption("pensionInsurance", pensionInsurance)}, Pflegeversicherung {formatAssumption("careInsurance", careInsurance)}, sonstige Abzüge {formatAssumption("otherDeductions", otherDeductions)}.</p>
      {employmentType === "side-business" && <p>Bruttogehalt {formatAssumption("grossSalary", grossSalary)} · Werbungskosten {formatAssumption("employeeExpenses", employeeExpenses)} · Sozialabgaben-Näherung {autoCalcSocial ? `ein (${numberOfChildren} Kinder)` : "aus; manuelle Beiträge"}.</p>}
      <p>Gewerbesteuer {businessType === "gewerblich" ? simulationNumberError("tradeTaxHebesatz", tradeTaxHebesatz) ? "ungültiger Hebesatz" : `mit Hebesatz ${tradeTaxHebesatz} %` : "nicht angesetzt (freiberuflich)"} · Soli {includeSolidarity ? "ein" : "aus"} · Kirchensteuer {includeChurchTax ? simulationNumberError("churchTaxRate", churchTaxRate) ? "ungültige Eingabe" : `ein (${churchTaxRate} %)` : "aus"}.</p>
      <a href="#parameters-heading" className="inline-flex min-h-11 items-center underline underline-offset-4">Annahmen bearbeiten</a>
      <p><strong>Modellgrenzen:</strong> {SIMULATION_EXCLUDED_CASES}</p>
      <p>Die Annahmen sind lokal veränderbar, nicht serverbestätigt; ein Neuaufruf startet mit den angezeigten Standardannahmen.</p>
      {sourceAvailable && summary && <p>Regelpaket {summary.ruleVersion} · Quelle: {summary.ruleSource}.</p>}
    </div>
  );
}
