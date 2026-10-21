import type { TimeRange } from '@/types/dashboard';

function numeric(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER; }
function csvCell(value: string): string {
  const safe = /^[\s]*[=+\-@]/u.test(value) ? `'${value}` : value;
  return /[;"\r\n]/u.test(safe) ? `"${safe.replace(/"/gu, '""')}"` : safe;
}
/** Only a newly guarded server response, never cached dashboard closure totals. */
export function buildEURCSVFromFreshSummary(value: unknown, timeRange: TimeRange): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Aktuelle EÜR-Daten sind nicht vollständig bestätigt. Es wurde keine CSV erzeugt.');
  const data = value as Record<string, unknown>;
  if (data.timeRange !== timeRange || !numeric(data.totalIncome) || !numeric(data.totalExpense) || !numeric(data.profit) || !Array.isArray(data.expenseCategories)) throw new Error('Aktuelle EÜR-Daten sind nicht vollständig bestätigt. Es wurde keine CSV erzeugt.');
  const categories = data.expenseCategories.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Aktuelle EÜR-Kategorien sind nicht bestätigt. Es wurde keine CSV erzeugt.');
    const item = value as Record<string, unknown>;
    if (typeof item.category !== 'string' || !numeric(item.amount)) throw new Error('Aktuelle EÜR-Kategorien sind nicht bestätigt. Es wurde keine CSV erzeugt.');
    return `${csvCell(item.category)};${item.amount.toFixed(2).replace('.', ',')}\n`;
  });
  const income = data.totalIncome.toFixed(2).replace('.', ','), expense = data.totalExpense.toFixed(2).replace('.', ','), profit = data.profit.toFixed(2).replace('.', ',');
  return `Kategorie;Betrag (EUR)\nBETRIEBSEINNAHMEN;\nEinnahmen (steuerpflichtig);${income}\nSumme Betriebseinnahmen;${income}\n\nBETRIEBSAUSGABEN;\n${categories.join('')}Summe Betriebsausgaben;${expense}\n\nGEWINN/VERLUST;${profit}\n`;
}
