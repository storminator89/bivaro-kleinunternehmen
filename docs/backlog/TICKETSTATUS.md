# Zentrale Ticketübersicht

Historischer Ticketstand: 20.09.2026, 21:29:59 Europe/Berlin (Statusdokumentation der damaligen Arbeitswelle)
Audit-/Backlogbasis: `85972ed9fe61d268b6640882ea2ddc6e616d1859`
Quelle: `Bivaro_Agent_Backlog.json` (Originalquelle unverändert)
Öffentliche Zusammenfassung: 22.10.2026, 19:59:21 UTC; Ticketstatus und Integrationscheckpoint sind getrennt datiert.
Historische Git-Basis: `0208c62f26ff60cf855dfef21e74e0ff6466e7c9`; keine Aussage über einen heutigen Deploymentstand.

Diese Übersicht enthält alle 160 Backlog-Tickets. Der Status ist der aktuelle Arbeitsstand dieser Welle und ersetzt weder die im Backlog offenen ACs noch fachliche, rechtliche oder produktive Freigaben. „Vorgeschlagen“ bedeutet ausdrücklich, dass in dieser Welle keine Umsetzung vorliegt. Architektur-Discovery ist separat von Produktimplementierung ausgewiesen.

## Lokaler Integrationscheckpoint: GitHub-Issue #96 vom 23.10.2026, 00:28 UTC

