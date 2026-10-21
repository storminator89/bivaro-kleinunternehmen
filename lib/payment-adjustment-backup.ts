import { Prisma } from '@prisma/client';
import { backupSchemaSupportsPaymentAdjustments } from '@/lib/backup-manifest';
import { validateAdjustmentEvidence, evidenceDate, financialHash } from '@/lib/payment-journal/adjustment-evidence';
import { reducePaymentLedger } from '@/lib/payment-journal/adjustment-contract';
import { exactPaymentCents, paymentText } from '@/lib/payment-journal/contract';
type Row = Record<string, unknown>;
const rows = (data: Row, key: string): Row[] => {
  if (data[key] === undefined) return [];
  if (!Array.isArray(data[key]) || (data[key] as unknown[]).some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error(`Ungültige ${key}.`);
  return data[key] as Row[];
};
const adjustmentFields = new Set(['id','userId','invoiceId','originalPaymentId','kind','amountCents','currency','actionDate','accountingEffectiveOn','reason','reference','payoutEvidenceIdentity','cancellationInvoiceId','basisSnapshot','idempotencyKey','semanticFingerprint','contractVersion','recordedAt']);
const rootFields = new Set(['id','userId','invoiceId','incomeId','amountCents','currency','paidAt','dateCertainty','source','reference','idempotencyKey','createdAt']);
function closed(row: Row, fields: Set<string>, label: string) { if (Object.keys(row).some(key => !fields.has(key))) throw new Error(`${label}: unbekannte Felder würden Zahlungsnachweise verlieren.`); }
export function paymentAdjustmentValues(row: Row) {
  return { kind: String(row.kind), amountCents: String(row.amountCents), currency: 'EUR', actionDate: evidenceDate(row.actionDate),
    accountingEffectiveOn: evidenceDate(row.accountingEffectiveOn), reason: String(row.reason), reference: String(row.reference),
    payoutEvidenceIdentity: row.payoutEvidenceIdentity == null ? null : String(row.payoutEvidenceIdentity),
    basisSnapshot: row.basisSnapshot == null ? Prisma.DbNull : row.basisSnapshot as Prisma.InputJsonValue,
    idempotencyKey: String(row.idempotencyKey), semanticFingerprint: String(row.semanticFingerprint), contractVersion: 2, recordedAt: evidenceDate(row.recordedAt) };
}
export function sameAdjustmentEvidence(a: Row, b: Row) {
  const omitLocal = ({ id: _id, userId: _userId, invoiceId: _invoiceId, originalPaymentId: _root, cancellationInvoiceId: _basis, ...rest }: Row) => {
    void _id; void _userId; void _invoiceId; void _root; void _basis; return rest;
  };
  return financialHash(omitLocal(a)) === financialHash(omitLocal(b)) && (a.cancellationInvoiceId == null) === (b.cancellationInvoiceId == null);
}
/** No legacy/future identity can silently shed adjustment evidence. */
export function validatePaymentAdjustmentBackup(data: Row, schemaVersion?: string) {
  const adjustments = rows(data, 'paymentAdjustments'), operations = rows(data, 'paymentOperations'), roots = rows(data, 'paymentJournalEvents');
  for (const root of roots) closed(root, rootFields, 'paymentJournalEvents');
  if (!backupSchemaSupportsPaymentAdjustments(schemaVersion)) {
    if (data.paymentAdjustments !== undefined || data.paymentOperations !== undefined) throw new Error('Altes Backupschema unterstützt keine Zahlungsberichtigungsfelder.');
    return;
  }
  if (!Array.isArray(data.paymentAdjustments) || !Array.isArray(data.paymentOperations)) throw new Error('Aktuelles Backupschema benötigt beide Zahlungsberichtigungs- und Finanzaktionsabschnitte.');
  const source = (data.user as Row | undefined)?.id;
  const invoices = rows(data, 'invoices'), incomes = rows(data, 'incomes'), cash = rows(data, 'cashTransactions');
  const operationByKey = new Map<string, Row>();
  for (const operation of operations) {
    closed(operation, new Set(['id','userId','idempotencyKey','kind','createdAt']), 'paymentOperations');
    const key = paymentText(operation.idempotencyKey, 'Aktionsschlüssel', 128);
    if (operationByKey.has(key) || (operation.userId !== undefined && operation.userId !== source) || !['PAYMENT_RECEIVED','PAYMENT_CORRECTION','CUSTOMER_REFUND'].includes(String(operation.kind))) throw new Error('Doppelte, fremde oder ungültige Finanzaktionsidentität.');
    evidenceDate(operation.createdAt); operationByKey.set(key, operation);
    const events = operation.kind === 'PAYMENT_RECEIVED' ? roots : adjustments;
    if (events.filter(row => row.idempotencyKey === key && (operation.kind === 'PAYMENT_RECEIVED' || row.kind === operation.kind)).length !== 1) throw new Error('Verwaiste oder widersprüchliche Finanzaktionsidentität.');
  }
  const keys = new Set(roots.map(root => String(root.idempotencyKey))), payouts = new Set<string>();
  for (const adjustment of adjustments) {
    closed(adjustment, adjustmentFields, 'paymentAdjustments');
    const key = String(adjustment.idempotencyKey);
    if (keys.has(key) || operationByKey.get(key)?.kind !== adjustment.kind) throw new Error('Zahlungsberichtigung ohne eindeutigen passenden Finanzaktionsbeleg.');
    keys.add(key);
    if (adjustment.payoutEvidenceIdentity != null) {
      if (payouts.has(String(adjustment.payoutEvidenceIdentity))) throw new Error('Auszahlungsnachweis doppelt.');
      payouts.add(String(adjustment.payoutEvidenceIdentity));
    }
    const audit = rows(data, 'auditLogs').some(row => {
      let values = row.newValues;
      if (typeof values === 'string') { try { values = JSON.parse(values); } catch { return false; } }
      if (!values || typeof values !== 'object' || Array.isArray(values)) return false;
      const payload = values as Row;
      let metadata = row.metadata;
      if (typeof metadata === 'string') { try { metadata = JSON.parse(metadata); } catch { return false; } }
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
      const context = metadata as Row;
      if (row.userId !== source || row.entityType !== 'Invoice' || row.entityId !== String(adjustment.invoiceId)
        || context.actorId !== source || context.tenantId !== source || typeof context.operation !== 'string'
        || typeof context.originalReference !== 'string' || !context.originalReference.trim() || typeof context.reason !== 'string' || !context.reason.trim()) return false;
      evidenceDate(row.createdAt);
      return (row.action === adjustment.kind || row.action === 'RESTORE') && payload.paymentAdjustmentId === adjustment.id
        && payload.originalPaymentId === adjustment.originalPaymentId && payload.kind === adjustment.kind && payload.amountCents === adjustment.amountCents;
    });
    if (!audit) throw new Error('Verpflichtender Finanzprüfnachweis der Zahlungsberichtigung fehlt.');
    const invoice = invoices.find(row => row.id === adjustment.invoiceId);
    if (!invoice) throw new Error('Rechnung der Berichtigung fehlt.');
    const invoiceRoots = roots.filter(root => root.invoiceId === invoice.id);
    for (const root of invoiceRoots) {
      const income = incomes.find(row => row.id === root.incomeId);
      if (!income || income.invoiceId !== invoice.id || (income.customerId ?? null) !== (invoice.customerId ?? null) || exactPaymentCents(income.amount as number).toString() !== root.amountCents
        || evidenceDate(income.date).getTime() !== evidenceDate(root.paidAt).getTime()) throw new Error('Originalzahlung und Einnahme der Berichtigung widersprechen sich.');
    }
    if (incomes.filter(row => row.invoiceId === invoice.id).length !== invoiceRoots.length) throw new Error('Ungeklärte Einnahme einer berichtigten Rechnung.');
  }
  for (const invoice of invoices) {
    const selected = adjustments.filter(row => row.invoiceId === invoice.id);
    if (!selected.length) continue;
    const normalized = { ...invoice, userId: source };
    const invoiceRoots = roots.filter(root => root.invoiceId === invoice.id);
    validateAdjustmentEvidence(normalized, invoiceRoots, selected, invoices,
      new Set(cash.filter(row => row.incomeId != null).map(row => Number(row.incomeId))));
    reducePaymentLedger(invoice.totalAmount as number, invoiceRoots as unknown as Parameters<typeof reducePaymentLedger>[1], selected as unknown as Parameters<typeof reducePaymentLedger>[2], String(invoice.status));
  }
}
