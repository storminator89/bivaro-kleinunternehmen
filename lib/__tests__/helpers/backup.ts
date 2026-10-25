import { createHash } from 'node:crypto';
import { createBackupManifest as createManifest } from '@/lib/backup-manifest';
/** Current-format synthetic fixtures explicitly include the additive empty collections. */
export function createBackupManifest(options: Parameters<typeof createManifest>[0]) {
  if (Array.isArray(options.data.purchaseDocuments)) for (const document of options.data.purchaseDocuments) {
    if (!['supplierTaskKind', 'supplierTaskFollowUpDate', 'supplierTaskConfirmationRequired'].some(field => Object.hasOwn(document, field))) {
      document.supplierTaskKind = null; document.supplierTaskFollowUpDate = null; document.supplierTaskConfirmationRequired = false;
    }
  }
  if (Array.isArray(options.data.paymentJournalEvents)) for (const root of options.data.paymentJournalEvents) root.bankPaymentBindingStableKey ??= null;
  // Synthetic CURRENT-format fixtures only. Preserve any explicit lifecycle
  // field (including null/invalid values) so negative cases remain negative.
  if (!Object.hasOwn(options.data, 'manualFinancialRecordEvents')) options.data.manualFinancialRecordEvents = [];
  for (const [key, kind] of [['incomes', 'income'], ['expenses', 'expense']] as const) {
    const collection = options.data[key];
    if (!Array.isArray(collection)) continue;
    for (const row of collection) {
      if (['manualRecordId', 'manualRecordState', 'manualRecordOrigin', 'manualRecordRevision'].some(field => Object.hasOwn(row, field))) continue;
      const hex = createHash('sha256').update(JSON.stringify([options.sourceUserId, kind, row.id])).digest('hex');
      row.manualRecordId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
      row.manualRecordState = 'LEGACY_UNREVIEWED'; row.manualRecordRevision = 0;
      const sources = Array.isArray(options.data.purchaseDocuments) ? options.data.purchaseDocuments : [];
      const payments = Array.isArray(options.data.paymentJournalEvents) ? options.data.paymentJournalEvents : [];
      const cash = Array.isArray(options.data.cashTransactions) ? options.data.cashTransactions : [];
      row.manualRecordOrigin = kind === 'income'
        ? payments.some(event => event.incomeId === row.id) ? 'PAYMENT_JOURNAL' : row.invoiceId != null ? 'INVOICE' : cash.some(entry => entry.incomeId === row.id) ? 'CASHBOOK' : 'LEGACY_UNKNOWN'
        : sources.some(source => source.expenseId === row.id) ? 'PURCHASE_DOCUMENT' : row.recurringExpenseId != null || row.scheduledDate != null ? 'RECURRING' : cash.some(entry => entry.expenseId === row.id) ? 'CASHBOOK' : 'LEGACY_UNKNOWN';
    }
  }
  options.data.bankMappingProfiles ??= [];
  options.data.bankMappingProfileRevisions ??= [];
  options.data.documentNumberingPolicies ??= [];
  options.data.quoteCreateReceipts ??= [];
  options.data.bankPaymentBindings ??= [];
  options.data.paymentAllocationChanges ??= [];
  options.data.bankImportBatches ??= [];
  options.data.bankImportRows ??= [];
  options.data.serviceProjects ??= [];
  if (Array.isArray(options.data.billingNotes)) for (const note of options.data.billingNotes) {
    note.projectId ??= null;
    note.durationMinutes ??= null;
    note.captureKey ??= null;
    note.captureFingerprint ??= null;
    note.deletedAt ??= null;
  }
  options.data.purchaseValidationReports ??= [];
  options.data.paymentAdjustments ??= [];
  options.data.paymentOperations ??= [];
  return createManifest(options);
}
