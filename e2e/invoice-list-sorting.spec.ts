import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../lib/password';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

test('invoice list sorts the complete ledger, continues palette sorting and explains denied deletion', async ({ page }, testInfo) => {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  const password = 'SyntheticSortPass123!';
  const prefix = `SYN-SORT-${randomUUID().slice(0, 8)}`;
  const user = await prisma.user.create({ data: { email: `sort-${randomUUID()}@example.test`, name: 'Synthetic sorting account', password: await hashPassword(password), role: 'USER' } });
  try {
    for (let index = 1; index <= 12; index++) {
      await prisma.invoice.create({ data: { userId: user.id, invoiceNumber: `${prefix}-${index}`, fileName: 'synthetic-unopened.pdf', storedFileName: 'synthetic-unopened.pdf', issuanceState: 'UNISSUED', status: 'DRAFT', totalAmount: 13 - index, parsedData: { currency: 'EUR' }, uploadedAt: new Date(Date.UTC(2026, 4, index)), invoiceDate: new Date(Date.UTC(2026, 0, index)) } });
    }
    await isolateSyntheticLoginIpBudget();
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(user.email);
    await page.getByLabel('Passwort', { exact: true }).fill(password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    const before = await prisma.invoice.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } });
    await page.goto('/dashboard?tab=invoices');
    const workspace = page.locator('.invoice-workspace');
    const table = workspace.getByRole('table');
    const numbers = table.locator('button[data-invoice-return]');
    const numberList = (indices: number[]) => indices.map(index => `${prefix}-${index}`);
    await expect(numbers).toHaveText(numberList([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]));

    await table.getByRole('button', { name: 'Betrag', exact: true }).click();
    await expect(numbers).toHaveText(numberList([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    await workspace.getByRole('button', { name: 'Weiter', exact: true }).click();
    await expect(numbers).toHaveText(numberList([11, 12]));
    await table.getByRole('button', { name: 'Betrag', exact: true }).click();
    await expect(numbers).toHaveText(numberList([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]));
    await expect(workspace.getByText('1–10 von 12 Rechnungen · Seite 1 von 2', { exact: true })).toBeVisible();
    await table.getByRole('button', { name: 'Datum', exact: true }).click();
    await table.getByRole('button', { name: 'Datum', exact: true }).click();
    await expect(numbers).toHaveText(numberList([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    await table.getByRole('button', { name: 'Rechnung', exact: true }).click();
    await table.getByRole('button', { name: 'Rechnung', exact: true }).click();
    await expect(numbers).toHaveText(numberList([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));

    await page.getByRole('button', { name: 'Befehlspalette öffnen', exact: true }).filter({ visible: true }).first().click();
    const palette = page.getByRole('dialog', { name: 'Befehlspalette', exact: true });
    await palette.getByRole('combobox').fill(prefix);
    await palette.getByRole('option', { name: 'Passende Liste öffnen · Ausgangsbelege', exact: true }).click();
    await expect(palette).toBeHidden();
    await expect(page.getByRole('region', { name: 'Suchfilter · Ausgangsbelege', exact: true })).toBeVisible();
    await expect(numbers).toHaveText(numberList([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    await table.getByRole('button', { name: 'Betrag', exact: true }).click();
    await expect(numbers).toHaveText(numberList([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    await workspace.getByRole('button', { name: 'Weiter', exact: true }).click();
    await expect(numbers).toHaveText(numberList([11, 12]));
    await table.getByRole('button', { name: 'Betrag', exact: true }).click();
    await expect(numbers).toHaveText(numberList([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]));

    const reason = 'Synthetische serverseitige Löschsperre.';
    let denied = 0;
    await page.route('**/api/invoices?id=*', async route => {
      if (route.request().method() !== 'DELETE') return route.continue();
      denied++;
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: reason }) });
    });
    const first = table.getByRole('row').filter({ hasText: `${prefix}-12` });
    await first.getByRole('button', { name: /Weitere Aktionen/ }).click();
    await page.getByRole('menuitem', { name: 'Rechnung löschen', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Rechnung löschen', exact: true });
    await confirmation.getByRole('button', { name: 'Löschen', exact: true }).click();
    await expect(page.getByText(reason, { exact: true })).toBeVisible();
    await expect(confirmation).toBeVisible();
    expect(denied).toBe(1);
    await confirmation.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    expect(await prisma.invoice.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } })).toEqual(before);
    await page.screenshot({ path: testInfo.outputPath('invoice-list-sorting-desktop.png'), fullPage: true });
  } finally {
    await prisma.$disconnect();
  }
});
