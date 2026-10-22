import { createBackupManifest as createManifest } from '@/lib/backup-manifest';
/** Current-format synthetic fixtures explicitly include the additive empty collections. */
export function createBackupManifest(options: Parameters<typeof createManifest>[0]) {
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
