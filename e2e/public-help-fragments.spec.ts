import { expect, test } from '@playwright/test';

// Keep these anonymous regressions independent of the serial account/ledger flow.
// First load the fragment, then navigate home through the client-side brand link
// so the help route has the same cached initial-fragment history as the defect.
test('returns from cached first-workflow help through the brand and home CTA to exactly one fragment', async ({ page }, testInfo) => {
  await page.goto('/help#erste-rechnung');
  const origin = new URL(page.url()).origin;
  const expected = `${origin}/help#erste-rechnung`;
  await expect(page).toHaveURL(expected);
  await expect(page.locator('#erste-rechnung-title')).toBeVisible();
  await page.getByRole('link', { name: 'Bivaro Startseite', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/`);
  const workflow = page.getByRole('link', { name: 'Erste Rechnung', exact: true });
  await expect(workflow).toHaveAttribute('href', '/help#erste-rechnung');
  await workflow.click();
  await expect(page).toHaveURL(expected);
  await expect(page.locator('#erste-rechnung')).toBeInViewport();
  await expect(page.locator('#erste-rechnung-title')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('cached-help-first-workflow-exact-fragment.png'), fullPage: true });
});

test('returns from cached offer help through the brand and home footer to exactly one fragment', async ({ page }, testInfo) => {
  await page.goto('/help#angebot');
  const origin = new URL(page.url()).origin;
  const expected = `${origin}/help#angebot`;
  await expect(page).toHaveURL(expected);
  await expect(page.locator('#angebot')).toBeVisible();
  await page.getByRole('link', { name: 'Bivaro Startseite', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/`);
  const offer = page.getByRole('navigation', { name: 'Weitere Informationen', exact: true })
    .getByRole('link', { name: 'Angebot und Quellcode', exact: true });
  await expect(offer).toHaveAttribute('href', '/help#angebot');
  await offer.click();
  await expect(page).toHaveURL(expected);
  await expect(page.locator('#angebot')).toBeInViewport();
  await expect(page.locator('#angebot')).toContainText('Angebot');
  await page.screenshot({ path: testInfo.outputPath('cached-help-footer-offer-exact-fragment.png'), fullPage: true });
});
