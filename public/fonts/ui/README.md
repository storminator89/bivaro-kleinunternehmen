# UI fonts

These are the unchanged WOFF2 payloads previously served by `next/font/google`:

| Family | Embedded version | Normal CSS weights | Files |
| --- | --- | --- | --- |
| Inter | 4.001; git-66647c0bb | 100–900 | 7 |
| Geist Mono | 1.701 | 100–900 | 6 |
| Newsreader | 1.003, optical size 16 pt | 500 and 600 | 3 |

`manifest.json` records every versioned Google Fonts CDN source URL, SHA256,
length, subset and preload flag. Each source response was independently fetched
over HTTPS and compared byte-for-byte with the previously generated font asset.
No font was converted, renamed internally, subsetted or substituted.

`app/fonts.css` preserves the previous 22 font-face declarations: 19 web faces
(Newsreader's three payloads are shared by weights 500 and 600) and three metric
fallbacks. All original Unicode ranges, weight/style declarations, `swap`
behavior and fallback metrics are retained. The root layout preloads the same
three Latin payloads with anonymous CORS and the request's CSP nonce. All font
network access is unnecessary during builds; browsers request only same-origin files.

## Licensing

Each family includes the official Google Fonts distribution's SIL Open Font
License 1.1 notice in its directory. Source URLs and notice hashes are recorded
in the manifest. These fonts remain under OFL-1.1, separately from the
application's license. The original embedded copyright notices are unchanged:

- Inter: Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter).
- Geist Mono: Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font.git).
- Newsreader: Copyright 2020 The Newsreader Project Authors (http://github.com/productiontype/Newsreader).

Font updates require an explicit review of source/license hashes, original
coverage, optical-size behavior, CSS/fallback descriptors and fresh browser
visual acceptance; do not replace these files with invoice fonts or synthetic
font-loader mock responses.
