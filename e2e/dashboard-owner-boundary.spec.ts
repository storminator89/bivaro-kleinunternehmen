import { expect, test, type Page, type Request, type Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../lib/password';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// Authoring only until the authorized hosted runner executes this source.
// Real UI authentication and server-issued cookies; no SessionContext injection,
// original-document reload or manufactured session JSON can hide the boundary.
type Owner = { id: string; role: string; sessionVersion: number };
async function documentSession(page: Page, destination: string, navigate: () => Promise<unknown>, owner?: Owner) {
  const session = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/auth/session'
    && new URL(page.url()).pathname === destination.split('?')[0]);
  await navigate();
  const response = await session;
  expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
  const body = await response.json();
  expect(body.user ? { id: body.user.id, role: body.user.role, sessionVersion: body.user.sessionVersion } : undefined).toEqual(owner);
  // Do not manufacture an auth-fetch abort by navigating the fresh document
  // again before SessionProvider has consumed its exact response.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function signIn(page: Page, owner: Owner & { email: string }, password: string) {
  await isolateSyntheticLoginIpBudget();
  await documentSession(page, '/login', () => page.goto('/login'));
  await page.getByLabel('E-Mail').fill(owner.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await documentSession(page, '/dashboard', () => page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click(),
    { id: owner.id, role: owner.role, sessionVersion: owner.sessionVersion });
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('button', { name: 'Befehlspalette öffnen', exact: true }).filter({ visible: true }).first()).toBeVisible();
}
function holdRead(expectedLabel: string) {
  let release!: () => void, held!: (request: Request) => void, complete!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const arrived = new Promise<Request>(resolve => { held = resolve; });
  const done = new Promise<void>(resolve => { complete = resolve; });
  const state = { retired: false };
  return { release, arrived, done, state, handle: async (route: Route) => {
    try {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      const body = await response.json() as { items: Array<{ description: string }> };
      expect(body.items.map(row => row.description)).toContain(expectedLabel);
      held(route.request());
      await wait;
      if (state.retired) {
        // Only after proving the real browser request was canceled by the old
        // QueryClient may its already-retired interception be disposed.
        await route.abort('aborted').catch(() => {});
      } else await route.fulfill({ response });
    } finally { complete(); }
  } };
}
async function refreshAuthenticatedSession(page: Page) {
  const [response] = await Promise.all([
    page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/auth/session'),
    page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))),
  ]);
  expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
  return response.json() as Promise<{ user: { id: string; role: string; sessionVersion: number } }>;
}

