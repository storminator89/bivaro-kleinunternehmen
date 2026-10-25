'use client';

import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useSession } from 'next-auth/react';
import { reviewSessionKey } from '@/components/purchases/incoming-review-history';
import type { Invoice } from '@/types/dashboard';

/** Scope only the selected invoice detail DTO, not the workspace/drafts. */
export function useInvoiceDetailSelection() {
  const { data: session, status } = useSession();
  const sessionKey = reviewSessionKey(session, status);
  const currentSession = useRef(sessionKey);
  currentSession.current = sessionKey;
  const alive = useRef(false);
  const [selection, setSelection] = useState<{ session: string; invoice: Invoice } | null>(null);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useLayoutEffect(() => {
    if (selection && (selection.session !== sessionKey || status !== 'authenticated')) setSelection(null);
  }, [selection, sessionKey, status]);
  const select = useCallback<Dispatch<SetStateAction<Invoice | null>>>((value) => {
    if (!alive.current || status !== 'authenticated' || currentSession.current !== sessionKey) return;
    setSelection(previous => {
      if (!alive.current || currentSession.current !== sessionKey) return previous;
      const current = previous?.session === sessionKey ? previous.invoice : null;
      const invoice = typeof value === 'function' ? value(current) : value;
      return invoice ? { session: sessionKey, invoice } : null;
    });
  }, [sessionKey, status]);
  // Hide before cleanup runs, including an authenticated account replacement.
  return [status === 'authenticated' && selection?.session === sessionKey ? selection.invoice : null, select] as const;
}
