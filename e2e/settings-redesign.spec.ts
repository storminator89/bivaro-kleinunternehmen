import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// Hosted acceptance runner only. Authentication uses its fresh synthetic fixture;
// settings, provider/SMTP reads and all deliberate mutation states below are
// intercepted UI contracts, not persistence/provider/restore acceptance evidence.
const company = {
  companyName: 'SYNTHETISCHE Werkstatt', companyAddress: 'Testweg 12\n10115 Musterstadt',
  email: 'werkstatt@example.test', telephone: '+49 30 12345678', taxNumber: '123/456/78901',
  bankName: 'Synthetische Beispielbank', iban: 'DE89370400440532013000', bic: 'SYNTHETIC',
  footerText: 'Synthetische Testdaten, keine echten Firmendaten.', logoUrl: '', paymentTermDays: 14,
  fiscalTaxRegime: 'STANDARD', fiscalEffectiveFrom: '2026-01-01', fiscalConfirmedAt: '2026-01-01T00:00:00.000Z',
};
const preview = {
  version: 'synthetic-ui-only', type: 'json', totalRecords: 14,
  warnings: ['Synthetischer Vorschauhinweis: Dateien fehlen; vor einer Wiederherstellung die eigene Sicherung prüfen.'],
  counts: { customers: 1, serviceProjects: 1, billingNotes: 1, annualBusinessContextRevisions: 1, serviceArticles: 1,
    expenses: 1, incomes: 1, invoices: 1, templates: 1, recurringExpenses: 0, serviceBillingPlans: 1,
    serviceBillingPeriods: 1, reminders: 0, cashBooks: 1, cashTransactions: 1, documentations: 1, apiKeys: 0 },
};
const logo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=', 'base64');

