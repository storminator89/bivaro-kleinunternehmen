import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

// Follow the existing node-only component lifecycle tests: execute the page's
// effects/handlers with in-memory hooks, never a browser, server, API or database.
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as (() => void)[], dirty: true, updates: 0 }));
type EffectSlot = { dependencies: unknown[]; cleanup?: () => void };
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: unknown) => {
      hooks.updates++;
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
    const index = hooks.cursor++, previous = hooks.slots[index] as { dependencies: unknown[]; callback: unknown } | undefined;
    if (!previous || dependencies.some((value, position) => !Object.is(value, previous.dependencies[position]))) hooks.slots[index] = { dependencies, callback };
    return (hooks.slots[index] as { callback: unknown }).callback;
  },
  useEffect(effect: () => (() => void) | void, dependencies: unknown[]) {
    const index = hooks.cursor++, previous = hooks.slots[index] as EffectSlot | undefined;
    if (!previous || dependencies.some((value, position) => !Object.is(value, previous.dependencies[position]))) {
      const slot: EffectSlot = { dependencies }; hooks.slots[index] = slot;
      hooks.effects.push(() => { previous?.cleanup?.(); slot.cleanup = effect() || undefined; });
    }
  },
}));
const context = vi.hoisted(() => ({ session: { user: { id: 'synthetic-admin', role: 'ADMIN', sessionVersion: 1 } } }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: context.session }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
import UsersPage from '@/app/users/page';
import { TableRow } from '@/components/ui/table';
import { Dialog } from '@/components/ui/dialog';

type Node = ReactElement<Record<string, unknown>>;
const user = { id: 'synthetic-user', name: 'Synthetic User', email: 'synthetic@example.invalid', role: 'USER', createdAt: '2026-01-01T00:00:00.000Z', deactivatedAt: null };
const json = (value: unknown = [user], status = 200) => new Response(JSON.stringify(value), { status });
let tree: ReactNode, fetchMock: ReturnType<typeof vi.fn>, alertMock: ReturnType<typeof vi.fn>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(item => nodes(item));
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children as ReactNode), ...nodes(node.props.actions as ReactNode)];
}
function text(value: ReactNode): string {
  if (Array.isArray(value)) return value.map(item => text(item)).join(' ');
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (!value || typeof value !== 'object' || !('props' in value)) return '';
  const node = value as Node;
  return `${text(node.props.children as ReactNode)} ${text(node.props.actions as ReactNode)}`;
}
function find(predicate: (node: Node) => boolean): Node {
  const node = nodes(tree).find(predicate); expect(node).toBeDefined(); return node!;
}
function shown() { return nodes(tree).filter(node => node.type === TableRow && node.key !== null).map(node => node.key); }
function click(label: string) { return (find(node => text(node.props.children as ReactNode).trim() === label && typeof node.props.onClick === 'function').props.onClick as () => void | Promise<void>)(); }
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function flush() {
  for (let iteration = 0; iteration < 20; iteration++) {
    if (hooks.dirty) {
      hooks.dirty = false; hooks.cursor = 0; tree = UsersPage();
      hooks.effects.splice(0).forEach(effect => effect());
    }
    await new Promise(resolve => setImmediate(resolve));
    if (!hooks.dirty && !hooks.effects.length) return;
  }
  throw new Error('Users page lifecycle did not settle');
}
function unmount() { for (const slot of hooks.slots) (slot as EffectSlot | undefined)?.cleanup?.(); }
function changeSession(role = 'ADMIN') { context.session = { user: { id: 'synthetic-next-admin', role, sessionVersion: 1 } }; hooks.dirty = true; }
function expectUnavailable(expectedRows: string[] = []) {
  expect(nodes(tree).some(node => node.props.role === 'alert')).toBe(true);
  expect(text(tree)).toMatch(/Benutzer konnten nicht (geladen|aktualisiert) werden\./);
  expect(text(tree)).not.toContain('Keine Benutzer gefunden.');
  expect(shown()).toEqual(expectedRows);
}
beforeEach(() => {
  hooks.cursor = 0; hooks.slots = []; hooks.effects = []; hooks.dirty = true; hooks.updates = 0; tree = null;
  context.session = { user: { id: 'synthetic-admin', role: 'ADMIN', sessionVersion: 1 } };
  // Every fetch, including synthetic mutation requests, is intercepted here.
  fetchMock = vi.fn().mockImplementation(async () => json()); vi.stubGlobal('fetch', fetchMock);
  alertMock = vi.fn(); vi.stubGlobal('alert', alertMock); vi.stubGlobal('confirm', vi.fn(() => true));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { unmount(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('users list read states', () => {
  it('shows loading until a read confirms an empty list, not an empty state while pending', async () => {
    const pending = deferred<Response>(); fetchMock.mockReturnValueOnce(pending.promise);
    await flush();
    expect(nodes(tree).some(node => node.props.role === 'status' && node.props['aria-label'] === 'Benutzer werden geladen')).toBe(true);
    expect(text(tree)).not.toContain('Keine Benutzer gefunden.');
    pending.resolve(json([])); await flush();
    expect(text(tree)).toContain('Keine Benutzer gefunden.');
    expect(nodes(tree).some(node => node.props.role === 'alert')).toBe(false);
  });

  it.each([
    ['401', () => Promise.resolve(json({}, 401))],
    ['403', () => Promise.resolve(json({}, 403))],
    ['500', () => Promise.resolve(json({}, 500))],
    ['network rejection', () => Promise.reject(new Error('Synthetic read failure'))],
    ['invalid JSON', () => Promise.resolve(new Response('{'))],
    ['non-list JSON', () => Promise.resolve(json({ users: [] }))],
  ])('offers explicit GET-only retry after %s, then renders recovered rows', async (_label, failure) => {
    fetchMock.mockImplementationOnce(failure); await flush(); expectUnavailable();
    const pending = deferred<Response>(); fetchMock.mockReturnValueOnce(pending.promise);
    click('Erneut versuchen'); await flush();
    expect(nodes(tree).some(node => node.props.role === 'status')).toBe(true);
    expect(text(tree)).not.toContain('Keine Benutzer gefunden.');
    expect(text(tree)).not.toContain('Erneut versuchen');
    pending.resolve(json()); await flush();
    expect(shown()).toEqual([user.id]);
    expect(fetchMock.mock.calls).toEqual([['/api/users'], ['/api/users']]);
    expect(alertMock).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'])('keeps the loaded editor and list mounted through a same-session refresh %s', async outcome => {
    await flush();
    (find(node => node.props['aria-label'] === `${user.name} bearbeiten`).props.onClick as () => void)(); await flush();
    (find(node => node.props.id === 'edit-name').props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'Unsaved synthetic draft' } }); await flush();
    const pending = deferred<Response>(); fetchMock.mockReturnValueOnce(pending.promise);
    // NextAuth may refresh its session object without changing the account.
    context.session = { user: { ...context.session.user } }; hooks.dirty = true; await flush();
    const expectEditor = () => {
      expect(nodes(tree).filter(node => node.type === Dialog)[1].props.open).toBe(true);
      expect(find(node => node.props.id === 'edit-name').props.value).toBe('Unsaved synthetic draft');
      expect(shown()).toEqual([user.id]);
    };
    expectEditor();
    expect(text(tree)).toContain('Benutzer werden aktualisiert.');
    if (outcome === 'success') {
      pending.resolve(json([{ ...user, name: 'Synthetic refreshed name' }])); await flush();
      expectEditor(); expect(text(tree)).toContain('Synthetic refreshed name');
      expect(nodes(tree).some(node => node.props.role === 'status' || node.props.role === 'alert')).toBe(false);
    } else {
      pending.resolve(json({}, 503)); await flush(); expectEditor(); expectUnavailable([user.id]);
      expect(text(tree)).toContain('Die angezeigten Daten sind möglicherweise nicht aktuell.');
      const retry = deferred<Response>(); fetchMock.mockReturnValueOnce(retry.promise);
      click('Erneut versuchen'); await flush(); expectEditor();
      expect(text(tree)).toContain('Benutzer werden aktualisiert.');
      retry.resolve(json()); await flush(); expectEditor();
    }
    expect(alertMock).not.toHaveBeenCalled();
  });

  it.each([401, 403])('hides loaded rows/editor after current HTTP %s until a successful validated read', async status => {
    await flush();
    (find(node => node.props['aria-label'] === `${user.name} bearbeiten`).props.onClick as () => void)(); await flush();
    expect(nodes(tree).filter(node => node.type === Dialog)[1].props.open).toBe(true);
    fetchMock.mockResolvedValueOnce(json({}, status));
    context.session = { user: { ...context.session.user } }; hooks.dirty = true; await flush();
    expectUnavailable(); expect(nodes(tree).some(node => node.type === Dialog)).toBe(false);
    expect(text(tree)).not.toContain(user.email);

    const retry = deferred<Response>(); fetchMock.mockReturnValueOnce(retry.promise);
    click('Erneut versuchen'); await flush();
    expect(nodes(tree).some(node => node.props.role === 'status')).toBe(true);
    expect(shown()).toEqual([]); expect(nodes(tree).some(node => node.type === Dialog)).toBe(false);
    retry.resolve(json({}, 503)); await flush();
    expectUnavailable(); expect(nodes(tree).some(node => node.type === Dialog)).toBe(false);
    fetchMock.mockRejectedValueOnce(new Error('Synthetic denied-read network interruption'));
    click('Erneut versuchen'); await flush();
    expectUnavailable(); expect(nodes(tree).some(node => node.type === Dialog)).toBe(false);
    fetchMock.mockResolvedValueOnce(new Response('{')); click('Erneut versuchen'); await flush();
    expectUnavailable(); expect(nodes(tree).some(node => node.type === Dialog)).toBe(false);

    fetchMock.mockResolvedValueOnce(json({ users: [] })); click('Erneut versuchen'); await flush();
    expectUnavailable(); expect(nodes(tree).some(node => node.type === Dialog)).toBe(false);
    fetchMock.mockResolvedValueOnce(json([{ ...user, name: 'Synthetic reauthorized snapshot' }]));
    click('Erneut versuchen'); await flush();
    expect(shown()).toEqual([user.id]); expect(text(tree)).toContain('Synthetic reauthorized snapshot');
    expect(nodes(tree).some(node => node.props.role === 'alert')).toBe(false);
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('ignores a stale HTTP 401 after a newer successful same-session read', async () => {
    await flush();
    (find(node => node.props['aria-label'] === `${user.name} bearbeiten`).props.onClick as () => void)(); await flush();
    const stale = deferred<Response>(); fetchMock.mockReturnValueOnce(stale.promise);
    context.session = { user: { ...context.session.user } }; hooks.dirty = true; await flush();
    fetchMock.mockResolvedValueOnce(json([{ ...user, name: 'Synthetic current snapshot' }]));
    context.session = { user: { ...context.session.user } }; hooks.dirty = true; await flush();
    stale.resolve(json({}, 401)); await flush();
    expect(shown()).toEqual([user.id]); expect(text(tree)).toContain('Synthetic current snapshot');
    expect(nodes(tree).filter(node => node.type === Dialog)[1].props.open).toBe(true);
    expect(nodes(tree).some(node => node.props.role === 'alert' || node.props.role === 'status')).toBe(false);
  });

  it('does not show a previous empty snapshot as confirmed empty while refreshing or unavailable', async () => {
    fetchMock.mockResolvedValueOnce(json([])); await flush(); expect(text(tree)).toContain('Keine Benutzer gefunden.');
    const pending = deferred<Response>(); fetchMock.mockReturnValueOnce(pending.promise);
    context.session = { user: { ...context.session.user } }; hooks.dirty = true; await flush();
    expect(text(tree)).toContain('Benutzer werden aktualisiert.'); expect(text(tree)).not.toContain('Keine Benutzer gefunden.');
    pending.resolve(json({}, 503)); await flush(); expectUnavailable();
    expect(text(tree)).toContain('Die angezeigten Daten sind möglicherweise nicht aktuell.');
    fetchMock.mockResolvedValueOnce(json([])); click('Erneut versuchen'); await flush();
    expect(text(tree)).toContain('Keine Benutzer gefunden.');
  });

  it.each(['success', 'failure'])('ignores a superseded %s without clearing the newer pending read', async outcome => {
    const old = deferred<Response>(), current = deferred<Response>();
    fetchMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    await flush(); changeSession(); await flush();
    if (outcome === 'success') old.resolve(json([])); else old.reject(new Error('Synthetic stale failure'));
    await flush();
    expect(nodes(tree).some(node => node.props.role === 'status')).toBe(true);
    expect(text(tree)).not.toContain('Keine Benutzer gefunden.');
    current.resolve(json()); await flush(); expect(shown()).toEqual([user.id]);
  });

  it('does not let a late old success replace a newer unavailable result', async () => {
    const old = deferred<Response>(); fetchMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(json({}, 503));
    await flush(); changeSession(); await flush(); expectUnavailable();
    old.resolve(json()); await flush(); expectUnavailable();
  });

  it('ignores a pending JSON completion after unmount', async () => {
    const body = deferred<unknown>(); fetchMock.mockResolvedValueOnce({ ok: true, json: () => body.promise });
    await flush(); unmount(); const updates = hooks.updates;
    body.resolve([user]); await new Promise(resolve => setImmediate(resolve));
    expect(hooks.updates).toBe(updates);
  });

  it('retains the non-admin access-denied view after an unsuccessful read', async () => {
    changeSession('USER'); fetchMock.mockResolvedValueOnce(json({}, 403)); await flush();
    expect(text(tree)).toContain('Zugriff verweigert');
    expect(text(tree)).not.toContain('Erneut versuchen'); expect(shown()).toEqual([]);
  });
});

describe('successful synthetic writes with failed list refresh', () => {
  it.each(['POST', 'PATCH', 'DELETE'])('does not report a successful %s as a failed write and marks the retained snapshot as possibly stale', async method => {
    await flush(); expect(shown()).toEqual([user.id]);
    if (method === 'POST') {
      (find(node => node.type === Dialog).props.onOpenChange as (open: boolean) => void)(true); await flush();
      for (const [id, value] of [['name', 'Synthetic New'], ['email', 'new@example.invalid'], ['password', 'Synthetic123']]) {
        (find(node => node.props.id === id).props.onChange as (event: { target: { value: string } }) => void)({ target: { value } }); await flush();
      }
    } else if (method === 'PATCH') {
      (find(node => node.props['aria-label'] === `${user.name} bearbeiten`).props.onClick as () => void)(); await flush();
    }
    fetchMock.mockImplementation(async (_url: string, options?: RequestInit) => options?.method ? new Response(null, { status: 204 }) : json({}, 503));
    if (method === 'DELETE') await (find(node => node.props['aria-label'] === 'Zugang deaktivieren').props.onClick as () => Promise<void>)();
    else {
      const forms = nodes(tree).filter(node => node.type === 'form');
      await (forms[method === 'POST' ? 0 : 1].props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>)({ preventDefault: vi.fn() });
    }
    await flush(); expectUnavailable([user.id]); expect(alertMock).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method)).toHaveLength(1);
    expect(fetchMock.mock.calls.find(([, options]) => options?.method)?.[1].method).toBe(method);
    fetchMock.mockImplementation(async () => json()); click('Erneut versuchen'); await flush();
    expect(shown()).toEqual([user.id]);
    expect(nodes(tree).filter(node => node.type === Dialog).every(node => node.props.open === false)).toBe(true);
    expect(alertMock).not.toHaveBeenCalled();
  });
});
