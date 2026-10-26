import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

// Exercise the actual page's event handlers/effects without a browser or DB.
// Child UI primitives remain opaque; this harness only owns the page's hooks.
const hooks = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  effects: [] as (() => void)[],
  dirty: true,
}));
type EffectSlot = { dependencies: unknown[]; cleanup?: () => void; effect?: () => (() => void) | void };
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const changed = (previous: unknown[] | undefined, next: unknown[]) =>
    !previous || previous.length !== next.length || next.some((value, index) => !Object.is(value, previous[index]));
  return {
    ...actual,
    useState(initial: unknown) {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks.slots[index], (value: unknown) => {
        const next = typeof value === 'function' ? value(hooks.slots[index]) : value;
        if (!Object.is(next, hooks.slots[index])) { hooks.slots[index] = next; hooks.dirty = true; }
      }];
    },
    useRef(initial: unknown) {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index];
    },
    useCallback(callback: unknown, dependencies: unknown[]) {
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as { dependencies: unknown[]; callback: unknown } | undefined;
      if (changed(previous?.dependencies, dependencies)) hooks.slots[index] = { dependencies, callback };
      return (hooks.slots[index] as { callback: unknown }).callback;
    },
    useEffect(effect: () => (() => void) | void, dependencies: unknown[]) {
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as EffectSlot | undefined;
      if (changed(previous?.dependencies, dependencies)) {
        const slot: EffectSlot = { dependencies, effect };
        hooks.slots[index] = slot;
        hooks.effects.push(() => { previous?.cleanup?.(); slot.cleanup = effect() || undefined; });
      }
    },
  };
});

vi.mock('@/components/settings/admin-workspace.module.css', () => ({ default: {} }));

import ApiKeysPage from '@/app/settings/api-keys/page';

