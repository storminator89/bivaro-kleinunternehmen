# Design — Bivaro

Locked design system for the Bivaro application. Future design work reads this
file first and keeps the product visually consistent across routes.

## Genre

Modern-minimal with a utilitarian, calm and trustworthy tone.

## Macrostructure family

- Marketing pages: Marquee Hero followed by alternating product-tour rows.
- App pages: Workbench with a task-first header, one lead metric and direct data surfaces.
- Content pages: Long Document with restrained rules and generous reading measure.

## Theme

Custom Bivaro Mineral palette · warm porcelain surfaces · deep mineral petrol
actions · geometric sans product UI. The teal logo colour is part of the action
family rather than a separate decorative accent; blue is reserved for neutral
information states and charts.

```css
:root {
  --color-paper: oklch(98.2% 0.012 86);
  --color-paper-2: oklch(95.4% 0.018 86);
  --color-paper-3: oklch(91.8% 0.025 86);
  --color-ink: oklch(22% 0.035 174);
  --color-ink-2: oklch(36% 0.040 174);
  --color-rule: oklch(86% 0.028 88);
  --color-rule-2: oklch(68% 0.050 88);
  --color-muted: oklch(49% 0.035 88);
  --color-accent: oklch(43% 0.120 166);
  --color-accent-ink: oklch(98.2% 0.012 86);
  --color-brand-teal: oklch(68% 0.120 174);
  --color-focus: oklch(48% 0.160 166);

  --font-display: var(--font-newsreader), ui-serif, Georgia, serif;
  --font-body: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, monospace;

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.7, 0, 0.84, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --dur-micro: 120ms;
  --dur-short: 180ms;
  --dur-long: 300ms;

  --radius-card: 0.75rem;
  --radius-input: 0.5rem;
  --radius-pill: 999px;
}
```

## Typography

- Marketing display: Newsreader, weight 500–600, always roman.
- Product headings and body: Geist, weights 400–700.
- Numbers: Geist with tabular numerals; money is right-aligned where compared.
- Mono is reserved for keyboard shortcuts, identifiers and technical values.

## Spacing

Use the named 4-point scale in `tokens.css`. A page owns exactly one outer
container. Nested pages must not introduce a second full-page gutter.

## Component voice

- One containment layer per task or data block; avoid cards nested in cards.
- App surfaces use borders and lightness before shadows.
- Primary actions use the Mineral petrol accent; teal supports brand and progress.
- Status never relies on colour alone: pair colour with text and an icon.
- Inputs, buttons and touch actions are at least 44 CSS pixels high.

## Motion

- Motion-cut by default. Keep functional state transitions only.
- Hover may shift colour or translate by one pixel on fine pointers, never scale.
- Focus indicators appear immediately and remain at least 3:1 against the surface.
- Reduced motion uses an opacity-only transition of at most 150 ms.

## CTA voice

- Primary: mineral-petrol fill, paper text, input-radius corners, short verb-first labels.
- Secondary: quiet outline or ghost treatment with the same height and radius.
- Success is silent when the changed result is already visible.

## Per-page allowances

- Marketing may use the real product screenshot as its only hero enrichment.
- App pages use no decorative enrichment; function and data carry the layout.
- Public navigation is edge-aligned minimal; app navigation is a side rail.
- Public footer is a single inline close, not a multi-column sitemap.

## Exports

- `tokens.css` is the canonical portable source.
- Tailwind v4 consumes the mirrored `--color-*`, `--font-*`, `--text-*`,
  `--spacing-*`, `--ease-*` and `--radius-*` values in `app/globals.css`.
- shadcn variables map paper-2 → background, ink → foreground, accent → primary,
  rule → border/input and focus → ring.
- DTCG mapping follows the same semantic names if a token pipeline is added.

```json
{
  "color": {
    "background": { "$value": "{color.paper-2}", "$type": "color" },
    "foreground": { "$value": "{color.ink}", "$type": "color" },
    "primary": { "$value": "{color.accent}", "$type": "color" },
    "border": { "$value": "{color.rule}", "$type": "color" },
    "focus": { "$value": "{color.focus}", "$type": "color" }
  },
  "radius": {
    "control": { "$value": "0.5rem", "$type": "dimension" },
    "surface": { "$value": "0.75rem", "$type": "dimension" }
  }
}
```
