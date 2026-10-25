import { supportsManualFinancialRecords } from '@/lib/manual-financial-record-backup';
import { MANUAL_RECORD_UUID } from '@/lib/manual-financial-record-evidence';
import { backupSchemaSupportsSupplierTasks, backupSchemaSupportsBankMappingProfiles, backupSchemaSupportsDocumentNumberingPolicies, backupSchemaSupportsBankPaymentAllocations, backupSchemaSupportsBankImportEvidence, backupSchemaSupportsAiExtraction, backupSchemaSupportsServiceBilling, backupSchemaSupportsPaymentAdjustments, backupSchemaSupportsProjectServiceTimes, backupSchemaSupportsPurchaseValidation, backupSchemaSupportsEmailOutbox, hashJson } from '@/lib/backup-manifest';
/** Only empty, unreviewed generated metadata may be removed for a genuine
 * historical fixture. Real history, finalized/recorded states and malformed
 * partial evidence must remain visible and fail the old runtime contract. */
export function stripEmptyManualFinancialRecordsForLegacy(backup: { data: Record<string, unknown>; manifest: { schemaVersion?: string; modelCoverage: { model: string; sha256?: string }[] } }) {
  if (supportsManualFinancialRecords(backup.manifest.schemaVersion)) return;
  const events = backup.data.manualFinancialRecordEvents;
  if (Object.hasOwn(backup.data, 'manualFinancialRecordEvents') && (!Array.isArray(events) || events.length !== 0)) return;
  if (Array.isArray(events) && events.length === 0) delete backup.data.manualFinancialRecordEvents;
  backup.manifest.modelCoverage = backup.manifest.modelCoverage.filter(entry => entry.model !== 'ManualFinancialRecordEvent');
  for (const [key, model] of [['incomes', 'Income'], ['expenses', 'Expense']]) {
    const collection = backup.data[key]; if (!Array.isArray(collection)) continue;
    for (const row of collection) {
      if (!row || typeof row !== 'object' || row.manualRecordState !== 'LEGACY_UNREVIEWED' || row.manualRecordRevision !== 0 || !MANUAL_RECORD_UUID.test(String(row.manualRecordId)) || !['LEGACY_UNKNOWN', 'INVOICE', 'PAYMENT_JOURNAL', 'CASHBOOK', 'PURCHASE_DOCUMENT', 'RECURRING'].includes(row.manualRecordOrigin)) continue;
      for (const field of ['manualRecordId', 'manualRecordState', 'manualRecordOrigin', 'manualRecordRevision']) delete row[field];
    }
    const coverage = backup.manifest.modelCoverage.find(entry => entry.model === model); if (coverage) coverage.sha256 = hashJson(collection);
  }
}

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
  stripEmptyBankImportsForLegacy(backup);
  stripEmptyProjectServiceTimesForLegacy(backup);
  if (!backupSchemaSupportsEmailOutbox(backup.manifest.schemaVersion)) backup.manifest.modelCoverage = backup.manifest.modelCoverage.filter(entry => !['EmailOutbox', 'EmailOutboxAttempt'].includes(entry.model));
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
  for (const key of ['incomes', 'expenses']) if (Array.isArray(copy[key])) Object.assign(copy, { [key]: (copy[key] as Record<string, unknown>[]).map(row => ({ ...row })) });
  stripEmptyManualFinancialRecordsForLegacy({ data: copy, manifest: { modelCoverage: [] } });
  for (const key of ['bankMappingProfiles', 'bankMappingProfileRevisions', 'documentNumberingPolicies', 'quoteCreateReceipts', 'bankPaymentBindings', 'paymentAllocationChanges', 'bankImportBatches', 'bankImportRows', 'purchaseValidationReports', 'paymentAdjustments', 'paymentOperations']) if (Array.isArray(copy[key]) && (copy[key] as unknown[]).length === 0) delete copy[key];
  if (Array.isArray(copy.purchaseDocuments)) Object.assign(copy, { purchaseDocuments: copy.purchaseDocuments.map(document => { const row = { ...document }; if (row.supplierTaskKind == null && row.supplierTaskFollowUpDate == null && (row.supplierTaskConfirmationRequired === false || row.supplierTaskConfirmationRequired === undefined)) { delete row.supplierTaskKind; delete row.supplierTaskFollowUpDate; delete row.supplierTaskConfirmationRequired; } return row; }) });
  if (Array.isArray(copy.paymentJournalEvents)) Object.assign(copy, { paymentJournalEvents: copy.paymentJournalEvents.map(root => { const row = { ...root }; if (row.bankPaymentBindingStableKey === null) delete row.bankPaymentBindingStableKey; return row; }) });
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
  stripEmptySupplierTasksForLegacy(backup);
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

