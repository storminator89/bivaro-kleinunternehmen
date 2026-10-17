import { NextRequest, NextResponse } from 'next/server';
import { readRequestBodyWithinLimit, RequestBodyLimitError } from '@/lib/resource-limits';

export const MAX_AUTH_BODY_BYTES = 16 * 1024;
export const MAX_API_JSON_BODY_BYTES = 1024 * 1024;

/** Cookie authentication does not establish the origin of a browser mutation. */
export function isTrustedMutation(request: Request): boolean {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  // Same-site includes potentially hostile sibling subdomains.
  if (site === 'cross-site' || site === 'same-site') return false;

  let expected: string;
  try {
    const configured = process.env.NEXTAUTH_URL;
    if (!configured && process.env.NODE_ENV === 'production') return false;
    const target = new URL(configured || request.url);
    if (!['http:', 'https:'].includes(target.protocol)) return false;
    expected = target.origin;
  } catch { return false; }

  if (origin !== null) return origin === expected;
  const referer = request.headers.get('referer');
  if (referer) {
    try { return new URL(referer).origin === expected; } catch { return false; }
  }
  // Non-browser clients do not send Origin/Fetch Metadata. They still need
  // route authentication. Modern browser cross-origin POSTs send Origin;
  // opaque/sandbox origins send "null", which is rejected above.
  return site === null || site === 'same-origin';
}

/**
 * Keep this at the route boundary: Proxy clones/truncates request streams,
 * which is incompatible with the larger, explicitly bounded backup uploads.
 * Upload routes keep their existing authenticated stream budgets. Ordinary
 * JSON and auth routes opt into a smaller budget before their JSON parser.
 */
export function protectMutation<T extends Request, Args extends unknown[]>(
  handler: (request: T, ...args: Args) => Promise<Response>,
  options: { maxBodyBytes?: number; bearer?: boolean; nextAuth?: boolean } = {},
) {
  return async (request: T, ...args: Args): Promise<Response> => {
    if (!options.bearer && !options.nextAuth && !isTrustedMutation(request)) {
      return NextResponse.json({ error: 'Nicht erlaubter Anfrageursprung' }, { status: 403 });
    }
    let boundedRequest = request;
    if (options.maxBodyBytes !== undefined && request.body) {
      try {
        const body = await readRequestBodyWithinLimit(request, options.maxBodyBytes);
        const headers = new Headers(request.headers);
        headers.set('content-length', String(body.byteLength));
        const init = { method: request.method, headers, body, signal: request.signal };
        // Next's bundled request can come from a different module instance;
        // instanceof NextRequest is not reliable in a standalone build.
        // Always retain nextUrl/cookies for NextAuth and other Next handlers.
        boundedRequest = new NextRequest(request.url, init) as unknown as T;
      } catch (error) {
        if (error instanceof RequestBodyLimitError) {
          return NextResponse.json({ error: error.message }, { status: 413 });
        }
        return NextResponse.json({ error: 'Anfrage konnte nicht gelesen werden' }, { status: 400 });
      }
    }
    return handler(boundedRequest, ...args);
  };
}
