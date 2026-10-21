import type { AuditLog, Invoice, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { HISTORY_ACTIONS, historyStatusLabel, type HistoryAction, type HistoryDocument, type HistoryEvent } from './invoice-history-contract';

export class HistoryInputError extends Error {}
export type HistoryQuery = { invoiceId?: number; page: number; limit: number; search: string; action?: HistoryAction; from?: Date; until?: Date };
function positive(value: string | null, fallback?: number): number {
  if (value === null && fallback !== undefined) return fallback;
  if (!value || !/^[1-9]\d{0,8}$/.test(value) || !Number.isSafeInteger(Number(value))) throw new HistoryInputError('Ungültige Seitennummer oder Dokument-ID.');
  return Number(value);
}
function date(value: string | null): Date | undefined {
  if (value === null) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HistoryInputError('Bitte ein gültiges Datum im Format JJJJ-MM-TT wählen.');
  const result = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== value || value < '1900-01-01' || value > '9998-12-31') throw new HistoryInputError('Ungültiges Kalenderdatum.');
  return result;
}
export function parseHistoryQuery(params: URLSearchParams): HistoryQuery {
  const keys = new Set(['invoiceId', 'page', 'limit', 'search', 'action', 'from', 'to']);
  for (const key of params.keys()) if (!keys.has(key) || params.getAll(key).length !== 1) throw new HistoryInputError('Nicht unterstützter oder mehrfacher Filter.');
  const page = positive(params.get('page'), 1), limit = positive(params.get('limit'), 20);
  if (page > 100_000 || limit > 50) throw new HistoryInputError('Seite oder Seitengröße zu groß.');
  const search = (params.get('search') ?? '').trim();
  if (search.length > 100 || /[\u0000-\u001f]/u.test(search)) throw new HistoryInputError('Suchbegriff ist zu lang oder ungültig.');
  const action = params.get('action');
  if (action !== null && !HISTORY_ACTIONS.includes(action as HistoryAction)) throw new HistoryInputError('Nicht unterstützte Aktion.');
  const from = date(params.get('from')), to = date(params.get('to'));
  if (from && to && from > to) throw new HistoryInputError('Das Enddatum liegt vor dem Startdatum.');
  return { invoiceId: params.has('invoiceId') ? positive(params.get('invoiceId')) : undefined, page, limit, search,
    action: action === null ? undefined : action as HistoryAction, from, until: to ? new Date(to.getTime() + 86_400_000) : undefined };
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown, limit = 200): string | null {
  return typeof value === 'string' && value.trim() ? value.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, limit) : null;
}
const docSelect = { id: true, invoiceNumber: true, type: true, status: true, issuanceState: true, invoiceDate: true, uploadedAt: true,
  totalAmount: true, parsedData: true, cancellationReason: true, originalInvoiceId: true } satisfies Prisma.InvoiceSelect;
type DocumentRow = Pick<Invoice, keyof typeof docSelect>;
export function historyDocument(row: DocumentRow, allowedIds: Set<number>): HistoryDocument {
  const parsed = object(row.parsedData);
  return { id: row.id, invoiceNumber: text(row.invoiceNumber), type: row.type, status: row.status, issuanceState: row.issuanceState,
    invoiceDate: row.invoiceDate?.toISOString() ?? null, uploadedAt: row.uploadedAt.toISOString(),
    totalAmount: typeof row.totalAmount === 'number' && Number.isFinite(row.totalAmount) ? row.totalAmount : null,
    currency: typeof parsed.currency === 'string' && /^[A-Z]{3}$/.test(parsed.currency) ? parsed.currency : null,
    taxMode: parsed.taxMode === 'small-business' || parsed.taxMode === 'standard' ? parsed.taxMode : null,
    cancellationReason: text(row.cancellationReason, 1000), originalInvoiceId: row.originalInvoiceId !== null && allowedIds.has(row.originalInvoiceId) ? row.originalInvoiceId : null };
}
const fields: [string, string, (value: unknown) => string | null][] = [
  ['status', 'Status', historyStatusLabel],
  ['issuanceState', 'Ausstellungsnachweis', value => value === 'UNKNOWN' ? 'Unbekannt' : value === 'UNISSUED' ? 'Nicht ausgestellt' : value === 'ISSUED' ? 'Ausgestellt' : null],
  ['paidAt', 'Zahlungsdatum (Statusfeld)', value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null],
  ['totalAmount', 'Dokumentbetrag', value => typeof value === 'number' && Number.isFinite(value) ? String(value) : null],
];
export function historyEvent(row: Pick<AuditLog, 'id' | 'userId' | 'entityId' | 'action' | 'createdAt' | 'oldValues' | 'newValues' | 'metadata'>): HistoryEvent {
  const before = object(row.oldValues), after = object(row.newValues), metadata = object(row.metadata);
  const changes = fields.flatMap(([field, label, format]) => {
    const oldValue = Object.hasOwn(before, field) ? format(before[field]) : null;
    const newValue = Object.hasOwn(after, field) ? format(after[field]) : null;
    return oldValue !== newValue ? [{ field, label, before: oldValue, after: newValue }] : [];
  });
  return { id: row.id, documentId: Number(row.entityId), action: row.action as HistoryAction, createdAt: row.createdAt.toISOString(),
    actor: metadata.actorId === undefined || metadata.actorId === row.userId ? 'ACCOUNT_RECORDED' : 'UNKNOWN', changes };
}
const pagination = (query: HistoryQuery, total: number) => ({ page: query.page, pageSize: query.limit, total, totalPages: Math.ceil(total / query.limit) });

