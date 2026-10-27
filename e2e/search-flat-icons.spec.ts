import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// One presentation-only journey for the standard fresh, hosted fixture. Search
// responses are synthetic: this is not backend, tenant or finance acceptance.
test('search shares flat navigation icons while labels keyboard and close remain intact', async ({ page }, info) => {
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticSearchIcons228!';
  const user = await prisma.user.create({ data: { email: `search-icons-${randomUUID()}@example.test`, name: 'Synthetic search icons', password: await hashPassword(password), role: 'USER' } });
  const records = [
    { type: 'customer', label: 'SYN-ICON Kunde', href: '/customers?customer=1', icon: 'nav-customers' },
    { type: 'outbound', label: 'SYN-ICON Rechnung', href: '/dashboard?tab=invoices&document=1', icon: 'nav-invoices' },
    { type: 'inbound', label: 'SYN-ICON Eingang', href: '/purchases?document=1', icon: 'nav-expenses' },
  ];
  const unexpectedWrites: string[] = [];
  try {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(user.email);
    await page.getByLabel('Passwort', { exact: true }).fill(password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && pathname !== '/api/record-search') unexpectedWrites.push(`${request.method()} ${pathname}`);
    });
    await page.route('**/api/record-search', route => route.fulfill({ json: { groups: records.map(record => ({
      type: record.type, page: 0, hasMore: false,
      items: route.request().postDataJSON().query === 'SYN-ICON' ? [{ type: record.type, id: 1, label: record.label, href: record.href }] : [],
    })) } }));

    for (const width of [1440, 360, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.mouse.move(0, 0);
      const trigger = page.getByRole('button', { name: 'Befehlspalette öffnen', exact: true }).filter({ visible: true }).first();
      await expect(trigger).toBeVisible(); await trigger.focus();
      await page.keyboard.press('Control+k');
      const dialog = page.getByRole('dialog', { name: 'Befehlspalette', exact: true });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('option', { name: width === 360 ? 'Dunkles Design' : 'Helles Design', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${width === 360 ? 'dark' : 'light'}\\b`));
      await trigger.focus(); await page.keyboard.press('Control+k');
      const input = dialog.getByRole('combobox', { name: 'Aktionen und Datensätze suchen' });
      await expect(input).toBeFocused(); await expect(input).toHaveValue('');
      await expect(dialog.locator('[data-bivaro-sidebar-icon]')).toHaveCount(15);
      await expect(dialog.locator('img[data-bivaro-icon]')).toHaveCount(0);
      await expect(dialog.getByRole('option', { name: 'Dashboard öffnen', exact: true })).toHaveAccessibleName('Dashboard öffnen');
      const masks = await dialog.locator('[data-bivaro-sidebar-icon]').evaluateAll(icons => icons.map(icon => {
        const style = getComputedStyle(icon), box = icon.getBoundingClientRect();
        return { name: icon.getAttribute('data-bivaro-sidebar-icon'), hidden: icon.getAttribute('aria-hidden'), mask: style.maskImage, ink: style.backgroundColor, color: style.color, width: box.width, height: box.height };
      }));
      for (const mask of masks) {
        expect(mask.hidden).toBe('true'); expect(mask.mask).toContain(`/brand/icons/sidebar-flat/${mask.name}.webp`);
        expect(mask.ink).toBe(mask.color); expect([mask.width, mask.height]).toEqual([26, 26]);
      }
      await page.screenshot({ path: info.outputPath(`search-actions-${width}.png`) });
      await input.fill('SYN-ICON');
      for (const record of records) {
        const option = dialog.getByRole('option', { name: record.label, exact: true });
        await expect(option).toHaveAccessibleName(record.label);
        await expect(option.locator(`[data-bivaro-sidebar-icon="${record.icon}"]`)).toHaveAttribute('aria-hidden', 'true');
      }
      await expect(dialog.locator('img[data-bivaro-icon]')).toHaveCount(0);
      await page.mouse.move(0, 0); await input.press('Home');
      const first = dialog.getByRole('option', { name: records[0].label, exact: true });
      await expect(first).toHaveAttribute('aria-selected', 'true');
      await expect(input).toHaveAttribute('aria-activedescendant', (await first.getAttribute('id'))!);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`search-records-${width}.png`) });
      await input.press('Escape'); await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
    }
    // The navigation command keeps its real keyboard action and destination.
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Befehlspalette', exact: true });
    const input = dialog.getByRole('combobox');
    await input.fill('Kunden'); await expect(dialog.getByRole('option', { name: 'Kunden', exact: true })).toBeVisible();
    await input.press('Home'); await input.press('Enter');
    await expect(page).toHaveURL(/\/customers$/); await expect(dialog).toBeHidden();
    expect(unexpectedWrites).toEqual([]);
  } finally {
    await page.unroute('**/api/record-search');
    await prisma.user.delete({ where: { id: user.id } });
  }
});
