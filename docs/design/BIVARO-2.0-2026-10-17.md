# BIVARO Design System 2.0

Stand: 17. Oktober 2026. Umsetzung im bestehenden Arbeitsstand, ohne Commit.
Die beim Start vorhandenen Änderungen wurden weiterverwendet. Die drei vom
Benutzer bereitgestellten Mockups und die Spezifikation bleiben unverändert.

## Gestaltung

Die Oberfläche folgt den Referenzen für Dashboard, Rechnungen und Einnahmen:
Waldgrün in der Navigation, Mint für die Auswahl, dunkelgrüne Hauptaktionen,
weiße Datenflächen und ein kühler Seitenhintergrund. Die bestehenden Routen,
Datenmodelle, API-Verträge und Berechtigungen bleiben erhalten.

`tokens.css` enthält die kanonischen Farben, Schriften, Größen, Abstände,
Rundungen, Schatten und Bewegungswerte samt Dark Mode. `app/globals.css`
bindet sie an Tailwind v4 und die bestehenden shadcn-Variablen an.
`design.md` dokumentiert die gemeinsame Gestaltung und portable Exporte.

| Token | Wert / Bedeutung |
| --- | --- |
| `--color-nav-surface` | `#06251F`, Sidebar |
| `--color-nav-hover` | `#123A31`, Navigation bei Hover |
| `--color-nav-active` | `#79E1AB`, aktiver Navigationseintrag |
| `--bivaro-color-accent` | `#006B46`, Hauptaktionen |
| `--color-accent-hover` | `#005538` |
| `--color-paper` | `#FFFFFF`, Inhaltsflächen |
| `--color-paper-2` | `#F3F7FA`, Seitenhintergrund |
| `--color-paper-3` | `#F1F5F8`, sekundäre Flächen |
| `--color-ink` | `#12202C`, Haupttext |
| `--bivaro-color-muted` | `#5F7087`, kontrastoptimierter Sekundärtext |
| `--color-rule` | `#E2E9ED`, ruhige Trennlinien |
| `--color-rule-2` | `#7C8D9F`, erkennbare Eingaberahmen |
| `--color-success` / `--color-danger` | `#087B50` / `#C7353F` |
| `--color-warning` / `--color-info` | `#B66A10` / `#2563EB` |
| `--font-body` | Inter, lokal durch Next.js ausgeliefert |
| `--text-page-title` | 32px; mobil 24px |
| `--text-sm` / `--text-xs` | 14px / 12px |
| `--radius-card` / `--radius-input` | 16px / 10px |
| `--layout-sidebar` / `--layout-topbar` | 240px / 64px |
| Animationen | funktionale Übergänge, reduzierte Bewegung berücksichtigt |

Die Next-Font-Variablen liegen auf `html`, damit die Token-Aliase bereits auf
dem Root-Element aufgelöst werden. Eine Browserprüfung kontrolliert die wirklich
verwendete Schrift, nicht nur die CSS-Deklaration.

## Komponenten

| Komponente | Verwendung |
| --- | --- |
| `AppShell` | Gemeinsame Sidebar, Breadcrumb, Suche, Theme und Benutzermenü; mobiler Drawer |
| `PageHeader` | Bereich, Titel, Beschreibung und priorisierte Aktionen |
| `MetricCard` | Verlinkte Kennzahl mit benanntem Zeitraum und optionalem Vorjahresvergleich |
| `TrendIndicator` | Richtung unabhängig von Bewertung; sinkende Kosten sind positiv |
| `YearComparison` | Recharts mit Euro-Achse, Legende, Tastatur-Tooltip und tabellarischer Alternative |
| `DashboardActivityFeed` | Verknüpfte letzte Buchungen aus dem vorhandenen KPI-Endpunkt |
| `LedgerListHeading` | Ergebniszahl und ausdrücklich seitenbezogene Summe; unbekannte Werte als Strich |
| `QueryFeedback` | Sichtbarer Ladezustand oder Fehler mit Wiederholungsaktion |
| `StatusBadge` | Bestehende Statusregeln, konsistente Form und zusätzlich lesbarer Text |
| `Card`, `Table`, `Input`, `Button`, `Badge`, `Dialog` | Gemeinsame Primitives; Card-Slots machen bestehende Bereichsstile wirksam |
| `CommandPalette` | Echte Suche nach Seiten/Aktionen; Ctrl/⌘+K und mobiler Suchbutton |

Die Befehlspalette verwendet die Overlay-/Content-API von cmdk/Radix. Der Dialog
besitzt eine messbare Fläche, eine Beschreibung und den vorhandenen Fokusfang.
Es gibt keine verschachtelte, selbst positionierte Dialogkulisse mehr.

## Migrierte Ansichten

