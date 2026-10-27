import { mcpConfig } from '@/lib/mcp/config';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const config = mcpConfig();
    if (!config?.oauth) return new Response(null, { status: 404 });
    return Response.json({ resource: config.url, authorization_servers: [config.oauth.issuer], bearer_methods_supported: ['header'], scopes_supported: ['mcp:read', ...(config.writes ? ['mcp:write'] : [])], resource_name: 'Bivaro' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return new Response(null, { status: 503 }); }
}
