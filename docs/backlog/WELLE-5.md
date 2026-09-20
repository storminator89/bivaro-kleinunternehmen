# Welle 5 – Finanz-Audit, Restore-Fachinvarianten und Passwort-Bytepolicy

Stand: 20.09.2026, 20:40 Europe/Berlin. Auditbasis: `85972ed9fe61d268b6640882ea2ddc6e616d1859`.
Die Dokumentationsprüfung startete mit sauberem Arbeitsbaum auf
`0208c62f26ff60cf855dfef21e74e0ff6466e7c9`. Während der Welle wurden
uncommitted Agentenscheiben sichtbar; der aktuelle Stand ist in
`TICKETSTATUS.md` aufgeführt. Die Backlog-Quelle
`/home/pmeyhoefer/Downloads/Bivaro_Agent_Backlog.json` wurde nur gelesen.

Diese Welle dokumentiert drei begrenzte Pakete. Sie erteilt keine fachliche,
rechtliche, sicherheitsbezogene oder produktive Freigabe. Die
Dokumentationsscheibe hat keine Tests, Builds, E2E-Läufe, Datenbankprobes oder
Migrationen gestartet. Paket- und Root-Prüfnachweise werden erst nach Vorlage
als tatsächliche Evidenz eingetragen.

## Zuordnung und aktueller Nachweis

| Ticket / Paket | Priorität und Abhängigkeiten | Sichtbarer Implementierungsumfang | AC-/Testgrenze zum Stand dieser Dokumentation |
|---|---|---|---|
| BV-006 / `finanz_audit_w5` | P0; Backlog-Abhängigkeit BV-001 | `app/api/expenses/route.ts`, `app/api/v1/expenses/route.ts` und `lib/recurring-expenses-service.ts` führen Ausgabenmutationen an eine gemeinsame finanzielle Audit-Transaktion heran. | Technische Teilumsetzung: Finanzagent meldet 8/8 gezielte Fälle einschließlich Multipart-Dateibereinigung sowie v1-`PUT`/`DELETE`-Auditrollback; Root-Review sieht für diesen Scope keine weitere Lücke. Weitere Finanzrouten und ein dauerhaftes Idempotenzmodell bleiben offen; daher kein vollständiger Ticketabschluss. |
| BV-031 / `restore_w5` | P1; BV-012 und BV-029 sind fachliche Abhängigkeiten und Scope-Grenzen; technische Vorprüfung ist ohne globale BV-012-Migration möglich | `lib/backup-restore.ts` erweitert die Restore-Validierungsgrenze um begrenzte Pfad-/Fehlerbefunde und fachliche Validierungshaken. Mergekonflikte werden zusätzlich transaktional geschützt. | Technische Teilumsetzung: 7/7 eigene Restore-Tests und 26/26 Regressionstests bestanden; Root-Review korrigierte Source-ID-Reihenfolge, fehlende Cash-Date, negative Bruchteil-Anfangsbestände, Overflow und PAID-Nullbetrag auch ohne ID. Globale Money-Migration und target-aware Full-Dry-run sind nicht Teil der Scheibe; fachlicher Restore-Drill und Freigabe bleiben offen. |
| BV-036 / Root | P1; keine Backlog-Abhängigkeit | `lib/password.ts` bindet neue Hashes an eine UTF-8-Byteprüfung; `lib/password-policy.ts` enthält die gemeinsame 72-Byte-Policy. Bestehende bcrypt-Loginverifikation behält für historische Hashes die 72-Byte-Trunkierung zur Kompatibilität; neue oder geänderte Passwörter über 72 UTF-8-Bytes werden abgelehnt. | Technische Teilumsetzung: gezielter Endlauf 54/54 Tests auf isolierten Fixtures (Expense 8/8, Passwortpolicy 8/8, Passwort-Routen 1/1, Security 37/37). Gesamtprüfung 39 Dateien/309 Tests + 1 Skip, Lint ohne Warnungen, Typecheck grün, E2E 11/11 mit Productionbuild; `password-byte-policy.png` visuell geprüft. Produktive Sicherheitsfreigabe und Empfehlung zur Änderung historisch überlanger Passwörter bleiben offen; keine Argon2-Migration. |

