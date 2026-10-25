import { createBackupManifest as createManifest } from '@/lib/backup-manifest';
/** Current-format synthetic fixtures explicitly include the additive empty collections. */
export function createBackupManifest(options: Parameters<typeof createManifest>[0]) {
  if (Array.isArray(options.data.purchaseDocuments)) for (const document of options.data.purchaseDocuments) {
    if (!['supplierTaskKind', 'supplierTaskFollowUpDate', 'supplierTaskConfirmationRequired'].some(field => Object.hasOwn(document, field))) {
      document.supplierTaskKind = null; document.supplierTaskFollowUpDate = null; document.supplierTaskConfirmationRequired = false;
    }
  }
  if (Array.isArray(options.data.paymentJournalEvents)) for (const root of options.data.paymentJournalEvents) root.bankPaymentBindingStableKey ??= null;
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
