# Erste Arbeitswelle zum Agentenbacklog

Stand: 19.09.2026. Ausgangscommit: `85972ed9fe61d268b6640882ea2ddc6e616d1859`.
Der lokale Stand entsprach beim Start exakt der Auditbasis; der Arbeitsbaum war sauber.

Der Nutzer hat den Start passender Subagents mit `gpt-5.6-luna` und Denkaufwand
`xhigh` beauftragt. Aus dem vorgeschlagenen Backlog wurden folgende begrenzte
Arbeitspakete ausgewählt. Dies ist keine Freigabe aller 160 Tickets.

| Agent | Paket | Grenze |
| --- | --- | --- |
| betriebssicherheit | BV-001 und BV-002 gemeinsam | Containerstart, expliziter Upgradepfad, DB-Ziel und Betriebsdiagnose; synthetische Tests |
| dokumentationszusagen | Erste Scheibe BV-008 | Technische Templateaussagen und Nachweisgrenzen; keine erfundene fachliche Freigabe |
| architektur_vorpruefung | Welle 1: BV-006, BV-012, BV-013, BV-014, BV-029, BV-057 und BV-156 mit Vorgängern | Codeinventar und nächste vertikale Scheiben; keine Änderungen an Fachmodellen |

Die Hauptaufgabe koordiniert gemeinsam genutzte Dateien, prüft die Ergebnisse
und führt die zusammengeführten Prüfungen aus. Journal, Geldmodell, Snapshots,
Restore und Identität werden in dieser Welle nicht unabhängig umgebaut.

In Welle 2 sind BV-003, BV-004 und BV-006 dem Besitzer
`betriebssicherheit` zugeordnet; `architektur_vorpruefung` bearbeitet BV-029.
Die begrenzten Scheiben, gemeinsamen Servicegrenzen und offenen ACs stehen in
[WELLE-2.md](WELLE-2.md). Root koordiniert die gemeinsamen Schema-/Audit-/Restore-
Grenzen und die Freigabefolge.

## Ausgangsprüfung

- `npm run test`: 22 Testdateien bestanden, eine übersprungen;
  215 Tests bestanden, ein Test übersprungen.
- `npm run lint`: bestanden, keine Warnungen.
- Laufzeit: Node.js `v24.15.0`, npm `11.12.1`.
- Tatsächliche Vitest-Konfiguration: `vitest.config.mts`; die Angabe `.ts` in
  `AGENTS.md` ist veraltet. Bestehende Tests bleiben erhalten.

Die Ergebnisse gelten nur für den Ausgangsstand. Die paketbezogenen Berichte
halten Änderungen, neue Prüfungen und offene Akzeptanzfälle getrennt fest.
Die gelieferten Auditdateien werden nicht verändert. Produktive Daten,
externe Versanddienste und bestehende Docker-Volumes sind keine Testfixtures.

## Zentraler aktueller Status

Die vollständige, menschenlesbare Übersicht aller 160 Tickets steht in
[TICKETSTATUS.md](TICKETSTATUS.md); der maschinenlesbare Stand liegt in
[ticket-status.json](ticket-status.json). Der Stand bleibt ehrlich gestuft:
BV-001/BV-002 sind als technische lokale Teilumsetzung abgeschlossen, BV-008 ist eine Teilumsetzung
mit offenen ACs, und BV-003/BV-004/BV-006/BV-029 sind nach ihren begrenzten
Welle-2-Scheiben technische Teilumsetzungen. BV-012/BV-013/BV-014/BV-057/BV-156 bleiben
reine Architektur-Discovery ohne Produktcodeänderung. Die übrigen Tickets sind
in Welle 3 als BV-011/BV-025/BV-030 begrenzte Pakete in Arbeit; die übrigen
Tickets sind in dieser Arbeitswelle vorgeschlagen und nicht implementiert.

