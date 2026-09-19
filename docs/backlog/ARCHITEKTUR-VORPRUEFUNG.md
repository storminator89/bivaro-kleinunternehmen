# Architektur-Vorprüfung für BV-006, BV-012, BV-013, BV-014, BV-029, BV-057 und BV-156

Status: Discovery und Implementierungsplanung, keine fachliche Freigabe.

## Grundlage und Geltungsbereich

Die Prüfung bezieht sich auf `HEAD 85972ed9fe61d268b6640882ea2ddc6e616d1859` vom 19.09.2026. `HEAD` entspricht damit der im Backlog angegebenen Auditbasis; es gibt keinen festgestellten Codeunterschied, der eine alte Empfehlung automatisch erledigt. Die vollständigen Ticketdaten, vier Akzeptanzfälle je Ticket, Vorgänger, Findings, Quellen und Prinzipien wurden selektiv aus `/home/pmeyhoefer/Downloads/Bivaro_Agent_Backlog.json` gelesen. Die Arbeitsregeln stehen in `/home/pmeyhoefer/.codex/attachments/99aaabe6-cf38-4afd-b200-db330938c11b/Eingefügter Text.txt` und in [AGENTS.md](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/AGENTS.md).

Der relevante Backlog-Vorgängergraph ist in der folgenden Tabelle explizit als
`Ticket | direkte Vorgänger` dargestellt. Die Tabelle beschreibt nur die im
Backlog eingetragenen Abhängigkeiten; sie ist keine zusätzliche
Implementierungsreihenfolge.

| Ticket | Direkte Vorgänger |
| --- | --- |
| BV-001 | — |
| BV-006 | BV-001 |
| BV-008 | — |
| BV-012 | BV-001, BV-029 |
| BV-013 | BV-012, BV-016 |
| BV-014 | BV-012, BV-006 |
| BV-016 | BV-040 |
| BV-029 | BV-001 |
| BV-040 | BV-042 |
| BV-042 | — |
| BV-057 | BV-001 |
| BV-066 | BV-008 |
| BV-138 | BV-066 |
| BV-156 | BV-006, BV-138 |

BV-001 und BV-008 werden laut Arbeitsauftrag bereits von anderen Agenten bearbeitet. Diese Vorprüfung ändert deren Dateien nicht und setzt ihre fachliche Abnahme nicht voraus. Der Bericht ist die Discovery-Basis; alle gelesenen Akzeptanzfälle stehen dort auf „Offen“. Seit dem Start von Welle 2 sind BV-006 und BV-029 begrenzten Implementierungsscheiben zugeordnet, ohne dass dieser Bericht eine AC-Erfüllung oder Freigabe behauptet. Remote-CI-Berichte aus dem Backlog sind keine neue lokale Testausführung.

Für die Planung gelten insbesondere: gerichtete Abhängigkeiten zuerst auflösen oder gemeinsam entwerfen; Geld, Journal, Snapshot, Restore und Identität nicht unabhängig parallel am Schema ändern; Originalbeleg und finalen Rechnungssnapshot erhalten; Dokumentstatus, Forderung und Geldfluss trennen; Audit einer Fachmutation im selben Commit oder über eine unverlierbare Outbox schreiben; Tenant/Owner serverseitig prüfen; Import, Mutation und Restore dieselbe Geld- und Datumssemantik geben; Secrets aus Backups ausschließen; keine destruktive Datenbankoperation an Produktdaten.

## Aktueller fachlicher Kern und Schreibwege

### Modelle und bestehende Invarianten

Die aktuellen Prisma-Modelle stehen in [prisma/schema.prisma](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/prisma/schema.prisma:58):

