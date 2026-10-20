export const simulationNumberRules = {
  grossSalary: { label: 'Bruttojahresgehalt', min: 0, step: 0.01 },
  employeeExpenses: { label: 'Werbungskosten', min: 0, step: 0.01 },
  healthInsurance: { label: 'Krankenversicherung', min: 0, step: 0.01 },
  pensionInsurance: { label: 'Rentenversicherung', min: 0, step: 0.01 },
  careInsurance: { label: 'Pflegeversicherung', min: 0, step: 0.01 },
  otherDeductions: { label: 'Sonstige Sonderausgaben', min: 0, step: 0.01 },
  tradeTaxHebesatz: { label: 'Gewerbesteuer-Hebesatz', min: 0, max: 1000, step: 10 },
  churchTaxRate: { label: 'Kirchensteuer', min: 0, max: 9, step: 1 },
} satisfies Record<string, { label: string; min: number; max?: number; step: number }>;

export type SimulationNumberField = keyof typeof simulationNumberRules;
export type SimulationNumberValues = Record<SimulationNumberField, number>;

export function simulationNumberError(field: SimulationNumberField, value: number): string | null {
  const rule: { label: string; min: number; max?: number; step: number } = simulationNumberRules[field];
  if (!Number.isFinite(value)) return `${rule.label}: Bitte geben Sie eine gültige Zahl ein.`;
  if (value < rule.min || (rule.max !== undefined && value > rule.max)) {
    return rule.max === undefined
      ? `${rule.label}: Der Wert muss mindestens ${rule.min} sein.`
      : `${rule.label}: Der Wert muss zwischen ${rule.min} und ${rule.max} liegen.`;
  }
  const steps = (value - rule.min) / rule.step;
  if (Math.abs(steps - Math.round(steps)) > 0.000001) {
    return `${rule.label}: Bitte geben Sie einen Wert in Schritten von ${rule.step.toLocaleString('de-DE')} ein.`;
  }
  return null;
}

export function simulationInputErrors(
  values: SimulationNumberValues,
  { sideBusiness, includeChurchTax }: { sideBusiness: boolean; includeChurchTax: boolean },
): string[] {
  return (Object.keys(simulationNumberRules) as SimulationNumberField[]).flatMap(field => {
    if (!sideBusiness && (field === 'grossSalary' || field === 'employeeExpenses')) return [];
    if (!includeChurchTax && field === 'churchTaxRate') return [];
    const error = simulationNumberError(field, values[field]);
    return error ? [error] : [];
  });
}