Die sichtbaren Änderungen sind uncommitted. Aktuelle Pfade des gemeinsamen
Arbeitsbaums sind `app/api/expenses/route.ts`,
`app/api/v1/expenses/route.ts`, `lib/recurring-expenses-service.ts`,
`lib/backup-restore.ts`, `lib/password.ts`, die neuen gezielten Testdateien und
die neue Datei `lib/password-policy.ts`. Das ist eine Bestandsaufnahme und kein Commit- oder
Freigabenachweis.

## Priorität, Abhängigkeiten und nächste Reihenfolge

1. BV-006 bleibt der erste fachliche P0-Prüfpunkt. BV-001 ist seine technische
   Vorstufe; der Welle-5-Scope ergänzt die frühere Rechnungsscheibe um
   Ausgabenpfade und muss dieselbe Transaktions- und Auditgarantie belegen.
   BV-003 und BV-007 hängen fachlich an dieser Auditgrenze. BV-030 nutzt sie
   ebenfalls für einen konsistenten Backup-Snapshot.
2. Die verbleibende P0-Backupgrundlage BV-029 und der laufende Snapshot-Schritt
   BV-030 müssen vor einem Restore-Freigabenachweis vollständig abgegrenzt und
   geprüft sein. BV-012 beschreibt die fachliche Money-/Invariantenbasis und
   bleibt eine Scope-Grenze; eine globale BV-012-Migration ist keine Vorbedingung
   für die technische BV-031-Vorprüfung.
3. BV-031 kann deshalb als geschützte technische Validierungsscheibe parallel
   zur Klärung von BV-012/BV-029 vorgeprüft werden. Sein Dry-run muss vor jeder
   Mutation vollständig auswertbar sein; ein technischer Validator ersetzt
   keinen Restore-Drill und keine Betreiberfreigabe.
4. BV-036 ist von der Finanz-/Restore-Kette unabhängig und kann parallel
   geprüft werden. Root muss dabei die Verwendung der gemeinsamen Policy in
   allen Neu-/Änderungspfaden, die bcrypt-Kompatibilität und die
   UTF-8-Grenzfälle belegen. Das Paket bleibt wegen der ausstehenden
   Sicherheits-/Produktivfreigabe eine technische Teilumsetzung.

Weitere offene P0 bleiben im zentralen Status sichtbar: BV-001 (Release- und
Betreiberfreigabe), BV-003 (vollständige Rechnungsschreibwege), BV-004
(Journal-/Korrekturmodell mit BV-005/BV-014), BV-007 (Retention, Legal Hold und
Ownernachfolge), BV-008 (Evidenz-/Fachreview), BV-013 (BV-012/BV-016) sowie
BV-019 (BV-020). Keine dieser offenen P0 wird durch die drei Welle-5-Pakete
als erledigt ausgegeben.

## Tatsächliche Test- und Freigabeevidenz

Für BV-006 meldet der Finanzagent 8/8 gezielte Fälle mit Root-Review für den
begrenzten Scope; weitere Finanzrouten und Idempotenz bleiben offen. BV-031
meldet 7/7 eigene Restore- und 26/26 Regressionstests mit Root-Review;
fachlicher Restore-Drill und Freigabe bleiben offen. BV-036 meldet den
gezielten Endlauf mit 54/54 Tests in vier Dateien auf isolierten Fixtures
(Expense 8/8, Passwortpolicy 8/8, Passwort-Routen 1/1, Security 37/37).
Die Gesamtprüfung umfasst 39 Dateien, 309 bestandene Tests und 1 Skip, Lint
ohne Warnungen, Typecheck sowie E2E 11/11 mit Productionbuild. Die früheren
Welle-2/3/4-Zahlen bleiben historische Vergleichsbasis und werden nicht als
Nachweis für die neuen ACs wiederholt.
Nachweise müssen die jeweilige isolierte Datenbank bzw. Fixture, den konkreten
AC, Ist-/Soll-Ergebnis, Testbefehl, Zeitpunkt sowie Commit oder uncommitted
Stand nennen. Bis alle ACs eines Tickets belegt und fachlich freigegeben sind,
bleibt der Status `in_progress` oder `partial`; `complete` ist in dieser Welle
nicht zulässig.
