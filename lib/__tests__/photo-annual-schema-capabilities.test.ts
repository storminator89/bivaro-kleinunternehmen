import { describe, expect, it } from 'vitest';
import { ANNUAL_CONTEXT_SCHEMA_VERSION, BACKUP_FEATURE_CAPABILITIES, CURRENT_SCHEMA_VERSION, MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION, PRE_MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION, backupSchemaSupportsAnnualContext, backupSchemaSupportsManualPhotoApproval, createBackupManifest, validateBackupManifest, validatePurchaseDocumentBackupFields } from '@/lib/backup-manifest';

const annual = { version: 1, revision: 1, provenance: 'USER_DECLARED', declaredAt: '2026-10-21T01:02:03.004Z', contextYear: 2026, effectiveFrom: '2026-01-01', foundingYear: null, previousYearTurnoverCents: null, previousYearExternalTurnoverCents: null, completeness: 'UNKNOWN', sourceNote: 'Synthetic own records' };
const emptyData = () => ({ suppliers: [], expenses: [], incomes: [], invoices: [], purchaseDocuments: [] as Record<string, unknown>[], paymentJournalEvents: [], auditLogs: [], invoiceNumberCounters: [] });
const packed = (data: Record<string, unknown>, schemaVersion: string) => ({ ...createBackupManifest({ sourceUserId: 'synthetic-schema-source', generatedAt: annual.declaredAt, data }), schemaVersion });

describe('immutable standalone and combined backup capability identities', () => {
  it.each([
    [PRE_MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION, false, false],
    [MANUAL_PHOTO_APPROVAL_SCHEMA_VERSION, true, false],
    [ANNUAL_CONTEXT_SCHEMA_VERSION, false, true],
    [CURRENT_SCHEMA_VERSION, true, true],
  ] as const)('preserves exact photo/annual semantics under %s', (schema, photo, context) => {
    expect(backupSchemaSupportsManualPhotoApproval(schema)).toBe(photo);
    expect(backupSchemaSupportsAnnualContext(schema)).toBe(context);
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
  it('never guesses future, CSV, quote or EÜR capabilities and keeps legacy absence harmless', () => {
    expect(new Set(Object.keys(BACKUP_FEATURE_CAPABILITIES)).size).toBe(4);
    for (const schema of [undefined, 'future', '20261021090000_csv', '20261021100000_quotes']) {
      expect(backupSchemaSupportsAnnualContext(schema)).toBe(false); expect(backupSchemaSupportsManualPhotoApproval(schema)).toBe(false);
      expect(() => validatePurchaseDocumentBackupFields({ reviewedSourceSnapshot: {} }, 'source', schema)).toThrow(/reviewedSourceSnapshot/);
      expect(() => validatePurchaseDocumentBackupFields({ reviewedSourceSnapshot: null }, 'source', schema)).not.toThrow();
    }
    const data = emptyData(); expect(() => validateBackupManifest(packed(data, 'future'), data)).toThrow(/Herkunft/);
  });
});
