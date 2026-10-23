# Dashboard: Kennzahlen und nächste Arbeit

Stand: 23. Oktober 2026. Fortsetzung des
[Fundamentpakets](HALLMARK-FOUNDATION-2026-10-23.md), lokaler Checkpoint
`375c684`, weiterhin auf Merge-Basis `155eee2`. Keine Veröffentlichung.

## Analyse vor der Änderung

1. **Aufgabe:** Den aktuellen Finanzstand erkennen und den nächsten belegten
   Arbeitsschritt erreichen. Geld, Zeitraum und Herkunft müssen eindeutig bleiben.
2. **Bleibt:** Vier bestehende Kennzahlen, Jahresvergleich mit Jahresauswahl,
   Buchungsaktivitäten, echte Tagesaufgaben, Umsatzindikatoren, Erststart und die
   vorhandenen drei Erfassungsaktionen im Seitenkopf.
3. **Problem:** `dashboard-content.tsx` stellte `DailyActionsPanel compact` vor
   `DashboardClient`. Bis zu drei vollständige Aufgaben mit Begründung standen
   dadurch vor sämtlichen Finanzkennzahlen. Das widerspricht dem verbindlichen
   kennzahlenführenden Überblick in `design.md`. Die richtige Korrektur ist die
   Komposition, nicht das Streichen fachlicher Aufgabenhinweise.
4. **Evidenzgrenze:** Die aktuellen PR131-Bilder der Umsatzindikatoren zeigen
   einen gescrollten Teil des Dashboards. Die vollständigen Überblick-Bilder vom
   17. Oktober zeigen die frühere Kennzahlen-Hierarchie, aber nicht den späteren
   Drei-Aufgaben-Block. Die Verdrängung ist deshalb eine belegte **Quellcode-**,
   keine behauptete neue Viewportmessung. Ein aktuelles Hosted-Vorher/Nachher
   steht aus.

## Gewolltes Vorher/Nachher

| Bereich | Vorher in der aktuellen Quelle | Neuer Präsentationsentwurf |
| --- | --- | --- |
| Beginn | Kopf → Erststart → bis zu drei Aufgaben → Kennzahlen | Kopf → Erststart → Kennzahlen |
| Breiter Arbeitsplatz | Aufgaben volle Breite, danach Jahresvergleich neben Aktivitäten | Jahresvergleich/Aktivitäten links; echte nächste Schritte rechts |
| Schmaler Arbeitsplatz | Alle Aufgaben vor sämtlichen Kennzahlen | Kennzahlen → Aufgaben → Jahresvergleich/Aktivitäten |
| Zusatzinformationen | Monats-/Gesamtwerte und Umsatzindikatoren nachgeordnet | Unverändert nachgeordnet über bestehende `.dashboard-context`-Ordnung |
| KPI lädt/fehlt | Aufgaben waren separat verfügbar | Aufgaben bleiben unabhängig verfügbar; keine erfundenen Nullwerte |

Das ist eine erste sinnvolle Neugliederung des echten Dashboards, kein neues
Theme und keine vollständige Neugestaltung sämtlicher Dashboard-Tabs. Die sechs
Query-Tabs sind ausdrücklich nicht umgebaut.

## Dateischnitt

- `dashboard-content.tsx`: Der bestehende `DailyActionsPanel compact` wird als
  Präsentationsslot an `DashboardClient` übergeben, statt als großer Vorgänger
  der Kennzahlen zu stehen. `GettingStarted` bleibt an seiner bisherigen Stelle.
- `dashboard-client.tsx`: Datenbeschaffung, Effects, Abbrüche, Refresh-Event,
  Vergleichsjahr, Query-Key, Retry und sämtliche weitergereichten Werte bleiben
  unverändert. Lade-, Fehler- und Vollzustand geben denselben Layouttyp mit
  demselben Aufgaben-Slot zurück.
