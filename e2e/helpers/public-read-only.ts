/** Request classification only; never infer a successful auth result from a log. */
export function classifyPublicReadOnlyRequest(method: string, requestUrl: string, origin: string) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return 'read';
  const url = new URL(requestUrl);
  if (method === 'POST' && url.origin === origin && url.pathname === '/api/auth/_log' && url.search === '') {
    return 'auth-diagnostic';
  }
  return 'forbidden';
}

/** Never retain message, stack, URL, session, credentials or request metadata. */
export function publicAuthDiagnosticMetadata(body: string | null) {
  const diagnostic = new URLSearchParams(body ?? '');
  const level = diagnostic.get('level') ?? '';
  const code = diagnostic.get('code') ?? '';
  return {
    level: ['error', 'warn', 'debug'].includes(level) ? level : 'unrecognized',
    code: /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : 'UNRECOGNIZED',
  };
}
