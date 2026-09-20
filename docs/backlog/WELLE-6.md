# Welle 6 – Bootstrap-Nachweis, Money-Grundlage und Versandstatusschutz

Stand: 20.09.2026, finaler Root-Teststand vor fachlicher Abnahme. Auditbasis:
`85972ed9fe61d268b6640882ea2ddc6e616d1859`. Git-Basis der laufenden
Dokumentation: `0208c62f26ff60cf855dfef21e74e0ff6466e7c9` (`main`) plus die
uncommitted Welle-5-Scheiben. Die Backlog-Quelle
`/home/pmeyhoefer/Downloads/Bivaro_Agent_Backlog.json` wurde nur gelesen.

Diese Welle hält die drei geplanten Pakete mit ihrer tatsächlichen Grenze fest.
Die Dokumentationsarbeit hat keine Tests, Builds, E2E-Läufe, Datenbankprobes,
Migrationen oder produktiven Versand gestartet. Die Welle-5-Änderungen werden
nicht überschrieben. Der finale Root-Teststand ist dokumentiert; fachliche
Prüfung, Betreiberentscheidung und produktive Freigabe bleiben davon getrennt.

## Pakete und Status

| Ticket / Paket | Priorität und Abhängigkeiten | Tatsächlicher Welle-6-Scope | Status und offene Grenze |
|---|---|---|---|
| BV-035 / `bootstrap_w6` | P1; keine Backlog-Abhängigkeit. P0-Grundlagen bleiben zuerst nachweisbar, weil ein offener Erstadminpfad den kontrollierten Start gefährdet. | Bootstrap-Proof mit serverseitigem Setup-Nachweis, atomarem Verbrauch mit Erstadminanlage, Konkurrenzschutz, Neustart-Sperre und additiver Migration, die bestehende Nutzerinstallationen als verbraucht markiert. Zusätzlich globale Admin-SMTP-Einstellungen mit verschlüsseltem Passwort und ENV-Fallback. | Technische Teilumsetzung; Bootstrap-Suite 12/12 und SMTP-/Versandintegration 7/7 grün, E2E deckt Speichern, Reload, Passwortbeibehaltung, Löschen und Backup-Secretprüfung ab. Fachliche Prüfung und Recovery-Runbook bleiben offen. |
| BV-012 / `money_w6` | P1; BV-001 und BV-029 sind Backlog-Abhängigkeiten. Die P0-Start-/Backup-Grundlagen und ein lesbarer Reconciliation-Bericht müssen vor einer späteren Mutation belastbar sein. | Exakte EUR-Cent-Grundlage mit signierter Halbcent-Rundung, Overflow-/Strict-Checks und read-only Migrationsbericht über die Prisma-Floatfelder. Kein Backfill, keine globale Umstellung und keine stille Normalisierung von Bestandsdaten. | Technische Teilumsetzung; gezielte Money-/Migrationsbericht-Suite 11/11 grün, darunter das unabhängige Referenzgitter 2/2 mit 40.001 signierten Beträgen mit drei Nachkommastellen (Millieuro) und großen Cent-Strings. Globale Migration, fachliche Prüfung und AC4 bleiben offen. |
| BV-047 / Root-Schutzkorrektur | P1; Backlog nennt BV-046 als Abhängigkeit. Die Prüfung ist bewusst auf den Status-Race beim Versand begrenzt und schließt BV-046s Outbox nicht ab. | `lib/email-delivery.ts` enthält eine uncommitted, transaktionale Schutzscheibe: ein SMTP-Annahmebeleg wird über eine Message-ID dedupliziert, ein zulässiger DRAFT→SENT-Schritt prüft den aktuellen Zustand, und abweichende PAID-/CANCELLED-Statuswerte werden als Konflikt im Audit erhalten. Ein DB-Fehler nach SMTP-Annahme wird über HTTP 502 mit `smtpAccepted`/`retryUnsafe` explizit gemacht. | Technische Teilumsetzung; Root meldet 7/7 isolierte Integrationstests mit vollständig gemocktem SMTP, echter isolierter Prisma-DB sowie gezieltem ESLint. Der Beleg bestätigt SMTP-Annahme, keine Zustellung; E2E und Screenshot sind geprüft, Outbox und fachliche Prüfung bleiben offen. |
| BV-046 | P1; Backlog-Abhängigkeit BV-045. BV-047s begrenzte Schutzkorrektur ist davon unabhängig und ersetzt keine Outbox. | Kein Outbox-Worker, kein Lease-/Retry-/Dead-letter-Modell und kein belastbarer uncertain-SMTP-Zustand in dieser Welle dokumentiert. | `proposed_unimplemented`; alle vier BV-046-ACs und die fachliche Freigabe bleiben offen. |

