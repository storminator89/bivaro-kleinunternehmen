import { describe, expect, it, vi } from 'vitest';
import { preJournalBackup } from '../../e2e/helpers/pre-journal-backup';
import { createBackupManifest, PRE_PAYMENT_JOURNAL_SCHEMA_VERSION } from '@/lib/backup-manifest';
import { createBackupPreview } from '@/lib/backup-preview';

// Preview is pure validation; a fixture probe must never query an application DB.
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

describe('real-browser historical restore fixtures keep their exact original capability', () => {
  it.each([[null, true], ['   ', true], ['SYNTHETIC-OLD', false]] as const)('keeps the self-contained source byte-semantically equal to the original historical conversion %j/%j', (invoiceNumber, withIncome) => {
    const backup = preJournalBackup('3.0', invoiceNumber, withIncome);
    const expected = createBackupManifest({ sourceUserId: backup.data.user.id, generatedAt: backup.exportedAt, data: backup.data });
    expected.schemaVersion = PRE_PAYMENT_JOURNAL_SCHEMA_VERSION;
    expected.modelCoverage = expected.modelCoverage.filter(entry => !['ManualFinancialRecordEvent', 'BankMappingProfile', 'BankMappingProfileRevision', 'DocumentNumberingPolicy', 'QuoteCreateReceipt', 'BankPaymentBinding', 'PaymentAllocationChange', 'BankImportBatch', 'BankImportRow', 'EmailOutbox', 'EmailOutboxAttempt', 'PurchaseValidationReport', 'PaymentJournalEvent', 'PaymentAdjustment', 'PaymentOperation', 'AiProviderSettings', 'ServiceArticle', 'DataImportBatch', 'ServiceBillingPlan', 'ServiceBillingPeriod', 'ServiceProject'].includes(entry.model));
    expect(backup.manifest).toEqual(expected);
    expect(() => createBackupPreview(backup)).not.toThrow();
  });
  it.each(['2.0', '3.0'] as const)('accepts the actual pre-journal %s preview without advertising new payment models', version => {
    const backup = preJournalBackup(version);
    expect(createBackupPreview(backup)).toMatchObject({ version, counts: { invoices: 1, incomes: 1 } });
    expect(backup.data).not.toHaveProperty('bankPaymentBindings');
    expect(backup.data).not.toHaveProperty('paymentAllocationChanges');
    expect(backup.data).not.toHaveProperty('bankImportBatches');
    expect(backup.data).not.toHaveProperty('bankImportRows');
    expect(backup.data).not.toHaveProperty('paymentAdjustments');
    expect(backup.data).not.toHaveProperty('paymentOperations');
    expect(backup.data).not.toHaveProperty('purchaseValidationReports');
    expect(backup.data).not.toHaveProperty('emailOutbox');
    expect(backup.data).not.toHaveProperty('emailOutboxAttempts');
    expect(backup.manifest?.modelCoverage.some(entry => ['BankMappingProfile', 'BankMappingProfileRevision', 'DocumentNumberingPolicy', 'QuoteCreateReceipt', 'BankPaymentBinding', 'PaymentAllocationChange', 'BankImportBatch', 'BankImportRow', 'EmailOutbox', 'EmailOutboxAttempt', 'PurchaseValidationReport', 'PaymentAdjustment', 'PaymentOperation'].includes(entry.model))).not.toBe(true);
  });
  it.each([['BankPaymentBinding', 'bankPaymentBindings', 'included'], ['PaymentAllocationChange', 'paymentAllocationChanges', 'included'], ['BankImportBatch', 'bankImportBatches', 'included'], ['BankImportRow', 'bankImportRows', 'included'], ['PaymentAdjustment', 'paymentAdjustments', 'included'], ['PurchaseValidationReport', 'purchaseValidationReports', 'included'], ['EmailOutbox', 'emailOutbox', 'excluded'], ['EmailOutboxAttempt', 'emailOutboxAttempts', 'excluded']] as const)('rejects a historical identity falsely advertising the later %s model', (model, key, mode) => {
    const backup = preJournalBackup('3.0');
    backup.manifest!.modelCoverage.push({ model, key, mode, count: 0, sha256: '0'.repeat(64) });
    expect(() => createBackupPreview(backup)).toThrow();
  });
  it.each(['paymentAdjustments', 'paymentOperations', 'purchaseValidationReports'])('does not let the fixture conversion weaken rejection of %s in a historical payload', key => {
    const backup = preJournalBackup('3.0');
    Object.assign(backup.data, { [key]: [] });
    expect(() => createBackupPreview(backup)).toThrow(/Älteres Backupschema/);
  });
  it.each(['bankPaymentBindings', 'paymentAllocationChanges', 'bankImportBatches', 'bankImportRows'])('rejects even an empty future bank %s section in a historical payload', key => {
    const backup = preJournalBackup('3.0');
    Object.assign(backup.data, { [key]: [] });
    expect(() => createBackupPreview(backup)).toThrow(/Backupschema/);
  });
  it.each(['emailOutbox', 'emailOutboxAttempts'])('never imports target-only runtime %s arrays', key => {
    const backup = preJournalBackup('3.0');
    Object.assign(backup.data, { [key]: [] });
    expect(() => createBackupPreview(backup)).toThrow(/Versandaufträge/);
  });
});
