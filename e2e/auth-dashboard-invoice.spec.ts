import { expect, test } from '@playwright/test';

const testUser = {
  name: 'E2E Admin',
  email: `e2e-${Date.now()}@example.test`,
  password: 'SecurePass123',
};

test.describe.serial('auth, dashboard and invoice flow', () => {
  test('registers the first admin user and opens the dashboard', async ({ page }) => {
    await page.goto('/register');

    await page.getByLabel('Name').fill(testUser.name);
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByLabel('Passwort bestätigen').fill(testUser.password);
    await page.getByRole('button', { name: 'Admin-Konto erstellen' }).click();

    await expect(page).toHaveURL(/\/login/);

    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('tab', { name: 'Ausgaben' })).toBeVisible();
  });

  test('opens the invoice creation flow from the dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(testUser.email);
    await page.getByLabel('Passwort', { exact: true }).fill(testUser.password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await page.getByRole('tab', { name: 'Rechnungen' }).click();
    await page.getByRole('button', { name: 'Rechnung erstellen' }).click();

    await expect(page.getByRole('dialog', { name: 'Rechnung erstellen' })).toBeVisible();
  });
});
