import { describe, expect, it } from 'vitest';
import { createIncomingListQueryIntents } from '@/components/purchases/incoming-list-query-intents';
import { createReviewNavigationIntents } from '@/components/purchases/incoming-review-history';

// Authored source vectors only; not executed during this preparation.
const base = 'https://bivaro.example/purchases?trace=kept&page=2';
const kind = '/purchases?trace=kept&taskKind=CLARIFY';
const due = `${kind}&taskDue=due`;
const href = (path: string) => `https://bivaro.example${path}`;

describe('pending explicit incoming-list query composition', () => {
  it('composes kind, due and search before any router/location commit, including explicit deletion', () => {
    const queries = createIncomingListQueryIntents();
    expect(queries.compose(base, '/purchases', { taskKind: 'CLARIFY', page: null, document: null })).toBe(kind);
    expect(queries.compose(base, '/purchases', { taskDue: 'due', page: null })).toBe(due);
    expect(queries.compose(base, '/purchases', { search: 'invoice & source' })).toBe(`${due}&search=invoice+%26+source`);
    expect(queries.compose(base, '/purchases', { taskKind: null, taskDue: null, search: null })).toBe('/purchases?trace=kept');
  });

  it('keeps the latest intent across an accepted predecessor and rejects lagging router snapshots', () => {
    const queries = createIncomingListQueryIntents();
    queries.compose(base, '/purchases', { taskKind: 'CLARIFY', page: null });
    queries.compose(base, '/purchases', { taskDue: 'due' });
    expect(queries.observe('/purchases', kind.split('?')[1], href(kind))).toBe(true);
    expect(queries.observe('/purchases', kind.split('?')[1], base)).toBe(false);
    expect(queries.compose(href(kind), '/purchases', { search: 'newer' })).toBe(`${due}&search=newer`);
    // The older real response may settle after the newest URL. Observing it
    // never emits a navigation or changes the latest pending query.
    expect(queries.observe('/purchases', kind.split('?')[1], href(`${due}&search=newer`))).toBe(false);
    expect(queries.compose(href(kind), '/purchases', { taskDue: 'later' })).toBe(`${kind}&taskDue=later&search=newer`);
  });

  it('retires intent only against the actual matching latest route, then uses its accepted query', () => {
    const queries = createIncomingListQueryIntents();
    queries.compose(base, '/purchases', { taskKind: 'CLARIFY', page: null });
    queries.compose(base, '/purchases', { taskDue: 'due' });
    expect(queries.observe('/purchases', due.split('?')[1], href(kind))).toBe(false);
    expect(queries.observe('/purchases', due.split('?')[1], href(due))).toBe(true);
    expect(queries.compose(href(due), '/purchases', { taskKind: null })).toBe('/purchases?trace=kept&taskDue=due');
  });

  it('rebases on unrelated actual URLs, not old accepted router snapshots', () => {
    const queries = createIncomingListQueryIntents();
    queries.compose(base, '/purchases', { taskKind: 'CLARIFY', page: null });
    const newer = 'https://bivaro.example/purchases?search=external';
    expect(queries.observe('/purchases', 'trace=kept&page=2', newer)).toBe(false);
    expect(queries.compose(newer, '/purchases', { taskDue: 'undated' })).toBe('/purchases?search=external&taskDue=undated');
    expect(queries.compose('https://bivaro.example/customers', '/purchases', { taskKind: 'CLARIFY' })).toBeNull();
  });

  it('starts anew after traversal/external-proceed/disposal even at a previously recognized source URL', () => {
    const queries = createIncomingListQueryIntents();
    queries.compose(base, '/purchases', { taskKind: 'CLARIFY', page: null });
    queries.compose(base, '/purchases', { taskDue: 'due' });
    queries.invalidate();
    expect(queries.compose(base, '/purchases', { search: 'traversed' })).toBe('/purchases?trace=kept&page=2&search=traversed');
    const newSession = createIncomingListQueryIntents();
    expect(newSession.compose(base, '/purchases', { taskDue: 'later' })).toBe('/purchases?trace=kept&page=2&taskDue=later');
  });

  it('never records cancelled, superseded, moved-source or signed-out review intents', () => {
    const queries = createIncomingListQueryIntents();
    let location = base, current = true;
    const guards = createReviewNavigationIntents(() => location, () => current);
    const requested = () => queries.compose(location, '/purchases', { taskKind: 'CLARIFY', page: null });
    const cancelled = guards.prepare(requested); cancelled.stay(); cancelled.proceed();
    const superseded = guards.prepare(requested); guards.prepare(() => {}).stay(); superseded.proceed();
    const moved = guards.prepare(requested); location = href('/purchases?search=new-source'); moved.proceed();
    location = base; const signedOut = guards.prepare(requested); current = false; signedOut.proceed();
    expect(queries.compose(base, '/purchases', { taskDue: 'due' })).toBe('/purchases?trace=kept&page=2&taskDue=due');
  });
});
