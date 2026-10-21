import { stripEmptyPaymentAdjustmentsForLegacy } from './helpers/backup-schema';
import { createBackupManifest } from './helpers/backup';
import { REMINDER_BALANCE_SCHEMA_VERSION } from '@/lib/reminder-backup';
import { describe, expect, it } from 'vitest';
import { ANNUAL_CONTEXT_SCHEMA_VERSION, PROJECT_OUTBOX_SCHEMA_VERSION, PROJECT_PURCHASE_VALIDATION_SCHEMA_VERSION, DURABLE_EMAIL_OUTBOX_SCHEMA_VERSION, backupSchemaSupportsEmailOutbox, PURCHASE_VALIDATION_SCHEMA_VERSION, PROJECT_SERVICE_TIMES_SCHEMA_VERSION, PAYMENT_ADJUSTMENTS_SCHEMA_VERSION, backupSchemaSupportsProjectServiceTimes, RECURRING_BALANCE_DAILY_SCHEMA_VERSION, PRE_PAYMENT_JOURNAL_SCHEMA_VERSION, GROWTH_SCHEMA_VERSION, GROWTH_AI_SCHEMA_VERSION, GROWTH_AI_REMINDER_SCHEMA_VERSION, RECURRING_SERVICE_SCHEMA_VERSION, backupSchemaSupportsServiceBilling, AI_RECEIPT_EXTRACTION_SCHEMA_VERSION, backupSchemaSupportsAiExtraction, COMBINED_PHOTO_ANNUAL_SCHEMA_VERSION, DATA_IMPORT_SCHEMA_VERSION, QUOTE_WORKFLOW_SCHEMA_VERSION, backupSchemaSupportsDataImport, QUOTE_WORKFLOW_SCHEMAS, BACKUP_FEATURE_CAPABILITIES, CURRENT_SCHEMA_VERSION, MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION, PRE_MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION, backupSchemaSupportsAnnualContext, backupSchemaSupportsReminderBalance, backupSchemaSupportsManualPhotoApproval, validateBackupManifest, validatePurchaseDocumentBackupFields } from '@/lib/backup-manifest';

const annual = { version: 1, revision: 1, provenance: 'USER_DECLARED', declaredAt: '2026-10-21T01:02:03.004Z', contextYear: 2026, effectiveFrom: '2026-01-01', foundingYear: null, previousYearTurnoverCents: null, previousYearExternalTurnoverCents: null, completeness: 'UNKNOWN', sourceNote: 'Synthetic own records' };
const emptyData = () => ({ suppliers: [], expenses: [], incomes: [], invoices: [], purchaseDocuments: [] as Record<string, unknown>[], serviceBillingPlans: [], serviceBillingPeriods: [], serviceArticles: [], paymentJournalEvents: [], auditLogs: [], invoiceNumberCounters: [] });
const packed = (data: Record<string, unknown>, schemaVersion: string) => {
  const manifest = { ...createBackupManifest({ sourceUserId: 'synthetic-schema-source', generatedAt: annual.declaredAt, data }), schemaVersion };
  stripEmptyPaymentAdjustmentsForLegacy({ data, manifest });
  if (!backupSchemaSupportsDataImport(schemaVersion)) manifest.modelCoverage = manifest.modelCoverage.filter(row => !['ServiceArticle', 'DataImportBatch'].includes(row.model));
  if (!backupSchemaSupportsServiceBilling(schemaVersion)) manifest.modelCoverage = manifest.modelCoverage.filter(row => !['ServiceBillingPlan', 'ServiceBillingPeriod'].includes(row.model));
  if (!backupSchemaSupportsAiExtraction(schemaVersion)) manifest.modelCoverage = manifest.modelCoverage.filter(row => row.model !== 'AiProviderSettings');
  return manifest;
};

