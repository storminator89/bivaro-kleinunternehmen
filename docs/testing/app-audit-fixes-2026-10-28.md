# Lokale Fehler-, Sicherheits- und Konsistenzprüfung vom 28.10.2026

Historischer Snapshot vor der späteren
[Testqualitätsbereinigung](test-quality-review-2026-10-28.md). Die hier
festgehaltenen Testzahlen bleiben als damalige Evidenz erhalten.

Basis: `982f87ea00c0cb632c6ef716ecd565740e70ee79`. Änderungen sind lokal und
uncommitted. Kein Push, PR, Merge oder Deployment; keine Schemaänderung oder
Datenmigration. Die Prüfung ist eine gezielte Quellcodeprüfung mit fokussierten
Regressionen, keine vollständige Sicherheits- oder Releaseabnahme.

## Bestätigte und korrigierte Befunde

| Bereich | Nachgewiesenes Problem | Korrektur / Code-Evidenz |
|---|---|---|
| Rechnungslisten | Datum, Betrag und Rechnungsnummer wurden erst auf der aktuellen Seite sortiert; dadurch stand etwa der höchste Betrag auf einer späteren Seite. | `lib/invoice-list-sort.ts`, `lib/server/invoice-list.ts`, `app/api/invoices/route.ts`, `lib/record-search/list-contract.ts`: validierte Sortierung des gesamten geprüften/finanziell gefilterten Bestands vor Pagination, stabile ID bei Gleichstand, natürliche Nummernsortierung, Rechnungsdatum mit Uploaddatum als Ersatz. Ohne Sortierparameter bleibt die alte API-Reihenfolge erhalten. |
| Rechnungslisten-Client | Sortierung wurde weder an GET noch an die Fortsetzung der Palettensuche übertragen. | `hooks/use-dashboard-data.ts`, `hooks/use-record-invoice-list.ts`, `components/dashboard/dashboard-content.tsx`: Serverreihenfolge anzeigen, Seite bei Sortierwechsel zurücksetzen, nur explizite Sortierfelder in den privaten POST-Body übernehmen. Verdeckte normale Suchfilter werden nicht versehentlich übernommen; Suchbegriffe bleiben aus URL/Cache-Schlüssel. |
| Löschrückmeldungen | Abgewiesene Löschungen von Ausgabe, Einnahme, Rechnung und Angebot blieben ohne sichtbaren Fehler. | `components/dashboard/dashboard-content.tsx`: API-Grund als Toast, Bestätigungsdialog bei Ablehnung weiter offen; erfolgreiche Löschung vor Listenaktualisierung abschließen und Lesefehler getrennt benennen. |
| Kalendergrenzen | UTC-Kalenderdaten wurden in Einnahmen-/Ausgaben-/Rechnungslisten, ZIP-Exporten und Jahresauswertungen gegen lokale Servergrenzen verglichen; Monatsverschiebung hing ebenfalls von der Zeitzone ab. | Gemeinsame UTC-Grenzen in `lib/business-date.ts`, Kalenderlogik in `lib/accounting.ts` und `lib/tax-summary.ts`, Listen- und Exportrouten verwenden dieselben Grenzen. `lib/server/invoice-list.ts` verwendet sie sowohl für die Prisma-Abfrage als auch für SQL-Kandidaten der privaten Suche, einschließlich Uploaddatum bei fehlendem Rechnungsdatum. |
| Ausgaben-/Kassenbuchdatum | Unmögliche Datumsangaben wie `2026-02-30` wurden still in den März normalisiert. | Gemeinsame Validierung in `lib/business-date.ts` und betroffenen Web-/v1-Ausgaben- sowie Kassenbuch-Schreibpfaden; Multipart-Prüfung vor dem Schreiben einer Datei. Gültige bisherige ISO-/Zeitstempel bleiben akzeptiert. |
| API-Schlüssel | Der String `"false"` konnte einen deaktivierten Schlüssel aktivieren; numerische ID-Präfixe aliasierten andere Werte; ungültige Ablaufangaben konnten unbegrenzte Laufzeit ergeben. | `app/api/api-keys/route.ts`: echte Booleans, positive sichere IDs und streng validierte JSON-Felder, Scopes und Ablaufwerte; fehlerhafte Eingaben ergeben 400. Bestehende gültige REST-/MCP-Verträge bleiben erhalten. |
| Logo-Upload | Ein Multipart-Textfeld anstelle einer Datei erreichte den Dateiverarbeitungsweg. | `app/api/settings/upload-logo/route.ts`: Typprüfung lehnt Text vor Schreibzugriff mit 400 ab. |

