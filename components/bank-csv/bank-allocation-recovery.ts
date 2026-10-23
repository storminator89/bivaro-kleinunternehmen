import { BANK_IMPORT_UUID } from '@/lib/bank-import-contract';

/** Tab-session identity only. No bank contents or command payload belong here. */
export type PendingBankAllocation = { accountScope: string; rowStableKey: string; bindingStableKey: string | null; operationKey: string; kind: 'record' | 'move'; expectedAllocationRevision: number | null; expectedSourceLedgerVersion: string | null };
export const BANK_ALLOCATION_PENDING_KEY = 'bivaro:bank-allocation-pending:v1';
const fields = ['accountScope', 'rowStableKey', 'bindingStableKey', 'operationKey', 'kind', 'expectedAllocationRevision', 'expectedSourceLedgerVersion'];
const limit = 20;
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
function entries(storage: Store): PendingBankAllocation[] {
  const source = storage.getItem(BANK_ALLOCATION_PENDING_KEY);
  if (source === null) return [];
  if (source.length > 32_768) throw new Error('Sitzungskennungen nicht sicher lesbar.');
  return checkedEntries(JSON.parse(source));
}
function checkedEntries(values: unknown): PendingBankAllocation[] {
  if (!Array.isArray(values) || values.length > limit) throw new Error('Sitzungskennungen nicht sicher lesbar.');
  const seen = new Set<string>();
  return values.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Sitzungskennungen nicht sicher lesbar.');
    const item = value as Record<string, unknown>;
    if (Object.keys(item).length !== fields.length || Object.keys(item).some(field => !fields.includes(field))
      || typeof item.accountScope !== 'string' || !item.accountScope || item.accountScope.length > 255
      || typeof item.rowStableKey !== 'string' || !BANK_IMPORT_UUID.test(item.rowStableKey)
      || typeof item.operationKey !== 'string' || !BANK_IMPORT_UUID.test(item.operationKey)
      || !['record', 'move'].includes(String(item.kind))
      || (item.kind === 'record' ? item.bindingStableKey !== null || item.expectedAllocationRevision !== null || item.expectedSourceLedgerVersion !== null : typeof item.bindingStableKey !== 'string' || !BANK_IMPORT_UUID.test(item.bindingStableKey) || typeof item.expectedAllocationRevision !== 'number' || !Number.isSafeInteger(item.expectedAllocationRevision) || item.expectedAllocationRevision < 0 || typeof item.expectedSourceLedgerVersion !== 'string' || !/^[a-f0-9]{64}$/u.test(item.expectedSourceLedgerVersion))) throw new Error('Sitzungskennungen nicht sicher lesbar.');
    const identity = `${item.accountScope}:${item.operationKey}`;
    if (seen.has(identity)) throw new Error('Doppelte Sitzungskennung.');
    seen.add(identity); return item as PendingBankAllocation;
  });
}
function write(storage: Store, values: PendingBankAllocation[]) {
  if (!values.length) { storage.removeItem(BANK_ALLOCATION_PENDING_KEY); return; }
  const source = JSON.stringify(values);
  storage.setItem(BANK_ALLOCATION_PENDING_KEY, source);
  if (storage.getItem(BANK_ALLOCATION_PENDING_KEY) !== source) throw new Error('Sitzungskennung konnte nicht gesichert werden.');
}
/** Account changes and logout discard the previous account's opaque entries. */
export function retainBankRecoveryScope(storage: Store, accountScope: string | null) {
  if (accountScope === null) { storage.removeItem(BANK_ALLOCATION_PENDING_KEY); return; }
  write(storage, entries(storage).filter(entry => entry.accountScope === accountScope));
}
export function readBankRecoveries(storage: Store, accountScope: string, rowStableKey: string) {
  retainBankRecoveryScope(storage, accountScope);
  return entries(storage).filter(entry => entry.accountScope === accountScope && entry.rowStableKey === rowStableKey);
}
export function saveBankRecovery(storage: Store, value: PendingBankAllocation) {
  checkedEntries([value]);
  const existing = entries(storage).filter(entry => entry.accountScope === value.accountScope);
  const previous = existing.find(entry => entry.operationKey === value.operationKey);
  if (previous && JSON.stringify(previous) !== JSON.stringify(value)) throw new Error('Die Sitzungskennung gehört zu einer anderen Anfrage.');
  const values = [...existing.filter(entry => entry.operationKey !== value.operationKey), value];
  if (values.length > limit) throw new Error('Zu viele offene Sitzungskennungen.');
  write(storage, values);
}
export function clearBankRecovery(storage: Store, value: PendingBankAllocation) {
  write(storage, entries(storage).filter(entry => !(entry.accountScope === value.accountScope && entry.rowStableKey === value.rowStableKey && entry.operationKey === value.operationKey)));
}
