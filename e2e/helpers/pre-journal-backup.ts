import { createHash } from 'node:crypto';
import type { BackupManifest } from '../../lib/backup-manifest';

// A genuine frozen pre-journal fixture must not load current runtime validators
// (including Next's server-only boundary) during plain Node E2E discovery.
const historicalCoverage = [
  { model: 'User', key: 'user', mode: 'metadata-only' as const, reason: 'Identity and password remain target-owned.' },
  { model: 'AppSettings', key: 'appSettings', mode: 'excluded' as const, reason: 'Host-wide bootstrap setting, not tenant data.' },
  { model: 'SmtpSettings', key: 'smtpSettings', mode: 'excluded' as const, reason: 'Host-wide SMTP override and encrypted credential material are never backed up.' },
  { model: 'RateLimitBucket', key: 'rateLimitBuckets', mode: 'excluded' as const, reason: 'Operational runtime state is not restorable business data.' },
  { model: 'Customer', key: 'customers', mode: 'included' as const },
  { model: 'Supplier', key: 'suppliers', mode: 'included' as const },
  { model: 'Expense', key: 'expenses', mode: 'included' as const },
  { model: 'Income', key: 'incomes', mode: 'included' as const },
  { model: 'Invoice', key: 'invoices', mode: 'included' as const },
  { model: 'PurchaseDocument', key: 'purchaseDocuments', mode: 'included' as const },
  { model: 'Settings', key: 'settings', mode: 'included' as const },
  { model: 'InvoiceTemplate', key: 'templates', mode: 'included' as const },
  { model: 'RecurringExpense', key: 'recurringExpenses', mode: 'included' as const },
  { model: 'Reminder', key: 'reminders', mode: 'included' as const },
  { model: 'BillingNote', key: 'billingNotes', mode: 'included' as const },
  { model: 'ApiKey', key: 'apiKeys', mode: 'metadata-only' as const, reason: 'Hash and usable secret are deliberately excluded; re-key required.' },
  { model: 'ApiLog', key: 'apiLogs', mode: 'excluded' as const, reason: 'Operational API telemetry is not tenant business state.' },
  { model: 'AuditLog', key: 'auditLogs', mode: 'included' as const, reason: 'Appended as a provenance-preserving audit segment.' },
  { model: 'CashBook', key: 'cashBooks', mode: 'included' as const },
  { model: 'CashTransaction', key: 'cashTransactions', mode: 'included' as const },
  { model: 'Documentation', key: 'documentations', mode: 'included' as const },
  { model: 'InvoiceNumberCounter', key: 'invoiceNumberCounters', mode: 'included' as const, reason: 'High-water marks are merged by maximum.' },
] as const;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function hash(value: unknown) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function historicalManifest(data: Record<string, unknown>, sourceUserId: string): BackupManifest {
  // Genuine historical fixtures have no task capability. Only empty future
  // defaults may be stripped; never discard a real task to relabel an export.
  if (Array.isArray(data.purchaseDocuments)) for (const document of data.purchaseDocuments) {
    if (document.supplierTaskKind != null || document.supplierTaskFollowUpDate != null || (document.supplierTaskConfirmationRequired !== false && document.supplierTaskConfirmationRequired !== undefined)) throw new Error('Pre-journal fixture cannot contain supplier task evidence.');
    delete document.supplierTaskKind; delete document.supplierTaskFollowUpDate; delete document.supplierTaskConfirmationRequired;
  }
  const generatedAt = '2025-03-18T00:00:00.000Z', auditLogs = data.auditLogs ?? [], counters = data.invoiceNumberCounters ?? [];
  return {
    format: 'bivaro-backup', version: '3.0', schemaVersion: '20261020223000_add_suppliers_and_purchase_booking',
    backupId: hash({ sourceUserId, generatedAt, auditLogs, counters }), sourceUserId, generatedAt,
    excludesSecrets: true,
    excludedSecretFields: ['User.password', 'ApiKey.keyHash', 'ApiKey.secret', 'AiProviderSettings.keyCiphertext', 'AiProviderSettings.keyIv', 'AiProviderSettings.keyTag'],
    rekeyRequired: ['ApiKey'],
    modelCoverage: historicalCoverage.map(entry => {
      const value = data[entry.key];
      return { ...entry, count: Array.isArray(value) ? value.length : value && typeof value === 'object' ? 1 : 0,
        ...(entry.mode === 'excluded' ? {} : { sha256: value == null ? undefined : hash(value) }) };
    }),
    auditSegment: { key: 'auditLogs', count: Array.isArray(auditLogs) ? auditLogs.length : 0, sha256: hash(auditLogs), restoreMode: 'append-only' },
    invoiceNumberCounters: { key: 'invoiceNumberCounters', count: Array.isArray(counters) ? counters.length : 0, sha256: hash(counters), highWaterMark: 'max-existing-imported-historical' },
    fileManifest: [],
  };
}


const historicalDate = '2025-03-17T00:00:00.000Z';

export function preJournalBackup(version: '2.0' | '3.0', invoiceNumber: string | null = null, withIncome = true) {
  const sourceUserId = 'synthetic-pre-journal-source';
  const data = {
    user: { id: sourceUserId, email: 'source@example.test', name: 'Synthetic old backup' },
    customers: [], suppliers: [], purchaseDocuments: [], expenses: [],
    invoices: [{ id: 91, type: 'INVOICE', invoiceNumber, fileName: 'historical-paid.pdf', storedFileName: 'historical-paid.pdf',
      uploadedAt: '2025-03-01T00:00:00.000Z', invoiceDate: '2025-03-01T00:00:00.000Z', status: 'PAID',
      totalAmount: 123.45, parsedData: { currency: 'EUR' } }],
    incomes: withIncome ? [{ id: 92, invoiceId: 91, description: 'Original historical payment', amount: 123.45, date: historicalDate, taxRelevant: true }] : [],
    templates: [], billingNotes: [], recurringExpenses: [], reminders: [], cashBooks: [], cashTransactions: [],
    documentations: [], apiKeys: [], auditLogs: [], invoiceNumberCounters: [],
  };
  const manifest = historicalManifest(data, sourceUserId);
  return { version, type: 'json', exportedAt: '2025-03-18T00:00:00.000Z', data, ...(version === '3.0' ? { manifest } : {}) };
}