Der kanonische Sicherheitsbericht meldet **0 bestätigte ausnutzbare
Schwachstellen in sechs geprüften Oberflächen**. Die Abdeckung ist ausdrücklich
partiell; Restore-, native PDF- und E-Mail-Kernpfade sind nicht vollständig
auditiert. Der Scan ist dem ursprünglichen Basissnapshot zugeordnet; der Host
hat Änderungen des Arbeitsbaums während der Prüfung erkannt. Die späteren
aktuellen Codeänderungen haben eigene gezielte Regressionen. Der kanonische
Bericht liegt außerhalb des Repositorys unter
`~/.codex/state/plugins/codex-security/scans/bivaro-kleinunternehmen/982f87ea00c0cb632c6ef716ecd565740e70ee79_20261028T052220Z_iytg1qmb/report.md`.
Tokenverbrauch des Scanwerkzeugs war nicht verfügbar. Die korrigierten Eingabe-/Zustandsfehler sind konkrete
Robustheitsprobleme; daraus wird keine umfassende Unbedenklichkeit abgeleitet.

## Tatsächliche lokale Nachweise

Die getrennten finalen Anwendungs- und Skriptläufe umfassen zusammen
**64 bestandene Suites / 1 übersprungene Suite, 628 bestandene Tests /
6 übersprungene Tests**. Dies ist die Summe zweier disjunkter Läufe, kein
einzelner Gesamtlauf; Teilmengen und Zeitzonenwiederholungen werden nicht addiert.

- Finaler kombinierter Lauf des geänderten Anwendungsstands: **28 Suites /
  222 Tests bestanden in 13,78 s**. Die nachstehenden fokussierten Teilmengen
  werden nicht zusätzlich auf diesen Gesamtzähler aufgeschlagen.
- UI-/Listenregressionen: **4 Suites / 25 Tests bestanden**. Davon 12 neue
  echte SQLite/API-Fälle in `invoice-list-sorting.test.ts`, 4 bestehende
  Zahlungslistenfälle, 8 Fortsetzungs-/Datenschutzfälle und 1 verhaltensbezogener
  Hook-/Transporttest in `record-invoice-list-sort-client.test.ts`.
- Kalender-/Datumsfälle: **6 Suites / 36 Tests je Zeitzone** unter `UTC`,
  `Europe/Berlin` und `America/Los_Angeles` bestanden. Die gleichen 36 Tests
  werden nicht als 108 verschiedene Fälle gezählt. Die sechs zusätzlichen
  Rechnungsgrenzenfälle decken GET und Paletten-POST für aktuellen Monat,
  Vormonat und Jahr samt Datumsersatz und Tenant-Isolation ab.
- Bestehende Finanz-/Kassenbuchintegration: **4 Suites / 43 Tests bestanden**
  (`cashbook-nonnegative`, `income-business-date`, `invoice-financial-integrity`,
  `service-billing-financial-boundaries`).
- API-Schlüssel und Logo: **2 Suites / 9 Tests bestanden**
  (`mcp-access-keys`, `logo-upload-validation`).
- Sicherheitsgrenzen des Elternagenten: **7 Suites / 69 Tests bestanden**.
  Produktionsabhängigkeiten: `npm audit --omit=dev --audit-level=moderate`
  bestanden, **0 gemeldete Schwachstellen**.
- Vollständiges Repository-ESLint sowie fokussiertes ESLint der bearbeiteten Code-/Testdateien bestanden mit null
  Warnungen; auch der abschließende vollständige Lintlauf bestand.
- `npm run build -- --webpack`: **Exit 0**, einschließlich TypeScript-Prüfung
  und Notice-Postbuild. Bestehende dynamische `createRequire`-Tracingwarnungen
  in PDF-Worker-Pfaden bleiben. Dies ist ausdrücklich der unterstützte
  Webpack-Produktionsbuild, kein bestandener Standard-Turbopack-Build.
- Abschließendes `tsc --noEmit --incremental false`: **Exit 0**; voller
  Lint nach den Selektoränderungen erneut **Exit 0**.
- Vollständige Skripttests `npx vitest run scripts/__tests__`: **36 Suites
  bestanden / 1 übersprungen; 406 Tests bestanden / 6 übersprungen** in
  **52,18 s**. Die zwei gesondert geprüften Selektor-Suites mit 56 bestandenen
  Tests sind darin enthalten, kein zusätzlicher Testzähler.