| Ansichten | Umsetzung |
| --- | --- |
| Dashboard | Vier Finanzkennzahlen, Jahresvergleich, Aktivitätsfeed; zusätzliche Monatswerte und Umsatzgrenzen nachgeordnet |
| Rechnungen | Bestand, Import, Statusfilter, Suche, Tabelle, Statusbadges, seitenbezogene Summe |
| Einnahmen und Ausgaben | Gemeinsamer Kopf, aufklappbare Erfassung, Filter, Tabellen/mobile Datensätze, Lade-/Fehler-/Leerzustände |
| Angebote | Gemeinsamer Kopf, Filter/Tabelle, nun tatsächlich angebundene Lade- und Fehlerzustände |
| EÜR und GWG | Gemeinsamer Seitenkopf, bestehende Berichtsflächen und Exportdialoge mit neuen Tokens |
| Kunden, Kassenbuch, Mahnwesen | `PageHeader` und gemeinsame Oberflächen-/Formular-/Tabellentokens |
| Steuer-Simulation | `PageHeader`, bestehende Parameter und Ergebnisdarstellung mit gemeinsamer Typografie |
| Einstellungen, Benutzer, API-Schlüssel, API-Dokumentation, Audit-Log, Verfahrensdokumentation | Gemeinsamer `PageHeader`, Primitives und Tokens; Rollenprüfung bleibt erhalten |
| Rechnungs- und Angebotseditor | Bestehende fachlich gruppierte Studios; neue Schrift, Controls, Cards und Dialogbasis |
| Startseite, Login, Registrierung | Gemeinsame Tokens und Controls; Newsreader bleibt der öffentlichen Display-Typografie vorbehalten |
| Dialoge | Zentrale Dialogbasis mit heller Fläche, begrenzter Höhe und scrollbarendem Inhalt; 44px-Schließen-Aktion auf Deutsch |

## Daten und Interaktion

- Die vier oberen Kennzahlen nutzen vorhandene API-Werte: Einnahmen, Ausgaben
  und Gewinn bis zum heutigen Datum; offene Forderungen sind als aktueller
  Gesamtbestand gekennzeichnet. Monats- und Gesamtzeitraumwerte bleiben
  zusätzlich erreichbar.
- Kleine Verlaufsgrafiken beruhen auf den vorhandenen Monatsdaten. Bei fehlenden
  Werten wird keine dekorative Zeitreihe erfunden.
- Prozentwerte mit einem Vorjahreswert von null sind nicht berechenbar und
  erscheinen als Strich. Richtung und positive/negative Bewertung sind getrennt.
- Die Vergleichstabelle summiert in beiden Jahren denselben Monatsbereich;
  dieser ist im Tabellenfuß benannt.
- Fehlerhafte Listenabfragen sehen nicht wie leere Datenbestände aus. Summen
  sind dann unbekannt. Wiederholen verwendet die bestehenden Query-Invalidierungen.
- Fehler beim Speichern von Ausgaben, beim Import und bei Statusänderungen werden
  sichtbar gemeldet; Bearbeitungsfehler verwenden die vorhandene Toast-Infrastruktur.
- Mobile Filter und Aktionen bleiben erreichbar; umfangreiche Tabellen werden
  durch die bestehenden mobilen Datensätze oder kontrolliertes Scrollen dargestellt.

## Prüfung

Ursprüngliche Redesignprüfung: Build einschließlich Typprüfung erfolgreich, ESLint ohne Warnungen,
376 Unit-Tests erfolgreich (ein optionaler Benchmark übersprungen),
18 End-to-End-Tests erfolgreich. Alle 22 getesteten Ansichten funktionieren bei
320, 375, 414, 768 und 1440px ohne Seitenüberlauf. 16 geprüfte Token-Kontrastpaare
in Light/Dark Mode erfüllen die jeweils angesetzten 4,5:1- bzw. 3:1-Schwellen.

Die finale Prüfung und die Bildnachweise stehen in
[verification-2026-10-17.json](verification-2026-10-17.json) und im Ordner
[screenshots-2026-10-17](screenshots-2026-10-17/).

Die E2E-Prüfung verwendet eine neu erstellte temporäre Fixture-Datenbank unter
`/tmp/`, einen eigenen Server auf Port 3102 und kopierte Standalone-Assets.
`prisma/dev.db` und die bereits laufende Anwendung auf Port 3100 werden nicht
für Tests verwendet. Der Testcode ist identisch zum Repository, bis auf die
Portanpassung in der temporären Kopie.

## Bewusste Abweichungen und Grenzen

- Liquidität, Steuertemine und eine Benachrichtigungsglocke werden nicht aus den
  Referenzbildern nachgebildet: es gibt dafür keine entsprechenden verbundenen
  Datenquellen. Es werden keine Kontostände oder Termine erfunden.
- Jahresauswahl und serverweite Sortierung von Einnahmen und Ausgaben wurden
  inzwischen ergänzt. Siehe [Erweiterung: Jahresvergleich und Sortierung](year-comparison-and-sorting-2026-10-17.md).
  Die bestehende Rechnungssortierung wurde in diesem Schritt nicht verändert.
- Die Referenzfarbe für Sekundärtext wurde geringfügig verdunkelt. Kleine Schrift
  auf dem Seitenhintergrund erreicht damit mindestens 4,5:1.
- Die dunklere Vorjahresfarbe verbessert die Erkennbarkeit von Chart-Markierungen.
- Die Screenshots enthalten ausschließlich synthetische Testdaten. Ein vollständiges
  externes WCAG-Audit und visuelle Vergleiche in Safari/Firefox sind nicht Teil
  des dokumentierten Chromium-Testlaufs.
- Kein Datenbankschema und keine Migration wurden geändert. Änderungen liegen
  uncommittet vor; die vorhandenen Änderungen anderer Arbeiten bleiben erhalten.