Die zentrale Prüfung am 19.09.2026 ca. 10:05 Europe/Berlin lief mit
`DATABASE_URL=file:/tmp/bivaro-no-default-database/forbidden.db npm run test`:
24 Testdateien bestanden, 226 Tests bestanden, 1 Test übersprungen (14,41 s).
`npm run lint` und `npm run build` (mit synthetisch ungültiger Default-DB und
Build-Dummy-Authwerten, einschließlich TypeScript-Prüfung) endeten erfolgreich.
Die zentrale Ausgangsprüfung erfasste Playwright/E2E und neue Remote-CI noch
nicht; geprüft wurden npm test, Lint, Build, gezielte Integration sowie lokaler
Dockerbuild und synthetische Initialisierung. Die spätere Welle-2-Nachprüfung
mit 7/7 Playwright/E2E ist unten separat belegt.
Der Arbeitsbaum enthält derzeit uncommitted
Änderungen aus mehreren Agentenscheiben. Zusätzlich wurde ein Prüfvorfall
gemeldet: Ein Architekturagent rief `migrate deploy` ohne temporäre
`DATABASE_URL` auf und wandte nach derzeitiger Meldung zwei ausstehende
Migrationen auf die lokale, bislang ignorierte `prisma/dev.db` an. Es gibt keine
automatische Rücknahme; die Migrationen und der lokale Effekt sind im
[Prüfvorfallbericht](PRUEFVORFALL-2026-09-19.md) dokumentiert. Eine vorherige
Agentensicherung wurde nicht erstellt, eine externe Sicherung ist unbekannt.
Der Nutzer hat die Datenbank als lokale Testdatenbank eingeordnet und keine
Wiederherstellung gewünscht; der Vorfall ist deshalb kein Arbeitsblocker. Die
Betreiberbewertung bleibt dokumentarisch offen. Deshalb wird hier keine
pauschale Aussage getroffen, dass die gesamte Arbeitswelle keine Daten geändert
habe. Die dokumentierten Scheibentests waren synthetisch; offene fachliche,
rechtliche und Produktivfreigaben bleiben in den Detailberichten ausgewiesen.

`docker build --tag bivaro-bv001002-test:local .` und `docker compose config`
waren erfolgreich. Die Compose-Diagnose gab jedoch erste Zeilen mit einem
nichtleeren `NEXTAUTH_SECRET` aus; der Wert wird nicht dokumentiert, die
temporäre Ausgabe wurde entfernt, und es gab keine Rotation oder `.env`-Änderung.
Die betriebliche Sicherheitsbewertung bleibt im [Prüfvorfallbericht](PRUEFVORFALL-2026-09-19.md) offen; ohne Auftrag erfolgt keine Rotation. `AGENTS.md` verlangt für künftige DB-Probes ein explizites temporäres `DATABASE_URL` und für Compose-Diagnosen `docker compose config --quiet`; außerdem ist die Statuspflege nach Paketabschluss verbindlich.

Welle 2 hat für BV-003/BV-006 einen gezielten Lauf mit 3 Testdateien und 21
bestandenen Tests sowie erfolgreichen Typecheck/gezieltem ESLint dokumentiert.
Zusätzlich sind 10/10 File-Security-Integration, 25/25 Betriebsagententests und
7/7 Playwright/E2E mit PAID-409-Zahlungsintegrität und geprüften
Desktop-/Mobile-Screenshots belegt. Die finale Gesamtprüfung lief mit 26
Dateien, 240 Tests bestanden und 1 Skip in 15,48 s, warnungsfreiem Lint und
7/7 E2E in 17,0 s; Remote-CI und Produktivdeployment bleiben ausstehend.
Der autorisierte lokale Testdatenbank-Rollout lief mit absoluter
`DATABASE_URL`, konsistenter `VACUUM INTO`-Sicherung, Canary/Diff/Integrity und
der Migration `20260919100000_invoice_issuance_state` erfolgreich durch.
23 Migrationen sind aktuell, der Schema-Diff ist 0, `integrity_check` grün und
Foreign-Key-Verletzungen 0; der Read-only Vorher-/Nachhervergleich der 18
Fachtabellen ergab keine Datenänderungen. Das ist ein lokaler Teststand und
keine Produktivfreigabe.

Welle 3 startet BV-011, BV-025 und BV-030 mit noch ausstehenden
paketbezogenen Tests. Der genaue Scope, die Abhängigkeiten und die Grenze zur
vollständigen Money-/Zeitzonenmigration stehen in [WELLE-3.md](WELLE-3.md).

## Berichte

- [BV-001/BV-002](BV-001-002.md)
- [BV-003/BV-006](BV-003-006.md)
- [BV-008](BV-008.md)
- [Architekturvorprüfung](ARCHITEKTUR-VORPRUEFUNG.md)
- [Welle 2](WELLE-2.md)
- [Welle 3](WELLE-3.md)
- [Zentrale Ticketübersicht](TICKETSTATUS.md)
