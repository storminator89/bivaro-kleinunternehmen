import { describe, expect, it } from 'vitest';
import { stripEmptyBankImportsForLegacy, stripEmptyProjectServiceTimesForLegacy } from './helpers/backup-schema';
import { createBackupManifest as createFixtureManifest } from './helpers/backup';
import { isSupplierTaskDay, parseSupplierTask, parseSupplierTaskFilters, supplierTaskBerlinDay, supplierTaskDto } from '@/lib/purchase-documents/supplier-task';
import { validateSupplierTaskBackupFields } from '@/lib/purchase-documents/supplier-task-backup';
import { BACKUP_FEATURE_CAPABILITIES, CURRENT_SCHEMA_VERSION, MAPPING_NUMBERING_SCHEMA_VERSION, SUPPLIER_TASKS_SCHEMA_VERSION, backupSchemaSupportsSupplierTasks } from '@/lib/backup-manifest';

describe('supplier task calendar and explicit contract', () => {
  it.each(['2026-02-30', '2026-02-29', '2026-04-31', '0000-01-01', '2026-1-01', '2026-10-25T00:00:00Z', 'today', '', ' 2026-10-25'])('rejects an inexact or nonexistent calendar day %s', value => {
    expect(isSupplierTaskDay(value)).toBe(false);
    expect(() => parseSupplierTask({ kind: 'PAYMENT_CHECK', followUpDate: value })).toThrow();
  });
  it('preserves explicit null and genuine leap days, never payment/due-date/ownership extras', () => {
    expect(parseSupplierTask(null)).toBeNull();
    expect(isSupplierTaskDay('0001-01-01')).toBe(true);
    expect(isSupplierTaskDay('1899-12-31')).toBe(true);
    expect(parseSupplierTask({ kind: 'DIRECT_DEBIT_WAIT', followUpDate: null })).toEqual({ kind: 'DIRECT_DEBIT_WAIT', followUpDate: null });
    expect(parseSupplierTask({ kind: 'CLARIFY', followUpDate: '2024-02-29' })?.followUpDate).toBe('2024-02-29');
    for (const extra of ['userId', 'expenseId', 'paymentDate', 'dueDate', 'confirmPaymentDate', 'confirmationRequired', '__proto__', 'constructor']) {
      const input = { kind: 'PAYMENT_CHECK', followUpDate: null };
      Object.defineProperty(input, extra, { value: true, enumerable: true });
      expect(() => parseSupplierTask(input)).toThrow();
    }
    for (const value of [undefined, {}, [], true, { kind: 'PAID', followUpDate: null }, { kind: 'CLARIFY' }]) expect(() => parseSupplierTask(value)).toThrow();
  });
  it.each([
    ['2026-01-15T22:59:59.999Z', '2026-01-15'], ['2026-01-15T23:00:00.000Z', '2026-01-16'],
    ['2026-07-15T21:59:59.999Z', '2026-07-15'], ['2026-07-15T22:00:00.000Z', '2026-07-16'],
    ['2026-03-28T22:59:59.999Z', '2026-03-28'], ['2026-03-28T23:00:00.000Z', '2026-03-29'],
    ['2026-03-29T00:59:59.999Z', '2026-03-29'], ['2026-03-29T01:00:00.000Z', '2026-03-29'],
    ['2026-03-29T21:59:59.999Z', '2026-03-29'], ['2026-03-29T22:00:00.000Z', '2026-03-30'],
    ['2026-10-24T21:59:59.999Z', '2026-10-24'], ['2026-10-24T22:00:00.000Z', '2026-10-25'],
    ['2026-10-25T00:59:59.999Z', '2026-10-25'], ['2026-10-25T01:00:00.000Z', '2026-10-25'],
    ['2026-10-25T22:59:59.999Z', '2026-10-25'], ['2026-10-25T23:00:00.000Z', '2026-10-26'],
  ])('uses Berlin calendar day at %s', (instant, expected) => {
    expect(supplierTaskBerlinDay(new Date(instant))).toBe(expected);
    expect(parseSupplierTaskFilters(new URLSearchParams('taskDue=due'), new Date(instant)).today).toBe(expected);
  });
  it('strictly validates filter enums and exposes reconfirmation without silently activating', () => {
    expect(parseSupplierTaskFilters(new URLSearchParams('taskKind=all')).kind).toBeNull();
    expect(parseSupplierTaskFilters(new URLSearchParams('taskKind=any&taskDue=undated')).kind).toBe('any');
    for (const query of ['taskKind=paid', 'taskDue=tomorrow', 'taskDue=2026-10-25']) expect(() => parseSupplierTaskFilters(new URLSearchParams(query))).toThrow();
    expect(supplierTaskDto({ supplierTaskKind: 'CLARIFY', supplierTaskFollowUpDate: null, supplierTaskConfirmationRequired: true })).toEqual({ kind: 'CLARIFY', followUpDate: null, confirmationRequired: true });
    expect(() => supplierTaskDto({ supplierTaskKind: null, supplierTaskFollowUpDate: '2026-10-25', supplierTaskConfirmationRequired: false })).toThrow();
  });
});

