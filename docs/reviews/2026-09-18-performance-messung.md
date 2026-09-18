# Performance-Baseline Dashboard-KPI

Messung vom 18.09.2026 auf Linux x64 mit Node.js v24.15.0, Prisma 6.19.3 und SQLite. Die Datenbanken wurden je Größenklasse temporär angelegt, per Migration aufgebaut und nach dem Lauf gelöscht. Produktiv- und Entwicklungsdaten wurden nicht verwendet.

Der optionale Test liegt in [`lib/__tests__/dashboard-performance.bench.test.ts`](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/lib/__tests__/dashboard-performance.bench.test.ts) und läuft nur mit:

```bash
BIVARO_RUN_BENCHMARK=1 npx vitest run lib/__tests__/dashboard-performance.bench.test.ts
```

Für jede Größenklasse wurden 100, 10.000 bzw. 100.000 `Income`- und `Expense`-Zeilen für einen Benutzer angelegt. Nach einem Warm-up folgten sieben echte Aufrufe von `GET /api/dashboard/kpis` mit ersetzter Benutzerauflösung und realem Prisma/SQLite-Client. Gemessen wurden Laufzeit, UTF-8-Antwortgröße, `SELECT`-Anzahl und die grobe RSS-Differenz pro Aufruf. p50 und p95 sind über diese sieben Läufe berechnet; bei sieben Werten entspricht p95 dem Maximum. Die Vorhermessung stammt aus demselben optionalen Test vor der SQL-Aggregation, die Nachhermessung aus dem Stand mit SQL-Aggregaten und LIMIT-5-Aktivitätsabfragen.

| Stand / Zeilen je Tabelle | KPI p50 | KPI p95 | Antwort p50/p95 | RSS-Differenz max. | `SELECT`s je Lauf |
| ---: | ---: | ---: | ---: | ---: | ---: |
| Vorher / 100 | 3,99 ms | 6,08 ms | 2.592 / 2.592 B | 1,75 MiB | 3 |
| Vorher / 10.000 | 127,36 ms | 133,51 ms | 2.662 / 2.662 B | 38,47 MiB | 3 |
| Vorher / 100.000 | 1.440,30 ms | 1.572,58 ms | 2.695 / 2.695 B | 307,85 MiB | 3 |
| Nachher / 100 | 2,99 ms | 3,44 ms | 2.592 / 2.592 B | 1,25 MiB | 5 |
| Nachher / 10.000 | 27,50 ms | 29,44 ms | 2.678 / 2.678 B | 0,50 MiB | 5 |
| Nachher / 100.000 | 199,33 ms | 223,65 ms | 2.721 / 2.721 B | 4,50 MiB | 5 |

Die Antwortgröße bleibt bei diesem KPI-Projektionspfad nahezu konstant, weil nur fünf aktuelle Aktivitäten und die zwölf Monatswerte serialisiert werden. Nachher werden Summen und Monatswerte in SQLite gebildet; Node erhält nur Aggregatzeilen sowie je fünf aktuelle Income-/Expense-Zeilen. Die Messung zeigt unter diesen Bedingungen deutlich niedrigere Laufzeit und RSS-Spitzen. Sie ist ein lokaler Vergleich derselben synthetischen Messung und keine Produktionslatenzgarantie.

Der synthetische Datensatz enthält keine verknüpften Rechnungen. Nachher erzeugt der KPI-Aufruf vier `WITH`/`SELECT`-Projektionen (Income-Aggregat, Expense-Aggregat, neueste Income, neueste Expense) und ein Invoice-Aggregat, also fünf reale Abfragen. Der Querycounter zählt sowohl `WITH` als auch `SELECT`; alle Läufe bleiben unter zehn Abfragen und unabhängig von der Zeilen- und Monatszahl. Das liegt deutlich unter dem früher gemessenen Wert von 62 SQL-Abfragen. Der Integrationstest enthält zusätzlich eine per ISO-Textdatum eingefügte Legacy-Einnahme und prüft die gleichen Monats-/Totalsummen.

`EXPLAIN QUERY PLAN` für die paginierte Einnahmenabfrage

```sql
SELECT "id", "date"
FROM "Income"
WHERE "userId" = ?
ORDER BY "date" DESC
LIMIT 10 OFFSET 0;
```

ergab für alle drei Größen:

```text
SEARCH Income USING COVERING INDEX Income_userId_date_idx (userId=?)
```

Damit nutzt SQLite den zusammengesetzten Index `(userId, date)` für den Benutzer-/Datumszugriff. Der Benchmark ändert keine Produktdateien oder Datenbankschemata.