async function settled(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  expect(await page.evaluate(() => document.fonts.check('400 14px Inter'))).toBe(true);
}
async function theme(page: Page, value: 'light' | 'dark') {
  if (await page.locator('html').evaluate(element => element.classList.contains('dark')) !== (value === 'dark')) {
    await page.getByRole('button', { name: value === 'dark' ? 'Dunkles Farbschema aktivieren' : 'Helles Farbschema aktivieren', exact: true }).click();
  }
  await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${value}\\b`));
}
async function reachable(locator: Locator) {
  let geometry: unknown = null;
  try {
    await expect.poll(async () => {
      await locator.scrollIntoViewIfNeeded();
      // This checks reachability after an ordinary user scroll, not native hash
      // landing. A target already in the viewport may still be behind the header.
      const needsVerticalScroll = await locator.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const top = Math.max(0, ...Array.from(document.querySelectorAll('.app-topbar')).map(node => node.getBoundingClientRect()).filter(r => r.width > 0).map(r => r.bottom));
        return rect.top < top || rect.bottom > innerHeight;
      });
      if (needsVerticalScroll) await alignBelowHeader(locator);
      await locator.page().evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const result = await locator.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const top = Math.max(0, ...Array.from(document.querySelectorAll('.app-topbar')).map(node => node.getBoundingClientRect()).filter(r => r.width > 0).map(r => r.bottom));
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
          reachable: rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1 && rect.top >= top && rect.bottom <= innerHeight
            && hit !== null && (element === hit || element.contains(hit)),
          target: { tag: element.tagName, rect: rect.toJSON() },
          hit: hit ? { tag: hit.tagName, rect: hit.getBoundingClientRect().toJSON() } : null,
          headerBottom: top, viewport: { width: innerWidth, height: innerHeight, clientWidth: document.documentElement.clientWidth },
          scroll: { x: scrollX, y: scrollY },
        };
      });
      geometry = result;
      return result.reachable;
    }).toBe(true);
  } catch (error) {
    process.stdout.write(`Settings reachability geometry: ${JSON.stringify(geometry)}\n`);
    throw error;
  }
}
async function alignBelowHeader(locator: Locator) {
  await locator.evaluate(element => {
    const header = Math.max(0, ...Array.from(document.querySelectorAll('.app-topbar')).map(node => node.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0).map(rect => rect.bottom));
    window.scrollBy({ top: element.getBoundingClientRect().top - header - 16, behavior: 'instant' });
  });
}
async function noClipping(page: Page) {
  await settled(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const clipped = await page.getByRole('main').locator('button,a,summary').evaluateAll(elements => elements.filter(element => {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    return rect.left < -1 || rect.right > document.documentElement.clientWidth + 1 || element.scrollWidth > element.clientWidth + 1;
  }).map(element => ({ text: element.textContent, width: element.clientWidth, scrollWidth: element.scrollWidth })));
  expect(clipped).toEqual([]);
}
async function sessionSettledDocument(page: Page, destination: '/login' | '/dashboard' | '/settings', navigate: () => Promise<unknown>) {
  // Each fresh document mounts SessionProvider. Do not cancel its real session
  // fetch with the next fixture navigation and manufacture a client auth error.
  const session = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/auth/session'
    && new URL(page.url()).pathname === destination);
  await navigate();
  const response = await session;
  expect(response.status()).toBe(200);
  expect(await response.finished()).toBeNull();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test('settings redesign has complete light/dark screens and bounded changed-form states without settings mutations', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const authDiagnostics: { level: string; code: string }[] = [];
  await page.route('**/api/auth/_log', async route => {
    if (route.request().method() !== 'POST' || new URL(route.request().url()).pathname !== '/api/auth/_log') return route.fallback();
    const diagnostic = new URLSearchParams(route.request().postData() ?? '');
    const level = diagnostic.get('level') ?? '', code = diagnostic.get('code') ?? '';
    // Never retain/export message, stack, URL, session or request metadata.
    authDiagnostics.push({ level: ['error', 'warn', 'debug'].includes(level) ? level : 'unrecognized',
      code: /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : 'UNRECOGNIZED' });
    await route.fulfill({ status: 204 });
  });
  const password = 'SyntheticSettingsLayout123!';
  const user = await prisma.user.create({ data: { email: `settings-layout-${randomUUID()}@example.test`, name: 'Synthetic settings layout', password: await hashPassword(password), role: 'ADMIN' } });
  await sessionSettledDocument(page, '/login', () => page.goto('/login'));
  await page.getByLabel('E-Mail').fill(user.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await sessionSettledDocument(page, '/dashboard', () => page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click());
  await expect(page).toHaveURL(/\/dashboard/);

  const unexpectedMutations: string[] = [];
  await page.route('**/api/**', async route => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
    if (route.request().method() === 'POST' && new URL(route.request().url()).pathname === '/api/auth/_log') return route.fallback();
    unexpectedMutations.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    await route.abort('blockedbyclient');
  });
  let pendingSave: Route | null = null, pendingUpload: Route | null = null, loadFails = false;
  await page.route('**/api/settings', async route => {
    if (route.request().method() === 'GET') await route.fulfill({ status: loadFails ? 503 : 200, json: loadFails ? { error: 'Synthetic load interruption' } : company });
    else if (route.request().method() === 'POST') pendingSave = route;
    else { unexpectedMutations.push('unexpected company method'); await route.abort(); }
  });
  await page.route('**/api/settings/upload-logo', route => { pendingUpload = route; });
  await page.route('**/api/files/logo?synthetic-settings-layout=1', route => route.fulfill({ contentType: 'image/png', body: logo }));
  await page.route('**/api/settings/annual-context', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { version: 1, revision: 0, history: [] } }) : route.fallback());
  await page.route('**/api/settings/ai-provider', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { enabled: false, autoAnalyzeNewUploads: false, baseUrl: '', model: '', hasKey: false, configured: false, encryptionAvailable: false, version: 0, configurationRevision: '' } }) : route.fallback());
  await page.route('**/api/settings/smtp', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { source: 'none', host: '', port: 587, secure: false, from: '', user: '', passwordConfigured: false, configured: false } }) : route.fallback());
  await page.route('**/api/app-settings', route => route.request().method() === 'GET' ? route.fulfill({ json: { allowRegistration: false } }) : route.fallback());
  await page.route('**/api/backup/preview', route => route.fulfill({ json: { preview } }));
  const captures: { name: string; bytes: number }[] = [];
  const capture = async (name: string, fullPage: boolean) => {
    await settled(page);
    await noClipping(page);
    if (fullPage) await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await settled(page);
    const surface = await page.evaluate(() => ({ viewportWidth: innerWidth, viewportHeight: innerHeight, clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth, scrollY, height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
      font: getComputedStyle(document.querySelector('#companyName')!).fontFamily }));
    const image = await page.screenshot({ path: testInfo.outputPath(name), fullPage, animations: 'disabled' });
    const pngWidth = image.readUInt32BE(16), pngHeight = image.readUInt32BE(20);
    expect(image.length).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(pngWidth).toBeGreaterThanOrEqual(surface.clientWidth);
    expect(pngWidth).toBeLessThanOrEqual(surface.viewportWidth);
    expect(pngWidth * pngHeight * 4).toBeLessThanOrEqual(64 * 1024 * 1024);
    if (fullPage) { expect(surface.scrollY).toBe(0); expect(pngHeight).toBe(surface.height); }
    captures.push({ name, bytes: image.length });
    process.stdout.write(`Settings capture proof: ${JSON.stringify({ name, fullPage, theme: await page.locator('html').getAttribute('class'), url: page.url(), ...surface, pngWidth, pngHeight, encodedBytes: image.length })}\n`);
  };

  loadFails = true;
  await sessionSettledDocument(page, '/settings', () => page.goto('/settings'));
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Einstellungen nicht geladen');
  await expect(page.locator('#company-settings')).toHaveCount(0);
  loadFails = false;
  await page.getByRole('button', { name: 'Erneut laden', exact: true }).click();
  await expect(page.locator('#companyName')).toHaveValue(company.companyName);

  for (const value of ['light', 'dark'] as const) for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await sessionSettledDocument(page, '/settings', () => page.goto('/settings'));
    await theme(page, value);
    await expect(page.locator('#companyName')).toHaveValue(company.companyName);
    await expect(page.locator('#ai-receipt-settings')).toContainText('Kein Schlüssel');
    await expect(page.locator('#smtp-versand')).toContainText('Nicht eingerichtet');
    const expanded = (value === 'light' && width === 1440) || (value === 'dark' && width === 375);
    if (expanded) {
      await page.locator('#fiscal-profile').getByText('Steuerhinweise', { exact: true }).click();
      await page.getByRole('button', { name: 'Jahreskontext öffnen', exact: true }).click();
      await expect(page.locator('#annual-year')).toBeEnabled();
      await page.locator('#ai-receipt-settings').getByText('KI konfigurieren', { exact: true }).click();
      await page.locator('#smtp-versand').getByText('SMTP konfigurieren', { exact: true }).click();
      await expect(page.locator('#ai-api-key')).toHaveCount(0);
    }
    for (const id of ['company-settings', 'fiscal-profile', 'annual-context', 'ai-receipt-settings', 'email-settings', 'registration-settings', 'backup-settings', 'handoff-settings', 'access-settings', 'audit-settings', 'procedure-settings']) {
      await expect(page.locator(`#${id}`)).toBeVisible();
    }
    for (const id of ['handoff-settings', 'access-settings', 'audit-settings', 'procedure-settings']) {
      const action = page.locator(`#${id}`).getByRole('link');
      await reachable(action);
      expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await capture(`settings-redesign-${value}-${width}.png`, true);
    process.stdout.write(`Settings primary disclosure state: ${JSON.stringify({ theme: value, width, expanded })}\n`);
  }

  await sessionSettledDocument(page, '/settings', () => page.goto('/settings'));
  const form = page.locator('#company-settings'), save = form.getByRole('button', { name: 'Speichern', exact: true });
  const upload = page.locator('#logo-upload');
  await page.keyboard.press('Tab');
  await upload.focus(); await expect(upload).toBeFocused();
  const focus = await page.locator('label[for="logo-upload"]').evaluate(element => ({ style: getComputedStyle(element).outlineStyle, width: getComputedStyle(element).outlineWidth }));
  expect(focus.style).not.toBe('none'); expect(Number.parseFloat(focus.width)).toBeGreaterThanOrEqual(2);
  await upload.setInputFiles({ name: 'synthetic-settings-logo.png', mimeType: 'image/png', buffer: logo });
  await expect(upload).toBeDisabled(); await expect(save).toBeDisabled();
  await expect.poll(() => pendingUpload !== null).toBe(true);
  await pendingUpload!.fulfill({ json: { url: '/api/files/logo?synthetic-settings-layout=1' } }); pendingUpload = null;
  await expect(form.getByRole('img', { name: 'Logo', exact: true })).toBeVisible();
  await upload.focus(); await page.keyboard.press('Tab');
  await expect(form.getByRole('button', { name: 'Verwerfen', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(save).toBeFocused();
  await form.getByRole('button', { name: 'Firmenlogo entfernen', exact: true }).click();
  await expect(form.getByRole('img', { name: 'Logo', exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 1000 }); await theme(page, 'light');
  await page.locator('#companyName').fill('SYNTHETISCH · Nicht gespeichert');
  await save.click();
  await expect(page.locator('#companyName')).toBeDisabled();
  await expect(form.getByRole('button', { name: 'Speichern...', exact: true })).toBeDisabled();
  await alignBelowHeader(page.locator('#company-payment-term')); await reachable(form.getByRole('button', { name: 'Speichern...', exact: true }));
  await expect(page.locator('#company-payment-term')).toBeDisabled();
  await expect(page.locator('#company-payment-term')).toBeInViewport({ ratio: 1 });
  await capture('settings-redesign-company-saving-light-1440.png', false);
  await expect.poll(() => pendingSave !== null).toBe(true);
  await pendingSave!.fulfill({ status: 503, json: { error: 'Synthetic save interruption' } }); pendingSave = null;
  await expect(form.getByRole('alert')).toContainText('nicht gespeichert');
  await expect(page.locator('#companyName')).toHaveValue('SYNTHETISCH · Nicht gespeichert');
  await page.setViewportSize({ width: 375, height: 844 }); await theme(page, 'dark');
  await alignBelowHeader(page.locator('#company-payment-term')); await reachable(save);
  await expect(page.locator('#company-payment-term')).toBeInViewport({ ratio: 1 });
  await expect(form.getByRole('alert')).toBeInViewport({ ratio: 1 });
  await capture('settings-redesign-company-error-dark-375.png', false);
  await form.getByRole('button', { name: 'Verwerfen', exact: true }).click();
  await expect(page.locator('#companyName')).toHaveValue(company.companyName);
  await expect(form.getByRole('alert')).toHaveCount(0);

  const backup = page.locator('#backup-settings');
  await backup.getByText('Backup wiederherstellen', { exact: true }).click();
  await backup.locator('#overwrite-mode').check();
  await backup.locator('#restore-file').setInputFiles({ name: 'synthetic-settings-backup-with-complete-counts-and-missing-files.json', mimeType: 'application/json', buffer: Buffer.from('{"synthetic":true}') });
  await expect(backup.getByText('Backup-Vorschau bereit', { exact: true })).toBeVisible();
  const restore = backup.getByRole('button', { name: 'Geprüftes Backup überschreiben', exact: true });
  for (const value of ['light', 'dark'] as const) {
    const width = value === 'light' ? 1440 : 375;
    // The focused preview gets an explicitly taller mobile viewport, not a
    // claim that all fourteen counts and actions fit the primary 375x844 view.
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 1280 }); await theme(page, value);
    const title = backup.getByText('Backup-Vorschau bereit', { exact: true });
    const panel = title.locator('..');
    await alignBelowHeader(title);
    for (const target of [title, panel.getByText('Synthetischer Vorschauhinweis:', { exact: false }), restore, backup.getByRole('button', { name: 'Auswahl verwerfen', exact: true })]) await expect(target).toBeInViewport();
    await expect(panel.locator('span')).toHaveCount(14);
    for (const count of await panel.locator('span').all()) await expect(count).toBeInViewport();
    const enclosure = await panel.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const header = Math.max(0, ...Array.from(document.querySelectorAll('.app-topbar')).map(node => node.getBoundingClientRect()).filter(r => r.width > 0).map(r => r.bottom));
      return { top: rect.top, bottom: rect.bottom, header, viewportHeight: innerHeight };
    });
    expect(enclosure.top).toBeGreaterThanOrEqual(enclosure.header); expect(enclosure.bottom).toBeLessThanOrEqual(enclosure.viewportHeight);
    await capture(`settings-redesign-backup-${value}-${width}.png`, false);
  }
  for (const width of [320, 768, 1024, 1920]) {
    await page.setViewportSize({ width, height: width >= 1024 ? 1000 : 844 });
    await noClipping(page); await reachable(restore);
    const mobile = page.getByRole('navigation', { name: 'Mobile Einstellungsbereiche', exact: true });
    if (width < 1024) {
      const picker = page.getByText('Bereich wechseln', { exact: true });
      if (!await picker.locator('..').evaluate(element => element.hasAttribute('open'))) await picker.click();
      await mobile.getByRole('link', { name: 'Datensicherung', exact: true }).click();
    } else await page.getByRole('navigation', { name: 'Einstellungsbereiche', exact: true }).getByRole('link', { name: 'Datensicherung', exact: true }).click();
    await expect(page).toHaveURL(/#backup-settings$/);
    const landing = await backup.getByRole('heading', { name: 'Datensicherung', exact: true }).evaluate(element => {
      const rect = element.getBoundingClientRect();
      const header = Math.max(0, ...Array.from(document.querySelectorAll('.app-topbar')).map(node => node.getBoundingClientRect()).filter(r => r.width > 0).map(r => r.bottom));
      return { top: rect.top, bottom: rect.bottom, header, viewportHeight: innerHeight };
    });
    expect(landing.top).toBeGreaterThanOrEqual(landing.header + 8);
    expect(landing.bottom).toBeLessThanOrEqual(landing.viewportHeight);
    for (const id of ['handoff-settings', 'access-settings', 'audit-settings', 'procedure-settings']) await reachable(page.locator(`#${id}`).getByRole('link'));
  }
  const discardPreview = backup.getByRole('button', { name: 'Auswahl verwerfen', exact: true });
  await reachable(discardPreview);
  await discardPreview.click();
  await expect(restore).toHaveCount(0);
  process.stdout.write(`Settings auth diagnostic codes: ${JSON.stringify(authDiagnostics)}\n`);
  expect(authDiagnostics).toEqual([]);
  expect(unexpectedMutations).toEqual([]);
  expect(captures).toHaveLength(8);
  expect(captures.reduce((sum, capture) => sum + capture.bytes, 0)).toBeLessThanOrEqual(1.85 * 1024 * 1024);
  process.stdout.write(`Settings bounded image total: ${JSON.stringify(captures)}\n`);
  expect(await prisma.settings.count({ where: { userId: user.id } })).toBe(0);
});
