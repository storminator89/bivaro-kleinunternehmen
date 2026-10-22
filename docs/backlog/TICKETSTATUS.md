# Zentrale Ticketübersicht

Historischer Ticketstand: 20.09.2026, 21:29:59 Europe/Berlin (Statusdokumentation der damaligen Arbeitswelle)
Audit-/Backlogbasis: `85972ed9fe61d268b6640882ea2ddc6e616d1859`
Quelle: `Bivaro_Agent_Backlog.json` (Originalquelle unverändert)
Öffentliche Zusammenfassung: 22.10.2026, 19:59:21 UTC; Ticketstatus und Integrationscheckpoint sind getrennt datiert.
Historische Git-Basis: `0208c62f26ff60cf855dfef21e74e0ff6466e7c9`; keine Aussage über einen heutigen Deploymentstand.

Diese Übersicht enthält alle 160 Backlog-Tickets. Der Status ist der aktuelle Arbeitsstand dieser Welle und ersetzt weder die im Backlog offenen ACs noch fachliche, rechtliche oder produktive Freigaben. „Vorgeschlagen“ bedeutet ausdrücklich, dass in dieser Welle keine Umsetzung vorliegt. Architektur-Discovery ist separat von Produktimplementierung ausgewiesen.

## Integrationscheckpoint vom 22.10.2026, 19:39:45 UTC

Dieser zusätzliche Checkpoint trennt den bestätigten Integrationsstand von der
historischen AC-Bewertung oben und unten. Alle **160 Ticketidentitäten und
Statuswerte** sowie die Summen **3 abgeschlossen / 21 teilumgesetzt / 4 Discovery /
132 vorgeschlagen** bleiben erhalten. Diese öffentliche Zusammenfassung enthält
keine Neubewertung der ACs. GitHub-Nummern wie
**#116 und #127 sind keine BV-Ticket-IDs**. Grüne Integrationsläufe schließen
nicht automatisch historische ACs oder fachliche/produktive Freigaben.

### Integrierte Basis: PR #123 / main

