import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { RecordSearchState } from '@/lib/record-search/client';

// Keep React commits, the receipt owner's heading effect and Radix's deferred
// onCloseAutoFocus separate. In particular, flushSync does not run that event.
const hooks = vi.hoisted(() => ({
  cursor: 0, slots: [] as unknown[], effects: [] as (() => void)[],
  layout: [] as (() => void)[], flushCommit: null as (() => void) | null,
}));
type EffectSlot = { dependencies?: unknown[]; cleanup?: () => void };
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  function effect(queue: (() => void)[], callback: () => (() => void) | void, dependencies?: unknown[]) {
    const index = hooks.cursor++, previous = hooks.slots[index] as EffectSlot | undefined;
    if (!dependencies || !previous || dependencies.some((value, position) => !Object.is(value, previous.dependencies?.[position]))) {
      const slot: EffectSlot = { dependencies }; hooks.slots[index] = slot;
      queue.push(() => { previous?.cleanup?.(); slot.cleanup = callback() || undefined; });
    }
  }
  return {
    ...actual,
    useState(initial: unknown) {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = typeof value === 'function' ? value(hooks.slots[index]) : value; }];
    },
    useRef(initial: unknown) {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index];
    },
    useCallback(callback: unknown, dependencies: unknown[]) {
      const index = hooks.cursor++, previous = hooks.slots[index] as { dependencies: unknown[]; callback: unknown } | undefined;
      if (!previous || dependencies.some((value, position) => !Object.is(value, previous.dependencies[position]))) hooks.slots[index] = { dependencies, callback };
      return (hooks.slots[index] as { callback: unknown }).callback;
    },
    useEffect: (callback: () => (() => void) | void, dependencies?: unknown[]) => effect(hooks.effects, callback, dependencies),
    useLayoutEffect: (callback: () => (() => void) | void, dependencies?: unknown[]) => effect(hooks.layout, callback, dependencies),
  };
});
vi.mock('react-dom', async importOriginal => ({
  ...await importOriginal<typeof import('react-dom')>(),
  flushSync: (callback: () => void) => { callback(); hooks.flushCommit?.(); },
}));
const client = vi.hoisted(() => ({
  push: vi.fn(), signOut: vi.fn(), setTheme: vi.fn(), search: vi.fn(), cancelSearch: vi.fn(),
  href: 'https://bivaro.test/purchases?document=10', status: 'authenticated',
  session: { user: { id: 'synthetic-owner', role: 'ADMIN', sessionVersion: 1 } },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: client.push }),
  usePathname: () => new URL(client.href).pathname,
  useSearchParams: () => new URL(client.href).searchParams,
}));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: client.session, status: client.status }), signOut: client.signOut }));
vi.mock('next-themes', () => ({ useTheme: () => ({ setTheme: client.setTheme }) }));
vi.mock('@/lib/record-search/client', () => ({ startRecordSearch: client.search }));
import { CommandPalette } from '@/components/command-palette';
import { createReviewNavigationIntents, reviewNavigationDispatcher } from '@/components/purchases/incoming-review-history';

