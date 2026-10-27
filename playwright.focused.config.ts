import { defineConfig, devices } from '@playwright/test';
import baseline from './playwright.config';
import { mcpBrowserEnv } from './scripts/mcp-browser-env.mjs';
import { validFocusedSelection } from './scripts/focused-browser-selection.mjs';
const raw = process.env.BIVARO_FOCUSED_SELECTION;
if (!raw || Buffer.byteLength(raw) > 16 * 1024) throw Error('Missing bounded focused browser selection');
const selection = JSON.parse(raw);
if (!validFocusedSelection(selection) || !selection.core || selection.criticalMappingRequired) throw Error('Unreviewed focused browser selection');
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export default defineConfig({
  ...baseline,
  webServer: selection.specs.some((spec: { file: string }) => spec.file === 'e2e/mcp-access.spec.ts') && baseline.webServer && !Array.isArray(baseline.webServer)
    ? { ...baseline.webServer, env: { ...baseline.webServer.env, ...mcpBrowserEnv(Number(process.env.BIVARO_E2E_PORT ?? 3100)) } }
    : baseline.webServer,
  testDir: './focused-e2e', fullyParallel: false, workers: 1, retries: 0, forbidOnly: true,
  reporter: [['github']],
  use: { ...baseline.use, ...devices['Desktop Chrome'], trace: 'off' },
  projects: [
    { name: 'focused-core', testDir: './focused-e2e', testMatch: 'core.spec.ts' },
    ...selection.specs.map((spec: { file: string; titles: string[] }) => ({
      name: 'focused-' + spec.file.slice(4, -8), testDir: './e2e', testMatch: spec.file.slice(4), dependencies: ['focused-core'],
      ...(spec.titles.length ? { grep: new RegExp('(?:' + spec.titles.map(escape).join('|') + ')$') } : {}),
    })),
  ],
});
