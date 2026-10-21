import { createHash } from 'node:crypto';
import type { ReminderBalanceSnapshot } from '@/lib/reminder-workbench';

export const REMINDER_BALANCE_SCHEMA_VERSION = '20261021090000_reminder_balance_snapshot';
const fields = new Set(['id', 'invoiceId', 'reminderLevel', 'sentAt', 'dueDate', 'fee', 'notes', 'createdAt', 'userId', 'idempotencyKey', 'balanceSnapshot']);
const validCents = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,15})$/u.test(value);

/** Historical confirmation evidence, not a fresh authorization to send after restore. */
export function validateReminderBackupFields(reminder: Record<string, unknown>, supportsBalance: boolean, label: string): void {
  for (const field of Object.keys(reminder)) if (!fields.has(field)) throw new Error(`${label}: Nicht unterstütztes Mahnfeld; Wiederherstellung würde Daten verlieren.`);
  if (!supportsBalance && (reminder.idempotencyKey != null || reminder.balanceSnapshot != null)) throw new Error(`${label}: Älteres Backupschema unterstützt keine Restbetragsbestätigung.`);
  if (reminder.idempotencyKey != null && (typeof reminder.idempotencyKey !== 'string' || !/^[A-Za-z0-9:_-]{8,128}$/u.test(reminder.idempotencyKey))) throw new Error(`${label}.idempotencyKey ist ungültig.`);
  if (reminder.balanceSnapshot == null) {
    if (reminder.idempotencyKey != null) throw new Error(`${label}: Wiederholungsschlüssel ohne bestätigten Restbetrag.`);
    return;
  }
  if (!Number.isSafeInteger(reminder.id) || Number(reminder.id) <= 0) throw new Error(`${label}: Bestätigte Mahnung benötigt eine stabile Quell-ID.`);
  if (typeof reminder.idempotencyKey === 'string' && reminder.idempotencyKey.startsWith('restored:') && !/^restored:[a-f0-9]{64}$/u.test(reminder.idempotencyKey)) throw new Error(`${label}: Ungültige Wiederherstellungs-Identität.`);
  const value = reminder.balanceSnapshot;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}.balanceSnapshot ist ungültig.`);
  const snapshot = value as Record<string, unknown>;
  const allowed = new Set(['version', 'balanceVersion', 'totalCents', 'paidCents', 'openCents', 'paymentHistory', 'dueDays']);
  if (Object.keys(snapshot).some(field => !allowed.has(field)) || snapshot.version !== 1 || typeof snapshot.balanceVersion !== 'string' || !/^[a-f0-9]{64}$/u.test(snapshot.balanceVersion)
    || !validCents(snapshot.totalCents) || !validCents(snapshot.paidCents) || !validCents(snapshot.openCents) || BigInt(snapshot.openCents) <= BigInt(0)
    || BigInt(snapshot.totalCents) !== BigInt(snapshot.paidCents) + BigInt(snapshot.openCents)
    || !Number.isInteger(snapshot.dueDays) || Number(snapshot.dueDays) < 1 || Number(snapshot.dueDays) > 365
    || !Array.isArray(snapshot.paymentHistory)) throw new Error(`${label}.balanceSnapshot enthält keinen konsistenten Restbetrag.`);
  let sum = BigInt(0);
  for (const entry of snapshot.paymentHistory) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${label}: Ungültiger Zahlungsverlauf.`);
    const payment = entry as Record<string, unknown>;
    if (Object.keys(payment).some(field => !['amountCents', 'paidAt', 'reference'].includes(field)) || !validCents(payment.amountCents) || BigInt(payment.amountCents) <= BigInt(0)
      || typeof payment.reference !== 'string' || !payment.reference.trim() || payment.reference.length > 255
      || typeof payment.paidAt !== 'string' || !Number.isFinite(new Date(payment.paidAt).getTime()) || new Date(payment.paidAt).toISOString() !== payment.paidAt) throw new Error(`${label}: Ungültiger Zahlungsverlauf.`);
    sum += BigInt(payment.amountCents);
  }
  if (sum !== BigInt(snapshot.paidCents)) throw new Error(`${label}: Zahlungsverlauf und bestätigter Betrag widersprechen sich.`);
}

/** Portable immutable source identity: exports/timestamps must not duplicate the same confirmed row. */
export function restoredReminderKey(sourceKey: string | null, sourceTenant: string | undefined, sourceId: number) {
  if (!sourceTenant?.trim() || !Number.isSafeInteger(sourceId) || sourceId <= 0) throw new Error('Bestätigte Mahnung benötigt stabile Quellherkunft.');
  if (sourceKey?.startsWith('restored:')) {
    if (!/^restored:[a-f0-9]{64}$/u.test(sourceKey)) throw new Error('Ungültige Wiederherstellungs-Identität.');
    return sourceKey;
  }
  return `restored:${createHash('sha256').update(JSON.stringify([sourceTenant, sourceId, sourceKey])).digest('hex')}`;
}

export type HistoricalReminderSnapshot = ReminderBalanceSnapshot & { dueDays: number };
