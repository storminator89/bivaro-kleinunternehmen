import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';
import { mcpBrowserEnv } from './scripts/mcp-browser-env.mjs';
if (!base.webServer || Array.isArray(base.webServer)) throw new Error('Expected a single isolated E2E server');
const server = base.webServer;
const port = Number(process.env.BIVARO_E2E_PORT ?? 3100);
export default defineConfig({
  ...base,
  retries: 0,
  projects: [{ name: 'mcp-chromium', testMatch: '**/mcp-access.spec.ts', use: { ...devices['Desktop Chrome'] } }],
  webServer: { ...server, env: { ...server.env, ...mcpBrowserEnv(port) } },
});
