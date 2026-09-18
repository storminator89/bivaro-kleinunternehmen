# Official e-invoice validation harness

This harness regenerates all XML from the current application generator and
then validates the generated CII with the official KoSIT/XRechnung release
`v2026-08-31`:

* CII 16B XML Schema (XSD)
* EN 16931 CII Schematron (SVRL)
* XRechnung 3.0.2 CII Schematron (SVRL) for XRechnung fixtures

Positive fixtures include standard VAT, same-rate tax grouping, rounded lines,
mixed 19%/7% rates, explicit `E` exemption reasons, `Z` zero-rated tax,
§19 UStG small-business mode, price precision, quantity precision, and a
Factur-X shared EN 16931 case. Negative controls are mutations of freshly
generated XML for missing IBAN, inconsistent header net total, missing
exemption reason, invalid currency, and missing XRechnung buyer reference.

The harness is deliberately strict: positive fixtures must be XSD-valid and
produce no fatal or warning SVRL assertions. Informational guidance is still
reported; the intentionally absent delivery-date case records KoSIT's
`BR-DE-TMP-32` information result without failing the case. Negative controls
must fail the official rules and, where stable, include their targeted rule
IDs. Missing Python packages or rule artefacts stop the run with an actionable
error.

## Run

The repository already has the pinned review environment under
`/tmp/bivaro-einvoice-review`:

```bash
node --experimental-strip-types scripts/einvoice-validation/run.mjs
```

To use another isolated environment or rules directory:

```bash
node --experimental-strip-types scripts/einvoice-validation/run.mjs \
  --rules /path/to/xrechnung-3.0.2-validator-configuration-2026-08-31 \
  --python /path/to/venv/bin/python3 \
  --output /tmp/my-einvoice-validation
```

The rules release can be downloaded from the official
[KoSIT configuration release v2026-08-31](https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/tag/v2026-08-31).
Install `lxml` and `saxonche` into the isolated Python environment. Do not
vendor the release, Python environment, Java runtime, or veraPDF into this
repository. A temporary output directory is used by default so the original
audit fixtures and results remain unchanged.

The runner imports `lib/invoice-calculation.ts` and refuses to replace it with
a harness calculation. It has a TypeScript ESM bridge for Node versions that
cannot resolve the application's `@/` aliases or extensionless TypeScript
imports directly.
