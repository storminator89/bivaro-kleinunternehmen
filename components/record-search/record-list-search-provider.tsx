'use client';

import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { reviewSessionKey } from '@/components/purchases/incoming-review-history';
import { recordListScope, recordListTerm } from '@/lib/record-search/list-handoff';
import type { RecordSearchType } from '@/lib/record-search/contract';

export type RecordListSearch = { revision: number; type: RecordSearchType; query: string };
type Handoff = RecordListSearch & { session: string; source: string; arrived: boolean };
type SearchContext = {
  active: RecordListSearch | null;
  begin: (type: RecordSearchType, query: string) => boolean;
  clear: () => void;
};
const Context = createContext<SearchContext>({ active: null, begin: () => false, clear: () => {} });

/** One ephemeral handoff, not a saved search or a replacement navigation owner. */
export function RecordListSearchProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const sessionKey = reviewSessionKey(session, status);
  const pathname = usePathname();
  const params = useSearchParams();
  const location = `${pathname}?${params}`;
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const revision = useRef(0);
  const currentSession = useRef(sessionKey);
  currentSession.current = sessionKey;
  const alive = useRef(false);
  const clear = useCallback(() => setHandoff(null), []);
  useLayoutEffect(() => {
    alive.current = true;
    // These listeners only dispose memory. They never prevent, replay or alter
    // navigation/history, and leave the existing dirty-review owner untouched.
    const discard = () => setHandoff(null);
    window.addEventListener('popstate', discard, true);
    window.addEventListener('pagehide', discard);
    const restored = (event: PageTransitionEvent) => { if (event.persisted) discard(); };
    window.addEventListener('pageshow', restored);
    return () => { alive.current = false; window.removeEventListener('popstate', discard, true); window.removeEventListener('pagehide', discard); window.removeEventListener('pageshow', restored); };
  }, []);
  useLayoutEffect(() => {
    if (!handoff) return;
    if (status !== 'authenticated' || handoff.session !== sessionKey) { setHandoff(null); return; }
    if (recordListScope(handoff.type, location)) {
      if (!handoff.arrived) setHandoff({ ...handoff, arrived: true });
    } else if (handoff.arrived || location !== handoff.source) setHandoff(null);
  }, [handoff, location, sessionKey, status]);
  const begin = useCallback((type: RecordSearchType, query: string) => {
    if (!alive.current || status !== 'authenticated' || currentSession.current !== sessionKey) return false;
    setHandoff({ type, query: recordListTerm(query), revision: ++revision.current, session: sessionKey, source: location, arrived: false });
    return true;
  }, [location, sessionKey, status]);
  const active = handoff && status === 'authenticated' && handoff.session === sessionKey && recordListScope(handoff.type, location) ? handoff : null;
  return <Context.Provider value={{ active, begin, clear }}>{children}</Context.Provider>;
}

export function useRecordListHandoff() { return useContext(Context); }
export function useRecordListSearch(type: RecordSearchType) {
  const context = useContext(Context);
  return context.active?.type === type ? context.active : null;
}
