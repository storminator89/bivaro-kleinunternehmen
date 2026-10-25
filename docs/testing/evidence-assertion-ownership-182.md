# Evidence assertion ownership — #182

Base: `2007534a64e6a486b99233dc5e8cd9b1b7e39c17`. Test maintenance only;
no runtime, workflow, evidence-name, timeout, retry, skip or testcase changes.
The reduction is 42 expanded assertions, **zero removed cases**. No measured
runtime improvement is claimed.

## Exact before/after matrix

APT = `scripts/__tests__/browser-apt-setup.test.ts`, case
`retains existing acceptance limits, evidence policy and package trust configuration`.
PNG = `scripts/__tests__/lossless-evidence-png.test.ts`, case
`preserves the exact screenshot count and aggregate limit rather than hiding evidence`.
Cashflow = `scripts/__tests__/cashflow-evidence-bounds.test.ts`, case
`keeps all 95 original proofs and their original budgets`.

| Removed owner / assertion | Count | Surviving owner / equal or stronger contract |
| --- | ---: | --- |
| APT first allowlist length 95 and distinct count 95 | 2 | PNG first allowlist length 95 and distinct count 95 |
| APT eight settings names listed below | 8 | PNG checks every identical basename |
| APT dashboard light/dark × 1440/390 names | 4 | PNG checks the same Cartesian product |
| APT twenty customer/CSV names listed below | 20 | PNG checks every identical basename |
| APT three bank-allocation names listed below | 3 | PNG checks every identical basename |
| APT whole-workflow `limit = 10 * 1024 * 1024`, `per_file_input_limit = 5 * 1024 * 1024`, `total > 16 * 1024 * 1024`, `handle.read(per_file_input_limit + 1)` | 4 | PNG checks these four exact substrings on the same complete workflow string |
| Cashflow whole-workflow `timeout-minutes: 45` | 1 | APT retains the stricter substring `    timeout-minutes: 45` on the same complete workflow string |
| **Total** | **42** | **All remaining cases and unique assertions retained** |

Both allowlist readers select the first `allowed = { ... }` in the unchanged
workflow. APT keeps quoted tokens; PNG removes their surrounding quotes. After
that representation-only normalization, both arrays contain the same 95 names
in the same order. PNG's whitespace-tolerant parser does not depend on the APT
reader's exact indentation. The 41 APT assertions were individually compared
against the surviving PNG assertions using their actual normalized input,
matcher and expected value. The additional timeout implication is explicit
above rather than inaccurately called byte-identical.

### Eight settings basenames

- `settings-redesign-light-1440.png`
- `settings-redesign-light-375.png`
- `settings-redesign-dark-1440.png`
- `settings-redesign-dark-375.png`
- `settings-redesign-backup-light-1440.png`
- `settings-redesign-backup-dark-375.png`
- `settings-redesign-company-saving-light-1440.png`
- `settings-redesign-company-error-dark-375.png`

### Twenty customer/CSV basenames

- `customer-redesign-directory-light-1440.png`
- `csv-redesign-customer-preview-light-1440.png`
- `csv-redesign-article-preview-light-1440.png`
- `customer-redesign-directory-light-375.png`
- `csv-redesign-customer-preview-light-375.png`
- `csv-redesign-article-preview-light-375.png`
- `customer-redesign-directory-dark-1440.png`
- `csv-redesign-customer-preview-dark-1440.png`
- `csv-redesign-article-preview-dark-1440.png`
- `customer-redesign-directory-dark-375.png`
- `csv-redesign-customer-preview-dark-375.png`
- `csv-redesign-article-preview-dark-375.png`
- `customer-redesign-edit-light-1440.png`
- `customer-redesign-edit-bottom-light-1440.png`
- `customer-redesign-edit-top-light-375.png`
- `customer-redesign-edit-bottom-light-375.png`
- `csv-redesign-article-setup-light-1440.png`
- `csv-redesign-customer-mapping-light-375.png`
- `csv-redesign-article-mapping-dark-1440.png`
- `csv-redesign-result-dark-375.png`

### Three bank-allocation basenames

- `bank-allocation-confirmation-1440.png`
- `bank-allocation-move-390.png`
- `bank-allocation-current-origin-360.png`

## Deliberately preserved

Cashflow's length-95 and 10-/16-MiB assertions read the original **prefix**,
not the complete workflow; those narrower contracts are not removed. APT's
receipt names, installer command-stand-in success/failure/settings/cleanup
cases, trust rules and retention remain. PNG's independent 15 Python codec
cases and all cashflow partition/safe-read bounds remain. Whole hosted CI,
browser/native/security and all 256 visual-delivery obligations remain.

## Verification boundary

On 2026-10-25, the three relevant files' five source-read-only cases passed
with installed Vitest, one worker, no cache and a 512-MiB V8 limit; 54 cases
were not selected by the CLI. No local installer, Python codec, database,
server, network, native or browser testcase ran. Scoped ESLint and
`git diff --check` passed. This is not a complete-suite result or hosted
acceptance; the unchanged automatic hosted gates must verify the exact draft
head before acceptance. No merge, deployment or issue closure is implied.
