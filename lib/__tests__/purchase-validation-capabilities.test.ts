import { describe, expect, it } from 'vitest';
import { BACKUP_FEATURE_CAPABILITIES, CURRENT_SCHEMA_VERSION, DURABLE_EMAIL_OUTBOX_SCHEMA_VERSION, PAYMENT_ADJUSTMENTS_SCHEMA_VERSION, PROJECT_OUTBOX_SCHEMA_VERSION, PROJECT_PURCHASE_VALIDATION_SCHEMA_VERSION, PROJECT_SERVICE_TIMES_SCHEMA_VERSION, PURCHASE_VALIDATION_SCHEMA_VERSION, backupSchemaSupportsEmailOutbox, backupSchemaSupportsProjectServiceTimes, backupSchemaSupportsPurchaseValidation, validateProjectServiceBackupFields } from '@/lib/backup-manifest';

describe('exact project / incoming-validation backup capability union', () => {
  it('preserves both standalone meanings and never infers features from timestamps', () => {
    const matrix = [
      [CURRENT_SCHEMA_VERSION, true, true, true],
      [PROJECT_OUTBOX_SCHEMA_VERSION, true, true, false],
      [PROJECT_PURCHASE_VALIDATION_SCHEMA_VERSION, true, false, true],
      [PURCHASE_VALIDATION_SCHEMA_VERSION, false, false, true],
      [DURABLE_EMAIL_OUTBOX_SCHEMA_VERSION, false, true, false],
      [PROJECT_SERVICE_TIMES_SCHEMA_VERSION, true, false, false],
      [PAYMENT_ADJUSTMENTS_SCHEMA_VERSION, false, false, false],
      ['20991231000000_future', false, false, false],
    ] as const;
    for (const [schema, project, outbox, validation] of matrix) {
      expect(backupSchemaSupportsProjectServiceTimes(schema)).toBe(project);
      expect(backupSchemaSupportsEmailOutbox(schema)).toBe(outbox);
      expect(backupSchemaSupportsPurchaseValidation(schema)).toBe(validation);
    }
    expect(BACKUP_FEATURE_CAPABILITIES[CURRENT_SCHEMA_VERSION]).toMatchObject({ projectServiceTimes: true, emailOutbox: true, purchaseValidationReports: true, paymentAdjustments: true });
  });
  it('keeps project-capture fields forbidden under the validation-only schema', () => {
    expect(() => validateProjectServiceBackupFields({ serviceProjects: [], billingNotes: [] }, PURCHASE_VALIDATION_SCHEMA_VERSION)).toThrow();
    expect(() => validateProjectServiceBackupFields({ serviceProjects: [], billingNotes: [] }, CURRENT_SCHEMA_VERSION)).not.toThrow();
  });
});
