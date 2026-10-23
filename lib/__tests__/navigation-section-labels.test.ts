import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const context = vi.hoisted(() => ({
  role: 'USER',
  status: 'authenticated',
  pathname: '/dashboard',
  params: new URLSearchParams('tab=invoices'),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: context.status === 'authenticated' ? { user: { id: 'synthetic-user', role: context.role, sessionVersion: 1 } } : null, status: context.status }),
  signOut: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => context.pathname,
  useSearchParams: () => context.params,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { NavLinks } from '@/components/navigation/nav-links';

beforeEach(() => { context.role = 'USER'; context.status = 'authenticated'; });

describe('shared navigation section labels', () => {
  it('keeps the five named groups in sentence case without tracked-cap utilities', () => {
    const html = renderToStaticMarkup(createElement(NavLinks));
    const headings = [...html.matchAll(/<h3\b([^>]*)>([^<]*)<\/h3>/g)];
    expect(headings.map(match => match[2])).toEqual(['Übersicht', 'Verkauf', 'Buchhaltung', 'Auswertungen', 'System']);
    for (const [, attributes] of headings) {
      expect(attributes).not.toMatch(/uppercase|tracking-/);
    }
  });

  it('also keeps the unauthenticated account group untracked and sentence case', () => {
    context.status = 'unauthenticated';
    const html = renderToStaticMarkup(createElement(NavLinks));
    expect(html).toMatch(/<h3\b[^>]*>Konto<\/h3>/);
    expect(html.match(/<h3\b[^>]*>/)?.[0]).not.toMatch(/uppercase|tracking-/);
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/register"');
  });

  it('keeps the invoice tab destination and current-page semantics', () => {
    const html = renderToStaticMarkup(createElement(NavLinks));
    expect(html).toMatch(/<a\b[^>]*aria-current="page"[^>]*href="\/dashboard\?tab=invoices"/);
    expect(html).toContain('href="/purchases"');
    expect(html).toContain('href="/dashboard/today"');
  });

  it('keeps administrator navigation role-filtered', () => {
    context.role = 'USER';
    expect(renderToStaticMarkup(createElement(NavLinks))).not.toContain('href="/users"');
    context.role = 'ADMIN';
    expect(renderToStaticMarkup(createElement(NavLinks))).toContain('href="/users"');
    context.role = 'USER';
  });
});
