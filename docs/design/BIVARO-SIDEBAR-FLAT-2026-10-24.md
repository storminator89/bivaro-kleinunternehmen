# Flat sidebar artwork · 2026-10-24

## Scope

Replace only the sidebar's fourteen distinct navigation artworks and its brand
mark with fifteen individually generated transparent flat assets. Preserve the
shared non-sidebar `BivaroIcon`, command palette, public brand, dashboard artwork,
navigation targets, permissions, labels and collapse/mobile behavior.

`SidebarIcon` consumes each image's alpha channel as a CSS mask. Its fill is
`currentColor`, so normal, hover and selected icons follow the same state ink as
their labels. No filter, gradient, cropping or synthesized vector is involved.
Navigation slots remain 28px and the standard brand slot remains 40px. The existing
32px brand treatment below 375px is preserved.

## Theme and contrast

Both app themes currently retain the same forest sidebar palette in `tokens.css`:

| State | Surface | Ink |
| --- | --- | --- |
| Inactive | `#06251F` | `#BDCFCA` |
| Hover | `#123A31` | `#C6D8D4` |
| Active | `#79E1AB` | `#06251F` |

One transparent source per icon is sufficient: the mask inherits state ink rather
than baking in white/green pixels or requiring duplicate light/dark exports.
Anti-aliased boundary pixels naturally have less coverage than the solid interior.
Solid-ink contrast is 10.02:1 inactive, 8.46:1 on hover and 10.19:1 active. The brand
mark follows the existing off-white wordmark (`#F4FFF8`) on the forest surface.

## Provenance and exports

The original PNGs and exact generation prompts are retained alongside an export
manifest. Every source was produced in a separate built-in `image_gen` call with
transparent background. WebP exports preserve the complete source canvas and
alpha, with only uniform resize and format conversion. Existing glossy source
files are not overwritten.

- Originals: `assets/brand/sidebar-flat/*.png` (15 unmodified 1254px RGBA sources).
- Web exports: `public/brand/icons/sidebar-flat/*.webp` (14 at 128px, brand at
  192px; 23,494 bytes combined, all with alpha extrema 0–255).
- [Generation prompts and exact source paths](icon-generation-sidebar-flat-2026-10-24.json).
- [Export hashes, alpha proof and contrast](icon-assets-sidebar-flat-2026-10-24.json).
- Group provenance is retained in `sidebar-flat-provenance/`; all retained
  original SHA-256 values match their exact built-in image-generation result.
- Re-export without image editing: `node scripts/prepare-sidebar-icons.mjs`.
- [Native-size asset preview](sidebar-flat-provenance/asset-preview.png), explicitly
  an inspection-only composition rather than an application screenshot.

## Verification status

- Full `tsc --noEmit --incremental false`, ESLint with zero warnings, and
  `git diff --check` passed for the final code.
- `lib/__tests__/sidebar-icon-assets.test.ts` is authored for future regression
  coverage. It has **not been executed**: local functional tests and new GitHub CI
  runs are prohibited by the user's current verification constraint.
- The unchanged normal `npm run build` passed, including prebuild, production
  compilation, build-time TypeScript, static route generation and the postbuild
  third-party notices guard. It used a complete real private dependency copy;
  no checks were skipped or modified.
- Earlier environment-only attempts failed on an external dependency symlink and
  insufficient disk space. Only explicitly parent-approved completed `.next`
  caches were reclaimed; source, logs, evidence and existing dependencies were
  preserved. A fresh complete dependency copy resolved the build environment.
- The existing E2E icon block is updated for real mask URLs, response types,
  image decoding, alpha, counts, sizes and both themes/state inks. Like the new
  regression test, it is authored but **not executed**.
- All fifteen actual artworks were visually inspected individually at 28px / 40px
  and on forest/mint QA backgrounds. This is image-asset inspection, not an app
  functional test or a hosted screenshot.
- Independent read-only source review found no blocking issue. Its small
  test-only suggestion was incorporated: the brand decode check obtains its URL
  from the rendered mask. Runtime code/assets remain exactly as built; full
  TypeScript and lint were repeated after this test-source change.
- No publication or merge is part of this implementation handoff.

## Hosted-only acceptance plan

After authorized publication on the existing Sites URL:

1. Load the published dashboard, record deployed commit/source and confirm all
   fifteen mask URLs return valid WebP rather than 404 or an HTML response.
2. In light and dark mode inspect expanded navigation: all fourteen meanings,
   unchanged labels/destinations, default ink, hover/focus and selected icon ink.
   In particular, check forest glyphs remain visible on the mint active item.
3. Check reused symbols on history/invoices, today/reminders and inbox/expenses;
   confirm admin users still see Benutzer and non-admins do not.
4. Collapse and re-expand the desktop sidebar, reload the saved collapsed state,
   then navigate via icons. Confirm tooltips, 28px slots, no clipping, 40px compact
   brand and preserved active state.
5. At 375px and a narrow 320px viewport open the mobile drawer in both themes,
   inspect all sections including logout, navigate, close/reopen and use Back.
   Confirm drawer closes as before and navigation has no horizontal overflow.
6. Check decorative icons remain hidden from accessibility names; links/buttons
   retain their existing labels, titles and active-page semantics.
7. Verify the command palette, dashboard icons and public/login brand still use
   their existing non-sidebar assets. Capture expanded, collapsed, active and
   mobile evidence in both themes; report hosted results separately from static
   asset checks, lint/type checks and production build.
