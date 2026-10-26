import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// Authored acceptance only. Run through the supported isolated-fixture runner
// when authorized; intercepted delivery failures do not prove auth policy.
async function signIn(page: Page, withBook = true) {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticCashbookRead123!';
  const user = await prisma.user.create({ data: {
    email: `cashbook-read-${randomUUID()}@example.test`,
    name: 'Synthetic cashbook read', password: await hashPassword(password),
  } });
  const book = withBook ? await prisma.cashBook.create({ data: {
    userId: user.id, name: `Synthetic cashbook ${randomUUID()}`, initialBalance: 37.5,
  } }) : null;
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(user.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return { user, book };
}

test.afterAll(async () => { await prisma.$disconnect(); });

for (const width of [1440, 360, 390]) {
  test(`cashbook keeps its shell at ${width}px through delayed failure, keyboard read retry and reload`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const { user, book } = await signIn(page);
    let releaseFailure!: () => void, releaseRecovery!: () => void;
    const failureGate = new Promise<void>(resolve => { releaseFailure = resolve; });
    const recoveryGate = new Promise<void>(resolve => { releaseRecovery = resolve; });
    let recovering = false, reads = 0;
    const writes: string[] = [];
    page.on('request', request => {
      if (new URL(request.url()).pathname.startsWith('/api/cashbook') && request.method() !== 'GET') writes.push(request.method());
    });
    await page.route('**/api/cashbook', async route => {
      expect(route.request().method()).toBe('GET');
      reads++;
      if (!recovering) {
        await failureGate;
        return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Synthetic read interruption"}' });
      }
      await recoveryGate;
      return route.continue(); // Recover actual owner-scoped fixture summaries.
    });
    await page.goto('/cashbook');
    const main = page.getByRole('main');
    const heading = main.getByRole('heading', { name: 'Kassenbuch', exact: true });
    const create = main.getByRole('button', { name: 'Neue Kasse', exact: true });
    const load = main.getByRole('region', { name: 'Kassenbuch laden', exact: true });
    await expect(heading).toBeVisible();
    await expect(load).toHaveAttribute('aria-busy', 'true');
    await expect(load.getByRole('status')).toHaveText('Kassenbuch wird geladen…');
    await expect(create).toBeDisabled();
    await expect(main.getByText('Kein Kassenbuch vorhanden', { exact: true })).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Kassenbuch erstellen', exact: true })).toHaveCount(0);
    const headingPosition = await heading.boundingBox();
    const createPosition = await create.boundingBox();
    async function expectStablePendingFrame() {
      for (const [locator, previous] of [[heading, headingPosition], [create, createPosition]] as const) {
        await expect(locator).toBeVisible();
        const current = await locator.boundingBox();
        expect(current).not.toBeNull(); expect(previous).not.toBeNull();
        expect(Math.abs(current!.x - previous!.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(current!.y - previous!.y)).toBeLessThanOrEqual(1);
      }
      expect(await main.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await create.evaluate(button => (button as HTMLButtonElement).click());
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => reads).toBe(1);
    releaseFailure();
    await expect(load.getByRole('alert')).toHaveText('Die Kassenbücher konnten nicht geladen werden.');
    await expect(load).toHaveAttribute('aria-busy', 'false');
    await expect(create).toBeDisabled();
    await expect(main.getByRole('combobox', { name: 'Aktive Kasse', exact: true })).toHaveCount(0);
    await expect(main.getByText('Kein Kassenbuch vorhanden', { exact: true })).toHaveCount(0);
    await expectStablePendingFrame();
    recovering = true;
    const retry = load.getByRole('button', { name: 'Erneut versuchen', exact: true });
    await retry.focus(); await expect(retry).toBeFocused(); await retry.press('Enter');
    await expect(load).toHaveAttribute('aria-busy', 'true');
    await expect(load.getByRole('status')).toBeVisible();
    await expect(load.getByRole('button', { name: 'Erneut versuchen', exact: true })).toHaveCount(0);
    await expect(create).toBeDisabled();
    await expect.poll(() => reads).toBe(2);
    await expectStablePendingFrame();
    releaseRecovery();
    await expect(main.getByRole('combobox', { name: 'Aktive Kasse', exact: true })).toHaveText(book!.name);
    await expect(main.getByRole('region', { name: 'Kassenübersicht', exact: true })).toContainText('37,50');
    await expect(create).toBeEnabled();
    await expect(main.getByRole('alert')).toHaveCount(0);
    expect(await main.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`cashbook-read-recovery-${width}.png`), fullPage: true });
    await page.reload();
    await expect(heading).toBeVisible();
    await expect(main.getByRole('combobox', { name: 'Aktive Kasse', exact: true })).toHaveText(book!.name);
    expect(reads).toBe(3);
    expect(writes).toEqual([]);
    expect(await prisma.cashBook.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.cashTransaction.count({ where: { userId: user.id } })).toBe(0);
  });
}

test('cashbook offers empty creation only after a successful empty owner read', async ({ page }) => {
  const { user } = await signIn(page, false);
  await page.goto('/cashbook');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Kassenbuch', exact: true })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Kein Kassenbuch vorhanden', exact: true })).toBeVisible();
  await main.getByRole('button', { name: 'Kassenbuch erstellen', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Neues Kassenbuch erstellen', exact: true })).toBeVisible();
  expect(await prisma.cashBook.count({ where: { userId: user.id } })).toBe(0);
});

test('cashbook never turns denied or malformed successful deliveries into empty creation or false balances', async ({ page }) => {
  const { user, book } = await signIn(page);
  const realSummary = { ...book!, currentBalance: book!.initialBalance, transactionCount: 0 };
  const failures = [
    { status: 401, body: '{}' }, { status: 403, body: '{}' },
    { status: 200, body: '{' }, { status: 200, body: 'null' },
    { status: 200, body: '{"cashBooks":[]}' },
    { status: 200, body: JSON.stringify([{ ...realSummary, currentBalance: '37.50' }]) },
    { status: 200, body: JSON.stringify([realSummary, realSummary]) },
  ];
  let reads = 0;
  await page.route('**/api/cashbook', route => {
    expect(route.request().method()).toBe('GET');
    const failure = failures[reads++];
    return failure ? route.fulfill({ ...failure, contentType: 'application/json' }) : route.continue();
  });
  await page.goto('/cashbook');
  const main = page.getByRole('main');
  for (let index = 0; index < failures.length; index++) {
    await expect(main.getByRole('alert')).toHaveText('Die Kassenbücher konnten nicht geladen werden.');
    await expect(main.getByRole('heading', { name: 'Kassenbuch', exact: true })).toBeVisible();
    await expect(main.getByText('Kein Kassenbuch vorhanden', { exact: true })).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Kassenbuch erstellen', exact: true })).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Neue Kasse', exact: true })).toBeDisabled();
    await expect(main.getByRole('region', { name: 'Kassenübersicht', exact: true })).toHaveCount(0);
    await expect.poll(() => reads).toBe(index + 1);
    await main.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
  }
  await expect(main.getByRole('combobox', { name: 'Aktive Kasse', exact: true })).toHaveText(book!.name);
  await expect(main.getByRole('region', { name: 'Kassenübersicht', exact: true })).toContainText('37,50');
  expect(reads).toBe(failures.length + 1);
  expect(await prisma.cashBook.count({ where: { userId: user.id } })).toBe(1);
  expect(await prisma.cashTransaction.count({ where: { userId: user.id } })).toBe(0);
});
