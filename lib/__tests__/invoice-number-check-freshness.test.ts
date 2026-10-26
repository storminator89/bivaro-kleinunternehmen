import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';

// Deterministic component/effect contracts, not browser or backend acceptance.
// Reads are promises controlled by each case; no server, database or real fetch.
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as (() => void)[], dirty: false }));
type EffectSlot = { dependencies: unknown[]; cleanup?: () => void };
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
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
    const index = hooks.cursor++, previous = hooks.slots[index] as { dependencies: unknown[]; callback: unknown } | undefined;
    if (!previous || dependencies.some((value, position) => !Object.is(value, previous.dependencies[position]))) hooks.slots[index] = { dependencies, callback };
    return (hooks.slots[index] as { callback: unknown }).callback;
  },
  useEffect(callback: () => (() => void) | void, dependencies: unknown[]) {
    const index = hooks.cursor++, previous = hooks.slots[index] as EffectSlot | undefined;
    if (!previous || dependencies.some((value, position) => !Object.is(value, previous.dependencies[position]))) {
      const slot: EffectSlot = { dependencies }; hooks.slots[index] = slot;
      hooks.effects.push(() => { previous?.cleanup?.(); slot.cleanup = callback() || undefined; });
    }
  },
}));
// Other eligibility rules are not under test. Keep all other actual editor
// conditions satisfied so the real create button exposes the number barrier.
vi.mock('@/lib/document-tax-profile', async original => ({
  ...await original<typeof import('@/lib/document-tax-profile')>(),
  resolveDocumentTaxState: () => ({ ready: true, mode: 'small-business', source: 'template' }),
}));
import { CreateInvoiceModal } from '@/components/dashboard/create-invoice-modal';

