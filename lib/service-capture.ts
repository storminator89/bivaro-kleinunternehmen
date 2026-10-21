import { createHash } from 'node:crypto';
import { formatBusinessDate } from '@/lib/business-date';
import { BillingNoteInputError } from '@/lib/billing-notes';

export type ServiceCaptureSource = {
  customerId: number;
  projectId: number | null;
  serviceDate: Date | string;
  description: string;
  quantity: number;
  unit: string;
  durationMinutes: number | null;
};

export function parseServiceCaptureKey(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) {
    throw new BillingNoteInputError('Ungültiger Erfassungsschlüssel. Bitte den Bestand aktualisieren.');
  }
  return value;
}

/**
 * Versioned command identity. Never include mutable labels or invoice state.
 * Restore validates source IDs, then rebinds only customer/project IDs before
 * hashing the mapped target command; the UUID receipt identity stays stable.
 */
export function serviceCaptureFingerprint(note: ServiceCaptureSource): string {
  return createHash('sha256').update(JSON.stringify([
    'bivaro.service-capture.v1', note.customerId, note.projectId,
    formatBusinessDate(note.serviceDate), note.description, note.quantity,
    note.unit, note.durationMinutes,
  ])).digest('hex');
}
