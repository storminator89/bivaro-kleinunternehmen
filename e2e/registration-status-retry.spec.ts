import { expect, test } from '@playwright/test';

// Uses the supported runner's fresh fixture and Playwright's anonymous context.
// Do not create accounts or alter registration settings to choose a UI branch:
// after one injected delivery failure, the real server remains authoritative.
test('keeps an unavailable registration status fail-closed and retries only on explicit keyboard activation', async ({ page }) => {
  const statusPath = '/api/auth/registration-status';
  const statusReads: string[] = [], unexpectedReads: string[] = [], attemptedWrites: string[] = [], pageErrors: string[] = [];
  let retryRequested = false, serverReads = 0;
  let upstreamBody: Buffer | undefined;
  let upstreamStatus: number | undefined;
  const isStatus = (url: string) => new URL(url).pathname === statusPath;

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    if (!['GET', 'HEAD'].includes(request.method())) attemptedWrites.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  // Block every mutation before it can reach a server, including accidental
  // registration or auth logging; unexpected writes still fail this case.
  await page.route('**/*', route => ['GET', 'HEAD'].includes(route.request().method())
    ? route.continue() : route.abort('blockedbyclient'));
  await page.route(`**${statusPath}`, async route => {
    const method = route.request().method();
    statusReads.push(method);
    if (method !== 'GET') {
      unexpectedReads.push(method);
      await route.abort('blockedbyclient');
      return;
    }
    if (statusReads.length === 1 || !retryRequested || statusReads.length !== 2) {
      if (statusReads.length !== 1) unexpectedReads.push('status reread without its single explicit retry');
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic registration-status delivery failure' }) });
      return;
    }
    serverReads++;
    // No replacement payload, method, credentials, policy or request body.
    // Never turn a transient read failure into a registration-setting change.
    const response = await route.fetch({ maxRetries: 0, maxRedirects: 0 });
    upstreamBody = await response.body();
    upstreamStatus = response.status();
    await route.fulfill({ response });
  });

  const failedDelivery = page.waitForResponse(response => isStatus(response.url()) && response.request().method() === 'GET' && response.status() === 503);
  await page.goto('/register');
  expect((await failedDelivery).status()).toBe(503);
  const main = page.getByRole('main');
  const unavailable = main.getByRole('heading', { name: 'Registrierungsstatus nicht verfügbar', exact: true });
  const retry = main.getByRole('button', { name: 'Status erneut prüfen', exact: true });
  await expect(unavailable).toBeVisible();
  await expect(main.getByRole('alert')).toContainText('Ob neue Konten zugelassen sind, ist derzeit nicht bestätigt.');
  await expect(main.locator('form, #setupToken')).toHaveCount(0);
  await expect(main.getByRole('heading', { name: /^(Registrierung deaktiviert|Erstregistrierung deaktiviert|Erstregistrierung abgeschlossen)$/ })).toHaveCount(0);
  await expect(retry).toHaveAttribute('type', 'button');

  // Functional DOM/layout checks only, not dedicated screenshot/pixel review.
  for (const width of [1440, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(unavailable).toBeInViewport();
    await expect(main.getByRole('alert')).toBeVisible();
    await expect(retry).toBeVisible();
    await expect(main.getByRole('link', { name: 'Zurück zur Anmeldung', exact: true })).toHaveAttribute('href', '/login');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `registration error state overflows at ${width}px`).toBe(true);
  }
  expect(statusReads).toEqual(['GET']);
  expect(serverReads).toBe(0);
  expect(unexpectedReads).toEqual([]);
  expect(attemptedWrites).toEqual([]);

  await retry.focus();
  await expect(retry).toBeFocused();
  const confirmedDelivery = page.waitForResponse(response => isStatus(response.url()) && response.request().method() === 'GET');
  retryRequested = true;
  await page.keyboard.press('Enter');
  const confirmed = await confirmedDelivery;
  expect(confirmed.status()).toBe(200);
  expect(confirmed.status()).toBe(upstreamStatus);
  expect(await confirmed.finished()).toBeNull();
  expect(await confirmed.body()).toEqual(upstreamBody);
  const data: Record<string, unknown> = await confirmed.json();
  for (const field of ['isFirstUser', 'allowRegistration', 'bootstrapRequired']) expect(typeof data[field], field).toBe('boolean');
  if (data.isFirstUser === true || data.bootstrapConsumed !== undefined) expect(typeof data.bootstrapConsumed).toBe('boolean');

  if (data.allowRegistration === true) {
    await expect(main.getByRole('heading', { name: data.isFirstUser === true ? 'Admin-Konto erstellen' : 'Konto erstellen', exact: true })).toBeVisible();
    await expect(main.locator('form')).toHaveCount(1);
    await expect(main.locator('#setupToken')).toHaveCount(data.bootstrapRequired === true ? 1 : 0);
    await expect(main.getByRole('button', { name: data.isFirstUser === true ? 'Admin-Konto erstellen' : 'Registrieren', exact: true })).toBeVisible();
  } else {
    const heading = data.isFirstUser === true
      ? data.bootstrapConsumed === true ? 'Erstregistrierung abgeschlossen' : 'Erstregistrierung deaktiviert'
      : 'Registrierung deaktiviert';
    await expect(main.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(main.locator('form, #setupToken')).toHaveCount(0);
  }
  await expect(unavailable).toHaveCount(0);
  await expect(retry).toHaveCount(0);
  expect(statusReads).toEqual(['GET', 'GET']);
  expect(serverReads).toBe(1);
  expect(unexpectedReads).toEqual([]);
  expect(attemptedWrites).toEqual([]);
  expect(pageErrors).toEqual([]);
});
