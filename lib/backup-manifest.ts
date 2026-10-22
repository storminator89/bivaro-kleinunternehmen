import { bankImportsFromBackup } from '@/lib/bank-import-backup';
import { assertPaymentTermDocument, validatePaymentTermSelection } from '@/lib/payment-terms';
import { REMINDER_BALANCE_SCHEMA_VERSION, validateReminderBackupFields } from '@/lib/reminder-backup';
import { createHash } from 'node:crypto';
import { hasServiceBillingDraftMarker } from '@/lib/service-billing';
import { validationReportsFromBackup } from '@/lib/purchase-documents/validation-backup';
import { durationToQuantity, validateDurationMinutes } from '@/lib/service-duration';
import { parseServiceCaptureKey, serviceCaptureFingerprint } from '@/lib/service-capture';

export const CURRENT_BACKUP_VERSION = '3.0';
export const LEGACY_BACKUP_VERSION = '2.0';
/** Exact combined capability identity. Historical standalone and union identities never gain features. */
export const PAYMENT_TERMS_SCHEMA_VERSION = '20261022040000_add_payment_terms';
export const BANK_IMPORT_EVIDENCE_SCHEMA_VERSION = '20261022050000_add_bank_import_evidence';
export const CURRENT_SCHEMA_VERSION = '20261022060000_combine_payment_terms_bank_import_evidence';
export const PROJECT_OUTBOX_PURCHASE_VALIDATION_SCHEMA_VERSION = '20261022030000_combine_projects_outbox_validation';
// Compatibility name used by the independent bank-evidence candidate.
export const PROJECT_OUTBOX_VALIDATION_SCHEMA_VERSION = PROJECT_OUTBOX_PURCHASE_VALIDATION_SCHEMA_VERSION;
export const PROJECT_PURCHASE_VALIDATION_SCHEMA_VERSION = '20261022011000_combine_project_purchase_validation';
export const PROJECT_OUTBOX_SCHEMA_VERSION = '20261022020000_combine_projects_outbox';
export const DURABLE_EMAIL_OUTBOX_SCHEMA_VERSION = '20261022000000_durable_mail_outbox';
export const PURCHASE_VALIDATION_SCHEMA_VERSION = '20261022010000_add_purchase_validation_reports';
export const PROJECT_SERVICE_TIMES_SCHEMA_VERSION = '20261021160000_add_project_service_times';
export const PAYMENT_ADJUSTMENTS_SCHEMA_VERSION = '20261021150000_add_payment_adjustments';
export const PAYMENT_ADJUSTMENT_SCHEMA_VERSION = PAYMENT_ADJUSTMENTS_SCHEMA_VERSION;
export const PRE_PURCHASE_VALIDATION_SCHEMA_VERSION = PAYMENT_ADJUSTMENTS_SCHEMA_VERSION;
export const RECURRING_BALANCE_DAILY_SCHEMA_VERSION = '20261021140000_combine_recurring_balance_daily_context';
export const GROWTH_AI_REMINDER_SCHEMA_VERSION = '20261021120000_combine_growth_ai_reminder_context';
export const RECURRING_SERVICE_SCHEMA_VERSION = '20261021094500_recurring_service_drafts';
export const GROWTH_AI_SCHEMA_VERSION = '20261021110000_combine_growth_ai_receipt_context';
export const GROWTH_SCHEMA_VERSION = '20261021100000_combine_customer_catalog_quote_context';
export const AI_RECEIPT_EXTRACTION_SCHEMA_VERSION = '20261021091000_add_ai_receipt_extraction';
export const COMBINED_PHOTO_ANNUAL_SCHEMA_VERSION = '20261021080000_combine_photo_annual_context';
export const DATA_IMPORT_SCHEMA_VERSION = '20261021080000_add_service_catalog_and_import_receipts';
export const QUOTE_WORKFLOW_SCHEMA_VERSION = '20261021073000_add_quote_followup';
export const MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION = '20261021061000_add_manual_photo_approval';
export const ANNUAL_CONTEXT_SCHEMA_VERSION = '20261021070000_add_annual_business_context';
export const PRE_MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION = '20261021054000_add_purchase_review_drafts';
export const PRE_QUOTE_FOLLOWUP_SCHEMA_VERSION = '20261021054000_add_purchase_review_drafts';
export const PRE_DATA_IMPORT_SCHEMA_VERSION = '20261021054000_add_purchase_review_drafts';
export const PRE_ANNUAL_CONTEXT_SCHEMA_VERSION = PRE_MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION;
export const QUOTE_WORKFLOW_SCHEMAS: readonly string[] = [CURRENT_SCHEMA_VERSION, PAYMENT_TERMS_SCHEMA_VERSION, BANK_IMPORT_EVIDENCE_SCHEMA_VERSION, PROJECT_OUTBOX_PURCHASE_VALIDATION_SCHEMA_VERSION, PROJECT_OUTBOX_SCHEMA_VERSION, PROJECT_PURCHASE_VALIDATION_SCHEMA_VERSION, DURABLE_EMAIL_OUTBOX_SCHEMA_VERSION, PURCHASE_VALIDATION_SCHEMA_VERSION, PROJECT_SERVICE_TIMES_SCHEMA_VERSION, PAYMENT_ADJUSTMENTS_SCHEMA_VERSION, RECURRING_BALANCE_DAILY_SCHEMA_VERSION, GROWTH_AI_REMINDER_SCHEMA_VERSION, RECURRING_SERVICE_SCHEMA_VERSION, GROWTH_AI_SCHEMA_VERSION, GROWTH_SCHEMA_VERSION, QUOTE_WORKFLOW_SCHEMA_VERSION];
export const REVIEW_DRAFT_SCHEMAS: readonly string[] = [CURRENT_SCHEMA_VERSION, PAYMENT_TERMS_SCHEMA_VERSION, BANK_IMPORT_EVIDENCE_SCHEMA_VERSION, PROJECT_OUTBOX_PURCHASE_VALIDATION_SCHEMA_VERSION, PROJECT_OUTBOX_SCHEMA_VERSION, PROJECT_PURCHASE_VALIDATION_SCHEMA_VERSION, DURABLE_EMAIL_OUTBOX_SCHEMA_VERSION, PURCHASE_VALIDATION_SCHEMA_VERSION, PROJECT_SERVICE_TIMES_SCHEMA_VERSION, PAYMENT_ADJUSTMENTS_SCHEMA_VERSION, RECURRING_BALANCE_DAILY_SCHEMA_VERSION, GROWTH_AI_REMINDER_SCHEMA_VERSION, RECURRING_SERVICE_SCHEMA_VERSION, GROWTH_AI_SCHEMA_VERSION, GROWTH_SCHEMA_VERSION, AI_RECEIPT_EXTRACTION_SCHEMA_VERSION, REMINDER_BALANCE_SCHEMA_VERSION, COMBINED_PHOTO_ANNUAL_SCHEMA_VERSION, DATA_IMPORT_SCHEMA_VERSION, QUOTE_WORKFLOW_SCHEMA_VERSION, MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION, ANNUAL_CONTEXT_SCHEMA_VERSION, PRE_MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION];
/** Closed registry: new unions add identities; timestamps never infer capabilities. */
export const BACKUP_FEATURE_CAPABILITIES: Readonly<Record<string, { manualPhotoApproval: boolean; annualContext: boolean; dataImport: boolean; quoteWorkflow: boolean; aiReceiptExtraction: boolean; reminderBalance: boolean; recurringServiceDrafts: boolean; paymentAdjustments: boolean; projectServiceTimes: boolean; emailOutbox: boolean; purchaseValidationReports: boolean; paymentTerms: boolean; bankImportEvidence: boolean }>> = Object.freeze({
  [CURRENT_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: true, annualContext: true, dataImport: true, quoteWorkflow: true, aiReceiptExtraction: true, reminderBalance: true, recurringServiceDrafts: true, paymentAdjustments: true, projectServiceTimes: true, emailOutbox: true, purchaseValidationReports: true, paymentTerms: true, bankImportEvidence: true }),
  [PAYMENT_TERMS_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: true, annualContext: true, dataImport: true, quoteWorkflow: true, aiReceiptExtraction: true, reminderBalance: true, recurringServiceDrafts: true, paymentAdjustments: true, projectServiceTimes: true, emailOutbox: true, purchaseValidationReports: true, paymentTerms: true, bankImportEvidence: false }),
  [BANK_IMPORT_EVIDENCE_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: true, annualContext: true, dataImport: true, quoteWorkflow: true, aiReceiptExtraction: true, reminderBalance: true, recurringServiceDrafts: true, paymentAdjustments: true, projectServiceTimes: true, emailOutbox: true, purchaseValidationReports: true, paymentTerms: false, bankImportEvidence: true }),
  [PROJECT_OUTBOX_PURCHASE_VALIDATION_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: true, annualContext: true, dataImport: true, quoteWorkflow: true, aiReceiptExtraction: true, reminderBalance: true, recurringServiceDrafts: true, paymentAdjustments: true, projectServiceTimes: true, emailOutbox: true, purchaseValidationReports: true, paymentTerms: false, bankImportEvidence: false }),
  [PROJECT_OUTBOX_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: true, annualContext: true, dataImport: true, quoteWorkflow: true, aiReceiptExtraction: true, reminderBalance: true, recurringServiceDrafts: true, paymentAdjustments: true, projectServiceTimes: true, emailOutbox: true, purchaseValidationReports: false, paymentTerms: false, bankImportEvidence: false }),
  [PROJECT_PURCHASE_VALIDATION_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: true, annualContext: true, dataImport: true, quoteWorkflow: true, aiReceiptExtraction: true, reminderBalance: true, recurringServiceDrafts: true, paymentAdjustments: true, projectServiceTimes: true, emailOutbox: false, purchaseValidationReports: true, paymentTerms: false, bankImportEvidence: false }),
  [PURCHASE_VALIDATION_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: true, annualContext: true, dataImport: true, quoteWorkflow: true, aiReceiptExtraction: true, reminderBalance: true, recurringServiceDrafts: true, paymentAdjustments: true, projectServiceTimes: false, emailOutbox: false, purchaseValidationReports: true, paymentTerms: false, bankImportEvidence: false }),
  [PROJECT_SERVICE_TIMES_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: true, annualContext: true, dataImport: true, quoteWorkflow: true, aiReceiptExtraction: true, reminderBalance: true, recurringServiceDrafts: true, paymentAdjustments: true, projectServiceTimes: true, emailOutbox: false, purchaseValidationReports: false, paymentTerms: false, bankImportEvidence: false }),
  [DURABLE_EMAIL_OUTBOX_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: true, annualContext: true, dataImport: true, quoteWorkflow: true, aiReceiptExtraction: true, reminderBalance: true, recurringServiceDrafts: true, paymentAdjustments: true, projectServiceTimes: false, emailOutbox: true, purchaseValidationReports: false, paymentTerms: false, bankImportEvidence: false }),
  [PAYMENT_ADJUSTMENTS_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: true, annualContext: true, dataImport: true, quoteWorkflow: true, aiReceiptExtraction: true, reminderBalance: true, recurringServiceDrafts: true, paymentAdjustments: true, projectServiceTimes: false, emailOutbox: false, purchaseValidationReports: false, paymentTerms: false, bankImportEvidence: false }),
  [RECURRING_BALANCE_DAILY_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: true, annualContext: true, dataImport: true, quoteWorkflow: true, aiReceiptExtraction: true, reminderBalance: true, recurringServiceDrafts: true, paymentAdjustments: false, projectServiceTimes: false, emailOutbox: false, purchaseValidationReports: false, paymentTerms: false, bankImportEvidence: false }),
  [GROWTH_AI_REMINDER_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: true, annualContext: true, dataImport: true, quoteWorkflow: true, aiReceiptExtraction: true, reminderBalance: true, recurringServiceDrafts: false, paymentAdjustments: false, projectServiceTimes: false, emailOutbox: false, purchaseValidationReports: false, paymentTerms: false, bankImportEvidence: false }),
  [RECURRING_SERVICE_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: true, annualContext: true, dataImport: true, quoteWorkflow: true, aiReceiptExtraction: true, reminderBalance: false, recurringServiceDrafts: true, paymentAdjustments: false, projectServiceTimes: false, emailOutbox: false, purchaseValidationReports: false, paymentTerms: false, bankImportEvidence: false }),
  [GROWTH_AI_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: true, annualContext: true, dataImport: true, quoteWorkflow: true, aiReceiptExtraction: true, reminderBalance: false, recurringServiceDrafts: false, paymentAdjustments: false, projectServiceTimes: false, emailOutbox: false, purchaseValidationReports: false, paymentTerms: false, bankImportEvidence: false }),
  [GROWTH_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: true, annualContext: true, dataImport: true, quoteWorkflow: true, aiReceiptExtraction: false, reminderBalance: false, recurringServiceDrafts: false, paymentAdjustments: false, projectServiceTimes: false, emailOutbox: false, purchaseValidationReports: false, paymentTerms: false, bankImportEvidence: false }),
  [AI_RECEIPT_EXTRACTION_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: true, annualContext: true, dataImport: false, quoteWorkflow: false, aiReceiptExtraction: true, reminderBalance: false, recurringServiceDrafts: false, paymentAdjustments: false, projectServiceTimes: false, emailOutbox: false, purchaseValidationReports: false, paymentTerms: false, bankImportEvidence: false }),
  [REMINDER_BALANCE_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: true, annualContext: true, dataImport: false, quoteWorkflow: false, aiReceiptExtraction: false, reminderBalance: true, recurringServiceDrafts: false, paymentAdjustments: false, projectServiceTimes: false, emailOutbox: false, purchaseValidationReports: false, paymentTerms: false, bankImportEvidence: false }),
  [COMBINED_PHOTO_ANNUAL_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: true, annualContext: true, dataImport: false, quoteWorkflow: false, aiReceiptExtraction: false, reminderBalance: false, recurringServiceDrafts: false, paymentAdjustments: false, projectServiceTimes: false, emailOutbox: false, purchaseValidationReports: false, paymentTerms: false, bankImportEvidence: false }),
  [DATA_IMPORT_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: false, annualContext: false, dataImport: true, quoteWorkflow: false, aiReceiptExtraction: false, reminderBalance: false, recurringServiceDrafts: false, paymentAdjustments: false, projectServiceTimes: false, emailOutbox: false, purchaseValidationReports: false, paymentTerms: false, bankImportEvidence: false }),
  [QUOTE_WORKFLOW_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: false, annualContext: false, dataImport: false, quoteWorkflow: true, aiReceiptExtraction: false, reminderBalance: false, recurringServiceDrafts: false, paymentAdjustments: false, projectServiceTimes: false, emailOutbox: false, purchaseValidationReports: false, paymentTerms: false, bankImportEvidence: false }),
  [MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: true, annualContext: false, dataImport: false, quoteWorkflow: false, aiReceiptExtraction: false, reminderBalance: false, recurringServiceDrafts: false, paymentAdjustments: false, projectServiceTimes: false, emailOutbox: false, purchaseValidationReports: false, paymentTerms: false, bankImportEvidence: false }),
  [ANNUAL_CONTEXT_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: false, annualContext: true, dataImport: false, quoteWorkflow: false, aiReceiptExtraction: false, reminderBalance: false, recurringServiceDrafts: false, paymentAdjustments: false, projectServiceTimes: false, emailOutbox: false, purchaseValidationReports: false, paymentTerms: false, bankImportEvidence: false }),
  [PRE_MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION]: Object.freeze({ manualPhotoApproval: false, annualContext: false, dataImport: false, quoteWorkflow: false, aiReceiptExtraction: false, reminderBalance: false, recurringServiceDrafts: false, paymentAdjustments: false, projectServiceTimes: false, emailOutbox: false, purchaseValidationReports: false, paymentTerms: false, bankImportEvidence: false }),
});
export function backupSchemaSupportsBankImportEvidence(schemaVersion?: string): boolean {
  return schemaVersion !== undefined && BACKUP_FEATURE_CAPABILITIES[schemaVersion]?.bankImportEvidence === true;
}
export function backupSchemaSupportsPaymentTerms(schemaVersion?: string): boolean {
  return schemaVersion !== undefined && BACKUP_FEATURE_CAPABILITIES[schemaVersion]?.paymentTerms === true;
}
export function backupSchemaSupportsEmailOutbox(schemaVersion?: string): boolean {
  return schemaVersion !== undefined && BACKUP_FEATURE_CAPABILITIES[schemaVersion]?.emailOutbox === true;
}
export function backupSchemaSupportsPurchaseValidation(schemaVersion?: string): boolean {
  return schemaVersion !== undefined && BACKUP_FEATURE_CAPABILITIES[schemaVersion]?.purchaseValidationReports === true;
}
export function backupSchemaSupportsProjectServiceTimes(schemaVersion?: string): boolean {
  return schemaVersion !== undefined && BACKUP_FEATURE_CAPABILITIES[schemaVersion]?.projectServiceTimes === true;
}
export function backupSchemaSupportsPaymentAdjustments(schemaVersion?: string): boolean {
  return schemaVersion !== undefined && BACKUP_FEATURE_CAPABILITIES[schemaVersion]?.paymentAdjustments === true;
}
export function backupSchemaSupportsServiceBilling(schemaVersion?: string): boolean {
  return schemaVersion !== undefined && BACKUP_FEATURE_CAPABILITIES[schemaVersion]?.recurringServiceDrafts === true;
}
export function backupSchemaSupportsDataImport(schemaVersion?: string): boolean {
  return schemaVersion !== undefined && BACKUP_FEATURE_CAPABILITIES[schemaVersion]?.dataImport === true;
}
export function backupSchemaSupportsManualPhotoApproval(schemaVersion?: string): boolean {
  return schemaVersion !== undefined && BACKUP_FEATURE_CAPABILITIES[schemaVersion]?.manualPhotoApproval === true;
}
export function backupSchemaSupportsAiExtraction(schemaVersion?: string): boolean {
  return schemaVersion !== undefined && BACKUP_FEATURE_CAPABILITIES[schemaVersion]?.aiReceiptExtraction === true;
}
export function backupSchemaSupportsAnnualContext(schemaVersion?: string): boolean {
  return schemaVersion !== undefined && BACKUP_FEATURE_CAPABILITIES[schemaVersion]?.annualContext === true;
}
export function backupSchemaSupportsReminderBalance(schemaVersion?: string): boolean {
  return schemaVersion !== undefined && BACKUP_FEATURE_CAPABILITIES[schemaVersion]?.reminderBalance === true;
}
export const PRE_PURCHASE_REVIEW_DRAFTS_SCHEMA_VERSION = '20261021043000_add_partial_payments';
/** Full-payment journal snapshots retain their immutable evidence semantics. */
export const FULL_PAYMENT_JOURNAL_SCHEMA_VERSION = '20261020230000_add_payment_journal';
/** Supplier booking existed before the additive immutable payment journal. */
export const PRE_PAYMENT_JOURNAL_SCHEMA_VERSION = '20261020223000_add_suppliers_and_purchase_booking';
/** Incoming originals existed before supplier selection and expense approval. */
export const PRE_SUPPLIERS_SCHEMA_VERSION = '20261020220000_add_purchase_documents';
/** Incoming originals are additive; pre-inbox v3 manifests contain no sources. */
export const PRE_PURCHASE_DOCUMENTS_SCHEMA_VERSION = '20261020213000_add_fiscal_profile';
/** Fiscal profiles are additive; existing v3 backups remain importable. */
export const PRE_FISCAL_PROFILE_SCHEMA_VERSION = '20260922100000_add_billing_notes';
/** v3 manifests produced before BillingNote was introduced remain importable. */
export const PRE_BILLING_NOTES_SCHEMA_VERSION = '20260919100000_invoice_issuance_state';

