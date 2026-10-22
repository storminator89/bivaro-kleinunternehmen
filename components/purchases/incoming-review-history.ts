import type { IncomingNavigationGuard } from './incoming-review-queue';

/** No entry URL/state is rewritten. A traversal is restored, then consciously replayed once. */
export function createReviewTraversalGuard(options: {
  getIndex: () => number | undefined;
  go: (delta: number) => void;
  getGuard: () => IncomingNavigationGuard | null;
  onReplay: () => void;
  onUnprotectedTraversal?: () => void;
}) {
  let currentIndex = options.getIndex();
  let restoring: { original: number; destination: number } | null = null;
  let replay = false;
  return (event: { stopImmediatePropagation: () => void }) => {
    const nextIndex = options.getIndex();
    if (replay) { replay = false; currentIndex = nextIndex; options.onReplay(); return; }
    if (restoring) {
      event.stopImmediatePropagation();
      if (nextIndex !== restoring.original) {
        if (nextIndex !== undefined) options.go(restoring.original - nextIndex);
        return;
      }
      const traversal = restoring; restoring = null; currentIndex = nextIndex;
      let resolved = false;
      options.getGuard()?.request(() => {
        if (resolved) return;
        resolved = true; replay = true;
        options.go(traversal.destination - traversal.original);
      }, () => { resolved = true; });
      return;
    }
    if (currentIndex === undefined || nextIndex === undefined) {
      // Without an exact index, preserve the old single-review traversal
      // behavior. In particular, never let a later route guard replace the
      // traversed destination entry as a compensating "stay" operation.
      options.onUnprotectedTraversal?.(); currentIndex = nextIndex; return;
    }
    const guard = options.getGuard();
    if (!guard?.blocked || currentIndex === nextIndex) { currentIndex = nextIndex; return; }
    event.stopImmediatePropagation();
    restoring = { original: currentIndex, destination: nextIndex };
    options.go(currentIndex - nextIndex);
  };
}

/** A pop allowance belongs to one exact normalized query, never a later close. */
export function consumeReviewTraversalQuery(allowed: { current: string | null }, query: string): boolean {
  const accepted = allowed.current === query;
  allowed.current = null;
  return accepted;
}
