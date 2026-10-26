import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// Authored, not locally executed. Isolated synthetic account + intercepted GET
// deliveries only: no API-key record, secret, mutation, credential or policy change.
const syntheticKey = { id: 91, name: 'Synthetic read-only key list fixture', keyPrefix: 'synthetic-prefix-only',
  scopes: ['read'], isActive: true, expiresAt: null, lastUsedAt: null, createdAt: '2026-10-26T00:00:00.000Z' };
async function signIn(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticKeyListRead123!';
  const user = await prisma.user.create({ data: {
    email: `key-list-read-${randomUUID()}@example.test`, name: 'Synthetic key list reader', password: await hashPassword(password),
  } });
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(user.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.route('**/api/cors-settings', async route => {
    expect(route.request().method()).toBe('GET');
    await route.fulfill({ json: { origins: [], defaultOrigins: [] } });
  });
}
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function expectUnknown(page: Page) {
  const main = page.getByRole('main');
  await expect(main.getByText('Anzahl und Status unbekannt', { exact: true })).toBeVisible();
  await expect(main.getByText(/\d+\/10 · \d+ aktiv/)).toHaveCount(0);
  await expect(main.getByText('Noch keine Schlüssel', { exact: true })).toHaveCount(0);
  await expect(main.getByText(syntheticKey.name, { exact: true })).toHaveCount(0);
  await expect(main.getByRole('button', { name: 'Neuen API-Key erstellen', exact: true })).toBeDisabled();
  await expect(main.getByRole('button', { name: `${syntheticKey.name} deaktivieren`, exact: true })).toHaveCount(0);
}
test.afterAll(async () => { await prisma.$disconnect(); });

for (const width of [1440, 360, 390]) {
  test(`API key list at ${width}px distinguishes held failure, keyboard GET retry, stale refresh and confirmed empty reload without writes`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);
    const first = deferred(); const recovery = deferred(); const refresh = deferred();
    let reads = 0;
    const methods: string[] = [];
    await page.route('**/api/api-keys', async route => {
      const method = route.request().method(); methods.push(method); expect(method).toBe('GET');
      const index = ++reads;
      if (index === 1) {
        await first.promise;
        return route.fulfill({ status: 503, json: { error: 'Synthetic unavailable delivery' } });
      }
      if (index === 2) { await recovery.promise; return route.fulfill({ json: [syntheticKey] }); }
      if (index === 3) { await refresh.promise; return route.fulfill({ status: 503, json: {} }); }
      return route.fulfill({ json: [] });
    });
    await page.goto('/settings/api-keys');
    const main = page.getByRole('main');
    const list = main.getByRole('region', { name: 'API-Schlüsselliste', exact: true });
    await expect(main.getByRole('heading', { name: 'API-Schlüssel', exact: true })).toBeVisible();
    await expect(main.getByRole('link', { name: 'Zurück zu Einstellungen', exact: true })).toHaveAttribute('href', '/settings');
    await expect(list).toHaveAttribute('aria-busy', 'true');
    await expect(list.getByRole('status')).toHaveText('API-Schlüssel werden geladen…');
    await expectUnknown(page);
    first.release();
    await expect(list.getByRole('alert')).toContainText('nicht geladen');
    await expect(list).toHaveAttribute('aria-busy', 'false');
    await expectUnknown(page); expect(reads).toBe(1);
    const retry = list.getByRole('button', { name: 'Erneut versuchen', exact: true });
    await retry.focus(); await page.keyboard.press('Enter');
    await expect(list).toHaveAttribute('aria-busy', 'true'); await expectUnknown(page);
    recovery.release();
    await expect(main.getByText('1/10 · 1 aktiv', { exact: true })).toBeVisible();
    await expect(list.getByText(syntheticKey.name, { exact: true })).toBeVisible();
    await expect(list.getByRole('button', { name: `${syntheticKey.name} deaktivieren`, exact: true })).toBeVisible();
    await main.getByRole('button', { name: 'Schlüsselliste aktualisieren', exact: true }).click();
    await expect(list).toHaveAttribute('aria-busy', 'true'); await expectUnknown(page);
    refresh.release();
    await expect(list.getByRole('alert')).toBeVisible(); await expectUnknown(page);
    await list.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
    await expect(main.getByText('0/10 · 0 aktiv', { exact: true })).toBeVisible();
    await expect(list.getByText('Noch keine Schlüssel', { exact: true })).toBeVisible();
    await expect(list.getByRole('button', { name: 'API-Key erstellen', exact: true })).toBeEnabled();
    await page.reload();
    await expect(list.getByText('Noch keine Schlüssel', { exact: true })).toBeVisible();
    expect(reads).toBe(5); expect(methods).toEqual(['GET', 'GET', 'GET', 'GET', 'GET']);
    expect(await main.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
}

test('API key list refuses denied network invalid JSON and malformed successful deliveries until deliberate read recovery', async ({ page }) => {
  await signIn(page);
  let delivery = 0; let recovery = false; let reads = 0;
  const failures = [401, 403, 'network', 'invalid JSON', { keys: [] }, [null], [{ ...syntheticKey, scopes: null }]];
  await page.route('**/api/api-keys', async route => {
    expect(route.request().method()).toBe('GET'); reads++;
    if (recovery) return route.fulfill({ json: [syntheticKey] });
    const failure = failures[delivery];
    if (typeof failure === 'number') return route.fulfill({ status: failure, json: {} });
    if (failure === 'network') return route.abort('failed');
    if (failure === 'invalid JSON') return route.fulfill({ contentType: 'application/json', body: '{broken' });
    return route.fulfill({ json: failure });
  });
  for (delivery = 0; delivery < failures.length; delivery++) {
    recovery = false;
    if (delivery === 0) await page.goto('/settings/api-keys');
    else await page.reload();
    const list = page.getByRole('region', { name: 'API-Schlüsselliste', exact: true });
    await expect(list.getByRole('alert')).toContainText('nicht geladen'); await expectUnknown(page);
    const beforeRetry = reads; recovery = true;
    await list.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
    await expect(list.getByText(syntheticKey.name, { exact: true })).toBeVisible();
    expect(reads).toBe(beforeRetry + 1);
  }
});