- `scripts/focused-browser-selection.mjs` und
  `scripts/__tests__/audit-focused-browser-selection.test.ts`: explizite,
  nachweisgebundene Zuordnungen der betroffenen kritischen Pfade. Der finale
  Patch wird als **Core + vier begrenzte Specs**, **0 unbekannte kritische
  Pfade / 0 nicht zugeordnete Quellpfade** erkannt. Fehlende Regressionen,
  Fixture- oder Sicherheitsverträge und fremde kritische Pfade bleiben
  gesperrt; keine automatische Gesamtsuite. Finanz-/UTC-/Exportpfade behalten
  Unit-/CI-Verträge und erhalten dadurch keinen Browserabnahmenachweis.
- Begrenzte Browser-Testentdeckung mit `--list --no-deps`: **genau zwei Fälle**
  (Erstadmin und neue Sortierregression) erkannt. Das ist reine Testentdeckung,
  kein ausgeführter Browsernachweis.

Erste eingeschränkte Unit-/Skripttestversuche scheiterten beim Start lokaler Kindprozesse an
`spawnSync ... EPERM`, weil Prisma keinen Kindprozess starten durfte. Die
freigegebenen Wiederholungsläufe mit unveränderter Fixture-Sicherung
bestanden. Das war ein lokales Ausführungsproblem, kein bestandener Test und
keine Datenbankreparatur. Sämtliche Datenbankversuche nutzten ausdrücklich
neue temporäre SQLite-Fixtures; keine Repository- oder Produktionsdatenbank.


## Lokale Protokolle

Diese Dateien sind flüchtige lokale Ausführungsevidenz unter `/tmp`, keine
persistenten Hosted- oder Releasebelege:

| Prüfung | Lokales Protokoll |
|---|---|
| Kombinierte 28 Suites / 222 Tests | `/tmp/bivaro-audit-20261028-final-tests.log` |
| Unterstützter Webpack-Build | `/tmp/bivaro-audit-20261028-webpack-build.log` |
| Abschließende Typprüfung | `/tmp/bivaro-audit-20261028-types.log` |
| Vollständiger Lint | `/tmp/bivaro-audit-20261028-lint.log` |
| Produktionsabhängigkeiten | `/tmp/bivaro-audit-20261028-dependencies.log` |
| Sicherheitsgrenzen | `/tmp/bivaro-audit-20261028-boundaries.log` |
| Vor Teststart blockierter Sicherheits-Browserlauf | `/tmp/bivaro-audit-20261028-security-browser.log` |
| Reine begrenzte Testentdeckung | `/tmp/bivaro-audit-20261028-browser-discovery.log` |

## Offene Abnahmegrenzen

Der neue begrenzte Browserfall `e2e/invoice-list-sorting.spec.ts` ist verfasst:
gewöhnliche Sortierung über zwei Seiten, Datum/Betrag/natürliche Nummer,
Fortsetzung der Palettensuche, abgewiesenes DELETE mit Dialog/Toast und
unverändertem Datenbankbestand. Ein Browserergebnis und ein synthetischer
Screenshot liegen nicht vor: Schon der vorgeschriebene
Produktionsbuild des Sicherheits-Browser-Runners scheiterte sowohl in der
Sandbox als auch im freigegebenen Wiederholungslauf vor dem ersten Test.
Turbopack konnte beim CSS-Worker-Aufbau keinen lokalen Port binden (`EPERM`).
Das ist eine lokale Ausführungsblockade, weder ein bestandener Browsernachweis
noch ein nachgewiesener Anwendungsfehler. Runner und Schutzbedingungen wurden
nicht abgeschwächt; keine Umgebungsattrappe und keine Timeout-Erhöhung.
Der Standardbuild und beide Browserprüfungen bleiben offen. Der separat
ausgeführte unterstützte Webpack-Build einschließlich Typprüfung sowie die
kombinierten 28 Suites/222 Tests sind bestanden; sie ersetzen diesen
ausstehenden Standard-Build-/Browsernachweis nicht. Die explizite Zuordnung
der kritischen Patchpfade im fokussierten CI-Browserselektor wurde unabhängig
geprüft und durch die genannten Skripttests bestätigt.

Kein vollständiger Repository-Unitlauf, breiter Browser-/Bildlauf,
Native-PDF-Abnahmelauf oder Hosted-/Release-/Produktivnachweis wird behauptet.
Historische Backlog-ACs und Tickets werden durch diesen separaten Wartungscheck
nicht abgeschlossen. Die unveränderten 160 Ticketobjekte behalten die Summen
**3 abgeschlossen / 21 teilumgesetzt / 4 Discovery / 132 vorgeschlagen**.