- Neu `dashboard-overview.tsx`: Reine Präsentation mit Summary-, Aufgaben- und
  Analyse-Slots. Keine Hooks, Abfragen, Berechnungen oder eigenen Aktionen.
  Aufgaben bleiben in allen KPI-Zuständen an derselben Reconciliation-Position.
- `app/globals.css`: Nur neue `dashboard-overview-*`-Regeln. Einspaltiger
  Grundriss; ab 1280px Analyse links und mindestens 20rem Aufgabenrail rechts.
  Innerhalb des schmaleren Rails wird die breite Zweispalten-Taskzeile gestapelt;
  Beträge und CTA bleiben vollständig und Buttons mindestens 44px hoch.
  Es gibt keine Abschneidung, Zeilenbegrenzung oder versteckte Begründung.
- Neue isolierte Tests für Präsentation, tatsächliche Kennzahlen/Tasklinks und
  Weitergabe desselben Aufgaben-Slots bei Laden, Fehler und Daten.
- Kleine Review-Nachträge: Die Inventarkarte nennt nun den echten CSV-Wizard
  und die delegierten Editor-Owner strukturiert. Der gemeinsame Navigationstest
  deckt zusätzlich die nicht angemeldete Gruppe „Konto“ ab.

Die numerischen Werte, Formate, vier Ziele der MetricCards, Vorjahresbezüge,
ungeklärten Rechnungssalden und ihre Warnung werden unverändert übergeben.
`DashboardHeader`, `MetricCard`, `YearComparison`, `DashboardActivityFeed` und
`DailyActionsPanel` wurden für diese Neugliederung **nicht verändert**.

## Vorher-Material wirklich angesehen

- `docs/design/screenshots-2026-10-17-flat/overview-1440.png`,
  `overview-375.png`, `overview-dark.png`: historische komplette Komposition.
- PR131-Head `9693a512791cf1877f425338091ea79ef72b6461`, vorhandenes
  `user-workflows-synthetic-visuals.zip`:
  `revenue-indicators-amounts-1440.png`,
  `revenue-indicators-amounts-390.png`: aktuelle historische Zusatzflächen,
  bewusst als gescrollte Aufnahmen behandelt.
- `daily-actions-1440.png`, `daily-actions-390.png` desselben Artefakts:
  Tatsächliche Aufgabenlängen, Beträge und Aktionen als Material für das Rail;
  keine Behauptung, diese eigenständige Seite zeige bereits das neue Dashboard.

Keine Aufnahme ist ein neuer Nachher-Beleg. Kein lokaler Browser wurde gestartet.

## Prüfstand und offene Abnahme

- Node 22.23.4, isolierter Arbeitsbaum, unveränderte Lockdatei.
- Acht fokussierte Vitest-Dateien: **78 Tests erfolgreich**, einschließlich
  Dashboard-Zahlungswarnung, Task-UI, EÜR-/Angebots-Controls sowie
  Receipt-/Palette-Navigationsschutz.
- Finaler ESLint-Lauf: erfolgreich, keine ESLint-Warnungen.
- Finaler Produktionsbuild mit Typprüfung und Postbuild-Notices: erfolgreich.
  Die bestehenden neun Turbopack-Tracing-Warnungen in unveränderten
  Upload-/Validierungs-/PDF-Serverdateien bleiben sichtbar; sie wurden nicht
  durch Änderungen außerhalb des visuellen Auftrags unterdrückt.
- 18 geschützte Quellgrenzen wurden zusätzlich Byte für Byte mit Merge-Basis
  `155eee2` verglichen: unter anderem Metriken, Jahresvergleich, Aktivitäten,
  Aufgaben-Owner, Data-Hook, Review-Navigation, Auth-Shell, Schema, Tokens,
  Design und Lockdatei. Der KPI-State-/Query-/Effect-Block ist unverändert.
- Ein kombinierter Abschlusslauf wurde nach begonnenem Lint vor dem Unit-/
  Build-Schritt von Auto-Review wegen der ForgeCommunity-Testbeschränkung
  blockiert. Repo und Scope wurden erneut belegt: Dies ist Bivaro, nicht
  ForgeCommunity. Der bekannte nicht ausgeführte Unit-Schritt wurde einmal
  erneut angefordert und lief erfolgreich; danach wurden Lint/Build separat
  bestätigt. Kein lokaler Browser oder alternativer Testweg wurde benutzt.
