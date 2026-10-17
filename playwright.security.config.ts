import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { tmpdir } from 'node:os';

const fixtureDirectory = process.env.BIVARO_SECURITY_TEST_DIR;
if (!fixtureDirectory || path.dirname(fixtureDirectory) !== tmpdir() || !path.basename(fixtureDirectory).startsWith('bivaro-security-e2e-')) {
  throw new Error('Run npm run test:e2e:security to create an isolated temporary database.');
}

export default defineConfig({
  testDir: './e2e', testMatch: 'security-hardening.spec.ts', workers: 1,
  reporter: 'list', timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:3101', ...devices['Desktop Chrome'] },
  webServer: {
    command: 'node node_modules/prisma/build/index.js migrate deploy && npm run build && rm -rf .next/standalone/public .next/standalone/.next/static && cp -R public .next/standalone/public && mkdir -p .next/standalone/.next && cp -R .next/static .next/standalone/.next/static && node .next/standalone/server.js',
    url: 'http://127.0.0.1:3101', reuseExistingServer: false, timeout: 180_000,
    env: {
      DATABASE_URL: `file:${path.join(fixtureDirectory, 'test.db')}`,
      NEXTAUTH_URL: 'http://127.0.0.1:3101', NEXTAUTH_SECRET: 'security-e2e-fixture-secret-not-for-production',
      BIVARO_SETUP_TOKEN: 'security-e2e-bootstrap-fixture-only', HOSTNAME: '127.0.0.1', PORT: '3101',
    },
  },
});
