/** Only root-relative, same-origin destinations may be passed to the router. */
export function getSafeLoginCallbackUrl(value: string | null | undefined): string {
  const fallback = '/dashboard';
  if (!value?.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/u.test(value)) {
    return fallback;
  }

  try {
    const url = new URL(value, 'https://callback.invalid');
    const decodedPath = decodeURIComponent(url.pathname);
    // URL normalization can expose a protocol-relative path (e.g. /..//host).
    if (url.origin !== 'https://callback.invalid' || url.pathname.startsWith('//')
      || decodedPath.startsWith('//') || /[\\\u0000-\u001f\u007f]/u.test(decodedPath)) {
      return fallback;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
