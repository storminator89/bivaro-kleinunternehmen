import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { e2eDatabasePath } from './scripts/e2e-fixture.mjs';

if (process.env.BIVARO_AI_BROWSER_FIXTURE !== '1') throw new Error('Run the AI PDF browser gate in the production-derived ephemeral test image.');
const database = e2eDatabasePath();
const baseURL = 'http://127.0.0.1:3100';
export default defineConfig({
  testDir: './e2e', testMatch: '**/ai-receipt-native.spec.ts',
  fullyParallel: false, workers: 1, retries: 0,
  timeout: 120_000, globalTimeout: 240_000,
  outputDir: path.join(path.dirname(database), 'browser-results'),
  reporter: [['line']],
  use: { ...devices['Desktop Chrome'], baseURL, trace: 'off' },
  webServer: {
    command: 'node scripts/ai-pdf/browser-server.mjs', url: `${baseURL}/api/health`,
    reuseExistingServer: false, timeout: 60_000, stdout: 'pipe', stderr: 'pipe',
    env: { DATABASE_URL: `file:${database}` },
  },
});