describe('immutable standalone and combined backup capability identities', () => {
  it.each([
    [PRE_MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION, false, false],
    [MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION, true, false],
    [ANNUAL_CONTEXT_SCHEMA_VERSION, false, true],
    [COMBINED_PHOTO_ANNUAL_SCHEMA_VERSION, true, true],
    [DATA_IMPORT_SCHEMA_VERSION, false, false],
    [QUOTE_WORKFLOW_SCHEMA_VERSION, false, false],
    [GROWTH_SCHEMA_VERSION, true, true],
    [AI_RECEIPT_EXTRACTION_SCHEMA_VERSION, true, true],
    [GROWTH_AI_SCHEMA_VERSION, true, true],
    [GROWTH_AI_REMINDER_SCHEMA_VERSION, true, true],
    [RECURRING_SERVICE_SCHEMA_VERSION, true, true],
    [REMINDER_BALANCE_SCHEMA_VERSION, true, true],
    [PAYMENT_ADJUSTMENTS_SCHEMA_VERSION, true, true],
    [PROJECT_SERVICE_TIMES_SCHEMA_VERSION, true, true],
    [PURCHASE_VALIDATION_SCHEMA_VERSION, true, true],
    [DURABLE_EMAIL_OUTBOX_SCHEMA_VERSION, true, true],
    [PROJECT_OUTBOX_SCHEMA_VERSION, true, true],
    [PROJECT_PURCHASE_VALIDATION_SCHEMA_VERSION, true, true],
    [CURRENT_SCHEMA_VERSION, true, true],
  ] as const)('preserves exact photo/annual semantics under %s', (schema, photo, context) => {
    expect(backupSchemaSupportsManualPhotoApproval(schema)).toBe(photo);
    expect(backupSchemaSupportsAnnualContext(schema)).toBe(context);
    expect(backupSchemaSupportsAiExtraction(schema)).toBe([CURRENT_SCHEMA_VERSION, PROJECT_OUTBOX_SCHEMA_VERSION, PROJECT_PURCHASE_VALIDATION_SCHEMA_VERSION, DURABLE_EMAIL_OUTBOX_SCHEMA_VERSION, PURCHASE_VALIDATION_SCHEMA_VERSION, PROJECT_SERVICE_TIMES_SCHEMA_VERSION, PAYMENT_ADJUSTMENTS_SCHEMA_VERSION, RECURRING_BALANCE_DAILY_SCHEMA_VERSION, GROWTH_AI_REMINDER_SCHEMA_VERSION, RECURRING_SERVICE_SCHEMA_VERSION, GROWTH_AI_SCHEMA_VERSION, AI_RECEIPT_EXTRACTION_SCHEMA_VERSION].includes(schema));
    expect(Object.isFrozen(BACKUP_FEATURE_CAPABILITIES[schema])).toBe(true);
    const empty = emptyData(); expect(() => validateBackupManifest(packed(empty, schema), empty)).not.toThrow();
    const annualData = { ...emptyData(), annualBusinessContextRevisions: [annual] };
    if (context) expect(() => validateBackupManifest(packed(annualData, schema), annualData)).not.toThrow();
    else expect(() => validateBackupManifest(packed(annualData, schema), annualData)).toThrow(/Jahreskontexthistorie/);
    // Shape semantics are validated separately by restore; registry must not
    // discard capability evidence or admit it under a recomputed old identity.
    const evidence = { reviewedSourceSnapshot: { provenance: 'MANUAL_PHOTO_REVIEW' } };
    if (photo) expect(() => validatePurchaseDocumentBackupFields(evidence, 'source', schema)).not.toThrow();
    else expect(() => validatePurchaseDocumentBackupFields(evidence, 'source', schema)).toThrow(/reviewedSourceSnapshot/);
    expect(() => validatePurchaseDocumentBackupFields({ futureApprovalEvidence: true }, 'source', schema)).toThrow(/Nicht unterstütztes Eingangsbelegfeld/);
  });
  it.each([
    [PRE_MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION, false, false],
    [MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION, false, false],
    [ANNUAL_CONTEXT_SCHEMA_VERSION, false, false],
    [COMBINED_PHOTO_ANNUAL_SCHEMA_VERSION, false, false],
    [DATA_IMPORT_SCHEMA_VERSION, true, false],
    [QUOTE_WORKFLOW_SCHEMA_VERSION, false, true],
    [GROWTH_SCHEMA_VERSION, true, true],
    [AI_RECEIPT_EXTRACTION_SCHEMA_VERSION, false, false],
    [GROWTH_AI_SCHEMA_VERSION, true, true],
    [GROWTH_AI_REMINDER_SCHEMA_VERSION, true, true],
    [RECURRING_SERVICE_SCHEMA_VERSION, true, true],
    [REMINDER_BALANCE_SCHEMA_VERSION, false, false],
    [PAYMENT_ADJUSTMENTS_SCHEMA_VERSION, true, true],
    [PROJECT_SERVICE_TIMES_SCHEMA_VERSION, true, true],
    [PURCHASE_VALIDATION_SCHEMA_VERSION, true, true],
    [DURABLE_EMAIL_OUTBOX_SCHEMA_VERSION, true, true],
    [PROJECT_OUTBOX_SCHEMA_VERSION, true, true],
    [PROJECT_PURCHASE_VALIDATION_SCHEMA_VERSION, true, true],
    [CURRENT_SCHEMA_VERSION, true, true],
  ] as const)('keeps exact catalog and quote capabilities separate under %s', (schema, catalog, quote) => {
    expect(backupSchemaSupportsDataImport(schema)).toBe(catalog);
    expect(QUOTE_WORKFLOW_SCHEMAS.includes(schema)).toBe(quote);
    const articleData = { ...emptyData(), serviceArticles: [{ id: 1, name: 'Synthetic catalog evidence' }] };
    const articleManifest = packed(articleData, schema);
    if (catalog) expect(() => validateBackupManifest(articleManifest, articleData)).not.toThrow();
    else expect(() => validateBackupManifest(articleManifest, articleData)).toThrow(/Artikel/);
    const quoteData = { ...emptyData(), invoices: [{ type: 'QUOTE', quoteFollowUpOn: '2026-12-31', quoteResponseNote: 'Manual owner response, not acceptance' }] };
    const quoteManifest = packed(quoteData, schema);
    if (quote) expect(() => validateBackupManifest(quoteManifest, quoteData)).not.toThrow();
    else expect(() => validateBackupManifest(quoteManifest, quoteData)).toThrow(/Angebots-Wiedervorlage/);
    // Same numeric timestamp does not confer either exact schema's capabilities.
    expect(backupSchemaSupportsDataImport(`${schema}_unknown`)).toBe(false);
    expect(QUOTE_WORKFLOW_SCHEMAS.includes(`${schema}_unknown`)).toBe(false);
  });
  it.each(Object.keys(BACKUP_FEATURE_CAPABILITIES))('rejects non-null AI evidence under every non-AI identity %s', schema => {
    const supportsAi = [CURRENT_SCHEMA_VERSION, PROJECT_OUTBOX_SCHEMA_VERSION, PROJECT_PURCHASE_VALIDATION_SCHEMA_VERSION, DURABLE_EMAIL_OUTBOX_SCHEMA_VERSION, PURCHASE_VALIDATION_SCHEMA_VERSION, PROJECT_SERVICE_TIMES_SCHEMA_VERSION, PAYMENT_ADJUSTMENTS_SCHEMA_VERSION, RECURRING_BALANCE_DAILY_SCHEMA_VERSION, GROWTH_AI_REMINDER_SCHEMA_VERSION, RECURRING_SERVICE_SCHEMA_VERSION, GROWTH_AI_SCHEMA_VERSION, AI_RECEIPT_EXTRACTION_SCHEMA_VERSION].includes(schema);
    expect(backupSchemaSupportsAiExtraction(schema)).toBe(supportsAi);
    for (const field of ['aiExtraction', 'aiDraftProvenance', 'aiApprovedSnapshot']) {
      const evidence = { [field]: { retained: 'synthetic evidence' } };
      if (supportsAi) expect(() => validatePurchaseDocumentBackupFields(evidence, 'source', schema)).not.toThrow();
      else expect(() => validatePurchaseDocumentBackupFields(evidence, 'source', schema)).toThrow(/KI-Herkunft/);
      expect(() => validatePurchaseDocumentBackupFields({ [field]: null }, 'source', schema)).not.toThrow();
    }
  });
  it('requires a genuine pre-journal fixture to omit unavailable journal, provider and catalog coverage', () => {
    const data = emptyData();
    const current = createBackupManifest({ sourceUserId: 'synthetic-schema-source', generatedAt: annual.declaredAt, data });
    const malformed = { ...current, schemaVersion: PRE_PAYMENT_JOURNAL_SCHEMA_VERSION, modelCoverage: current.modelCoverage.filter(entry => entry.model !== 'PaymentJournalEvent') };
    stripEmptyPaymentAdjustmentsForLegacy({ data, manifest: malformed });
    expect(() => validateBackupManifest(malformed, data)).toThrow(/Modelleintrag|Modell/);
    const historical = { ...malformed, modelCoverage: malformed.modelCoverage.filter(entry => !['AiProviderSettings', 'ServiceArticle', 'DataImportBatch', 'ServiceBillingPlan', 'ServiceBillingPeriod', 'ServiceProject'].includes(entry.model)) };
    expect(() => validateBackupManifest(historical, data)).not.toThrow();
    expect(historical.modelCoverage).toEqual(current.modelCoverage.filter(entry => !['EmailOutbox', 'EmailOutboxAttempt', 'PurchaseValidationReport', 'PaymentAdjustment', 'PaymentOperation', 'PaymentJournalEvent', 'AiProviderSettings', 'ServiceArticle', 'DataImportBatch', 'ServiceBillingPlan', 'ServiceBillingPeriod', 'ServiceProject'].includes(entry.model)));
  });
  it('keeps exact outbox-only, project-outbox and project-validation histories distinct', () => {
    for (const schema of Object.keys(BACKUP_FEATURE_CAPABILITIES)) expect(backupSchemaSupportsEmailOutbox(schema)).toBe([CURRENT_SCHEMA_VERSION, PROJECT_OUTBOX_SCHEMA_VERSION, DURABLE_EMAIL_OUTBOX_SCHEMA_VERSION].includes(schema));
    expect(backupSchemaSupportsProjectServiceTimes(DURABLE_EMAIL_OUTBOX_SCHEMA_VERSION)).toBe(false);
    expect(backupSchemaSupportsEmailOutbox(PROJECT_SERVICE_TIMES_SCHEMA_VERSION)).toBe(false);
    expect(backupSchemaSupportsEmailOutbox(PROJECT_PURCHASE_VALIDATION_SCHEMA_VERSION)).toBe(false);
    expect(backupSchemaSupportsEmailOutbox(PURCHASE_VALIDATION_SCHEMA_VERSION)).toBe(false);
  });
  it('never guesses future, CSV, quote or EÜR capabilities and keeps legacy absence harmless', () => {
    expect(new Set(Object.keys(BACKUP_FEATURE_CAPABILITIES)).size).toBe(20);
    for (const schema of Object.keys(BACKUP_FEATURE_CAPABILITIES)) expect(backupSchemaSupportsProjectServiceTimes(schema)).toBe([CURRENT_SCHEMA_VERSION, PROJECT_OUTBOX_SCHEMA_VERSION, PROJECT_PURCHASE_VALIDATION_SCHEMA_VERSION, PROJECT_SERVICE_TIMES_SCHEMA_VERSION].includes(schema));
    for (const schema of Object.keys(BACKUP_FEATURE_CAPABILITIES)) expect(backupSchemaSupportsReminderBalance(schema)).toBe([CURRENT_SCHEMA_VERSION, PROJECT_OUTBOX_SCHEMA_VERSION, PROJECT_PURCHASE_VALIDATION_SCHEMA_VERSION, DURABLE_EMAIL_OUTBOX_SCHEMA_VERSION, PURCHASE_VALIDATION_SCHEMA_VERSION, PROJECT_SERVICE_TIMES_SCHEMA_VERSION, PAYMENT_ADJUSTMENTS_SCHEMA_VERSION, RECURRING_BALANCE_DAILY_SCHEMA_VERSION, GROWTH_AI_REMINDER_SCHEMA_VERSION, REMINDER_BALANCE_SCHEMA_VERSION].includes(schema));
    for (const schema of Object.keys(BACKUP_FEATURE_CAPABILITIES)) expect(backupSchemaSupportsServiceBilling(schema)).toBe([CURRENT_SCHEMA_VERSION, PROJECT_OUTBOX_SCHEMA_VERSION, PROJECT_PURCHASE_VALIDATION_SCHEMA_VERSION, DURABLE_EMAIL_OUTBOX_SCHEMA_VERSION, PURCHASE_VALIDATION_SCHEMA_VERSION, PROJECT_SERVICE_TIMES_SCHEMA_VERSION, PAYMENT_ADJUSTMENTS_SCHEMA_VERSION, RECURRING_BALANCE_DAILY_SCHEMA_VERSION, RECURRING_SERVICE_SCHEMA_VERSION].includes(schema));
    for (const schema of [undefined, 'future', '20261021090000_csv', '20261021100000_quotes']) {
      expect(backupSchemaSupportsAnnualContext(schema)).toBe(false); expect(backupSchemaSupportsManualPhotoApproval(schema)).toBe(false);
      expect(() => validatePurchaseDocumentBackupFields({ reviewedSourceSnapshot: {} }, 'source', schema)).toThrow(/reviewedSourceSnapshot/);
      expect(() => validatePurchaseDocumentBackupFields({ reviewedSourceSnapshot: null }, 'source', schema)).not.toThrow();
    }
    const data = emptyData(); expect(() => validateBackupManifest(packed(data, 'future'), data)).toThrow(/Herkunft/);
  });
});
