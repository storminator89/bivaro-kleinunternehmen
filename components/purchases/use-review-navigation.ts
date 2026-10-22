'use client';

import { useCallback, useLayoutEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { reviewNavigationDispatcher, reviewSessionKey } from './incoming-review-history';

/** A deferred action belongs to this live control, session and exact source URL. */
export function useReviewNavigation() {
  const { data: session, status } = useSession();
  const sessionKey = reviewSessionKey(session, status);
  const currentSession = useRef(sessionKey);
  currentSession.current = sessionKey;
  const alive = useRef(false);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return useCallback((action: () => void) => {
    const sourceSession = currentSession.current;
    const sourceUrl = window.location.href;
    reviewNavigationDispatcher.request(action, () => alive.current && currentSession.current === sourceSession && window.location.href === sourceUrl);
  }, []);
}
