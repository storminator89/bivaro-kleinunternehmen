/**
 * Business dates are calendar dates, not instants in a user's local timezone.
 * They are persisted as UTC midnight so that a date such as 2026-12-31 does
 * not roll over when it crosses a timezone boundary.
 */

export const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class BusinessDateError extends Error {
  constructor(message = 'Invalid business date') {
    super(message);
    this.name = 'BusinessDateError';
  }
}

/** Parse only the deliberately narrow YYYY-MM-DD API contract. */
export function parseBusinessDate(value: unknown): Date {
  if (typeof value !== 'string' || !BUSINESS_DATE_PATTERN.test(value)) {
    throw new BusinessDateError('Business date must use YYYY-MM-DD');
  }

  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  // Construct from a known-safe year because Date.UTC treats 0..99 as
  // 1900..1999. setUTCFullYear preserves the four-digit input instead.
  const parsed = new Date(0);
  parsed.setUTCFullYear(year, month - 1, day);
  parsed.setUTCHours(0, 0, 0, 0);

  if (
    !Number.isInteger(year) ||
    year < 1 ||
    year > 9999 ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new BusinessDateError('Business date is not a valid calendar date');
  }

  return parsed;
}

/** Format a persisted business date without applying local timezone rules. */
export function formatBusinessDate(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new BusinessDateError('Invalid persisted business date');
  return [
    String(parsed.getUTCFullYear()).padStart(4, '0'),
    String(parsed.getUTCMonth() + 1).padStart(2, '0'),
    String(parsed.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/** Render a business date as a calendar value, independent of browser timezone. */
export function formatBusinessDateDisplay(value: Date | string): string {
  const [year, month, day] = formatBusinessDate(value).split('-');
  return `${day}.${month}.${year}`;
}

/** Format a form default using the browser's local calendar date. */
export function formatLocalBusinessDate(value: Date = new Date()): string {
  return [
    String(value.getFullYear()).padStart(4, '0'),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}