| Modell | Ist-Zustand und relevante Kopplung |
| --- | --- |
| `Invoice` | `totalAmount Float?`, `parsedData Json`, Status/`paidAt`, Original-/Gutschrift- und Angebotsumwandlungsreferenzen; Nummern sind je Owner eindeutig ([schema.prisma](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/prisma/schema.prisma:98)). |
| `Income` | `amount Float`, `invoiceId Int? @unique`; damit ist nur eine Income-Zeile je Rechnung vorgesehen ([schema.prisma](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/prisma/schema.prisma:81)). |
| `Expense` und `RecurringExpense` | Beträge als `Float`, Datum/Zeit als `DateTime`; Serienerzeugung verknüpft über `recurringExpenseId` und `scheduledDate` ([schema.prisma](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/prisma/schema.prisma:58), [schema.prisma](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/prisma/schema.prisma:176)). |
| `CashBook`/`CashTransaction` | Anfangssaldo, Betrag und laufender Saldo als `Float`; Transaktionen referenzieren optional genau eine `Income` oder `Expense` ([schema.prisma](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/prisma/schema.prisma:269)). |
| `AuditLog` | Freitextfelder für Aktion, Entität, alte/neue Werte und Metadaten; keine fachliche Operations-ID oder explizite Tenant-Spalte, Owner wird über `userId` abgebildet ([schema.prisma](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/prisma/schema.prisma:245)). |
| `InvoiceNumberCounter` | Owner/Typ/Jahr als zusammengesetzter Schlüssel und High-Water-Mark `value`; wird beim Dokument-Insert in derselben Transaktion aktualisiert ([schema.prisma](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/prisma/schema.prisma:335), [invoice-numbers.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/lib/invoice-numbers.ts:29)). |
| `Settings` | Firmenstammdaten, aber derzeit weder Tenant-Zeitzone noch Capability-/Freigabeflags ([schema.prisma](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/prisma/schema.prisma:148)). |

`Invoice`, `Income`, `Expense` und `CashTransaction` sind deshalb gemeinsam zu betrachten. Eine isolierte Float- oder Datumsänderung erzeugt sonst unterschiedliche Summen, offene Posten oder Zeiträume in den Lesepfaden.

### UI und Web-API

* Die manuelle Rechnung wird im Browser berechnet und erzeugt: `CreateInvoiceModal` setzt das Datum aus `new Date().toISOString()` und lädt eine Vorschau-Nummer ([create-invoice-modal.tsx](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/components/dashboard/create-invoice-modal.tsx:84)); `calculateInvoiceAmounts`, XML und PDF werden clientseitig erzeugt ([create-invoice-modal.tsx](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/components/dashboard/create-invoice-modal.tsx:1054)). Anschließend lädt die UI die Datei nach `/api/invoices/upload` hoch ([create-invoice-modal.tsx](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/components/dashboard/create-invoice-modal.tsx:1101)). Der Server bekommt also die finalen Bytes, nicht ein verbindlich kanonisiertes, vom Server berechnetes Invoice-Modell.
* Der JSON-Kompatibilitätspfad `/api/invoices` akzeptiert `parsedData`, `totalAmount` und PDF-Bytes als getrennte Eingaben und schreibt erst die Datei, dann `Invoice`; Audit folgt separat ([app/api/invoices/route.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/invoices/route.ts:21)). Das ist der direkte Beleg für F13/BV-013.
* Die Dashboard-UI schreibt Einnahmen, Ausgaben, Rechnungsstatus, Löschungen und Gutschriften über `/api/incomes`, `/api/expenses`, `/api/invoices` und `/api/invoices/cancel` ([dashboard-content.tsx](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/components/dashboard/dashboard-content.tsx:369), [dashboard-content.tsx](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/components/dashboard/dashboard-content.tsx:518), [dashboard-content.tsx](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/components/dashboard/dashboard-content.tsx:605)). Kassenbuchbuchungen laufen über `/api/cashbook/transactions` und den gemeinsamen Service ([transactions/route.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/cashbook/transactions/route.ts:105)).
* `updateInvoiceStatus` schreibt Status/`paidAt` und erzeugt bei `PAID` ein `Income` mit dem gespeicherten `Invoice.totalAmount`; die Audit-Zeile kommt erst nach dem Commit ([invoice-payments.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/lib/invoice-payments.ts:38)). `Income.invoiceId @unique` und `upsert` erzwingen die gegenwärtige Vollzahlungslogik.
* Eine Stornierung erzeugt zuerst eine PDF-Datei, reserviert eine Gutschriftnummer, legt eine negative `Invoice` an und setzt die Originalrechnung auf `CANCELLED`; beide Audit-Ereignisse folgen danach ([cancel/route.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/invoices/cancel/route.ts:228), [cancel/route.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/invoices/cancel/route.ts:262)). Ein Rückfluss/Rücklastschrift-Ereignis entsteht dort nicht.
* Einnahmen und Ausgaben werden in der Web-API weiterhin als Zahlen angenommen und als Float geschrieben; die Audit-Helfer laufen nach dem Fach-Commit ([incomes/route.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/incomes/route.ts:7), [expenses/route.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/expenses/route.ts:17)). Der Kassenbuch-Service rundet zwar an der Grenze auf zwei Dezimalstellen, speichert aber Float und berechnet laufende Salden wieder als Float ([cashbook-service.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/lib/cashbook-service.ts:9)).

