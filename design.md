# Design — Bivaro

Locked design system for the Bivaro application. Future design work reads this
file first and keeps the product visually consistent across routes.

## Genre

Modern-minimal with a utilitarian, calm and trustworthy tone.

## Macrostructure family

- Marketing pages: Marquee Hero followed by alternating product-tour rows.
- App pages: Ledger workspace with a split task toolbar, dark side navigation, direct data surfaces, and four comparable financial metrics.
- Content pages: Long Document with restrained rules and generous reading measure.

## Theme

Bivaro Ledger palette · cool off-white canvas · white data surfaces · dark evergreen navigation · mint selected navigation · emerald actions · Inter product UI. The teal logo colour is part of the action
family rather than a separate decorative accent; blue is reserved for neutral
information states and charts.

```css
:root {
  --color-paper: #FFFFFF;
  --color-paper-2: #F3F7FA;
  --color-paper-3: #F1F5F8;
  --color-ink: #12202C;
  --color-ink-2: #34465A;
  --color-rule: #E2E9ED;
  --color-rule-2: #7C8D9F;
  --color-muted: var(--bivaro-color-muted);
  --color-accent: var(--bivaro-color-accent);
  --color-accent-ink: oklch(100% 0 0);
  --color-brand-teal: oklch(68% 0.12 174);
  --color-focus: #006B46;

  --font-display: var(--font-newsreader), ui-serif, Georgia, serif;
  --font-body: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, monospace;

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.7, 0, 0.84, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --dur-micro: 120ms;
  --dur-short: 180ms;
  --dur-long: 300ms;

  --radius-card: 1rem;
  --radius-input: 0.625rem;
  --radius-pill: 999px;
}
```

## Typography

- Marketing display: Newsreader, weight 500–600, always roman.
- Product headings and body: Inter, weights 400–700, self-hosted with next/font.
- Numbers: Inter with tabular numerals; money is right-aligned where compared.
- Mono is reserved for keyboard shortcuts, identifiers and technical values.

## Spacing

Use the named 4-point scale in `tokens.css`. A page owns exactly one outer
container. Nested pages must not introduce a second full-page gutter.

## Component voice

- One containment layer per task or data block; avoid cards nested in cards.
- App surfaces use crisp white panels against a cool off-white canvas.
- Navigation is consistently dark evergreen, with mint selection and light text.
- Page headers put their primary task action to the right, without a marketing-style hero.
- The overview leads with four metrics: income, expenses, profit (all year-to-date), and currently outstanding invoices. Monthly and lifetime figures are disclosed below the annual comparison.
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

`tokens.css` is canonical; the examples below are portable adapters. The app uses
white global surfaces and a separate cool page canvas in AppShell. Dark mode is
defined centrally in tokens.css, with the same component API.

### tokens.css

