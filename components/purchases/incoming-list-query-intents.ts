type QueryChanges = Readonly<Record<string, string | null>>;

function listLocation(href: string) {
  const url = new URL(href);
  const query = url.searchParams.toString();
  return { pathname: url.pathname, query, href: `${url.origin}${url.pathname}${query ? `?${query}` : ''}${url.hash}`, origin: url.origin };
}

/**
 * Pending explicit query intent, not optimistic route/data state. Only compose
 * after navigation preflight proceeds; observe never issues a navigation.
 */
export function createIncomingListQueryIntents() {
  let pending: { locations: Set<string>; query: string; destination: string } | null = null;
  return {
    invalidate: () => { pending = null; },
    compose: (href: string, pathname: string, changes: QueryChanges): string | null => {
      const actual = listLocation(href);
      // An old workspace callback must not navigate back from another route.
      if (actual.pathname !== pathname) { pending = null; return null; }
      if (pending && !pending.locations.has(actual.href)) pending = null;
      const next = new URLSearchParams(pending?.query ?? actual.query);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) next.delete(key); else next.set(key, value);
      }
      const query = next.toString();
      const destination = `${pathname}${query ? `?${query}` : ''}`;
      const locations = pending?.locations ?? new Set([actual.href]);
      const target = `${actual.origin}${destination}`;
      locations.add(target);
      pending = { locations, query, destination: target };
      return destination;
    },
    observe: (pathname: string, query: string, href: string): boolean => {
      const actual = listLocation(href);
      // An unrelated real URL ends the old intent even if the router is late.
      if (pending && !pending.locations.has(actual.href)) pending = null;
      if (actual.pathname !== pathname || actual.query !== query) return false;
      // An intermediate committed predecessor cannot replace the newer intent.
      if (pending?.destination === actual.href) pending = null;
      return true;
    },
  };
}