## Zusatzscope: SMTP- und Admin-Einstellungen

Der Welle-6-Auftrag wurde um eine UI-nahe Betriebsgrundlage ergänzt. Für den
Bootstrap-/Hostbereich sind ein globaler Admin-SMTP-Datensatz mit verschlüsseltem
Passwort und ENV-Fallback, eine Admin-only-Route und eine Settings-UI sichtbar;
Secrets werden beim Lesen nicht ausgegeben. Root-E2E deckt Speichern, Reload,
Passwortbeibehaltung, Löschen und Backup-Secretprüfung ab. `money_w6` hat die
SMTP-Oberfläche umgesetzt. Der Money-Migrationsbericht ist ausschließlich als
CLI verfügbar; eine Money-Berichtsoberfläche wurde nicht umgesetzt. Der
Zusatzscope versendet keine Testmails und ändert nicht die BV-046-Outbox-
Abgrenzung. Eine benutzer- oder tenantbezogene SMTP-Konfiguration bleibt ein
separater Zusatzscope.

## Backlog-Akzeptanzfälle und Nachweisgrenze

Die Quelle führt für BV-035 folgende offenen Fälle: Ohne gültigen Setup-Nachweis
darf keine öffentliche Registrierung einen Administrator anlegen (AC1); ein
gültiges Token muss in derselben Transaktion verbraucht werden (AC2); zwei
gleichzeitige Aufrufe dürfen genau einen Erstadmin erzeugen (AC3); nach
Neustart müssen Erstregistrierung geschlossen und das alte Token unwirksam sein
(AC4).

Für BV-012 sind die vier Fälle nur technisch begrenzt belegt: Die gemeinsame
Rundung für 0,1/0,2, Halbcent und große Beträge (AC1) hat ein unabhängiges
Referenzgitter; der Bericht jeder normalisierten Altbestandsdifferenz (AC2)
ist read-only angelegt; kein stilles Abschneiden oder Overflow (AC3) ist in
der Money-Policy abgegrenzt. Die centgenaue Übereinstimmung von UI, API, Kasse,
EÜR und Restore (AC4) bleibt offen, ebenso Backfill und globale Migration.

Für BV-047 ist die Status-Race-Scheibe mit Root-Integrationstests belegt, aber
kein AC vollständig freigegeben: PAID darf nach DRAFT-Laden und Versandabschluss
nicht zurückgesetzt werden (AC1); ein paralleles Storno muss bestehen bleiben
und einen Konflikthinweis erzeugen (AC2); ein normaler Erstversand muss ein
Versandereignis mit zulässiger Statusprojektion erzeugen (AC3); ein doppeltes
Abschlussereignis muss idempotent bleiben (AC4). E2E, produktiver Versand und
fachliche Freigaben bleiben offen.

## Priorisierung und Abhängigkeiten

Die Reihenfolge folgt den P0-Grundlagen: Start-/Upgrade-Sicherheit (BV-001),
Backup-/Snapshot-Integrität (BV-029/BV-030) und Finanz-Auditgrenzen (BV-006)
bilden den Betriebsrahmen. BV-012 darf auf dieser Basis eine exakte,
prüfbare Reconciliation vorbereiten, aber eine irreversible Bestandsmigration
erst nach sichtbaren Differenzen, fachlicher Entscheidung und separatem
Freigabenachweis beginnen. BV-035 schützt den kontrollierten Erststart und
braucht einen echten Konkurrenz- und Neustartnachweis. BV-047 adressiert einen
konkreten Status-Race, bevor eine vollständige BV-046-Outbox mit Lease,
Retrybudget und uncertain-Zustand gebaut wird; die Schutzkorrektur darf
deshalb nicht als Erledigung von BV-046 oder als allgemeiner Versandgarant
ausgelegt werden.

## Test- und Freigabestand

Für BV-035 meldet Root am 20.09.2026 um 20:56:22 12/12 Tests in drei
isolierten Testdateien grün. Abgedeckt sind fehlender Setup-Nachweis,
atomarer Verbrauch und Rollback, Neustartpersistenz, parallele Erstadminaufrufe
und die explizite Freischaltung normaler Registrierung. Die Migration bleibt
additiv und markiert bestehende Nutzerinstallationen als verbraucht.

