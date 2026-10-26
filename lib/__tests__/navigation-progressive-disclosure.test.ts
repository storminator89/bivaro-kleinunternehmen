import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isNavigationItemActive } from '@/lib/navigation';

const context = vi.hoisted(() => ({ role: 'USER', status: 'authenticated', pathname: '/dashboard', params: new URLSearchParams(), collapsed: false }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useState: (initial: unknown) => typeof initial === 'boolean' ? [context.collapsed, vi.fn()] : actual.useState(initial) };
});
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: context.status === 'authenticated' ? { user: { id: 'navigation-fixture', role: context.role, sessionVersion: 1 } } : null, status: context.status }),
  signOut: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => context.pathname,
  useSearchParams: () => context.params,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
import { NavLinks } from '@/components/navigation/nav-links';

function render(allowCollapse = true) { return renderToStaticMarkup(createElement(NavLinks, { allowCollapse })); }
function details(html: string) { return [...html.matchAll(/<details\b([^>]*)>([\s\S]*?)<\/details>/g)]; }
function links(html: string) { return [...html.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map(match => match[1]); }
const userDestinations = ['/dashboard', '/dashboard/today', '/dashboard?tab=invoices', '/dashboard?tab=quotes', '/customers', '/history', '/dashboard/reminders', '/dashboard?tab=incomes', '/purchases', '/dashboard?tab=expenses', '/cashbook', '/dashboard?tab=eur', '/dashboard?tab=gwg', '/steuer-simulation', '/settings'];

beforeEach(() => { context.role = 'USER'; context.status = 'authenticated'; context.pathname = '/dashboard'; context.params = new URLSearchParams(); context.collapsed = false; });

describe('navigation active location without route mutations', () => {
  it.each([
    ['/dashboard?tab=invoices', '/dashboard/invoices/new', '', true],
    ['/dashboard?tab=quotes', '/dashboard/quotes/42', '', true],
    ['/dashboard?tab=incomes', '/dashboard', 'tab=income&new=1&tag=a&tag=b', true],
    ['/dashboard?tab=expenses', '/expenses/42', '', true],
    ['/customers', '/customers/articles', '', true],
    ['/customers', '/customers/import', '', true],
    ['/settings', '/settings/audit-logs', '', true],
    ['/history', '/history', 'invoiceId=42', true],
    ['/dashboard', '/dashboard', 'filter=unpaid', true],
    ['/dashboard', '/dashboard', 'tab=quotes', false],
    ['/dashboard', '/dashboard/today', '', false],
    ['/customers', '/customers-archive', '', false],
    ['/dashboard?tab=invoices', '/dashboard/quotes/new', '', false],
    ['/dashboard?tab=expenses', '/expenses/not-an-id', '', false],
  ])('matches %s at %s?%s as %s', (href, pathname, query, expected) => {
    const params = new URLSearchParams(query);
    expect(isNavigationItemActive(href, pathname, params)).toBe(expected);
    expect(params.toString()).toBe(query);
  });
});

describe('progressive navigation presentation', () => {
  it('keeps all 15 destinations reachable with only 10 initially visible direct links', () => {
    const html = render();
    expect(links(html)).toEqual(userDestinations);
    expect(links(html.replace(/<details\b[\s\S]*?<\/details>/g, ''))).toHaveLength(10);
    const groups = details(html);
    expect(groups).toHaveLength(2);
    expect(groups.every(group => !/\bopen=/.test(group[1]))).toBe(true);
    expect(groups[0][2]).toContain('Historie und Mahnwesen');
    expect(groups[0][2]).toContain('href="/dashboard/reminders"');
    expect(groups[1][2]).toContain('Auswertungen');
    expect(html).toContain('Heute erledigen');
    expect(html).toContain('Dashboard');
  });

  it.each([
    ['/history', 'invoiceId=42', 0],
    ['/dashboard/reminders', '', 0],
    ['/dashboard', 'tab=eur', 1],
    ['/dashboard', 'tab=gwg', 1],
    ['/steuer-simulation', '', 1],
  ])('reveals the active destination for %s?%s', (pathname, query, openGroup) => {
    context.pathname = pathname; context.params = new URLSearchParams(query);
    const groups = details(render());
    expect(groups[openGroup][1]).toContain('open=""');
    expect(groups[openGroup][2]).toContain('aria-current="page"');
    expect(groups[openGroup === 0 ? 1 : 0][1]).not.toContain('open=""');
  });

  it('preserves administrator filtering and all 16 administrator destinations', () => {
    expect(render()).not.toContain('href="/users"');
    context.role = 'ADMIN';
    const html = render();
    expect(links(html)).toHaveLength(16);
    expect(links(html.replace(/<details\b[\s\S]*?<\/details>/g, ''))).toHaveLength(11);
    expect(html).toContain('href="/users"');
  });

  it('names every collapsed icon link and logout control without hiding destinations', () => {
    context.collapsed = true;
    const html = render();
    expect(details(html)).toHaveLength(0);
    expect(links(html)).toEqual(userDestinations);
    for (const link of html.matchAll(/<a\b[^>]*>/g)) expect(link[0]).toMatch(/aria-label="[^"]+"/);
    expect(html).toContain('aria-label="Abmelden"');
    expect(html).toContain('aria-label="Mahnwesen"');
  });

  it('keeps mobile labels and disclosures even when the desktop rail is collapsed', () => {
    context.collapsed = true;
    const html = render(false);
    expect(details(html)).toHaveLength(2);
    expect(html).toContain('>Rechnungen</span>');
    expect(html).toContain('Historie und Mahnwesen');
  });

  it.each([false, true])('keeps unauthenticated account links named when collapsed=%s', collapsed => {
    context.status = 'unauthenticated'; context.collapsed = collapsed;
    const html = render();
    expect(links(html)).toEqual(['/login', '/register']);
    if (collapsed) expect(html).toContain('aria-label="Anmelden"');
    else expect(html).toContain('>Anmelden</span>');
  });
});
