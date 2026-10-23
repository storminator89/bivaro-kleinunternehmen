import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('settings logo upload presentation', () => {
  it('contains the keyboard-reachable hidden file input in its local upload wrapper', () => {
    const css = readFileSync('components/settings/settings-page.module.css', 'utf8');
    expect(css).toMatch(/\.logoUpload\s*\{[^}]*position:\s*relative/u);
    const hidden = css.match(/\.logoUpload > :global\(input\[type="file"\]\)\s*\{([^}]+)\}/u)?.[1] ?? '';
    for (const rule of ['position: absolute', 'width: 1px', 'height: 1px', 'min-width: 0', 'min-height: 0', 'padding: 0', 'margin: 0', 'border: 0', 'clip-path: inset(50%)']) expect(hidden).toContain(rule);
    expect(hidden).not.toMatch(/display:\s*none|visibility:\s*hidden/u);
    expect(css).toContain('.logoUpload:has(input:focus-visible) .uploadControl');
    expect(readFileSync('app/settings/page.tsx', 'utf8')).toMatch(/id="logo-upload"[\s\S]*?className="sr-only"/u);
  });
  it('gives narrow restore preview content the full alert width without hiding overflow', () => {
    const css = readFileSync('components/settings/settings-page.module.css', 'utf8');
    expect(css).toContain('.restorePreview { padding-inline: var(--space-sm); }');
    expect(css).toContain('.restorePreview > :global([data-slot="alert-description"]) { grid-column: 1 / -1; min-width: 0; width: 100%; }');
    expect(readFileSync('app/settings/page.tsx', 'utf8')).toContain('className={`${styles.restorePreview} mt-4`}');
  });
});
