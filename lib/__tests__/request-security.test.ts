import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { isTrustedMutation, protectMutation } from '@/lib/request-security';

afterEach(() => vi.unstubAllEnvs());

function request(headers: Record<string, string> = {}, body = '{}') {
  return new NextRequest('https://accounts.example.test/api/users', {
    method: 'POST', headers, body,
  });
}

describe('cookie mutation origin boundary', () => {
  it.each<Record<string, string>>([
    { origin: 'https://evil.example.test', 'sec-fetch-site': 'same-site' },
    { origin: 'https://attacker.test', 'sec-fetch-site': 'cross-site' },
    { origin: 'null' },
    { origin: 'https://accounts.example.test.attacker.test' },
    { origin: 'https://accounts.example.test:444' },
    { 'sec-fetch-site': 'same-site' },
    { referer: 'https://evil.example.test/page' },
  ])('rejects hostile browser metadata %j before invoking a mutation', async headers => {
    vi.stubEnv('NEXTAUTH_URL', 'https://accounts.example.test');
    const mutate = vi.fn(async () => new Response(null, { status: 201 }));
    const response = await protectMutation(mutate)(request({ 'content-type': 'text/plain', ...headers }));
    expect(response.status).toBe(403);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('accepts the canonical public origin behind an internal proxy URL', () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://accounts.example.test');
    expect(isTrustedMutation(new Request('http://internal:3000/api/settings', {
      headers: { origin: 'https://accounts.example.test', 'sec-fetch-site': 'same-origin' },
    }))).toBe(true);
  });

  it('does not trust Host or forwarded host as the configured application origin', () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://accounts.example.test');
    expect(isTrustedMutation(request({ origin: 'https://evil.test', host: 'evil.test', 'x-forwarded-host': 'evil.test' }))).toBe(false);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXTAUTH_URL', '');
    expect(isTrustedMutation(request())).toBe(false);
  });

  it('preserves non-browser authenticated callers without browser headers', () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://accounts.example.test');
    expect(isTrustedMutation(request())).toBe(true);
  });

  it('does not let an Authorization header bypass the cookie boundary', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://accounts.example.test');
    const mutate = vi.fn(async () => new Response());
    expect((await protectMutation(mutate)(request({ origin: 'https://evil.example.test', authorization: 'Bearer arbitrary' }))).status).toBe(403);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('leaves explicit bearer origin policy to the existing API authenticator', async () => {
    const authenticate = vi.fn(async () => new Response(null, { status: 401 }));
    expect((await protectMutation(authenticate, { bearer: true })(request({ origin: 'https://integration.test' }))).status).toBe(401);
    expect(authenticate).toHaveBeenCalledOnce();
  });
});

describe('bounded route bodies', () => {
  it.each([undefined, '1', '200'])('rejects overflow with Content-Length %s before parsing', async length => {
    const parse = vi.fn(async (req: Request) => Response.json(await req.json()));
    const req = request(length ? { 'content-length': length } : {}, '{"extra":"' + 'x'.repeat(100) + '"}');
    expect((await protectMutation(parse, { maxBodyBytes: 32 })(req)).status).toBe(413);
    expect(parse).not.toHaveBeenCalled();
  });

  it('cancels oversized chunked streams', async () => {
    const cancel = vi.fn();
    const req = new Request('http://localhost/api/auth/register', {
      method: 'POST', duplex: 'half',
      body: new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(20)); }, cancel }),
    } as RequestInit & { duplex: 'half' });
    const parse = vi.fn(async () => new Response());
    expect((await protectMutation(parse, { maxBodyBytes: 32 })(req)).status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
    expect(parse).not.toHaveBeenCalled();
  });

  it('preserves JSON, cookies, nextUrl and route params for allowed input', async () => {
    const handler = async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
      expect(req.nextUrl.pathname).toBe('/api/users');
      expect(req.cookies.get('test')?.value).toBe('session');
      return Response.json({ ...await req.json(), ...await context.params });
    };
    const result = await protectMutation(handler, { maxBodyBytes: 100 })(request({ cookie: 'test=session' }, '{"name":"Valid"}'), { params: Promise.resolve({ id: '42' }) });
    expect(await result.json()).toEqual({ name: 'Valid', id: '42' });
  });
});
