import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';

// Follow the existing node-only component harness: invoke the real page's
// callbacks, with render/commit separated and every transport stubbed.
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as (() => void)[], writes: 0 }));
type EffectSlot = { dependencies: unknown[]; cleanup?: () => void };
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: unknown) => {
      hooks.writes++;
      hooks.slots[index] = typeof value === 'function' ? value(hooks.slots[index]) : value;
    }];
  },
  useMemo: (factory: () => unknown) => factory(),
  useEffect(callback: () => (() => void) | void, dependencies: unknown[]) {
    const index = hooks.cursor++, previous = hooks.slots[index] as EffectSlot | undefined;
    if (!previous || dependencies.some((value, position) => !Object.is(value, previous.dependencies[position]))) {
      const slot: EffectSlot = { dependencies };
      hooks.slots[index] = slot;
      hooks.effects.push(() => { previous?.cleanup?.(); slot.cleanup = callback() || undefined; });
    }
  },
}));
const client = vi.hoisted(() => ({ fetch: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: client.push }) }));
import RegisterPage from '@/app/register/page';

type Element = ReactElement<Record<string, unknown>>;
const open = { isFirstUser: false, allowRegistration: true, bootstrapRequired: false };
const response = (body: unknown) => ({ ok: true, json: vi.fn().mockResolvedValue(body) });
function nodes(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...nodes(node.props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : '';
}
function commit() {
  hooks.cursor = 0;
  const tree = RegisterPage();
  hooks.effects.splice(0).forEach(effect => effect());
  return tree;
}
function unmount() { for (const slot of hooks.slots) (slot as EffectSlot | null | undefined)?.cleanup?.(); }
async function settle() { for (let index = 0; index < 4; index++) await Promise.resolve(); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(release => { resolve = release; });
  return { promise, resolve };
}
function retry(tree: ReactNode) {
  const button = nodes(tree).find(node => node.props.children === 'Status erneut prüfen');
  expect(button?.props.type).toBe('button');
  return button!.props.onClick as () => void;
}
function expectUnavailable(tree: ReactNode) {
  expect(text(tree)).toContain('Registrierungsstatus nicht verfügbar');
  expect(text(tree)).not.toContain('Registrierung deaktiviert');
  expect(nodes(tree).some(node => node.type === 'form')).toBe(false);
  expect(nodes(tree).some(node => node.props.id === 'setupToken')).toBe(false);
  expect(nodes(tree).some(node => node.props.href === '/login')).toBe(true);
}

beforeEach(() => {
  hooks.cursor = 0; hooks.slots = []; hooks.effects = []; hooks.writes = 0;
  vi.useFakeTimers();
  client.fetch.mockReset().mockResolvedValue(response(open));
  client.push.mockReset();
  vi.stubGlobal('fetch', client.fetch);
});
afterEach(() => { unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('registration status read state', () => {
  it.each([
    ['HTTP failure', () => Promise.resolve({ ...response(open), ok: false })],
    ['network failure', () => Promise.reject(new Error('offline'))],
    ['invalid JSON', () => Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError('invalid JSON')) })],
  ])('keeps %s distinct from confirmed disabled without automatically retrying', async (_name, read) => {
    client.fetch.mockImplementationOnce(read);
    expect(text(commit())).toContain('Registrierung wird vorbereitet');
    await settle();
    expectUnavailable(commit());
    vi.advanceTimersByTime(60_000);
    expect(client.fetch).toHaveBeenCalledTimes(1);
    expect(client.push).not.toHaveBeenCalled();
  });

  it.each([
    null, [], {}, { ...open, allowRegistration: 'true' },
    { ...open, bootstrapRequired: undefined },
    { ...open, isFirstUser: true },
    { ...open, bootstrapConsumed: 'false' },
  ].map(body => ({ body })))('keeps malformed status $body unavailable and fail-closed', async ({ body }) => {
    client.fetch.mockResolvedValue(response(body));
    commit(); await settle();
    expectUnavailable(commit());
  });

  it.each([
    [{ ...open, allowRegistration: false }, 'Registrierung deaktiviert'],
    [{ isFirstUser: true, allowRegistration: false, bootstrapRequired: true, bootstrapConsumed: false }, 'Erstregistrierung deaktiviert'],
    [{ isFirstUser: true, allowRegistration: false, bootstrapRequired: false, bootstrapConsumed: true }, 'Erstregistrierung abgeschlossen'],
  ])('preserves confirmed disabled/bootstrap wording: %s', async (body, heading) => {
    client.fetch.mockResolvedValue(response(body));
    commit(); await settle();
    const tree = commit();
    expect(text(tree)).toContain(heading);
    expect(nodes(tree).some(node => node.type === 'form')).toBe(false);
    expect(text(tree)).not.toContain('Status erneut prüfen');
  });

  it('rereads only on explicit retry, coalesces pre-commit clicks, and recovers to the ordinary form', async () => {
    client.fetch.mockRejectedValueOnce(new Error('offline'));
    commit(); await settle();
    const tree = commit();
    expectUnavailable(tree);
    const reread = retry(tree);
    reread(); reread();
    expect(text(commit())).toContain('Registrierung wird vorbereitet');
    expect(client.fetch).toHaveBeenCalledTimes(2);
    expect(client.fetch).toHaveBeenLastCalledWith('/api/auth/registration-status', expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
    await settle();
    const recovered = commit();
    expect(nodes(recovered).some(node => node.type === 'form')).toBe(true);
    expect(nodes(recovered).some(node => node.props.id === 'setupToken')).toBe(false);
    expect(client.fetch.mock.calls.every(([url]) => url === '/api/auth/registration-status')).toBe(true);
  });

  it('bounds a stalled read and ignores its late result after a newer confirmed-disabled retry', async () => {
    const old = deferred<ReturnType<typeof response>>();
    client.fetch.mockReturnValueOnce(old.promise);
    commit();
    const signal = client.fetch.mock.calls[0][1].signal as AbortSignal;
    vi.advanceTimersByTime(8000);
    expect(signal.aborted).toBe(true);
    const failed = commit();
    expectUnavailable(failed);
    client.fetch.mockResolvedValueOnce(response({ ...open, allowRegistration: false }));
    retry(failed)(); commit(); await settle();
    expect(text(commit())).toContain('Registrierung deaktiviert');
    old.resolve(response(open)); await settle();
    expect(text(commit())).toContain('Registrierung deaktiviert');
    expect(client.fetch).toHaveBeenCalledTimes(2);
  });

  it('aborts on disposal and ignores JSON that resolves after unmount', async () => {
    const body = deferred<unknown>();
    client.fetch.mockResolvedValueOnce({ ok: true, json: () => body.promise });
    commit(); await settle();
    const signal = client.fetch.mock.calls[0][1].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    const writes = hooks.writes;
    body.resolve(open); await settle(); vi.advanceTimersByTime(60_000);
    expect(hooks.writes).toBe(writes);
    expect(client.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('preserves allowed registration submission, bootstrap proof and login destination (first user: %s)', async firstUser => {
    client.fetch.mockResolvedValueOnce(response(firstUser ? { isFirstUser: true, allowRegistration: true, bootstrapRequired: true, bootstrapConsumed: false } : open));
    commit(); await settle();
    const change = (id: string, value: string) => {
      const field = nodes(commit()).find(node => node.props.id === id)!;
      (field.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
    };
    change('name', 'Synthetic Person'); change('email', 'synthetic@example.invalid');
    change('password', 'SyntheticPassword42!'); change('confirmPassword', 'SyntheticPassword42!');
    if (firstUser) change('setupToken', 'synthetic-proof');
    client.fetch.mockResolvedValueOnce(response({ message: 'Registrierung erfolgreich' }));
    const form = nodes(commit()).find(node => node.type === 'form')!;
    await (form.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>)({ preventDefault: vi.fn() });
    expect(client.fetch).toHaveBeenLastCalledWith('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Synthetic Person', email: 'synthetic@example.invalid', password: 'SyntheticPassword42!', ...(firstUser ? { setupToken: 'synthetic-proof' } : {}) }),
    });
    expect(client.push).toHaveBeenCalledWith('/login?registered=true');
  });
});