### v1, Import und Dokumentdateien

* `/api/v1/invoices` benutzt für Statusänderung und Löschung denselben `invoice-payments`-Service ([v1/invoices/route.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/v1/invoices/route.ts:104)). Eine Änderung muss daher Web- und v1-Vertrag zugleich prüfen.
* Web- und v1-Upload duplizieren die Multipart-/Parserlogik. Beide speichern Originaldatei und die extrahierten Werte, legen bei Bedarf einen Kunden an und schreiben eine `Invoice` ([invoices/upload/route.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/invoices/upload/route.ts:116), [v1/invoices/upload/route.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/v1/invoices/upload/route.ts:125)). Die Angebotsumwandlung delegiert an den Web-Upload und behauptet damit implizit dessen Vertrag ([quotes/[id]/convert/route.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/quotes/[id]/convert/route.ts:5)).
* Der Parser kennzeichnet jedes Ergebnis ausdrücklich als `NOT_VALIDATED`; XSD/Schematron werden nicht ausgeführt ([e-invoice-parser.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/lib/e-invoice-parser.ts:48)). Die Importgrenze prüft EUR, Dokumenttyp, Brutto-/Fälligkeitsbetrag und Vorauszahlung, aber nicht ein kanonisches Positionsmodell gegen DB/PDF ([e-invoice-parser.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/lib/e-invoice-parser.ts:584)). Das ist die Vorbedingung aus BV-016/BV-013.
* Die manuelle Erstellung nutzt `lib/invoice-calculation.ts` intern mit `BigInt`, während Persistenz und Auswertungen Float/REAL verwenden ([invoice-calculation.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/lib/invoice-calculation.ts:1)). Das bestehende Verhalten ist eine Stärke, die bei BV-012 als Referenz für Rundungstests erhalten werden muss.

### Serien, Restore und Exporte

* Wiederkehrende Ausgaben werden über Web- und v1-CRUD geschrieben ([recurring-expenses/route.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/recurring-expenses/route.ts:28), [v1/recurring-expenses/route.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/v1/recurring-expenses/route.ts:90)). Die Web-Ausführung liest fällige Serien vorab, liest jeden Kandidaten in einer Transaktion erneut und erzeugt je `scheduledDate` höchstens eine Ausgabe; Audit folgt erst nach den Transaktionen ([recurring-expenses-service.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/lib/recurring-expenses-service.ts:9)). Einen v1-Ausführungsendpunkt gibt es in den gelesenen Routen nicht.
* JSON- und ZIP-Backup exportieren `Invoice`, `Income`, `Expense`, Serien, Kasse, Dokumentation und API-Key-Metadaten, aber weder `AuditLog` noch `InvoiceNumberCounter`; nutzbare Schlüssel werden bewusst nicht exportiert ([backup/route.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/backup/route.ts:11), [backup/full/route.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/backup/full/route.ts:17)).
* Restore validiert IDs, Daten und Relationen vor einer DB-Transaktion, löscht im Überschreibmodus aber alle fachlichen Modelle und lässt AuditLog absichtlich stehen ([backup-restore.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/lib/backup-restore.ts:195), [backup-restore.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/lib/backup-restore.ts:294)). Es importiert keinen Auditbestand, keinen Counter und keine API-Key-Geheimnisse. Die Restore- und Security-Audits werden erst nach dem Restore geschrieben ([backup/full/restore/route.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/backup/full/restore/route.ts:55)).
* KPI-/Dashboard- und EÜR-Pfade summieren Float/REAL und gruppieren mit SQLite `localtime`; EÜR rundet erst beim Export ([dashboard/kpis/route.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/dashboard/kpis/route.ts:127), [eur-export/route.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/eur-export/route.ts:76)). `lib/accounting.ts` verwendet lokale `Date`-Grenzen ([accounting.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/lib/accounting.ts:102)). Damit sind BV-012 und BV-057 Querschnittsänderungen, nicht nur Schemaänderungen.