```css
:root {
  color-scheme: light;

  --color-paper: #FFFFFF;
  --color-paper-2: #F3F7FA;
  --color-paper-3: #F1F5F8;
  --color-ink: #12202C;
  --color-ink-2: #34465A;
  --color-rule: #E2E9ED;
  --color-rule-2: #7C8D9F;
  /* Stable aliases avoid collisions with shadcn's utility-level accent/muted. */
  --bivaro-color-muted: #5F7087;
  --bivaro-color-accent: #006B46;
  --color-muted: var(--bivaro-color-muted);
  --color-accent: var(--bivaro-color-accent);
  --color-accent-hover: #005538;
  --color-accent-ink: oklch(100% 0 0);
  --color-brand-teal: oklch(68% 0.12 174);
  --color-nav-surface: #06251F;
  --color-nav-hover: #123A31;
  --color-nav-text: #C6D8D4;
  --color-nav-muted: #BDCFCA;
  --color-nav-rule: #21443A;
  --color-nav-active: #79E1AB;
  --color-nav-active-ink: #06251F;
  --color-feature-surface: oklch(25% 0.047 174);
  --color-feature-ink: oklch(98% 0.008 174);
  --color-feature-muted: oklch(80% 0.035 174);
  --color-feature-rule: oklch(40% 0.035 174);
  --color-focus: #006B46;
  --color-chart-cyan: oklch(57% 0.11 205);
  --color-chart-magenta: oklch(61% 0.13 335);

  --color-success: #087B50;
  --color-success-ink: #08613F;
  --color-success-surface: #E1F5E9;
  --color-warning: #B66A10;
  --color-warning-ink: #87500D;
  --color-warning-surface: #FFF4DF;
  --color-danger: #C7353F;
  --color-danger-ink: #A32630;
  --color-danger-surface: #FDEBED;
  --color-info: #2563EB;
  --color-info-ink: #1D4FB8;
  --color-info-surface: #EAF1FF;

  --text-md: 1rem;
  --text-page-title: 2rem;
  --layout-sidebar: 15rem;
  --layout-topbar: 4rem;
  --layout-content: 100rem;
  --color-chart-previous: #5D957C;

  --font-display: var(--font-newsreader), ui-serif, Georgia, serif;
  --font-body: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, monospace;

  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
  --text-3xl: 1.875rem;
  --text-4xl: 2.25rem;
  --text-5xl: 3rem;
  --text-display: clamp(2.25rem, 3vw + 1rem, 4rem);
  --text-display-s: clamp(2rem, 2.4vw + 1rem, 3rem);

  --space-3xs: 0.125rem;
  --space-2xs: 0.25rem;
  --space-xs: 0.5rem;
  --space-sm: 0.75rem;
  --space-md: 1rem;
  --space-lg: 1.5rem;
  --space-xl: 2.5rem;
  --space-2xl: 4rem;
  --space-3xl: 6rem;

  --spacing-0: 0;
  --spacing-1: 0.25rem;
  --spacing-2: 0.5rem;
  --spacing-3: 0.75rem;
  --spacing-4: 1rem;
  --spacing-5: 1.25rem;
  --spacing-6: 1.5rem;
  --spacing-8: 2rem;
  --spacing-10: 2.5rem;
  --spacing-12: 3rem;
  --spacing-16: 4rem;
  --spacing-20: 5rem;
  --spacing-24: 6rem;

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.7, 0, 0.84, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --dur-micro: 120ms;
  --dur-short: 180ms;
  --dur-long: 300ms;

  --radius-card: 1rem;
  --radius-input: 0.625rem;
  --radius-pill: 999px;
  --shadow-card: 0 1px 2px color-mix(in oklch, var(--color-ink) 7%, transparent);
  --shadow-floating: 0 16px 36px color-mix(in oklch, var(--color-ink) 12%, transparent);
}
```

