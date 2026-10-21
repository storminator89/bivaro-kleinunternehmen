/** Manual duration is integer minutes, never inferred from legacy quantities. */
export const MAX_SERVICE_DURATION_MINUTES = 60_000;
export const SERVICE_DURATION_QUANTITY_DECIMALS = 12;

export class ServiceDurationError extends Error {
  constructor(message = 'Dauer als HH:MM eingeben, z. B. 01:30 (1 bis 60.000 Minuten).') {
    super(message);
    this.name = 'ServiceDurationError';
  }
}

export function validateDurationMinutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAX_SERVICE_DURATION_MINUTES) {
    throw new ServiceDurationError();
  }
  return value;
}

export function parseManualDuration(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{2,4}:[0-5]\d$/.test(value)) throw new ServiceDurationError();
  const [hours, minutes] = value.split(':').map(Number);
  return validateDurationMinutes(hours * 60 + minutes);
}

/**
 * Half-up to twelve decimal hours, the existing invoice engine's precision.
 * Integer arithmetic keeps repeating fractions deterministic at every boundary.
 * This is a rounded quantity, not an exact decimal representation of minutes/60.
 * Monetary multiplication and per-line cent rounding remain the invoice engine's job.
 */
export function durationToQuantity(minutes: number): number {
  validateDurationMinutes(minutes);
  const scale = BigInt(10) ** BigInt(SERVICE_DURATION_QUANTITY_DECIMALS);
  const rounded = (BigInt(minutes) * scale + BigInt(30)) / BigInt(60);
  const whole = rounded / scale;
  const fraction = (rounded % scale).toString().padStart(SERVICE_DURATION_QUANTITY_DECIMALS, '0');
  return Number(`${whole}.${fraction}`);
}

/** Totals can exceed the per-entry limit; zero is valid only for display. */
export function formatManualDuration(minutes: number): string {
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw new ServiceDurationError('Ungültige Dauersumme.');
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function summarizeServiceDuration(notes: readonly { durationMinutes?: number | null }[]) {
  let durationMinutes = 0;
  let quantityOnlyCount = 0;
  for (const note of notes) {
    if (note.durationMinutes == null) quantityOnlyCount += 1;
    else durationMinutes += validateDurationMinutes(note.durationMinutes);
  }
  if (!Number.isSafeInteger(durationMinutes)) throw new ServiceDurationError('Dauersumme ist zu groß.');
  return { durationMinutes, quantityOnlyCount };
}
