# Jahresvergleich und Sortierung

Erweiterung vom 17. Oktober 2026 zum BIVARO Design System 2.0.
Uncommitteter Arbeitsstand auf Basis des vorhandenen Redesigns.

## Jahresauswahl

Der Jahresvergleich hat ein beschriftetes Jahresauswahlfeld im Kartenkopf,
angelehnt an die Mockups. Wählbar sind Jahre von 1900 bis zum aktuellen Jahr.
Das vorherige Jahr wird automatisch als Vergleich verwendet. Jahre ohne
Buchungen zeigen tatsächliche Nullwerte.

- Aktuelles Jahr: Der bestehende Vergleich bis heute bleibt erhalten.
- Vergangenes Jahr: Beide Kalenderjahre werden vollständig verglichen,
  einschließlich Dezember. Der Tabellenfuß lautet dann „Gesamtjahr“.
- Die oberen Kennzahlen, Umsatzgrenzen, Monatswerte und letzten Aktivitäten
  bleiben unabhängig vom gewählten Vergleichsjahr.
- Die mobile Monatstabelle hat einen beschrifteten, per Tastatur erreichbaren
  Scrollbereich mit getrennten Betragsspalten.
- Die aktive Ansicht (Übersicht, Einnahmen oder Ausgaben) bleibt beim Jahreswechsel erhalten.
- Die Auswahl bleibt bei Ladefehlern bedienbar. Während des Ladens oder bei Fehlern
  werden keine alten Werte unter einer neuen Jahreszahl angezeigt. Ein Fehler
  bietet „Erneut laden“ an. Änderungen an Buchungen oder Rechnungen invalidieren
  auch die zwischengespeicherten Jahresvergleiche.

`GET /api/dashboard/kpis?year=2024` erweitert den bestehenden Vertrag:

| Feld | Bedeutung |
| --- | --- |
| `yearComparison.currentYear` | Gewähltes Jahr |
| `yearComparison.lastYear` | Gewähltes Jahr minus eins |
| `yearComparison.period` | `toDate` für das aktuelle Jahr, sonst `fullYear` |
| `yearComparison.comparisonThroughMonth` | Nullbasierter letzter Vergleichsmonat; für historische Jahre 11 |
| `yearComparison.availableYears` | Vorhandene Buchungsjahre des Benutzers plus aktuelles Jahr |
| Bestehende Summen und Monatsreihen in `yearComparison` | Werte des gewählten Jahrespaars |
| Alle übrigen KPI-Felder | Weiterhin der bisherige aktuelle bzw. gesamte Zeitraum |

Ohne `year` bleibt der bisherige Vergleich aktiv. Ungültige, zukünftige und vor
1900 liegende Jahre liefern HTTP 400. Die Authentifizierung erfolgt weiterhin
vor der Parameterprüfung. Die bestehenden vier kompakten SQL-Abfragen und die
Aggregation offener Rechnungen bleiben erhalten; es werden keine zusätzlichen
Einzelbuchungen geladen. Zahlungsdatum, steuerliche Relevanz, Stornierungen
und Mandantenzuordnung folgen den vorhandenen Regeln.

## Serverseitige Sortierung

Einnahmen und Ausgaben können nach Datum, Betrag und Beschreibung jeweils
aufsteigend oder absteigend sortiert werden. Auf Desktop dienen die
Tabellenköpfe als Schaltflächen mit sichtbarer Richtung und `aria-sort`.
Ein zusätzliches Auswahlfeld zeigt auf allen Geräten dieselbe Sortierung an.

| Parameter | Erlaubte Werte | Standard |
| --- | --- | --- |
| `sortBy` | `date`, `amount`, `description` | `date` |
| `sortOrder` | `asc`, `desc` | `desc` |

Beispiel: `/api/incomes?search=Beratung&sortBy=amount&sortOrder=asc&page=2&pageSize=10`.
Derselbe Vertrag gilt für `/api/expenses`.

Die Datenbank sortiert vor `skip` und `take`, also über den gesamten gefilterten
Datenbestand. Beträge werden als Zahlen sortiert. Gleiche Werte erhalten eine
zusätzliche ID-Sortierung in derselben Richtung, damit die Seitengrenzen stabil
bleiben. Anzahl und seitenbezogene Summe folgen weiterhin dem bestehenden Vertrag.

Sortierung ist mit Suche, Zeitraum, Steuerrelevanz sowie Kunden- bzw.
Kategorie-/Belegfiltern kombinierbar. Ein Sortierwechsel beginnt auf Seite eins.
„Filter zurücksetzen“ stellt auch die ursprüngliche Sortierung wieder her.
Die Sortierung ist Teil des TanStack Query-Schlüssels, sodass Ergebnisse
verschiedener Sortierungen nicht denselben Cache-Eintrag verwenden.

Unbekannte Sortierfelder und Richtungen liefern HTTP 400. Die Feldnamen werden
über eine feste Liste geprüft; Benutzereingaben werden nicht in SQL eingesetzt.
Die bestehenden Web-Endpunkte und deren Antwortformate bleiben erhalten.
Die öffentlichen v1-Endpunkte und die bestehende Rechnungssortierung wurden
nicht verändert.

## Komponenten und Dateien

- `lib/ledger-sort.ts`: Gemeinsame Typen, erlaubte Optionen und API-Validierung.
- `LedgerSortControl` und `SortableLedgerHead`: Einheitliche Auswahl und Tabellenköpfe.
- `types/dashboard.ts`: Gemeinsamer Jahresvergleichstyp und additive Sortierfelder.
- `DashboardClient`: Separater, nach Jahr gecachter Vergleich; aktuelle KPIs bleiben stabil.
- `YearComparison`: Jahresauswahl, Periodenkennzeichnung, Lade-/Fehlerzustände und erhaltene Tab-Auswahl.
- `use-dashboard-data.ts`: Sortierparameter und Rückkehr zur ersten Seite.
- `app/api/dashboard/kpis`, `app/api/incomes`, `app/api/expenses`: Additive Leseparameter.

## Qualitätssicherung

Build einschließlich Typprüfung und ESLint sind erfolgreich. Alle 401 aktiven
Unit-Tests und alle 20 End-to-End-Tests bestehen; ein optionaler Benchmark bleibt
übersprungen. Die gezielte API-Prüfung umfasst 25 neue Testfälle.

[Bilder der Jahresauswahl und Sortierung](screenshots-2026-10-17-controls/)
zeigen Desktop-, Tablet- und Smartphone-Ansichten.

Ergebnisse und Bildnachweise sind in
[verification-controls-2026-10-17.json](verification-controls-2026-10-17.json)
festgehalten. Die API-Tests laufen gegen frisch migrierte temporäre SQLite-Fixtures,
mit ausdrücklich gesetztem `DATABASE_URL`. Auch der E2E-Server verwendet eine
neue temporäre Datenbank außerhalb des Repositories. Produktionsdaten wurden
nicht für Tests verwendet.

Es sind keine Datenbankmigration, neue Abhängigkeit oder Änderungen an den
Schreibprozessen erforderlich. Die bisherigen Standardwerte bleiben erhalten.
