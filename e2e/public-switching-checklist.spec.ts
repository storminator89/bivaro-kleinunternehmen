import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { classifyPublicReadOnlyRequest, publicAuthDiagnosticMetadata } from './helpers/public-read-only';

// Authored for the authorized hosted browser workflow; not locally executed.
// These cases do not create accounts, import documents or write application data.
// Dedicated images require the separately reviewed two-name upload addition.
// Source authoring is not browser execution or visual acceptance.
const test = base.extend<{ publicReadOnly: void }>({
  publicReadOnly: [async ({ page, baseURL }, runFixture) => {
    if (!baseURL) throw new Error('The supported hosted fixture runner must supply baseURL.');
    const origin = new URL(baseURL).origin;
    const forbidden: { method: string; pathname: string }[] = [];
    const diagnostics: ReturnType<typeof publicAuthDiagnosticMetadata>[] = [];
    let forbiddenCount = 0;
    let diagnosticCount = 0;
    await page.route('**/*', async route => {
      const request = route.request();
      const kind = classifyPublicReadOnlyRequest(request.method(), request.url(), origin);
      if (kind === 'read') return route.continue();
      if (kind === 'auth-diagnostic') {
        diagnosticCount += 1;
        if (diagnostics.length < 10) diagnostics.push(publicAuthDiagnosticMetadata(request.postData()));
        // Classify separately, but never fake success or exempt an auth failure
        // from the final acceptance assertion. No diagnostic body is retained.
        return route.continue();
      }
      forbiddenCount += 1;
      if (forbidden.length < 10) forbidden.push({ method: request.method(), pathname: new URL(request.url()).pathname.slice(0, 160) });
      await route.abort('blockedbyclient');
    });
    try {
      await runFixture();
    } finally {
      await page.unrouteAll({ behavior: 'wait' });
      expect({ forbiddenCount, requests: forbidden }).toEqual({ forbiddenCount: 0, requests: [] });
      expect({ diagnosticCount, diagnostics }).toEqual({ diagnosticCount: 0, diagnostics: [] });
    }
  }, { auto: true }],
});

async function settledAnonymousHelp(page: Page, baseURL: string | undefined, navigate: () => Promise<unknown>) {
  if (!baseURL) throw new Error('The supported hosted fixture runner must supply baseURL.');
  const origin = new URL(baseURL).origin;
  const read = (pathname: string) => page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.origin === origin && url.pathname === pathname && url.search === '';
  });
  // Finish the actual public document's auth/access reads before reload or
  // disposal; do not manufacture CLIENT_FETCH_ERROR by canceling these reads.
  const session = read('/api/auth/session');
  const registration = read('/api/auth/registration-status');
  await navigate();
  const [sessionResponse, registrationResponse] = await Promise.all([session, registration]);
  for (const response of [sessionResponse, registrationResponse]) {
    expect(response.status()).toBe(200);
    expect(await response.finished()).toBeNull();
  }
  expect(await sessionResponse.json()).toEqual({});
  await expect(page).toHaveURL(`${origin}/help#umstieg`);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function keyboardFocus(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(control).toBeFocused();
  expect(await control.evaluate(node => node.matches(':focus-visible'))).toBe(true);
}

async function settleReviewCapture(page: Page, target: Locator) {
  await page.evaluate(async () => { await document.fonts.ready; });
  const progress = page.locator('div[aria-hidden="true"][class*="pointer-events-none"][class*="fixed"][class*="h-0.5"]');
  await expect(progress).toHaveCount(1);
  await expect(progress).toHaveCSS('opacity', '0');
  await target.evaluate(node => {
    const header = document.querySelector<HTMLElement>('header[class*="publicHeader"]');
    if (!header || header.getClientRects().length === 0) throw new Error('Expected the visible public header');
    const safeTop = Math.max(0, header.getBoundingClientRect().bottom) + 16;
    window.scrollBy({ top: node.getBoundingClientRect().top - safeTop, behavior: 'instant' });
  });
  await expect.poll(() => target.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const header = document.querySelector<HTMLElement>('header[class*="publicHeader"]');
    if (!header || header.getClientRects().length === 0) return false;
    const top = Math.max(0, header.getBoundingClientRect().bottom);
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return rect.width > 0 && rect.height > 0 && rect.top >= top + 8 && rect.bottom <= innerHeight - 8
      && rect.left >= 0 && rect.right <= innerWidth && node.scrollWidth <= node.clientWidth + 1
      && hit !== null && (hit === node || node.contains(hit));
  })).toBe(true);
}