/** Capabilities are explicit: a non-current schema may already contain a journal. */
const JOURNAL_SCHEMAS: readonly string[] = [...REVIEW_DRAFT_SCHEMAS, PRE_PURCHASE_REVIEW_DRAFTS_SCHEMA_VERSION, FULL_PAYMENT_JOURNAL_SCHEMA_VERSION];
const SUPPLIER_SCHEMAS: readonly string[] = [...JOURNAL_SCHEMAS, PRE_PAYMENT_JOURNAL_SCHEMA_VERSION];
const PURCHASE_DOCUMENT_SCHEMAS: readonly string[] = [...SUPPLIER_SCHEMAS, PRE_SUPPLIERS_SCHEMA_VERSION];
const SUPPORTED_SCHEMAS: readonly string[] = [...PURCHASE_DOCUMENT_SCHEMAS, PRE_PURCHASE_DOCUMENTS_SCHEMA_VERSION, PRE_FISCAL_PROFILE_SCHEMA_VERSION, PRE_BILLING_NOTES_SCHEMA_VERSION];

export function backupSchemaSupportsPaymentJournal(schemaVersion: string): boolean {
  return JOURNAL_SCHEMAS.includes(schemaVersion);
}

export type BackupCoverageMode = 'included' | 'metadata-only' | 'excluded';

