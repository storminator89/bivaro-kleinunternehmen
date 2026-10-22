import { describe, expect, it, vi } from 'vitest';
import { nextReviewDocument, reviewQueueSnapshot, sameReviewDraft, type IncomingNavigationGuard } from '@/components/purchases/incoming-review-queue';
import { consumeReviewTraversalQuery, createReviewTraversalGuard } from '@/components/purchases/incoming-review-history';
import { IncomingRequestError } from '@/components/purchases/incoming-document-ui';
import type { IncomingDocument, IncomingDocumentList } from '@/lib/purchase-documents/types';

const doc = (id: number, reviewState: IncomingDocument['reviewState'] = 'REVIEW', linkedExpenseId: number | null = null) => ({ id, reviewState, linkedExpenseId }) as IncomingDocument;
const signal = () => new AbortController().signal;

describe('bounded incoming review snapshot', () => {
  it('preserves server order and removes processed/linked/duplicate rows', () => {
    const list = { documents: [doc(9), doc(8, 'BOOKED', 3), doc(7, 'DISMISSED'), doc(6, 'REVIEW', 4), doc(5), doc(9)], total: 6, page: 2, limit: 25 };
    expect(reviewQueueSnapshot(list)).toEqual([9, 5]);
  });
  it('caps a snapshot at the 25-row list boundary', () => {
    expect(reviewQueueSnapshot({ documents: Array.from({ length: 80 }, (_, i) => doc(i + 1)) } as IncomingDocumentList)).toHaveLength(25);
  });
  it('does not mutate its server list or admit later arrivals', () => {
    const list = { documents: [doc(9), doc(8)] } as IncomingDocumentList;
    const queue = reviewQueueSnapshot(list); list.documents.unshift(doc(10));
    expect(queue).toEqual([9, 8]); expect(list.documents.map(d => d.id)).toEqual([10, 9, 8]);
  });
  it.each([-1, 1] as const)('does not fetch for a current ID outside its snapshot (%s)', async direction => {
    const read = vi.fn(); expect(await nextReviewDocument([3, 2, 1], 4, direction, read, signal())).toBeNull(); expect(read).not.toHaveBeenCalled();
  });
  it('walks forward in original order with fresh reads and skips processed/linked/deleted rows', async () => {
    const read = vi.fn(async id => { if (id === 3) throw new IncomingRequestError('missing', 404); return id === 5 ? doc(id, 'BOOKED', 1) : id === 4 ? doc(id, 'DISMISSED') : id === 2 ? doc(id, 'REVIEW', 8) : doc(id); });
    expect(await nextReviewDocument([6, 5, 4, 3, 2, 1], 6, 1, read, signal())).toBe(1);
    expect(read.mock.calls.map(call => call[0])).toEqual([5, 4, 3, 2, 1]);
  });
  it('walks backwards and refreshes even a previously visited ID', async () => {
    const read = vi.fn(async id => id === 2 ? doc(id, 'BOOKED', 7) : doc(id));
    expect(await nextReviewDocument([3, 2, 1], 1, -1, read, signal())).toBe(3);
    expect(read.mock.calls.map(call => call[0])).toEqual([2, 3]);
  });
  it.each([401, 403, 409, 429, 500])('does not skip unknown failure %s or issue another read', async status => {
    const error = new IncomingRequestError('failure', status); const read = vi.fn().mockRejectedValue(error);
    await expect(nextReviewDocument([3, 2, 1], 3, 1, read, signal())).rejects.toBe(error); expect(read).toHaveBeenCalledTimes(1);
  });
  it('stops on a network failure; a retry restarts at the same candidate', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(doc(2));
    await expect(nextReviewDocument([3, 2, 1], 3, 1, read, signal())).rejects.toThrow('network');
    expect(await nextReviewDocument([3, 2, 1], 3, 1, read, signal())).toBe(2);
    expect(read.mock.calls).toEqual([[2], [2]]);
  });
  it('ends clearly without wrapping or reading newly appended IDs', async () => {
    const read = vi.fn(async id => doc(id, 'DISMISSED'));
    expect(await nextReviewDocument([3, 2, 1], 3, 1, read, signal())).toBeNull(); expect(read).toHaveBeenCalledTimes(2);
    expect(await nextReviewDocument([3, 2, 1], 1, 1, read, signal())).toBeNull(); expect(read).toHaveBeenCalledTimes(2);
  });
  it('bounds even an invalid oversized caller queue to 25 reads', async () => {
    const read = vi.fn(async id => doc(id, 'DISMISSED'));
    expect(await nextReviewDocument(Array.from({ length: 500 }, (_, i) => i + 1), 1, 1, read, signal())).toBeNull(); expect(read).toHaveBeenCalledTimes(24);
  });
  it('rejects an aborted request before issuing a read', async () => {
    const controller = new AbortController(); controller.abort(); const read = vi.fn();
    await expect(nextReviewDocument([2, 1], 2, 1, read, controller.signal)).rejects.toThrow(); expect(read).not.toHaveBeenCalled();
  });
  it('ignores a late response after tenant/session/navigation abort', async () => {
    const controller = new AbortController(); const read = vi.fn(async id => { controller.abort(); return doc(id); });
    await expect(nextReviewDocument([3, 2, 1], 3, 1, read, controller.signal)).rejects.toThrow(); expect(read).toHaveBeenCalledTimes(1);
  });
  it('never opens a different ID returned by a stale or malformed response', async () => {
    expect(await nextReviewDocument([3, 2], 3, 1, async () => doc(99), signal())).toBeNull();
  });
  it('compares normalized draft fields independently of JSON property order', () => {
    const draft = { supplierName: 'A', invoiceNumber: 'B', invoiceDate: '', paymentDate: '', amount: '0.29', note: '' };
    expect(sameReviewDraft({ note: '', amount: '0.29', paymentDate: '', invoiceDate: '', invoiceNumber: 'B', supplierName: 'A' }, draft)).toBe(true);
    expect(sameReviewDraft({ ...draft, amount: '0.30' }, draft)).toBe(false); expect(sameReviewDraft(null, draft)).toBe(false);
  });
});

