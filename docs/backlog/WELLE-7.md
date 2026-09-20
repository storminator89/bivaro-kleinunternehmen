# Welle 7 – Abschlussnachweis für BV-011, BV-025 und BV-030

Stand: 20.09.2026, 21:29 Europe/Berlin. Auditbasis:
`85972ed9fe61d268b6640882ea2ddc6e616d1859`.
Die Backlogquelle `/home/pmeyhoefer/Downloads/Bivaro_Agent_Backlog.json`
wurde nur gelesen und bleibt unverändert. Der Arbeitsbaum enthält weiterhin
uncommitted Änderungen aus Welle 5 und Welle 6 sowie den technischen Scheiben
für diese drei Tickets; diese Dokumentation erzeugt keinen Commit.

Diese Welle führt den Abschlussnachweis für BV-011, BV-025 und BV-030. Die
Akzeptanzkriterien sind wörtlich aus der Backlogquelle übernommen. Ein
Akzeptanzkriterium erhält erst nach einem konkreten Agenten-/Root-Nachweis mit
Fixture, Ist-/Soll-Ergebnis, Testbefehl, Zeitpunkt und Commit- oder
uncommitted-Stand den Status `belegt`. Die dokumentierte Welle-6-Baseline von
342 bestandenen Tests, 1 Skip und 12/12 E2E ist Vergleichsstand und wird nicht
als neue Evidenz für diese Welle gezählt.

## Status und Abschlussgrenze

| Ticket | Sichtbare Scheibe | Matrixstand | Status |
|---|---|---:|---|
| BV-011 | Atomarer chronologischer Kassen-Guard mit Centarithmetik sowie Rollback-/Paralleltestdatei | 4/4 belegt | `complete` (technischer Ticketabschluss) |
| BV-025 | Striktes Business-Date für manuelle Einnahmen in Web, v1 und UI sowie Auditgrenze | 4/4 belegt | `complete` (technischer Ticketabschluss) |
| BV-030 | Gemeinsamer Read-Snapshot für JSON/ZIP, Manifest-Metadaten und Dateiversionsprüfung | 4/4 belegt | `complete` (technischer Ticketabschluss) |

Die Scheiben und Testdateien sind als Arbeitsbaum-Befund sichtbar. Root-/Agenten-
Nachweise schließen alle drei Tickets technisch ab. Der gemeinsame Endlauf
bestätigt die Arbeitsbaum-Integration; die dokumentierte Abgrenzung behauptet
kein Produktivdeployment, keine GoBD-Zertifizierung und keine darüber
hinausgehende fachliche Freigabe.
Fachliche, Betreiber- und produktive Freigaben werden nur dokumentiert, wenn
sie als konkrete, verlinkte Evidenz vorliegen; zusätzliche Freigaben werden
nicht als technische AC-Voraussetzung erfunden.

## BV-011 – Negative Zwischenstände der Barkasse atomar verhindern

Quelle: Backlogkriterium `BV-011`; erwartete Methode Integration/Regression;
Besitzer laut Quelle: Accounting Backend.

| AC | Exaktes Kriterium aus der Quelle | Erwarteter Nachweis | Status |
|---|---|---|---|
| BV-011-AC1 | Gegeben Nullbestand und Barausgabe; wenn gebucht wird, dann erhält der Nutzer einen Fachfehler und der Bestand bleibt null. | Isolierte Kassen-Fixture: Fachfehler, unveränderter Bestand, keine Buchung und kein Audit-Teilbeleg. Gezielter Lauf `cashbook-nonnegative` + `bookkeeping-integrity`, 23/23 am 20.09.2026 21:20:02. | belegt – Root-Nachweis |
| BV-011-AC2 | Gegeben späteren positiven Endsaldo; wenn eine frühere Ausgabe einen negativen Zwischensaldo erzeugt, dann wird trotzdem abgelehnt. | Chronologische Fixture mit späterer Einzahlung; Ablehnung und unveränderte betroffene Zeilen/Salden im gezielten 23/23-Lauf belegt. | belegt – Root-Nachweis |
| BV-011-AC3 | Gegeben zwei gleichzeitige Ausgaben, die einzeln gedeckt sind; wenn beide zusammen nicht gedeckt wären, dann darf höchstens eine wirksam werden. | Zwei-Prisma-Client-Race mit konkurrierenden Mutationen; höchstens eine Buchung wird wirksam. Gezielter Lauf 23/23 am 20.09.2026 21:20:02. | belegt – Root-Nachweis |
| BV-011-AC4 | Gegeben gültige Einlage vor einer Ausgabe; wenn beide verbucht werden, dann stimmen jeder Zwischenstand und der Abschluss centgenau. | Centgenaue Einlage-/Ausgabe-Fixture mit Zwischen- und Endsalden; MoneyPolicy-Rundung 10,075 auf 10,08 im korrigierten Lauf belegt. | belegt – Root-Nachweis |

Die technische Beschreibung in `docs/backlog/BV-011.md` wird als Kontext
geführt; sie ist ohne ausgeführten, paketbezogenen Nachweis keine Erledigung
der vier Kriterien.

## BV-025 – Zahlungsdatum bei manueller Einnahme verbindlich übernehmen

Quelle: Backlogkriterium `BV-025`; erwartete Methode Integration/Regression;
Besitzer laut Quelle: Domain/Database Engineer.

