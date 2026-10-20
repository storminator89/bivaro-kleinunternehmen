import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const theme = vi.hoisted(() => ({ resolvedTheme: undefined as string | undefined, setTheme: vi.fn() }));
vi.mock('next-themes', () => ({ useTheme: () => theme }));
import { ThemeToggle } from '@/components/theme-switch';

describe('theme toggle initial hydration accessibility', () => {
  it('keeps initial accessible attributes identical before the stored/system theme is known', () => {
    const attributes = [];
    for (const resolved of [undefined, 'light', 'dark']) {
      theme.resolvedTheme = resolved;
      const html = renderToStaticMarkup(createElement(ThemeToggle));
      expect(html).toContain('aria-label="Farbschema wechseln"');
      expect(html).toContain('title="Farbschema wechseln"');
      expect(html).not.toContain('Farbschema aktivieren');
      attributes.push(html.match(/aria-label="[^"]*" title="[^"]*"/)?.[0]);
    }
    expect(new Set(attributes).size).toBe(1);
  });
});