function historyFixture(initial = 4) {
  let index: number | undefined = initial; let guard: IncomingNavigationGuard | null;
  const go = vi.fn(); const onReplay = vi.fn(); const onUnprotectedTraversal = vi.fn(); const requests: Array<{ proceed: () => void; stay: () => void }> = [];
  guard = { blocked: true, request: (proceed, stay) => requests.push({ proceed, stay }) };
  const handle = createReviewTraversalGuard({ getIndex: () => index, go, onReplay, getGuard: () => guard, onUnprotectedTraversal });
  return { go, onReplay, onUnprotectedTraversal, requests, setGuard: (next: IncomingNavigationGuard | null) => { guard = next; }, pop: (next: number | undefined) => { index = next; const event = { stopImmediatePropagation: vi.fn() }; handle(event); return event; } };
}
describe('non-destructive dirty review Back/Forward guard', () => {
  it('restores Back without rewriting an entry; stay leaves both destinations intact', () => {
    const f = historyFixture(); expect(f.pop(3).stopImmediatePropagation).toHaveBeenCalled(); expect(f.go).toHaveBeenLastCalledWith(1); expect(f.requests).toHaveLength(0);
    expect(f.pop(4).stopImmediatePropagation).toHaveBeenCalled(); expect(f.requests).toHaveLength(1);
    f.requests[0].stay(); expect(f.go).toHaveBeenCalledTimes(1); expect(f.onReplay).not.toHaveBeenCalled();
    f.pop(3); expect(f.go).toHaveBeenLastCalledWith(1); f.pop(4); expect(f.requests).toHaveLength(2);
  });
  it('discards/saves once, replays the exact multi-step Back, then permits router handling', () => {
    const f = historyFixture(8); f.pop(3); expect(f.go).toHaveBeenLastCalledWith(5); f.pop(8); f.requests[0].proceed();
    expect(f.go).toHaveBeenLastCalledWith(-5); expect(f.onReplay).not.toHaveBeenCalled();
    expect(f.pop(3).stopImmediatePropagation).not.toHaveBeenCalled(); expect(f.onReplay).toHaveBeenCalledTimes(1);
  });
  it('consumes an explicit replay choice once, including repeated/late clicks', () => {
    const f = historyFixture(); f.pop(3); f.pop(4);
    f.requests[0].proceed(); f.requests[0].proceed();
    expect(f.onReplay).not.toHaveBeenCalled(); f.pop(3); expect(f.onReplay).toHaveBeenCalledTimes(1); expect(f.go.mock.calls).toEqual([[1], [-1]]);
    const stayed = historyFixture(); stayed.pop(3); stayed.pop(4); stayed.requests[0].stay(); stayed.requests[0].proceed();
    expect(stayed.onReplay).not.toHaveBeenCalled(); expect(stayed.go.mock.calls).toEqual([[1]]);
  });
  it('restores and replays Forward in the opposite direction', () => {
    const f = historyFixture(2); f.pop(5); expect(f.go).toHaveBeenLastCalledWith(-3); f.pop(2); f.requests[0].proceed();
    expect(f.go).toHaveBeenLastCalledWith(3); expect(f.pop(5).stopImmediatePropagation).not.toHaveBeenCalled();
  });
  it('handles another traversal during restoration without replacing entries or accepting a stale route', () => {
    const f = historyFixture(8); f.pop(6); f.pop(3); expect(f.go.mock.calls).toEqual([[2], [5]]); expect(f.requests).toHaveLength(0);
    f.pop(8); expect(f.requests).toHaveLength(1); f.requests[0].proceed(); expect(f.go).toHaveBeenLastCalledWith(-2);
  });
  it('leaves clean history untouched and tracks the newly visited index', () => {
    const f = historyFixture(); f.setGuard({ blocked: false, request: vi.fn() }); expect(f.pop(3).stopImmediatePropagation).not.toHaveBeenCalled(); expect(f.go).not.toHaveBeenCalled();
    f.setGuard({ blocked: true, request: vi.fn() }); f.pop(2); expect(f.go).toHaveBeenLastCalledWith(1);
  });
  it('does not invent an index or rewrite history if browser capability is missing', () => {
    const f = historyFixture(); expect(f.pop(undefined).stopImmediatePropagation).not.toHaveBeenCalled(); expect(f.go).not.toHaveBeenCalled(); expect(f.requests).toHaveLength(0); expect(f.onUnprotectedTraversal).toHaveBeenCalledTimes(1);
  });
  it('accepts only the unsupported-browser traversed query, without routing it through a stay rewrite', () => {
    const allowed = { current: null as string | null };
    const request = vi.fn(); const go = vi.fn();
    let index: number | undefined;
    const pop = createReviewTraversalGuard({ getIndex: () => index, go, getGuard: () => ({ blocked: true, request }), onReplay: vi.fn(), onUnprotectedTraversal: () => { allowed.current = 'document=A'; } });
    const event = { stopImmediatePropagation: vi.fn() }; pop(event);
    expect(consumeReviewTraversalQuery(allowed, 'document=A')).toBe(true);
    expect(request).not.toHaveBeenCalled(); expect(go).not.toHaveBeenCalled(); expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(consumeReviewTraversalQuery(allowed, 'document=A')).toBe(false);
    allowed.current = 'document=A';
    expect(consumeReviewTraversalQuery(allowed, 'document=B')).toBe(false); // later explicit close/navigation cannot borrow a stale pop allowance
    expect(allowed.current).toBeNull();
  });
  it('does not revive a cleared tenant/session guard during restoration', () => {
    const f = historyFixture(); f.pop(3); f.setGuard(null); f.pop(4); expect(f.requests).toHaveLength(0); expect(f.onReplay).not.toHaveBeenCalled();
  });
});
