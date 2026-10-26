import { expect, test, type Page, type Request, type Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { bankAllocationAccount } from './helpers/bank-allocations';

// Authored for the existing GitHub-hosted Browser acceptance workflow only.
// Its supported runner owns a fresh temporary database. This is NOT a deployed
// tenant/Sites test. No new workflow, original file, issuance or money is needed.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
type Outcome = { error?: unknown };
async function successful(promise: Promise<Outcome>) {
  const outcome = await promise;
  if ('error' in outcome) throw outcome.error;
}
function delayed(number: string, exists: boolean) {
  return { number, exists, claimed: false, held: deferred<Outcome>(), release: deferred<void>(), done: deferred<Outcome>() };
}
async function financialSnapshot(userId: string) {
  const where = { userId };
  return {
    invoices: await prisma.invoice.findMany({ where, orderBy: { id: 'asc' } }),
    counters: await prisma.invoiceNumberCounter.findMany({ where, orderBy: [{ type: 'asc' }, { year: 'asc' }] }),
    incomes: await prisma.income.findMany({ where, orderBy: { id: 'asc' } }),
    expenses: await prisma.expense.findMany({ where, orderBy: { id: 'asc' } }),
    payments: await prisma.paymentJournalEvent.findMany({ where, orderBy: { id: 'asc' } }),
    operations: await prisma.paymentOperation.findMany({ where, orderBy: { id: 'asc' } }),
    adjustments: await prisma.paymentAdjustment.findMany({ where, orderBy: { id: 'asc' } }),
    cash: await prisma.cashTransaction.findMany({ where, orderBy: { id: 'asc' } }),
    outbox: await prisma.emailOutbox.findMany({ where, orderBy: { id: 'asc' } }),
    reminders: await prisma.reminder.findMany({ where, orderBy: { id: 'asc' } }),
  };
}
async function authenticatedSession(page: Page, userId: string) {
  const response = await page.request.get('/api/auth/session');
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ user: { id: userId, role: 'USER', sessionVersion: 1 } });
}
async function painted(page: Page) {
  // A normal rendering boundary after the exact request's terminal event, not
  // a direct witness of JSON-handler consumption (the mock contract covers it).
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test('a superseded real duplicate-number read leaves the current number and its checking eligibility intact', async ({ page }) => {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const loggedIn = page.waitForResponse(async response => {
    if (response.request().method() !== 'GET' || new URL(response.url()).pathname !== '/api/auth/session' || response.status() !== 200) return false;
    const session = await response.json();
    return typeof session?.user?.id === 'string' && session.user.role === 'USER' && session.user.sessionVersion === 1;
  });
  // Existing helper creates only synthetic identity/profile/customer data and
  // uses real cookie login; its invoice issuance helpers are never called.
  const owner = await bankAllocationAccount(page);
  const loginResponse = await loggedIn;
  expect(await loginResponse.finished()).toBeNull();
  expect(await loginResponse.json()).toMatchObject({ user: { id: owner.userId, role: 'USER', sessionVersion: 1 } });
  await authenticatedSession(page, owner.userId);

  const suffix = randomUUID(), a = delayed(`SYNTHETIC-NUMBER-A-${suffix}`, true), b = delayed(`SYNTHETIC-NUMBER-B-${suffix}`, false);
  // One fixture-only metadata row makes the real owner-bound GET return true.
  // It is explicitly unissued, has no original bytes and establishes no valid
  // invoice/payment success. No financial create/upload API or UI is exercised.
  await prisma.invoice.create({ data: {
    userId: owner.userId, customerId: owner.customerId, type: 'INVOICE',
    invoiceNumber: a.number, status: 'DRAFT', issuanceState: 'UNISSUED',
    fileName: 'synthetic-number-metadata-only.xml', storedFileName: `synthetic-no-original-${suffix}.xml`,
    parsedData: { fixtureKind: 'number-existence-metadata-only' },
  } });
  const before = await financialSnapshot(owner.userId), writes: string[] = [];
  const handler = async (route: Route) => {
    const request = route.request(), url = new URL(request.url());
    // During the editor journey every UI non-read is blocked and counted,
    // including non-API/server actions and auth diagnostics. No exception.
    if (!['GET', 'HEAD'].includes(request.method())) {
      writes.push(`${request.method()} ${url.pathname}`);
      await route.abort('blockedbyclient'); return;
    }
    const plan = url.pathname === '/api/invoices/check-number'
      ? [a, b].find(candidate => url.searchParams.get('number') === candidate.number) : undefined;
    if (!plan) { await route.continue(); return; }
    expect(plan.claimed).toBe(false); plan.claimed = true;
    const terminal = deferred<ReturnType<Request['failure']>>();
    const finished = (ended: Request) => { if (ended === request) terminal.resolve(null); };
    const failed = (ended: Request) => { if (ended === request) terminal.resolve(ended.failure() ?? { errorText: 'Missing failure reason' }); };
    page.on('requestfinished', finished); page.on('requestfailed', failed);
    if (request.failure()) failed(request);
    try {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ exists: plan.exists });
      plan.held.resolve({}); await plan.release.promise;
      // Preserve the actual body/status/headers. Fulfill errors always fail;
      // cancellation is accepted only from this exact request's terminal event.
      await route.fulfill({ response });
      const failure = await terminal.promise;
      if (failure) { expect(plan.number).toBe(a.number); expect(failure.errorText).toBe('net::ERR_ABORTED'); }
      plan.done.resolve({});
    } catch (error) {
      plan.held.resolve({ error }); plan.done.resolve({ error }); throw error;
    } finally { page.off('requestfinished', finished); page.off('requestfailed', failed); }
  };
  await page.route('**/*', handler);
  const failures = new Set<unknown>();
  try {
    const editorSession = page.waitForResponse(response => response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/api/auth/session');
    const nextNumber = page.waitForResponse(response => response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/api/invoices/next-number');
    await page.goto('/dashboard/invoices/new');
    const sessionResponse = await editorSession;
    expect(sessionResponse.status()).toBe(200); expect(await sessionResponse.finished()).toBeNull();
    expect(await sessionResponse.json()).toMatchObject({ user: { id: owner.userId, role: 'USER', sessionVersion: 1 } });
    expect((await nextNumber).status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Neue Rechnung', exact: true })).toBeVisible();
    await page.getByLabel('Gespeicherten Kunden auswählen', { exact: true }).selectOption(String(owner.customerId));
    await page.locator('#date').fill('2026-10-22');
    await page.locator('#invoice-item-description-0').fill('SYNTHETIC · number-check-only draft');
    await page.locator('#invoice-item-price-0').fill('12.34');
    await expect(page.getByLabel('Umsatzsteuer', { exact: true })).toHaveValue('small-business');
    const number = page.locator('#invoice-number'), create = page.getByRole('button', { name: 'PDF erstellen', exact: true });
    await expect(create).toBeEnabled();

    await number.fill(a.number); await successful(a.held.promise);
    await expect(create).toBeDisabled();
    await number.fill(b.number); await successful(b.held.promise);
    await expect(number).toHaveValue(b.number);
    await expect(number).toHaveAttribute('aria-invalid', 'false');
    await expect(page.locator('#invoice-number-error')).toHaveCount(0);
    await expect(create).toBeDisabled(); // B is genuinely still checking.
    b.release.resolve(); await successful(b.done.promise); await painted(page);
    await expect(create).toBeEnabled(); // Current B's genuine GET returned false.

    a.release.resolve(); await successful(a.done.promise); await painted(page);
    await expect(number).toHaveValue(b.number);
    await expect(number).toHaveAttribute('aria-invalid', 'false');
    await expect(page.locator('#invoice-number-error')).toHaveCount(0);
    await expect(create).toBeEnabled();
    await expect(page.getByLabel('Umsatzsteuer', { exact: true })).toHaveValue('small-business');
    await authenticatedSession(page, owner.userId);
    expect(writes).toEqual([]);
    expect(await financialSnapshot(owner.userId)).toEqual(before);
  } catch (error) {
    failures.add(error);
  } finally {
    a.release.resolve(); b.release.resolve();
    try {
      const outcomes = await Promise.all([a, b].filter(plan => plan.claimed).map(plan => plan.done.promise));
      for (const outcome of outcomes) if ('error' in outcome) failures.add(outcome.error);
    } catch (error) {
      failures.add(error);
    } finally {
      try { await page.unroute('**/*', handler); }
      catch (error) { failures.add(error); }
    }
  }
  // The same route error may reach both journey and cleanup. Preserve identity
  // once, but never let a distinct cleanup failure replace the original error.
  if (failures.size > 1) throw new AggregateError([...failures], 'Multiple invoice-number journey/cleanup failures');
  if (failures.size === 1) throw failures.values().next().value;
});