export type BackupCoverageEntry = {
  model: string;
  key: string;
  mode: BackupCoverageMode;
  count: number;
  sha256?: string;
  reason?: string;
};

export type BackupFileManifestEntry = {
  kind: 'invoice' | 'receipt' | 'logo' | 'purchase-document';
  sourceName: string;
  zipPath?: string;
  bytes: number;
  sha256: string;
  sourceVersion?: string;
};

export type BackupSnapshotInfo = {
  id: string;
  startedAt: string;
  endedAt: string;
  consistency: 'single-read-transaction';
};

export type BackupManifest = {
  format: 'bivaro-backup';
  version: typeof CURRENT_BACKUP_VERSION;
  schemaVersion: string;
  backupId: string;
  sourceUserId: string;
  generatedAt: string;
  excludesSecrets: true;
  excludedSecretFields: string[];
  rekeyRequired: string[];
  modelCoverage: BackupCoverageEntry[];
  auditSegment: {
    key: 'auditLogs';
    count: number;
    sha256: string;
    restoreMode: 'append-only';
  };
  invoiceNumberCounters: {
    key: 'invoiceNumberCounters';
    count: number;
    sha256: string;
    highWaterMark: 'max-existing-imported-historical';
  };
  fileManifest: BackupFileManifestEntry[];
  snapshot?: BackupSnapshotInfo;
};

