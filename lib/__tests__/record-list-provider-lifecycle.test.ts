import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], queue: [] as (() => void)[], dirty: false }));
type Effect = { deps?: unknown[]; cleanup?: () => void };
vi.mock('react', async load => ({
  ...await load<typeof import('react')>(),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: unknown) => { if (!Object.is(value, hooks.slots[index])) hooks.dirty = true; hooks.slots[index] = value; }];
  },
  useRef(initial: unknown) { const index = hooks.cursor++; if (!(index in hooks.slots)) hooks.slots[index] = { current: initial }; return hooks.slots[index]; },
  useCallback(callback: unknown) { return callback; },
  useLayoutEffect(callback: () => (() => void) | void, deps?: unknown[]) {
    const index = hooks.cursor++, previous = hooks.slots[index] as Effect | undefined;
    if (!previous || !deps || deps.some((value, position) => !Object.is(value, previous.deps?.[position]))) {
      const effect: Effect = { deps }; hooks.slots[index] = effect;
      hooks.queue.push(() => { previous?.cleanup?.(); effect.cleanup = callback() || undefined; });
    }
  },
}));
const client = vi.hoisted(() => ({ location: '/dashboard', status: 'authenticated', user: { id: 'synthetic-owner', role: 'USER', sessionVersion: 1 } }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: client.user }, status: client.status }) }));
vi.mock('next/navigation', () => ({ usePathname: () => new URL(client.location, 'https://synthetic.test').pathname, useSearchParams: () => new URL(client.location, 'https://synthetic.test').searchParams }));
import { RecordListSearchProvider, type RecordListSearch } from '@/components/record-search/record-list-search-provider';
type Value = { active: RecordListSearch | null; begin: (type: 'customer' | 'outbound' | 'inbound', query: string) => boolean; clear: () => void };
let listeners: Map<string, Set<(event?: unknown) => void>>;
let value: Value;
const child = { type: 'synthetic-stable-shell', props: {}, key: null } as unknown as ReactNode;
function render(effects = true) {
  hooks.cursor = 0; hooks.dirty = false;
  const tree = RecordListSearchProvider({ children: child }) as ReactElement<{ value: Value; children: ReactNode }>;
  value = tree.props.value; expect(tree.props.children).toBe(child); expect(tree.key).toBe(null);
  if (effects) { hooks.queue.splice(0).forEach(run => run()); if (hooks.dirty) render(); }
  return value;
}
function emit(type: string, event?: unknown) { listeners.get(type)?.forEach(callback => callback(event)); render(); }
beforeEach(() => {
  hooks.cursor = 0; hooks.slots = []; hooks.queue = []; hooks.dirty = false; listeners = new Map();
  client.location = '/dashboard'; client.status = 'authenticated'; client.user = { id: 'synthetic-owner', role: 'USER', sessionVersion: 1 };
  vi.stubGlobal('window', {
    addEventListener: (type: string, callback: (event?: unknown) => void) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(callback); },
    removeEventListener: (type: string, callback: (event?: unknown) => void) => listeners.get(type)?.delete(callback),
  });
  render();
});
afterEach(() => {
  for (const slot of hooks.slots) if (slot && typeof slot === 'object' && 'cleanup' in slot) (slot as Effect).cleanup?.();
  vi.unstubAllGlobals();
});
describe('memory-only list lifecycle without shell/provider remount or history writes', () => {
  it('waits for the intended list and consumes a same-list handoff immediately', () => {
    expect(value.begin('customer', 'Synthetic')).toBe(true); render(); expect(value.active).toBe(null);
    client.location = '/customers'; render(); expect(value.active).toMatchObject({ type: 'customer', query: 'Synthetic' });
    const previous = value.active!.revision;
    value.begin('customer', 'New term'); render(); expect(value.active).toMatchObject({ query: 'New term' }); expect(value.active!.revision).toBeGreaterThan(previous);
  });
  it('disposes a pending transfer if a newer unrelated destination wins', () => {
    value.begin('customer', 'Synthetic'); render(); client.location = '/settings'; render(); client.location = '/customers'; render(); expect(value.active).toBe(null);
  });
  it('never resurrects after leaving, explicit clear, native traversal or page restore', () => {
    client.location = '/purchases?reviewStatus=ALL'; render();
    for (const event of ['clear', 'popstate', 'pagehide', 'pageshow']) {
      value.begin('inbound', 'Synthetic'); render(); expect(value.active).not.toBe(null);
      if (event === 'clear') { value.clear(); render(); } else emit(event, { persisted: true });
      expect(value.active).toBe(null);
    }
    value.begin('inbound', 'Synthetic'); render(); client.location = '/settings'; render(); client.location = '/purchases'; render(); expect(value.active).toBe(null);
  });
  it.each(['id', 'role', 'sessionVersion', 'logout'])('hides old content synchronously on %s replacement and rejects the old callback', field => {
    client.location = '/customers'; render(); value.begin('customer', 'Private previous term'); render(); const oldBegin = value.begin;
    if (field === 'id') client.user = { ...client.user, id: 'other-owner' };
    if (field === 'role') client.user = { ...client.user, role: 'ADMIN' };
    if (field === 'sessionVersion') client.user = { ...client.user, sessionVersion: 2 };
    if (field === 'logout') client.status = 'unauthenticated';
    render(false); expect(value.active).toBe(null); expect(oldBegin('customer', 'Old callback')).toBe(false);
    hooks.queue.splice(0).forEach(run => run()); render(); expect(value.active).toBe(null);
  });
});
