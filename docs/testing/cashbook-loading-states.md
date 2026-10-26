# #83: Kassenbuch – initialer Listenabruf

## Lokaler Kandidat, 26.10.2026

Teilimplementierung für GitHub #83, nicht BV-083 und keine vollständige
Ticket-/Browserabnahme. Quellbasis: Provider-Main
`fc92ca5070c5b2cbbd9b0e3c2d292106f3b49fb7`, exakter Tree
`ba499c560b00d60d21dc98f7051ff2626391acc3`. Der Provider-Commit fehlt im lokalen
Objektbestand; der **synthetische, elternlose lokale Basiscommit**
`16c20192b47285b7108d5571325c3f7b8c29f820` enthält ausschließlich diesen exakten
Tree und ist ausdrücklich nicht der Provider-Commit. Isolierter Worktree:
`bivaro-cashbook-loading-states-83`.

## Begrenzte Änderung

- Der gemeinsame `Kassenbuch`-Header bleibt beim initialen Laden, Fehler und
  Lese-Retry sichtbar. `Neue Kasse` ist ohne bestätigte Liste deaktiviert.
- Ein zugänglicher Ladehinweis (`status`, `aria-busy`) und ein eigener
  Listen-Lesefehler mit `alert` unterscheiden unbekannte Daten von leerer Liste.
- `Erneut versuchen` führt ausschließlich einen neuen `GET /api/cashbook` aus.
  Ein synchroner Ref-Guard verhindert Doppelaktivierungen vor dem nächsten
  React-Render. Kein erneutes Ausführen einer Mutation.
- Nur ein erfolgreicher, validierter Listenabruf mit `[]` zeigt
  `Kein Kassenbuch vorhanden` und `Kassenbuch erstellen`. Fehlerhafte JSON-/DTO-
  Antworten und 401/403-Antworten erzeugen keine leere Kasse oder falschen Salden.
  IDs müssen positiv/eindeutig sein; Zahlen, Anzahl und übrige DTO-Felder werden
  geprüft. Nullable Beschreibungen und zusätzliche Metadaten bleiben zulässig.
- Gültige Auswahl und vorhandene Zusammenfassungen bleiben intern erhalten;
  während expliziter Wiederherstellung oder nach Listenfehler werden sie nicht
  als aktuelle Daten angezeigt. Nur die neueste Anfrage darf Daten, Fehler oder
  initialen Ladestatus ändern; Effect-Cleanup verwirft veraltete Antworten.

Unverändert: Finanzberechnungen, Mutations-/Exporthandler, Buchungs- und
Tagesleser, Dialoghandler, API-/Auth-/Datenbankverträge, Abhängigkeiten, README,
Workflows, Hosting sowie alle übrigen Selector-Zuordnungen. Die neue genaue
Cashbook-Zuordnung enthält fünf Titel und verlangt bestehende Fixture-, Runner-,
Login-, Core- und Unit-Verträge; fehlende Verträge sperren die Zuordnung.
Finanz-API-Änderungen erhalten dadurch keine pauschale Browserfreigabe.

## Tatsächliche lokale Prüfungen

Node **24.22.1**, vorhandene Abhängigkeiten wiederverwendet. Keine Installation
und keine Prisma-Clientgenerierung.

| Prüfung | Ergebnis |
| --- | --- |
| `vitest run lib/__tests__/cashbook-view-regressions.test.ts scripts/__tests__/focused-browser-selection.test.ts` | **2 Suites / 67 Fälle bestanden**, keine Skips. Bestehende Auswahl-/Mutationsrefresh-/Edit-Label-Verträge bleiben enthalten. |
| ESLint für Page, Cashbook-Regression, neue E2E-Datei sowie Selector/Selector-Regression, `--max-warnings 0` | Exit 0, keine Warnungen. |
| Eingegrenzte TypeScriptprüfung derselben TS-/TSX-Pfade und transitiver Imports, `incremental: false`, 1536-MiB-Cap | Exit 0. |
| `git diff --check` | Bestanden. |

Die Node-Tests prüfen die tatsächlichen Page-Handler/Effects mit In-Memory-Hooks
und vollständig gemocktem Fetch. Kein Server, Browser, API-Endpunkt oder
Datenbankversuch wird dadurch gestartet. Abgedeckt: wartende Liste, bestätigt
leere Liste, HTTP-/Netzwerk-/JSON-/DTO-Fehler, expliziter GET-Retry samt
Doppelaktivierung, gültige DTO-Varianten, Strict-Mode-Effect-Replay mit später
Altantwort sowie Auswahl und schreibfreie Wiederherstellung nach fehlgeschlagenem
Mutations-Summary-Refresh. Selector-Tests prüfen genaue Titel, Pflichtverträge
und weiterhin gesperrte unbekannte Finanzpfade.

Lokale Logs im übergeordneten Workspace:

- `bivaro-cashbook-loading-states-83-unit.log`, SHA-256
  `c4f521d5f3bc3ffbfc16d1d853f6e6726ed9e5cd74f61c968c17e26a7f06cf71`.
- `bivaro-cashbook-loading-states-83-lint.log` und
  `bivaro-cashbook-loading-states-83-types.log`: leer bei Exit 0, jeweils SHA-256
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- Reproduzierbarer Scope: `bivaro-cashbook-loading-states-83.tsconfig.json`
  im übergeordneten Workspace; kein vollständiger Repository-Build behauptet.

## Browsernachweis bleibt offen

`e2e/cashbook-loading.spec.ts` enthält **fünf ausschließlich verfasste Fälle**:

1. Je 1440, 360 und 390 px: verzögerter GET → Fehler → Tastatur-Retry → echte
   ownerbezogene Fixture-Daten → Reload; stabiler Header, keine falsche
   Erstellung, kein horizontaler Überlauf und keine Cashbook-Schreibanfrage.
2. Tatsächlich leere Owner-Liste: erst nach erfolgreichem GET darf der
   Erstellungsdialog geöffnet werden, ohne bereits eine Kasse zu speichern.
3. 401/403 sowie syntaktisch/strukturell fehlerhafte erfolgreiche Antworten:
   kein leerer Erstellungszustand, keine falschen Salden; echte Lesewiederherstellung.

Fixture-Schreibzugriffe sind nur für diese künftige Browserabnahme verfasst
und durch den vorhandenen temporären Runner-Datenbankvertrag geschützt.
Die simulierten 401/403-Lieferungen sind **kein Nachweis der Auth-Policy**.

**Kein lokaler Browser-/Serverlauf**, keine Screenshots erzeugt/angesehen,
kein Build-/Fullsuite-/manueller Browserlauf und kein neuer GitHub-CI-Lauf.
Bekannte Umgebungssperre: Socket-`EPERM`; zuvor abgelehnte eskalierte
Browser-Bootstrap-Aktion wurde nicht erneut versucht oder umgangen. Die exakte
Browser-/Responsive-/Tastaturabnahme bleibt ausstehend, ebenso eine gesonderte
Veröffentlichungsfreigabe. Kein Push, PR, neues Issue, Merge, Deployment oder
sonstige Remote-Schreibaktion wurde vorgenommen.