## Gemeinsame Risiken und daraus abgeleitete Invarianten

1. **Geldmigration:** Eine Umstellung von `Float` auf Cent betrifft Rechnung, Zahlung, Einnahme, Ausgabe, Kasse, AfA, KPI, EÜR, JSON-Verträge, v1, Import und Restore. Die Rechenbasis aus `invoice-calculation.ts` darf nicht durch JavaScript-Float ersetzt werden. Ein Migrationslauf muss jede Differenz, Objektanzahl, Fremdreferenz und Summe ausweisen und abbrechen, wenn Betrag oder Bereich nicht exakt konvertierbar sind.
2. **Rechnung gegen Zahlung:** Ein Dokumentstatus ist keine Zahlung. Ein Snapshot enthält die ausgestellten Werte; Stammdatenänderungen verändern ihn nicht. `Payment`/`PaymentAllocation` (Vorschlag aus BV-014) müssen Teilzahlungen, Mehrfachzuordnung, Überzahlung, Gebühr, Rückzahlung und Rücklastschrift als eigene Geldereignisse ausdrücken. Eine Zuordnung darf nie mehr als ihre Payment-Summe oder den offenen Snapshot-Betrag erklären.
3. **Audit-Atomizität und Wiederholung:** `createAuditLog` verwendet heute immer den globalen Prisma-Client und verschluckt Fehler ([audit-log.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/lib/audit-log.ts:192)). Ein Fachwrite kann deshalb ohne Nachweis committen. Jede neue Finanzmutation braucht `TransactionClient` oder eine transaktional unverlierbare Outbox, eine fachliche Operations-/Idempotenzreferenz und Actor/Owner, Operation, Originalreferenz, Zeitpunkt, Grund und redigierte Werte.
4. **Restore und Nummern:** Backup, Restore, Counter und Audit sind eine Einheit. Nach Restore muss die höchste jemals vergebene Nummer erhalten bleiben, auch wenn der Beleg gelöscht oder inaktiv ist; ein neues Modell darf nicht still aus dem Manifest fallen. Restore darf keine Auditkette überschreiben und muss Secrets getrennt behandeln.
5. **Datum:** Fachlicher Geschäftstag (`YYYY-MM-DD`) und technischer UTC-Instant sind getrennt. Berlin/DST/Jahreswechsel dürfen nicht vom Browser-`toISOString`, Container-TZ, SQLite-`localtime` oder unterschiedlichen API-Defaults abhängen. Import, Serie, Kasse, UI, KPI, EÜR, Backup und Restore müssen denselben Tenant-TZ-Vertrag nutzen.
6. **Featurefreigabe:** Im aktuellen Repository gibt es keinen Capability-/Featureflag-Dienst; `proxy.ts` schützt Seiten, APIs authentifizieren sich jeweils selbst ([proxy.ts](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/proxy.ts:5)). BV-156 darf daher keine reine Navigation-Ausblendung werden. Gesperrte, read-only oder unsupported Zustände müssen an jeder Web-/v1-Schreibroute serverseitig vor Datei-, DB- oder Mail-Seiteneffekten geprüft und als stabiler Fehler beantwortet werden.
7. **Datei und externe Effekte:** Uploads werden vor der DB-Transaktion geschrieben und bei Fehlern best effort gelöscht; E-Mail wird außerhalb der Fachmutation versendet. Snapshot/Hash, Datei-Lebenszyklus, Outbox/Job und Wiederholung brauchen deshalb einen expliziten Recoveryvertrag. Kein DB-Retry darf blind SMTP oder Agentenaktionen wiederholen.

## Priorisierte vertikale Scheiben

Die folgende Reihenfolge ist eine Empfehlung zur Begrenzung gemeinsamer Änderungen. Sie ist keine fachliche Freigabe und ersetzt nicht die vier Ticket-Akzeptanzfälle.

### 0. Gemeinsamer Vertrag und Evidenzmatrix — Product Owner, Accounting PO, Platform/DB

