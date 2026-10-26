import { expect, test, type Locator, type Page, type Response } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// Authored for authorized hosted execution only. Use the standard fresh runner
// fixture; real authentication, synthetic read responses, no financial writes.
const term = 'SYNTHETISCH-Büro';
const categories = [`${term}artikel`, `${term}miete`];
type AuthOwner = { id: string; role: string; sessionVersion: number };
type AuthDiagnostic = { level: string; code: string; errorName: string };
const diagnosticToken = (value: unknown) => typeof value === 'string' && /^[A-Za-z_][A-Za-z_0-9]{0,63}$/.test(value) ? value : 'Unknown';

async function ownerSession(response: Response, owner: AuthOwner) {
  expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
  const session = await response.json();
  expect({ id: session.user?.id, role: session.user?.role, sessionVersion: session.user?.sessionVersion }).toEqual(owner);
}

function observeOwnerAuth(page: Page, owner: AuthOwner, diagnostics: AuthDiagnostic[], record: (diagnostic: AuthDiagnostic) => void) {
  const pending = new Set<Promise<void>>();
  const observe = (check: Promise<void>) => {
    const tracked = check.catch(error => record({ level: 'error', code: 'SESSION_OBSERVATION_FAILED', errorName: diagnosticToken(error?.name) }));
    pending.add(tracked); void tracked.then(() => pending.delete(tracked));
  };
  page.on('request', request => {
    if (request.method() !== 'GET' || new URL(request.url()).pathname !== '/api/auth/session') return;
    observe((async () => {
      const response = await request.response();
      if (!response) {
        record({ level: 'error', code: 'SESSION_REQUEST_FAILED', errorName: request.failure()?.errorText === 'net::ERR_ABORTED' ? 'AbortError' : 'NetworkError' });
        return;
      }
      await ownerSession(response, owner);
    })());
  });
  page.on('console', message => {
    const match = /^\[next-auth\]\[(error|warn|debug)\]\[([A-Z_0-9]{1,64})\]/.exec(message.text());
    if (!match) return;
    observe((async () => {
      const metadata = await message.args()[3]?.jsonValue();
      record({ level: match[1], code: match[2], errorName: diagnosticToken(metadata?.error?.name ?? metadata?.name) });
    })());
  });
  const settle = async () => {
    // Exact observed requests, including full bodies, must finish before another
    // navigation. Unknown auth errors remain failures, never harmless telemetry.
    await expect.poll(() => pending.size, { message: 'Observed real owner sessions must finish before navigation' }).toBe(0);
    expect(diagnostics, 'Unexpected authentication diagnostics (bounded fields only)').toEqual([]);
  };
  const healthy = async () => {
    const session = await page.evaluate(async () => {
      const response = await fetch('/api/auth/session', { cache: 'no-store' });
      const body = await response.json();
      return { status: response.status, id: body.user?.id, role: body.user?.role, sessionVersion: body.user?.sessionVersion };
    });
    expect(session).toEqual({ status: 200, ...owner }); await settle();
  };
  return { settle, healthy };
}

async function controlledListbox(page: Page, input: Locator) {
  const listId = await input.getAttribute('aria-controls');
  expect(listId).toBeTruthy();
  const list = page.locator(`[id=${JSON.stringify(listId)}]`);
  await expect(list).toHaveAttribute('role', 'listbox');
  await expect(list).toHaveAccessibleName('Vorschläge');
  await expect(list).toHaveAttribute('id', listId!);
  return list;
}

async function activeOption(page: Page, input: Locator, label: string) {
  const list = await controlledListbox(page, input);
  const option = list.getByRole('option', { name: label, exact: true });
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await expect(input).toHaveAttribute('aria-activedescendant', (await option.getAttribute('id'))!);
  await expect(input).toBeFocused();
}

