import { PurchaseDocumentError } from './errors';
import type { SupplierTask, SupplierTaskKind } from './types';

export const SUPPLIER_TASK_KINDS = ['PAYMENT_CHECK', 'DIRECT_DEBIT_WAIT', 'CLARIFY'] as const;
export const SUPPLIER_TASK_LABELS: Record<SupplierTaskKind, string> = {
  PAYMENT_CHECK: 'Zahlung prüfen', DIRECT_DEBIT_WAIT: 'Abbuchung abwarten', CLARIFY: 'Sachverhalt klären',
};
/** Calendar-only; never normalize rollover days or infer from other document dates. */
export function isSupplierTaskDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01' || value > '9999-12-31') return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function parseSupplierTask(value: unknown): Omit<SupplierTask, 'confirmationRequired'> | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PurchaseDocumentError('Vormerkung ist ungültig.');
  const task = value as Record<string, unknown>;
  if (Object.keys(task).length !== 2 || !Object.hasOwn(task, 'kind') || !Object.hasOwn(task, 'followUpDate') || !SUPPLIER_TASK_KINDS.includes(task.kind as SupplierTaskKind)
    || (task.followUpDate !== null && !isSupplierTaskDay(task.followUpDate))) throw new PurchaseDocumentError('Bitte eine gültige Aufgabenart und einen echten Kalendertag (JJJJ-MM-TT) oder kein Datum wählen.');
  return { kind: task.kind as SupplierTaskKind, followUpDate: task.followUpDate as string | null };
}
export type SupplierTaskColumns = { supplierTaskKind: string | null; supplierTaskFollowUpDate: string | null; supplierTaskConfirmationRequired: boolean };
export function supplierTaskDto(document: SupplierTaskColumns): SupplierTask | null {
  const { supplierTaskKind: kind, supplierTaskFollowUpDate: followUpDate, supplierTaskConfirmationRequired: confirmationRequired } = document;
  if (kind === null) {
    if (followUpDate !== null || confirmationRequired !== false) throw new PurchaseDocumentError('Vormerkung ist inkonsistent.', 409, 'SOURCE_STATE');
    return null;
  }
  let parsed: ReturnType<typeof parseSupplierTask>;
  try { parsed = parseSupplierTask({ kind, followUpDate }); } catch { throw new PurchaseDocumentError('Vormerkung ist inkonsistent.', 409, 'SOURCE_STATE'); }
  if (typeof confirmationRequired !== 'boolean') throw new PurchaseDocumentError('Vormerkung ist inkonsistent.', 409, 'SOURCE_STATE');
  return { ...parsed!, confirmationRequired };
}
const berlinDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Supplied instant is for pure tests only. HTTP never accepts a clock override. */
export function supplierTaskBerlinDay(instant: Date = new Date()): string {
  const parts = berlinDayFormat.formatToParts(instant);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}
export type SupplierTaskFilters = { kind: SupplierTaskKind | 'any' | null; due: 'any' | 'due' | 'later' | 'undated'; today: string };
export function parseSupplierTaskFilters(params: URLSearchParams, instant: Date = new Date()): SupplierTaskFilters {
  const rawKind = params.get('taskKind');
  const rawDue = params.get('taskDue') ?? 'any';
  if (rawKind !== null && rawKind !== 'all' && rawKind !== 'any' && !SUPPLIER_TASK_KINDS.includes(rawKind as SupplierTaskKind)) throw new PurchaseDocumentError('Ungültige Aufgabenart.');
  if (!['any', 'due', 'later', 'undated'].includes(rawDue)) throw new PurchaseDocumentError('Ungültiger Wiedervorlagefilter.');
  return { kind: rawKind === null || rawKind === 'all' ? null : rawKind as SupplierTaskKind | 'any', due: rawDue as SupplierTaskFilters['due'], today: supplierTaskBerlinDay(instant) };
}
