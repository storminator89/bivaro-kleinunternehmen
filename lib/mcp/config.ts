import { z } from 'zod';

const httpsUrl = z.url().refine(value => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.hash && !u.search; });
const bindingsSchema = z.record(z.string().min(1), z.object({ userId: z.string().min(1), write: z.boolean().default(false) }).strict());
export type McpConfig = ReturnType<typeof mcpConfig>;

export function mcpConfig() {
  if (process.env.BIVARO_MCP_ENABLED !== '1') return null;
  const url = new URL(process.env.BIVARO_MCP_URL || '');
  if (url.pathname !== '/api/mcp' || url.search || url.hash || url.username || url.password) throw new Error('BIVARO_MCP_URL muss auf /api/mcp zeigen.');
  // Plain HTTP is an explicit LAN-only compatibility mode, never an Internet default.
  const privateHost = /^(127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(url.hostname) || url.hostname === 'localhost' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && privateHost && process.env.BIVARO_MCP_ALLOW_INSECURE_LAN === '1')) throw new Error('MCP benötigt HTTPS oder den expliziten privaten LAN-Modus.');
  const issuer = process.env.BIVARO_MCP_OAUTH_ISSUER;
  const jwks = process.env.BIVARO_MCP_OAUTH_JWKS_URL;
  let oauth = null;
  if (issuer || jwks) {
    if (url.protocol !== 'https:') throw new Error('OAuth benötigt HTTPS.');
    const clientIds = (process.env.BIVARO_MCP_OAUTH_CLIENT_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
    if (!clientIds.length) throw new Error('OAuth-Clients müssen explizit freigegeben sein.');
    oauth = { issuer: httpsUrl.parse(issuer), jwks: httpsUrl.parse(jwks), clientIds, bindings: bindingsSchema.parse(JSON.parse(process.env.BIVARO_MCP_OAUTH_SUBJECTS || '{}')) };
  }
  return { url: url.href, origin: url.origin, host: url.host, writes: process.env.BIVARO_MCP_ALLOW_WRITES === '1', oauth };
}

export function mcpOriginAllowed(request: Request, config: NonNullable<McpConfig>) {
  // Never derive the canonical resource or allowed origins from forwarded headers.
  if (request.headers.get('host') !== config.host) return false;
  const origin = request.headers.get('origin');
  return origin === null || origin === config.origin;
}
