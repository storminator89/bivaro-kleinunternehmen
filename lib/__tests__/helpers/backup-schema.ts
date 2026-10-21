import { backupSchemaSupportsAiExtraction, backupSchemaSupportsServiceBilling, backupSchemaSupportsPaymentAdjustments, backupSchemaSupportsProjectServiceTimes, backupSchemaSupportsPurchaseValidation, hashJson } from '@/lib/backup-manifest';
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
  stripEmptyProjectServiceTimesForLegacy(backup);
  if (!backupSchemaSupportsPurchaseValidation(backup.manifest.schemaVersion) && (backup.data.purchaseValidationReports === undefined || (Array.isArray(backup.data.purchaseValidationReports) && backup.data.purchaseValidationReports.length === 0))) {
    delete backup.data.purchaseValidationReports;
    backup.manifest.modelCoverage = backup.manifest.modelCoverage.filter(entry => entry.model !== 'PurchaseValidationReport');
  }
  if (backupSchemaSupportsPaymentAdjustments(backup.manifest.schemaVersion)) return;
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
  for (const key of ['purchaseValidationReports', 'paymentAdjustments', 'paymentOperations']) if (Array.isArray(copy[key]) && (copy[key] as unknown[]).length === 0) delete copy[key];
  if (Array.isArray(copy.serviceProjects) && copy.serviceProjects.length === 0) delete copy.serviceProjects;
  if (Array.isArray(copy.billingNotes)) Object.assign(copy, { billingNotes: copy.billingNotes.map(note => {
    const item = { ...note };
    for (const key of ['projectId', 'durationMinutes', 'captureKey', 'captureFingerprint', 'deletedAt']) if (item[key] == null) delete item[key];
    return item;
  }) });
  return copy;
}

/** Nullable future fields are explicit in current fixtures but absent in old ones. */
export function stripEmptyProjectServiceTimesForLegacy(backup: { data: Record<string, unknown>; manifest: { schemaVersion?: string; modelCoverage: { model: string; sha256?: string }[] } }) {
  if (backupSchemaSupportsProjectServiceTimes(backup.manifest.schemaVersion)) return;
  if (backup.data.serviceProjects === undefined || (Array.isArray(backup.data.serviceProjects) && backup.data.serviceProjects.length === 0)) {
    delete backup.data.serviceProjects;
    backup.manifest.modelCoverage = backup.manifest.modelCoverage.filter(entry => entry.model !== 'ServiceProject');
  }
  if (Array.isArray(backup.data.billingNotes)) {
    for (const note of backup.data.billingNotes) for (const key of ['projectId', 'durationMinutes', 'captureKey', 'captureFingerprint', 'deletedAt']) if (note[key] == null) delete note[key];
    const coverage = backup.manifest.modelCoverage.find(entry => entry.model === 'BillingNote');
    if (coverage) coverage.sha256 = hashJson(backup.data.billingNotes);
  }
}
