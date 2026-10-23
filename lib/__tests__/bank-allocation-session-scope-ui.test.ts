import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ data: null as { user: { id: string } } | null, status: 'loading' }));
vi.mock('next-auth/react', () => ({ useSession: () => auth }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useEffect: (effect: () => void) => effect() }));
import { BankAllocationSessionScope } from '@/components/bank-csv/bank-allocation-session-scope';
import { BANK_ALLOCATION_PENDING_KEY, saveBankRecovery } from '@/components/bank-csv/bank-allocation-recovery';
const identity = { accountScope: 'owner-a', rowStableKey: '11111111-1111-4111-8111-111111111111', bindingStableKey: null, operationKey: '22222222-2222-4222-8222-222222222222', kind: 'record' as const, expectedAllocationRevision: null, expectedSourceLedgerVersion: null };
beforeEach(() => { const values = new Map<string, string>(); vi.stubGlobal('sessionStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }); auth.data = null; auth.status = 'loading'; saveBankRecovery(sessionStorage, identity); });
afterEach(() => vi.unstubAllGlobals());
describe('global bank tab-session account boundary', () => {
  it('does not mistake initial session loading for logout and discard a pending key', () => { BankAllocationSessionScope(); expect(sessionStorage.getItem(BANK_ALLOCATION_PENDING_KEY)).toContain(identity.operationKey); });
  it('preserves only the resolved current account scope and clears on account change', () => { auth.status = 'authenticated'; auth.data = { user: { id: 'owner-a' } }; BankAllocationSessionScope(); expect(sessionStorage.getItem(BANK_ALLOCATION_PENDING_KEY)).toContain(identity.operationKey); auth.data = { user: { id: 'owner-b' } }; BankAllocationSessionScope(); expect(sessionStorage.getItem(BANK_ALLOCATION_PENDING_KEY)).toBeNull(); });
  it('clears the opaque key on resolved logout, without a network command', () => { const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); auth.status = 'unauthenticated'; BankAllocationSessionScope(); expect(sessionStorage.getItem(BANK_ALLOCATION_PENDING_KEY)).toBeNull(); expect(fetcher).not.toHaveBeenCalled(); });
  it('tolerates blocked browser storage without changing authentication', () => { vi.stubGlobal('sessionStorage', { getItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } }); auth.status = 'authenticated'; auth.data = { user: { id: 'owner-a' } }; expect(() => BankAllocationSessionScope()).not.toThrow(); expect(auth.status).toBe('authenticated'); });
});