type Node = ReactElement<Record<string, unknown>>;
class Target {
  isConnected = true;
  readonly tagName = 'FOCUS-TARGET';
  readonly children: Target[] = [];
  constructor(readonly palette = false, readonly label = 'control') {}
  // Preserve readable assertion failures when Vitest inspects HTMLElement.
  getAttributeNames() { return ['data-focus-target']; }
  getAttribute() { return this.label; }
  closest() { return this.palette ? this : null; }
  focus = vi.fn(() => { if (this.isConnected) active = this; });
}
type Choice = ReturnType<ReturnType<typeof createReviewNavigationIntents>['prepare']>;
type Request = { choice: Choice; source: Target; open: unknown; query: unknown; records: number };
let tree: Node | null, active: Target, body: Target, source: Target, heading: Target, input: Target | null;
let mountedKey: string | null, requests: Request[], callbacks: ((event: Event) => void)[];
let listeners: Map<string, (event: KeyboardEvent) => void>, unregister: () => void;
let intents: ReturnType<typeof createReviewNavigationIntents>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children as ReactNode)];
}
function find(predicate: (node: Node) => boolean) {
  const node = nodes(tree).find(predicate); expect(node).toBeDefined(); return node!;
}
function invoke(node: Node): Node | null {
  expect(typeof node.type).toBe('function');
  return (node.type as (props: Record<string, unknown>) => Node | null)(node.props);
}
function cleanupEffects() {
  for (const slot of hooks.slots) {
    if (slot && typeof slot === 'object' && 'cleanup' in slot) (slot as EffectSlot).cleanup?.();
  }
}
function commit() {
  const previous = tree;
  const previousKey = mountedKey;
  const suspense = CommandPalette() as Node;
  const scoped = invoke(suspense.props.children as Node);
  const key = scoped?.key === null || !scoped ? null : String(scoped.key);
  if (key !== mountedKey) {
    cleanupEffects(); hooks.slots = []; hooks.layout = []; hooks.effects = []; mountedKey = key;
  }
  hooks.cursor = 0; tree = scoped ? invoke(scoped) : null;
  const wasOpen = previous?.props.open === true, open = tree?.props.open === true;
  if (wasOpen && !open) {
    callbacks.push(nodes(previous).find(node => node.props['aria-label'] === 'Befehlspalette')!.props.onCloseAutoFocus as (event: Event) => void);
    if (input) { input.isConnected = false; if (active === input) active = body; }
  }
  if (open && (!wasOpen || key !== previousKey)) {
    input = new Target(true, 'palette input'); input.focus();
  }
  hooks.layout.splice(0).forEach(effect => effect());
  hooks.effects.splice(0).forEach(effect => effect());
}
function unmount() {
  cleanupEffects(); hooks.slots = []; hooks.layout = []; hooks.effects = []; mountedKey = null; tree = null;
  if (input) { input.isConnected = false; if (active === input) active = body; }
}
function openPalette(owner = source) {
  owner.focus();
  listeners.get('keydown')!({ key: 'k', ctrlKey: true, preventDefault: vi.fn() } as unknown as KeyboardEvent);
  commit(); expect(tree?.props.open).toBe(true); expect(active).toBe(input);
}
function closePalette() { (tree!.props.onOpenChange as (value: boolean) => void)(false); commit(); }
function query(value: string) {
  (find(node => node.props['aria-label'] === 'Aktionen und Datensätze suchen').props.onValueChange as (value: string) => void)(value);
  commit();
}
function select(value: string) {
  (find(node => node.props.value === value && typeof node.props.onSelect === 'function').props.onSelect as () => void)();
}
function selectCommand(label: string) {
  (find(node => typeof node.props.value === 'string' && node.props.value.startsWith(`${label} `) && typeof node.props.onSelect === 'function').props.onSelect as () => void)();
}
function closeAutoFocus() {
  const callback = callbacks.shift(); expect(callback).toBeDefined();
  const event = { preventDefault: vi.fn() }; callback!(event as unknown as Event);
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
  // Installed Radix resumes the underlying scope after this handler returns.
}
function commitChooser() {
  // The fake receipt owner deliberately commits its heading separately, like
  // incoming-document-review's pendingNavigation effect. Palette, dispatcher,
  // session/source checks and latest-intent handling are the production code.
  expect(requests.length).toBeGreaterThan(0); expect(tree?.props.open).toBe(false);
  heading.focus();
}
function loadResults() { query('Synthetic'); vi.advanceTimersByTime(250); commit(); }

