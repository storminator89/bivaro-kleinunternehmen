import { defineConfig, devices } from '@playwright/test';

const e2eDatabaseUrl = `file:${process.cwd()}/prisma/e2e.db`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'on-first-retry',
  },
  webServer: {
    command:
      'npm run e2e:prepare && npm run build && rm -rf .next/standalone/public .next/standalone/.next/static && cp -R public .next/standalone/public && mkdir -p .next/standalone/.next && cp -R .next/static .next/standalone/.next/static && node .next/standalone/server.js',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: e2eDatabaseUrl,
      HOSTNAME: '127.0.0.1',
      NEXTAUTH_SECRET: 'e2e-secret-for-local-tests-only',
      BIVARO_SETUP_TOKEN: 'e2e-bootstrap-token-for-isolated-fixtures-only',
      NEXTAUTH_URL: 'http://127.0.0.1:3100',
      PORT: '3100',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