/** Bank evidence is a new exact capability, not inferred from a later date. */
export function stripEmptyBankImportsForLegacy(backup: { data: Record<string, unknown>; manifest: { schemaVersion?: string; modelCoverage: { model: string }[] } }) {
  stripEmptySupplierTasksForLegacy(backup);
  for (const [key, model, supported] of [
    ['bankMappingProfiles', 'BankMappingProfile', backupSchemaSupportsBankMappingProfiles(backup.manifest.schemaVersion)],
    ['bankMappingProfileRevisions', 'BankMappingProfileRevision', backupSchemaSupportsBankMappingProfiles(backup.manifest.schemaVersion)],
    ['documentNumberingPolicies', 'DocumentNumberingPolicy', backupSchemaSupportsDocumentNumberingPolicies(backup.manifest.schemaVersion)],
    ['quoteCreateReceipts', 'QuoteCreateReceipt', backupSchemaSupportsDocumentNumberingPolicies(backup.manifest.schemaVersion)],
  ] as const) {
    const value = backup.data[key];
    if (!supported && (value === undefined || (Array.isArray(value) && value.length === 0))) { delete backup.data[key]; backup.manifest.modelCoverage = backup.manifest.modelCoverage.filter(entry => entry.model !== model); }
  }
  if (!backupSchemaSupportsBankPaymentAllocations(backup.manifest.schemaVersion)) {
    if (Array.isArray(backup.data.paymentJournalEvents)) {
      for (const root of backup.data.paymentJournalEvents) if (root.bankPaymentBindingStableKey === null) delete root.bankPaymentBindingStableKey;
      const coverage = backup.manifest.modelCoverage.find(entry => entry.model === 'PaymentJournalEvent') as { sha256?: string } | undefined;
      if (coverage) coverage.sha256 = hashJson(backup.data.paymentJournalEvents);
    }
    for (const [key, model] of [['bankPaymentBindings', 'BankPaymentBinding'], ['paymentAllocationChanges', 'PaymentAllocationChange']]) {
      const value = backup.data[key];
      if (value === undefined || (Array.isArray(value) && value.length === 0)) { delete backup.data[key]; backup.manifest.modelCoverage = backup.manifest.modelCoverage.filter(entry => entry.model !== model); }
    }
  }
  if (backupSchemaSupportsBankImportEvidence(backup.manifest.schemaVersion)) return;
  for (const [key, model] of [['bankImportBatches', 'BankImportBatch'], ['bankImportRows', 'BankImportRow']]) {
    const value = backup.data[key];
    if (value === undefined || (Array.isArray(value) && value.length === 0)) {
      delete backup.data[key];
      backup.manifest.modelCoverage = backup.manifest.modelCoverage.filter(entry => entry.model !== model);
    }
  }
}

/** Strip only provably empty newer task fields; real task evidence never masquerades as historical. */
export function stripEmptySupplierTasksForLegacy(backup: { data: Record<string, unknown>; manifest: { schemaVersion?: string; modelCoverage: { model: string; sha256?: string }[] } }) {
  stripEmptyManualFinancialRecordsForLegacy(backup);
  if (backupSchemaSupportsSupplierTasks(backup.manifest.schemaVersion) || !Array.isArray(backup.data.purchaseDocuments)) return;
  for (const document of backup.data.purchaseDocuments) {
    if (document.supplierTaskKind == null && document.supplierTaskFollowUpDate == null && (document.supplierTaskConfirmationRequired === false || document.supplierTaskConfirmationRequired === undefined)) {
      delete document.supplierTaskKind; delete document.supplierTaskFollowUpDate; delete document.supplierTaskConfirmationRequired;
    }
  }
  const coverage = backup.manifest.modelCoverage.find(entry => entry.model === 'PurchaseDocument');
  if (coverage) coverage.sha256 = hashJson(backup.data.purchaseDocuments);
}
