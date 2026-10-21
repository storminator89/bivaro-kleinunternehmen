import { describe, expect, it } from 'vitest';
import { BACKUP_FEATURE_CAPABILITIES, CURRENT_SCHEMA_VERSION, PAYMENT_ADJUSTMENTS_SCHEMA_VERSION, PROJECT_SERVICE_TIMES_SCHEMA_VERSION, PURCHASE_VALIDATION_SCHEMA_VERSION, backupSchemaSupportsProjectServiceTimes, backupSchemaSupportsPurchaseValidation, validateProjectServiceBackupFields } from '@/lib/backup-manifest';

describe('exact project / incoming-validation backup capability union', () => {
  it('preserves both standalone meanings and never infers features from timestamps', () => {
    const matrix = [
      [CURRENT_SCHEMA_VERSION, true, true],
      [PURCHASE_VALIDATION_SCHEMA_VERSION, false, true],
      [PROJECT_SERVICE_TIMES_SCHEMA_VERSION, true, false],
      [PAYMENT_ADJUSTMENTS_SCHEMA_VERSION, false, false],
      ['20991231000000_future', false, false],
    ] as const;
    for (const [schema, project, validation] of matrix) {
      expect(backupSchemaSupportsProjectServiceTimes(schema)).toBe(project);
      expect(backupSchemaSupportsPurchaseValidation(schema)).toBe(validation);
    }
    expect(BACKUP_FEATURE_CAPABILITIES[CURRENT_SCHEMA_VERSION]).toMatchObject({ projectServiceTimes: true, purchaseValidationReports: true, paymentAdjustments: true });
  });
  it('keeps project-capture fields forbidden under the validation-only schema', () => {
    expect(() => validateProjectServiceBackupFields({ serviceProjects: [], billingNotes: [] }, PURCHASE_VALIDATION_SCHEMA_VERSION)).toThrow();
    expect(() => validateProjectServiceBackupFields({ serviceProjects: [], billingNotes: [] }, CURRENT_SCHEMA_VERSION)).not.toThrow();
  });
});
