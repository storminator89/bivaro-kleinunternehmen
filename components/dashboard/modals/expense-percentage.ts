/** Missing legacy values mean fully deductible; a real zero must stay zero. */
export function expensePercentageInput(value: number | null | undefined): string {
  return String(value ?? 100);
}

/** Do not turn an empty/invalid draft into either 0% or 100%. */
export function parseExpensePercentage(value: string): number | null {
  if (value.trim() === '') return null;
  const percentage = Number(value);
  return Number.isFinite(percentage) && Number.isInteger(percentage) && percentage >= 0 && percentage <= 100
    ? percentage
    : null;
}

export const EXPENSE_PERCENTAGE_ERROR = 'Bitte geben Sie eine ganze Zahl zwischen 0 und 100 ein.';