async function choices(page: Page, input: Locator) {
  await expect(input).toHaveAttribute('role', 'combobox');
  await expect(input).toHaveAttribute('aria-autocomplete', 'list');
  await input.fill(term);
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await expect((await controlledListbox(page, input)).getByRole('option')).toHaveCount(3);
  await input.press('ArrowDown');
  await activeOption(page, input, categories[0]);
  await input.press('ArrowDown');
  await activeOption(page, input, categories[1]);
  await input.press('ArrowDown');
  await activeOption(page, input, `„${term}" erstellen`);
  await input.press('ArrowDown');
  await activeOption(page, input, categories[0]);
  await input.press('ArrowUp');
  await activeOption(page, input, `„${term}" erstellen`);
  await input.press('Enter');
  await expect(input).toHaveValue(term);
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await expect(input).not.toHaveAttribute('aria-activedescendant');
  await expect(page.getByRole('listbox')).toHaveCount(0);
}

async function sessionSettledDocument(page: Page, destination: '/login' | '/dashboard', navigate: () => Promise<unknown>, auth?: ReturnType<typeof observeOwnerAuth>) {
  // A new document mounts SessionProvider. Finish its real session fetch before
  // the fixture navigates again, rather than manufacturing an aborted auth read.
  await auth?.settle();
  const session = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/auth/session'
    && new URL(page.url()).pathname === destination);
  await navigate();
  const response = await session;
  expect(response.status()).toBe(200);
  expect(await response.finished()).toBeNull();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await auth?.settle();
  return response;
}

