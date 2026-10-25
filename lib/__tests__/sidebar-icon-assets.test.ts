import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { SidebarIcon, type SidebarIconName } from '@/components/brand/sidebar-icon';

const names = [
  'nav-dashboard', 'nav-invoices', 'nav-quotes', 'nav-reminders',
  'nav-customers', 'nav-incomes', 'nav-expenses', 'nav-cashbook',
  'nav-eur', 'nav-assets', 'nav-tax', 'nav-settings', 'nav-users', 'nav-logout',
  'bivaro-sidebar',
] satisfies SidebarIconName[];

it.each(names)('keeps %s decorative and backed by genuine transparent generated artwork', async name => {
  const markup = renderToStaticMarkup(createElement(SidebarIcon, { name, size: name === 'bivaro-sidebar' ? 40 : 28 }));
  expect(markup).toContain('aria-hidden="true"');
  expect(markup).toContain(`data-bivaro-sidebar-icon="${name}"`);
  expect(markup).toContain(`/brand/icons/sidebar-flat/${name}.webp`);
  expect(markup).not.toContain('<img');

  const file = path.join(process.cwd(), 'public/brand/icons/sidebar-flat', `${name}.webp`);
  const image = sharp(await readFile(file));
  const metadata = await image.metadata();
  const stats = await image.stats();
  const dimension = name === 'bivaro-sidebar' ? 192 : 128;
  expect(metadata).toMatchObject({ width: dimension, height: dimension, hasAlpha: true });
  expect(stats.channels[3].min).toBe(0);
  expect(stats.channels[3].max).toBeGreaterThanOrEqual(250);
});

it('uses alpha masks and inherited state ink without changing the dashboard artwork family', async () => {
  const css = await readFile(path.join(process.cwd(), 'app/globals.css'), 'utf8');
  const sidebarRules = css.match(/^\s*\.sidebar-icon \{([^}]+)\}/m)?.[1] ?? '';
  expect(sidebarRules).toContain('background: currentColor');
  expect(sidebarRules).toContain('mask-mode: alpha');
  expect(sidebarRules).toContain('mask-size: contain');
  expect(sidebarRules).not.toMatch(/filter:|gradient|clip/);

  const navigation = await readFile(path.join(process.cwd(), 'components/navigation/nav-links.tsx'), 'utf8');
  expect(navigation).not.toContain('<BivaroIcon');
  const palette = await readFile(path.join(process.cwd(), 'components/command-palette.tsx'), 'utf8');
  expect(palette).toContain('<BivaroIcon');
  expect(palette).not.toContain('SidebarIcon');
});