for (const replacement of ['owner', 'sessionVersion'] as const) {
  test(`dashboard ${replacement} replacement clears old drafts/dialog/cache before new reads, same-session refetch does not`, async ({ page, browser }, info) => {
    test.setTimeout(120_000);
    expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
    const password = 'SyntheticOwnerBoundary180!';
    const owner = await prisma.user.create({ data: { email: `dashboard-owner-${randomUUID()}@example.test`, name: 'Synthetic previous dashboard owner', password: await hashPassword(password), role: 'USER' } });
    const foreign = replacement === 'owner' ? await prisma.user.create({ data: { email: `dashboard-next-${randomUUID()}@example.test`, name: 'Synthetic next dashboard owner', password: await hashPassword(password), role: 'USER' } }) : null;
    const kind = replacement === 'owner' ? 'expense' : 'income';
    const resource = kind === 'expense' ? 'expenses' : 'incomes';
    const previousLabel = `SYNTHETIC-PREVIOUS-${randomUUID()}`, nextLabel = `SYNTHETIC-NEXT-${randomUUID()}`;
    const previousDraft = `SYNTHETIC-UNSAVED-${randomUUID()}`;
    let oldRead: ReturnType<typeof holdRead> | undefined, newRead: ReturnType<typeof holdRead> | undefined;
    const siblingContext = await browser.newContext({ baseURL: info.project.use.baseURL });
    try {
      await signIn(page, owner, password);
      const original = await page.request.post(`/api/${resource}`, { data: { description: previousLabel, amount: 12.34, date: '2026-10-01', taxRelevant: true } });
      expect(original.status()).toBe(200);
      const originalFinancialWrites: string[] = [];
      page.on('request', request => {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && ['/api/incomes', '/api/expenses'].includes(new URL(request.url()).pathname)) {
          originalFinancialWrites.push(`${request.method()} ${new URL(request.url()).pathname}`);
        }
      });
      await documentSession(page, `/dashboard?tab=${resource}&new=1`, () => page.goto(`/dashboard?tab=${resource}&new=1`),
        { id: owner.id, role: owner.role, sessionVersion: owner.sessionVersion });
      const entry = page.locator(`#${kind}-entry`);
      await expect(entry).toBeVisible();
      await expect(page).not.toHaveURL(/(?:\?|&)new=1(?:&|$)/);
      await expect(page.getByRole('button', { name: `${previousLabel} bearbeiten`, exact: true })).toBeVisible();
      const draftInput = entry.getByLabel('Beschreibung', { exact: true });
      await draftInput.fill(previousDraft);
      await entry.getByLabel('Betrag (€)', { exact: true }).fill('23.45');
      if (kind === 'expense') await entry.locator('input[type="file"]').setInputFiles({ name: 'synthetic-owner-unsent.png', mimeType: 'image/png', buffer: Buffer.from('synthetic never uploaded') });
      const documentMarker = await page.evaluate(() => {
        const value = crypto.randomUUID();
        (window as Window & { syntheticOwnerBoundaryDocument?: string }).syntheticOwnerBoundaryDocument = value;
        return value;
      });
      const trace: Array<Promise<string | undefined>> = [];
      page.on('response', response => {
        if (response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/auth/session') {
          trace.push(response.json().then((data: { user?: { id?: string } }) => data.user?.id));
        }
      });
      expect((await refreshAuthenticatedSession(page)).user.id).toBe(owner.id);
      await page.waitForLoadState('networkidle');
      await expect(draftInput).toHaveValue(previousDraft);
      if (kind === 'expense') expect(await entry.locator('input[type="file"]').evaluate(element => (element as HTMLInputElement).files?.length)).toBe(1);
      await page.getByRole('button', { name: `${previousLabel} bearbeiten`, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: `${kind === 'expense' ? 'Ausgabe' : 'Einnahme'} bearbeiten`, exact: true });
      await dialog.getByLabel('Beschreibung', { exact: true }).fill(`${previousDraft}-EDIT`);
      expect((await refreshAuthenticatedSession(page)).user.id).toBe(owner.id);
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel('Beschreibung', { exact: true })).toHaveValue(`${previousDraft}-EDIT`);

      const gates: Array<ReturnType<typeof holdRead>> = [];
      // Keep this dispatcher installed while both old/new callbacks are held.
      // Finishing a one-shot route must not disable a newer request's gate.
      await page.route(`**/api/${resource}?**`, async route => {
        const gate = gates.shift();
        if (gate) await gate.handle(route); else await route.continue();
      });
      oldRead = holdRead(previousLabel); gates.push(oldRead);
      await page.evaluate(() => {
        const bridge = new BroadcastChannel('bivaro:payment-refresh:v2');
        bridge.postMessage('bivaro:payment-dashboard-refresh'); bridge.close();
      });
      const oldRequest = await oldRead.arrived;
      const cancelled = page.waitForEvent('requestfailed', { predicate: request => request === oldRequest });
      const sibling = await siblingContext.newPage();
      const nextOwner = foreign ?? await prisma.user.update({ where: { id: owner.id }, data: { sessionVersion: { increment: 1 } } });
      await signIn(sibling, nextOwner, password);
      const issued = await (await sibling.request.get('/api/auth/session')).json() as { user: { id: string; sessionVersion: number } };
      expect(issued.user.id).toBe(nextOwner.id); expect(issued.user.sessionVersion).toBe(nextOwner.sessionVersion);
      const nextRecord = await sibling.request.post(`/api/${resource}`, { data: { description: nextLabel, amount: 56.78, date: '2026-10-02', taxRelevant: true } });
      expect(nextRecord.status()).toBe(200);
      const cookies = (await siblingContext.cookies()).filter(cookie => /^(?:__Secure-)?next-auth\.session-token(?:\.\d+)?$/.test(cookie.name));
      expect(cookies.length).toBeGreaterThan(0);
      newRead = holdRead(nextLabel); gates.push(newRead);
      const unchangedUrl = page.url();
      await page.evaluate(() => {
        const observation = { loadingSeen: false, observer: null as MutationObserver | null };
        observation.observer = new MutationObserver(() => {
          if ([...document.querySelectorAll('[role="status"]')].some(node => node.textContent?.includes('Anwendung wird geladen'))) observation.loadingSeen = true;
        });
        observation.observer.observe(document.body, { childList: true, subtree: true });
        (window as Window & { syntheticOwnerBoundaryObservation?: typeof observation }).syntheticOwnerBoundaryObservation = observation;
      });
      oldRead.state.retired = true;
      await page.context().addCookies(cookies);
      expect((await (await page.request.get('/api/auth/session')).json()).user.id).toBe(nextOwner.id);
      await page.bringToFront();
      const replaced = await refreshAuthenticatedSession(page);
      expect(replaced.user.id).toBe(nextOwner.id); expect(replaced.user.sessionVersion).toBe(nextOwner.sessionVersion);
      await newRead.arrived;
      expect(await page.evaluate(() => {
        const observation = (window as Window & { syntheticOwnerBoundaryObservation?: { loadingSeen: boolean; observer: MutationObserver | null } }).syntheticOwnerBoundaryObservation!;
        observation.observer?.disconnect();
        return observation.loadingSeen;
      })).toBe(false);
      expect((await cancelled).failure()).not.toBeNull();
      await expect(dialog).toHaveCount(0);
      await expect(draftInput).toHaveValue('');
      await expect(entry.getByLabel('Betrag (€)', { exact: true })).toHaveValue('');
      if (kind === 'expense') expect(await entry.locator('input[type="file"]').evaluate(element => (element as HTMLInputElement).files?.length)).toBe(0);
      await expect(page.getByRole('button', { name: `${previousLabel} bearbeiten`, exact: true })).toHaveCount(0);
      await expect(page).toHaveURL(unchangedUrl);
      expect(await page.evaluate(() => (window as Window & { syntheticOwnerBoundaryDocument?: string }).syntheticOwnerBoundaryDocument)).toBe(documentMarker);
      oldRead.release(); await oldRead.done;
      await expect(draftInput).toHaveValue('');
      await expect(page.getByRole('button', { name: `${nextLabel} bearbeiten`, exact: true })).toHaveCount(0);
      newRead.release(); await newRead.done;
      await expect(page.getByRole('button', { name: `${nextLabel} bearbeiten`, exact: true })).toBeVisible();
      if (foreign) await expect(page.locator('body')).not.toContainText(previousLabel);
      await expect(dialog).toHaveCount(0); await expect(page).toHaveURL(unchangedUrl);
      expect((await Promise.all(trace)).every(id => id === owner.id || id === nextOwner.id)).toBe(true);
      const previous = kind === 'expense' ? await prisma.expense.findMany({ where: { userId: owner.id } }) : await prisma.income.findMany({ where: { userId: owner.id } });
      expect(originalFinancialWrites).toEqual([]);
      expect(previous).toHaveLength(foreign ? 1 : 2);
      expect(previous.find(row => row.description === previousLabel)).toMatchObject({ amount: 12.34, manualRecordState: 'RECORDED' });
      expect(previous.some(row => row.description === previousDraft || row.description === `${previousDraft}-EDIT`)).toBe(false);
      if (foreign) {
        const nextRows = await prisma.expense.findMany({ where: { userId: foreign.id } });
        expect(nextRows).toHaveLength(1); expect(nextRows[0]).toMatchObject({ description: nextLabel, amount: 56.78 });
      }
    } finally {
      oldRead?.release(); newRead?.release(); await siblingContext.close();
      if (foreign) await prisma.user.delete({ where: { id: foreign.id } });
      await prisma.user.delete({ where: { id: owner.id } });
    }
  });
}
