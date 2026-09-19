# Welle 2 – Rechnung/Audit und Backup v3

Stand: 19.09.2026, 10:50:34 Europe/Berlin. Auditbasis: `85972ed9fe61d268b6640882ea2ddc6e616d1859`.

Welle 2 ist eine begrenzte Implementierungswelle mit Root-Koordination. Sie
behauptet keine fachliche, rechtliche oder produktive Freigabe. Alle nicht
ausdrücklich genannten Akzeptanzkriterien bleiben offen.

## Nutzerentscheidung zum früheren Prüfvorfall

Der Nutzer hat den Vorfall mit den beiden auf `prisma/dev.db` angewandten
Migrationen als lokale Testdatenbank eingeordnet und keine Wiederherstellung
gewünscht. Der Vorfall bleibt mit den belegten Fakten dokumentiert, ist deshalb
kein Arbeitsblocker und wird nicht automatisch zurückgenommen. Es bleibt
festgehalten, dass vor dem Agentenbefehl keine Agentensicherung, kein
Vorher-Hash und kein Snapshot erstellt wurden und eine externe Sicherung
unbekannt ist. Der [Prüfvorfallbericht](PRUEFVORFALL-2026-09-19.md) nennt die
Migrationen und die Grenzen der Integritätsaussage.

Der separate Compose-Diagnosevorfall bleibt ebenfalls dokumentiert. Es werden
keine Secretwerte wiederholt und ohne Auftrag keine Rotation oder `.env`-
Änderung vorgenommen.

## Zuordnung und begrenzte Scheiben

| Ticket | Besitzer | Aktuelle Scheibe | Status | Offene Voraussetzungen und ACs |
|---|---|---|---|---|
| BV-006 | `betriebssicherheit` | Erste vertikale Rechnungsmutation mit Finanz-Audit an einer gemeinsamen transaktionalen Servicegrenze; die Welle koordiniert die Grenze mit BV-003. | Teilumsetzung | 21/21 Zieltests sowie Typecheck/gezieltes ESLint grün. Weitere Finanzschreibwege, API-/SMTP-Races, Review und Root-/Produktivfreigabe offen; technische Gesamtprüfung grün, BV-001 bleibt technische Vorstufe. |
| BV-003 | `betriebssicherheit` | Erste vertikale Rechnungsscheibe mit serverseitiger Löschsperre und Finanz-Audit für Web/v1-Service; UI zeigt den Serververtrag und bietet nur DRAFT/UNISSUED ohne Income zur Löschung an. | Teilumsetzung | 21/21 Zieltests und 7/7 E2E grün. Vollständiges Journal/Refund, Backup-/Restore-/weitere Schreibwege, API-/SMTP-Races und fachliche/produktive Freigaben offen. |
| BV-004 | `betriebssicherheit` | BV-004-AC1-Guard gegen PAID-Reopen und Statusrücknahme technisch umgesetzt. | Teilumsetzung | AC2–AC4, vollständiges Zahlungsjournal/Gegenereignis, Erstattungen sowie BV-014/BV-005-Abhängigkeiten bleiben offen. |
| BV-029 | `architektur_vorpruefung` | Manifest v3, append-only Audit-/Mappingereignisse, transaktionaler Restore-Audit, Counter-Maximum vor Overwrite, konservative Marker, Income-Konflikte und Dateimanifestvalidierung technisch umgesetzt. | Teilumsetzung | Gemeinsamer Snapshot-Export, vollständige Fachmodell-/API-Key-Matrix, automatischer DMMF-Abgleich, nicht geprüfte Merge-/Overwrite-Kombinationen, Produktionsrollout und fachliche Abnahme offen; lokaler Testdatenbank-Rollout erfolgreich. |

## Gemeinsame technische Grenzen

- BV-003 und BV-006 teilen eine transaktionale Rechnung-/Audit-Servicegrenze.
  Geldsemantik wird nicht parallel in mehreren Pfaden neu definiert.
- Audit entsteht zusammen mit der Mutation; Telemetrie und Betriebsdiagnose
  bleiben davon getrennt.
