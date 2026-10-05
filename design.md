# Design — Bivaro

Locked design system for the Bivaro application. Future design work reads this
file first and keeps the product visually consistent across routes.

## Genre

Modern-minimal with a utilitarian, calm and trustworthy tone.

## Macrostructure family

- Marketing pages: Marquee Hero followed by alternating product-tour rows.
- App pages: Ledger workspace with a split task toolbar, dark side navigation, direct data surfaces, and a featured financial balance.
- Content pages: Long Document with restrained rules and generous reading measure.

## Theme

Bivaro Ledger palette · cool off-white canvas · white data surfaces · dark evergreen navigation · mint selected navigation · emerald actions · Geist product UI. The teal logo colour is part of the action
family rather than a separate decorative accent; blue is reserved for neutral
information states and charts.

```css
:root {
  --color-paper: oklch(100% 0 0);
  --color-paper-2: oklch(96.8% 0.006 240);
  --color-paper-3: oklch(93.5% 0.010 240);
  --color-ink: oklch(23% 0.022 248);
  --color-ink-2: oklch(36% 0.025 248);
  --color-rule: oklch(89.5% 0.009 240);
  --color-rule-2: oklch(70% 0.018 240);
  --color-muted: oklch(49% 0.025 248);
  --color-accent: oklch(43% 0.12 162);
  --color-accent-ink: oklch(100% 0 0);
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

  --radius-card: 1rem;
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
- App surfaces use crisp white panels against a cool off-white canvas.
- Navigation is consistently dark evergreen, with mint selection and light text.
- Page headers put their primary task action to the right, without a marketing-style hero.
- The overview leads with profit for the total period; secondary numbers retain their time scope.
- Invoice counts label page-scoped status counts explicitly.
- Record lists share a heading, result count and explicitly page-scoped sum.
- Mobile navigation has one entry point in the top bar; avoid a second work-area selector.
- Invoice detail dialogs lead with the amount and status, then dates and source files.
- App surfaces use borders and lightness before shadows.
- Primary actions use the emerald action accent; teal supports brand and progress.
- Status never relies on colour alone: pair colour with text and an icon.
- Inputs, buttons and touch actions are at least 44 CSS pixels high.

## Motion

- Motion-cut by default. Keep functional state transitions only.
- Hover may shift colour or translate by one pixel on fine pointers, never scale.
- Focus indicators appear immediately and remain at least 3:1 against the surface.
- Reduced motion uses an opacity-only transition of at most 150 ms.

## CTA voice

- Primary: emerald fill, paper text, input-radius corners, short verb-first labels.
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

## Detailed workspaces · October 2026

- Dashboard: profit-led balance beside compact monthly indicators; expanded annual comparison and linked recent booking feed below. Every figure comes from the existing accounting queries.
- Tax studio: compact EÜR source context, grouped assumptions and a sticky live result; calculation details and data limitations remain accessible. Mobile keeps the current result within reach.
- Settings: anchored section navigation beside the existing administrative forms; a compact section picker on small screens.
- Customers: quiet desktop directory and contact-led mobile records with the existing edit, notes and deletion flows.
- Verified at 320, 375, 414, 768 and 1440 px with the isolated E2E fixture.
- Hallmark pre-emit critique: Philosophy 4, Hierarchy 5, Execution 4, Specificity 5, Restraint 5, Variety 4.

## Invoice studio

Recipient and document dates precede labelled line editors. Each line keeps its description on a full-width row with quantity, unit, price and tax below; its net amount uses the shared invoice calculation. The desktop rail holds the live net/tax/gross breakdown, output choice, generation controls and optional PDF preview. Template tools are disclosed on demand. Payment and E-invoice references stay in named sections. Mobile stacks the same workflow without horizontal scrolling.
