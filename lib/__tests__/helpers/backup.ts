import { createBackupManifest as createManifest } from '@/lib/backup-manifest';
/** Current-format synthetic fixtures explicitly include the additive empty collections. */
export function createBackupManifest(options: Parameters<typeof createManifest>[0]) {
  options.data.paymentAdjustments ??= [];
  options.data.paymentOperations ??= [];
  return createManifest(options);
}
