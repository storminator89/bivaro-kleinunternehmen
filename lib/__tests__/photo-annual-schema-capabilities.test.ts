import { describe, expect, it } from 'vitest';
import { ANNUAL_CONTEXT_SCHEMA_VERSION, BACKUP_FEATURE_CAPABILITIES, COMBINED_PHOTO_ANNUAL_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION, MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION, PRE_MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION, PRE_PAYMENT_JOURNAL_SCHEMA_VERSION, backupSchemaSupportsAiExtraction, backupSchemaSupportsAnnualContext, backupSchemaSupportsManualPhotoApproval, createBackupManifest, validateBackupManifest, validatePurchaseDocumentBackupFields } from '@/lib/backup-manifest';

const annual = { version: 1, revision: 1, provenance: 'USER_DECLARED', declaredAt: '2026-10-21T01:02:03.004Z', contextYear: 2026, effectiveFrom: '2026-01-01', foundingYear: null, previousYearTurnoverCents: null, previousYearExternalTurnoverCents: null, completeness: 'UNKNOWN', sourceNote: 'Synthetic own records' };
const emptyData = () => ({ suppliers: [], expenses: [], incomes: [], invoices: [], purchaseDocuments: [] as Record<string, unknown>[], paymentJournalEvents: [], auditLogs: [], invoiceNumberCounters: [] });
const packed = (data: Record<string, unknown>, schemaVersion: string) => {
  const manifest = createBackupManifest({ sourceUserId: 'synthetic-schema-source', generatedAt: annual.declaredAt, data });
  return { ...manifest, schemaVersion, modelCoverage: backupSchemaSupportsAiExtraction(schemaVersion) ? manifest.modelCoverage : manifest.modelCoverage.filter(entry => entry.model !== 'AiProviderSettings') };
};

describe('immutable standalone and combined backup capability identities', () => {
  it.each([
    [PRE_MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION, false, false],
    [MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION, true, false],
    [ANNUAL_CONTEXT_SCHEMA_VERSION, false, true],
    [COMBINED_PHOTO_ANNUAL_SCHEMA_VERSION, true, true],
    [CURRENT_SCHEMA_VERSION, true, true],
  ] as const)('preserves exact photo/annual semantics under %s', (schema, photo, context) => {
    expect(backupSchemaSupportsManualPhotoApproval(schema)).toBe(photo);
    expect(backupSchemaSupportsAnnualContext(schema)).toBe(context);
    expect(backupSchemaSupportsAiExtraction(schema)).toBe(schema === CURRENT_SCHEMA_VERSION);
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
  it('requires a genuine pre-journal fixture to omit only unavailable journal and provider coverage', () => {
    const data = emptyData();
    const current = createBackupManifest({ sourceUserId: 'synthetic-schema-source', generatedAt: annual.declaredAt, data });
    const malformed = { ...current, schemaVersion: PRE_PAYMENT_JOURNAL_SCHEMA_VERSION, modelCoverage: current.modelCoverage.filter(entry => entry.model !== 'PaymentJournalEvent') };
    expect(() => validateBackupManifest(malformed, data)).toThrow(/Modelleintrag|Modell/);
    const historical = { ...malformed, modelCoverage: malformed.modelCoverage.filter(entry => entry.model !== 'AiProviderSettings') };
    expect(() => validateBackupManifest(historical, data)).not.toThrow();
    expect(historical.modelCoverage).toEqual(current.modelCoverage.filter(entry => entry.model !== 'PaymentJournalEvent' && entry.model !== 'AiProviderSettings'));
  });
  it('never guesses future, CSV, quote or EÜR capabilities and keeps legacy absence harmless', () => {
    expect(Object.keys(BACKUP_FEATURE_CAPABILITIES).sort()).toEqual([PRE_MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION, MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION, ANNUAL_CONTEXT_SCHEMA_VERSION, COMBINED_PHOTO_ANNUAL_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION].sort());
    for (const schema of [undefined, 'future', '20261021090000_csv', '20261021100000_quotes']) {
      expect(backupSchemaSupportsAnnualContext(schema)).toBe(false); expect(backupSchemaSupportsManualPhotoApproval(schema)).toBe(false);
      expect(() => validatePurchaseDocumentBackupFields({ reviewedSourceSnapshot: {} }, 'source', schema)).toThrow(/reviewedSourceSnapshot/);
      expect(() => validatePurchaseDocumentBackupFields({ reviewedSourceSnapshot: null }, 'source', schema)).not.toThrow();
    }
    const data = emptyData(); expect(() => validateBackupManifest(packed(data, 'future'), data)).toThrow(/Herkunft/);
  });
});