test('category combobox exposes actual keyboard and pointer choices in entry/edit/recurring dialogs', async ({ page }) => {
  test.setTimeout(90_000);
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticCombobox155!';
  const user = await prisma.user.create({ data: {
    email: `combobox-${randomUUID()}@example.test`, name: 'Synthetic combobox accessibility',
    password: await hashPassword(password), role: 'USER',
  } });
  const unexpectedWrites: string[] = [];
  const authDiagnostics: AuthDiagnostic[] = [];
  const recordAuthDiagnostic = (diagnostic: AuthDiagnostic) => {
    if (authDiagnostics.length < 32) authDiagnostics.push(diagnostic);
    else if (authDiagnostics.length === 32) authDiagnostics.push({ level: 'error', code: 'AUTH_DIAGNOSTIC_OVERFLOW', errorName: 'Unknown' });
  };
  page.on('request', request => {
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/auth/_log') return;
    const body = request.postDataBuffer();
    const diagnostic = new URLSearchParams(body && body.length <= 16 * 1024 ? body.toString('utf8') : '');
    // Retain only bounded diagnostic identifiers, never session/URL/stack data.
    recordAuthDiagnostic({ level: diagnosticToken(diagnostic.get('level')), code: diagnosticToken(diagnostic.get('code')),
      errorName: diagnosticToken(diagnostic.get('name')) });
  });
  try {
    await sessionSettledDocument(page, '/login', () => page.goto('/login'));
    await page.getByLabel('E-Mail').fill(user.email);
    await page.getByLabel('Passwort', { exact: true }).fill(password);
    const owner = { id: user.id, role: user.role, sessionVersion: user.sessionVersion };
    await ownerSession(await sessionSettledDocument(page, '/dashboard',
      () => page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click()), owner);
    await expect(page).toHaveURL(/\/dashboard/);
    const auth = observeOwnerAuth(page, owner, authDiagnostics, recordAuthDiagnostic);

    await page.route('**/api/**', async route => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
      unexpectedWrites.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      await route.abort('blockedbyclient');
    });
    await auth.healthy();
    let currentCategories = categories;
    await page.route('**/api/dashboard/filter-options', route => route.fulfill({ json: { categories: currentCategories, customers: [] } }));
    const expense = { id: 955001, description: 'SYNTHETISCHE Combobox-Ausgabe', amount: 12,
      date: '2026-10-01', category: categories[0], taxRelevant: true, taxDeductiblePercentage: 100,
      manualRecordState: 'RECORDED' };
    await page.route('**/api/expenses?**', route => route.fulfill({ json: { items: [expense], total: 1, page: 1, pageSize: 10 } }));
    await page.route('**/api/recurring-expenses', route => route.fulfill({ json: [] }));
    await page.route('**/api/recurring-expenses/execute', route => route.fulfill({ json: { count: 0, items: [] } }));

    await sessionSettledDocument(page, '/dashboard', () => page.goto('/dashboard?tab=expenses&new=1'), auth);
    const entry = page.locator('#expense-entry');
    await expect(entry).toBeVisible();
    const input = entry.getByRole('combobox', { name: 'Kategorie', exact: true });
    await choices(page, input);
    await input.press('ArrowDown');
    await activeOption(page, input, categories[0]);
    currentCategories = [`${term}anpassung`, ...categories, categories[0]];
    const refreshCategories = async () => {
      const [response] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === '/api/dashboard/filter-options'),
        // Exercise the actual cross-tab read-invalidation bridge, not component
        // state injection or a financial mutation. All resulting reads remain synthetic.
        page.evaluate(() => {
          const channel = new BroadcastChannel('bivaro:payment-refresh:v2');
          channel.postMessage('bivaro:payment-dashboard-refresh');
          channel.close();
        }),
      ]);
      expect(response.status()).toBe(200);
      expect(await response.finished()).toBeNull();
    };
    await refreshCategories();
    const updatedList = await controlledListbox(page, input);
    await expect(updatedList.getByRole('option', { name: `${term}anpassung`, exact: true })).toBeVisible();
    await expect(updatedList.getByRole('option')).toHaveCount(4);
    await expect(input).not.toHaveAttribute('aria-activedescendant');
    await input.press('Enter');
    await expect(input).toHaveValue(term);
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    currentCategories = categories;
    await refreshCategories();
    const toggle = entry.getByRole('button', { name: 'Vorschläge anzeigen', exact: true });
    await toggle.click();
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await input.press('ArrowUp');
    await activeOption(page, input, `„${term}" erstellen`);
    await input.press('Escape');
    await expect(input).toHaveValue(term);
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await input.fill('  SYNTHETISCH-Tab  ');
    await input.press('Tab');
    await expect(input).toHaveValue('  SYNTHETISCH-Tab  ');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await expect(input).not.toBeFocused();
    await input.fill(term);
    await (await controlledListbox(page, input)).getByRole('option', { name: categories[0], exact: true }).click();
    await expect(input).toHaveValue(categories[0]);
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await input.fill('  SYNTHETISCH-Außenklick  ');
    await entry.getByLabel('Beschreibung', { exact: true }).click();
    await expect(input).toHaveValue('  SYNTHETISCH-Außenklick  ');
    await expect(input).toHaveAttribute('aria-expanded', 'false');

    await entry.getByRole('button', { name: 'Wiederkehrende Ausgaben', exact: true }).click();
    const recurring = page.getByRole('dialog', { name: 'Wiederkehrende Ausgaben', exact: true });
    await expect(recurring).toBeVisible();
    await recurring.getByRole('button', { name: 'Neue wiederkehrende Ausgabe', exact: true }).click();
    const recurringInput = recurring.getByRole('combobox', { name: 'Kategorie', exact: true });
    await choices(page, recurringInput);
    await recurringInput.press('ArrowDown');
    await recurringInput.press('Escape');
    await expect(recurring).toBeVisible();
    await expect(recurringInput).toBeFocused();
    await expect(recurringInput).toHaveAttribute('aria-expanded', 'false');
    await recurringInput.press('Escape');
    await expect(recurring).toHaveCount(0);

    await page.getByRole('button', { name: `${expense.description} bearbeiten`, exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Ausgabe bearbeiten', exact: true });
    await choices(page, edit.getByRole('combobox', { name: 'Kategorie (EÜR-optimiert)', exact: true }));
    await edit.getByRole('button', { name: 'Abbrechen', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(edit).toHaveCount(0);
    await auth.healthy();
    expect(unexpectedWrites).toEqual([]);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});
