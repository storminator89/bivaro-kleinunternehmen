# Invoice and quote workspace integration

This draft combines the invoice and quote presentation packages on the same source tree as main `f263e60`. The existing Bivaro Ledger tokens, typography and shell remain authoritative. There are no API, database schema, financial calculation, authentication or payment changes.

## Integration checks

- Both presentation packages integrate without conflicts with the accepted customer and settings redesigns.
- The invoice identity control retains its 44px minimum hit target even against existing global rules. Long desktop quote amounts can wrap instead of widening the page.
- The combined focused unit selection passes 107 tests. Full lint, production build with notice generation, and separate TypeScript checking passed under Node 22. Existing filesystem tracing warnings remain in unchanged modules.
- Hosted functional and visual acceptance is pending. No rendered pass is claimed by this document.

## Declared browser evidence

The added suite uses isolated synthetic accounts and intercepted synthetic long-value list records. It checks widths 320, 375, 414, 768, 1440, 1599 and 1600 in both themes. Eight full-page images cover invoices at 1600/390 and quotes at 1440/390 in light/dark. Existing real financial and conversion suites remain unchanged and run alongside the presentation cases.

All 87 existing screenshot names remain in the allowlist, producing a 95-image union. The 10 MiB compressed aggregate, 16 MiB input, 5 MiB per-file, twelve-minute staging, forty-five-minute job and twenty-five-minute functional limits remain unchanged. Lossless staging uses at most two processes with deterministic output order and unchanged full-pixel and metadata checks. If the actual hosted aggregate does not fit, visual acceptance is incomplete; no cropping, scaling or evidence removal is implied.

This is a draft for review and browser acceptance, not merge or production deployment approval.
