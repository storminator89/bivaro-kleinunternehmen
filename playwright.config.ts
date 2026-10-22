import { defineConfig, devices } from '@playwright/test';
import { e2eDatabasePath } from './scripts/e2e-fixture.mjs';

const e2eDatabaseUrl = `file:${e2eDatabasePath()}`;
const port = Number(process.env.BIVARO_E2E_PORT ?? 3100);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid BIVARO_E2E_PORT.');
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['security-hardening.spec.ts', '**/ai-receipt-native.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command:
      'npm run e2e:prepare && npm run build && rm -rf .next/standalone/public .next/standalone/.next/static && cp -R public .next/standalone/public && mkdir -p .next/standalone/.next && cp -R .next/static .next/standalone/.next/static && node .next/standalone/server.js',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    env: {
      DATABASE_URL: e2eDatabaseUrl,
      HOSTNAME: '127.0.0.1',
      NEXTAUTH_SECRET: 'e2e-secret-for-local-tests-only',
      BIVARO_SETUP_TOKEN: 'e2e-bootstrap-token-for-isolated-fixtures-only',
      NEXTAUTH_URL: baseURL,
      PORT: String(port),
    },
  },
  projects: [
    {
      // The existing serial core suite proves first-admin bootstrap against the
      // empty runner fixture before independent feature suites create users.
      name: 'chromium-bootstrap',
      testMatch: '**/auth-dashboard-invoice.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      dependencies: ['chromium-bootstrap'],
      testIgnore: ['**/auth-dashboard-invoice.spec.ts', '**/security-hardening.spec.ts', '**/ai-receipt-native.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
