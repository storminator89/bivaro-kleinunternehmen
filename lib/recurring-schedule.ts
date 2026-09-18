const INTERVAL_MONTHS: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };

function validate(interval: string, day: number, date: Date) {
  if (!INTERVAL_MONTHS[interval] || !Number.isInteger(day) || day < 1 || day > 31 || !Number.isFinite(date.getTime())) {
    throw new Error('Ungültiges Intervall, Datum oder ungültiger Monatstag');
  }
}

export function calculateNextExecution(interval: string, day: number, from: Date = new Date()): Date {
  validate(interval, day, from);
  // Start on day one so January 31 cannot overflow February before clamping.
  const next = new Date(from.getFullYear(), from.getMonth() + INTERVAL_MONTHS[interval], 1);
  next.setDate(Math.min(day, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
  return next;
}

export function firstExecution(interval: string, day: number, start: Date): Date {
  validate(interval, day, start);
  const first = new Date(start.getFullYear(), start.getMonth(), 1);
  first.setDate(Math.min(day, new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()));
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  return first < startDay ? calculateNextExecution(interval, day, first) : first;
}

export function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

export function validateRecurringValues(value: {
  amount: unknown; interval: unknown; dayOfMonth: unknown; taxDeductiblePercentage?: unknown;
  startDate?: unknown; endDate?: unknown; taxRelevant?: unknown; isActive?: unknown;
}): string | null {
  if (!Number.isFinite(Number(value.amount)) || Number(value.amount) <= 0 || Number(value.amount) > 1e12) return 'Ungültiger Betrag';
  if (typeof value.interval !== 'string' || !INTERVAL_MONTHS[value.interval.toUpperCase()]) return 'Ungültiges Intervall';
  const day = Number(value.dayOfMonth);
  if (!Number.isInteger(day) || day < 1 || day > 31) return 'Ungültiger Monatstag';
  const percentage = value.taxDeductiblePercentage == null ? 100 : Number(value.taxDeductiblePercentage);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) return 'Ungültiger Abzugsanteil';
  for (const field of [value.taxRelevant, value.isActive]) if (field !== undefined && typeof field !== 'boolean') return 'Ungültiger Wahrheitswert';
  const start = value.startDate == null ? new Date() : new Date(String(value.startDate));
  const end = value.endDate == null || value.endDate === '' ? null : new Date(String(value.endDate));
  if (!Number.isFinite(start.getTime()) || (end && (!Number.isFinite(end.getTime()) || endOfDay(end) < start))) return 'Ungültiger Zeitraum';
  return null;
}
