import { expect, test, type Page, type Request } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// Authored for the unchanged hosted browser-acceptance runner. Successful audit
// responses always come from its real isolated backend; never fabricate rows or
// pagination. Route interception only delays real responses or injects failures.
const auditURL = /\/api\/audit-logs(?:\?.*)?$/;
const isAudit = (request: Request) => new URL(request.url()).pathname === '/api/audit-logs';
const rows = (page: Page) => page.getByRole('main').locator('tbody tr');
const loading = (page: Page) => page.getByRole('status').filter({ hasText: 'Laden...' });
const error = (page: Page) => page.getByRole('alert').filter({ hasText: 'Audit-Log konnte nicht geladen werden.' });

async function settled(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function fixture(page: Page) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const password = 'SyntheticAuditLifecycle123!';
  const passwordHash = await hashPassword(password);
  const owner = await prisma.user.create({ data: { email: `audit-owner-${randomUUID()}@example.test`, name: 'Synthetic audit owner', password: passwordHash, role: 'USER' } });
  const foreign = await prisma.user.create({ data: { email: `audit-foreign-${randomUUID()}@example.test`, name: 'Synthetic foreign audit owner', password: passwordHash, role: 'USER' } });
  const marker = `SYN-AUDIT-${randomUUID().slice(0, 8)}`;
  await prisma.auditLog.createMany({ data: [
    ...Array.from({ length: 28 }, (_, index) => ({ userId: owner.id, action: 'CREATE', entityType: 'Customer', entityName: `${marker}-CUSTOMER-${String(index).padStart(2, '0')}`, createdAt: new Date(Date.UTC(2000, 0, 1, 12, 0, index)) })),
    ...Array.from({ length: 2 }, (_, index) => ({ userId: owner.id, action: 'UPDATE', entityType: 'Invoice', entityName: `${marker}-INVOICE-${index}`, createdAt: new Date(Date.UTC(2000, 0, 2, 12, 0, index)) })),
    { userId: foreign.id, action: 'CREATE', entityType: 'Customer', entityName: `${marker}-FOREIGN`, createdAt: new Date(Date.UTC(2000, 0, 3)) },
  ] });
  await isolateSyntheticLoginIpBudget();
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(owner.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('button', { name: 'Befehlspalette öffnen', exact: true }).filter({ visible: true }).first()).toBeVisible();
  return { marker, owner, foreign };
}

async function choose(page: Page, label: 'Bereich' | 'Aktion', value: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: value, exact: true }).click();
}

async function openAudit(page: Page) {
  await page.goto('/settings/audit-logs');
  await expect(page.getByRole('heading', { name: 'Audit-Log', exact: true })).toBeVisible();
}

async function actionRequest(page: Page, action: () => Promise<unknown>) {
  const requested = page.waitForRequest(isAudit);
  await action();
  return new URL((await requested).url()).searchParams;
}

/** Delay an unchanged real backend response. Canceled browser deliveries may fail. */
async function holdNext(page: Page) {
  let release!: () => void, started!: () => void, failed!: (reason: unknown) => void, finished!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const held = new Promise<void>((resolve, reject) => { started = resolve; failed = reject; });
  const done = new Promise<void>(resolve => { finished = resolve; });
  let deliveryError: unknown = null;
  let request: Request | undefined;
  await page.route(auditURL, async route => {
    request = route.request();
    try {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      // Fully read before releasing the gate, so neither server execution nor
      // a fabricated success result can explain which response wins.
      await response.body();
      started();
      await gate;
      try { await route.fulfill({ response }); } catch (caught) { deliveryError = caught; }
    } catch (caught) {
      failed(caught);
      throw caught;
    } finally { finished(); }
  }, { times: 1 });
  return { held, release, done, delivery: () => ({ request, deliveryError }) };
}

async function deliver(page: Page, held: Awaited<ReturnType<typeof holdNext>>) {
  const request = held.delivery().request;
  expect(request).toBeDefined();
  const delivered = page.waitForResponse(response => response.request() === request);
  held.release();
  const response = await delivered;
  expect(response.status()).toBe(200);
  expect(await response.finished()).toBeNull();
  await held.done;
  expect(held.delivery().deliveryError).toBeNull();
  await settled(page);
}