[PR #123](https://github.com/storminator89/bivaro-kleinunternehmen/pull/123)
wurde am 22.10.2026 um **17:35:23 UTC** gemergt;
[Issue #116](https://github.com/storminator89/bivaro-kleinunternehmen/issues/116)
ist geschlossen. Bestätigte Basis ist Commit
`8f9f6264dab78b3f3d4991278df5a23d7a8394ce`, Tree
`53d5597fa649252ecc5ce841d279edfb71d7a954`.
Alle **fünf Workflows und zehn Jobs** dieser Basis waren im **ersten Versuch**
erfolgreich:

| Workflow | Lauf / tatsächliches Ergebnis |
|---|---|
| Own-invoice PDF-A conformance | [39824036507](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39824036507): erfolgreich |
| CI | [39824036377](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39824036377): erfolgreich |
| Docker Publish | [39824036332](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39824036332): erfolgreich |
| Container runtime compatibility | [39824036331](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39824036331): erfolgreich |
| Browser acceptance | [39824036238](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39824036238): 124 bestanden |

Die Bildabnahme umfasst **153 aktuelle Bilder: 38 frische vollständige
Originalbildprüfungen plus 115 Wiederverwendungen nach exaktem Identitätsbeleg**.
Das sind ausdrücklich **nicht 153 frische Browseraktionen**. Das vollständige,
read-only auf Größe und Hash geprüfte Postmerge-Evidenzsiegel heißt
`postmerge-acceptance-main8f9f626.json` (extern aufbewahrte Evidenz, nicht Teil
dieses Repositorys): **19.868 Bytes**, SHA-256
`4c2b797beafa03631c210a47f9ba9abd6680cae8a814f2f3ac0b1a77d5fb4834`.

### Offene Integrationsprüfungen: PR #126 / Issue #127

[PR #126](https://github.com/storminator89/bivaro-kleinunternehmen/pull/126)
ist weiterhin offen und Draft; veröffentlichter kanonischer Commit
`b28ddbaff839ccbb1bdc6796d2dc81825351d7d0`, Tree
`71f7797562447ff96281bb4d0daf1fae3a81e1f0`, ist **nicht main**. Der tatsächliche
Merge-Checkout `40bff6145696c012dd89112e95ec9cef8663e9c6` hat exakt diesen Tree.

| Workflow | Lauf / tatsächliches Ergebnis und Restabnahme |
|---|---|
| CI | [39834456758](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39834456758): Lint/Typprüfung, Tests und Build erfolgreich; Security-Job installiert noch Playwright-Abhängigkeiten. Kein Gesamtabschluss behauptet. |
| Own-invoice PDF-A conformance | [39834457083](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39834457083): erfolgreich |
| Container runtime compatibility | [39834456919](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39834456919): erfolgreich |
| Foreign-PDF | [39834457147](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39834457147): auf beiden Architekturen fehlgeschlagen, obwohl JVM-/CLI-Startup erfolgreich war. Kohärente Nichtkonformität: ISO19005-3:2012, Regel 6.2.11.4.1, Test 1; Source-Precheck lehnt als `unsupported` / HTTP 422 ab. Kein nativer Erfolgsnachweis. |
| Browser acceptance | [39834456795](https://github.com/storminator89/bivaro-kleinunternehmen/actions/runs/39834456795): Stand 19:35 UTC waren funktionale Suite (Schritt 10), finale PDF-Renderprüfung (11) und PDF-Artefaktupload (12) erfolgreich. Screenshot-Staging, terminaler Laufabschluss und Artefaktabnahme stehen noch aus. Die aktuelle Testanzahl ist nicht belegt; die alten 124 werden nicht übertragen. |

Die [öffentliche Diagnose](https://github.com/storminator89/bivaro-kleinunternehmen/pull/126#issuecomment-6349239959)
grenzt den Foreign-PDF-Befund ein: Der gepinnte Fontparser kann einen verweigerten
Tempfile-Spill oberhalb von 10 KiB in `fontProgramParsed=false` übersetzen.
Der Regelbefund beweist daher **keine intrinsisch beschädigte Fixture**; diese
mögliche Verarbeitungsschranke ist noch kein Beleg der alleinigen nativen Ursache.

[Issue #127](https://github.com/storminator89/bivaro-kleinunternehmen/issues/127)
bleibt bis zur finalen Abnahme des integrierten Heads und zum Merge offen. Die
erfolgreichen aktuellen Browser-Schritte ersetzen weder den terminalen
Laufabschluss noch die abschließende Bild-/Artefaktabnahme.

Der nächste **lokal implementierte**, statisch unabhängig geprüfte Kandidat ist
ein begrenzter, ausschließlich für Fremd-PDFs verwendeter Speicheradapter:
öffentliche Setter setzen das Maximum neuer Streams auf **N = 2 MiB
(2.097.152 Bytes)** und die Pufferschwelle auf **N+1 (2.097.153 Bytes)**, danach
folgt unverändert `GreenfieldCliWrapper`. Das ist eine Grenze je neu
materialisiertem Stream,
keine globale Speicherzusage. Regeln, OS-Schreib-/Netzwerkrechte und vorhandene
Prozesslimits bleiben unverändert; das JDK ist ausschließlich Build-Abhängigkeit,
der Runner enthält weiterhin nur die JRE, kein JDK/Compiler. Lokal gemeldet sind
**3.742 bestandene reine Tests / 27 native Opt-in-Skips**, vollständige Typprüfung, Lint und Node-22-Build
erfolgreich. Kein lokaler Java-/nativer-/Browserlauf wurde ausgeführt.
**Tatsächliche Hosted-Kompilierung und native Abnahme sind noch offen**; weder
lokale Checks noch die grüne Basis main belegen den nativen Erfolg des Kandidaten.

Ghostscript ist weiterhin installiert; die Anwendungslizenz bleibt AGPL.
Apache-2.0 und die DE/EN-README-Finalisierung folgen erst nach Entfernung von
Ghostscript. Die vorbereitete README auf `docs/bilingual-product-readme`,
kanonischer Commit `7b87ff0f9798ec0edc9c31347d85f776a2cecbac`, ist nicht gemergt.

Die Angaben sind ein datierter Evidenzcheckpoint, keine laufende Statusabfrage.
Für diese Dokumentationsänderung wurden keine Builds, nativen Tests,
Browserläufe oder neuen GitHub-CI-Läufe gestartet. Das JSON trennt
`integrationCheckpoint` von den historischen Tickets; deren Statuswerte werden
weder erweitert noch neu bewertet. Historische Prüfergebnisse und damals fehlende
Remote-CI gelten nur für ihre jeweilige frühere Welle.

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