export type BackupManifestData = Record<string, unknown>;

const COVERAGE = [
  { model: 'User', key: 'user', mode: 'metadata-only' as const, reason: 'Identity and password remain target-owned.' },
  { model: 'AppSettings', key: 'appSettings', mode: 'excluded' as const, reason: 'Host-wide bootstrap setting, not tenant data.' },
  { model: 'AiProviderSettings', key: 'aiProviderSettings', mode: 'excluded' as const, reason: 'Provider configuration and encrypted credentials remain target-owned; never imported or enabled by business restore.' },
  { model: 'SmtpSettings', key: 'smtpSettings', mode: 'excluded' as const, reason: 'Host-wide SMTP override and encrypted credential material are never backed up.' },
  { model: 'EmailOutbox', key: 'emailOutbox', mode: 'excluded' as const, reason: 'Target-owned manual SMTP runtime evidence; not portable or restorable and never a delivery/read claim.' },
  { model: 'EmailOutboxAttempt', key: 'emailOutboxAttempts', mode: 'excluded' as const, reason: 'Target-owned attempt history; restore cannot replay or reactivate a send.' },
  { model: 'RateLimitBucket', key: 'rateLimitBuckets', mode: 'excluded' as const, reason: 'Operational runtime state is not restorable business data.' },
  { model: 'DataImportBatch', key: 'dataImportBatches', mode: 'excluded' as const, reason: 'Operational CSV replay receipts are target-owned; imported business records are included in customers/serviceArticles.' },
  { model: 'BankImportBatch', key: 'bankImportBatches', mode: 'included' as const, reason: 'Immutable unallocated bank evidence and receipts; restore never creates a payment.' },
  { model: 'BankImportRow', key: 'bankImportRows', mode: 'included' as const, reason: 'Source-position identities, validation and duplicate evidence remain unchanged.' },
  { model: 'ServiceArticle', key: 'serviceArticles', mode: 'included' as const },
  { model: 'Customer', key: 'customers', mode: 'included' as const },
  { model: 'Supplier', key: 'suppliers', mode: 'included' as const },
  { model: 'Expense', key: 'expenses', mode: 'included' as const },
  { model: 'Income', key: 'incomes', mode: 'included' as const },
  { model: 'PaymentAdjustment', key: 'paymentAdjustments', mode: 'included' as const },
  { model: 'PaymentOperation', key: 'paymentOperations', mode: 'included' as const },
  { model: 'PaymentJournalEvent', key: 'paymentJournalEvents', mode: 'included' as const },
  { model: 'Invoice', key: 'invoices', mode: 'included' as const },
  { model: 'PurchaseDocument', key: 'purchaseDocuments', mode: 'included' as const },
  { model: 'PurchaseValidationReport', key: 'purchaseValidationReports', mode: 'included' as const, reason: 'Versioned technical evidence only; imported reports remain historic and target history is append-only.' },
  { model: 'Settings', key: 'settings', mode: 'included' as const },
  { model: 'AnnualBusinessContextRevision', key: 'annualBusinessContextRevisions', mode: 'included' as const },
  { model: 'ServiceBillingPlan', key: 'serviceBillingPlans', mode: 'included' as const },
  { model: 'ServiceBillingPeriod', key: 'serviceBillingPeriods', mode: 'included' as const },
  { model: 'InvoiceTemplate', key: 'templates', mode: 'included' as const },
  { model: 'RecurringExpense', key: 'recurringExpenses', mode: 'included' as const },
  { model: 'Reminder', key: 'reminders', mode: 'included' as const },
  { model: 'ServiceProject', key: 'serviceProjects', mode: 'included' as const },
  { model: 'BillingNote', key: 'billingNotes', mode: 'included' as const },
  { model: 'ApiKey', key: 'apiKeys', mode: 'metadata-only' as const, reason: 'Hash and usable secret are deliberately excluded; re-key required.' },
  { model: 'ApiLog', key: 'apiLogs', mode: 'excluded' as const, reason: 'Operational API telemetry is not tenant business state.' },
  { model: 'AuditLog', key: 'auditLogs', mode: 'included' as const, reason: 'Appended as a provenance-preserving audit segment.' },
  { model: 'CashBook', key: 'cashBooks', mode: 'included' as const },
  { model: 'CashTransaction', key: 'cashTransactions', mode: 'included' as const },
  { model: 'Documentation', key: 'documentations', mode: 'included' as const },
  { model: 'InvoiceNumberCounter', key: 'invoiceNumberCounters', mode: 'included' as const, reason: 'High-water marks are merged by maximum.' },
] as const;

export const BACKUP_MODEL_COVERAGE = COVERAGE;

// Scalar allowlist is closed for every supported schema. Feature evidence is
// additionally gated by its source identity, never merely by recomputed hashes.
const PURCHASE_DOCUMENT_BACKUP_FIELDS = new Set([
  'id', 'userId', 'originalFileName', 'storedFileName', 'originalSha256',
  'originalByteCount', 'mediaType', 'uploadedAt', 'uploadRequestId', 'parsedData',
  'parseStatus', 'parserVersion', 'parseErrorCode', 'supplierName', 'supplierId',
  'selectedSupplierSnapshot', 'invoiceNumber', 'invoiceDate', 'currency',
  'totalAmount', 'reviewDraftSearch', 'reviewDraft', 'reviewDraftSavedAt',
  'reviewStatus', 'revision', 'expenseId', 'approvalRequestId',
  'approvalFingerprint', 'approvedAt', 'dismissedAt', 'dismissalReason', 'updatedAt',
]);

