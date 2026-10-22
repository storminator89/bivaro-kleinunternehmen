'use client';

import { useLayoutEffect } from 'react';
import { reviewPopDispatcher } from './incoming-review-history';

/** Stay mounted above route/session content and precede router passive listeners. */
export function IncomingReviewHistoryBoundary() {
  useLayoutEffect(() => {
    const onPop = (event: PopStateEvent) => reviewPopDispatcher.dispatch(event);
    window.addEventListener('popstate', onPop, true);
    return () => window.removeEventListener('popstate', onPop, true);
  }, []);
  return null;
}
