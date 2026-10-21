import { backupSchemaSupportsAiExtraction, backupSchemaSupportsServiceBilling } from '@/lib/backup-manifest';
/** Construct a genuine pre-CSV fixture, rather than relabelling a future schema. */
export function stripCsvCatalogForLegacy(backup: { data: Record<string, unknown>; manifest: { schemaVersion?: string; modelCoverage: { model: string }[] } }) {
  stripEmptyPaymentAdjustmentsForLegacy(backup);
  stripEmptyAnnualContextForLegacy(backup);
  stripEmptyServiceBillingForLegacy(backup);
  if (!backupSchemaSupportsAiExtraction(backup.manifest.schemaVersion)) backup.manifest.modelCoverage = backup.manifest.modelCoverage.filter(entry => entry.model !== 'AiProviderSettings');
  delete backup.data.serviceArticles;
  backup.manifest.modelCoverage = backup.manifest.modelCoverage.filter(entry => !['ServiceArticle', 'DataImportBatch'].includes(entry.model));
}

/** Empty later context is not part of genuine older feature fixtures. */
export function stripEmptyAnnualContextForLegacy(backup: { data: Record<string, unknown>; manifest: { schemaVersion?: string; modelCoverage: { model: string }[] } }) {
  stripEmptyPaymentAdjustmentsForLegacy(backup);
  const context = backup.data.annualBusinessContextRevisions;
  if (Array.isArray(context) && context.length === 0) {
    delete backup.data.annualBusinessContextRevisions;
    backup.manifest.modelCoverage = backup.manifest.modelCoverage.filter(entry => entry.model !== 'AnnualBusinessContextRevision');
  }
}

/** Later empty schedule sections do not turn historical backups into new capabilities. */
export function stripEmptyServiceBillingForLegacy(backup: { data: Record<string, unknown>; manifest: { schemaVersion?: string; modelCoverage: { model: string }[] } }) {
  stripEmptyPaymentAdjustmentsForLegacy(backup);
  if (backupSchemaSupportsServiceBilling(backup.manifest.schemaVersion)) return;
  for (const [key, model] of [['serviceBillingPlans', 'ServiceBillingPlan'], ['serviceBillingPeriods', 'ServiceBillingPeriod']]) {
    const value = backup.data[key];
    if (value === undefined || (Array.isArray(value) && value.length === 0)) {
      delete backup.data[key];
      backup.manifest.modelCoverage = backup.manifest.modelCoverage.filter(entry => entry.model !== model);
    }
  }
}

/** Genuine older fixtures cannot contain even empty future-capability fields. */
export function stripEmptyPaymentAdjustmentsForLegacy(backup: { data: Record<string, unknown>; manifest: { schemaVersion?: string; modelCoverage: { model: string }[] } }) {
  if (backup.manifest.schemaVersion === '20261021150000_add_payment_adjustments') return;
  for (const [key, model] of [['paymentAdjustments', 'PaymentAdjustment'], ['paymentOperations', 'PaymentOperation']]) {
    const value = backup.data[key];
    if (value === undefined || (Array.isArray(value) && value.length === 0)) {
      delete backup.data[key];
      backup.manifest.modelCoverage = backup.manifest.modelCoverage.filter(entry => entry.model !== model);
    }
  }
}
export function legacyPaymentData<T extends Record<string, unknown>>(data: T): T {
  const copy = { ...data };
  for (const key of ['paymentAdjustments', 'paymentOperations']) if (Array.isArray(copy[key]) && (copy[key] as unknown[]).length === 0) delete copy[key];
  return copy;
}