type Node = ReactElement<Record<string, unknown>>;
let tree: ReactNode;
let read: (signal: AbortSignal) => Promise<Response>;
let requests: string[];
const validKey = { id: 91, name: 'Synthetic list fixture', keyPrefix: 'synthetic-prefix-only', scopes: ['read'],
  isActive: true, expiresAt: null, lastUsedAt: null, createdAt: '2026-10-26T00:00:00.000Z' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children as ReactNode), ...nodes(node.props.actions as ReactNode)];
}
function text(value: ReactNode): string {
  if (Array.isArray(value)) return value.map(text).join('');
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return value && typeof value === 'object' && 'props' in value ? text((value as Node).props.children as ReactNode) : '';
}
function find(predicate: (node: Node) => boolean): Node {
  const result = nodes(tree).find(predicate);
  expect(result).toBeDefined();
  return result!;
}
function button(label: string) {
  return find(node => typeof node.props.onClick === 'function' && (node.props['aria-label'] === label || text(node) === label));
}
function click(label: string) { return (button(label).props.onClick as () => Promise<void> | void)(); }
async function flush() {
  for (let iteration = 0; iteration < 30; iteration++) {
    if (hooks.dirty) {
      hooks.dirty = false; hooks.cursor = 0; tree = ApiKeysPage();
      hooks.effects.splice(0).forEach(effect => effect());
    }
    await new Promise(resolve => setImmediate(resolve));
    if (!hooks.dirty && !hooks.effects.length) return;
  }
  throw new Error('Page did not settle');
}
function expectUnknown() {
  expect(text(tree)).toContain('Anzahl und Status unbekannt');
  expect(text(tree)).not.toContain('0/10');
  expect(text(tree)).not.toContain('Noch keine Schlüssel');
  expect(text(tree)).not.toContain(validKey.name);
  expect(nodes(tree).some(node => node.props['aria-label'] === `${validKey.name} deaktivieren`)).toBe(false);
  expect(button('Neuen API-Key erstellen').props.disabled).toBe(true);
}
function cleanup() { for (const slot of hooks.slots) (slot as EffectSlot | undefined)?.cleanup?.(); }
beforeEach(() => {
  hooks.cursor = 0; hooks.slots = []; hooks.effects = []; hooks.dirty = true;
  read = async () => json([]); requests = [];
  vi.stubGlobal('fetch', vi.fn((resource: string, options?: RequestInit) => {
    const method = options?.method ?? 'GET'; requests.push(`${method} ${resource}`);
    if (method !== 'GET') throw new Error('This read-only test forbids API mutations');
    if (resource === '/api/cors-settings') return Promise.resolve(json({ origins: [], defaultOrigins: [] }));
    if (resource !== '/api/api-keys') throw new Error(`Unexpected read ${resource}`);
    return read(options?.signal as AbortSignal);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('API key list read UI, without any key mutations (#83)', () => {
  it('keeps unknown counts and disabled creation while pending, then confirms only successful empty lists', async () => {
    const pending = deferred<Response>(); read = () => pending.promise;
    await flush(); expectUnknown();
    expect(find(node => node.props.role === 'region').props['aria-busy']).toBe(true);
    expect(text(find(node => node.props.role === 'status'))).toBe('API-Schlüssel werden geladen…');
    pending.resolve(json([])); await flush();
    expect(text(tree)).toContain('0/10 · 0 aktiv');
    expect(text(tree)).toContain('Noch keine Schlüssel');
    expect(button('Neuen API-Key erstellen').props.disabled).toBe(false);
    expect(button('API-Key erstellen')).toBeDefined();
  });
  it.each([
    ['503', () => Promise.resolve(json({ error: 'synthetic' }, 503))],
    ['401', () => Promise.resolve(json({ error: 'synthetic' }, 401))],
    ['403', () => Promise.resolve(json({ error: 'synthetic' }, 403))],
    ['network', () => Promise.reject(new Error('synthetic delivery interruption'))],
    ['JSON', () => Promise.resolve(new Response('{broken', { status: 200 }))],
    ['object', () => Promise.resolve(json({ keys: [] }))],
    ['null', () => Promise.resolve(json(null))],
    ['malformed row', () => Promise.resolve(json([{ ...validKey, scopes: null }]))],
    ['missing field', () => Promise.resolve(json([{ id: 91, name: 'incomplete' }]))],
    ['invalid date', () => Promise.resolve(json([{ ...validKey, expiresAt: 'not-a-date' }]))],
  ] as const)('keeps %s deliveries unavailable until one deliberate GET retry', async (_label, failure) => {
    read = failure; await flush(); expectUnknown();
    expect(text(find(node => node.props.role === 'alert'))).toContain('nicht geladen');
    const count = requests.length; await flush(); expect(requests).toHaveLength(count);
    const pending = deferred<Response>(); read = () => pending.promise;
    const retry = click('Erneut versuchen'); await flush(); expectUnknown();
    expect(nodes(tree).filter(node => node.props.role === 'alert')).toHaveLength(0);
    expect(requests).toHaveLength(count + 1);
    pending.resolve(json([validKey])); await retry; await flush();
    expect(text(tree)).toContain('1/10 · 1 aktiv');
    expect(text(tree)).toContain(validKey.name);
    expect(button(`${validKey.name} deaktivieren`)).toBeDefined();
    expect(requests.every(request => request.startsWith('GET '))).toBe(true);
  });
  it('retains existing confirmed active, inactive and expired key counts without exposing full secrets', async () => {
    read = async () => json([validKey, { ...validKey, id: 92, name: 'Synthetic inactive', isActive: false },
      { ...validKey, id: 93, name: 'Synthetic expired', expiresAt: '2000-01-01T00:00:00.000Z' }]);
    await flush(); expect(text(tree)).toContain('3/10 · 1 aktiv');
    expect(text(tree)).toContain('Abgelaufen'); expect(text(tree)).toContain('Deaktiviert');
    expect(text(tree)).toContain(validKey.keyPrefix);
    expect(requests.every(request => request.startsWith('GET '))).toBe(true);
  });
  it('invalidates confirmed rows, counts and row actions immediately during a failed refresh', async () => {
    read = async () => json([validKey]); await flush();
    const pending = deferred<Response>(); read = () => pending.promise;
    const refresh = click('Schlüsselliste aktualisieren'); await flush(); expectUnknown();
    pending.resolve(json({}, 503)); await refresh; await flush(); expectUnknown();
    expect(button('Erneut versuchen')).toBeDefined();
    expect(requests.filter(request => request === 'GET /api/api-keys')).toHaveLength(2);
  });
  it.each(['success', 'error'] as const)('ignores an older %s after a newer confirmed read, even when transport ignores abort', async outcome => {
    read = async () => json({}, 503); await flush();
    const retry = button('Erneut versuchen').props.onClick as () => Promise<void>;
    const older = deferred<Response>(); const newer = deferred<Response>();
    const signals: AbortSignal[] = [];
    read = signal => { signals.push(signal); return signals.length === 1 ? older.promise : newer.promise; };
    const oldRead = retry(); const newRead = retry(); await flush(); expectUnknown();
    expect(signals[0].aborted).toBe(true); expect(signals[1].aborted).toBe(false);
    newer.resolve(json([validKey])); await newRead; await flush();
    older.resolve(outcome === 'success' ? json([]) : json({}, 503)); await oldRead; await flush();
    expect(text(tree)).toContain('1/10 · 1 aktiv'); expect(text(tree)).not.toContain('Noch keine Schlüssel');
    expect(nodes(tree).filter(node => node.props.role === 'alert')).toHaveLength(0);
  });
  it('aborts reads on unmount, ignores a late result and does not restart through a retained callback', async () => {
    read = async () => json({}, 503); await flush();
    const retry = button('Erneut versuchen').props.onClick as () => Promise<void>;
    const pending = deferred<Response>(); let signal!: AbortSignal;
    read = next => { signal = next; return pending.promise; };
    const request = retry(); await flush(); cleanup();
    expect(signal.aborted).toBe(true); hooks.dirty = false;
    pending.resolve(json([validKey])); await request;
    expect(hooks.dirty).toBe(false);
    const count = requests.length; await retry(); expect(requests).toHaveLength(count);
  });
});
