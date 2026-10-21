import { createBackupManifest, PRE_PAYMENT_JOURNAL_SCHEMA_VERSION } from '../../lib/backup-manifest';

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
  const manifest = createBackupManifest({ sourceUserId, generatedAt: '2025-03-18T00:00:00.000Z', data });
  manifest.schemaVersion = PRE_PAYMENT_JOURNAL_SCHEMA_VERSION;
  // This synthetic source predates these models; never downgrade a real backup.
  manifest.modelCoverage = manifest.modelCoverage.filter(entry => !['PaymentJournalEvent', 'PaymentAdjustment', 'PaymentOperation', 'AiProviderSettings', 'ServiceArticle', 'DataImportBatch', 'ServiceBillingPlan', 'ServiceBillingPeriod', 'ServiceProject'].includes(entry.model));
  return { version, type: 'json', exportedAt: '2025-03-18T00:00:00.000Z', data, ...(version === '3.0' ? { manifest } : {}) };
}