beforeEach(() => {
  vi.useFakeTimers(); hooks.cursor = 0; hooks.slots = []; hooks.effects = []; hooks.layout = [];
  tree = null; mountedKey = null; input = null; requests = []; callbacks = []; listeners = new Map();
  body = new Target(false, 'body'); source = new Target(false, 'source'); heading = new Target(false, 'chooser heading'); active = body;
  client.href = 'https://bivaro.test/purchases?document=10'; client.status = 'authenticated';
  client.session = { user: { id: 'synthetic-owner', role: 'ADMIN', sessionVersion: 1 } };
  client.push.mockReset(); client.signOut.mockReset(); client.setTheme.mockReset(); client.cancelSearch.mockReset();
  client.search.mockReset().mockImplementation((term: string, publish: (state: RecordSearchState) => void) => {
    publish({ query: term, pages: { customer: 0, outbound: 0, inbound: 0 }, status: 'ready', result: { groups: [
      { type: 'customer', page: 0, items: [{ type: 'customer', id: 11, label: 'Synthetic customer', href: '/customers?customer=11' }], hasMore: true },
      { type: 'outbound', page: 0, items: [{ type: 'outbound', id: 12, label: 'Synthetic outbound', href: '/dashboard?tab=invoices&document=12' }], hasMore: true },
      { type: 'inbound', page: 0, items: [{ type: 'inbound', id: 13, label: 'Synthetic incoming', href: '/purchases?document=13' }], hasMore: true },
    ] } });
    return { cancel: client.cancelSearch, done: Promise.resolve() };
  });
  vi.stubGlobal('HTMLElement', Target);
  vi.stubGlobal('document', {
    body, get activeElement() { return active; },
    addEventListener: (type: string, listener: (event: KeyboardEvent) => void) => { listeners.set(type, listener); },
    removeEventListener: (type: string, listener: (event: KeyboardEvent) => void) => { if (listeners.get(type) === listener) listeners.delete(type); },
  });
  vi.stubGlobal('window', { location: { get href() { return client.href; } } });
  hooks.flushCommit = commit;
  intents = createReviewNavigationIntents(() => client.href);
  unregister = reviewNavigationDispatcher.register(action => requests.push({
    choice: intents.prepare(action), source: active, open: tree?.props.open,
    query: find(node => node.props['aria-label'] === 'Aktionen und Datensätze suchen').props.value,
    records: nodes(tree).filter(node => typeof node.props.value === 'string' && node.props.value.startsWith('record:')).length,
  }));
  commit();
});
afterEach(() => { unmount(); unregister(); intents.invalidate(); hooks.flushCommit = null; vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('palette focus handoff across Radix deferred close autofocus', () => {
  it.each(['before', 'after'] as const)('retains chooser heading focus when the close callback runs %s its effect', order => {
    openPalette(); query('Kun'); selectCommand('Kunden');
    expect(requests).toHaveLength(1);
    expect(client.push).not.toHaveBeenCalled();
    if (order === 'before') closeAutoFocus();
    commitChooser();
    if (order === 'after') closeAutoFocus();
    expect(active).toBe(heading);
    expect(requests[0].source).toBe(source);
    requests[0].choice.proceed(); requests[0].choice.proceed();
    expect(client.push).toHaveBeenCalledExactlyOnceWith('/customers');
  });
  it('restores the source after an ordinary Escape close, without starting a navigation intent', () => {
    openPalette(); source.focus.mockClear(); closePalette();
    expect(active).toBe(body); closeAutoFocus();
    expect(active).toBe(source); expect(source.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(requests).toHaveLength(0);
  });
  it('does not steal focus from another control before the delayed close callback', () => {
    openPalette(); closePalette(); const elsewhere = new Target(); elsewhere.focus(); closeAutoFocus();
    expect(active).toBe(elsewhere);
  });
  it('ignores an old close callback after reopening, including a newer input focus', () => {
    openPalette(); closePalette(); openPalette(); const newerInput = input;
    closeAutoFocus(); expect(active).toBe(newerInput); expect(tree?.props.open).toBe(true);
    closePalette(); closeAutoFocus(); expect(active).toBe(source);
  });
  it('does not restore a detached source', () => {
    openPalette(); source.isConnected = false; source.focus.mockClear(); closePalette(); closeAutoFocus();
    expect(source.focus).not.toHaveBeenCalled(); expect(active).toBe(body);
  });
  it('ignores pending actions and close restoration after the palette owner unmounts', () => {
    openPalette(); selectCommand('Kunden'); source.focus.mockClear(); unmount(); active = body;
    closeAutoFocus(); requests[0].choice.proceed();
    expect(source.focus).not.toHaveBeenCalled(); expect(active).toBe(body); expect(client.push).not.toHaveBeenCalled();
  });
  it('rejects a changed exact source URL before a pending choice proceeds', () => {
    openPalette(); selectCommand('Kunden'); client.href += '#changed-source'; requests[0].choice.proceed();
    expect(client.push).not.toHaveBeenCalled();
  });
  it('does not revive a previous session after an authenticated palette replacement', () => {
    openPalette(); selectCommand('Kunden'); client.session.user.sessionVersion++; commit();
    source.focus.mockClear(); active = body; closeAutoFocus(); requests[0].choice.proceed();
    expect(source.focus).not.toHaveBeenCalled(); expect(client.push).not.toHaveBeenCalled();
  });
  it('keeps a newer review-local intent authoritative over the earlier palette choice', () => {
    openPalette(); selectCommand('Kunden'); const localAction = vi.fn(), newer = intents.prepare(localAction);
    requests[0].choice.proceed(); expect(client.push).not.toHaveBeenCalled();
    newer.proceed(); expect(localAction).toHaveBeenCalledTimes(1);
  });
});

const staticRoutes = [
  ['Dashboard öffnen', '/dashboard'], ['Einnahmen', '/dashboard?tab=incomes'], ['Belegeingang', '/purchases'],
  ['Ausgaben', '/dashboard?tab=expenses'], ['Rechnungen', '/dashboard?tab=invoices'], ['Kassenbuch', '/cashbook'],
  ['Mahnwesen', '/dashboard/reminders'], ['Steuer-Simulation', '/steuer-simulation'], ['Kunden', '/customers'],
  ['Einstellungen', '/settings'], ['Benutzerverwaltung', '/users'], ['Neue Rechnung erstellen', '/dashboard/invoices/new'],
  ['Neues Angebot erstellen', '/dashboard/quotes/new'], ['Neue Ausgabe erfassen', '/dashboard?tab=expenses&new=1'],
  ['Neue Einnahme erfassen', '/dashboard?tab=incomes&new=1'],
];
describe('every palette navigation entry closes and clears before the real cooperative preflight', () => {
  it.each(staticRoutes)('%s uses a single guarded action for %s', (label, href) => {
    openPalette(); query(label.slice(0, 3)); selectCommand(label);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ source, open: false, query: '', records: 0 });
    expect(client.push).not.toHaveBeenCalled(); requests[0].choice.proceed(); requests[0].choice.proceed();
    expect(client.push).toHaveBeenCalledExactlyOnceWith(href);
  });
  it.each([
    ['record:customer:11', '/customers?customer=11'], ['record:outbound:12', '/dashboard?tab=invoices&document=12'],
    ['record:inbound:13', '/purchases?document=13'], ['record-list:customer', '/customers'],
    ['record-list:outbound', '/dashboard?tab=invoices'], ['record-list:inbound', '/purchases?reviewStatus=ALL'],
  ])('%s clears fetched results before guarding %s', (value, href) => {
    openPalette(); loadResults(); select(value);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ source, open: false, query: '', records: 0 });
    expect(client.cancelSearch).toHaveBeenCalledTimes(1); expect(client.push).not.toHaveBeenCalled();
    requests[0].choice.proceed(); requests[0].choice.proceed(); expect(client.push).toHaveBeenCalledExactlyOnceWith(href);
  });
  it('guards logout after clearing the palette and never signs out on stay', () => {
    openPalette(); query('Abm'); selectCommand('Abmelden');
    expect(requests[0]).toMatchObject({ source, open: false, query: '', records: 0 });
    expect(client.signOut).not.toHaveBeenCalled(); requests[0].choice.stay(); requests[0].choice.proceed();
    expect(client.signOut).not.toHaveBeenCalled(); closeAutoFocus();
    openPalette(); selectCommand('Abmelden'); requests[1].choice.proceed(); requests[1].choice.proceed();
    expect(client.signOut).toHaveBeenCalledExactlyOnceWith({ callbackUrl: '/' }); expect(client.push).not.toHaveBeenCalled();
  });
});