Vor Schemaarbeit als ADR/Plan festhalten: Single-Company-Zielgruppe aus BV-066; MoneyEUR als Integer-Cent; skalierte Dezimaldarstellung für Menge/Einzelpreis; `BusinessDate` plus UTC-Instant und Tenant-TZ; Snapshot/Originalbytes/Hash; Payment/Allocation/Refund; Backup-Manifest und Counter; Capability-Semantik. Für jeden Schreibweg (UI, Web-API, v1, Import, Restore, Serie, Kasse, Export, Mail) eine Besitzerdatei, gemeinsame Servicegrenze und Negativfixture benennen.

Abnahme: BV-066-AC1/AC3/AC4 und BV-138-AC1/AC2/AC4 sind als Reviewnachweis verlinkt; ungelöste Fachfragen bleiben als Entscheidung offen. Es gibt eine Liste der erlaubten Seiteneffekte je Service und eine Testmatrix für Rundung, DST, Retry, Fremd-Owner und Restore.

### 1. BV-029 Backup v3 — Platform + Database Engineer, eine Migrationsverantwortung

Zuerst Manifest und Dry-run für das heutige Modell bauen: Schema-/Backupversion, geschlossene Objektmatrix, Herkunfts-IDs, Hash-/Dateimanifest, Auditsegment, `InvoiceNumberCounter`, fachliche Zähl- und Summenproben, `excludesSecrets` und Re-Key-Anleitung. JSON und ZIP müssen denselben Export-/Restore-Kern benutzen. Restore in leerer synthetischer SQLite-Instanz und Merge-/Overwrite-Pfade getrennt prüfen; Produktionsdaten bleiben unberührt.

Invarianten: keine unbekannte Modellliste; Referenzen und Counter bleiben erhalten; Auditbestand wird nur angehängt, nicht ersetzt; API-Key-Klartext kommt weder ins Archiv noch in Logs; fehlende Datei/Hash/Differenz blockiert statt Teilrestore.

Abnahme: BV-029-AC1 bis AC4 mit leerer Zielinstanz, ehemals höchster Nummer, API-Key-Metadaten und absichtlich ergänzt/provisorisch unbekanntem Modell. Vorhandene Restore-Dateien gehören in diese Scheibe; Geldmigration wartet auf den manifestierten Rückfallpfad.

### 2. BV-006 Audit-Transaktion — Backend + Accounting PO

`createAuditLog` und Convenience-Funktionen auf einen optionalen `Prisma.TransactionClient` und typisierte, redigierte Eventpayloads umstellen. Für den ersten vertikalen Pfad `Invoice`-Statuszahlung oder eine manuelle `Income`-Mutation wählen, anschließend dieselbe Grenze in Cashbook, Cancel/Credit-Note und Serienausführung verwenden. Operations-ID/Idempotenzschlüssel müssen aus dem Fachrequest kommen; globale Security-Telemetrie bleibt separat best effort.

Invarianten: Audit-Fehler rollen Fachmutation zurück; Audit ist nach Commit vorhanden; serielle Wiederholung erzeugt kein zweites Geschäftsergebnis; keine Secrets; `userId`/Owner-Check liegt innerhalb der Transaktion vor Seiteneffekten.

Abnahme: BV-006-AC1 bis AC4, einschließlich gezieltem Audit-Insert-Fehler, Prozessende direkt nach Commit, serialisiertem Retry und vollständiger Eventpayload. Keine Statusänderung auf erledigt ohne echten Integrationsfixture.

### 3. BV-057 + BV-012 Domain-Pilot — Domain/Database Engineer, UI/API/v1 als Adapter

Nach der Vertragsentscheidung zuerst einen begrenzten, aber vollständigen `Expense`-/`RecurringExpense`-Pfad umstellen: Web-UI, Web-API, v1-API, Serienerzeugung, Backup/Restore und EÜR/KPI-Leseprojektion. Der Pfad dient als Rechen- und Datumsreferenz; danach folgt die Rechnung/Zahlungsdomäne. Eine Dual-Read-/Differenzansicht für den Altbestand muss vor dem Backfill jede Float-/DateTime-Abweichung zeigen. Alle Schemaänderungen und Backfills werden von einer Person sequenziert.