| AC | Exaktes Kriterium aus der Quelle | Erwarteter Nachweis | Status |
|---|---|---|---|
| BV-025-AC1 | Gegeben eine Nachbuchung mit Datum 31.12.; wenn im Januar gespeichert wird, dann bleibt 31.12. das fachliche Zahlungsdatum. | 2-Dateien-/6-Tests-Lauf mit derselben Payload unter einem Januar-Datefake; Web und v1 speichern den Business-Date-Wert `31.12.` unverändert. | belegt – Agenten-/Root-Nachweis |
| BV-025-AC2 | Gegeben ungültiges oder fehlendes Datum; wenn gespeichert wird, dann antwortet die API mit einem Feldfehler statt still das heutige Datum einzusetzen. | Web antwortet mit Feldfehler `date`; v1 antwortet mit `error.field = date`; kein Heute-Fallback. 2 Dateien/6 Tests grün. | belegt – Agenten-/Root-Nachweis |
| BV-025-AC3 | Gegeben Web- und API-Anlage derselben Eingabedaten; wenn verglichen wird, dann liefern beide dasselbe Datum. | Gleiche Payload und derselbe Business-Date-Vertrag in Web/v1 unter dem Datefake; 2 Dateien/6 Tests grün. | belegt – Agenten-/Root-Nachweis |
| BV-025-AC4 | Gegeben möglicherweise falsch datierten Altbestand; wenn Migration läuft, dann werden Prüfhinweise erzeugt und keine historischen Daten geraten. | Migration `20260920150000_income_date_review` prüft bestehende `Income`-Zeilen mit `invoiceId = null`, einschließlich Cash-Links/Mitternacht, erzeugt genau ein `REVIEW`-Audit mit ISO-`originalDate`, `rawDate`, `guessedDate: null` und userId-gebundenem Duplikatguard. Pre-Upgrade-Fixture enthält nur Schema/Migrationen plus Seed; zweimaliger Deploy lässt Datum unverändert und erhält den Hinweis. | belegt – Agenten-/Root-Nachweis |

Die technische Beschreibung in `docs/backlog/BV-025.md` grenzt den manuellen
Income-Pfad und die fehlende Rückdatierung ab; sie ersetzt keine Ausführung der
vier Kriterien.

## BV-030 – Konsistentes Snapshot-Backup statt unabhängiger Tabellenreads

Quelle: Backlogkriterium `BV-030`; erwartete Methode Integration/Regression;
Besitzer laut Quelle: Platform + Database Engineer.

| AC | Exaktes Kriterium aus der Quelle | Erwarteter Nachweis | Status |
|---|---|---|---|
| BV-030-AC1 | Gegeben parallele Zahlung während Backup; wenn restauriert wird, dann enthält der Stand entweder vor oder nach dem vollständigen Ereignis, nie dessen Hälfte. | `backup-snapshot-route.test.ts` restauriert das echte ZIP in einen leeren Zielmandanten derselben isolierten temporären Test-DB; Invoice/Income/Counter/Audit sind vollständig Vor- oder Nachzustand. Gezielter Agentenlauf über 4 Dateien/18 Tests grün. Ein BV-064-Empty-Host-Drill ist nicht Teil dieses Nachweises. | belegt – Agenten-/Root-Nachweis |
| BV-030-AC2 | Gegeben Dateiänderung während Backup; wenn Originaldatei gesichert wird, dann stimmt ihr Hash mit der referenzierten Version überein. | Dateidrift führt zu HTTP 409; Hash und `sourceVersion` sind gebunden und werden im gezielten 4-Dateien-/18-Tests-Lauf geprüft. | belegt – Agenten-/Root-Nachweis |
| BV-030-AC3 | Gegeben Snapshotstart/-ende; wenn Manifest geprüft wird, dann ist der Konsistenzpunkt eindeutig dokumentiert. | Manifest enthält `snapshot.id`, Start, Ende und `single-read-transaction`; gezielter Lauf 4 Dateien/18 Tests grün. | belegt – Agenten-/Root-Nachweis |
| BV-030-AC4 | Gegeben langes ZIP-Packen; wenn normale Buchungen eintreffen, dann hält die Packphase keinen vermeidbaren globalen Schreiblock. | Gate zeigt Zahlung vor Packfreigabe abgeschlossen; Snapshot-Transaktion endet vor dem Packen. Gezielt 4 Dateien/18 Tests grün. | belegt – Agenten-/Root-Nachweis |

Die technische Beschreibung in `docs/backlog/BV-030.md` wird als Kontext
geführt. Sie macht aus implementierten Pfaden ohne ausgeführten Nachweis keine
vollständige AC-Abnahme.

## Nachweislog

Nach der abschließenden Formulierung der Datumsfehlermeldung wurden die beiden
betroffenen Browserfälle erneut mit Productionbuild ausgeführt: 2/2 bestanden
in 10,8 Sekunden. Gezieltes ESLint blieb grün. Der
[Screenshot des Datumsfeldfehlers](evidence/welle-7/income-date-field-error.png)
wurde visuell geprüft. Die Altbestandsmigration liegt bereit und wurde in
isolierten Upgrade-Fixtures geprüft; sie wurde in dieser Abschlusswelle nicht
auf `prisma/dev.db` angewandt.

| Zeitpunkt | Änderung | Evidenzstand |
|---|---|---|
| 20.09.2026 | Welle 7 und die 12 Kriterien umfassende Matrix für BV-011, BV-025 und BV-030 abgeschlossen. | BV-011 4/4 mit 23/23, BV-025 4/4 mit 2 Dateien/6 Tests einschließlich Pre-Upgrade-Fixture, BV-030 4/4 mit 4 Dateien/18 Tests. Gemeinsamer Endlauf: 47 Testdateien, 346 Tests + 1 Skip, Lint/Typecheck grün, E2E 12/12. Keine Test-, Build-, E2E- oder Datenbankausführung durch die Dokumentationsarbeit. |
