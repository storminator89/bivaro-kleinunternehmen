import { createRemoteJWKSet, jwtVerify } from 'jose';
import { validateApiKey } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import type { McpConfig } from './config';

export type McpPrincipal = { userId: string; accessId: string; canWrite: boolean };
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function authenticateMcp(request: Request, config: NonNullable<McpConfig>): Promise<McpPrincipal | null> {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ') || authorization.length > 8192) return null;
  const token = authorization.slice(7);
  if (token.startsWith('biv_sk_')) {
    const result = await validateApiKey(token);
    // Old read/write/* scopes grant no MCP access. MCP permissions are opt-in.
    if (!result.valid || !result.userId || !result.apiKeyId || !result.scopes?.includes('mcp:read')) return null;
    return { userId: result.userId, accessId: `key:${result.apiKeyId}`, canWrite: config.writes && result.scopes.includes('mcp:write') };
  }
  if (!config.oauth) return null;
  try {
    const { oauth } = config;
    let keys = keySets.get(oauth.jwks);
    if (!keys) { keys = createRemoteJWKSet(new URL(oauth.jwks), { timeoutDuration: 5000, cooldownDuration: 30_000 }); keySets.clear(); keySets.set(oauth.jwks, keys); }
    const { payload } = await jwtVerify(token, keys, { issuer: oauth.issuer, audience: config.url, algorithms: ['RS256', 'ES256', 'EdDSA'], typ: 'at+jwt', requiredClaims: ['sub', 'exp', 'iat'], maxTokenAge: '15m', clockTolerance: 5 });
    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number' || typeof payload.iat !== 'number' || payload.exp - payload.iat > 900) return null;
    const clientId = payload.client_id ?? payload.azp;
    if (typeof clientId !== 'string' || !oauth.clientIds.includes(clientId)) return null;
    const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ') : [];
    const binding = Object.hasOwn(oauth.bindings, payload.sub) ? oauth.bindings[payload.sub] : null;
    if (!binding || !scopes.includes('mcp:read')) return null;
    const user = await prisma.user.findUnique({ where: { id: binding.userId }, select: { role: true, deactivatedAt: true } });
    if (!user || user.deactivatedAt || !['USER', 'ADMIN'].includes(user.role)) return null;
    return { userId: binding.userId, accessId: `oauth:${clientId}:${payload.sub}`, canWrite: config.writes && binding.write && scopes.includes('mcp:write') };
  } catch { return null; }
}

export function mcpChallenge(config: NonNullable<McpConfig>) {
  return config.oauth ? `Bearer resource_metadata="${config.origin}/.well-known/oauth-protected-resource/api/mcp", scope="mcp:read"` : 'Bearer realm="Bivaro MCP", scope="mcp:read"';
}
