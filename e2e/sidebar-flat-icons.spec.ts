import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { e2eDatabasePath } from '../scripts/e2e-fixture.mjs';
import { isolateSyntheticLoginIpBudget } from './helpers/synthetic-login';

// Hosted acceptance source only. The supported runner must own a fresh fixture;
// this spec never logs in to a real tenant and never creates financial records.
const navigationNames = [
  'nav-dashboard', 'nav-invoices', 'nav-quotes', 'nav-reminders', 'nav-customers',
  'nav-incomes', 'nav-expenses', 'nav-cashbook', 'nav-eur', 'nav-assets',
  'nav-tax', 'nav-settings', 'nav-users', 'nav-logout',
].sort();

async function settled(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  expect(await page.evaluate(() => document.fonts.check('400 14px Inter'))).toBe(true);
}

async function setTheme(page: Page, value: 'light' | 'dark') {
  if (await page.locator('html').evaluate(element => element.classList.contains('dark')) !== (value === 'dark')) {
    await page.getByRole('button', { name: value === 'dark' ? 'Dunkles Farbschema aktivieren' : 'Helles Farbschema aktivieren', exact: true }).click();
  }
  await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${value}\\b`));
  await settled(page);
}

async function maskProof(page: Page, surface: Locator) {
  const nav = surface.locator('[data-bivaro-sidebar-icon^="nav-"]');
  await expect(nav).toHaveCount(17);
  const icons = surface.locator('[data-bivaro-sidebar-icon]').filter({ visible: true });
  await expect(icons).toHaveCount(18);
  const rendered = await icons.evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element), box = element.getBoundingClientRect();
    return { name: element.getAttribute('data-bivaro-sidebar-icon'), hidden: element.getAttribute('aria-hidden'),
      mask: style.maskImage, mode: style.maskMode, ink: style.backgroundColor, color: style.color,
      filter: style.filter, width: box.width, height: box.height };
  }));
  expect([...new Set(rendered.filter(icon => icon.name?.startsWith('nav-')).map(icon => icon.name))].sort()).toEqual(navigationNames);
  const sources = new Map<string, string>();
  for (const icon of rendered) {
    expect(icon.hidden).toBe('true');
    expect(icon.mode).toBe('alpha');
    expect(icon.ink).toBe(icon.color);
    expect(icon.filter).toBe('none');
    const size = icon.name === 'bivaro-sidebar' ? 40 : 28;
    expect([icon.width, icon.height]).toEqual([size, size]);
    const source = icon.mask.match(/^url\(["']?([^"')]+)["']?\)$/)?.[1];
    expect(source, `${icon.name} must use a real rendered alpha mask`).toBeTruthy();
    const url = new URL(source!, page.url());
    expect(url.origin).toBe(new URL(page.url()).origin);
    expect(url.pathname).toBe(`/brand/icons/sidebar-flat/${icon.name}.webp`);
    sources.set(icon.name!, url.href);
  }
  expect(sources.size).toBe(15);
  for (const [name, source] of sources) {
    const response = await page.request.get(source);
    expect(response.status(), source).toBe(200);
    expect(response.headers()['content-type']).toContain('image/webp');
    const decoded = await page.evaluate(async url => {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Decoded sidebar alpha cannot be inspected');
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let transparent = false, solid = false;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] === 0) transparent = true;
        if (pixels[index] >= 250) solid = true;
      }
      return { width: image.naturalWidth, height: image.naturalHeight, transparent, solid };
    }, source);
    const size = name === 'bivaro-sidebar' ? 192 : 128;
    expect(decoded).toEqual({ width: size, height: size, transparent: true, solid: true });
  }
  process.stdout.write(`Sidebar actual rendered-mask proof: ${JSON.stringify({ count: sources.size, names: [...sources.keys()].sort(), network: '200 image/webp', decodedTransparentAndSolid: true })}\n`);
}

async function stateProof(page: Page, surface: Locator, hover: boolean) {
  const active = surface.locator('.app-nav-link[href="/dashboard"]');
  const inactive = surface.locator('.app-nav-link[href="/cashbook"]');
  await expect(active).toHaveAttribute('aria-current', 'page');
  await expect(active).toHaveCSS('background-color', 'rgb(121, 225, 171)');
  await expect(active.locator('[data-bivaro-sidebar-icon]')).toHaveCSS('background-color', 'rgb(6, 37, 31)');
  await page.mouse.move(page.viewportSize()!.width - 2, 2);
  await expect(inactive.locator('[data-bivaro-sidebar-icon]')).toHaveCSS('background-color', 'rgb(189, 207, 202)');
  if (hover) {
    await inactive.hover();
    await expect(inactive.locator('[data-bivaro-sidebar-icon]')).toHaveCSS('background-color', 'rgb(198, 216, 212)');
    await page.mouse.move(page.viewportSize()!.width - 2, 2);
    await expect(inactive.locator('[data-bivaro-sidebar-icon]')).toHaveCSS('background-color', 'rgb(189, 207, 202)');
  }
}

async function position(surface: Locator, edge: 'top' | 'bottom') {
  // Preserve real clipping/scroll behavior. Do not resize the app, force-open
  // panels, hide controls, or synthesize a sidebar for screenshots.
  await surface.evaluate((root, target) => {
    for (const element of [root, ...root.querySelectorAll('*')]) {
      if (element instanceof HTMLElement && /auto|scroll/u.test(getComputedStyle(element).overflowY)
        && element.scrollHeight > element.clientHeight) {
        element.scrollTop = target === 'top' ? 0 : element.scrollHeight;
      }
    }
  }, edge);
  const target = edge === 'top' ? surface.locator('.app-nav-link[href="/dashboard"]') : surface.getByRole('button', { name: 'Abmelden', exact: true });
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeInViewport({ ratio: 1 });
}

async function capture(page: Page, info: TestInfo, surface: Locator, name: string, viewport: { width: number; height: number }) {
  expect(info.retry).toBe(0);
  await settled(page);
  expect(page.viewportSize()).toEqual(viewport);
  const geometry = await surface.evaluate(root => {
    const rect = root.getBoundingClientRect();
    const visibleNames = [...root.querySelectorAll('[data-bivaro-sidebar-icon]')].filter(icon => {
      const box = icon.getBoundingClientRect(), style = getComputedStyle(icon);
      if (!box.width || !box.height || style.visibility === 'hidden') return false;
      let left = 0, top = 0, right = document.documentElement.clientWidth, bottom = innerHeight;
      for (let parent = icon.parentElement; parent; parent = parent.parentElement) {
        const ancestor = parent.getBoundingClientRect(), clipping = getComputedStyle(parent);
        if (/(auto|scroll|hidden|clip)/u.test(clipping.overflowX)) { left = Math.max(left, ancestor.left); right = Math.min(right, ancestor.right); }
        if (/(auto|scroll|hidden|clip)/u.test(clipping.overflowY)) { top = Math.max(top, ancestor.top); bottom = Math.min(bottom, ancestor.bottom); }
      }
      return box.left >= left - 1 && box.right <= right + 1 && box.top >= top - 1 && box.bottom <= bottom + 1;
    }).map(icon => icon.getAttribute('data-bivaro-sidebar-icon'));
    return { width: rect.width, height: rect.height, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      innerWidth, innerHeight, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
      visibleNames: [...new Set(visibleNames)].sort() };
  });
  expect([geometry.innerWidth, geometry.innerHeight]).toEqual([viewport.width, viewport.height]);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  expect(geometry.left).toBeGreaterThanOrEqual(0); expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.clientWidth + 1); expect(geometry.bottom).toBeLessThanOrEqual(viewport.height + 1);
  expect(geometry.width * geometry.height * 4).toBeLessThanOrEqual(4 * 1024 * 1024);
  const png = await surface.screenshot({ path: info.outputPath(name), animations: 'disabled', scale: 'css' });
  expect(png.length).toBeLessThanOrEqual(1024 * 1024);
  const pngWidth = png.readUInt32BE(16), pngHeight = png.readUInt32BE(20);
  expect(pngWidth).toBeGreaterThanOrEqual(Math.floor(geometry.width)); expect(pngWidth).toBeLessThanOrEqual(Math.ceil(geometry.width));
  expect(pngHeight).toBeGreaterThanOrEqual(Math.floor(geometry.height)); expect(pngHeight).toBeLessThanOrEqual(Math.ceil(geometry.height));
  process.stdout.write(`Sidebar bounded capture proof: ${JSON.stringify({ name, ...geometry, pngWidth, pngHeight, encodedBytes: png.length, elementOnly: true })}\n`);
  return geometry.visibleNames;
}

test.afterAll(async () => { await prisma.$disconnect(); });

test('flat sidebar masks retain real light/dark expanded, collapsed and mobile navigation', async ({ page }, info) => {
  test.setTimeout(180_000);
  expect(process.env.DATABASE_URL).toBe(`file:${e2eDatabasePath()}`);
  await isolateSyntheticLoginIpBudget();
  const password = 'SyntheticSidebar123!';
  const user = await prisma.user.create({ data: { email: `sidebar-flat-${randomUUID()}@example.test`, name: 'SYNTHETISCHE Sidebar', password: await hashPassword(password), role: 'ADMIN' } });
  const unexpectedWrites: string[] = [];
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/login');
    await page.evaluate(() => { localStorage.setItem('sidebar-collapsed', 'false'); localStorage.setItem('theme', 'light'); });
    await page.reload();
    await page.getByLabel('E-Mail').fill(user.email);
    await page.getByLabel('Passwort', { exact: true }).fill(password);
    await page.getByRole('main').getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    const aside = page.locator('aside.app-sidebar');
    await expect(aside.locator('[data-bivaro-sidebar-icon^="nav-"]')).toHaveCount(17);
    await page.route('**/api/**', async route => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
      unexpectedWrites.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      await route.abort('blockedbyclient');
    });
    for (const value of ['light', 'dark'] as const) {
      const desktop = { width: 1440, height: 1000 }, mobile = { width: 375, height: 844 };
      await page.setViewportSize(desktop); await setTheme(page, value);
      await expect(aside).toHaveClass(/\bw-64\b/);
      await maskProof(page, aside); await stateProof(page, aside, true);
      await position(aside, 'top');
      const top = await capture(page, info, aside, `sidebar-flat-expanded-top-${value}-1440.png`, desktop);
      await position(aside, 'bottom');
      const bottom = await capture(page, info, aside, `sidebar-flat-expanded-bottom-${value}-1440.png`, desktop);
      expect([...new Set([...top, ...bottom].filter(name => name?.startsWith('nav-')))].sort()).toEqual(navigationNames);
      await aside.getByRole('button', { name: 'Sidebar einklappen', exact: true }).click();
      await expect(aside).toHaveClass(/\bw-20\b/);
      await expect(aside.locator('.brand-compact [data-bivaro-sidebar-icon="bivaro-sidebar"]')).toBeVisible();
      await expect(aside.locator('.brand-full')).toBeHidden();
      await expect(aside.getByRole('link', { name: 'Kunden', exact: true })).toHaveAttribute('title', 'Kunden');
      await aside.getByRole('link', { name: 'Kunden', exact: true }).click(); await expect(page).toHaveURL(/\/customers$/);
      await aside.getByRole('link', { name: 'Dashboard', exact: true }).click(); await expect(page).toHaveURL(/\/dashboard$/);
      await page.reload(); await expect(aside).toHaveClass(/\bw-20\b/);
      expect(await page.evaluate(() => localStorage.getItem('sidebar-collapsed'))).toBe('true');
      await maskProof(page, aside); await stateProof(page, aside, false); await position(aside, 'top');
      const collapsed = await capture(page, info, aside, `sidebar-flat-collapsed-${value}-1440.png`, desktop);
      // The unchanged collapsed rows can naturally exceed 1000px. Their actual
      // scroll clipping is retained; all fourteen URLs were decoded above and
      // complete visual coverage is required by expanded/mobile top+bottom pairs.
      expect(collapsed).toContain('nav-dashboard');
      expect(collapsed).toContain('bivaro-sidebar');
      await aside.getByRole('button', { name: 'Sidebar ausklappen', exact: true }).click();
      await expect(aside).toHaveClass(/\bw-64\b/);
      await page.setViewportSize(mobile);
      await page.getByRole('button', { name: 'Menü öffnen', exact: true }).click();
      const drawer = page.locator('.nav-drawer');
      await expect(drawer).toBeVisible(); await expect(drawer.getByRole('navigation', { name: 'Mobile Hauptnavigation', exact: true })).toBeVisible();
      await maskProof(page, drawer); await stateProof(page, drawer, false);
      await position(drawer, 'top');
      const mobileTop = await capture(page, info, drawer, `sidebar-flat-mobile-top-${value}-375.png`, mobile);
      await position(drawer, 'bottom');
      const mobileBottom = await capture(page, info, drawer, `sidebar-flat-mobile-bottom-${value}-375.png`, mobile);
      expect([...new Set([...mobileTop, ...mobileBottom].filter(name => name?.startsWith('nav-')))].sort()).toEqual(navigationNames);
      await page.getByRole('button', { name: 'Schließen', exact: true }).click(); await expect(drawer).toBeHidden();
      await page.getByRole('button', { name: 'Menü öffnen', exact: true }).click();
      await drawer.getByRole('link', { name: 'Kunden', exact: true }).click();
      await expect(page).toHaveURL(/\/customers$/); await expect(drawer).toBeHidden();
      await page.goBack(); await expect(page).toHaveURL(/\/dashboard$/); await expect(drawer).toBeHidden();
    }
    expect(unexpectedWrites).toEqual([]);
    expect(await prisma.invoice.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.income.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.expense.count({ where: { userId: user.id } })).toBe(0);
  } finally {
    try { await page.close(); }
    finally { await prisma.user.deleteMany({ where: { id: user.id, email: user.email } }); }
  }
});