Für BV-012 meldet Root am 20.09.2026 um 21:01:08 11/11 Tests grün. Die Suite
prüft die exakte Money-Policy, den read-only Bericht über die Prisma-Money-
Felder, die Ablehnung von SQL-Schreibversuchen auf read-only-Verbindungen,
Query-only-Schutz nach Fehlern sowie die CLI-Schutzfälle für fehlende bzw.
nicht lesbare Datenbankziele. Das unabhängige Referenzgitter umfasst 40.001
signierte Beträge mit drei Nachkommastellen (Millieuro) sowie große Cent-String-Roundtrips. Node meldete
dabei nur einen Modul-Typ-Performancehinweis; die Suite endete erfolgreich.

Für BV-047 meldet Root am 20.09.2026 um 21:05:40 7/7 isolierte
Integrationstests mit gemocktem SMTP und echter isolierter Prisma-Datenbank:
SMTP-Annahmebeleg mit serieller und paralleler Message-ID-Deduplizierung,
konkurrierendes PAID- und CANCELLED-Race, Auditfehler-Rollback mit Retry und
Fremdtenant-Schutz. Ein gezieltes ESLint war grün. Es wurde keine echte Mail
versendet; der Beleg bestätigt keine Zustellung. Outbox und SMTP-exactly-once
sind nicht Teil dieses Nachweises.

Das belegt die technische Grundlage, keine globale Umstellung oder
Bestandsmigration. Die SMTP-Einstellungs-Suite besteht zusätzlich mit 7/7 Tests.
Der abschließende Root-Gesamtcheck am 20.09.2026 um 21:08:13 war mit 46 bestandenen Testdateien (eine weitere übersprungen), 342
bestandenen Tests und 1 Skip grün; `npm run lint` hatte 0 Warnungen und
`npx tsc --noEmit` endete erfolgreich. Der E2E-Lauf bestand mit 12/12 und
Productionbuild um 21:06:40 in 28,6 s. Die SMTP-UI-Fälle für Speichern,
Reload, Passwortbeibehaltung, Löschen und Backup-Secretprüfung sind enthalten.
Nach einer Screenshot-Korrektur wegen des Stickyheaders bestand der gezielte
Nachlauf mit 2/2 und Productionbuild in 14,3 s; die SMTP-Karte ist visuell
sauber. Der dauerhafte Nachweis liegt als
[SMTP-Einstellungs-Screenshot](evidence/welle-6/smtp-settings.png) vor.
Die beiden Welle-6-Migrationen wurden ausschließlich auf isolierten Fixtures
und in E2E angewandt, nicht auf `prisma/dev.db`.

Die zuletzt belegte Welle-5-Gesamtprüfung bleibt Vergleichsbasis: 39
Testdateien, 309 Tests bestanden, 1 Skip, Lint ohne Warnungen, Typecheck grün
und E2E 11/11 mit Productionbuild. Diese Zahlen werden nicht als Welle-6-
Evidenz wiederverwendet. Für jeden Endnachweis bleiben Fixture, Soll-/Ist-
Ergebnis, Testbefehl, Zeitpunkt und uncommitted/Commit-Stand zu verlinken.
Keine fachliche, rechtliche, Betreiber- oder produktive Freigabe ist aus diesem
technischen Teststand abgeleitet. Es wurde nichts committed.

## Änderungslog

| Zeitpunkt | Änderung | Evidenz / Status |
|---|---|---|
| 20.09.2026 | Welle 6 als begrenzte Dokumentations- und Implementierungsscheibe für `bootstrap_w6`, `money_w6` und die Root-Schutzkorrektur zu BV-047 angelegt. | Dieses Dokument; fachliche AC-/Prüfung und produktive Freigabe bleiben getrennt vom grünen technischen Teststand. |
| 20.09.2026 | BV-012 auf exakte Grundlage und read-only Migrationsbericht begrenzt; Money-/Migrationsbericht-Suite 11/11 und unabhängiges Referenzgitter 2/2 mit 40.001 signierten Beträgen mit drei Nachkommastellen (Millieuro) und großen Cent-Strings grün. Read-only-SQL-Schreibschutz und Query-only-Fehlerpfad geprüft. | Keine Backfill-/globale Money-Umstellung und keine vollständige AC-Abnahme behauptet. |
| 20.09.2026 | BV-035 Bootstrap-Suite 12/12 in drei Testdateien grün; additive Migration markiert bestehende Nutzerinstallationen als verbraucht. | Betreiber-/Produktivfreigabe und Recovery-Runbook offen. |
| 20.09.2026 | BV-047 als begrenzte, von BV-046 unabhängige Status-Race-Schutzkorrektur mit 7/7 Root-Integrationstests aufgenommen. | `lib/email-delivery.ts` und Aufrufer uncommitted; SMTP-Annahmebeleg ohne Zustellnachweis, kein echter Mailversand, keine Outbox und fachliche Prüfung offen. |
