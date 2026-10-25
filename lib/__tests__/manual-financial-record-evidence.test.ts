/** Authored #54a evidence sources; execution requires the separately authorized verification gate. */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { manualRecordAmount, manualRecordEventHash, type ManualRecordEventEvidence, type ManualRecordSnapshot } from '@/lib/manual-financial-record-evidence';
import { MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION, manualRecordEventsFromBackup, preflightManualRecordRestore, restoredManualRecordMetadata, supportsManualFinancialRecords, validateManualRecordOriginalManifest } from '@/lib/manual-financial-record-backup';

function fixture() {
  const recordId = randomUUID();
  const snapshot: ManualRecordSnapshot = { contractVersion: 1, recordId, kind: 'expense', amount: '100', originalAmount: '100', currency: 'EUR', description: 'Original manual outflow', paymentDate: '2026-10-01', date: '2026-10-01T00:00:00.000Z', taxRelevant: true, customer: null, category: 'Software', taxDeductiblePercentage: 50, receiptUrl: null, depreciationYears: null, original: { status: 'NONE', fileName: null, sha256: null, byteCount: null }, legacyManualDeclaration: false };
  const root: ManualRecordEventEvidence = { id: randomUUID(), recordId, kind: 'expense', sequence: 1, operation: 'FINALIZE', mutationId: randomUUID(), semanticHash: '1'.repeat(64), previousHash: null, snapshot, reason: null, createdAt: '2026-10-02T00:00:00.000Z', hash: '' };
  const { hash: _rootHash, ...rootValues } = root; void _rootHash; root.hash = manualRecordEventHash(rootValues);
  const correction: ManualRecordEventEvidence = { ...root, id: randomUUID(), sequence: 2, operation: 'CORRECT_AMOUNT', mutationId: randomUUID(), semanticHash: '2'.repeat(64), previousHash: root.hash, snapshot: { ...snapshot, amount: '80' }, reason: 'Original amount entered incorrectly', createdAt: '2026-10-03T00:00:00.000Z' };
  const { hash: _correctionHash, ...correctionValues } = correction; void _correctionHash; correction.hash = manualRecordEventHash(correctionValues);
  const expense = { id: 17, manualRecordId: recordId, manualRecordState: 'FINALIZED', manualRecordOrigin: 'MANUAL', manualRecordRevision: 2, amount: 80, description: snapshot.description, date: snapshot.date, category: snapshot.category, taxRelevant: true, taxDeductiblePercentage: 50, receiptUrl: null, receiptFileName: null, storedReceiptFileName: null, depreciationYears: null, recurringExpenseId: null, scheduledDate: null };
  return { incomes: [], expenses: [expense], manualFinancialRecordEvents: [root, correction].map(event => ({ ...event, incomeId: null, expenseId: expense.id })) };
}