Invarianten: identische Rundung für 0,1/0,2, Halbcent und große Werte; kein Overflow/Abschneiden; `BusinessDate` bleibt in Europe/Berlin stabil, UTC-Reihenfolge eindeutig; Serien erzeugen pro fachlichem Termin höchstens einmal; UI, API, v1, EÜR, Kasse und Restore liefern für dieselbe Periode denselben Centbetrag.

Abnahme: BV-012-AC1 bis AC4 sowie BV-057-AC1 bis AC4 mit synthetischen Altwerten, Berlin-Mitternacht, DST, Jahreswechsel, nicht konvertierbaren Beträgen und Restore-Vergleich. Die bisherige Float-Spalte erst entfernen, wenn Differenzbericht, Rückfallkopie und Nachweis vorliegen.

### 4. BV-042 → BV-040 → BV-016 → BV-013 Dokument-/Snapshot-Scheibe — Document Engineer + Accounting Backend

Die erste Stufe ist BV-042. Danach folgen gemäß Backlog BV-040,
BV-016 und BV-013: Uploadpipeline und formale Validatoren zentralisieren,
Magic-Bytes/Format, XML-Tiefen-/Knotenbudget, Quarantäne, versionierte
XSD/Schematron- und PDF/A-Ergebnisse am unveränderten Original. Danach ein
serverseitiges kanonisches Invoice-Modell aus validierten Positionen und
Steuern ableiten. Beim manuellen UI-Pfad akzeptiert der Server
Entwurfseingaben, rechnet selbst und erzeugt/prüft PDF/XML; beim Import
vergleicht er Originalwerte und meldet jede Differenz. SnapshotHash verbindet
DB-Werte und Artefakte.

Invarianten: Originalbytes unverändert; eine gültige Finalisierung erzeugt DB, PDF und XML aus demselben Snapshot; Stammdaten ändern keinen ausgestellten Snapshot; importierte Zahlung referenziert Betrag und Original-Hash; ungültige oder divergierende PDF/JSON/XML blockieren.

Abnahme: BV-016-AC1 bis AC4 und BV-013-AC1 bis AC4. Der P0-Gate aus BV-013 bleibt offen, bis Web-Upload, v1-Upload, JSON-Kompatibilitätspfad, Angebotsumwandlung, Zahlung und Stornierung denselben Service benutzen.

Die Empfehlung, das Zahlungsjournal erst nach dem Snapshot einzuführen, ist
eine optionale Architektur- und Migrationsreihenfolge wegen der gemeinsamen
Geld- und `Invoice`-Semantik. Sie ist keine Backlog-Abhängigkeit: BV-014 hat
laut Tabelle ausschließlich BV-012 und BV-006 als direkte Vorgänger.

### 5. BV-014 Zahlungsjournal — optionale Architekturfolge nach Snapshot; Accounting Backend

Erst nach Money- und Snapshot-Vertrag `Payment`, `PaymentAllocation` und ein eigenes Refund-/Charge-Ereignis modellieren. `Invoice.status` bleibt Dokumentstatus; offener Betrag wird abgeleitet. Die bestehende `Income.invoiceId @unique`-Vollzahlung wird über eine explizite, reversible Migration in das Journal überführt; jeder Altwert wird einer Ursprungsreferenz zugeordnet. Kassenbuchverknüpfungen und EÜR müssen die neue Geldereignisquelle lesen.

Abnahme: BV-014-AC1 bis AC4 mit 300/700 EUR, einer Zahlung für mehrere Rechnungen, Überzahlung/Gebühr und Rückzahlung/Rücklastschrift. Vergleich vor/nach Migration: Objektzahlen, Summen, offene Posten, Datumswerte, Belegreferenzen und Auditketten.

### 6. BV-138 und BV-156 — Product Owner führt, API/Security implementiert

BV-138 als verbindliche Definition-of-Done vor produktiver Freischaltung dokumentieren: Architekturregeln, Schema/Migration/Audit/Negativtest, Quellen und alle vier AC-Evidenzen. BV-156 danach als kleiner serverseitiger Capabilitydienst: Release-/Tenant-Flag, `enabled`/`read-only`/`unsupported`, stabile Fehlercodes, Audit mit Actor/Grund/Version/Tenants und Kill-Switch für Steuer-Simulation, Restore und Send. UI-Navigation darf nur ein Spiegel des Serverentscheids sein.

