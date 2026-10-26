import { createElement, isValidElement, Suspense, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Pure element-tree contract only: no app server, browser, database or network.
const state = vi.hoisted(() => ({
  pathname: '/help', status: 'loading', session: null as null | { user: { id: string } },
}));
vi.mock('react', async load => ({ ...await load<typeof import('react')>(), useState: (value: unknown) => [value, vi.fn()] }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: state.session, status: state.status }) }));
vi.mock('next/navigation', () => ({ usePathname: () => state.pathname }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-nonce': 'synthetic-shell-nonce' }) }));
vi.mock('@/components/theme-provider', () => ({ ThemeProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/auth/auth-provider', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/purchases/review-link', () => ({ ReviewLink: () => null }));
vi.mock('@/components/brand/bivaro-brand', () => ({ BivaroBrand: () => null }));
vi.mock('@/components/navigation/nav-links', () => ({ NavLinks: () => null }));
vi.mock('@/components/ui/sheet', () => ({ Sheet: () => null, SheetContent: () => null, SheetTrigger: () => null, SheetTitle: () => null }));
vi.mock('@/components/ui/button', () => ({ Button: () => null }));
vi.mock('@/components/sidebar-collapse-button', () => ({ CollapseButton: () => null }));
vi.mock('@/components/command-palette', () => ({ CommandPalette: () => null, CommandPaletteTrigger: () => null }));
vi.mock('@/components/user-menu', () => ({ UserMenu: () => null }));
vi.mock('@/components/theme-switch', () => ({ ThemeToggle: () => null }));
vi.mock('@/hooks/use-page-title', () => ({ usePageTitle: () => 'Synthetic title' }));
vi.mock('@/components/ui/toaster', () => ({ Toaster: () => null }));
vi.mock('@/components/route-progress', () => ({ RouteProgress: () => null }));
vi.mock('@/components/purchases/incoming-review-history-boundary', () => ({ IncomingReviewHistoryBoundary: () => null }));
vi.mock('@/components/record-search/record-list-search-provider', () => ({
  // Synthetic unresolved query work must never hide the public document body.
  RecordListSearchProvider: () => { throw new Promise(() => {}); },
}));
import RootLayout from '@/app/layout';
import LoginLayout from '@/app/login/layout';
import { AppShell } from '@/components/app-shell';
import { RecordListSearchProvider } from '@/components/record-search/record-list-search-provider';

const child = createElement('section', { id: 'synthetic-public-fragment' }, 'Synthetic content');
type ElementProps = { children?: ReactNode; id?: string; 'aria-busy'?: boolean | 'true'; fallback?: ReactNode };
function pathsTo(node: ReactNode, predicate: (value: React.ReactElement<ElementProps>) => boolean, parents: React.ReactElement<ElementProps>[] = []): React.ReactElement<ElementProps>[][] {
  if (Array.isArray(node)) return node.flatMap(value => pathsTo(value, predicate, parents));
  if (!isValidElement<ElementProps>(node)) return [];
  const path = [...parents, node];
  return [...(predicate(node) ? [path] : []), ...pathsTo(node.props.children, predicate, path)];
}

beforeEach(() => { state.pathname = '/help'; state.status = 'loading'; state.session = null; });

describe('public document shell and private-only query boundary (#183 candidate)', () => {
  it('does not put AppShell under a root Suspense or record-search provider', async () => {
    const tree = await RootLayout({ children: child });
    const paths = pathsTo(tree, node => node.type === AppShell);
    expect(paths).toHaveLength(1);
    expect(paths[0].some(node => node.type === Suspense || node.type === RecordListSearchProvider)).toBe(false);
  });

  it.each(['/', '/help', '/help/access', '/login', '/register'])('keeps public content outside private suspension on %s during all session states', pathname => {
    state.pathname = pathname;
    for (const status of ['loading', 'unauthenticated', 'authenticated']) {
      state.status = status;
      state.session = status === 'authenticated' ? { user: { id: 'synthetic-owner' } } : null;
      const tree = AppShell({ children: child });
      const paths = pathsTo(tree, node => node === child);
      expect(paths).toHaveLength(1);
      expect(paths[0].some(node => node.type === Suspense || node.type === RecordListSearchProvider)).toBe(false);
      expect(paths[0].some(node => node.props.id === 'main-content')).toBe(true);
    }
  });

  it.each(['/', '/help', '/help/access'])('includes public targets in pure server markup despite unresolved private query work on %s', async pathname => {
    state.pathname = pathname;
    const output = renderToStaticMarkup(await RootLayout({ children: child }));
    expect(output).toContain('id="synthetic-public-fragment"');
    expect(output).not.toContain('data-msg="The server did not finish this Suspense boundary');
  });

  it('keeps one unkeyed provider and boundary around every authenticated workspace route', () => {
    state.status = 'authenticated'; state.session = { user: { id: 'synthetic-owner' } };
    for (const pathname of ['/dashboard', '/customers', '/purchases', '/settings']) {
      state.pathname = pathname;
      const tree = AppShell({ children: child });
      expect(tree.type).toBe(Suspense); expect(tree.key).toBe(null); expect(tree.props.fallback).toBe(null);
      const providers = pathsTo(tree, node => node.type === RecordListSearchProvider);
      expect(providers).toHaveLength(1); expect(providers[0].at(-1)?.key).toBe(null);
      expect(pathsTo(tree, node => node === child)[0].map(node => node.type).slice(0, 2)).toEqual([Suspense, RecordListSearchProvider]);
    }
  });

  it('still withholds protected children while the session is loading', () => {
    state.pathname = '/dashboard';
    const tree = AppShell({ children: child });
    expect(tree.props['aria-busy']).toBe('true');
    expect(pathsTo(tree, node => node === child)).toEqual([]);
    expect(pathsTo(tree, node => node.type === RecordListSearchProvider)).toEqual([]);
  });

  it('keeps the unchanged login query form under its own route-local boundary', () => {
    const tree = LoginLayout({ children: child });
    expect(tree.type).toBe(Suspense); expect(tree.props.fallback).toBe(null); expect(tree.props.children).toBe(child);
  });
});
