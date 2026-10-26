import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// Future GitHub-hosted acceptance only, through the supported fresh-fixture
// runner. This is a read-delivery/retry case, not account/owner-policy coverage.
async function sessionDocument(page: Page, destination: '/login' | '/dashboard' | '/users', navigate: () => Promise<unknown>) {
  const session = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/auth/session'
    && new URL(page.url()).pathname === destination);
  await navigate();
  const response = await session;
  expect(response.status()).toBe(200);
  expect(await response.finished()).toBeNull();
  return await response.json() as { user?: { id: string; role: string; sessionVersion: number } };
}

test.afterAll(async () => { await prisma.$disconnect(); });

test('users delivery failures remain unavailable until explicit read retry recovers genuine fixture rows without writes', async ({ page, baseURL }) => {
  test.skip(process.env.GITHUB_ACTIONS !== 'true', 'Authored for the existing GitHub-hosted acceptance runner only.');
  test.setTimeout(60_000);
  expect(baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);

  // Setup is fixture-only, before observations. No registration UI, existing
  // account/role/settings changes, real services or owner switching are used.
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticUsersRead123!';
  const user = await prisma.user.create({ data: {
    email: `users-read-${randomUUID()}@example.test`, name: 'Synthetic users read admin',
    password: await hashPassword(password), role: 'ADMIN',
  } });
  await sessionDocument(page, '/login', () => page.goto('/login'));
  await page.getByLabel('E-Mail').fill(user.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  const authenticated = await sessionDocument(page, '/dashboard', () => page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click());
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(authenticated.user).toMatchObject({ id: user.id, role: 'ADMIN', sessionVersion: user.sessionVersion });

  const select = { id: true, name: true, email: true, role: true, sessionVersion: true, deactivatedAt: true } as const;
  const before = await prisma.user.findMany({ select, orderBy: { id: 'asc' } });
  const unexpectedWrites: string[] = [];
  let failedReads = 0, forwardedReads = 0, retryClicks = 0;
  // Guard every request, including native form/server-action POSTs outside /api.
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      unexpectedWrites.push(`${request.method()} ${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    if (url.pathname !== '/api/users' || request.method() !== 'GET') return route.continue();
    expect(request.postData()).toBeNull();
    expect(url.search).toBe('');
    if (retryClicks === 0) {
      failedReads++;
      return route.fulfill({ status: 503, contentType: 'text/plain', body: 'Synthetic users delivery interruption' });
    }
    // Preserve genuine request/response delivery after the observed retry.
    // Hydration may issue extra reads; no exact-one-request budget is asserted.
    forwardedReads++;
    return route.continue(); // No method, URL, headers, body or response rewrite.
  });

  const usersSession = await sessionDocument(page, '/users', () => page.goto('/users'));
  expect(usersSession.user).toMatchObject({ id: user.id, role: 'ADMIN', sessionVersion: user.sessionVersion });
  const main = page.getByRole('main');
  await expect(main.getByRole('alert')).toHaveText('Benutzer konnten nicht geladen werden. Bitte versuchen Sie es erneut.');
  await expect(main.getByText('Keine Benutzer gefunden.', { exact: true })).toHaveCount(0);
  await expect(main.getByRole('table')).toHaveCount(0);
  expect(failedReads).toBeGreaterThanOrEqual(1);
  expect(forwardedReads).toBe(0);
  expect(unexpectedWrites).toEqual([]);

  // Observe the real DOM click instead of enabling recovery before clicking:
  // an intervening hydration read must still fail, not deadlock a held gate or
  // turn the unavailable screen into success before the user's retry.
  await page.exposeBinding('usersReadRetryClicked', () => { retryClicks++; });
  await page.evaluate(() => {
    document.addEventListener('click', event => {
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (event.isTrusted && button?.textContent?.trim() === 'Erneut versuchen') {
        void (window as unknown as { usersReadRetryClicked: () => Promise<void> }).usersReadRetryClicked();
      }
    }, { capture: true });
  });
  const recoveredResponse = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/users' && response.status() === 200);
  await main.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
  await expect.poll(() => retryClicks).toBe(1);
  const response = await recoveredResponse;
  expect(await response.finished()).toBeNull();
  expect(await response.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: user.id, email: user.email, role: 'ADMIN' })]));
  const row = main.getByRole('row').filter({ has: page.getByRole('cell', { name: user.email, exact: true }) });
  await expect(row).toHaveCount(1);
  await expect(row).toBeVisible();
  await expect(row).toContainText(user.name!);
  await expect(row).toContainText('Administrator');
  await expect(main.getByRole('alert')).toHaveCount(0);
  await expect(main.getByText('Keine Benutzer gefunden.', { exact: true })).toHaveCount(0);
  expect(forwardedReads).toBeGreaterThanOrEqual(1);
  expect(unexpectedWrites).toEqual([]);
  expect(await prisma.user.findMany({ select, orderBy: { id: 'asc' } })).toEqual(before);
});