describe('exact additive supplier task backup capability', () => {
  const empty = { supplierTaskKind: null, supplierTaskFollowUpDate: null, supplierTaskConfirmationRequired: false };
  it('only adds the named exact identity, never promotes existing or arbitrary future identities', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe('20261025090000_add_manual_financial_record_lifecycle');
    expect(backupSchemaSupportsSupplierTasks(SUPPLIER_TASKS_SCHEMA_VERSION)).toBe(true);
    expect(backupSchemaSupportsSupplierTasks(CURRENT_SCHEMA_VERSION)).toBe(true);
    expect(backupSchemaSupportsSupplierTasks(MAPPING_NUMBERING_SCHEMA_VERSION)).toBe(false);
    expect(BACKUP_FEATURE_CAPABILITIES[MAPPING_NUMBERING_SCHEMA_VERSION]).toMatchObject({ bankMappingProfiles: true, documentNumberingPolicies: true });
    for (const key of [...Object.keys(BACKUP_FEATURE_CAPABILITIES).filter(key => ![CURRENT_SCHEMA_VERSION, SUPPLIER_TASKS_SCHEMA_VERSION].includes(key)), '99999999999999_add_supplier_tasks', undefined]) expect(backupSchemaSupportsSupplierTasks(key)).toBe(false);
  });
  it('requires complete current columns and rejects any future columns on historical capabilities, even null', () => {
    expect(() => validateSupplierTaskBackupFields(empty, 'document', true)).not.toThrow();
    expect(() => validateSupplierTaskBackupFields({}, 'document', false)).not.toThrow();
    for (const key of Object.keys(empty)) {
      const missing = { ...empty }; delete missing[key as keyof typeof missing];
      expect(() => validateSupplierTaskBackupFields(missing, 'document', true)).toThrow();
      expect(() => validateSupplierTaskBackupFields({ [key]: empty[key as keyof typeof empty] }, 'document', false)).toThrow();
    }
    for (const task of [
      { ...empty, supplierTaskConfirmationRequired: true }, { ...empty, supplierTaskFollowUpDate: '2026-10-25' },
      { ...empty, supplierTaskKind: 'PAID' }, { ...empty, supplierTaskKind: 'CLARIFY', supplierTaskFollowUpDate: '2026-02-30' },
      { ...empty, supplierTaskKind: 'CLARIFY', supplierTaskConfirmationRequired: 'false' },
    ]) expect(() => validateSupplierTaskBackupFields(task, 'document', true)).toThrow();
    expect(() => validateSupplierTaskBackupFields({ ...empty, supplierTaskKind: 'CLARIFY', supplierTaskConfirmationRequired: true }, 'document', true)).not.toThrow();
  });
  it('historical fixture entrypoints strip only empty defaults, never real or malformed task evidence', () => {
    for (const strip of [stripEmptyBankImportsForLegacy, stripEmptyProjectServiceTimesForLegacy]) {
      const empty = { data: { purchaseDocuments: [{ supplierTaskKind: null, supplierTaskFollowUpDate: null, supplierTaskConfirmationRequired: false }] }, manifest: { schemaVersion: MAPPING_NUMBERING_SCHEMA_VERSION, modelCoverage: [{ model: 'PurchaseDocument' }] } };
      strip(empty); expect(empty.data.purchaseDocuments).toEqual([{}]);
      for (const task of [{ supplierTaskKind: 'CLARIFY', supplierTaskFollowUpDate: null, supplierTaskConfirmationRequired: false }, { supplierTaskKind: null, supplierTaskFollowUpDate: null, supplierTaskConfirmationRequired: 'false' }]) {
        const backup = { data: { purchaseDocuments: [task] }, manifest: { schemaVersion: MAPPING_NUMBERING_SCHEMA_VERSION, modelCoverage: [{ model: 'PurchaseDocument' }] } };
        strip(backup); expect(backup.data.purchaseDocuments[0]).toEqual(task);
        expect(() => validateSupplierTaskBackupFields(backup.data.purchaseDocuments[0], 'source', false)).toThrow();
      }
    }
    const data: Record<string, unknown> = { purchaseDocuments: [{ supplierTaskKind: 'CLARIFY' }] };
    createFixtureManifest({ sourceUserId: 'synthetic', generatedAt: '2026-10-25T00:00:00.000Z', data });
    expect((data.purchaseDocuments as Record<string, unknown>[])[0]).not.toHaveProperty('supplierTaskFollowUpDate');
  });

});