### Tailwind v4

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--color-ink);
  --color-primary: var(--bivaro-color-accent);
  --color-border: var(--color-rule);
  --font-sans: var(--font-body);
  --radius-md: var(--radius-input);
  --radius-lg: var(--radius-card);
}
```

### DTCG tokens.json

```json
{
  "color": {
    "canvas": { "$value": "#F3F7FA", "$type": "color" },
    "surface": { "$value": "#FFFFFF", "$type": "color" },
    "ink": { "$value": "#12202C", "$type": "color" },
    "primary": { "$value": "#006B46", "$type": "color" },
    "sidebar": { "$value": "#06251F", "$type": "color" },
    "selected": { "$value": "#79E1AB", "$type": "color" }
  },
  "font": { "body": { "$value": "Inter", "$type": "fontFamily" } },
  "radius": {
    "control": { "$value": { "value": 10, "unit": "px" }, "$type": "dimension" },
    "surface": { "$value": { "value": 16, "unit": "px" }, "$type": "dimension" }
  }
}
```

### shadcn/ui

```css
:root {
  --background: var(--color-paper);
  --foreground: var(--color-ink);
  --card: var(--color-paper);
  --card-foreground: var(--color-ink);
  --primary: var(--bivaro-color-accent);
  --primary-foreground: var(--color-accent-ink);
  --muted: var(--color-paper-3);
  --muted-foreground: var(--bivaro-color-muted);
  --border: var(--color-rule);
  --input: var(--color-rule-2);
  --ring: var(--color-focus);
  --radius: var(--radius-card);
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

## Whole-product refinement · 15 October 2026

Continue Bivaro Ledger; do not rotate theme between pages. Use a consistent compact page header with one primary action, explicitly scoped totals, quiet filter bars and a single containment layer. Lists, editors, reports and long documents may have different layouts within the same token system. Remove ornamental gradients, oversized icon tiles and repeated page gutters. Preserve every existing data and security contract. New UI must have keyboard focus, named inputs, truthful loading/empty/error states, mobile layouts and reduced-motion support.

## BIVARO Design System 2.0 · 17 October 2026

This section supersedes the older profit-led dashboard direction in the history
above. The supplied dashboard, invoice and income mockups define the product
visual language. Keep the existing component boundaries, routes and financial
calculations. Use `PageHeader`, `MetricCard`, `TrendIndicator`,
`LedgerListHeading`, `QueryFeedback` and existing shadcn primitives.

- Evergreen sidebar 240px, topbar 64px, content gutter 40px on wide screens,
  24px on tablets, 16px on phones.
- Inter product typography: 32px page titles, 20px list titles, 14px body,
  12px metadata floor; 24px page titles on phones.
- 16px surfaces and 10px controls, subtle borders and shadows.
- The font variable classes belong on the html element: root-level token
  aliases must resolve the next/font variables on the same element.
- Semantically assessed trends: direction and positive/negative meaning are
  separate. Zero comparison denominators show an unavailable indicator.
- Annual comparison has labelled euro axes, a legend, keyboard-accessible
  tooltips and a tabular alternative. The independent year selector compares
  full historical calendar years and keeps the current-year comparison to date.
  Never invent account balances or deadlines.
- Income, expense and quote query failures have explicit retry controls;
  unavailable totals show a dash instead of a false zero.
- Muted ink is #5F7087 (4.69:1 on the cool canvas); the reference #64748B
  was slightly adjusted for small-text contrast. Previous-year chart marks
  use #5D957C for visibility, with a separate labelled legend.
- Public pages retain the Newsreader display voice; authenticated product
  headings use Inter throughout. No decorative notification icon without a
  working data source. Global command navigation is available on mobile.

See `docs/design/BIVARO-2.0-2026-10-17.md` for migration scope, verification and
remaining differences from the mockups.

## Dataset controls · 17 October 2026

`YearComparison` has an independently labelled year selector. Selecting a year
updates only the comparison; current headline KPIs, thresholds and activities
retain their scope. Historical years use all twelve months and a full-year
footer. Current-year comparison keeps its existing to-date behavior. The active
analysis tab survives year changes. Loading and retry feedback keep the selector
available and hide mismatched old-year values.

`LedgerSortControl` and `SortableLedgerHead` share six options: date, amount and
description in either direction. Date descending remains the default. Income
and expense queries sort the entire filtered dataset before pagination, using
an ID tie-breaker. Sort changes return to page one; resetting filters restores
the default ordering. The same selected order is visible on desktop and mobile.

## Individuelle Icon-Familie · 17. Oktober 2026

Die Sidebar behält die bestätigten 14 individuell generierten Emaille-Symbole in Waldgrün und Mint. Das Marken-Zeichen verwendet in der dunklen Sidebar eine separate helle, flache Variante; diese gilt auch für die mobile und eingeklappte Navigation. Die öffentliche Marke und das Favicon behalten ihre vorhandene Variante.

Dashboard-Kacheln, Aktivitäten, Beleglisten, Formularüberschriften und Auswertungen verwenden zwölf separat generierte flache Motive. Die zentrale Komponente `DashboardIcon` stellt ihre Alpha-Umrisse einfarbig und ohne Glanz, Texturen oder räumliche Schattierungen dar. Die gedeckte Akzentfarbe ist `#456F62`, im dunklen Farbschema `#A5BFB3`. Die sichtbare Bildfläche ist höchstens 32 px groß. Beschriftungen und Zahlen haben Vorrang vor der Illustration.

Quellen, alle Einzelprompts, Exportpipeline, Screenshots und aktueller Deployment-Nachweis: [Flache Dashboard-Icons](docs/design/BIVARO-Icons-Flat-2026-10-17.md). Die ursprüngliche Icon-Familie und ihre Generierungsnachweise bleiben unter [BIVARO-Icons](docs/design/BIVARO-Icons-2026-10-17.md) dokumentiert.

## Minimaler Text · 21. Oktober 2026

- Arbeitsseiten beginnen mit Titel, Daten und Aktion. Keine Bedienungsprosa, die sichtbare Felder oder Schaltflächen wiederholt.
- Kurze Feldnamen und kompakte Statuswerte; Erklärung nur auf Abruf oder bei einem konkreten Fehler.
- Einrichtung und optionale Konfigurationen sind zunächst geschlossen. Hauptaktionen öffnen den benötigten Arbeitsbereich direkt.
- Null-Prüfpunkte beanspruchen keine eigenen Aufgabenzeilen. Unbekannte oder unvollständige Daten dürfen dadurch nicht als geprüft erscheinen.
- Steuer-, Zahlungs-, Kosten- und Versandbestätigungen bleiben vor der tatsächlichen Aktion erreichbar und eindeutig. Fachliche Dokumente und Druckinhalte bleiben vollständig.
- Bestehende BIVARO-2.0-Tokens, Schriftarten und Komponenten gelten weiter.
- Hallmark pre-emit critique: Philosophy 5, Hierarchy 5, Execution 4, Specificity 5, Restraint 5, Variety 4.
