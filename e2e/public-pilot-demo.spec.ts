import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { pilotDemo, pilotDemoSteps, createPilotDemoWorksheet } from '../lib/pilot-demo';
import { classifyPublicReadOnlyRequest, publicAuthDiagnosticMetadata } from './helpers/public-read-only';

// Authored only. Run through an explicitly authorized hosted browser workflow;
// do not start a local server, create accounts or submit product data for these cases.
// Passing this text walkthrough cannot certify real invoice/export artifacts.
const test = base.extend<{ publicReadOnly: void }>({
  publicReadOnly: [async ({ page, baseURL }, runFixture) => {
    if (!baseURL) throw new Error('An authorized hosted workflow must supply baseURL.');
    const origin = new URL(baseURL).origin;
    const blocked: { method: string; pathname: string }[] = [];
    const diagnostics: ReturnType<typeof publicAuthDiagnosticMetadata>[] = [];
    let blockedCount = 0;
    await page.route('**/*', async route => {
      const request = route.request();
      const kind = classifyPublicReadOnlyRequest(request.method(), request.url(), origin);
      if (kind === 'read') return route.continue();
      blockedCount += 1;
      if (blocked.length < 10) blocked.push({ method: request.method(), pathname: new URL(request.url()).pathname.slice(0, 160) });
      if (kind === 'auth-diagnostic' && diagnostics.length < 10) diagnostics.push(publicAuthDiagnosticMetadata(request.postData()));
      // Stop all non-read requests before transmission, including auth logs.
      // An attempted auth diagnostic fails acceptance; it is never fake success.
      await route.abort('blockedbyclient');
    });
    try { await runFixture(); }
    finally {
      await page.unrouteAll({ behavior: 'wait' });
      expect({ blockedCount, blocked, diagnostics }).toEqual({ blockedCount: 0, blocked: [], diagnostics: [] });
    }
  }, { auto: true }],
});

async function anonymousHelp(page: Page, baseURL: string | undefined, fragment: string, navigate: () => Promise<unknown>) {
  if (!baseURL) throw new Error('An authorized hosted workflow must supply baseURL.');
  const origin = new URL(baseURL).origin;
  const read = (pathname: string) => page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.origin === origin && url.pathname === pathname && url.search === '';
  });
  const session = read('/api/auth/session');
  const access = read('/api/auth/registration-status');
  await navigate();
  const [sessionResponse, accessResponse] = await Promise.all([session, access]);
  for (const response of [sessionResponse, accessResponse]) {
    expect(response.status()).toBe(200);
    expect(await response.finished()).toBeNull();
  }
  expect(await sessionResponse.json()).toEqual({});
  await expect(page).toHaveURL(`${origin}/help#${fragment}`);
}

async function keyboardFocus(page: Page, target: Locator) {
  await target.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(target).toBeFocused();
  expect(await target.evaluate(node => node.matches(':focus-visible'))).toBe(true);
}

