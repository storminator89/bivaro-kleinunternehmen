import { expect, test } from '@playwright/test';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';

// Small critical smoke only. Detailed security/financial suites remain intact.
test('bootstraps one admin, signs in, navigates core pages and revokes the session', async ({ page, request, baseURL }) => {
  test.setTimeout(60_000);
  // Refuse every account write outside the standard isolated hosted runner.
  expect(process.env.GITHUB_ACTIONS).toBe('true');
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  expect(baseURL).toBe('http://127.0.0.1:3100');
  const email = 'risk-based-core@example.test';
  const password = 'RiskBasedCore456!';
  expect((await request.post('/api/auth/register', { data: { name: 'Synthetic core', email, password } })).status()).toBe(403);
  expect((await request.get('/api/users')).status()).toBe(401);
  await page.goto('/register');
  await page.getByLabel('Name').fill('Synthetic core');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Bootstrap-Nachweis', { exact: true }).fill('e2e-bootstrap-token-for-isolated-fixtures-only');
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort bestätigen').fill(password);
  await page.getByRole('button', { name: 'Admin-Konto erstellen', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: 'Buchhaltung', level: 1 })).toBeVisible();
  for (const destination of ['/customers', '/settings', '/dashboard']) {
    await page.goto(destination);
    await expect(page).toHaveURL(new RegExp(`${destination}$`));
    await expect(page.locator('main#main-content')).toBeVisible();
  }
  const sessionResponse = await page.request.get('/api/auth/session');
  expect(sessionResponse.status()).toBe(200);
  const session = await sessionResponse.json();
  expect(typeof session.user.id).toBe('string');
  expect(session.user.role).toBe('ADMIN');
  expect((await page.request.get('/api/users')).status()).toBe(200);
  expect((await page.request.patch(`/api/users/${encodeURIComponent(session.user.id)}`, { data: { password: 'RiskBasedCoreChanged789!' } })).status()).toBe(200);
  expect((await page.request.get('/api/users')).status()).toBe(401);
  expect((await page.request.get('/api/incomes')).status()).toBe(401);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});