[GitHub-Issue #96](https://github.com/storminator89/bivaro-kleinunternehmen/issues/96)
ist **nicht BV-096**. Alle 160 historischen Ticketobjekte und Statussummen
bleiben unverändert: **3 abgeschlossen / 21 teilumgesetzt / 4 Discovery /
132 vorgeschlagen**. Dieser separate Checkpoint ist **teilweise lokale
Integration**, keine abgeschlossene Hosted-/Browser- oder Releaseabnahme.

Auf Basis `40508a9` wurden 14 freigegebene Lane-Patches ohne Konflikt und ohne
doppelte Abhängigkeitspatches integriert; alle 14 stabilen Patch-IDs stimmen
mit ihren Quellen überein. Integrationsstand:
`98d1ff74019dabc2194004ff64c6fec0cfb30bd0`. Enthalten sind unveränderliche
Bankeingangsbindungen, zahlungsneutrale Rechnungs-Neuzuordnung, geprüfte
effektive Zahlungsprojektionen und Anpassungs-/Stornonachweise, angepasste
Lifecycle-/Buchhaltungsleser, portable Backup-/Restore-Graphen sowie geprüfte
UI-Steuerung und sichere Intent-Wiederaufnahme nach einem Reload.

Verifizierter Code-/Teststand: `bcafb22566f441b4b97225afc1508dbade1117cd`.
Der rein testbezogene Folgecommit gleicht genau vier veraltete Assertions in
drei Dateien ab: spätere Allocation-Migration aus zwei Legacy-Fixtures
ausschließen; KPI-Vertragsmarker und Dashboard-Requestheader auf Version 3.
Darüber hinaus ist der Laufzeitcode gegenüber den freigegebenen Patches
unverändert; die v2-Kompatibilitätserwartungen bleiben erhalten.

Tatsächliche lokale Nachweise unter **Node 22.23.4**: **60 Suites / 1.003 Tests
bestanden in 45,29 s**, einschließlich aller **10 neuen Allocation-Suites /
152 Tests**. SQLite-Versuche nutzten ausschließlich explizite neue temporäre
Fixtures, keine Repository- oder Produktionsdatenbank. Prisma-Schemavalidierung
und Clientgenerierung, vollständiger Lint, vollständige Typprüfung sowie
gewöhnlicher Produktionsbuild einschließlich Notice-Postbuild bestanden
(Exit 0); Lint und Typprüfung wurden nach dem Testabgleich erneut bestanden.
Buildmanifest und Standalone enthalten alle vier Allocation-Routen bzw. das
generierte `BankPaymentBinding`-Modell; der eigene Paketbaum teilt keinen
veränderlichen Prisma-Client. Neun bestehende dynamische
Dateisystem-Tracing-Warnungen bleiben;
dies ist **kein vollständiger Repository-/Native-/Browser-Abnahmelauf**.
Die lokalen Logs `bivaro-issue96-integrated-final-regressions.log` (SHA-256
`c2109c048c91f828963bc58146f658e25c90029938fd9306c4b11d2561189fc7`) und
`bivaro-issue96-integrated-build.log` (SHA-256
`bd6b38b15f525464ca4f6324d480d9beacb45aa1bba6ebc7d7eeef4dfc0ce74a`)
sind lokale Evidenz, keine Hosted-Abnahmebelege.

Die fremde ungetrackte Arbeit `e2e/helpers/bank-allocations.ts` bleibt
unverändert außerhalb der Commits (SHA-256
`11d782cb5db260c76f4269ca99206b6f2edcd16ef3838cd81b78c9653b0726aa`).
Keine lokalen Anwendungsserver-/Browserläufe und keine nativen PDF-/JVM-/
Compiler-/Filter-/Installerläufe; gewöhnliche Typprüfung und Anwendungsbuild
sind die genannten Ausnahmen. Kein Push, PR, Merge, Deployment oder
öffentlicher Kommentar und kein Zugriff auf Produktionsdaten.
**Hosted-/Browserabnahme des exakten Kandidaten und Release-/Produktivabnahme
bleiben offen.** Diese gepaarte Dokumentation wird lokal nach dem verifizierten
Code-/Testcommit vorbereitet; keine Veröffentlichung wird behauptet.

### Veröffentlichung und Recovery-Beobachtung zu #96 vom 23.10.2026, 05:08 UTC

Dieser spätere Stand ergänzt den datierten lokalen Snapshot von 00:28 UTC;
dessen damalige Nichtveröffentlichung ist keine Aussage zum heutigen PR-Stand.
Bestätigt ist der **Draft-[PR #131](https://github.com/storminator89/bivaro-kleinunternehmen/pull/131)**:
Remote-Head `c1ccdf7f77f554cdc1e9169c76dc553eb2fa9ec3`, Tree
`0131b8878f3bc687fecf77fe1bc6b6c004a91b92`, tree-identisch zum lokalen
Commit `82935f614e16614c50401977e6320e436bff5075`, Basis
`40508a91c6258064a2bb219a0b6a897d94032554`. **Keine Gesamt-/Browserabnahme.**

Erste Hosted-Ergebnisse für diesen Remote-Head:

| Prüfung | Tatsächlicher Stand |
|---|---|
| [Own-invoice PDF-A 39902868192](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39902868192) | x64 und ARM erfolgreich, je 13 Konformitätstests bestanden. |
| [Container 39902868219](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39902868219) | x64 und ARM erfolgreich. |
| [CI 39902868184](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39902868184) | Security sowie Lint/Typen bestanden; voller Unit-Lauf: 11 fehlgeschlagen / 3.938 bestanden / 20 übersprungen, fünf Fehlerdateien; Build übersprungen. |
| [Browser 39902868206](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39902868206) | Veraltete v3-Surface-Assertion nach 15 bestandenen Tests fehlgeschlagen; 114 nicht ausgeführt. Keine neue #96-Browserabnahme und keine neuen #96-Screenshots. |

Der lokale Recovery-Commit **`a83657ea09ba20a3c511e3f61ec63171dbd78ce3`**
umfasst acht Code-/Testdateien auf `82935f6`. Neun veraltete Unit-Fixture-Fälle
wurden in drei Testdateien korrigiert: als Zwischenprüfung bestanden 96 reine
Tests und separat ein statischer Allowlist-Test;
53 installerbezogene Tests wurden bewusst **nicht ausgeführt**. Drei weitere
Browser-Testdateien gleichen v3-Surfaces und UI-Token-Assertions ab und erhalten
v2-Kompatibilitätsleser; das ist kein ausgeführter Browsernachweis.

Ein echter KPI-Consumerfehler ließ einen gültigen Serviceentwurf fälschlich
als Rechnungs-Prüffall erscheinen. Die enge Korrektur prüft strikt die
Metadaten-/Nachweisform, ohne den gemeinsamen Validator zu ändern. Fünf Suites
mit 52 isolierten Tests bestanden, einschließlich: echter gültiger Entwurf
**0** Prüffälle, fehlerhafter Entwurf **1**, neue Finanznachweise bzw.
fremde Kundenbindung **1**. Diese fokussierten Nachweise sind keine finale
Gesamtprüfung der Recovery.

**Die lokale Recovery ist abschließend im erlaubten lokalen Umfang geprüft.**
Das unabhängige Runtime-Review hat keinen verbleibenden Befund: gemeinsamer
strikter Validator, Tenant-Grenzen, Leermengen-Guards und Geldarithmetik bleiben
unverändert; Count-Aggregate betreffen nur die bestehende begrenzte Abfrage.
Der finale Regressionslauf bestand **65 Suites / 1.124 Tests in 54,75 s**.
Vollständiger Lint, `tsc --noEmit --incremental false` und gewöhnlicher
Node-22-Build einschließlich Notice-Postbuild bestanden jeweils mit Exit 0;
neun bestehende Tracing-Warnungen bleiben. Lokale Evidenz:
`bivaro-pr131-final-regressions.log`, SHA-256
`f180fba51849721e828bcca454f576821f0c24bfdb2c5bac6752e05fb3ebc833`,
und `bivaro-pr131-recovery-build.log`, SHA-256
`f159b1b406fe7c5d5f7376f3679a47b54467aee7cccfcfd8bd9a66e17af42a25`.
Die fokussierten Zwischenprüfungen werden nicht zusätzlich auf den finalen
Testzähler aufgeschlagen; dies bleibt keine vollständige Repository-/Native-/
Browserabnahme.

**Veröffentlichung des exakten kombinierten Recovery-/Dokumentationskandidaten
und dessen Hosted-Wiederholung stehen noch aus.** Lokales Grün ersetzt keine
Hosted-Abnahme. Hosted-/Browser- und Release-/Produktivabnahme bleiben offen.
PDF-A-/Container-Erfolge sind Hosted-Nachweise, keine lokale Reproduktion;
keine lokalen Browser-/nativen PDF-/JVM-/Compiler-/Filter-/Installerläufe
(gewöhnliche Typprüfung/Build ausgenommen). Diese Dokumentationsänderung
führt weder externe Writes noch neue Hosted-Läufe aus. Alle 160 historischen
Ticketobjekte, Statussummen und älteren Checkpoints bleiben unverändert.

## Integrationscheckpoint vom 22.10.2026, 22:07:35 UTC

Alle 160 historischen Ticketobjekte und Statussummen bleiben unverändert:
**3 abgeschlossen / 21 teilumgesetzt / 4 Discovery / 132 vorgeschlagen**.
GitHub-Issues sind keine BV-Ticket-IDs; dieser Checkpoint bewertet keine
historischen ACs oder fachlichen/produktiven Freigaben neu.

### Gemergte Ghostscript-Entfernung: PR #126 / main

[PR #126](https://github.com/storminator89/bivaro-kleinunternehmen/pull/126)
wurde um **21:46:48 UTC** gemergt. Bestätigte main-Basis ist
`5fdc757971ce98e2351e0ed5cc8ce7da06f9bbd3`, Tree
`a73d13695934f2189636345bcc60f5048900c15e`, mit Parents
`8f9f6264dab78b3f3d4991278df5a23d7a8394ce` und
`48eadab74c4c89839c175c1b5f3f26e964e5e0e1`.
[Issue #118](https://github.com/storminator89/bivaro-kleinunternehmen/issues/118)
und [#127](https://github.com/storminator89/bivaro-kleinunternehmen/issues/127)
sind geschlossen. **Main ist Ghostscript-frei**, belegt durch den exakten
akzeptierten Quellstand und wiederholte native Produktions-/Nicht-root-Prüfungen;
die Anwendung auf main bleibt **AGPL**.

Die exakte **PR-Abnahme von 48eadab7**, nicht eine abgeschlossene Postmerge-Abnahme,
umfasst fünf Workflows / elf Jobs, alle im ersten Versuch erfolgreich:
**3.786 Tests / 20 Skips**, Browser **124 bestanden in 9,4 min**, 177 Bilder
(**42 frische vollständige Originalprüfungen + 135 strikte Wiederverwendungen
wirklich geprüfter Originale**), 62 PDFs / 30 eingebettete XML-Bindungen /
2 separate XML-Dateien und **11 echte Ghostscript-Abwesenheitsereignisse**.
Das sind nicht 177 frische Browseraktionen oder 30 separate XML-Dateien.
Externes finales Evidenzsiegel: `acceptance-48eadab7-exact-current.json`,
**25.382 Bytes**, SHA-256
`c5b7a02934c188023385e2956729329b9bbd585b29a70cbd99646efdc023f555`;
[öffentlicher finaler Nachweis](https://github.com/storminator89/bivaro-kleinunternehmen/pull/126#issuecomment-6352018630).

### Separater Postmerge-Stand: noch keine vollständige Abnahme

| Workflow auf main5fdc | Tatsächlicher Stand |
|---|---|
| CI | [39859981025](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39859981025): erfolgreich |
| Container runtime | [39859980998](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39859980998): erfolgreich |
| Foreign PDF | [39859981089](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39859981089): erfolgreich |
| Docker Publish | [39859981040](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39859981040): erfolgreich; Hosted-Pushes für main/latest/sha-5fdc757 abgeschlossen |
| Own-invoice PDF-A | [39859981032](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39859981032): ARM erfolgreich, x64-Runtime-Setup noch ausstehend |
| Browser acceptance | [39859981099](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39859981099): terminal erfolgreich, 124 bestanden in 9,4 min; Host-Ghostscript-Abwesenheitsprüfung bestanden; UI-/Gesamtabnahme noch offen |

Damit sind **fünf von sechs Workflows** grün; kein Anwendungsfehler ist belegt.
Der aufbewahrte OCI-Index-Digest
`sha256:29634956ef1a868ef66e60e9250364a2353b533b6d322215f57dc6fa51810e35`
ist unabhängig abgeglichen; **keine Live-Registry- oder Deploymentprüfung**
behauptet. PR-Nachweise ersetzen keine noch offene Postmerge-Abnahme.
Produktiver `omit-dev`-Audit: 0; vollständiger Entwicklungspaketbaum: weiterhin
5 hohe Befunde. Sichtbare Capture-/Mock-/Verdeckungs-/Referenz-Ellipsengrenzen,
Hosted-only Quell-/Archiv-/API-/Zustandsbelege sowie fehlende unabhängige
QR-Dekodierung bleiben begrenzt; je neu materialisiertem Stream besteht keine
globale Garantie für dekodierten Speicher.

### Lokales Apache-/DE-EN-Paket: Issue #128

[Issue #128](https://github.com/storminator89/bivaro-kleinunternehmen/issues/128):
Kandidat `57e7e97251cfcff528a1d7f1cd6f6e8a68d58168`, Tree
`73ac556da3a14a2f13af068f409880e20281eed2`, basiert auf main5fdc und umfasst
29 Dateien. Unabhängiges finales Review ohne verbleibenden wesentlichen Befund;
218 README-Links gültig, vollständiges Inventar aus 12 DE/EN-Dateien. Sieben
unveränderte echte Aufnahmen (977.308 Bytes) bleiben ausdrücklich auf `870d73be`
datiert, **keine frischen Runtime-Screenshots**.

Nur dieser lokale Kandidat stellt die Anwendung auf Apache-2.0 um: offizielle
`LICENSE`, 11.358 Bytes, SHA-256
`cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`.
Historische AGPL-Datei und sämtliche Drittpflichten bleiben erhalten; keine
Abhängigkeitsversion geändert. Das aggregierte Standard-OCI-Lizenzlabel ist
explizit leer; separates Apache-Anwendungslabel mit Anwendungsscope, **keine
pauschale Apache-Lizenzbehauptung für das gesamte Image**.

Exakte lokale Checks: 60 fokussierte Tests, **3.786 reine Tests / 27 native
Opt-in-Skips**, 231 Dateien bestanden / 3 Skips; Typprüfung, Lint und gewöhnlicher
Node-22-Produktionsbuild jeweils Exit 0. Neun dynamische Tracing-Warnungen,
kein neuer Buildfehler; Standalone-Nachweise: 21 npm-Pakete / 28 Notices,
24 ergänzende Notices / 9 Runtime-Eingänge. Keine lokalen nativen/JVM-/Browserläufe.
Der Kandidat ist **nicht veröffentlicht, nicht gemergt und nicht hosted abgenommen**;
main ist noch nicht Apache-lizenziert. Diese Dokumentationsänderung startet
keine Builds, Tests oder GitHub-Läufe.

## Test-/Legacy-Audit vom 17.10.2026

Der Test-/Legacy-Audit vom 17.10.2026 dokumentiert den abgeschlossenen
Wartungsscope auf Git-Basis `4b293ff3081455bd7e21f08dbc928e5ffe4cd051`.
Entfernt wurden zwölf bewiesen ungenutzte Frontendmodule samt einem toten
Barrelexport (1.191 Quellzeilen), sechs direkte Abhängigkeiten sowie tote
Helper-/Testzweige. Aktive Kompatibilität bleibt erhalten; neue bzw. stärkere
API-Quota-, Upload- und Rendererprüfungen sichern den tatsächlich verwendeten
Code. Isolierte Upload-Fixtures, belastbare Benchmark-Orakel, temporäre
E2E-Datenbanken, konfigurierbarer Port, Signalweitergabe und Cleanup beheben
reale Test-/Prozessfehler. Browser-Body-Stalls und eine versteckte
Issuer-Fixture-Abhängigkeit sind ohne Abschwächung der fachlichen Assertions
behoben; ein Produktverhaltensfehler wurde nicht nachgewiesen.

Der gemeinsame Vitest-Endlauf mit aktiviertem Benchmark bestand: **58 Dateien,
424 Tests und 0 Skips in 41,73 s**, einschließlich Ghostscript-Konvertierung.
Der reguläre Browser-Endlauf bestand **20/20 in 1,1 min** ohne Retry/Skip;
der separate Security-Browserlauf bestand **1/1 in 12,6 s**. Beide nutzten neue
temporäre Datenbanken und Productionbuilds.
Build, Lint ohne Warnungen, Typecheck, Skriptsyntax, Diff-Whitespace und
Manifest-/Lock-Abgleich sind grün. Zehn Runner-/Fixture-Regressionen sind
bereits in den 424 Tests enthalten. Keine blockierenden Prüffehler verbleiben.

Nichtblockierende Grenzen stehen im Bericht: unbewiesene Maintenance-/Money-/
EÜR-Löschkandidaten bleiben erhalten; der gemeinsame DB-Helfer kann bei einem
Setupfehler ein temporäres Verzeichnis hinterlassen; der CI-Build verwendet
weiter eine relative Dummy-URL und `.mjs` fällt außerhalb der konfigurierten
ESLint-Dateimuster. Historische lokale Integritätsnachweise und die betriebliche
Sicherheitsbewertung bleiben außerhalb dieser technischen Abnahme. Dieser Audit
ändert weder die 160 Ticketstatuswerte noch die Summen
3 abgeschlossen/21 teilumgesetzt/4 Discovery/132
vorgeschlagen oder deren Restkriterien; neue AC-, Remote-CI- oder
Produktivfreigaben werden nicht behauptet.

## Historische Nachweisgrenzen vom 19.09.2026

Ein vollständiger Nachweis historischer lokaler Datenintegrität ist nicht
etabliert. Die betriebliche Integritäts- und Sicherheitsbewertung sowie
Release-/Produktivfreigaben bleiben offen. Technische Tests mit synthetischen
Fixtures ersetzen weder diese Nachweise noch eine fachliche Betreiberabnahme;
eine pauschale Aussage über unveränderte Daten wird nicht getroffen.

## Aktueller Wellenstand

| Statusgruppe | Anzahl | Bedeutung |
|---|---:|---|
| Technischer Abschluss | 3 | BV-011, BV-025 und BV-030: alle vier ticketbezogenen ACs je Ticket durch fokussierte Agenten-/Root-Nachweise belegt; kein Produktivdeployment oder GoBD-Zertifikat behauptet. |
| Teilumsetzung | 21 | Vorherige technische Scheiben, die drei Welle-5-Pakete sowie BV-035/BV-012/BV-047 aus Welle 6 mit gezielten technischen Nachweisen: fachliche, rechtliche oder produktive Freigaben bzw. weiterer Scope bleiben offen. |
| In Arbeit | 0 | Kein Ticket dieser Abschlusswelle bleibt in Arbeit. |
| Architektur-Discovery | 4 | BV-013/BV-014/BV-057/BV-156: Inventar und Plan, keine Produktcodeänderung in dieser Welle. |
| Vorgeschlagen/unbearbeitet in dieser Welle | 132 | Kein belastbarer Implementierungsnachweis in dieser Arbeitswelle; BV-046 bleibt als offene Outbox. |

## Welle 5: Ausgaben-Audit, Restore-Fachinvarianten und Passwort-Bytepolicy

Die Welle-5-Dokumentation führt BV-006 als P0- und BV-031/BV-036
als P1-Pakete. Alle drei Tickets sind technische Teilumsetzungen; kein Ticket
wird ohne Nachweis aller ACs als vollständig geführt.

| Ticket | Besitzer/Paket und gelieferte Scheibe | Tatsächliche Evidenz und offene Punkte |
|---|---|---|
| BV-006 | `finanz_audit_w5`: Ausgabenmutationen in Web, v1 und wiederkehrender Ausführung werden an die finanzielle Audit-Transaktion geführt. | Finanzagent meldet 8/8 gezielte Fälle einschließlich Multipart-Dateibereinigung und v1-`PUT`/`DELETE`-Auditrollback; Root-Review sieht für diesen Scope keine weitere Lücke. Weitere Finanzrouten und dauerhaftes Idempotenzmodell bleiben offen; daher Teilumsetzung. |
| BV-031 | `restore_w5`: Restore-Validierung erhält begrenzte Pfad-/Fehlerbefunde und fachliche Validierungshaken. | 7/7 eigene Restore-Tests und 26/26 Regressionstests bestanden; Root-Review korrigierte Source-ID-Reihenfolge, Cash-Date, negative Bruchteil-Anfangsbestände, Overflow und PAID-Nullbetrag ohne ID. Globale Money-Migration und target-aware Full-Dry-run bleiben außerhalb; fachlicher Restore-Drill und Freigabe offen. |
| BV-036 | `root`: gemeinsame UTF-8-Bytepolicy mit 72-Byte-Grenze für neue Hashes umgesetzt. Historische bcrypt-Verifikation behält die 72-Byte-Trunkierung zur Login-Kompatibilität; neue/änderte Überlänge wird abgelehnt. | Gezielter Endlauf 54/54 auf isolierten Fixtures; Gesamtprüfung 39 Dateien/309 Tests + 1 Skip, Lint/Typecheck grün, E2E 11/11 mit Productionbuild; `password-byte-policy.png` visuell geprüft. Produktive Sicherheitsfreigabe und Änderungsempfehlung für historische Überlänge offen; keine Argon2-Migration. |

Die Dokumentationsprüfung hat keine Tests, Builds, E2E-Läufe, Datenbankprobes
oder Migrationen gestartet. Historische Welle-2/3/4-Testzahlen werden nicht
als Welle-5-Evidenz wiederverwendet.

## Welle 6: Bootstrap-Nachweis, Money-Grundlage und Versandstatusschutz

Die Welle-6-Dokumentation führt die geplanten Pakete
`bootstrap_w6` (BV-035), `money_w6` (BV-012) sowie eine begrenzte Root-
Schutzkorrektur für BV-047. BV-035 ist technisch als Teilumsetzung mit
additivem Bootstrap-Verbrauchsmarker und Konkurrenz-/Neustartschutz erfasst;
Betreiber- und Produktivfreigabe bleiben offen. BV-012 ist eine technische
Teilumsetzung mit exakter read-only Money-/Reconciliation-Grundlage; Backfill
und globale Umstellung sind ausdrücklich außerhalb. Für BV-047 ist
`lib/email-delivery.ts` als uncommitted technische Scheibe sichtbar; Root
meldet 7/7 isolierte Integrationstests und gezieltes ESLint einschließlich
expliziter HTTP-502-Flags nach SMTP-Annahme und DB-Fehler. BV-047 wird damit
nicht als Abschluss von BV-046 gewertet; die E-Mail-Outbox bleibt offen.
Der Zusatzscope umfasst implementierte Admin-SMTP-Einstellungen mit
verschlüsseltem Passwort und ENV-Fallback. Der Money-Bericht ist ausschließlich
als CLI verfügbar, ohne Money-Berichtsoberfläche. Eine
benutzer-/tenantbezogene SMTP-Konfiguration bleibt separater Zusatzscope. Der
technische Welle-6-Gesamtcheck ist grün.

| Ticket / Paket | Besitzer und sichtbarer Scope | Nachweis und offene Grenzen |
|---|---|---|
| BV-035 / `bootstrap_w6` | `bootstrap_w6`: einmaliger Setup-Nachweis mit atomarem Verbrauch, Konkurrenzschutz, Neustart-Sperre und additiver Markierung bestehender Nutzerinstallationen. | Technische Teilumsetzung; Bootstrap-Suite 12/12 grün. Betreiber-/Produktivprüfung und Recovery-Runbook fachlich nicht geprüft. |
| BV-012 / `money_w6` | `money_w6`: exakte Money-Grundlage und read-only Migrations-/Differenzbericht; 11/11 gezielte Tests einschließlich Referenzgitter mit 40.001 signierten Beträgen mit drei Nachkommastellen (Millieuro). Admin-Policy/Bericht-Zusatz ohne Testmails dokumentiert. | Keine globale Money-Migration, kein Backfill und keine vollständige AC-Abnahme; fachliche Reconciliation und Verbraucherabgleich nicht geprüft. |
| BV-047 / Root-Schutzkorrektur | Transaktionaler SMTP-Annahmebeleg mit Message-ID-Deduplizierung, konservativer Statusprojektion und HTTP-502-Flags `smtpAccepted`/`retryUnsafe` in `lib/email-delivery.ts`; PAID-/CANCELLED-Konflikte bleiben im Audit. | Uncommitted; Root meldet 7/7 isolierte Integrationstests mit gemocktem SMTP und gezieltes ESLint. Der Beleg bestätigt SMTP-Annahme, keine Zustellung; E2E, Outbox und fachliche Prüfung offen; technische Teilumsetzung. |
| BV-046 | Keine Outbox-Implementierung in dieser Welle. | Worker, Lease, Retrybudget, uncertain-SMTP-Zustand und alle vier ACs offen; Status `proposed_unimplemented`. |

Der finale Root-Teststand ist dokumentiert: 46 Testdateien, 342 bestandene
Tests, 1 Skip, Lint mit 0 Warnungen, Typecheck grün, E2E 12/12 mit
Productionbuild und gezielter Screenshot-Nachlauf 2/2 mit Productionbuild.
Die Welle-5-Basis von 39 Testdateien, 309 bestandenen Tests, 1 Skip und 11/11
E2E bleibt Vergleichsbasis und wird nicht als neue Welle-6-Evidenz ausgegeben.
Die beiden Welle-6-Migrationen wurden nur auf isolierten Fixtures und in E2E
angewandt. Eine darüber hinausgehende Betriebsfreigabe wird nicht behauptet.
Fachliche,
rechtliche, Betreiber- und produktive Prüfungen bleiben davon getrennt.

## Welle 7: AC-Abschlussmatrix für BV-011, BV-025 und BV-030

Die Welle-7-Dokumentation führt die zwölf Backlogkriterien der
drei Welle-3-Tickets einzeln. Root-/Agenten-Nachweise belegen BV-011 mit 23/23,
BV-025 mit 2 Dateien/6 Tests einschließlich Pre-Upgrade-Fixture und BV-030 mit
4 Dateien/18 Tests. Der gemeinsame Endlauf umfasst 47 Testdateien, 346 Tests
und 1 Skip, warnungsfreies Lint, grünen Typecheck und E2E 12/12. Die Welle-6-
Baseline von 342 Tests + 1 Skip und 12/12 E2E ist ausdrücklich keine neue
Evidenz für diese Tickets.

| Ticket | Matrix | Status | Nachweis |
|---|---:|---|---|
| BV-011 | 4/4 Kriterien belegt | `complete` (technischer Ticketabschluss) | Welle 7; Root-Lauf `cashbook-nonnegative` + `bookkeeping-integrity`, 23/23. |
| BV-025 | 4/4 Kriterien belegt | `complete` (technischer Ticketabschluss) | Welle 7; 2 Dateien/6 Tests, Pre-Upgrade-Fixture und idempotenter REVIEW-Hinweis. |
| BV-030 | 4/4 Kriterien belegt | `complete` (technischer Ticketabschluss) | Welle 7; Agenten-/Root-Lauf 4 Dateien/18 Tests, ZIP-Restore, Dateidrift und Manifest-Gate. |

## Implementierte bzw. teilumgesetzte Scheiben

| Ticket | Gelieferter Scope | Offene Punkte | Detail |
|---|---|---|---|
| BV-001/BV-002 | Sichere Start-/Upgrade- und DB-Zielprüfung; technische lokale Scheibe mit synthetischen Fixtures abgeschlossen. Dockerbuild und Konfigurationsprüfung waren erfolgreich. | Release-/Produktivfreigabe, Betreiberfreigaben und sichere betriebliche Bewertung offen. | Bericht |
| BV-008 | Templateclaims auf belegte Fähigkeiten, Betreiberaufgaben und bekannte Grenzen zurückgeführt; Version aus `package.json`; Negativtests ergänzt. | Verlinkte Evidenz, Fachreview, tatsächlicher Verantwortlicher, Release-Commit, Exportabnahme und AC4-Freigabehistorie offen. | [Bericht](BV-008.md) |

## Welle 4: Steuer, EÜR und Kontodeaktivierung

| Ticket | Besitzer und gelieferte Scheibe | Nachweis und offene Grenzen | Detail |
|---|---|---|---|
| BV-007 | `root`: additive Kontodeaktivierung mit `deactivatedAt`; Finanzhistorie und Audit-Referenzen bleiben erhalten; Sessions/API-Keys werden transaktional entzogen. | Gezielter Deaktivierungslauf 5/5, kombinierter Auth-/API-Key-/Deaktivierungslauf 24/24 sowie E2E 11/11 mit Productionbuild und geprüften Screenshots. AC1/AC2 technisch belegt; AC3/AC4, Retention, Legal Hold und Ownernachfolge offen. | [BV-007](BV-007.md) |
| BV-019/BV-020 | `steuer`: vollständige serverseitige Steuer-Summary ohne Listen-Paginierung; gemeinsame Jahresaggregation für Simulation, Dashboard und EÜR-Grundlage. | `tax-summary`- und Accounting-Scheibe testet 101 Einnahmen/1.001 Ausgaben, Zahlungsdatum und AfA; die Steuer-Summary-Route besteht 3/3 Integrationstests für Mandantentrennung, Authentifizierung, mehr als 100 Buchungen und nicht unterstützte Kombinationen. API-/UI-Abnahme, Verlustsonderfälle und fachliche Steuerfreigabe offen. | [Prüfplan](PRUEFPLAN-GOBD-RECHT.md) |
| BV-021/BV-024 | `steuer`: jahresbezogene Tarifparameter, §35-Begrenzung, Gewerbeertrag-Hunderterabrundung, Soli-Minimum und Tarif-Endrundung. | Unabhängiges BigInt-Referenzgitter: 4 Tests mit 1.000.004 Vergleichswerten für 2025/2026 bestanden. Steuerberaterprüfung, weitere Veranlagungsfälle und produktive Freigabe offen. | [Prüfplan](PRUEFPLAN-GOBD-RECHT.md) |
| BV-022/BV-023 | `steuer`: unterstützte Jahre und begrenzter Fallumfang explizit; unbekannte Jahre werden abgelehnt, Sozialparameter sind jahrbezogen. | Aktuell sind 2025/2026 technisch unterstützt. Joint Assessment, weitere Einkünfte, Verlustvortrag/-rücktrag und andere Sonderfälle bleiben außerhalb und müssen fachlich bestätigt werden. | [Prüfplan](PRUEFPLAN-GOBD-RECHT.md) |
| BV-026/BV-027 | `eur`: signierte Korrekturen/Erstattungen in der gemeinsamen Accounting-Summe, jahresversionierte EÜR-Arbeitsunterlage mit Mappingversion, Kontrollsummen und Quellenhinweisen. | Gezielter Welle-4-Lauf mit 7 Dateien/76 Tests (inkl. Mapping und Export-Accounting) bestanden. Nur CSV-Arbeitsunterlage; kein ELSTER-Import. Formularzeilen, AfA-Anlagearten und fachliche Exportabnahme offen. | [Prüfplan](PRUEFPLAN-GOBD-RECHT.md) |

Die Welle-4-Nachweise sind technische Teilumsetzungen. Der [Welle-4-Bericht](WELLE-4.md)
und der [Prüf- und
Abnahmeplan für GoBD, Steuer und Recht](PRUEFPLAN-GOBD-RECHT.md) führt die
verbindlichen Betreiber-, Fach- und Rechtsprüfungen auf. Er ersetzt keine
fachliche Freigabe und behauptet keine allgemeine GoBD-Konformität.

## Welle 2: technische Teilumsetzungen

| Ticket | Besitzer und Scheibe | Offene Punkte | Detail |
|---|---|---|---|
| BV-003 | `betriebssicherheit`: erste vertikale Rechnungsscheibe mit serverseitiger Löschsperre und transaktionalem Finanz-Audit für Web/v1-Service; UI zeigt den Serververtrag und lässt nur DRAFT/UNISSUED ohne Income löschen. | Technische Scheibe mit 21/21 Zieltests und 7/7 E2E abgeschlossen; vollständiges Journal/Refund, Backup-/Restore-/weitere Schreibwege, API-/SMTP-Races und fachliche/produktive Freigaben offen. | [Detailbericht](BV-003-006.md), Welle 2 |
| BV-004 | `betriebssicherheit`: AC1-Guard gegen PAID-Reopen und Statusrücknahme technisch umgesetzt. | AC2–AC4, vollständiges Zahlungsjournal/Gegenereignis, Erstattungen und BV-014/BV-005-Abhängigkeiten offen. | Welle 2 |
| BV-006 | `betriebssicherheit`: erste vertikale Rechnungsmutation mit Audit an gemeinsamer transaktionaler Servicegrenze. | Technische Scheibe mit 21/21 Zieltests und 7/7 E2E abgeschlossen; weitere Finanzschreibwege, API-/SMTP-Races und Root-/Produktivfreigabe offen. | [Detailbericht](BV-003-006.md), Welle 2 |
| BV-029 | `architektur_vorpruefung`: Backup-v3-Manifest, append-only Audit-/Mappingereignisse, transaktionaler Restore-Audit, Counter-Maximum, konservative Marker, Income-Konflikte und Dateimanifestvalidierung technisch umgesetzt. | Gemeinsamer Snapshot-Export, vollständige Fachmodell-/API-Key-Matrix, automatischer DMMF-Abgleich, nicht geprüfte Merge-/Overwrite-Kombinationen, Produktionsrollout und fachliche Abnahme offen; historische Schema-/Integritätsprüfungen erfolgreich; keine globale Integritätszusage. | Bericht, Welle 2 |

## Welle 3 in Arbeit

| Ticket | Besitzer und Scheibe | Offene Punkte | Detail |
|---|---|---|---|
| BV-011 | `root`: atomarer Guard gegen negative chronologische Kassen-Zwischenstände mit Centarithmetik sowie Rollback-/Paralleltests. | 4/4 Kriterien durch korrigierte shared-MoneyPolicy-Rundung und Zwei-Prisma-Client-Race im gezielten 23/23-Lauf belegt; keine vollständige BV-012-Money-Migration. | Welle 7; [Welle 3](WELLE-3.md) |
| BV-025 | `betriebssicherheit`: Pflicht-`BusinessDate` für manuelle Einnahmen in Web, v1 und UI sowie enge BV-057-Grundlage mit BV-006-Auditgrenze. | 4/4 Kriterien der Welle-7-Matrix durch 2 Dateien/6 Tests und die idempotente Pre-Upgrade-Prüfung belegt; systemweite UTC-Modellierung bleibt außerhalb. | Welle 7; [Welle 3](WELLE-3.md) |
| BV-030 | `architektur_vorpruefung`: gemeinsamer DB-Read-Snapshot für JSON/ZIP, Snapshot-Metadaten, kurze Lockphase und Parallel-Payment-Test. | 4/4 Kriterien durch ZIP-Restore-/Parallelzahlungs-, Dateidrift-/Hash-, Manifest- und Pack-Gate-Nachweise belegt; BV-029-/BV-006-Abhängigkeiten bleiben Scope-Grenzen. | Welle 7; [Welle 3](WELLE-3.md) |

## Reine Architektur-Discovery

Die folgenden Tickets haben eine belastbare Vorprüfung und Priorisierung, aber keine Produktcodeänderung und keine erledigten Akzeptanzfälle: BV-013, BV-014, BV-057 und BV-156. BV-006, BV-012 und BV-029 haben die Discovery in technische Teilumsetzungen überführt; ihre Berichte weisen Restumfang und offene AC-/Freigabepunkte aus.

Architektur-Vorprüfung

## Alle 160 Tickets

| ID | Titel | Ehrlicher Status | Kurzbeleg / Link |
|---|---|---|---|
| BV-001 | Produktionsstart ohne destruktives db push | Teilumsetzung – technische lokale Scheibe abgeschlossen; Release-/Produktivfreigabe offen | BV-001/BV-002 |
| BV-002 | Nichtdestruktive Betriebsdiagnose und DB-Zielprüfung | Teilumsetzung – technische lokale Scheibe abgeschlossen; Release-/Produktivfreigabe offen | BV-001/BV-002 |
| BV-003 | Löschen ausgestellter Rechnungen serverseitig sperren | Teilumsetzung – Welle 2: erste vertikale Rechnungsscheibe technisch umgesetzt; 21/21 Zieltests | [BV-003/BV-006](BV-003-006.md); Restumfang und Freigaben offen, technische Gesamtprüfung grün |
| BV-004 | Zahlungskorrekturen als Gegenereignis statt Statuslöschung | Teilumsetzung – Welle 2: AC1-Guard technisch umgesetzt | Welle 2; AC2–AC4, Journal und Erstattung offen |
| BV-005 | Buchungsentwürfe, Festschreibung und Periodensperren | Vorgeschlagen – keine Umsetzung; offen sind posting status, correctionOf, Festschreibung, Periodensperre und Rekonstruktion früherer Exporte | Vier Backlog-ACs offen: Entwurf aus Auswertungen ausschließen, Festschreibung schützen, Wiedereröffnung protokollieren, Korrekturdifferenzen erhalten |
| BV-006 | Finanz-Audit in dieselbe Transaktion aufnehmen | Teilumsetzung – Welle 2-Rechnungsscheibe plus Welle-5-Ausgabenpfade; 8/8 gezielte Ausgaben-Auditfälle mit Root-Review für den begrenzten Scope | Welle 5, [BV-003/BV-006](BV-003-006.md); weitere Finanzrouten, Idempotenzmodell und Freigaben offen |
| BV-007 | Konten deaktivieren ohne Finanzhistorie zu löschen | Teilumsetzung – AC1/AC2 technisch belegt; Retention/Legal Hold/Ownernachfolge und Freigaben offen | [BV-007](BV-007.md) |
| BV-008 | Produkt- und GoBD-Zusagen an nachgewiesene Kontrollen binden | Teilumsetzung – AC1/AC3 nur Teilnachweis; AC4 offen | [BV-008](BV-008.md) |
| BV-009 | Audit-Abdeckung und Retention risikobasiert schließen | Vorgeschlagen – keine Umsetzung; alle schreibenden Routen, technische Logbereinigung, Retentionklassen und Legal-Hold-Freigabe fehlen | Backlog-ACs offen: Import/Quote-Ereignisse, CI-Mutationsmatrix, Schutz buchungsrelevanter Auditdaten >730 Tage und dokumentierte Freigabe jeder Löschung |
| BV-010 | Unveränderbarer Kassen-Tagesabschluss | Vorgeschlagen – keine Umsetzung; `CashDayClose`, Zählprotokoll, append-only Korrektur und Export-/Restore-Referenzen fehlen | Vier Backlog-ACs offen: Abschlusswerte/Verantwortlicher, Änderungs-/Löschschutz, Differenzereignis und identischer Restore/Export |
| BV-011 | Negative Zwischenstände der Barkasse atomar verhindern | Technischer Abschluss – 4/4 Welle-7-Kriterien im fokussierten 23/23-Lauf belegt; keine vollständige BV-012-Money-Migration | Welle 7; [BV-011](BV-011.md) |
| BV-012 | Durchgängiges Money-Modell und geprüfte Float-Migration | Teilumsetzung – exakte Money-Grundlage, read-only Migrations-/Differenzbericht und unabhängiges Referenzgitter; kein Backfill, keine globale Umstellung und keine vollständige AC-Abnahme | Welle 6, Architektur-Vorprüfung |
| BV-013 | Eine kanonische Wahrheit für Betrag, PDF und XML | Architektur-Discovery/Planung – keine Produktcodeänderung; Implementierung und ACs offen | Architektur-Vorprüfung |
| BV-014 | Zahlungsjournal mit Teilzahlungen und Zuordnungen | Architektur-Discovery/Planung – keine Produktcodeänderung; Implementierung und ACs offen | Architektur-Vorprüfung |
| BV-015 | Eingangs- und Ausgangsbelege explizit unterscheiden | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-016 | Formale E-Rechnungs- und PDF/A-Releasevalidierung | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-017 | Originalnummer und Summenprüfung beim Import erhalten | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-018 | Unterstützungsmatrix und Quarantäne für Sonderbelege | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-019 | Steuersimulation auf vollständige Serveraggregation umstellen | Teilumsetzung – `tax-summary` lädt den vollständigen Serverdatenstand; technische Tests offen für zentrale Gesamtprüfung | [Prüfplan](PRUEFPLAN-GOBD-RECHT.md) |
| BV-020 | Eine gemeinsame Gewinnlogik für EÜR und Simulation | Teilumsetzung – gemeinsame Accounting-Jahresaggregation für Dashboard, Simulation und EÜR-Grundlage | [Prüfplan](PRUEFPLAN-GOBD-RECHT.md) |
| BV-021 | §35-Anrechnung jahresbezogen fachlich korrigieren | Teilumsetzung – §35-Credit mit Messbetrag, tatsächlicher Gewerbesteuer und positivem Gewerbeanteil begrenzt | [Prüfplan](PRUEFPLAN-GOBD-RECHT.md) |
| BV-022 | Sozial- und Steuerparameter nach Veranlagungsjahr versionieren | Teilumsetzung – Regelpakete und Sozialparameter für 2025/2026; weitere Jahre abgelehnt | [Prüfplan](PRUEFPLAN-GOBD-RECHT.md) |
| BV-023 | Unterstützte Steuerfälle und Jahresgrenzen explizit modellieren | Teilumsetzung – unterstützte Jahre/Fallgrenzen sichtbar; Sonderfälle weiterhin offen bzw. ausgeschlossen | [Prüfplan](PRUEFPLAN-GOBD-RECHT.md) |
| BV-024 | Tarif-Endrundung und Soli-Minimumformel korrigieren | Teilumsetzung – Endrundung und jahresbezogene Soli-Minimumformel mit unabhängiger Referenz geprüft | [Prüfplan](PRUEFPLAN-GOBD-RECHT.md) |
| BV-025 | Zahlungsdatum bei manueller Einnahme verbindlich übernehmen | Technischer Abschluss – 4/4 Welle-7-Kriterien im 2-Dateien-/6-Tests-Lauf einschließlich Pre-Upgrade-Fixture und idempotentem REVIEW-Hinweis belegt | Welle 7; systemweite UTC-Modellierung und weitere Einnahmewege bleiben außerhalb |
| BV-026 | EÜR-Korrekturen und Erstattungen vorzeichenrichtig behandeln | Teilumsetzung – negative Korrekturen bleiben signiert, werden in Kontrollsummen und Prüfspur ausgewiesen | [Prüfplan](PRUEFPLAN-GOBD-RECHT.md) |
| BV-027 | Jahresversionierter EÜR-Export mit ehrlicher Formatbezeichnung | Teilumsetzung – 2024/2025-Mapping, Version, Quellen, Kontrollsummen und CSV-Arbeitsunterlage; kein ELSTER-Import | [Prüfplan](PRUEFPLAN-GOBD-RECHT.md) |
| BV-028 | Kleinunternehmer-Profil mit nachvollziehbarem Grenzwächter | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-029 | Backup v3 mit Audit und Nummern-High-Water-Marks | Teilumsetzung – Welle 2: Manifest v3, Audit-/Mapping-/Restore-Ereignisse, Counter-Maximum, Marker-/Income-Schutz und Dateimanifestvalidierung | BV-029; Snapshot, Vollständigkeitsmatrix, DMMF-Abgleich und fachliche Abnahme offen |
| BV-030 | Konsistentes Snapshot-Backup statt unabhängiger Tabellenreads | Technischer Abschluss – 4/4 Welle-7-Kriterien im gezielten 4-Dateien-/18-Tests-Lauf belegt; kein vollständiger BV-029-/Restore-Freigabeschluss behauptet | Welle 7; BV-030 |
| BV-031 | Restore auf dieselben Fachinvarianten wie Live-Buchungen verpflichten | Teilumsetzung – Welle 5: 7/7 eigene Restore- und 26/26 Regressionstests mit Root-Review; technische Schutzscheibe abgeschlossen | Welle 5; globale Money-Migration/target-aware Full-Dry-run außerhalb, fachlicher Restore-Drill und Freigabe offen |
| BV-032 | Merge-Restore mit stabilen Herkunfts-IDs idempotent machen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-033 | Overwrite-Restore mit Step-up und Wartungssperre sichern | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-034 | Ressourcenbegrenzte asynchrone Backup-Erstellung | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-035 | Erstadmin nur mit einmaligem Bootstrap-Nachweis anlegen | Teilumsetzung – `bootstrap_w6` ergänzt Setup-Nachweis, atomaren Verbrauch, Konkurrenz-/Neustartschutz, additive Bestandsmarkierung und globale Admin-SMTP-Einstellungen mit verschlüsseltem Passwort/ENV-Fallback; 12/12 Bootstrap, 7/7 SMTP-Integration und E2E/Screenshot grün | Welle 6; fachliche AC-/Betreiberprüfung offen |
| BV-036 | Passwort-Bytepolicy und migrationsfähiges Hashformat | Teilumsetzung – Welle 5: 72-UTF-8-Bytepolicy für neue/änderte Passwörter umgesetzt; historische bcrypt-Verifikation behält die 72-Byte-Trunkierung zur Kompatibilität | Welle 5; 54/54 gezielte Nachweise, Gesamtprüfung 309 + 1 Skip und E2E 11/11; Sicherheits-/Produktivfreigabe offen |
| BV-037 | Proxyvertrauen und Rate-Limits deploymentfest konfigurieren | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-038 | MFA, Recovery und Step-up als vollständigen Kontoflow bauen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-039 | CSP-/HTTPS-Härtung ohne kaputte PDF-Vorschau ausrollen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-040 | Dateisignatur, Parserbudgets und Quarantäne zentralisieren | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-041 | Dokument-Worker von App-Secrets und Netzwerk isolieren | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-042 | Einheitliche Requestschemas und kleine Standardbudgets | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-043 | Datensparsame Auditpayloads und kontrollierte Fehlerantworten | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-044 | Rechnungs-API-Vertrag und OpenAPI-Detailpfad korrigieren | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-045 | Idempotenzschlüssel und feingranulare Agentenrechte | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-046 | E-Mail-Outbox und nachvollziehbare Versandversuche | Vorgeschlagen – keine Outbox-Umsetzung; BV-047-Schutzkorrektur schließt das Ticket nicht | Welle 6; Worker, Lease, Retrybudget, uncertain-SMTP und alle ACs offen |
| BV-047 | Versandereignis darf Rechnungsstatus nicht zurücksetzen | Teilumsetzung – begrenzte uncommitted Root-Schutzkorrektur in `lib/email-delivery.ts` mit Message-ID-Deduplizierung, konservativer Statusprojektion und Konfliktmetadata; 7/7 isolierte Root-Integrationstests | Welle 6; echter Versand, Outbox, vollständige AC-/Freigabenachweise offen |
| BV-048 | Mahnfähigkeit serverseitig im Versandzeitpunkt prüfen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-049 | Empfänger- und Versandquoten mit Absenderkontrolle | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-050 | Serienausgaben von realen Zahlungen entkoppeln | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-051 | Datenbank-Admission und Transaktionsbudgets begrenzen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-052 | Rechnungslisten ohne parsedData/Raw-XML laden | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-053 | Aggregationen und Nummernvergabe von Vollscans befreien | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-054 | Historische Kassen-/Restore-Schreiblast verkürzen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-055 | Querypläne und Tenant-Referenzconstraints systematisch härten | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-056 | Kennzahlenverträge und Beleg-Drill-down vereinheitlichen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-057 | Business-Date und UTC-Ereigniszeit sauber trennen | Architektur-Discovery/Planung – keine Produktcodeänderung; Implementierung und ACs offen | Architektur-Vorprüfung |
| BV-058 | Invoice-Editor in testbare Module und schlanke Ladepfade zerlegen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-059 | Reproduzierbare Dependency- und Runtime-Releasebasis herstellen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-060 | Release-Gates über Build und Unit-Tests hinaus erweitern | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-061 | Organisation/Mitgliedschaft von Benutzeridentität entkoppeln | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-062 | Lizenz-, Release- und Supportzusagen investorentauglich dokumentieren | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-063 | Vollständige API-/Tenant-/CSRF-Negativmatrix abnehmen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-064 | Verschlüsseltes Offsite-Backup und nachgewiesener Wiederanlauf | Vorgeschlagen – keine Umsetzung; RPO/RTO, unabhängige verschlüsselte Kopie, Schlüsselwiederherstellung und Empty-Host-Drill fehlen | Backlog-ACs offen: Hostverlust-Recovery, Summen/Nummern/Dateihashes, Manipulationsablehnung sowie gemessener Datenstand und Wiederanlaufzeit |
| BV-065 | Geführter Start mit produktiver Bereitschaftsprüfung | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-066 | Verbindliche Produktgrenze Single-Company versus SaaS | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-067 | Getrennter Demo- und Übungsmandant | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-068 | Migrationsassistent für CSV und Altsoftware | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-069 | Lieferantenstamm und Kreditorenübersicht | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-070 | Zentrales Belegpostfach mit kontrolliertem Prüfstatus | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-071 | Beleg und Buchung in beide Richtungen zuordnen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-072 | Bankumsätze per CSV read-only importieren | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-073 | CAMT-Kontoauszüge mit Strukturvalidierung importieren | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-074 | Erklärbarer Bankabgleich mit manueller Freigabe | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-075 | Sammelzahlungen und Gebühren nachvollziehbar aufteilen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-076 | Open-Banking-Anbindung als separaten Anbieter-Entscheid vorbereiten | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-077 | Versionierte Kontierungsregeln mit Vorschau | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-078 | Mehrstufige Dublettenerkennung für Dokumente und Zahlungen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-079 | Bank- und Buchhaltungsabstimmung je Periode | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-080 | Vorhandenen Zahlungs-QR gegen Rechnung und IBAN validieren | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-081 | Artikel- und Leistungskatalog mit Preisversionen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-082 | Projektakte mit Budget und abrechenbaren Leistungen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-083 | Zeiterfassung mit abrechenbar/nicht abrechenbar | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-084 | Zeiten und Projektkosten ohne Doppelabrechnung fakturieren | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-085 | Angebotslebenszyklus mit Annahme- und Ablehnungsgründen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-086 | Kundenportal für beleggebundene Angebotsannahme | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-087 | Auftragsbestätigung und Leistungsnachweis | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-088 | Wiederkehrende Ausgangsrechnungen mit Freigabe | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-089 | Wartungs- und Retainerkontingente | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-090 | Abschlags-, Teil- und Schlussrechnung als Fachmodell | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-091 | Rabatte und Zuschläge im kanonischen Modell | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-092 | Stornorechnung und umsatzsteuerliche Gutschrift sprachlich trennen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-093 | Mehrwährungsfähigkeit erst mit Wechselkurs- und Differenzmodell | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-094 | Regelbesteuerung als eigener freizugebender Produktumfang | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-095 | Grenzüberschreitende Steuerfälle bewusst begrenzen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-096 | Eingehende Gutschriften und Belastungsanzeigen verarbeiten | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-097 | Begleiteter Wechsel aus der Kleinunternehmerregelung | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-098 | Anlagenverzeichnis statt nur Abschreibungsfeld | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-099 | Anlagenabgang, Verkauf und Privatentnahme | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-100 | Explizite Typen für Einlagen, Entnahmen und Transfers | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-101 | Gemischte Belege auf Kategorien und Abzugsquoten aufteilen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-102 | Fahrtkosten als prüfbarer Nebenprozess | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-103 | Reisekosten und Erstattungen mit Belegkette | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-104 | Belegintegrität mit Hashmanifest und unabhängigem Nachweis | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-105 | Dokumentversionen und Freigabezustände | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-106 | Optionale OCR mit Feldkonfidenz und menschlicher Prüfung | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-107 | E-Mail-Belegannahme mit sicheren Anhängen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-108 | Mobile Belegerfassung ohne Datenverlust | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-109 | Mandantensichere Suche über Belege und Buchungen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-110 | Arbeitskorb für ungeklärte Finanzvorgänge | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-111 | Dashboard nach To-dos und Datenqualität strukturieren | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-112 | Entwurfs-Autosave mit Versionskonflikten | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-113 | Sichere Massenaktionen mit Vorschau und Teilergebnis | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-114 | Barrierefreie Kernabläufe nach prüfbarem UI-Ziel | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-115 | Konsistente Sprache, Zahlen und Datumsdarstellung | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-116 | Schnellerfassung und Tastaturbefehle für Routinearbeit | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-117 | Rückgängig nur für Entwürfe, Korrektur für Gebuchtes | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-118 | Benachrichtigungspräferenzen und Eskalationsregeln | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-119 | Geführter Monats- und Jahresabschluss | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-120 | Steuerberater-Lesezugang mit zeitlicher Begrenzung | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-121 | DATEV-orientierter Export mit Belegzuordnung und Kontrollsummen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-122 | Direkte Steuerberater-/DATEV-Anbindung wirtschaftlich entscheiden | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-123 | Belegbezogene Rückfragen und Freigaben | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-124 | Prüfungspaket mit Journal, Belegen und Datenwörterbuch | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-125 | Offenes Exit-Format statt Vendor-Lock-in | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-126 | Persistenter Scheduler mit Leases und Dead-letter-Queue | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-127 | Versand angenommen, zugestellt und unklar getrennt anzeigen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-128 | Kundenkontoauszug und strittige Forderungen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-129 | Kassensturz mit Stückelung und Differenzbeleg | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-130 | Bargeld-/Banktransfers ohne Umsatzverdoppelung | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-131 | Schlüssel- und Notfallzugang mit dokumentierter Rotation | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-132 | Strukturierte Telemetrie und fachliche Alarmierung | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-133 | Liveness, Readiness und Speicherplatzprüfung trennen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-134 | Reproduzierbares Lastprofil für Single-Host-Betrieb | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-135 | Property-/Fuzz-Tests für Geld, Daten und Dokumente | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-136 | SAST, Secret-Scan, SBOM und Imageprüfung als Supply-Chain-Gates | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-137 | Sicherer Updateassistent mit Changelog und Rückfallplan | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-138 | Agentenfähige Architekturregeln und PR-Definition-of-Done | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-139 | Liquiditätsvorschau mit Szenarien und Unsicherheit | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-140 | Steuerrücklagenampel für Nebengewerbe mit Annahmen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-141 | Was hat sich seit dem letzten Abschluss geändert? | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-142 | Prüfbereitschaft als begründete Checkliste, nicht Gütesiegel | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-143 | IBAN-Wechsel und verdächtige Zahlungsdaten als Prüfsignal | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-144 | Fehlende Belege und mögliche Doppelzahlungen priorisieren | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-145 | Was-wäre-wenn-Szenarien mit isoliertem Datenraum | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-146 | Sicherer Agentenzugang: lesen, vorschlagen, separat freigeben | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-147 | Beleggebundene Fragen und Antworten mit Quellen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-148 | Offline nur für verschlüsselte Entwürfe, nicht für endgültige Buchungen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-149 | Exit-Kit mit eigenständig lesbarer Mini-Dokumentation | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-150 | Notfall- und Nachfolgepaket für Einzelunternehmer | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-151 | Zielgruppen- und Problemvalidierung vor weiterem Ausbau | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-152 | Betriebskostenmodell und Build-versus-buy-Entscheid | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-153 | Öffentliche Demo ohne Echtdaten und ohne implizite Produktionsfreigabe | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-154 | Datenschutz- und Verantwortlichkeitsmodell je Betriebsform | Vorgeschlagen – keine Umsetzung; Datenflussregister, Rollen-/Anbieterabgrenzung, Betroffenenprozess und Incident-Runbook fehlen | Backlog-ACs offen: Verantwortlicher/Auftragsverarbeiter, OCR-/Mail-/KI-Datenfluss und Vertrag, Löschanfrage mit Abwägung sowie Sicherheitsvorfall/Meldewege |
| BV-155 | Support- und Schwachstellenprozess mit realistischen Zusagen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-156 | Featureflags und gestufte fachliche Freigabe | Architektur-Discovery/Planung – keine Produktcodeänderung; Implementierung und ACs offen | Architektur-Vorprüfung |
| BV-157 | Mandantenquoten und faire Ressourcenverteilung | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-158 | Datenbankwahl für Mehrmandantenbetrieb anhand Benchmarks entscheiden | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-159 | Mandantenaustritt, Datenregion und Wiederherstellungsgrenzen | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |
| BV-160 | Datensparsame Produktmetriken mit explizitem Opt-in | Vorgeschlagen – nicht implementiert in dieser Arbeitswelle | Backlog-Quelle; keine Umsetzung in dieser Welle |

## Test- und Freigabestand

- Ausgangsprüfung der Welle: `npm run test` mit 215 bestandenen und 1 übersprungenem Test; `npm run lint` grün. Diese Werte stammen aus der dokumentierten Ausgangsprüfung.
- Zentrale Prüfung am 19.09.2026 ca. 10:05 Europe/Berlin: mit `npm run test` mit isoliertem Fixture-Ziel liefen 24 Testdateien, 226 Tests bestanden und 1 Test übersprungen (14,41 s). `npm run lint` endete ohne Meldungen. `npm run build` endete erfolgreich mit synthetisch ungültiger Default-DB und Build-Dummy-Authwerten, einschließlich TypeScript-Prüfung.
- BV-003/BV-006: gezielter realer Integrationslauf mit drei Testdateien und 21 bestandenen Tests; er deckt Payment-Audit, Rollback bei Auditfehler, Parallelwiederholung, fremden Owner, Draft-Löschung, Altbestandssperre, `paidAt`-Schutz, Income-Schutz, Nicht-Rechnungs-Dokumente und PAID-Reopen ab. `npx tsc --noEmit` und gezieltes ESLint für die geänderten Kernpfade waren erfolgreich.
- Zwischenprüfung der Welle 2: ein erster Gesamt-Testlauf hatte 235 bestanden, 1 Fehler und 1 Skip wegen eines alten Audit-Mocks; der Mock wurde korrigiert. Für die Backup-v3-Tests waren zwischenzeitlich zwei `any`-Lintwarnungen offen. Danach bestanden die File-Security-Integration 10/10, der Betriebsagentenlauf 25/25 und Playwright/E2E 7/7 mit Productionbuild in 18,4 s; der PAID-409-Fall prüfte Zahlungsintegrität sowie Desktop-/Mobile-Screenshots, die visuell geprüft wurden. Die abschließende Gesamtprüfung ist grün: `npm run test` mit isoliertem Fixture-Ziel mit 26 Dateien, 240 Tests bestanden und 1 Skip in 15,48 s sowie `npm run lint` ohne Warnungen. `npm run test:e2e` bestand mit 7/7 in 17,0 s einschließlich isolierter Fixture-Datenbank, Migrationen, Productionbuild, Typecheck und Standalone.
- Historischer technischer Prüfnachweis am 19.09.2026 10:42:51: Canary-, Diff- und Integritätsprüfung erfolgreich; 23 Migrationen aktuell, Schema-Diff 0. Der Vergleich von 18 Fachtabellen zeigte keine Datenabweichung; Invoice-Marker blieben `UNKNOWN`, Integritätscheck grün, Foreign-Key-Verletzungen 0. Dies ist kein Gesamtintegritätsnachweis oder Produktionsrollout.
- BV-001/BV-002: 7 Runtime-Integrationstests bestanden, darunter additive Canarymigration, fehlschlagende Canary ohne Zieländerung, frische DB mit Startup-Sentinel, Drift- und URL-Negativfälle. Vier CLI-Tests erhielten gezielte 30-s-Zeitlimits wegen paralleler Buildlast; dies ist im Detailbericht vermerkt.
- Dockerbuild und Konfigurationsprüfung waren erfolgreich; das begründet keine Release-/Produktivfreigabe oder abgeschlossene betriebliche Sicherheitsbewertung.
- Neue Remote-CI und ein Produktivdeployment wurden in dieser Arbeitswelle nicht ausgeführt. Geprüft wurden `npm test`, `npm run lint`, `npm run build`, gezielte Runtime-Integrationstests, File-Security-Integration, Playwright/E2E sowie lokaler Dockerbuild und synthetische Initialisierung.
- Die historischen technischen Prüfergebnisse begründen keine Aussage über den heutigen Deployment- oder Freigabestand.
- Die dokumentierten Scheibentests nutzten synthetische Daten und versendeten nichts extern. Eine vollständige historische lokale Integritätszusage und betriebliche Sicherheitsfreigabe sind nicht etabliert.
- Die finale Welle-2-Prüfung ist mit 26 Testdateien, 240 bestandenen Tests und 1 Skip, warnungsfreiem Lint sowie 7/7 E2E abgeschlossen. Die 226/1-Baseline bleibt als Ausgangsvergleich erhalten; neue Remote-CI, Produktivdeployment, fachliche Betreiberabnahme und verbleibende AC-Nachweise sind davon nicht umfasst.
- Welle 3 startete BV-011, BV-025 und BV-030 als begrenzte Pakete. Welle 7 schließt diese drei Tickets technisch mit jeweils 4/4 Kriterien; die historische Welle-3-Baseline wird nicht als Welle-7-Evidenz wiederverwendet. Der gemeinsame Welle-7-Endlauf umfasst 47 Testdateien, 346 Tests + 1 Skip und 12/12 E2E.
- Welle 4 liefert technische Scheiben für BV-007, BV-019–BV-024 und BV-026/BV-027. Die zentrale Prüfung lief mit 35 Testdateien, 285 Tests bestanden und 1 Skip; Typecheck und Lint waren grün. Der E2E-Lauf bestand mit 11/11 in 18,8 s einschließlich Productionbuild; drei Welle-4-Screenshots wurden visuell geprüft. Zusätzlich umfasst der gezielte Nachweis 5/5 Kontodeaktivierungstests, 24/24 kombinierte Auth-/API-Key-/Deaktivierungstests, 4/4 unabhängige Steuer-Referenztests mit 1.000.004 Vergleichswerten sowie 76/76 EÜR-/Accounting-/Summary-/Mapping-Tests. Fachliche, rechtliche und produktive Freigaben stehen weiterhin aus.
- Für die offene GoBD-/Rechtsarbeit wurde ein verbindlicher Prüf- und Abnahmeplan mit Scope-, Betriebsform-, Verfahrensdokumentations-, Retention-, Originalerhalt-, Restore- und Steuerfachbeispiel-Gates erstellt. Er behauptet keine Konformität.
- Welle 5 ist als begrenzte Dokumentations- und Implementierungsscheibe für BV-006 (Ausgaben-Audit, P0), BV-031 (Restore-Fachinvarianten, P1) und BV-036 (UTF-8-/72-Byte-Passwortpolicy, P1) aufgenommen. Der aktuelle Arbeitsbaum enthält dafür uncommitted Änderungen. BV-006 meldet 8/8 gezielte Fälle mit Root-Review; weitere Finanzrouten und Idempotenz bleiben offen. BV-031 meldet 7/7 eigene und 26/26 Regressionstests mit Root-Review; fachlicher Restore-Drill und Freigabe bleiben offen. BV-036 meldet den 54/54-Endlauf sowie die Gesamtprüfung mit 309 Tests + 1 Skip und E2E 11/11. Die historische Welle-2/3/4-Baseline wird nicht als Welle-5-Evidenz verwendet.
- Welle 6 ist als begrenzte Dokumentations- und Implementierungsscheibe für `bootstrap_w6` (BV-035), die exakte read-only Money-Grundlage `money_w6` (BV-012) und die von BV-046 unabhängige Root-Schutzkorrektur für BV-047 aufgenommen. BV-035 meldet 12/12, BV-012 11/11 und BV-047 7/7 gezielte Tests; zusätzlich SMTP-Einstellungen 7/7. BV-012 enthält ausdrücklich keinen Backfill oder globale Umstellung. `lib/email-delivery.ts` und die Aufrufer sind für BV-047 uncommitted sichtbar; der SMTP-Annahmebeleg bestätigt keine Zustellung. BV-046s Outbox bleibt offen. Der implementierte Admin-SMTP-UI-Zusatzscope versendet keine Testmails; tenantbezogene SMTP-Konfiguration bleibt separat. Die Welle-5-Basis von 309 bestandenen Tests, 1 Skip und 11/11 E2E wird nicht als Welle-6-Evidenz wiederverwendet.
- Root-Gesamtcheck Welle 6 am 20.09.2026 21:08:13: 46 bestandene Testdateien und eine übersprungene, 342 Tests bestanden, 1 Skip; `npm run lint` mit 0 Warnungen und `npx tsc --noEmit` erfolgreich. `npm run test:e2e` bestand um 21:06:40 mit 12/12 und Productionbuild in 28,6 s, einschließlich SMTP-UI-Speichern/Reload/Passwortbeibehaltung/Löschen und Backup-Secretprüfung. Der korrigierte gezielte E2E-/Build-Nachlauf bestand mit 2/2 und Productionbuild in 14,3 s; [SMTP-Screenshot](evidence/welle-6/smtp-settings.png) visuell geprüft. Die beiden Welle-6-Migrationen liefen nur auf isolierten Fixtures/E2E; keine weitergehende Betriebsfreigabe wird behauptet.

## Änderungslog dieser Arbeitswelle

| Zeitpunkt | Änderung | Evidenz / Status |
|---|---|---|
| 19.09.2026 | Start-/Upgrade-Scheibe BV-001/BV-002 als technische lokale Teilumsetzung abgeschlossen. | BV-001/BV-002; Release-/Produktivfreigabe offen. |
| 19.09.2026 | BV-008 Templateclaims bereinigt; tatsächliche Fähigkeiten, Betreiberaufgaben, Abweichungen und Releaseversion dokumentiert; Negativtests ergänzt. | [BV-008](BV-008.md); AC1/AC3 Teilnachweis, AC4 offen. |
| 19.09.2026 | Welle-1-Architektur-Discovery für BV-006/BV-012/BV-013/BV-014/BV-029/BV-057/BV-156 dokumentiert. | Architektur-Vorprüfung; damaliger Discoverystand ohne Produktcodeänderung; spätere technische Teilumsetzungen sind separat verlinkt. |
| 19.09.2026 | Zentrale Übersicht aller 160 Tickets erstellt. | Dieses Dokument; Statuswerte bleiben ehrlich und widerrufen keine offenen Freigaben. |
| 19.09.2026 | Historische Nachweisgrenze aufgenommen. | Vollständiger historischer lokaler Integritätsnachweis nicht etabliert; betriebliche Bewertung offen. |
| 19.09.2026 | Betriebliche Freigabegrenze festgehalten. | Die sichere betriebliche Bewertung bleibt offen; technische Tests ersetzen keine Freigabe. |
| 19.09.2026 | Welle 2 gestartet: BV-003, BV-004, BV-006 und BV-029 als begrenzte Scheiben mit Besitzern, Rest-ACs und gemeinsamen technischen Grenzen dokumentiert. | Welle 2; keine neue zentrale Gesamtprüfung behauptet. |
| 19.09.2026 | Erste vertikale BV-003/BV-006-Rechnungsscheibe technisch umgesetzt: Finanz-Audit, Status-/Löschguards und konservativer `issuanceState`; 21/21 zielgerichtete Tests sowie Typecheck/gezieltes ESLint grün. | [BV-003/BV-006](BV-003-006.md); weitere Schreibwege sowie fachliche und produktive Freigaben offen; technische Gesamtprüfung grün. |
| 19.09.2026 | Zwischenprüfung nach Korrekturen: File-Security-Integration 10/10 und Playwright/E2E 7/7 mit Productionbuild, PAID-409-Zahlungsintegrität und Desktop-/Mobile-Screenshots grün; erster Lauf mit altem Audit-Mock und zwei Lint-Warnungen wurde behoben. | Die finale Gesamtprüfung ist inzwischen separat dokumentiert; fachliche/produktive Freigaben bleiben offen. |
| 19.09.2026 | Finale Gesamtprüfung: 26 Dateien, 240 Tests bestanden, 1 Skip, Lint ohne Warnungen; E2E 7/7 mit isolierter DB, Productionbuild, Typecheck und Standalone. | BV-029 technisch teilumgesetzt; Remote-CI, Produktivdeployment und fachliche Abnahmen offen. |
| 19.09.2026 | Welle 3 gestartet: BV-011, BV-025 und BV-030 als begrenzte Pakete mit Eigentümern, Abhängigkeiten und offenen ACs dokumentiert. | [Welle 3](WELLE-3.md); keine Produktcode-/Schemaänderung durch diese Dokumentationsscheibe, paketbezogene Tests offen. |
| 19.09.2026 | Welle 4 technisch teilumgesetzt: BV-007 AC1/AC2, BV-019–BV-024 und BV-026/BV-027; unabhängige Steuer-Referenzgitter und gezielte EÜR-/Accounting-Tests dokumentiert. Zentrale Prüfung 35 Dateien/285 Tests + 1 Skip, Lint/Typecheck grün; E2E 11/11 mit Productionbuild und drei visuell geprüften Screenshots. | [BV-007](BV-007.md), [Welle 4](WELLE-4.md), [Prüfplan](PRUEFPLAN-GOBD-RECHT.md); Fachreview, Rechts-/Betreiber- und Produktivfreigaben offen. |
| 19.09.2026 | Ein zwischenzeitlicher E2E-Locatorfehler beim Zeitraum-Hinweis wurde auf die konkrete Warnung begrenzt und der Steuerjahr-2025-Text korrigiert; der abschließende Lauf bestand danach 11/11. | E2E-Abschlusslauf 18,8 s einschließlich Productionbuild; kein offener technischer E2E-Fehler. |
| 20.09.2026 | Welle 5 final dokumentiert: BV-006 8/8 gezielte Ausgaben-Auditfälle; BV-031 7/7 eigene und 26/26 Regressionstests mit Root-Review; BV-036 54/54 gezielte Passwort-/Security-Tests; Gesamtprüfung 39 Dateien/309 Tests + 1 Skip, Lint/Typecheck grün, E2E 11/11 mit Productionbuild. | Welle 5; drei Tickets bleiben Teilumsetzungen wegen weiterem Scope, fachlichem Restore-Drill sowie Sicherheits-/Produktivfreigaben. |
| 20.09.2026 | Welle 6 aktualisiert: BV-035 Bootstrap 12/12, BV-012 Money-/Migrationsbericht 11/11 einschließlich Referenzgitter 2/2 und BV-047 7/7 isolierte Root-Integrationstests zur begrenzten Status-Race-Schutzkorrektur unabhängig von BV-046; SMTP-Einstellungen zusätzlich 7/7. | Welle 6; technischer Gesamtcheck grün, fachliche AC-/Betreiberprüfung offen; SMTP-Annahme ist kein Zustellnachweis, BV-046-Outbox bleibt unbearbeitet, implementierter Admin-SMTP-UI-Zusatzscope ohne Testmails dokumentiert. |
| 20.09.2026 | Welle 7 als Abschlussmatrix für BV-011, BV-025 und BV-030 abgeschlossen: alle drei Tickets 4/4 technisch belegt; gemeinsamer Endlauf 47 Testdateien/346 Tests + 1 Skip, Lint/Typecheck grün, E2E 12/12. | Welle 7; keine Test-, Build-, E2E- oder Datenbankausführung durch die Dokumentationsarbeit. |

## Voraussetzungen für Statuswechsel

- „In Arbeit“ darf erst nach den jeweiligen AC-Nachweisen, zentraler Gesamtprüfung und separater Release-/Produktivfreigabe weitergeführt werden.
- „Teilumsetzung“ darf erst nach fachlichem Review, verlinkter Evidenz und bestandenen/abgenommenen ACs als abgeschlossen gelten.
- „Discovery“ darf erst nach Architekturentscheidung, Besitzer, vertikaler Implementierung und AC-Evidenz in einen Umsetzungsstatus wechseln.
- Kein Ticket erhält wegen eines grünen Teiltests den Status „Erledigt“, solange Scope, offene ACs oder Freigaben verbleiben.
- BV-007 bleibt Teilumsetzung, solange Retention/Legal Hold und Ownernachfolge fehlen. Steuer- und EÜR-Tickets bleiben Teilumsetzung, solange unabhängige fachliche Beispiele, Formular-/Jahresabnahme und konkrete Betriebsfreigabe fehlen.


## GitHub #59/#130: neuer Wiederaufbau vom 25.10.2026, 05:53 UTC

Diese GitHub-Issues sind nicht die historischen BV-059/BV-130. Alle 160
historischen Ticketobjekte und Summen bleiben unverändert. Der unveröffentlichte
Quellstand `8978c824` ist nach Executorwechsel nicht verfügbar und wurde nicht
als ursprünglicher Code wiederhergestellt. Historische lokale Prüfergebnisse
werden für den Ersatz nicht übernommen.

Neuer Basisstand: `e268d1c8d64dd7f7bceb4b651ba55eb3ebdb7931` nach #142/#143.
Wiederaufbau mit getrennten Sol-6.1-xhigh-Lanes läuft; noch keine abgeschlossene
Implementierung oder Hosted-/Browserabnahme. Lokale Funktionstests werden nicht
ausgeführt. Die sieben akzeptierten Screenshotpartitionen / 209 Namen / 28 MiB
bleiben unverändert; acht zusätzliche synthetische Nachweise erhalten eine
eigene begrenzte Partition. [Prüf- und Recoverygrenzen](../testing/issues-59-130-reconstruction-2026-10-25.md).

Draft-Veröffentlichung und vollständige Hosted-Prüfung sind freigegeben, Merge,
Issue-Schließung und Deployment nicht. Dieser datierte Checkpoint behauptet
weder Veröffentlichung noch bestandene Prüfungen.

### Integrierter Ersatzstand #59/#130 vom 25.10.2026, 06:10 UTC

Frischer Quellstand `94707ed6d6b4f16f0a4b471983e40e8100dbe319`, Tree
`4f4f9d608f9852583b12f0a5eeb14d4734fa2f43`: Transparenz der bestehenden
Simulation ohne Formeländerung sowie interne Lieferanten-Vormerkungen mit
Tenant-/CAS-/Audit- und Backup-Vertrag integriert. Historische BV-Tickets und
Summen unverändert; GitHub #59/#130 bleiben offen.

Vollständiger Lint, Typprüfung, statische Prisma-Schemavalidierung und normaler
Produktionsbuild einschließlich Vor-/Nachbuild sind auf diesem Ersatzstand
bestanden (Node 24.22.1; neun bestehende Tracingwarnungen). Zwei echte P2-Befunde
aus unabhängigem Quellreview vor Draft-Veröffentlichung korrigiert: präzise
Vollseiten-Bildmaße und Erhalt neuerer Eingaben bei verspäteter Antwort. Enges
Nachreview ohne verbleibenden konkreten P1/P2 im geprüften Scope. Keine lokalen
Funktionstests; Unit-/API-/Backup-/Komponenten-/Browserfälle nur verfasst.
Vollständige Hosted-Prüfung und echte Bildkontrolle des veröffentlichten Heads
sind weiterhin erforderlich. [Konkrete Evidenz und Grenzen](../testing/issues-59-130-reconstruction-2026-10-25.md).

### Erster Hosted-Lauf #144 und Recovery vom 25.10.2026, 07:34 UTC

[Draft #144](https://github.com/storminator89/bivaro-kleinunternehmen/pull/144)
auf `cd3606c4` ist veröffentlicht, aber noch **nicht insgesamt abgenommen**.
CI: 4.316 bestanden / 16 fehlgeschlagen / 20 übersprungen (zwei veraltete
#59-Testharness-/Quellvertragdateien), Lint/Typen/Security bestanden; Build
übersprungen. Die 40 neuen Lieferanten-Unit/API/Backup-Fälle bestanden.
Browser: 169 bestanden / zwei fehlgeschlagen, alle drei Lieferanten-Journeys
bestanden. Zwei #59-Testverträge werden eng korrigiert: eindeutige sichtbare
Disclosure-Auswahl und getrennte exakte Auth-Diagnose statt Geschäftsänderung.
Vier zuvor nur verfasste Komponentenfälle werden jetzt tatsächlich sammelbar;
kein alter Nichtlauf wird als bestanden gezählt. PDF-A und Container x64/ARM
bestanden.

217 tatsächliche PNGs / acht ZIPs wurden vollständig gegen Pixel-/Metadaten-/
Dateihashes geprüft (21.076.497 Bytes innerhalb 30 MiB); die acht neuen Bilder
und vier Inbox-Bilder wurden wirklich angesehen. Ein transienter Fortschritts-
streifen/Scrollversatz im neuen Inbox-Nachweis wird im Capture-Helfer korrigiert,
nicht durch App-CSS-Manipulation. Reale Wiederholungsabnahme des neuen Heads
steht noch aus. [Exakte Läufe, Grenzen und Recovery](../testing/issues-59-130-reconstruction-2026-10-25.md).


### Technische Draft-Abnahme #144 vom 25.10.2026, 08:08 UTC

Der neue Ersatz ist auf unveränderlichem Remotehead
`a7e3540ac8793d2ed27ab94b8f3d933b8db8ee94` / Tree
`2ef67f729bed4c3db150194d7716f73adc5f4b98` technisch vollständig hosted geprüft:
alle neun Checks grün; CI **4.339 bestanden / 20 bestehende Skips** einschließlich
vier wirklich ausgeführter Komponentenfälle, headed Chromium **171 bestanden**,
PDF-A und Container jeweils x64/ARM erfolgreich. Kein historischer Nichtlauf
wird als bestanden umetikettiert; der fehlgeschlagene Erstlauf bleibt oben
sichtbar. Keine lokalen Funktionstests ausgeführt.

217 PNGs / acht ZIPs vollständig gegen Datei-/Pixel-/Metadatenhashes geprüft:
21.071.679 Bytes innerhalb 30 MiB, davon acht neue Bilder 643.496 Bytes innerhalb
2 MiB. Alle acht neuen Originalbilder und vier aktuelle Inbox-Bilder in beiden
Themes/Desktop/Mobile tatsächlich angesehen; kein verbleibender konkreter
Bildbefund im fokussierten Scope. Bestehende 209 Namen/Partitionen/Budgets und
Redesigns bleiben unverändert. [Exakte Läufe und Grenzen](../testing/issues-59-130-reconstruction-2026-10-25.md#final-immutable-runtime-acceptance-25-october-2026-0808-utc).

Dieser **einmalige reine Dokumentationscheckpoint** ändert keinen Runtime-,
Test-, Schema- oder Workflowcode. Seine automatische exakte Head-Prüfung ist bei
Autorschaft noch ausstehend; das Endergebnis folgt ausschließlich im PR-Text,
nicht in einer weiteren Beleg-Commit-Schleife. Draft #144 bleibt ungemergt,
GitHub #59/#130 bleiben offen; alle 160 historischen BV-Tickets/Summen bleiben
unverändert. Keine Deployment-/Fach-/Produktivfreigabe durch technische Abnahme.


## Separater GitHub-#102-Checkpoint vom 25.10.2026, 08:55 UTC

[Entwurf #145](https://github.com/storminator89/bivaro-kleinunternehmen/pull/145)
ist ein implementierter, **noch nicht vollständig kombiniert abgenommener**
Kandidat zur vorhandenen Palettensuche; GitHub #102 ist nicht BV-102. Alle 160
historischen Ticketobjekte, die Summen und der vorstehende #144-Checkpoint
bleiben unverändert. Keine Ticket-Schließung oder Merge-/Deploymentfreigabe.

Veröffentlichter eigenständiger Head `8e802e098663f569a8f988a220fbe391d6af0cd0`
(Tree `85e7a767881cf069aa3f92a4f4fc296c2105f5f8`) enthält begrenztes typweises
Vor-/Zurückblättern innerhalb der vorhandenen Palette: fünf sichtbare Treffer
je Seite, höchstens 20 Seiten je Typ, keine anwachsende Trefferhistorie oder
Gesamt-/Vollständigkeitsbehauptung bei parallelen Änderungen. POST-/Tenant-/
Auth-/Detailzielgrenzen bleiben; kein Suchtext in URL, History, Logs, Analytics
oder neuer Browser-Dauerablage. Finanz-/Schema-/Supplier-/Simulations-/Backup-Logik unverändert; keine neuen
externen Dienste.

Fokussierte echte Hosted-Diagnose `40177250252` auf `abf4513b` bestand mit
**43 Tests**, einschließlich Bootstrap, aller Belegeingangs-Vorprüfungsfälle
und echter sechster Tastaturauswahl/Enter-ID/Zurück bei 360/390/1440 px. Das
ist **keine vollständige Abnahme**. Frühere fehlgeschlagene Browserläufe bleiben
als solche dokumentiert; die folgende vollständige Standalone-Prüfung
(CI `40177794851`, Browser `40177794756`, PDF-A `40177794763`) ist bei Autorschaft
noch aktiv. Lokale Typ-/Lint-/gewöhnliche Vor-/Build-/Nachbuildprüfung bestanden;
keine lokalen Funktions-, Unit-, API- oder Browsertests ausgeführt.

Der bereits akzeptierte Main `db3098b8dd5318e426cd2e1e93a54b810cd1b4e9`
(Tree `5f4b1c54aa2f60a1cb05aa0b497aead1e8c595b6`) wird lokal ohne Änderungen an
seiner Supplier-/Simulation-/Schema-/Backup-Implementierung integriert.
Sein kompletter **217-Bild-/30-MiB-Workflowpräfix** bleibt bytegleich; die drei
Suchbilder ergänzen eine unabhängige strikte 1/2/1-MiB-Partition (Datei/Eingabe/
Ausgabe), zusammen **220 eindeutige Namen / 31 MiB**. Alle bisherigen
Auth-/Browserassertions, begrenzten Reads, Verlustfreiheits-/Pixel-/Metadaten-
Nachweise und fail-closed Pflichtlieferungen bleiben. Beide Zusatzpartitionen
werden unabhängig geprüft, keine wird zugunsten der anderen entfernt.

Vollständige CI-/Browserprüfung und tatsächliche Bildkontrolle des **frischen
veröffentlichten kombinierten Heads** sind offen. Dieser einmalige additive
Checkpoint behauptet weder diese Abnahme noch Veröffentlichung seiner lokalen
Integration. Endergebnisse folgen ausschließlich im PR-Text, ohne erneute reine
Dokumentations-Commit-Schleife. [Detaillierte Evidenz und verbleibende Gates](../testing/record-search-continuation.md).


## 25.10.2026 — #54a lokal vorbereitet, nicht veröffentlicht oder abgenommen

Basis ist akzeptiertes Main `db3098b8` nach #144/#130. Der getrennte, begrenzte
#54a-Stand ergänzt bewusstes Festschreiben einzelner manueller EUR-Einnahmen/
Ausgaben sowie begründete reine Betragskorrekturen mit unverändertem Original,
Verlauf und genau einem wirksamen Finanzbetrag. Bestehende Altbestände bleiben
ungeprüft; Festschreiben ändert weder Summen noch Zahlungsdatum. Web/v1-,
CAS-/Audit-, Quellen-/Kassen-/Kundenschutz und strikte portable Backup-Nachweise
sind als Quelltext vorbereitet, nicht funktional bestätigt. Identitätslose alte
Finanzbackups werden beim Zusammenführen in festgeschriebene Ziele abgelehnt.

Vollständiges Lint, separate Typprüfung, Prisma-Validierung/Client-Generierung
ohne Datenbank sowie Basis-Diffprüfung bestanden. **Der normale Build ist nicht
abgeschlossen**: zwei Abbrüche mit Exit 137; der zweite kompilierte erfolgreich
und wurde danach während Nexts Typprüfung beendet. Keine umgangenen Guards,
keine lokal ausgeführten Tests/Fixtures/Migrationen, keine neuen CI-Läufe und
keine Veröffentlichung oder Bereitstellung. Die separat erhaltene #59-Browser-
Quelle ist ebenfalls nur authored/not run; beide Issues bleiben offen.

Vor Freigabe: dann akzeptiertes Main inklusive #145/#146 vollständig übernehmen,
bestehende Workflow-/Galerieänderungen erhalten, unabhängige strikte 12-Bild-
Partition für #54 hinzufügen und vollständige hosted Build-/Test-/Browser- und
tatsächliche Bildprüfung des exakten Heads durchführen. Historische 160 Tickets,
Statussummen und #144-Provenienz bleiben unverändert.
[Umfang, tatsächliche Checks und offene Gates](../testing/manual-financial-records-54a.md).


## 25.10.2026, 11:43 — #54a/#59: Entwurfsveröffentlichung und hosted Abnahme freigegeben

Die konkrete Freigabe umfasst den Entwurfs-PR für #54a mit separatem #59-
Browsernachweis sowie vollständige GitHub-CI und Browserprüfung, **ohne Merge,
Deployment oder Issue-Abschluss**. Akzeptiertes Main `0ed1130` (#145) wird
vollständig erhalten. Die noch ungemergten PRs #146 (README/Galerie) und #147
(Eingangslisten-Filterkorrektur) sind nicht stillschweigend enthalten.

Eine unabhängige 12-Bild-Partition ergänzt die bytegleich erhaltenen 220 Namen/
31 MiB auf 232 Namen/34 MiB. Pro Eingabe gilt 1 MiB, zusammen 6 MiB Eingabe und
3 MiB zusätzliche verlustfreie Ausgabe; alle alten Gates bleiben erhalten.
Quellenabhängige Wiederherstellungen behalten ihren bestehenden Mandanten-
Remap-Vertrag; #54 übernimmt daraus keine manuelle Festschreibungshistorie.

Die früheren beiden lokalen Buildabbrüche bleiben als unvollständiger Build
ausgewiesen. Keine lokalen Funktionstests oder Migrationen werden nachgeholt.
Tatsächliche hosted Ergebnisse, korrigierte Fehler und Bildprüfung werden beim
exakten veröffentlichten Head im PR-Text festgehalten, nicht vorweggenommen.

## 25.10.2026, 13:57 — #54a/#59: erster Hosted-Versuch fehlgeschlagen, Recovery vorbereitet

Entwurfs-PR [#148](https://github.com/storminator89/bivaro-kleinunternehmen/pull/148),
Head `104697bc`, Tree `6fb8772d`: Unit **4424 bestanden / 15 fehlgeschlagen /
20 übersprungen**; Browser **181 bestanden / 10 fehlgeschlagen**. Lint/Typen,
Security, beide Container-Smokes und beide PDF/A-Jobs bestanden. Der abhängige
CI-Build wurde übersprungen; der normale Produktionsbuild im Browserrunner
einschließlich Vor-/Nachbuild und Next-Typprüfung bestand. Lokale Buildabbrüche
bleiben unvollständig; keine lokalen Funktionstests wurden nachgeholt.

Der unveränderte Vollständigkeits-Verifier lehnt die erste Bildlieferung ab:
222/232 individuell verlustfrei verifiziert, acht Cashflow- und zwei EÜR-Bilder
fehlen. Alle zwölf neuen nativen Dialogbilder wurden tatsächlich angesehen;
das ersetzt weder fehlende Bilder noch fehlgeschlagene Funktionen.

Begrenzte echte UI-/Create-Vertragsregressionen sowie Test-Harness-/Fixturefehler
sind privat korrigiert und unabhängig quellgeprüft, nicht funktional bestätigt.
Akzeptiertes #146-Main `f183d238` bleibt vollständig erhalten: 235 bestehende
plus zwölf eigene Bilder, 247 eindeutige Namen / 40 MiB Ausgabebudget. Die einzeln
quellgeprüfte #149-Testkorrektur `60f3ac88` wird ausdrücklich als ungemergte
Abhängigkeit übernommen, nicht als Bestandteil dieses Main ausgegeben. Ihre
terminale Bestätigung bleibt vor dem nächsten Push erforderlich.

Der nächste veröffentlichte Head benötigt erneut alle Hosted-Gates und finale
Bildkontrolle; keine Abnahme oder Schließung. Historische 160 Ticketobjekte,
Statussummen und bisherige Checkpoints bleiben unverändert. Endergebnisse folgen
im PR-Text, ohne reine Dokumentationsschleife.

## Separater GitHub-#102-Listenfortsetzungscheckpoint vom 25.10.2026

Runtime bis lokalem Runtime-Commit `08ee6a02` ergänzt die bereits gelieferte Palette um
„Passende Liste öffnen“: flüchtige, sitzungsgebundene Suchtextübergabe an die
bestehenden Kunden-/Rechnungs-/Belegeingangslisten; identischer enger
Literal-/Typ-/Feldvertrag, lesende body-only POST-Transporte, ausdrückliches
Löschen und disposal bei Navigation/History/Sessionwechsel. Die betroffene
Rechnungsdetail-Auswahl wird ebenfalls identitätsgebunden entsorgt; Kunden-/
Rechnungsdetails geben Fokus ausschließlich an noch nutzbare Quellen zurück. Keine Finanz-/
Schema-/Backup-/Anbieteränderung. Rechnungs-Ledgerprojektion und sämtliche
bisherigen Queryinvalidierungen bleiben erhalten. Alle 160 historischen
BV-Ticketobjekte/Summen sowie früheren Checkpoints bleiben unverändert;
GitHub #102 ist nicht BV-102.

Unabhängiger statischer Runtime-Review ohne konkrete P1/P2; lokale ESLint- und
TypeScriptprüfung nach Dependencyfix bestanden. Funktions-/Unit-/API-/Browser-
verträge und echte Hosted-E2E-Abdeckung wurden nur verfasst, nicht lokal
abgespielt. Keine neuen GitHub-Schreibaktionen, CI-Läufe, Veröffentlichung,
Merge-/Deploymentaktion oder Ticket-Schließung. Gewöhnliche Buildkompilierung bestand; integrierte Typephase endete mit
Exit137/Killed, Gesamtbuild bleibt offen. Finale separate Types/ESLint
bestanden; vollständige gehostete GitHub-Funktions-/Bildabnahme steht aus.
Die Nutzerfreigabe vom 25.10.2026, 16:48:45 UTC erlaubt nun Entwurfs-PR und
vollständige GitHub-CI/Browser-/PDF-Prüfung, nicht Merge/Deployment oder
Ticket-Schließung. Die frühere Sites-Formulierung war irrtümlich und wird
nicht als Bivaro-Abnahmevoraussetzung fortgeschrieben. Der bestehende
235-Bild-Workflow wird nur durch neun zusätzliche strikte Pflichtbilder
ergänzt; #148-Runtime bleibt separat. Endergebnisse folgen am exakten
Head im PR-Text, ohne erneute reine Dokumentations-Commit-Schleife.
[Vertrag, Coverage und verbleibende Gates](../testing/record-search-filtered-lists.md).


## 25.10.2026, 18:29 — #102: isolierter Entwurf abgenommen, gemeinsame Integration lokal vorbereitet

[#150](https://github.com/storminator89/bivaro-kleinunternehmen/pull/150) auf
`de2f2dd0` / Tree `5c6ec530` besteht vollständig: 4409 Unitfälle, 20 unveränderte
Skips, gewöhnlicher CI-Build, Lint/Types/Security, beide PDF-A- und Container-
Architekturen und alle 193 Browserfälle (14,3 Minuten, 0 Retries). Alle 244
tatsächlichen PNGs in elf exakten Partitionen stimmen in Datei-, vollständigen
Pixel- und Nicht-IDAT-Metadatenhashes sowie Run-/Head-/Archivprovenienz überein;
24.133.350 PNG-Bytes liegen unter 39 MiB. Neun neue und vierzehn betroffene alte
Bilder wurden tatsächlich angesehen, ohne neue blockierende sichtbare Regression.
Der erste fehlgeschlagene Head und die eng begrenzte Test-/Evidenz-Recovery bleiben
im PR nachvollziehbar; keine Runtime-/Guard-/Runner-/Retry-/Skip-Abschwächung.

#148 wurde separat nach Main `2979b592` / Tree `76119eb5` gemergt; dessen
Main-Nachkontrollen laufen noch. Nur lokale gemeinsame Vorbereitung ist jetzt
erlaubt: alle manuellen Finanz-DTOs, Aktionen, Refresh-/Session-/Reviewverträge
bleiben erhalten, die #102-Rechnungshunks bleiben eng begrenzt. Der vollständige
95.530-Byte-Workflow mit 247 Namen / 40 MiB bleibt bytegleich vor neun neuen
Pflichtbildern erhalten; zusammen 256 eindeutige Namen / 42 MiB. Ursprüngliche
235-Namen- und manuelle Zwölf-Bild-Gates bleiben bedeutungsvoll gebunden.

Die isolierte Abnahme ist **keine gemeinsame Abnahme**. Veröffentlichung und
neue kombinierte Hosted-CI warten auf ausdrücklichen #148-Postmain-Unlock und
unabhängigen gemeinsamen Quellreview. Die neue Mergefreigabe gilt bedingt und
sequenziell #148 → #150 → #151, jeweils erst nach vollständiger Abnahme und
Nachkontrollen; kein separates Deployment oder Ticket-Abschluss. Keine lokalen
Funktions-/Unit-/API-/Browsertests. Historische Ticketobjekte, Summen und frühere
Checkpoints bleiben unverändert; exakte spätere Endergebnisse folgen im PR.

Gemeinsame lokale Route-Typgenerierung, vollständige eigenständige TypeScript-
und ESLintprüfung bestehen (Exit0, keine Warnungen). Kein Server, Build oder
Funktions-/Testlauf wurde dafür gestartet. 68 nicht geteilte #148-Pfade bleiben
bytegleich, alle 18 bisherigen Statusschlüssel unverändert; der gesamte
247-Bild-Workflowpräfix ist bytegleich erhalten. Kombinierte Hosted-Abnahme
bleibt ausdrücklich ausstehend.


## 26.10.2026, 19:42 UTC — GitHub #83: Kassenbuch-Lesezustände lokal teilumgesetzt

[GitHub #83](https://github.com/storminator89/bivaro-kleinunternehmen/issues/83)
ist **nicht BV-083**. Dieser enge lokale Folgecheckpoint ergänzt nur den
initialen Kassenbuch-Listenabruf; die 160 historischen Ticketobjekte, Summen
und früheren Checkpoints bleiben unverändert. Basis ist Provider-Main
`fc92ca5070c5b2cbbd9b0e3c2d292106f3b49fb7`, exakt verfügbarer Tree
`ba499c560b00d60d21dc98f7051ff2626391acc3`. Der parentlose lokale Basiscommit
`16c20192b47285b7108d5571325c3f7b8c29f820` ist ausdrücklich **synthetisch und
nicht der Providercommit**; der Folgepatch ist lokal uncommitted.

Der gemeinsame Kassenbuch-Header bleibt sichtbar. Initiales Laden, Lesefehler,
bestätigt leere und befüllte Listen sind getrennt; nur erfolgreiches `[]`
zeigt die Erstellaufforderung. Nicht verfügbare Aktionen sind deaktiviert.
Ein expliziter, doppelt geschützter GET-Retry schreibt keine Mutation erneut;
fehlerhafte Listen werden vor Verwendung zurückgewiesen, gültige Auswahl und
Schutz vor älteren bzw. unmounted Antworten bleiben erhalten. Finanzrechnungen,
Mutationen, Buchungs-/Tagesabrufe, API, Auth, Schema und Workflowdateien sind
unverändert.

Tatsächliche enge lokale Prüfung unter Node **24.22.1**: zwei Vitest-Suites,
**67 bestanden / 0 Skips** (`cashbook-view-regressions` und
`focused-browser-selection`); gezieltes ESLint für die fünf ausführbaren
Änderungspfade ohne Warnungen bestanden. Scoped TypeScript für Seite,
Regressionen, Browserfall-Quellen und Selektortests bestand ebenfalls (Exit0,
`incremental: false`, 1536-MiB-Cap); kein Gesamtbuild oder Fullsuite-Lauf. Fünf Browserfälle für 1440/360/390 px,
verzögerten Fehler → Tastatur-GET-Retry → Reload, erfolgreich leere Listen und
401/403/fehlerhafte Antworten sind **nur verfasst, nicht ausgeführt**. Exakte
Focused-Selektoren und fehlertoleranzfreie Vertragsprüfungen sind enthalten;
Finanz-API-Pfade erhalten keine Ausnahme.

**Browser-/Bildabnahme bleibt offen.** Die bekannte lokale Socket-EPERM- und
abgelehnte Eskalations-Bootstrap-Grenze wurde nicht erneut versucht oder umgangen.
Keine Server-/API-/Datenbankausführung, Installation, Prisma-Regeneration,
neuen CI-Läufe oder Remote-Schreibaktionen; kein PR, Merge, Release, Deployment
oder Issueabschluss. Unit-Log-SHA-256:
`c4f521d5f3bc3ffbfc16d1d853f6e6726ed9e5cd74f61c968c17e26a7f06cf71`;
Lint-/Types-Logs sind bei Exit0 leer (SHA-256 jeweils
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`).
[Umfang und Evidenz](../testing/cashbook-loading-states.md).


### 26.10.2026, 21:26 UTC — #83: Entwurf veröffentlicht, mobile Recovery noch nicht hosted abgenommen

Dieser spätere Stand ergänzt den unveränderten lokalen Snapshot von 19:42 UTC:
Dessen „nicht ausgeführt/nicht veröffentlicht“-Angaben beschreiben den damaligen
Zeitpunkt, **nicht den aktuellen Hosted-Stand**. Nutzerfreigabe liegt für den
Entwurfs-PR und bedingten normalen Merge nach bestandenen Prüfungen vor.
[Draft-PR #227](https://github.com/storminator89/bivaro-kleinunternehmen/pull/227)
ist auf Head `778753baf198ce5119d2f25d674b08ac62809b82` mit dem ursprünglichen
exakten Kandidatentree (Präfix `c89f44e`) veröffentlicht; echter Parent ist
`fc92ca5070c5b2cbbd9b0e3c2d292106f3b49fb7`.

Der erste automatische [Focused-Lauf 40403697647](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/40403697647)
führte Core plus fünf Fälle aus: **4 bestanden, 2 fehlgeschlagen**. Bei 360 und
390 px scheiterten nach befüllter Recovery die Assertions gegen horizontalen
Überlauf; initiales Laden/Fehlerzustand und Desktop funktionierten. Fehlerlog-
SHA-256: `5116a58daf32665c4d9069a3d031c9e8421a3e03f5f087f588192457fae39a6d`.
[PDF-A 40403697662](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/40403697662)
bestand auf beiden Architekturen. In [CI 40403697623](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/40403697623)
bestanden Tests, Security und Lint; der Build war nahezu abgeschlossen,
**vollständiger CI-Erfolg ist damit noch nicht bestätigt**.

Die lokal vorbereitete enge Recovery beschränkt sich auf seitenlokale
`min-width: 0`-/volle Breite-/Textüberlauf-Begrenzung von Kassenübersicht und
Selektor sowie reine Geometriediagnostik in den bestehenden Browserfällen.
Der lange synthetische Kassenname mit UUID als Auslöser einer vorbestehenden
intrinsischen Selektorbreite ist **statische Ursacheninferenz**, noch durch den
Hosted-Wiederholungslauf zu bestätigen. Keine Assertion wurde entfernt oder
abgeschwächt, kein Fixturename verkürzt; keine Tabellen-, Shared-CSS-/Komponenten-,
Finanz-, Auth-, API-, Schema- oder Workflowänderung. Der ursprüngliche Umfang
von acht Dateipfaden bleibt erhalten.

Recovery lokal: zwei gezielte Suites / **67 bestanden / 0 Skips**, gezieltes
ESLint ohne Warnungen, Scoped TypeScript Exit0. Unit-Log-SHA-256:
`ab423301b979011035bbd32e5d450bdcaec6bfccf2ce6cc9d743b173f22bbb48`;
leere Lint-/Types-Logs bei Exit0 jeweils SHA-256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
Keine lokalen Browser-/Server-/API-/Datenbankläufe und keine Installation.
**Recovery-Tree noch nicht festgeschrieben, Hosted-Recoveryabnahme offen;
kein Merge oder Deployment.** Der historische 160-Ticket-Stand bleibt unverändert.
[Fortgeschriebene Evidenz](../testing/cashbook-loading-states.md).