- Unabhängiger Read-only-Code-Review: keine blockierenden Befunde; stabile
  Aufgabenposition bei KPI-Zustandswechsel und unveränderte Funktionsgrenzen
  bestätigt. Das ersetzt die unten ausstehende Hosted-Prüfung nicht.
- Noch nicht gelaufen: vollständige Unit-Suite, Hosted-Vorher/Nachher,
  echte Browser-Zustandswechsel, Hallmark-`sloplint` oder Hallmark-Render.
  Insbesondere ist Slot-Identität im Quellcode/Unit-Test geprüft, aber kein
  Browser-Lebenszyklusnachweis für Fokus und Scrollposition behauptet.
- Die Installation von Hallmark bleibt am dokumentierten Sandbox-Launcher
  blockiert. Die gelesenen Regeln sind keine installierte Laufzeit.

### Vor einer visuellen Freigabe auf dem veröffentlichten Teststand prüfen

1. Exakter Head, 390px/1440px und Light/Dark: Kennzahlen zuerst, Aufgaben nicht
   vor ihnen; keine Überläufe der Beträge oder langen CTA.
2. 768px/1024px/1280px: erwarteter Wechsel zwischen Stapel und Rail; chart- und
   tabellarische Jahresansicht bleiben lesbar. Keine gekappte Finanzwarnung.
3. KPI verzögert, Fehler, Retry und Payment-Refresh: Aufgaben und gewählter
   Zustand bleiben verfügbar; kein unerwarteter Remount/Fokusverlust.
4. Alle Erfassungsaktionen, Task-Ziele, Jahresauswahl, Vergleichs-Tabs,
   Monats-/Umsatzdisclosure und Aktivitätslinks wie zuvor bedienen.
5. Leere Aufgaben, ungeklärter offener Betrag und fehlender Jahresvergleich:
   ehrliche Zustände und unveränderte Warnungen.

Erst danach kann die neue Komposition als visuell abgenommen gelten. Ein
bestandener Build ersetzt diese Abnahme nicht.

## Vorbereitung der freigegebenen Hosted-Prüfung

Nach Freigabe des Entwurfs-PRs wurde der bestehende synthetische
`daily-actions.spec.ts`-Fall um eine rein lesende Dashboard-Prüfung ergänzt:
vier echte MetricCards vor den Aufgaben, Desktop-Analyse links/Aufgaben rechts,
mobile Reihenfolge, keine Seitenüberbreite und mindestens 44px hohe Tasklinks.
Der Fall erfasst den tatsächlichen oberen Viewport in Light/Dark bei
1440×1000 und 390×844. Seine bestehenden Finanz-, Audit-, Originaldatei-,
Task-Navigations- und Unterbrechungsassertionen bleiben unverändert.

Die vier ausdrücklich synthetischen Bildnamen wurden der bestehenden
CI-Evidence-Allowlist hinzugefügt (59 statt 55 Namen). Die Grenzen von
8 MiB Ausgabe, 16 MiB Eingabe und 5 MiB je Quelldatei, Lossless-Prüfung,
Laufzeit/Retry-Zahlen und die übrigen Checks bleiben gleich. Die beiden
Count-Tests wurden nur für diese vier zusätzlichen Namen aktualisiert.

Für diese Vorbereitung sind Lint, Typprüfung und zwei gezielt ausgewählte
statische Evidence-Policy-Tests grün. Die übrigen 54 Fälle dieser beiden
Testdateien wurden dabei ausdrücklich nicht ausgeführt; weder Codec- noch
Browser- oder native Prüfungen liefen lokal. Die neuen Browserassertionen und
Bilder müssen erst auf dem tatsächlichen PR-Head im Hosted-Lauf entstehen.