- BV-004 umfasst in dieser Welle ausschließlich AC1. Das Zahlungsjournal aus
  BV-014 und fachliche Gegenereignisse werden nicht vorweggenommen.
- Die additive `issuanceState`-Spalte ist eine konservative technische Grenze:
  Altbestand und externe Uploads bleiben `UNKNOWN`, ein Backup-Restore erhält
  vorhandene `ISSUED`-Marker, und ein interner `UNISSUED`-Erzeugungspfad fehlt
  noch. Nur `UNISSUED`-Entwürfe ohne Income sind löschbar; daraus folgt keine
  fachliche Freigabe.
- BV-029 beschreibt nur die Backup-v3-Grenze mit Audit- und Counter-Ständen.
  Restore-Merge, Overwrite, Geheimnisse und Abgleich werden erst mit ihren
  jeweiligen AC-Nachweisen freigegeben.
- Root koordiniert gemeinsame Schema-, Audit- und Restore-Grenzen, zentrale
  Regression und Statuspflege. Kein Agent erteilt allein eine fachliche oder
  produktive Freigabe.

## Prüfstand

Die letzte zentrale Baseline bleibt: `DATABASE_URL=file:/tmp/bivaro-no-default-database/forbidden.db npm run test` mit 24 Dateien, 226 bestandenen Tests und 1 übersprungenem Test (14,41 s), dazu grünes Lint und Build. Für BV-003/BV-006 sind zusätzlich drei Testdateien mit 21 bestandenen gezielten Integrationstests, `npx tsc --noEmit` und gezieltes ESLint für die Kernpfade dokumentiert. Zwischenprüfungen ergaben 10/10 File-Security-Integration, 25/25 Betriebsagententests und 7/7 Playwright/E2E; der File-Security-Lauf prüfte den echten ZIP-Route-Roundtrip mit Audit-/Counter-Stand 987, Secret-Redaction, Relationen und Dateibytes. Neue Remote-CI und API-/SMTP-Race-Tests wurden in dieser Welle nicht ausgeführt.

Root hat den Playwright-Fall für PAID-409 mit Income-/PDF-Erhalt sowie
Desktop-/Mobile-Screenshots erweitert; der Fall ist in der 7/7-E2E-Prüfung
enthalten und die Screenshots wurden visuell geprüft.

Der jüngste Gesamt-Vitest-Lauf ist mit 26 Dateien, 240 Tests bestanden und 1
Skip in 15,48 s dokumentiert; `npm run lint` lief ohne Warnungen. Ein früherer
Lauf hatte wegen eines alten Audit-Mocks 1 Fehler; der Mock wurde korrigiert.
Die finale E2E-Prüfung bestand mit 7/7 in 17,0 s einschließlich isolierter
`e2e.db`, Migrationen, Productionbuild, Typecheck und Standalone. Remote-CI,
Produktivdeployment, API-/SMTP-Race-Tests außerhalb der geprüften Pfade und
fachliche Freigaben bleiben offen.

Der lokale Testdatenbank-Rollout verwendete eine absolute `DATABASE_URL`, eine
konsistente `VACUUM INTO`-Sicherung, Canary/Diff/Integrity und die Migration
`20260919100000_invoice_issuance_state`; 23 Migrationen sind aktuell,
Schema-Diff 0, `integrity_check` grün und Foreign-Key-Verletzungen 0. Der
Read-only Vorher-/Nachhervergleich der 18 Fachtabellen ergab keine
Datenänderungen; bestehende Invoice-Marker blieben `UNKNOWN`.

`AGENTS.md` verlangt für Datenbankprobes ein explizites temporäres
`DATABASE_URL`, für Compose-Diagnosen `docker compose config --quiet` und nach
jedem Paket eine Synchronisierung von Status-MD und Status-JSON.

## Nächste Statusgrenze

Alle vier Welle-2-Tickets bleiben „Teilumsetzung“, bis Restumfang, verlinkte
AC-Evidenz und fachliche bzw. produktive Freigaben vorliegen. Die technische
Gesamtprüfung ist grün; offene fachliche, rechtliche und Betreiberfreigaben
werden daraus nicht abgeleitet.
