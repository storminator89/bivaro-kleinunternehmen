import { describe, expect, it, vi } from 'vitest';
import { preJournalBackup } from '../../e2e/helpers/pre-journal-backup';
import { createBackupPreview } from '@/lib/backup-preview';

// Preview is pure validation; a fixture probe must never query an application DB.
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

describe('real-browser historical restore fixtures keep their exact original capability', () => {
  it.each(['2.0', '3.0'] as const)('accepts the actual pre-journal %s preview without advertising new payment models', version => {
    const backup = preJournalBackup(version);
    expect(createBackupPreview(backup)).toMatchObject({ version, counts: { invoices: 1, incomes: 1 } });
    expect(backup.data).not.toHaveProperty('paymentAdjustments');
    expect(backup.data).not.toHaveProperty('paymentOperations');
    expect(backup.manifest?.modelCoverage.some(entry => ['PaymentAdjustment', 'PaymentOperation'].includes(entry.model))).not.toBe(true);
  });
  it('rejects a historical identity falsely advertising even empty new payment models', () => {
    const backup = preJournalBackup('3.0');
    backup.manifest!.modelCoverage.push({ model: 'PaymentAdjustment', key: 'paymentAdjustments', mode: 'included', count: 0, sha256: '0'.repeat(64) });
    expect(() => createBackupPreview(backup)).toThrow();
  });
  it.each(['paymentAdjustments', 'paymentOperations'])('does not let the fixture conversion weaken rejection of %s in a historical payload', key => {
    const backup = preJournalBackup('3.0');
    Object.assign(backup.data, { [key]: [] });
    expect(() => createBackupPreview(backup)).toThrow(/Älteres Backupschema/);
  });
});
