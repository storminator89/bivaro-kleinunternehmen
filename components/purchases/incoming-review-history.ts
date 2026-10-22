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
  let intent = 0;
  let restoring: { original: number; destination: number; intent: number } | null = null;
  let replay = false;
  const onPop = (event: { stopImmediatePropagation: () => void }) => {
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
        if (resolved || traversal.intent !== intent) return;
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
    if (!guard?.blocked || currentIndex === nextIndex) { options.onUnprotectedTraversal?.(); currentIndex = nextIndex; return; }
    event.stopImmediatePropagation();
    restoring = { original: currentIndex, destination: nextIndex, intent: ++intent };
    options.go(currentIndex - nextIndex);
  };
  return Object.assign(onPop, {
    syncIndex: () => { if (!restoring && !replay) currentIndex = options.getIndex(); },
  });
}

/** One explicit UI intent owns one unchanged source location and can run only once. */
export function createReviewNavigationIntents(readLocation: () => string) {
  let version = 0;
  return {
    invalidate: () => { version++; },
    prepare: (action: () => void) => {
      const token = ++version; const location = readLocation(); let consumed = false;
      return {
        proceed: () => {
          if (consumed || token !== version || readLocation() !== location) return;
          consumed = true; action();
        },
        stay: () => { if (!consumed && token === version) { consumed = true; version++; } },
      };
    },
  };
}