Abnahme: BV-156-AC1 bis AC4 mit direktem Web- und v1-Aufruf, read-only-Lese-/Schreibpaar, Kill-Switch auf alte Simulationsergebnisse und Flagänderungs-Audit. Eine Aktivierung ist erst nach Evidence aus den vorgelagerten Scheiben zulässig; ein Flag ist Eindämmung und kein Ersatz für die Fachkorrektur.

## Besitzergrenzen und offene Entscheidungen

* **Product Owner/Fachreview:** Zielsegment, unterstützte Geschäftsfälle, Claims, rechtliche Aussage, Freigabedatum und Flagzustand. Darf keine Geld-/Restore-Semantik allein im UI entscheiden.
* **Accounting Backend:** Money- und Datumsinvarianten, Snapshot, Payment/Allocation, EÜR-Bedeutung, idempotente Finanzmutation und AC-Fixtures. Darf keine abweichende Parser- oder Backup-Domäne erfinden.
* **Domain/Database Engineer:** Prisma-Migrationen, Backfill-/Differenzbericht, Counter, Indizes und Restore-Reconciliation. Eine koordinierte Person besitzt alle gemeinsamen Schemaänderungen.
* **Document Engineer:** Originaldateien, Parser-/Validatorversion, Artefakthash, Quarantäne und PDF/XML-Erzeugung. Darf keine Forderung oder Zahlung aus Dateitext ohne Accounting-Service buchen.
* **Platform/API/Security:** Transaktions-/Outbox-Infrastruktur, v1/Web-Verträge, Owner/Scope/Auth, Capabilityprüfung und Rollout-/Recoverypfad.
* **UI:** Darstellung und Eingabe; keine DB-Schreibwege und keine alleinige fachliche Berechnung. Clientberechnungen sind Vorschau, Serverberechnung ist verbindlich.

Vor Implementierung offen und zu entscheiden:

1. Sollen Menge, Einzelpreis und Steuer als skalierte Strings mit welcher Skala gespeichert werden, und wie werden bestehende JSON-Verträge versioniert?
2. Wird für unverlierbares Audit ein transaktionaler Audit-Datensatz oder eine DB-Outbox gewählt, und welche Operations-ID gilt über Retry/Web/v1?
3. Welche Snapshot-/Artefakt-/Hashmodelle und welche Parser-/Validatorversion gelten für historische Importe?
4. Wie werden Alt-`Income`-Vollzahlungen, Kassenbuchreferenzen und Rückerstattungen fachlich migriert, ohne einen Geldfluss rückwirkend zu löschen?
5. Welche Objekte, Summen, Counter und Auditsegmente sind im Backup v3 zwingend, und wie werden historische API-Schlüssel ersetzt?
6. Ist `Europe/Berlin` zunächst fester Default oder pro Tenant konfigurierbar, und wie werden alte DateTimes mit fehlender Herkunft behandelt?
7. Welche Module dürfen im Single-Company-Pilot überhaupt aktiviert werden, und wer zeichnet die BV-156-Flagänderung fachlich ab?

Bis diese Entscheidungen mit Verantwortlichem und Evidenz dokumentiert sind, sind BV-012, BV-013, BV-014, BV-029, BV-057 und BV-156 Planungsgegenstand. Diese Datei erteilt keine fachliche, rechtliche oder produktive Freigabe.

## Quellen und Prüfgrenzen

Backlog-Findings: F01, F06, F08, F12, F13, F14, F16, F29, F40, F42 und F57. Ticketquellen: C02, C03, C06–C14, C17, C18, C21, C23, C25, C26, C31–C35, C37, C38, C41–C43, C46, C47, C49, C51, C54, CI02 und S02 gemäß Backlog. Besonders relevante aktuelle Pfade sind oben direkt verlinkt. Die Backlog-Auditmethode war eine risikobasierte statische Prüfung ohne lokale Repositorytests; in dieser Vorprüfung selbst wurden keine Produkt- oder Datenbanktests ausgeführt. Ein später aus der Agentenkoordination gemeldeter `migrate deploy`-Vorfall auf der lokalen `prisma/dev.db` wird separat im [Prüfvorfallbericht](PRUEFVORFALL-2026-09-19.md) untersucht und ist nicht als „keine Daten verändert“ abzuschließen.
