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
export function createReviewNavigationIntents(readLocation: () => string, isCurrent: () => boolean = () => true) {
  let version = 0;
  return {
    invalidate: () => { version++; },
    checkpoint: () => {
      const token = version; const location = readLocation();
      return () => token === version && readLocation() === location && isCurrent();
    },
    prepare: (action: () => void) => {
      const token = ++version; const location = readLocation(); let consumed = false;
      return {
        proceed: () => {
          if (consumed || token !== version || readLocation() !== location || !isCurrent()) return;
          consumed = true; action();
        },
        stay: () => { if (!consumed && token === version) { consumed = true; version++; } },
      };
    },
  };
}

/** Native traversal and cooperative controls share the same latest-intent boundary. */
export function bindReviewGuardIntents(guard: IncomingNavigationGuard | null, intents: ReturnType<typeof createReviewNavigationIntents>): IncomingNavigationGuard | null {
  if (!guard) return null;
  return {
    get blocked() { return guard.blocked; },
    request: (proceed, stay) => {
      const intent = intents.prepare(proceed);
      guard.request(intent.proceed, () => { intent.stay(); stay(); });
    },
  };
}

/** Cooperative preflight for explicitly opted-in controls, not a router/history patch. */
export function createReviewNavigationDispatcher() {
  let owner: { request: (action: () => void) => void } | null = null;
  return {
    register: (request: (action: () => void) => void) => {
      const current = { request }; owner = current;
      return () => { if (owner === current) owner = null; };
    },
    hasOwner: () => owner !== null,
    request: (action: () => void, isCurrent: () => boolean) => {
      const source = owner;
      let consumed = false;
      const proceed = () => { if (!consumed && owner === source && isCurrent()) { consumed = true; action(); } };
      if (source) source.request(proceed);
      else proceed();
    },
  };
}
export const reviewNavigationDispatcher = createReviewNavigationDispatcher();

/** All authorization-bearing fields in the public session contract; expiry refresh is not an account switch. */
export function reviewSessionKey(session: { user?: { id: string; role: string; sessionVersion: number } } | null | undefined, status: string) {
  return JSON.stringify([status, session?.user?.id, session?.user?.role, session?.user?.sessionVersion]);
}

/** One root-owned listener runs before router teardown; only the active review owns it. */
export function createReviewPopDispatcher() {
  let active: ((event: PopStateEvent) => void) | null = null;
  return {
    register: (handler: (event: PopStateEvent) => void) => {
      active = handler;
      return () => { if (active === handler) active = null; };
    },
    dispatch: (event: PopStateEvent) => { active?.(event); },
  };
}
export const reviewPopDispatcher = createReviewPopDispatcher();
