import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { DailyAction, DailyActions } from '@/lib/daily-actions/contract';

// Exercise the component's own effects and handlers without a local browser.
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as (() => void)[], dirty: true }));
type EffectSlot = { dependencies: unknown[]; cleanup?: () => void };
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: unknown) => {
      const next = typeof value === 'function' ? value(hooks.slots[index]) : value;
      if (!Object.is(next, hooks.slots[index])) { hooks.slots[index] = next; hooks.dirty = true; }
    }];
  },
  useEffect(effect: () => (() => void) | void, dependencies: unknown[]) {
    const index = hooks.cursor++, previous = hooks.slots[index] as EffectSlot | undefined;
    if (!previous || previous.dependencies.length !== dependencies.length || dependencies.some((value, position) => !Object.is(value, previous.dependencies[position]))) {
      const slot: EffectSlot = { dependencies }; hooks.slots[index] = slot;
      hooks.effects.push(() => { previous?.cleanup?.(); slot.cleanup = effect() || undefined; });
    }
  },
}));
const session = vi.hoisted(() => ({ user: { id: 'synthetic-daily-owner' } }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: session }) }));
import { ActionRow, DailyActionsPanel } from '@/components/daily-actions/daily-actions-workspace';
import { PAYMENT_DASHBOARD_REFRESH_EVENT } from '@/lib/payment-dashboard-refresh';

type Node = ReactElement<Record<string, unknown>>;
let tree: ReactNode, compact: boolean, events: EventTarget;
let fetch: ReturnType<typeof vi.fn>;
const action: DailyAction = { id: 'invoice:1', kind: 'INVOICE_OVERDUE', priority: 1, title: 'Überfällige Rechnung prüfen', source: 'SYNTHETIC-DAILY-PARTIAL', reason: 'Synthetic exact remainder', party: null, date: '2000-01-01', dateLabel: 'Fällig am', amountCents: '8000', amountLabel: 'Noch offen laut Journal', href: '/dashboard?tab=invoices&document=1', cta: 'Rechnung prüfen' };
const snapshot: DailyActions = { businessDate: '2026-10-22', timeZone: 'Europe/Berlin', generatedAt: '2026-10-22T10:00:00.000Z', actionCount: 4, isPartial: false, actions: [action, ...[2, 3, 4].map(id => ({ ...action, id: `invoice:${id}`, source: `SYNTHETIC-${id}`, href: `/dashboard?tab=invoices&document=${id}` }))] };
const json = (value: unknown = snapshot, status = 200) => new Response(JSON.stringify(value), { status });
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children as ReactNode)];
}
function shown() { return nodes(tree).filter(node => node.type === ActionRow).map(node => (node.props.action as DailyAction).id); }
function control(property: string) {
  const control = nodes(tree).find(node => typeof node.props[property] === 'function');
  expect(control).toBeDefined(); return control!.props[property] as () => void;
}
async function flush() {
  for (let iteration = 0; iteration < 20; iteration++) {
    if (hooks.dirty) {
      hooks.dirty = false; hooks.cursor = 0;
      const panel = DailyActionsPanel({ compact }) as ReactElement<{ compact: boolean }>;
      tree = (panel.type as (props: { compact: boolean }) => ReactNode)(panel.props);
      hooks.effects.splice(0).forEach(effect => effect());
    }
    await new Promise(resolve => setImmediate(resolve));
    if (!hooks.dirty && !hooks.effects.length) return;
  }
  throw new Error('Daily action lifecycle did not settle');
}
function unmount() { for (const slot of hooks.slots) (slot as EffectSlot | undefined)?.cleanup?.(); }
beforeEach(() => {
  hooks.cursor = 0; hooks.slots = []; hooks.effects = []; hooks.dirty = true; compact = true;
  events = new EventTarget();
  vi.stubGlobal('window', { addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), setInterval: vi.fn(() => 1), clearInterval: vi.fn() });
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) });
  fetch = vi.fn().mockImplementation(async () => json()); vi.stubGlobal('fetch', fetch);
});
afterEach(() => { unmount(); vi.unstubAllGlobals(); });

describe('daily preview and full-list lifecycle', () => {
  it('shows exactly three in the preview, but all four in the full view even when component state is retained', async () => {
    await flush();
    expect(shown()).toEqual(['invoice:1', 'invoice:2', 'invoice:3']);
    const all = nodes(tree).find(node => node.props.href === '/dashboard/today');
    expect(all).toBeDefined();
    compact = false; hooks.dirty = true; await flush();
    expect(shown()).toEqual(['invoice:1', 'invoice:2', 'invoice:3', 'invoice:4']);
    expect(nodes(tree).find(node => node.props['aria-labelledby'] === 'daily-actions-title')).toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('aborts an older read on refresh and ignores its late result after the newer full snapshot', async () => {
    let resolveOld!: (response: Response) => void;
    fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve; }));
    await flush();
    const oldSignal = fetch.mock.calls[0][1].signal as AbortSignal;
    events.dispatchEvent(new Event(PAYMENT_DASHBOARD_REFRESH_EVENT)); await flush();
    expect(oldSignal.aborted).toBe(true); expect(shown()).toHaveLength(3);
    resolveOld(json({ ...snapshot, actionCount: 1, actions: [action] })); await flush();
    compact = false; hooks.dirty = true; await flush();
    expect(shown()).toHaveLength(4); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('clears a stale full list on read failure and restores the four rows on explicit retry', async () => {
    compact = false; await flush(); expect(shown()).toHaveLength(4);
    fetch.mockResolvedValueOnce(json({ error: 'Synthetic read interruption' }, 503));
    control('onClick')(); await flush();
    expect(shown()).toHaveLength(0);
    control('onRetry')(); await flush();
    expect(shown()).toHaveLength(4);
    expect(fetch.mock.calls.every(([, options]) => options.cache === 'no-store' && !options.method && !options.body)).toBe(true);
  });
  it('removes refresh listeners and ignores a pending response after unmount', async () => {
    let resolve!: (response: Response) => void;
    fetch.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    await flush(); const signal = fetch.mock.calls[0][1].signal as AbortSignal;
    unmount(); hooks.dirty = false;
    events.dispatchEvent(new Event('focus')); events.dispatchEvent(new Event(PAYMENT_DASHBOARD_REFRESH_EVENT));
    resolve(json()); await new Promise(done => setImmediate(done));
    expect(signal.aborted).toBe(true); expect(hooks.dirty).toBe(false); expect(fetch).toHaveBeenCalledTimes(1);
  });
});