describe('strict cent values and closed portable evidence', () => {
  it.each([['0', '0'], ['80.00', '80'], ['80.10', '80.1']])('accepts %s without inventing financial movement', (input, expected) => expect(manualRecordAmount(input, true)).toBe(expected));
  it.each(['-1', '1.001', 'NaN', 'Infinity', '1e2', '1,20', '90071992547409.91', '999999999999999', '', ' 80 '])('rejects unsafe/non-cent input %s instead of rounding it', input => expect(() => manualRecordAmount(input, true)).toThrow());
  it('retains root 100 and correction 80 as evidence while exactly one projection is 80', () => {
    const data = fixture();
    const events = manualRecordEventsFromBackup(data, MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION);
    expect(events.map(event => event.snapshot.amount)).toEqual(['100', '80']);
    expect(data.expenses.map(row => row.amount)).toEqual([80]);
    expect(events[1].snapshot).toEqual({ ...events[0].snapshot, amount: '80' });
  });
  it('never promotes older identities and rejects future fields even when null', () => {
    const old = '20261024040000_add_supplier_tasks';
    expect(supportsManualFinancialRecords(old)).toBe(false);
    expect(() => manualRecordEventsFromBackup({ expenses: [{ id: 1, manualRecordState: null }] }, old)).toThrow(/Ältere/);
    expect(() => manualRecordEventsFromBackup({ manualFinancialRecordEvents: null }, old)).toThrow(/Ältere/);
    expect(() => manualRecordEventsFromBackup({}, MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION)).toThrow(/fehlt/);
    expect(manualRecordEventsFromBackup({ incomes: [], expenses: [] }, old)).toEqual([]);
  });
  it.each(['amount', 'date', 'description', 'category', 'taxRelevant', 'taxDeductiblePercentage', 'receiptUrl'])('rejects effective projection divergence in %s', field => {
    const data = fixture(); (data.expenses[0] as Record<string, unknown>)[field] = field === 'amount' ? 81 : 'tampered';
    expect(() => manualRecordEventsFromBackup(data, MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION)).toThrow();
  });
  it('rejects changed immutable context even if the attacker recomputes the new event hash', () => {
    const data = fixture(), event = data.manualFinancialRecordEvents[1]; event.snapshot.paymentDate = '2026-10-04'; event.snapshot.date = '2026-10-04T00:00:00.000Z';
    const { hash: _hash, incomeId: _income, expenseId: _expense, ...values } = event; void _hash; void _income; void _expense; event.hash = manualRecordEventHash(values);
    expect(() => manualRecordEventsFromBackup(data, MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION)).toThrow(/Kontext/);
  });
  it('rejects missing ancestors, duplicate mutation UUIDs, extra snapshot fields and cross-owner rows', () => {
    for (const mutate of [
      (data: ReturnType<typeof fixture>) => { data.manualFinancialRecordEvents.shift(); },
      (data: ReturnType<typeof fixture>) => { data.manualFinancialRecordEvents[1].mutationId = data.manualFinancialRecordEvents[0].mutationId; },
      (data: ReturnType<typeof fixture>) => { Object.assign(data.manualFinancialRecordEvents[0].snapshot, { fiscalReviewApproved: true }); },
      (data: ReturnType<typeof fixture>) => { Object.assign(data.expenses[0], { userId: 'different-source-owner' }); Object.assign(data, { user: { id: 'source-owner' } }); },
    ]) { const data = fixture(); mutate(data); expect(() => manualRecordEventsFromBackup(data, MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION)).toThrow(); }
  });
  it('excludes source, cash, recurring lineage and AfA even if metadata falsely calls them manual', () => {
    for (const extra of [{ recurringExpenseId: 4 }, { scheduledDate: '2026-10-01' }, { manualRecordOrigin: 'RECURRING' }, { depreciationYears: 3 }]) {
      const data = fixture(); Object.assign(data.expenses[0], extra); expect(() => manualRecordEventsFromBackup(data, MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION)).toThrow();
    }
    for (const relation of ['cashTransactions', 'purchaseDocuments']) {
      const data = { ...fixture(), [relation]: [{ expenseId: 17 }] }; expect(() => manualRecordEventsFromBackup(data, MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION)).toThrow(/Quell-/);
    }
  });
  it('rejects fictitious kind-specific context even with recomputed event hashes', () => {
    for (const invalid of [
      { original: { status: 'ARCHIVED', fileName: 'fictitious.pdf', sha256: 'f'.repeat(64), byteCount: 5 } },
      { category: 'Expense-only category' }, { taxDeductiblePercentage: 50 }, { receiptUrl: 'https://example.invalid/fictitious.pdf' },
    ]) {
      const base = fixture(), source = base.expenses[0];
      const data = { incomes: [{ ...source, customerId: null, invoiceId: null }], expenses: [], manualFinancialRecordEvents: base.manualFinancialRecordEvents.map(event => ({ ...event, kind: 'income' as const, incomeId: source.id, expenseId: null, snapshot: { ...event.snapshot, kind: 'income' as const, category: null, taxDeductiblePercentage: null, receiptUrl: null, depreciationYears: null } })) };
      for (const [index, event] of data.manualFinancialRecordEvents.entries()) {
        Object.assign(event.snapshot, invalid); event.previousHash = index ? data.manualFinancialRecordEvents[index - 1].hash : null;
        const { hash: _hash, incomeId: _income, expenseId: _expense, ...values } = event; void _hash; void _income; void _expense; event.hash = manualRecordEventHash(values);
      }
      expect(() => manualRecordEventsFromBackup(data, MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION)).toThrow(/Einnahmen/);
    }
    const data = fixture();
    for (const [index, event] of data.manualFinancialRecordEvents.entries()) {
      event.snapshot.customer = { name: 'Fictitious income customer', contactPerson: null, email: null, address: null, zipCode: null, city: null, taxNumber: null };
      event.previousHash = index ? data.manualFinancialRecordEvents[index - 1].hash : null;
      const { hash: _hash, incomeId: _income, expenseId: _expense, ...values } = event; void _hash; void _income; void _expense; event.hash = manualRecordEventHash(values);
    }
    expect(() => manualRecordEventsFromBackup(data, MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION)).toThrow(/Ausgaben/);
  });
  it('leaves excluded source identity/remap to its own workflow even when client metadata says MANUAL', async () => {
    const recordId = '54000000-0000-4000-8000-000000000017';
    const base = { id: 17, manualRecordId: recordId, manualRecordState: 'LEGACY_UNREVIEWED', manualRecordOrigin: 'MANUAL', manualRecordRevision: 4, description: 'Existing source-controlled projection', amount: 80, date: '2026-10-01T00:00:00.000Z', taxRelevant: true };
    const cases: { kind: 'income' | 'expense'; row: Record<string, unknown>; graph: Record<string, unknown>; origin: string }[] = [
      { kind: 'income', row: { invoiceId: 9 }, graph: {}, origin: 'INVOICE' },
      { kind: 'income', row: {}, graph: { paymentJournalEvents: [{ incomeId: '17' }] }, origin: 'PAYMENT_JOURNAL' },
      { kind: 'income', row: {}, graph: { cashTransactions: [{ incomeId: 17 }] }, origin: 'CASHBOOK' },
      { kind: 'expense', row: {}, graph: { purchaseDocuments: [{ expenseId: '17' }] }, origin: 'PURCHASE_DOCUMENT' },
      { kind: 'expense', row: { recurringExpenseId: 8 }, graph: {}, origin: 'RECURRING' },
      { kind: 'expense', row: { recurringExpenseId: null, scheduledDate: null, manualRecordOrigin: 'RECURRING' }, graph: {}, origin: 'RECURRING' },
      { kind: 'expense', row: {}, graph: { cashTransactions: [{ expenseId: 17 }] }, origin: 'CASHBOOK' },
      { kind: 'expense', row: { depreciationYears: 3 }, graph: {}, origin: 'MANUAL' },
    ];
    for (const entry of cases) {
      const row = { ...base, ...entry.row }, data = { incomes: entry.kind === 'income' ? [row] : [], expenses: entry.kind === 'expense' ? [row] : [], manualFinancialRecordEvents: [], ...entry.graph };
      const foreignSource = { ...row, userId: 'foreign-source-owner' };
      const client = { income: { findUnique: async () => entry.kind === 'income' ? foreignSource : null }, expense: { findUnique: async () => entry.kind === 'expense' ? foreignSource : null }, manualFinancialRecordEvent: { count: async () => 0 } } as unknown as Parameters<typeof preflightManualRecordRestore>[0];
      const plan = await preflightManualRecordRestore(client, 'restore-owner', data, MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION, false, false);
      expect(plan.income.size + plan.expense.size).toBe(0); // Never reuse another owner's financial row.
      const metadata = restoredManualRecordMetadata(row, entry.kind, data, MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION);
      expect(metadata).not.toHaveProperty('manualRecordId');
      expect(metadata).toMatchObject({ manualRecordState: 'LEGACY_UNREVIEWED', manualRecordOrigin: entry.origin, manualRecordRevision: 4 });
      foreignSource.manualRecordState = 'FINALIZED';
      await expect(preflightManualRecordRestore(client, 'restore-owner', data, MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION, false, false)).rejects.toThrow(/festgeschriebenen manuellen Identität/);
    }
  });
  it('never lets an ordinary manual foreign identity or source-spoofed finalized history through the source-remap exception', async () => {
    const data = fixture(), row = data.expenses[0];
    const client = { income: { findUnique: async () => null }, expense: { findUnique: async () => ({ ...row, userId: 'foreign-owner' }) }, manualFinancialRecordEvent: { count: async () => 0 } } as unknown as Parameters<typeof preflightManualRecordRestore>[0];
    await expect(preflightManualRecordRestore(client, 'restore-owner', data, MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION, false, false)).rejects.toThrow(/Mandanten/);
    for (const sourceGraph of [{ purchaseDocuments: [{ expenseId: String(row.id) }] }, { cashTransactions: [{ expenseId: String(row.id) }] }]) {
      await expect(preflightManualRecordRestore(client, 'restore-owner', { ...data, ...sourceGraph }, MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION, false, false)).rejects.toThrow(/Quell-/);
    }
    Object.assign(row, { manualRecordOrigin: 'PURCHASE_DOCUMENT' });
    await expect(preflightManualRecordRestore(client, 'restore-owner', data, MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION, false, false)).rejects.toThrow(/Quell-/);
    const foreignSource = { ...fixture(), user: { id: 'claimed-source-owner' }, purchaseDocuments: [{ expenseId: '17' }] };
    Object.assign(foreignSource.expenses[0], { manualRecordState: 'LEGACY_UNREVIEWED', userId: 'different-source-owner' });
    foreignSource.manualFinancialRecordEvents = [];
    await expect(preflightManualRecordRestore(client, 'restore-owner', foreignSource, MANUAL_FINANCIAL_RECORD_SCHEMA_VERSION, false, false)).rejects.toThrow(/Quellmandanten/);
  });
  it('requires exact archived bytes in full ZIP manifests and makes JSON metadata-only explicit', () => {
    const data = fixture();
    for (const event of data.manualFinancialRecordEvents) event.snapshot.original = { status: 'ARCHIVED', fileName: 'original.pdf', sha256: 'a'.repeat(64), byteCount: 4 };
    Object.assign(data.expenses[0], { receiptFileName: 'original.pdf', storedReceiptFileName: 'archive.pdf' });
    expect(() => validateManualRecordOriginalManifest(data, [], false)).not.toThrow();
    expect(() => validateManualRecordOriginalManifest(data, [], true)).toThrow(/ZIP/);
    expect(() => validateManualRecordOriginalManifest(data, [{ kind: 'receipt', sourceName: 'archive.pdf', sha256: 'b'.repeat(64), bytes: 4, zipPath: 'receipts/archive.pdf' }], true)).toThrow();
    expect(() => validateManualRecordOriginalManifest(data, [{ kind: 'receipt', sourceName: 'archive.pdf', sha256: 'a'.repeat(64), bytes: 4, zipPath: 'receipts/archive.pdf' }], true)).not.toThrow();
  });
});
