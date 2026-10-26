import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionContext } from 'next-auth/react';
import { QueryClient, isCancelledError } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { DashboardQueryProvider } from '@/components/dashboard/dashboard-query-provider';
import { reviewSessionKey } from '@/components/purchases/incoming-review-history';
import { disposeDashboardQueries } from '@/lib/dashboard-query-lifecycle';

const session = { user: { id: 'synthetic-owner-a', role: 'USER' as const, sessionVersion: 1 }, expires: '2099-01-01T00:00:00Z' };
function boundaryKey(data = session) {
  let observed: string | null = null;
  function Capture(): ReactNode {
    const boundary = DashboardQueryProvider({ children: createElement('span', null, 'Synthetic dashboard child') });
    observed = boundary.key;
    return boundary;
  }
  const html = renderToStaticMarkup(createElement(SessionContext.Provider, {
    value: { data, status: 'authenticated', update: vi.fn() },
  }, createElement(Capture)));
  expect(html).toContain('Synthetic dashboard child');
  return observed;
}

describe('dashboard authorization boundary (static key contract, not browser remount proof)', () => {
  it('uses the existing canonical session key and ignores expiry-only refreshed object identity', () => {
    expect(boundaryKey()).toBe(reviewSessionKey(session, 'authenticated'));
    expect(boundaryKey({ ...session, user: { ...session.user }, expires: '2099-01-02T00:00:00Z' })).toBe(boundaryKey());
  });
  it('changes the whole subtree key when owner or sessionVersion is replaced', () => {
    expect(boundaryKey({ ...session, user: { ...session.user, id: 'synthetic-owner-b' } })).not.toBe(boundaryKey());
    expect(boundaryKey({ ...session, user: { ...session.user, sessionVersion: 2 } })).not.toBe(boundaryKey());
  });
  it('also treats authorization role changes as a scope change', () => {
    expect(reviewSessionKey({ user: { ...session.user, role: 'ADMIN' } }, 'authenticated')).not.toBe(boundaryKey());
  });
});

describe('retired query-client cleanup', () => {
  it('aborts a consumed read signal and synchronously erases only the retired cache', async () => {
    const oldClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const newClient = new QueryClient();
    oldClient.setQueryData(['dashboard', 'owner-cache'], { description: 'Synthetic old-owner record' });
    newClient.setQueryData(['dashboard', 'owner-cache'], { description: 'Synthetic new-owner record' });
    let signal!: AbortSignal;
    const oldRead = oldClient.fetchQuery({ queryKey: ['dashboard', 'pending'], queryFn: context => {
      signal = context.signal;
      return new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Synthetic aborted read')), { once: true }));
    } }).catch(error => error);
    const cleanup = disposeDashboardQueries(oldClient);
    expect(signal.aborted).toBe(true);
    expect(oldClient.getQueryCache().getAll()).toEqual([]);
    expect(newClient.getQueryData(['dashboard', 'owner-cache'])).toEqual({ description: 'Synthetic new-owner record' });
    await cleanup;
    expect(isCancelledError(await oldRead)).toBe(true);
    newClient.clear();
  });
});