type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(value)) return [];
  return [value, ...nodes(value.props.children as ReactNode)];
}
function text(value: ReactNode): string {
  if (Array.isArray(value)) return value.map(text).join('');
  if (isValidElement<Record<string, unknown>>(value)) return text(value.props.children as ReactNode);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
type PendingRead = ReturnType<typeof deferred<Response>> & { number: string; signal?: AbortSignal | null };
let tree: ReactNode, isOpen: boolean, nextNumber: string, reads: PendingRead[];
let fetchMock: ReturnType<typeof vi.fn>, consoleError: ReturnType<typeof vi.spyOn>;
const close = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function render(commitEffects = true) {
  for (let iteration = 0; iteration < 20; iteration++) {
    hooks.cursor = 0; hooks.dirty = false;
    tree = CreateInvoiceModal({ isOpen, onClose: close, presentation: 'page' });
    if (!commitEffects) return;
    hooks.effects.splice(0).forEach(effect => effect());
    if (!hooks.dirty) return;
  }
  throw new Error('Invoice number harness did not settle');
}
async function settle() { await new Promise<void>(resolve => setImmediate(resolve)); render(); }
function field(id: string) {
  const found = nodes(tree).find(node => node.props.id === id);
  expect(found, `field ${id}`).toBeDefined(); return found!;
}
function change(id: string, value: string, commitEffects = true) {
  (field(id).props.onChange as (event: unknown) => void)({ target: { value } });
  render(commitEffects);
}
function button(label: string) {
  const found = nodes(tree).find(node => typeof node.props.onClick === 'function' && text(node) === label);
  expect(found, `button ${label}`).toBeDefined(); return found!;
}
function expectNumber(number: string, blocked: boolean, duplicate = false) {
  expect(field('invoice-number').props.value).toBe(number);
  expect(field('invoice-number').props['aria-invalid']).toBe(duplicate);
  expect(button('PDF erstellen').props.disabled).toBe(blocked);
}
function unmount() { for (const slot of hooks.slots) (slot as EffectSlot | undefined)?.cleanup?.(); }
function start(number: string) { change('invoice-number', number); vi.advanceTimersByTime(500); return reads.at(-1)!; }

beforeEach(async () => {
  hooks.cursor = 0; hooks.slots = []; hooks.effects = []; hooks.dirty = false;
  isOpen = true; nextNumber = ''; reads = []; close.mockClear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  fetchMock = vi.fn((input: string, options?: RequestInit) => {
    if (options?.method && options.method !== 'GET') throw new Error('Unexpected non-read request');
    if (input.startsWith('/api/invoices/check-number?')) {
      const pending = { ...deferred<Response>(), number: new URL(input, 'https://synthetic.invalid').searchParams.get('number')!, signal: options?.signal };
      reads.push(pending); return pending.promise;
    }
    if (input.startsWith('/api/invoices/next-number')) return Promise.resolve(json({ nextInvoiceNumber: nextNumber, numberingSelection: { number: nextNumber } }));
    if (input === '/api/settings') return Promise.resolve(json({}));
    if (input === '/api/customers' || input === '/api/invoice-templates') return Promise.resolve(json([]));
    throw new Error(`Unexpected read: ${input}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(); await settle(); change('customer', 'Synthetic recipient');
});
afterEach(() => { unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); consoleError.mockRestore(); });

describe('invoice number response ownership', () => {
  it('blocks immediately before the new passive effect commits and preserves the 500ms raw-number debounce', async () => {
    const a = start('A'); a.resolve(json({ exists: false })); await settle(); expectNumber('A', false);
    change('invoice-number', '  B & C  ', false); expectNumber('  B & C  ', true);
    hooks.effects.splice(0).forEach(effect => effect()); render();
    vi.advanceTimersByTime(499); expect(reads).toHaveLength(1);
    vi.advanceTimersByTime(1); expect(reads).toHaveLength(2);
    expect(reads[1].number).toBe('  B & C  ');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/invoices/check-number?number=%20%20B%20%26%20C%20%20', { signal: expect.any(AbortSignal) });
  });

  it('ignores late A duplicate success after newer B is available, even if fetch ignores abort', async () => {
    const a = start('A'), b = start('B'); expect(a.signal?.aborted).toBe(true);
    b.resolve(json({ exists: false })); await settle(); expectNumber('B', false);
    a.resolve(json({ exists: true })); await settle(); expectNumber('B', false);
  });

  it.each(['success', 'failure', 'http-error'])('does not let stale A %s/finally release B while B is checking', async outcome => {
    const a = start('A'); change('invoice-number', 'B');
    if (outcome === 'failure') a.reject(new Error('obsolete request'));
    else a.resolve(json({ exists: false }, outcome === 'http-error' ? 503 : 200));
    await settle(); expectNumber('B', true); expect(consoleError).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500); const b = reads[1]; b.resolve(json({ exists: true }));
    await settle(); expectNumber('B', true, true);
  });

  it('invalidates A synchronously on input before cleanup or the B effect executes', async () => {
    const a = start('A'); change('invoice-number', 'B', false);
    a.resolve(json({ exists: true })); await new Promise<void>(resolve => setImmediate(resolve));
    render(false); expectNumber('B', true);
    hooks.effects.splice(0).forEach(effect => effect()); render();
  });

  it('guards a response whose JSON resolves after the input changes', async () => {
    const a = start('A'), body = deferred<{ exists: boolean }>();
    a.resolve({ ok: true, json: () => body.promise } as Response); await settle();
    const b = start('B'); b.resolve(json({ exists: false })); await settle();
    body.resolve({ exists: true }); await settle(); expectNumber('B', false);
  });

  it('keeps empty input blocked and cancels a pending debounce without a check', async () => {
    change('invoice-number', 'A'); vi.advanceTimersByTime(499);
    change('invoice-number', ''); vi.advanceTimersByTime(500); await settle();
    expect(reads).toHaveLength(0); expectNumber('', true);
  });

  it('cannot resurrect a duplicate after clear, close/reopen, or unmount', async () => {
    const a = start('A'); change('invoice-number', ''); a.resolve(json({ exists: true }));
    await settle(); expectNumber('', true);
    const b = start('B'); isOpen = false; render(); expect(b.signal?.aborted).toBe(true);
    isOpen = true; render(); await settle(); change('customer', 'Synthetic recipient');
    b.resolve(json({ exists: true })); await settle(); expectNumber('', true);
    const c = start('C'); unmount(); expect(c.signal?.aborted).toBe(true);
    hooks.dirty = false; c.resolve(json({ exists: true })); await new Promise<void>(resolve => setImmediate(resolve));
    expect(hooks.dirty).toBe(false);
  });

  it('checks the refreshed number independently of the next-number request generation', async () => {
    const a = start('A'); nextNumber = 'REFRESHED';
    await (button('Nummer aktualisieren').props.onClick as () => unknown)(); await settle();
    expectNumber('REFRESHED', true); vi.advanceTimersByTime(500);
    const refreshed = reads[1]; expect(refreshed.number).toBe('REFRESHED');
    refreshed.resolve(json({ exists: false })); await settle();
    a.resolve(json({ exists: true })); await settle(); expectNumber('REFRESHED', false);
  });

  it.each(['fetch', 'json'])('keeps current %s rejection advisory and releases only its own checking barrier', async phase => {
    const a = start('A'), error = new Error('Current read failed');
    if (phase === 'fetch') a.reject(error);
    else a.resolve({ ok: true, json: () => Promise.reject(error) } as Response);
    await settle(); expectNumber('A', false);
    expect(consoleError).toHaveBeenCalledExactlyOnceWith('Error checking invoice number:', error);
  });

  it('keeps current-check HTTP errors advisory and clears obsolete number errors without claiming backend uniqueness', async () => {
    const a = start('A'); a.resolve(json({ exists: true })); await settle(); expectNumber('A', true, true);
    const b = start('B'); b.resolve(json({ error: 'Unavailable' }, 503)); await settle(); expectNumber('B', false);
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
  });
});
