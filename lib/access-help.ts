import { getSafeLoginCallbackUrl } from '@/lib/login-callback';

/** Retain a safe workspace target, never login loops or user-entered credentials. */
export function getAccessReturnTarget(value: string | null | undefined): string {
  const safe = getSafeLoginCallbackUrl(value);
  const parsed = new URL(safe, 'https://callback.invalid');
  if (['/login', '/register', '/help/access'].includes(decodeURIComponent(parsed.pathname).replace(/\/$/, ''))) return '/dashboard';
  // Access help needs the workspace, not arbitrary query values or fragments.
  // Only the existing non-sensitive workspace selectors survive this public trip.
  const query = new URLSearchParams();
  for (const key of ['tab', 'year', 'status']) {
    const candidate = parsed.searchParams.get(key);
    if (candidate && /^[a-zA-Z0-9_-]{1,40}$/.test(candidate)) query.set(key, candidate);
  }
  return parsed.pathname + (query.size ? `?${query}` : '');
}

export function getAccessHelpHref(value: string | null | undefined): string {
  return `/help/access?${new URLSearchParams({ callbackUrl: getAccessReturnTarget(value) })}`;
}

export function getAccessLoginHref(value: string | null | undefined): string {
  return `/login?${new URLSearchParams({ callbackUrl: getAccessReturnTarget(value) })}`;
}
