type NavigationSearchParams = Pick<URLSearchParams, 'get'>;

/** Match the current workspace without changing URLs or browser history. */
export function isNavigationItemActive(href: string, pathname: string, searchParams: NavigationSearchParams) {
  const [path, query] = href.split('?');

  if (href === '/dashboard?tab=invoices' && pathname.startsWith('/dashboard/invoices/')) return true;
  if (href === '/dashboard?tab=quotes' && pathname.startsWith('/dashboard/quotes/')) return true;
  if (href === '/dashboard?tab=expenses' && /^\/expenses\/[1-9]\d*$/.test(pathname)) return true;

  // Customer and settings subpages keep their discoverable parent selected.
  if ((href === '/customers' || href === '/settings') && pathname.startsWith(`${path}/`)) return true;
  if (pathname !== path) return false;
  if (!query) return path !== '/dashboard' || !searchParams.get('tab');

  const currentTab = searchParams.get('tab');
  return new URLSearchParams(query).get('tab') === (currentTab === 'income' ? 'incomes' : currentTab);
}