test('audit drafts apply once from later pages; paging and reset use the intended snapshot and keyboard submit', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { marker } = await fixture(page);
  const requests: URLSearchParams[] = [];
  page.on('request', request => { if (isAudit(request)) requests.push(new URL(request.url()).searchParams); });
  await openAudit(page);
  await expect(rows(page)).toHaveCount(25);
  await expect(rows(page).filter({ hasText: `${marker}-FOREIGN` })).toHaveCount(0);
  await page.getByRole('button', { name: 'Weiter', exact: true }).click();
  await expect(page.getByText('Seite 2 von 2', { exact: true })).toBeVisible();
  const beforeDraft = requests.length;
  await choose(page, 'Bereich', 'Kunde');
  await choose(page, 'Aktion', 'Erstellt');
  await page.getByLabel('Von', { exact: true }).fill('2000-01-01');
  await page.getByLabel('Bis', { exact: true }).fill('2000-01-01');
  await settled(page);
  await expect(page.getByText('Filter mit „Suchen“ anwenden.', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(beforeDraft);
  await expect(page.getByText('Seite 2 von 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Suchen', exact: true }).focus();
  const applied = await actionRequest(page, () => page.keyboard.press('Enter'));
  expect(Object.fromEntries(applied)).toEqual({ page: '1', limit: '25', entityType: 'Customer', action: 'CREATE', startDate: '2000-01-01T00:00:00.000Z', endDate: await page.evaluate(() => new Date('2000-01-01T23:59:59').toISOString()) });
  await expect(rows(page)).toHaveCount(25);
  await expect(page.getByText('Seite 1 von 2', { exact: true })).toBeVisible();
  await settled(page);
  expect(requests).toHaveLength(beforeDraft + 1);
  await expect(page.getByText('Filter mit „Suchen“ anwenden.', { exact: true })).toHaveCount(0);
  await expect(rows(page).filter({ hasText: `${marker}-FOREIGN` })).toHaveCount(0);
  const paged = await actionRequest(page, () => page.getByRole('button', { name: 'Weiter', exact: true }).click());
  expect(paged.get('page')).toBe('2'); expect(paged.get('entityType')).toBe('Customer');
  await expect(rows(page)).toHaveCount(3);
  // A changed draft must not leak into ordinary pagination or retry.
  await choose(page, 'Bereich', 'Rechnung');
  const beforeReset = requests.length;
  const reset = await actionRequest(page, () => page.getByRole('button', { name: 'Filter zurücksetzen', exact: true }).click());
  expect(Object.fromEntries(reset)).toEqual({ page: '1', limit: '25' });
  await expect(rows(page)).toHaveCount(25);
  await expect(page.getByText('Seite 1 von 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Bereich', exact: true })).toHaveText('Alle Bereiche');
  await expect(page.getByRole('combobox', { name: 'Aktion', exact: true })).toHaveText('Alle Aktionen');
  await expect(page.getByLabel('Von', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Bis', { exact: true })).toHaveValue('');
  await settled(page); expect(requests).toHaveLength(beforeReset + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('late real responses cannot clear newer loading, replace newer rows, or undo reset', async ({ page }) => {
  // Model a transport that cannot cancel after sending. Keep native fetch and
  // every response unchanged; only detach its signal so the latest-only guard
  // must discard responses even when transport cancellation is ineffective.
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      return new URL(url, location.href).pathname === '/api/audit-logs'
        ? nativeFetch(input, { ...init, signal: undefined })
        : nativeFetch(input, init);
    };
  });
  const { marker } = await fixture(page);
  await openAudit(page); await expect(rows(page)).toHaveCount(25);
  await choose(page, 'Bereich', 'Kunde');
  await page.getByRole('button', { name: 'Suchen', exact: true }).click();
  await expect(page.getByText('Seite 1 von 2', { exact: true })).toBeVisible();
  const older = await holdNext(page);
  await page.getByRole('button', { name: 'Weiter', exact: true }).click(); await older.held;
  await choose(page, 'Bereich', 'Rechnung');
  const newer = await holdNext(page);
  await page.getByRole('button', { name: 'Suchen', exact: true }).click(); await newer.held;
  try {
    await deliver(page, older);
    await expect(loading(page)).toBeVisible(); await expect(rows(page)).toHaveCount(0);
    await expect(error(page)).toHaveCount(0);
    await deliver(page, newer);
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).filter({ hasText: `${marker}-INVOICE-` })).toHaveCount(2);
  } finally { older.release(); newer.release(); await Promise.all([older.done, newer.done]); }
  const late = await holdNext(page);
  await page.getByRole('button', { name: 'Suchen', exact: true }).click(); await late.held;
  try {
    const reset = await actionRequest(page, () => page.getByRole('button', { name: 'Filter zurücksetzen', exact: true }).click());
    expect(Object.fromEntries(reset)).toEqual({ page: '1', limit: '25' });
    await expect(rows(page)).toHaveCount(25);
    await deliver(page, late);
    await expect(rows(page)).toHaveCount(25);
    await expect(rows(page).filter({ hasText: `${marker}-CUSTOMER-27` })).toHaveCount(1);
    await expect(page.getByText('Seite 1 von 2', { exact: true })).toBeVisible();
  } finally { late.release(); await late.done; }
  // A stale failure must not replace the newer successful reset either.
  let failRelease!: () => void, failStarted!: () => void;
  const failGate = new Promise<void>(resolve => { failRelease = resolve; });
  const failHeld = new Promise<void>(resolve => { failStarted = resolve; });
  await page.route(auditURL, async route => {
    failStarted(); await failGate;
    await route.fulfill({ status: 503, json: { error: 'Synthetic stale interruption' } });
  }, { times: 1 });
  await page.getByRole('button', { name: 'Suchen', exact: true }).click(); await failHeld;
  try {
    await actionRequest(page, () => page.getByRole('button', { name: 'Filter zurücksetzen', exact: true }).click());
    await expect(rows(page)).toHaveCount(25);
    const deliveredFailure = page.waitForResponse(response => isAudit(response.request()) && response.status() === 503);
    failRelease();
    expect(await (await deliveredFailure).finished()).toBeNull();
    await settled(page);
    await expect(error(page)).toHaveCount(0); await expect(rows(page)).toHaveCount(25);
  } finally { failRelease(); }
});

