import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { IncomingDocument, IncomingDocumentList, IncomingDocumentResponse } from '@/lib/purchase-documents/types';
import type { IncomingNavigationGuard, IncomingReviewSequence } from '@/components/purchases/incoming-review-queue';

// Keep render/commit separate: two native clicks can run before React commits
// the first click's disabled state. Exercise the actual workspace callbacks.
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], layout: [] as (() => void)[], effects: [] as (() => void)[] }));
type EffectSlot = { dependencies: unknown[]; cleanup?: () => void };
function effect(queue: (() => void)[], callback: () => (() => void) | void, dependencies: unknown[]) {
  const index = hooks.cursor++, previous = hooks.slots[index] as EffectSlot | undefined;
  if (!previous || dependencies.some((value, position) => !Object.is(value, previous.dependencies[position]))) {
    const slot: EffectSlot = { dependencies }; hooks.slots[index] = slot;
    queue.push(() => { previous?.cleanup?.(); slot.cleanup = callback() || undefined; });
  }
}
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
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
  useEffect: (callback: () => (() => void) | void, dependencies: unknown[]) => effect(hooks.effects, callback, dependencies),
  useLayoutEffect: (callback: () => (() => void) | void, dependencies: unknown[]) => effect(hooks.layout, callback, dependencies),
}));
const client = vi.hoisted(() => ({ json: vi.fn(), replace: vi.fn(), params: new URLSearchParams('document=3') }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: client.replace }), usePathname: () => '/purchases', useSearchParams: () => client.params }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { user: { id: 'synthetic-user', role: 'USER', sessionVersion: 1 } } }) }));
vi.mock('@/components/purchases/incoming-document-ui', async importOriginal => ({ ...await importOriginal<typeof import('@/components/purchases/incoming-document-ui')>(), incomingJson: client.json }));
vi.mock('@/components/purchases/incoming-document-review', () => ({ IncomingDocumentReview: () => null }));
vi.mock('@/components/purchases/incoming-upload', () => ({ IncomingUpload: () => null }));
import { IncomingDocumentsWorkspace } from '@/components/purchases/incoming-documents-workspace';
import { IncomingDocumentReview } from '@/components/purchases/incoming-document-review';
import { IncomingRequestError } from '@/components/purchases/incoming-document-ui';
import { reviewNavigationDispatcher } from '@/components/purchases/incoming-review-history';

type Node = ReactElement<Record<string, unknown>>;
type ReviewProps = { id: number; sequence: IncomingReviewSequence; registerNavigationGuard: (guard: IncomingNavigationGuard | null) => void };
const documents = [3, 2, 1].map(id => ({ id, reviewState: 'REVIEW', linkedExpenseId: null })) as IncomingDocument[];
const list: IncomingDocumentList = { documents, total: 3, page: 1, limit: 25 };
let tree: ReactNode, location: URL;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children as ReactNode)];
}
function commit() {
  hooks.cursor = 0;
  const wrapper = IncomingDocumentsWorkspace() as ReactElement;
  tree = (wrapper.type as () => ReactNode)();
  hooks.layout.splice(0).forEach(callback => callback());
  hooks.effects.splice(0).forEach(callback => callback());
}
function review() {
  const node = nodes(tree).find(node => node.type === IncomingDocumentReview);
  expect(node).toBeDefined();
  return node!.props as unknown as ReviewProps;
}
function unmount() { for (const slot of hooks.slots) (slot as EffectSlot | null | undefined)?.cleanup?.(); }
async function settleRequests() { await new Promise(resolve => setImmediate(resolve)); }
function holdCandidate() {
  let release!: (value: IncomingDocumentResponse) => void;
  const pending = new Promise<IncomingDocumentResponse>(resolve => { release = resolve; });
  client.json.mockImplementation((url: string) => url.includes('?') ? Promise.resolve(list) : pending);
  return () => release({ document: documents[1] });
}
function candidateReads() { return client.json.mock.calls.filter(([url]) => url === '/api/purchase-documents/2'); }
beforeEach(async () => {
  hooks.cursor = 0; hooks.slots = []; hooks.layout = []; hooks.effects = [];
  client.params = new URLSearchParams('document=3'); location = new URL('https://bivaro.example/purchases?document=3');
  vi.stubGlobal('window', { get location() { return location; }, history: { go: vi.fn() } });
  client.replace.mockReset();
  client.json.mockReset().mockResolvedValue(list);
  commit(); await settleRequests(); commit(); commit();
  expect(review().sequence.count).toBe(3);
});
afterEach(() => { unmount(); vi.unstubAllGlobals(); });

describe('workspace queue request lifecycle', () => {
  it('keeps one held next-document request current across two clicks before disabled state commits', async () => {
    const release = holdCandidate(), move = review().sequence.move;
    move(1); move(1);
    expect(candidateReads()).toHaveLength(1);
    commit(); expect(review().sequence.busy).toBe(true);
    release(); await settleRequests();
    expect(client.replace.mock.calls).toEqual([['/purchases?document=2', { scroll: false }]]);
    commit(); expect(review().sequence.busy).toBe(false);
  });
  it('retries the same failed candidate and ignores repeated clicks without invalidating that retry', async () => {
    client.json.mockRejectedValueOnce(new IncomingRequestError('Synthetischer Ausfall', 503));
    review().sequence.move(1); await settleRequests(); commit();
    expect(client.replace).not.toHaveBeenCalled();
    expect(review().sequence.message).toContain('Navigation erneut versuchen');
    const release = holdCandidate(), move = review().sequence.move;
    move(1); move(1);
    expect(candidateReads()).toHaveLength(2);
    release(); await settleRequests();
    expect(client.replace.mock.calls).toEqual([['/purchases?document=2', { scroll: false }]]);
  });
  it('still invalidates a held queue result for a distinct global intent even when its busy preflight stays', async () => {
    const release = holdCandidate(); review().sequence.move(1);
    const stay = vi.fn((_: () => void, cancel: () => void) => cancel()), navigate = vi.fn();
    review().registerNavigationGuard({ blocked: true, request: stay });
    reviewNavigationDispatcher.request(navigate, () => true);
    expect(stay).toHaveBeenCalledTimes(1);
    release(); await settleRequests(); commit();
    expect(client.replace).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
    expect(review().sequence.busy).toBe(false);
    review().registerNavigationGuard(null);
    review().sequence.move(1); await settleRequests();
    expect(client.replace).toHaveBeenCalledTimes(1);
  });
  it('rejects a late queue result after the actual source URL changes before router snapshots commit', async () => {
    const release = holdCandidate(); review().sequence.move(1);
    location = new URL('https://bivaro.example/customers');
    release(); await settleRequests();
    expect(client.replace).not.toHaveBeenCalled();
  });
  it('aborts the in-flight read when the accepted receipt query changes', async () => {
    const release = holdCandidate(); review().sequence.move(1);
    const signal = candidateReads()[0][1].signal as AbortSignal;
    client.params = new URLSearchParams('document=1'); location = new URL('https://bivaro.example/purchases?document=1');
    commit(); commit(); expect(signal.aborted).toBe(true); expect(review().id).toBe(1);
    release(); await settleRequests();
    expect(client.replace).not.toHaveBeenCalled();
  });
  it('aborts on workspace disposal and ignores a transport that nevertheless resolves late', async () => {
    const release = holdCandidate(); review().sequence.move(1);
    const signal = candidateReads()[0][1].signal as AbortSignal;
    unmount(); expect(signal.aborted).toBe(true);
    release(); await settleRequests();
    expect(client.replace).not.toHaveBeenCalled();
  });
});
