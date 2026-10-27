/** Synthetic isolated-server configuration only; never reads installation credentials. */
export function mcpBrowserEnv(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid MCP fixture port');
  return { BIVARO_MCP_ENABLED: '1', BIVARO_MCP_URL: `http://127.0.0.1:${port}/api/mcp`, BIVARO_MCP_ALLOW_INSECURE_LAN: '1', BIVARO_MCP_ALLOW_WRITES: '1', BIVARO_MCP_OAUTH_ISSUER: '', BIVARO_MCP_OAUTH_JWKS_URL: '' };
}
