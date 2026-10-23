'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { retainBankRecoveryScope } from '@/components/bank-csv/bank-allocation-recovery';

/** Scope-only cleanup; never fetches, sends or reconstructs a payment command. */
export function BankAllocationSessionScope() {
  const { data: session, status } = useSession();
  useEffect(() => {
    if (status !== 'authenticated' && status !== 'unauthenticated') return;
    try { retainBankRecoveryScope(sessionStorage, session?.user?.id ?? null); }
    catch { /* Row controls explain unavailable storage and retain in-memory safety. */ }
  }, [status, session?.user?.id]);
  return null;
}
