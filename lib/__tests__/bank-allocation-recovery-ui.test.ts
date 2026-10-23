import { describe, expect, it } from 'vitest';
import { BANK_ALLOCATION_PENDING_KEY, clearBankRecovery, readBankRecoveries, retainBankRecoveryScope, saveBankRecovery, type PendingBankAllocation } from '@/components/bank-csv/bank-allocation-recovery';

function storage() { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }
const uuid = (value: number) => `${value.toString().padStart(8, '0')}-1111-4111-8111-111111111111`;
const entry = (index = 1): PendingBankAllocation => ({ accountScope: 'owner-a', rowStableKey: uuid(100), bindingStableKey: null, operationKey: uuid(index), kind: 'record', expectedAllocationRevision: null, expectedSourceLedgerVersion: null });

describe('opaque bounded bank allocation tab-session identity', () => {
  it('contains only opaque identities/precondition tokens, with no receipt or free-text payload', () => {
    const store = storage(); saveBankRecovery(store, entry());
    const raw = JSON.parse(store.getItem(BANK_ALLOCATION_PENDING_KEY)!)[0];
    expect(Object.keys(raw).sort()).toEqual(['accountScope', 'bindingStableKey', 'expectedAllocationRevision', 'expectedSourceLedgerVersion', 'kind', 'operationKey', 'rowStableKey'].sort());
    expect(readBankRecoveries(store, 'owner-a', uuid(100))).toEqual([entry()]);
    clearBankRecovery(store, entry()); expect(store.getItem(BANK_ALLOCATION_PENDING_KEY)).toBeNull();
  });
  it('preserves an unresolved earlier intent when the user explicitly starts a separate fresh review', () => {
    const store = storage(); saveBankRecovery(store, entry(1)); saveBankRecovery(store, entry(2));
    expect(readBankRecoveries(store, 'owner-a', uuid(100))).toEqual([entry(1), entry(2)]);
    clearBankRecovery(store, entry(2)); expect(readBankRecoveries(store, 'owner-a', uuid(100))).toEqual([entry(1)]);
  });
  it('bounds pending identities and rejects an altered identity for the same operation key', () => {
    const store = storage();
    for (let index = 1; index <= 20; index++) saveBankRecovery(store, entry(index));
    expect(() => saveBankRecovery(store, entry(21))).toThrow('Zu viele');
    expect(() => saveBankRecovery(store, { ...entry(1), rowStableKey: uuid(101) })).toThrow('anderen Anfrage');
    expect(readBankRecoveries(store, 'owner-a', uuid(100))).toHaveLength(20);
  });
  it('clears entries on resolved logout or an account switch without exposing another account intent', () => {
    const store = storage(); saveBankRecovery(store, entry());
    expect(readBankRecoveries(store, 'owner-b', uuid(100))).toEqual([]); expect(store.getItem(BANK_ALLOCATION_PENDING_KEY)).toBeNull();
    saveBankRecovery(store, entry()); retainBankRecoveryScope(store, null); expect(store.getItem(BANK_ALLOCATION_PENDING_KEY)).toBeNull();
  });
  it('fails closed on unexpected payload fields and unreadable/unavailable storage', () => {
    const store = storage();
    expect(() => saveBankRecovery(store, { ...entry(), reason: 'must not be persisted' } as PendingBankAllocation)).toThrow();
    expect(store.getItem(BANK_ALLOCATION_PENDING_KEY)).toBeNull();
    store.setItem(BANK_ALLOCATION_PENDING_KEY, JSON.stringify([{ ...entry(), reason: 'must not be persisted' }]));
    expect(() => readBankRecoveries(store, 'owner-a', uuid(100))).toThrow();
    const blocked = { getItem() { throw new Error('unavailable'); }, setItem() { throw new Error('unavailable'); }, removeItem() { throw new Error('unavailable'); } };
    expect(() => saveBankRecovery(blocked, entry())).toThrow('unavailable');
  });
  it('accepts a move revision/source token without persisting its target, amount, date or reason', () => {
    const store = storage(); const move: PendingBankAllocation = { ...entry(), kind: 'move', bindingStableKey: uuid(200), expectedAllocationRevision: 4, expectedSourceLedgerVersion: 'a'.repeat(64) };
    saveBankRecovery(store, move); expect(readBankRecoveries(store, 'owner-a', uuid(100))).toEqual([move]);
    expect(store.getItem(BANK_ALLOCATION_PENDING_KEY)).not.toMatch(/invoiceId|amount|actionDate|reason|reference|customer|password|token/i);
  });
});
