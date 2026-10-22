import { describe, expect, it, vi } from 'vitest';
import { bindReviewGuardIntents, createReviewNavigationDispatcher, createReviewNavigationIntents, createReviewTraversalGuard, reviewSessionKey } from '@/components/purchases/incoming-review-history';

// Definitions only in this recovery worktree; execution awaits explicit authorization.
function fixture() {
  let location = '/purchases?document=10';
  let live = true;
  const dispatcher = createReviewNavigationDispatcher();
  const intents = createReviewNavigationIntents(() => location, () => live);
  const choices: Array<ReturnType<typeof intents.prepare>> = [];
  const cleanup = dispatcher.register(action => choices.push(intents.prepare(action)));
  return { dispatcher, intents, choices, cleanup, move: (next: string) => { location = next; }, unmount: () => { live = false; cleanup(); intents.invalidate(); } };
}

describe('opt-in receipt navigation dispatcher', () => {
  it('uses the existing choice before navigation, supports stay, and proceeds once', () => {
    const f = fixture(); const action = vi.fn();
    f.dispatcher.request(action, () => true); expect(action).not.toHaveBeenCalled();
    f.choices[0].stay(); f.choices[0].proceed(); expect(action).not.toHaveBeenCalled();
    f.dispatcher.request(action, () => true); f.choices[1].proceed(); f.choices[1].proceed();
    expect(action).toHaveBeenCalledTimes(1);
  });
  it('supersedes a palette intent with a newer review-local intent and vice versa', () => {
    const f = fixture(); const palette = vi.fn(); const local = vi.fn();
    f.dispatcher.request(palette, () => true); const newerLocal = f.intents.prepare(local);
    f.choices[0].proceed(); expect(palette).not.toHaveBeenCalled();
    f.dispatcher.request(palette, () => true); newerLocal.proceed(); expect(local).not.toHaveBeenCalled();
    f.choices[1].proceed(); expect(palette).toHaveBeenCalledTimes(1);
  });
  it('drops source-URL changes and all pending callbacks after owner cleanup', () => {
    const f = fixture(); const action = vi.fn();
    f.dispatcher.request(action, () => true); f.move('/customers'); f.choices[0].proceed();
    expect(action).not.toHaveBeenCalled();
    f.move('/purchases?document=10'); f.dispatcher.request(action, () => true);
    f.unmount(); f.choices[1].proceed(); expect(action).not.toHaveBeenCalled();
    expect(f.dispatcher.hasOwner()).toBe(false);
  });
  it('does not let an old owner action or cleanup affect its replacement', () => {
    const f = fixture(); const oldAction = vi.fn(); const currentAction = vi.fn(); let proceed!: () => void;
    f.dispatcher.request(oldAction, () => true);
    const unregister = f.dispatcher.register(action => { proceed = action; });
    f.cleanup(); f.choices[0].proceed(); expect(oldAction).not.toHaveBeenCalled();
    f.dispatcher.request(currentAction, () => true); proceed(); proceed();
    expect(currentAction).toHaveBeenCalledTimes(1); unregister(); expect(f.dispatcher.hasOwner()).toBe(false);
  });
  it.each(['id', 'role', 'sessionVersion', 'status'] as const)('rejects a changed full-session %s even at the same URL', field => {
    const user = { id: 'owner', role: 'USER', sessionVersion: 1 }; let status = 'authenticated';
    const readSession = () => reviewSessionKey({ user }, status);
    const source = readSession(); const f = fixture(); const action = vi.fn();
    f.dispatcher.request(action, () => readSession() === source);
    if (field === 'id') user.id = 'replacement';
    else if (field === 'role') user.role = 'ADMIN';
    else if (field === 'sessionVersion') user.sessionVersion++;
    else status = 'unauthenticated';
    f.choices[0].proceed(); expect(action).not.toHaveBeenCalled();
  });
  it('still checks a live origin when no receipt owns navigation', () => {
    const dispatcher = createReviewNavigationDispatcher(); const action = vi.fn();
    dispatcher.request(action, () => false); expect(action).not.toHaveBeenCalled();
    dispatcher.request(action, () => true); expect(action).toHaveBeenCalledTimes(1);
  });
  it('prevents a live-owner predicate from reviving a cleaned-up intent', () => {
    let alive = true; const action = vi.fn();
    const intents = createReviewNavigationIntents(() => '/purchases?document=10', () => alive);
    const old = intents.prepare(action); alive = false; intents.invalidate(); alive = true;
    old.proceed(); expect(action).not.toHaveBeenCalled();
  });
  it('invalidates an in-flight queue checkpoint on a newer intent, traversal or owner teardown', () => {
    const f = fixture(); const queue = f.intents.checkpoint(); expect(queue()).toBe(true);
    f.dispatcher.request(vi.fn(), () => true); expect(queue()).toBe(false);
    const nextQueue = f.intents.checkpoint(); f.intents.invalidate(); expect(nextQueue()).toBe(false);
    const lastQueue = f.intents.checkpoint(); f.unmount(); expect(lastQueue()).toBe(false);
  });
  it('does not replay a traversal save after a newer palette intent was refused while saving', () => {
    const f = fixture(); let index = 2; const go = vi.fn(); const savedChoices: Array<() => void> = [];
    const traversal = createReviewTraversalGuard({ getIndex: () => index, go, onReplay: vi.fn(), getGuard: () => bindReviewGuardIntents({ blocked: true, request: proceed => savedChoices.push(proceed) }, f.intents) });
    index = 1; traversal({ stopImmediatePropagation: vi.fn() });
    index = 2; traversal({ stopImmediatePropagation: vi.fn() });
    expect(savedChoices).toHaveLength(1); expect(go.mock.calls).toEqual([[1]]);
    // The review has started saving this traversal. Ctrl+K now asks for a
    // different destination; the busy guard stays rather than changing route.
    const paletteAction = vi.fn(); f.dispatcher.request(paletteAction, () => true); f.choices[0].stay();
    savedChoices[0](); expect(go.mock.calls).toEqual([[1]]); expect(paletteAction).not.toHaveBeenCalled();
    // That cancellation must not prevent a later conscious, current traversal.
    index = 1; traversal({ stopImmediatePropagation: vi.fn() }); index = 2; traversal({ stopImmediatePropagation: vi.fn() });
    savedChoices[1](); expect(go.mock.calls).toEqual([[1], [1], [-1]]);
  });
});