test('anonymous visitor follows the five-step story and retains correction and handoff review limits', async ({ page, baseURL }) => {
  await anonymousHelp(page, baseURL, 'demo', () => page.goto('/help#demo'));
  const demo = page.locator('#demo');
  await expect(demo.getByRole('navigation', { name: 'Schritte im synthetischen Beispiel' }).getByRole('link')).toHaveCount(5);
  for (const [index, step] of pilotDemoSteps.entries()) {
    const section = page.locator(`#${step.id}`);
    await expect(section.getByRole('heading', { name: `${index + 1}. ${step.title}`, exact: true })).toBeVisible();
    if (index < pilotDemoSteps.length - 1) {
      await section.getByRole('link', { name: `Weiter: ${pilotDemoSteps[index + 1].title}`, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`#${pilotDemoSteps[index + 1].id}$`));
    }
  }
  await expect(page.locator('#demo-korrektur')).toContainText('80,00 EUR gültig eingegangen, 220,00 EUR noch offen');
  await expect(page.locator('#demo-korrektur').getByText(pilotDemoSteps[3].caution, { exact: true })).toBeVisible();
  await expect(page.locator('#demo-uebergabe').getByText(pilotDemoSteps[4].caution, { exact: true })).toBeVisible();
  await demo.getByText('Produkt, Konzept und offene Nachweise unterscheiden', { exact: true }).click();
  await expect(demo).toContainText('Nicht zugesagte Varianten bleiben Konzept, kein buchbares Angebot');
  await expect(demo).toContainText('stoppen und fachlich prüfen lassen');
  await demo.getByRole('link', { name: 'Nächster Schritt: Umstieg vorbereiten', exact: true }).click();
  await expect(page).toHaveURL(/\/help#umstieg$/);
  await expect(page.locator('#umstieg').getByRole('combobox')).toHaveCount(6);
});

test('receipt direct link, native Back/Forward, reload and public explanatory download keep the matching step', async ({ page, baseURL }) => {
  await anonymousHelp(page, baseURL, 'demo-beleg', () => page.goto('/help#demo-beleg'));
  const receipt = page.locator('#demo-beleg');
  await receipt.getByText('Synthetischen Textbeleg ansehen', { exact: true }).click();
  await expect(receipt.getByRole('figure')).toContainText(pilotDemo.receiptId);
  await receipt.getByRole('link', { name: 'Zurück zum Schritt „Ausgabe mit Beleg verbinden“', exact: true }).click();
  await expect(page).toHaveURL(/\/help#demo-beleg$/);
  await receipt.getByRole('link', { name: 'Weiter: Fehler nachvollziehbar korrigieren', exact: true }).click();
  await page.goBack();
  await expect(page).toHaveURL(/\/help#demo-beleg$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/help#demo-korrektur$/);
  await anonymousHelp(page, baseURL, 'demo-korrektur', () => page.reload());
  await expect(page.locator('#demo-korrektur')).toContainText('220,00 EUR noch offen');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Synthetisches Erklärblatt herunterladen (.txt)', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('bivaro-pilot-v1.txt');
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString('utf8')).toBe(createPilotDemoWorksheet());
  await page.getByText('Dasselbe Erklärblatt zum Lesen und Kopieren', { exact: true }).click();
  await expect(page.locator('#demo pre')).toHaveText(createPilotDemoWorksheet());
  await expect(page).toHaveURL(/\/help#demo-korrektur$/);
});

test('360px text alternative, disclosures, matching return and download are keyboard reachable', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await anonymousHelp(page, baseURL, 'demo', () => page.goto('/help#demo'));
  const index = page.getByRole('navigation', { name: 'Schritte im synthetischen Beispiel' });
  const receiptLink = index.getByRole('link', { name: '3. Ausgabe mit Beleg verbinden', exact: true });
  await keyboardFocus(page, receiptLink);
  await receiptLink.press('Enter');
  await expect(page).toHaveURL(/\/help#demo-beleg$/);
  const disclosure = page.getByText('Synthetischen Textbeleg ansehen', { exact: true });
  await keyboardFocus(page, disclosure);
  await disclosure.press('Enter');
  await expect(page.locator('#demo-beleg figure')).toBeVisible();
  const returnLink = page.getByRole('link', { name: 'Zurück zum Schritt „Ausgabe mit Beleg verbinden“', exact: true });
  await keyboardFocus(page, returnLink);
  await returnLink.press('Enter');
  const downloadLink = page.getByRole('link', { name: 'Synthetisches Erklärblatt herunterladen (.txt)', exact: true });
  await keyboardFocus(page, downloadLink);
  const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.press('Enter')]);
  expect(download.suggestedFilename()).toBe('bivaro-pilot-v1.txt');
  const fallback = page.getByText('Dasselbe Erklärblatt zum Lesen und Kopieren', { exact: true });
  await keyboardFocus(page, fallback);
  await fallback.press('Enter');
  await expect(page.locator('#demo pre')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const target of [page.locator('#demo-beleg figure'), page.locator('#demo pre')]) {
    expect(await target.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  }
});