/** All reads, including relation traversal, are scoped to the current owner, also for ADMIN. */
export async function readInvoiceHistory(userId: string, query: HistoryQuery) {
  if (!query.invoiceId) {
    const where: Prisma.InvoiceWhereInput = { userId, type: { in: ['INVOICE', 'CREDIT_NOTE'] }, ...(query.search ? { invoiceNumber: { contains: query.search } } : {}) };
    const [rows, total] = await prisma.$transaction([
      prisma.invoice.findMany({ where, select: docSelect, orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }),
      prisma.invoice.count({ where }),
    ]);
    // List rows are not relationship evidence; details resolve their owner-scoped family.
    return { kind: 'list' as const, documents: rows.map(row => historyDocument(row, new Set())), pagination: pagination(query, total) };
  }
  const selected = await prisma.invoice.findFirst({ where: { id: query.invoiceId, userId, type: { in: ['INVOICE', 'CREDIT_NOTE'] } }, select: docSelect });
  if (!selected) return null;
  const parent = selected.originalInvoiceId === null ? null : await prisma.invoice.findFirst({ where: { id: selected.originalInvoiceId, userId, type: 'INVOICE' }, select: docSelect });
  const root = parent ?? selected;
  const family = await prisma.invoice.findMany({ where: { userId, OR: [{ id: root.id }, { originalInvoiceId: root.id, type: 'CREDIT_NOTE' }] }, select: docSelect, orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }] });
  const ids = family.map(row => String(row.id));
  const where: Prisma.AuditLogWhereInput = { userId, entityType: { in: ['Invoice', 'CreditNote'] }, entityId: { in: ids }, action: query.action ?? { in: [...HISTORY_ACTIONS] },
    ...(query.from || query.until ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.until ? { lt: query.until } : {}) } } : {}) };
  const [events, total, payments, paymentCount] = await prisma.$transaction([
    prisma.auditLog.findMany({ where, select: { id: true, userId: true, entityId: true, action: true, createdAt: true, oldValues: true, newValues: true, metadata: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }),
    prisma.auditLog.count({ where }),
    prisma.paymentJournalEvent.findMany({ where: { userId, invoiceId: root.id }, select: { id: true, amountCents: true, currency: true, paidAt: true, dateCertainty: true, source: true }, orderBy: { id: 'desc' }, take: 50 }),
    prisma.paymentJournalEvent.count({ where: { userId, invoiceId: root.id } }),
  ]);
  const allowedIds = new Set(family.map(row => row.id));
  return { kind: 'detail' as const, selectedId: selected.id, originalId: root.id, missingOriginal: selected.type === 'CREDIT_NOTE' && parent === null,
    documents: family.map(row => historyDocument(row, allowedIds)), events: events.map(historyEvent), pagination: pagination(query, total),
    payments: payments.map(row => ({ ...row, paidAt: row.paidAt?.toISOString() ?? null })), paymentCount };
}
