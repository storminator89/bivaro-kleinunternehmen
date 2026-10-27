import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { mcpConfig, mcpOriginAllowed } from '@/lib/mcp/config';
import { authenticateMcp, mcpChallenge } from '@/lib/mcp/auth';
import { createBivaroMcpServer } from '@/lib/mcp/server';
import { readRequestBodyWithinLimit, RequestBodyLimitError } from '@/lib/resource-limits';
import { consumeRateLimit, getTrustedClientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let config;
  try { config = mcpConfig(); } catch { return Response.json({ error: 'MCP-Konfiguration ungültig.' }, { status: 503 }); }
  if (!config) return new Response(null, { status: 404 });
  if (!mcpOriginAllowed(request, config)) return new Response(null, { status: 403 });
  const networkLimit = await consumeRateLimit(`mcp-network:${getTrustedClientIp(request.headers)}`, { limit: 600, windowMs: 60_000, blockMs: 60_000 });
  if (!networkLimit.allowed) return new Response(null, { status: 429, headers: { 'Retry-After': String(networkLimit.retryAfterSeconds) } });
  const principal = await authenticateMcp(request, config);
  if (!principal) return new Response(null, { status: 401, headers: { 'WWW-Authenticate': mcpChallenge(config), 'Cache-Control': 'no-store' } });
  const limit = await consumeRateLimit(`mcp:${principal.accessId}`, { limit: 100, windowMs: 60_000, blockMs: 60_000 });
  if (!limit.allowed) return new Response(null, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } });
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(new TextDecoder().decode(await readRequestBodyWithinLimit(request, 256 * 1024)));
  } catch (error) {
    return Response.json({ error: 'Ungültige oder zu große MCP-Nachricht.' }, { status: error instanceof RequestBodyLimitError ? 413 : 400 });
  }
  // One command per request: no batch can bypass per-request budgets or partly commit writes.
  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) return Response.json({ error: 'Eine einzelne MCP-Nachricht ist erforderlich.' }, { status: 400 });
  // Stateless: no tenant-bearing server/session object survives a request.
  const server = createBivaroMcpServer(principal);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 256 * 1024 });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request, { parsedBody });
    const body = await response.arrayBuffer();
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(body.byteLength ? body : null, { status: response.status, headers });
  } finally { await server.close(); }
}

// The synchronous stateless server has no event stream or sessions to delete.
export async function GET() { return new Response(null, { status: 405, headers: { Allow: 'POST' } }); }
export const DELETE = GET;