export function validatePurchaseDocumentBackupFields(document: Record<string, unknown>, label: string, schemaVersion?: string): void {
  if (document.reviewedSourceSnapshot != null && !backupSchemaSupportsManualPhotoApproval(schemaVersion)) {
    throw new Error(`${label}.reviewedSourceSnapshot: Älteres Backupschema unterstützt keine manuellen Foto-Freigaben. Die Quelldaten bleiben unverändert; ein passendes Wiederherstellungsziel ist erforderlich.`);
  }
  for (const field of Object.keys(document)) {
    if (['aiExtraction','aiDraftProvenance','aiApprovedSnapshot'].includes(field)) {
      if (document[field] == null || backupSchemaSupportsAiExtraction(schemaVersion)) continue;
      throw new Error(`${label}.${field}: Älteres Backupschema unterstützt keine KI-Herkunft. Quelldaten dürfen nicht verworfen werden.`);
    }
    // An explicitly absent future snapshot carries no evidence to discard.
    if (field === 'reviewedSourceSnapshot' && (document[field] == null || backupSchemaSupportsManualPhotoApproval(schemaVersion))) continue;
    if (!PURCHASE_DOCUMENT_BACKUP_FIELDS.has(field)) throw new Error(`${label}: Nicht unterstütztes Eingangsbelegfeld; Wiederherstellung würde Quelldaten verlieren.`);
  }
}

const BILLING_NOTE_BACKUP_FIELDS = new Set(['id', 'userId', 'customerId', 'serviceDate', 'description', 'quantity', 'unit', 'invoiceId', 'createdAt', 'updatedAt']);
const PROJECT_SERVICE_NOTE_BACKUP_FIELDS = new Set(['projectId', 'durationMinutes', 'captureKey', 'captureFingerprint', 'deletedAt']);
const SERVICE_PROJECT_BACKUP_FIELDS = new Set(['id', 'userId', 'customerId', 'name', 'archivedAt', 'createdAt', 'updatedAt']);