test('anonymous switching checklist exports the current self-review without registering or submitting data', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await settledAnonymousHelp(page, baseURL, () => page.goto('/help#umstieg'));
  const origin = new URL(baseURL!).origin;
  await expect(page).toHaveURL(`${origin}/help#umstieg`);
  const checklist = page.locator('#umstieg');
  await expect(checklist.getByRole('heading', { name: 'Umstieg vorbereiten', exact: true })).toBeVisible();
  await expect(checklist.getByRole('combobox')).toHaveCount(6);
  await expect(checklist).toContainText('0 von 6 Punkten selbst vorbereitet');
  await checklist.getByLabel('Ihr Stand: Firma und Zuständigkeit', { exact: true }).selectOption('prepared');
  await checklist.getByLabel('Ihr Stand: Offene Posten', { exact: true }).selectOption('review');
  await expect(checklist).toContainText('1 von 6 Punkten selbst vorbereitet');
  await expect(checklist).toContainText('Prüfbedarf zuerst mit Betreiber');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    checklist.getByRole('button', { name: 'Reviewbogen herunterladen (.txt)', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('bivaro-manueller-umstiegsreview.txt');
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  expect(text).toContain('Selbst vorbereitet: 1 von 6 · Noch offen: 4 · Prüfbedarf: 1');
  expect(text).toContain('1. Firma und Zuständigkeit: Selbst vorbereitet');
  expect(text).toContain('3. Offene Posten: Prüfbedarf');
  expect(text).toContain('Keine Umstiegs-, Produkt- oder Steuerfreigabe');
  expect(text).toContain('Dies ist keine geführte Produktdemo');
  await checklist.getByText('Reviewbogen zum Kopieren anzeigen', { exact: true }).click();
  await expect(checklist.getByLabel('Aktueller Reviewbogen – nur lesbar', { exact: true })).toHaveValue(text);
  await expect(checklist.getByLabel('Aktueller Reviewbogen – nur lesbar', { exact: true })).toHaveAttribute('readonly', '');
  await settleReviewCapture(page, checklist.getByLabel('Aktueller Reviewbogen – nur lesbar', { exact: true }));
});

test('all six self-prepared selections retain the manual gate and reset explicitly or on reload', async ({ page, baseURL }) => {
  await settledAnonymousHelp(page, baseURL, () => page.goto('/help#umstieg'));
  const checklist = page.locator('#umstieg');
  const choices = checklist.getByRole('combobox');
  for (const choice of await choices.all()) await choice.selectOption('prepared');
  await expect(checklist).toContainText('6 von 6 Punkten selbst vorbereitet');
  await expect(checklist).toContainText('Der manuelle Review und die Entscheidung über den Umstieg bleiben offen');
  await checklist.getByRole('button', { name: 'Auswahl zurücksetzen', exact: true }).click();
  for (const choice of await choices.all()) await expect(choice).toHaveValue('open');
  await expect(checklist).toContainText('Alle sechs Statusangaben wurden');
  await checklist.getByLabel('Ihr Stand: Kontrollsummen', { exact: true }).selectOption('review');
  await settledAnonymousHelp(page, baseURL, () => page.reload());
  await expect(page).toHaveURL(/\/help#umstieg$/);
  await expect(checklist).toContainText('0 von 6 Punkten selbst vorbereitet');
  await expect(checklist.getByLabel('Ihr Stand: Kontrollsummen', { exact: true })).toHaveValue('open');
  await expect(checklist).toContainText('Ein Neuladen setzt sie zurück');
});

test('360px public switch preparation remains keyboard reachable with a readable manual fallback', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await settledAnonymousHelp(page, baseURL, () => page.goto('/help#umstieg'));
  const checklist = page.locator('#umstieg');
  const company = checklist.getByLabel('Ihr Stand: Firma und Zuständigkeit', { exact: true });
  await keyboardFocus(page, company);
  await company.press('ArrowDown');
  await company.press('Tab');
  await expect(company).toHaveValue('prepared');
  const limits = checklist.getByText('Grenzen und Betriebsmodell vorab klären', { exact: true });
  await keyboardFocus(page, limits);
  await limits.press('Enter');
  await expect(checklist.getByText(/nicht zugesagte Varianten sind Konzept/)).toBeVisible();
  const fallback = checklist.getByText('Reviewbogen zum Kopieren anzeigen', { exact: true });
  const downloadButton = checklist.getByRole('button', { name: 'Reviewbogen herunterladen (.txt)', exact: true });
  await keyboardFocus(page, downloadButton);
  const [download] = await Promise.all([page.waitForEvent('download'), downloadButton.press('Enter')]);
  expect(download.suggestedFilename()).toBe('bivaro-manueller-umstiegsreview.txt');
  await keyboardFocus(page, fallback);
  await fallback.press('Enter');
  const review = checklist.getByLabel('Aktueller Reviewbogen – nur lesbar', { exact: true });
  await expect(review).toBeVisible();
  await keyboardFocus(page, review);
  const reset = checklist.getByRole('button', { name: 'Auswahl zurücksetzen', exact: true });
  await keyboardFocus(page, reset);
  await reset.press('Enter');
  await expect(company).toHaveValue('open');
  await keyboardFocus(page, review);
  await expect(review).toHaveValue(/Selbst vorbereitet: 0 von 6/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await settleReviewCapture(page, review);
});