test('mobile HTTP/network errors are visible, hide stale rows, and retry the applied later page rather than a changed draft', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { marker } = await fixture(page);
  await page.route(auditURL, route => route.fulfill({ status: 503, json: { error: 'Synthetic hosted interruption' } }), { times: 1 });
  await openAudit(page);
  await expect(error(page)).toBeVisible(); await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText('Keine Einträge gefunden', { exact: true })).toHaveCount(0);
  const initialRetry = await actionRequest(page, () => page.getByRole('button', { name: 'Erneut versuchen', exact: true }).click());
  expect(Object.fromEntries(initialRetry)).toEqual({ page: '1', limit: '25' });
  await expect(rows(page)).toHaveCount(25);
  await choose(page, 'Bereich', 'Kunde'); await choose(page, 'Aktion', 'Erstellt');
  await page.getByRole('button', { name: 'Suchen', exact: true }).click();
  await expect(page.getByText('Seite 1 von 2', { exact: true })).toBeVisible();
  await page.route(auditURL, route => route.abort('failed'), { times: 1 });
  const failed = await actionRequest(page, () => page.getByRole('button', { name: 'Weiter', exact: true }).click());
  expect(failed.get('page')).toBe('2');
  await expect(error(page)).toBeVisible(); await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText('Keine Einträge gefunden', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Seite 1 von 2', { exact: true })).toHaveCount(0);
  await choose(page, 'Bereich', 'Rechnung');
  const retried = await actionRequest(page, () => page.getByRole('button', { name: 'Erneut versuchen', exact: true }).click());
  expect(Object.fromEntries(retried)).toEqual(Object.fromEntries(failed));
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).filter({ hasText: `${marker}-CUSTOMER-` })).toHaveCount(3);
  await expect(rows(page).filter({ hasText: `${marker}-FOREIGN` })).toHaveCount(0);
  await expect(error(page)).toHaveCount(0);
  await expect(page.getByText('Seite 2 von 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Bereich', exact: true })).toHaveText('Rechnung');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('navigating away aborts pending audit requests and a fresh visit cannot receive their rows', async ({ page }) => {
  const { marker } = await fixture(page);
  const errors: string[] = [];
  page.on('pageerror', caught => errors.push(caught.message));
  await openAudit(page); await expect(rows(page)).toHaveCount(25);
  await choose(page, 'Bereich', 'Kunde');
  const held = await holdNext(page);
  await page.getByRole('button', { name: 'Suchen', exact: true }).click(); await held.held;
  try {
    const aborted = page.waitForEvent('requestfailed', isAudit);
    await page.getByRole('link', { name: 'Zurück zu Einstellungen', exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    const failed = await aborted;
    expect(failed.failure()?.errorText).toContain('ERR_ABORTED');
    held.release(); await held.done;
    if (held.delivery().deliveryError) expect(held.delivery().request?.failure()?.errorText).toContain('ERR_ABORTED');
    await page.getByRole('link', { name: 'Audit-Log anzeigen', exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/audit-logs$/);
    await expect(rows(page)).toHaveCount(25);
    await expect(rows(page).filter({ hasText: `${marker}-INVOICE-` })).toHaveCount(2);
    await expect(page.getByRole('combobox', { name: 'Bereich', exact: true })).toHaveText('Alle Bereiche');
    expect(errors).toEqual([]);
  } finally { held.release(); await held.done; }
});