/** Closed additive boundary shared by manifests, previews and legacy restores. */
export function validateProjectServiceBackupFields(data: BackupManifestData, schemaVersion?: string): void {
  const supported = backupSchemaSupportsProjectServiceTimes(schemaVersion);
  if (!supported && Object.hasOwn(data, 'serviceProjects')) throw new Error('Älteres Backupschema darf keinen serviceProjects-Abschnitt enthalten');
  if (supported && !Array.isArray(data.serviceProjects)) throw new Error('Backup-Daten enthalten keinen erforderlichen Abschnitt: serviceProjects');
  const sourceUserId = (data.user as Record<string, unknown> | undefined)?.id;
  const owned = (row: Record<string, unknown>, label: string) => {
    if (row.userId !== undefined && row.userId !== sourceUserId) throw new Error(`${label}.userId gehört nicht zur Backup-Quelle`);
  };
  const requiredDate = (value: unknown, label: string) => {
    if (!(value instanceof Date) && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))) throw new Error(`${label} ist ungültig`);
    const date = value instanceof Date ? value : new Date(value as string);
    if (Number.isNaN(date.getTime()) || (typeof value === 'string' && date.toISOString() !== value)) throw new Error(`${label} ist ungültig`);
  };
  if (Array.isArray(data.serviceProjects)) data.serviceProjects.forEach((value, index) => {
    const label = `serviceProjects[${index}]`;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} muss ein Objekt sein`);
    const project = value as Record<string, unknown>;
    if (Object.keys(project).some(field => !SERVICE_PROJECT_BACKUP_FIELDS.has(field))) throw new Error(`${label}: Nicht unterstütztes Projektfeld`);
    owned(project, label);
    for (const field of ['id', 'customerId']) if (typeof project[field] !== 'number' || !Number.isSafeInteger(project[field]) || Number(project[field]) <= 0) throw new Error(`${label}.${field} ist ungültig`);
    if (typeof project.name !== 'string' || !project.name.trim() || project.name.length > 120 || project.name !== project.name.trim()) throw new Error(`${label}.name ist ungültig`);
    if (!Object.hasOwn(project, 'archivedAt') || project.archivedAt === undefined) throw new Error(`${label}.archivedAt muss explizit nullable sein`);
    for (const field of ['createdAt', 'updatedAt']) requiredDate(project[field], `${label}.${field}`);
    if (project.archivedAt !== null) requiredDate(project.archivedAt, `${label}.archivedAt`);
  });
  const captureKeys = new Set<string>();
  if (Array.isArray(data.billingNotes)) data.billingNotes.forEach((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return; // Scalar shape is checked by restore.
    const note = value as Record<string, unknown>;
    const label = `billingNotes[${index}]`;
    owned(note, label);
    for (const field of Object.keys(note)) {
      if (PROJECT_SERVICE_NOTE_BACKUP_FIELDS.has(field)) {
        if (!supported) throw new Error(`${label}.${field}: Älteres Backupschema unterstützt keine Projekt-, Zeit- oder Erfassungsfelder`);
      } else if (!BILLING_NOTE_BACKUP_FIELDS.has(field)) throw new Error(`${label}: Nicht unterstütztes Leistungsnotizfeld`);
    }
    if (!supported) return;
    for (const field of PROJECT_SERVICE_NOTE_BACKUP_FIELDS) if (!Object.hasOwn(note, field) || note[field] === undefined) throw new Error(`${label}.${field} muss explizit nullable sein`);
    if (note.projectId !== null && (typeof note.projectId !== 'number' || !Number.isSafeInteger(note.projectId) || note.projectId <= 0)) throw new Error(`${label}.projectId ist ungültig`);
    if (note.durationMinutes !== null) {
      let minutes: number;
      try { minutes = validateDurationMinutes(note.durationMinutes); } catch { throw new Error(`${label}.durationMinutes ist ungültig`); }
      if (note.quantity !== durationToQuantity(minutes) || note.unit !== 'Stunde') throw new Error(`${label}.durationMinutes widerspricht quantity oder unit (Stunde)`);
    }
    if ((note.captureKey === null) !== (note.captureFingerprint === null)) throw new Error(`${label}: captureKey und captureFingerprint müssen gemeinsam nullable sein`);
    if (note.deletedAt !== null) {
      requiredDate(note.deletedAt, `${label}.deletedAt`);
      if (note.captureKey === null || note.invoiceId !== null) throw new Error(`${label}.deletedAt benötigt einen Erfassungsnachweis ohne Rechnungszuordnung`);
    }
    if (note.captureKey !== null) {
      let key: string | null;
      try { key = parseServiceCaptureKey(note.captureKey); }
      catch { throw new Error(`${label}.captureKey ist keine kanonische UUID`); }
      if (key === null || key !== note.captureKey) throw new Error(`${label}.captureKey ist keine kanonische UUID`);
      if (typeof note.captureFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(note.captureFingerprint)) throw new Error(`${label}.captureFingerprint ist kein SHA-256-Hash`);
      if (captureKeys.has(key)) throw new Error(`${label}.captureKey ist im Backup nicht eindeutig`);
      captureKeys.add(key);
      let fingerprint: string;
      try {
        if (typeof note.customerId !== 'number' || !Number.isSafeInteger(note.customerId) || note.customerId <= 0
          || !(note.serviceDate instanceof Date || typeof note.serviceDate === 'string')
          || typeof note.description !== 'string' || typeof note.quantity !== 'number' || !Number.isFinite(note.quantity)
          || typeof note.unit !== 'string') throw new Error('invalid-capture-fields');
        fingerprint = serviceCaptureFingerprint({
          customerId: note.customerId, projectId: note.projectId as number | null,
          serviceDate: note.serviceDate, description: note.description, quantity: note.quantity,
          unit: note.unit, durationMinutes: note.durationMinutes as number | null,
        });
      } catch { throw new Error(`${label}.captureFingerprint kann nicht aus den Quell-Leistungsdaten geprüft werden`); }
      if (fingerprint !== note.captureFingerprint) throw new Error(`${label}.captureFingerprint widerspricht den Quell-Leistungsdaten`);
    }
  });
}

/** Nullable absence is harmless for historical backups; non-null future evidence is not. */
export function validatePaymentTermBackupFields(data: BackupManifestData, schemaVersion?: string): void {
  const supported = backupSchemaSupportsPaymentTerms(schemaVersion);
  const defaultDays = (record: Record<string, unknown>, label: string) => {
    const days = record.paymentTermDays;
    if (days == null) return;
    if (!supported) throw new Error(`${label}.paymentTermDays: Älteres Backupschema unterstützt keine Zahlungsziel-Vorgaben`);
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > 365) throw new Error(`${label}.paymentTermDays muss eine ganze Zahl zwischen 0 und 365 oder null sein`);
  };
  if (Array.isArray(data.customers)) data.customers.forEach((row, index) => {
    if (row && typeof row === 'object' && !Array.isArray(row)) defaultDays(row as Record<string, unknown>, `customers[${index}]`);
  });
  if (data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) defaultDays(data.settings as Record<string, unknown>, 'settings');
  const documentDate = (value: unknown): Date | null => {
    if (value == null) return null;
    if (value instanceof Date) return value;
    if (typeof value !== 'string') throw new Error('Ungültiges Rechnungsdatum im Zahlungsziel-Nachweis');
    return new Date(value);
  };
  if (Array.isArray(data.invoices)) data.invoices.forEach((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return;
    const invoice = row as Record<string, unknown>;
    let parsedValue = invoice.parsedData;
    // A JSON-string wrapper is legacy data, not a canonical new provenance
    // container. Inspect only to prevent hiding future evidence from the gate.
    if (typeof parsedValue === 'string') {
      try { parsedValue = JSON.parse(parsedValue); } catch { return; }
    }
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) return;
    const parsed = parsedValue as Record<string, unknown>;
    if (parsed.paymentTermSelection == null) return;
    const label = `invoices[${index}].parsedData.paymentTermSelection`;
    if (!supported) throw new Error(`${label}: Älteres Backupschema unterstützt keine Zahlungsziel-Herkunft`);
    if (typeof invoice.parsedData === 'string') throw new Error(`${label} benötigt ein kanonisches JSON-Objekt`);
    if (invoice.type !== 'INVOICE' || hasServiceBillingDraftMarker(parsed)) throw new Error(`${label} ist nur bei gewöhnlichen Rechnungen zulässig`);
    if (typeof invoice.invoiceNumber !== 'string' || !invoice.invoiceNumber.trim()) throw new Error(`${label} benötigt eine eindeutige Rechnungsnummer`);
    try {
      const selection = validatePaymentTermSelection(parsed.paymentTermSelection);
      assertPaymentTermDocument(selection, {
        invoiceDate: documentDate(invoice.invoiceDate),
        dueDate: documentDate(invoice.dueDate),
        customerId: (invoice.customerId ?? null) as number | null,
      });
    } catch (error) { throw new Error(`${label}: ${error instanceof Error ? error.message : 'Ungültiger Zahlungsziel-Nachweis'}`); }
  });
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

export function hashBytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function redactSensitiveValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/(?:password|secret|token|keyhash|privatekey|accesskey)/iu.test(key))
    .map(([key, item]) => [key, redactSensitiveValue(item)]));
}

function redactJsonText(value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined) return value;
  try {
    return JSON.stringify(redactSensitiveValue(JSON.parse(value)));
  } catch {
    return '[REDACTED_UNPARSEABLE]';
  }
}

export function redactAuditLog<T extends Record<string, unknown>>(log: T): T {
  return {
    ...log,
    oldValues: redactJsonText(typeof log.oldValues === 'string' ? log.oldValues : null),
    newValues: redactJsonText(typeof log.newValues === 'string' ? log.newValues : null),
    metadata: redactJsonText(typeof log.metadata === 'string' ? log.metadata : null),
  } as T;
}

function coverageCount(data: BackupManifestData, key: string): number {
  const value = data[key];
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return 1;
  return 0;
}

function coverageHash(data: BackupManifestData, key: string): string | undefined {
  const value = data[key];
  if (value === undefined || value === null) return undefined;
  return hashJson(value);
}

export function createBackupManifest(options: {
  sourceUserId: string;
  generatedAt: string;
  data: BackupManifestData;
  fileManifest?: BackupFileManifestEntry[];
  snapshot?: BackupSnapshotInfo;
}): BackupManifest {
  const modelCoverage: BackupCoverageEntry[] = COVERAGE.filter(entry => entry.model !== 'AnnualBusinessContextRevision' || options.data.annualBusinessContextRevisions !== undefined).map((entry) => ({
    ...entry,
    count: coverageCount(options.data, entry.key),
    ...(entry.mode === 'excluded' ? {} : { sha256: coverageHash(options.data, entry.key) }),
  }));
  const auditLogs = options.data.auditLogs ?? [];
  const counters = options.data.invoiceNumberCounters ?? [];
  const backupId = hashJson({
    sourceUserId: options.sourceUserId,
    generatedAt: options.generatedAt,
    auditLogs,
    counters,
    ...(options.snapshot ? { snapshotId: options.snapshot.id } : {}),
  });
  return {
    format: 'bivaro-backup',
    version: CURRENT_BACKUP_VERSION,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    backupId,
    sourceUserId: options.sourceUserId,
    generatedAt: options.generatedAt,
    excludesSecrets: true,
    excludedSecretFields: ['User.password', 'ApiKey.keyHash', 'ApiKey.secret', 'AiProviderSettings.keyCiphertext', 'AiProviderSettings.keyIv', 'AiProviderSettings.keyTag'],
    rekeyRequired: ['ApiKey'],
    modelCoverage,
    auditSegment: {
      key: 'auditLogs',
      count: Array.isArray(auditLogs) ? auditLogs.length : 0,
      sha256: hashJson(auditLogs),
      restoreMode: 'append-only',
    },
    invoiceNumberCounters: {
      key: 'invoiceNumberCounters',
      count: Array.isArray(counters) ? counters.length : 0,
      sha256: hashJson(counters),
      highWaterMark: 'max-existing-imported-historical',
    },
    fileManifest: options.fileManifest ?? [],
    ...(options.snapshot ? { snapshot: options.snapshot } : {}),
  };
}

export function validateBackupManifest(manifest: unknown, data: BackupManifestData): BackupManifest {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Backup-Manifest fehlt oder ist ungültig');
  }
  const value = manifest as Partial<BackupManifest>;
  if (value.format !== 'bivaro-backup' || value.version !== CURRENT_BACKUP_VERSION) {
    throw new Error('Nicht unterstützte Backup-Manifest-Version');
  }
  if (!SUPPORTED_SCHEMAS.includes(value.schemaVersion!) || typeof value.backupId !== 'string' || typeof value.sourceUserId !== 'string' || typeof value.generatedAt !== 'string') {
    throw new Error('Backup-Manifest enthält keine gültige Herkunft');
  }
  if (value.excludesSecrets !== true || !Array.isArray(value.excludedSecretFields) || !value.excludedSecretFields.includes('User.password') || !value.excludedSecretFields.includes('ApiKey.keyHash') || !value.excludedSecretFields.includes('ApiKey.secret') || !Array.isArray(value.rekeyRequired) || !value.rekeyRequired.includes('ApiKey')) {
    throw new Error('Backup-Manifest weist den Secret-Ausschluss nicht nach');
  }
  if (!Array.isArray(value.modelCoverage)) throw new Error('Backup-Manifest enthält keine Modellabdeckung');
  if (data.emailOutbox !== undefined || data.emailOutboxAttempts !== undefined) throw new Error('Versandaufträge und Versuchshistorie dürfen nicht importiert oder reaktiviert werden.');
  if (!backupSchemaSupportsPurchaseValidation(value.schemaVersion) && data.purchaseValidationReports !== undefined) throw new Error('Älteres Backupschema darf keine technischen Eingangsprüfberichte enthalten');
  validationReportsFromBackup(data, backupSchemaSupportsPurchaseValidation(value.schemaVersion));
  bankImportsFromBackup(data, backupSchemaSupportsBankImportEvidence(value.schemaVersion));
  const expectedCoverage = COVERAGE.filter((entry) =>
    (backupSchemaSupportsBankImportEvidence(value.schemaVersion) || !['BankImportBatch', 'BankImportRow'].includes(entry.model)) &&
    (backupSchemaSupportsEmailOutbox(value.schemaVersion) || !['EmailOutbox', 'EmailOutboxAttempt'].includes(entry.model)) &&
    (backupSchemaSupportsPurchaseValidation(value.schemaVersion) || entry.model !== 'PurchaseValidationReport') &&
    (backupSchemaSupportsProjectServiceTimes(value.schemaVersion) || entry.model !== 'ServiceProject')
    && (backupSchemaSupportsPaymentAdjustments(value.schemaVersion) || !['PaymentAdjustment', 'PaymentOperation'].includes(entry.model))
    && (backupSchemaSupportsServiceBilling(value.schemaVersion) || !['ServiceBillingPlan', 'ServiceBillingPeriod'].includes(entry.model))
    && (entry.model !== 'AiProviderSettings' || backupSchemaSupportsAiExtraction(value.schemaVersion))
    && (backupSchemaSupportsDataImport(value.schemaVersion) || !['DataImportBatch', 'ServiceArticle'].includes(entry.model))
    && (value.schemaVersion !== PRE_BILLING_NOTES_SCHEMA_VERSION || entry.model !== 'BillingNote')
    && (PURCHASE_DOCUMENT_SCHEMAS.includes(value.schemaVersion!) || entry.model !== 'PurchaseDocument')
    && (SUPPLIER_SCHEMAS.includes(value.schemaVersion!) || entry.model !== 'Supplier')
    && (backupSchemaSupportsPaymentJournal(value.schemaVersion!) || entry.model !== 'PaymentJournalEvent')
    && (entry.model !== 'AnnualBusinessContextRevision' || (backupSchemaSupportsAnnualContext(value.schemaVersion) && data.annualBusinessContextRevisions !== undefined)));
  validateProjectServiceBackupFields(data, value.schemaVersion);
  validatePaymentTermBackupFields(data, value.schemaVersion);
  if (!backupSchemaSupportsPaymentAdjustments(value.schemaVersion) && (data.paymentAdjustments !== undefined || data.paymentOperations !== undefined)) throw new Error('Älteres Backupschema darf keine Zahlungsberichtigungs- oder Finanzaktionsfelder enthalten');
  if (!backupSchemaSupportsServiceBilling(value.schemaVersion) && (coverageCount(data, 'serviceBillingPlans') > 0 || coverageCount(data, 'serviceBillingPeriods') > 0)) throw new Error('Älteres Backupschema darf keine wiederkehrenden Servicepläne oder Periodenidentitäten enthalten');
  if (data.aiProviderSettings !== undefined || data.aiProviderSecrets !== undefined) throw new Error('Provider-Konfiguration und Schlüsselmaterial sind kein wiederherstellbares Geschäftsbackup');
  if (Array.isArray(data.purchaseDocuments)) data.purchaseDocuments.forEach((document, index) => {
    if (document && typeof document === 'object' && !Array.isArray(document)) validatePurchaseDocumentBackupFields(document as Record<string, unknown>, `purchaseDocuments[${index}]`, value.schemaVersion);
  });
  if (Array.isArray(data.reminders)) for (const [index, reminder] of data.reminders.entries()) {
    if (reminder && typeof reminder === 'object' && !Array.isArray(reminder)) validateReminderBackupFields(reminder as Record<string, unknown>, backupSchemaSupportsReminderBalance(value.schemaVersion), `reminders[${index}]`);
  }
  if (!backupSchemaSupportsAnnualContext(value.schemaVersion) && coverageCount(data, 'annualBusinessContextRevisions') > 0) throw new Error('Älteres Backupschema darf keine Jahreskontexthistorie enthalten');
  if (!REVIEW_DRAFT_SCHEMAS.includes(value.schemaVersion!) && Array.isArray(data.purchaseDocuments) && data.purchaseDocuments.some(item => item && typeof item === 'object' && ((item as Record<string, unknown>).reviewDraft != null || (item as Record<string, unknown>).reviewDraftSavedAt != null || ['image/jpeg', 'image/png'].includes(String((item as Record<string, unknown>).mediaType))))) throw new Error('Älteres Backupschema darf keine Foto- oder Prüfentwurfsdaten enthalten');
  if (!QUOTE_WORKFLOW_SCHEMAS.includes(value.schemaVersion!) && Array.isArray(data.invoices) && data.invoices.some(row => row && typeof row === 'object' && ((row as Record<string, unknown>).quoteFollowUpOn != null || (row as Record<string, unknown>).quoteResponseNote != null))) throw new Error('Älteres Backupschema darf keine Angebots-Wiedervorlage oder Rückmeldungsnotiz enthalten');
  if (QUOTE_WORKFLOW_SCHEMAS.includes(value.schemaVersion!) && Array.isArray(data.invoices) && data.invoices.some(row => row && typeof row === 'object' && (row as Record<string, unknown>).type === 'QUOTE' && (!Object.hasOwn(row, 'quoteFollowUpOn') || !Object.hasOwn(row, 'quoteResponseNote')))) throw new Error('Aktuelles Backupschema benötigt für jedes Angebot beide nullable Wiedervorlage- und Rückmeldungsfelder');
  if (!PURCHASE_DOCUMENT_SCHEMAS.includes(value.schemaVersion!) && coverageCount(data, 'purchaseDocuments') > 0) {
    throw new Error('Ein altes Backup-Manifest darf keine ungebundenen Eingangsbelege enthalten');
  }
  if (!SUPPLIER_SCHEMAS.includes(value.schemaVersion!) && (coverageCount(data, 'suppliers') > 0
    || (Array.isArray(data.purchaseDocuments) && data.purchaseDocuments.some((item) => item && typeof item === 'object' && ((item as Record<string, unknown>).supplierId != null || (item as Record<string, unknown>).selectedSupplierSnapshot != null))))) {
    throw new Error('Ein altes Backup-Manifest darf keine ungebundenen Lieferanten oder Lieferantenauswahlen enthalten');
  }
  if (!backupSchemaSupportsPaymentJournal(value.schemaVersion!) && coverageCount(data, 'paymentJournalEvents') > 0) {
    throw new Error('Ein altes Backup-Manifest darf keine ungebundenen Zahlungsereignisse enthalten');
  }
  if (value.schemaVersion === PRE_BILLING_NOTES_SCHEMA_VERSION && coverageCount(data, 'billingNotes') > 0) {
    throw new Error('Ein altes Backup-Manifest darf keine ungebundenen BillingNotes enthalten');
  }
  if (!backupSchemaSupportsDataImport(value.schemaVersion) && coverageCount(data, 'serviceArticles') > 0) throw new Error('Ein altes Backupschema darf keine ungebundenen Artikel enthalten');
  // These additive sections are mandatory once their model exists in the schema.
  // An absent section is not evidence of an empty collection, even if an attacker
  // recomputes a zero-count coverage entry without a data hash.
  for (const entry of expectedCoverage) {
    if (['PurchaseValidationReport', 'ServiceProject', 'PaymentAdjustment', 'PaymentOperation', 'Supplier', 'PurchaseDocument', 'PaymentJournalEvent', 'ServiceArticle', 'ServiceBillingPlan', 'ServiceBillingPeriod'].includes(entry.model) && !Array.isArray(data[entry.key])) {
      throw new Error(`Backup-Daten enthalten keinen erforderlichen Abschnitt: ${entry.key}`);
    }
  }
  const expectedModels = new Set<string>(expectedCoverage.map((entry) => entry.model));
  const seenModels = new Set<string>();
  for (const item of value.modelCoverage) {
    if (!item || typeof item !== 'object') throw new Error('Backup-Manifest enthält einen ungültigen Modelleintag');
    const entry = item as BackupCoverageEntry;
    if (typeof entry.model !== 'string' || !expectedModels.has(entry.model) || seenModels.has(entry.model)) {
      throw new Error(`Backup-Manifest enthält ein unbekanntes oder doppeltes Modell: ${String(entry.model)}`);
    }
    seenModels.add(entry.model);
    if (!Number.isSafeInteger(entry.count) || entry.count < 0) throw new Error(`Backup-Manifest count für ${entry.model} ist ungültig`);
    const definition = expectedCoverage.find((candidate) => candidate.model === entry.model)!;
    if (entry.key !== definition.key || entry.mode !== definition.mode) throw new Error(`Backup-Manifest Abdeckung für ${entry.model} stimmt nicht mit dem Vertrag überein`);
    if (entry.mode !== 'excluded' && entry.count !== coverageCount(data, entry.key)) throw new Error(`Backup-Manifest count für ${entry.model} stimmt nicht mit den Daten überein`);
    if (entry.mode !== 'excluded' && entry.sha256 !== coverageHash(data, entry.key)) throw new Error(`Backup-Manifest Hash für ${entry.model} stimmt nicht mit den Daten überein`);
  }
  if (seenModels.size !== expectedCoverage.length) throw new Error('Backup-Manifest ist nicht vollständig');
  if (!value.auditSegment || value.auditSegment.count !== coverageCount(data, 'auditLogs') || value.auditSegment.sha256 !== coverageHash(data, 'auditLogs')) {
    throw new Error('Backup-Manifest Auditsegment stimmt nicht mit den Daten überein');
  }
  if (!value.invoiceNumberCounters || value.invoiceNumberCounters.count !== coverageCount(data, 'invoiceNumberCounters') || value.invoiceNumberCounters.sha256 !== coverageHash(data, 'invoiceNumberCounters')) {
    throw new Error('Backup-Manifest Nummernzähler stimmt nicht mit den Daten überein');
  }
  if (!Array.isArray(value.fileManifest)) throw new Error('Backup-Manifest Dateimanifest fehlt');
  const seenFiles = new Set<string>();
  for (const item of value.fileManifest) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Backup-Manifest enthält einen ungültigen Dateieintrag');
    const file = item as BackupFileManifestEntry;
    if (!['invoice', 'receipt', 'logo', 'purchase-document'].includes(file.kind) || typeof file.sourceName !== 'string' || file.sourceName.length === 0) {
      throw new Error('Backup-Manifest Dateieintrag enthält keine gültige Quelle');
    }
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/iu.test(file.sha256)) {
      throw new Error(`Backup-Manifest Dateieintrag für ${file.sourceName} ist ungültig`);
    }
    if (file.zipPath !== undefined && (typeof file.zipPath !== 'string' || !/^(?:invoices|receipts|logos|purchase-documents)\/[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u.test(file.zipPath))) {
      throw new Error(`Backup-Manifest Dateipfad für ${file.sourceName} ist ungültig`);
    }
    if (file.sourceVersion !== undefined && (typeof file.sourceVersion !== 'string' || file.sourceVersion.length === 0)) {
      throw new Error(`Backup-Manifest Dateiversion für ${file.sourceName} ist ungültig`);
    }
    const fileKey = `${file.kind}:${file.sourceName}`;
    if (seenFiles.has(fileKey)) throw new Error(`Backup-Manifest enthält die Datei doppelt: ${fileKey}`);
    seenFiles.add(fileKey);
  }
  if (value.snapshot !== undefined) {
    const snapshot = value.snapshot;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
      || typeof snapshot.id !== 'string' || !/^[a-f0-9]{64}$/iu.test(snapshot.id)
      || typeof snapshot.startedAt !== 'string' || Number.isNaN(Date.parse(snapshot.startedAt))
      || typeof snapshot.endedAt !== 'string' || Number.isNaN(Date.parse(snapshot.endedAt))
      || Date.parse(snapshot.endedAt) < Date.parse(snapshot.startedAt)
      || snapshot.consistency !== 'single-read-transaction') {
      throw new Error('Backup-Manifest Snapshotangaben sind ungültig');
    }
  }
  const expectedBackupId = hashJson({
    sourceUserId: value.sourceUserId,
    generatedAt: value.generatedAt,
    auditLogs: data.auditLogs ?? [],
    counters: data.invoiceNumberCounters ?? [],
    ...(value.snapshot ? { snapshotId: value.snapshot.id } : {}),
  });
  if (value.backupId !== expectedBackupId) throw new Error('Backup-Manifest ist nicht an Auditsegment und Nummernzähler gebunden');
  return value as BackupManifest;
}

export function manifestWarning(version: string): string | null {
  if (version === LEGACY_BACKUP_VERSION) {
    return 'Legacy-Backup 2.0 ohne Manifest, Auditsegment und Nummernzähler; Vollständigkeit und historische High-Water-Marks sind nicht nachgewiesen.';
  }
  return null;
}
