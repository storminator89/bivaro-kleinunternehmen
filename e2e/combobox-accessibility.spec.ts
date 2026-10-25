import { expect, test, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// Authored for authorized hosted execution only. Use the standard fresh runner
// fixture; real authentication, synthetic read responses, no financial writes.
const term = 'SYNTHETISCH-Büro';
const categories = [`${term}artikel`, `${term}miete`];

async function activeOption(page: Page, input: Locator, label: string) {
  const listId = await input.getAttribute('aria-controls');
  expect(listId).toBeTruthy();
  const list = page.getByRole('listbox', { name: 'Vorschläge', exact: true });
  await expect(list).toHaveAttribute('id', listId!);
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
  await expect(page.getByRole('option')).toHaveCount(3);
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
  try {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(user.email);
    await page.getByLabel('Passwort', { exact: true }).fill(password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.route('**/api/**', async route => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
      unexpectedWrites.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      await route.abort('blockedbyclient');
    });
    let currentCategories = categories;
    await page.route('**/api/dashboard/filter-options', route => route.fulfill({ json: { categories: currentCategories, customers: [] } }));
    const expense = { id: 955001, description: 'SYNTHETISCHE Combobox-Ausgabe', amount: 12,
      date: '2026-10-01', category: categories[0], taxRelevant: true, taxDeductiblePercentage: 100,
      manualRecordState: 'RECORDED' };
    await page.route('**/api/expenses?**', route => route.fulfill({ json: { items: [expense], total: 1, page: 1, pageSize: 10 } }));
    await page.route('**/api/recurring-expenses', route => route.fulfill({ json: [] }));
    await page.route('**/api/recurring-expenses/execute', route => route.fulfill({ json: { count: 0, items: [] } }));

    await page.goto('/dashboard?tab=expenses&new=1');
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
    await expect(page.getByRole('option', { name: `${term}anpassung`, exact: true })).toBeVisible();
    await expect(page.getByRole('option')).toHaveCount(4);
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
    await page.getByRole('option', { name: categories[0], exact: true }).click();
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
    expect(unexpectedWrites).toEqual([]);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});
