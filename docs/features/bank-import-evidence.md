# Unzugeordnete Bankimport-Evidenz

## Liefergrenze

Die Bank-CSV-Vorschau bleibt bis zum ausdrücklichen Speichern im Arbeitsspeicher des Browsers. Erst „Geprüfte Umsätze speichern“ überträgt die Originalbytes zur unabhängigen serverseitigen Prüfung. Maximal 2 MiB, 2.000 Umsatzzeilen, 64 Spalten und 4.000 Zeichen pro Quellfeld; nur UTF-8.

Gespeichert werden ein unveränderlicher tenantgebundener Batch und begrenzte normalisierte Zeilenbelege. **Keine Rohdatei wird archiviert.** Der SHA-256-Dateihash bezieht sich auf die tatsächlichen Originalbytes einschließlich einer vorhandenen UTF-8-BOM. Nicht ausgewählte Quellspalten und der Dateiname werden nicht gespeichert. Parser- und Mappingversion sind `bank-csv-v1` beziehungsweise `bank-csv-mapping-v1`.

Die Quittung enthält Kontoalias, Zeitpunkt, Dateihash, Dateigröße, Versionen, Zeitraum gültiger Zeilen, Anzahlkontrollen und getrennte EUR-Haben-/Soll-Kontrollsummen als exakte ganzzahlige Cent-Zeichenketten. Fehlerhafte oder unklare Zeilen bleiben mit Prüfhinweisen erhalten, aber ohne bestätigten Centbetrag. Negative gültige EUR-Zeilen bleiben negative, unzugeordnete Evidenz. Fremdwährungen werden nicht umgerechnet.

Speichern erzeugt **keine** Zahlung, Einnahme, Ausgabe, Rechnung, Nummernreservierung oder sonstigen Journaleintrag. Es gibt keinen Zuordnungs-, Zahlungs-, Bearbeitungs- oder Löschendpunkt für diese Evidenz. Der Kontoalias ist ein unveränderlicher eigener Name, kein Bankzugang und keine verifizierte Bankkontoidentität.

## Identität und Wiederholung

- Portable Batch- und Zeilen-UUIDs sind von internen Datenbank-IDs getrennt. Die Quellposition identifiziert eine Zeile innerhalb ihres Batches.
- Die Request-UUID gehört einem Tenant. Derselbe Schlüssel mit demselben kanonischen Payload liefert dieselbe unveränderte Quittung. Ein anderer Payload unter demselben Schlüssel ergibt `409`.
- Der kanonische Fingerprint umfasst Originalbytehash, Mapping, tatsächlichen Trenner, Parser-/Mappingversion und den im Mapping enthaltenen unveränderlichen Kontoalias. Request-ID, Zeitpunkt und spätere Überschneidungshinweise sind kein Bestandteil.
- Derselbe Payload unter einer frischen UUID erzeugt keinen zweiten Batch: `409` enthält die Kennung der vorhandenen eigenen Quittung. Die Oberfläche öffnet diese Quittung.
- Nach unbekanntem Netzwerkausgang wird zuerst die ursprüngliche UUID gelesen. Nur wenn dazu keine Quittung vorhanden ist, wird derselbe Payload mit derselben UUID erneut bestätigt. Ein Reload kann gespeicherte Quittungen über den Importverlauf wiederfinden; es gibt keine neue Browser-Dauerablage für Bankdaten.
- Überschneidende Exporte werden als getrennte Quellen vollständig erhalten. Kontoalias und externe Bank-ID bilden nur ein Prüfsignal, keinen universellen Eindeutigkeitsbeweis. Gleiche Datums-/Betragswerte dürfen echte getrennte Umsätze sein. Keine Zeile wird still verworfen.
- Trefferzahlen und Warnungen beschreiben ausschließlich den Bestand zum Importzeitpunkt. Wiederholung oder Restore berechnen diese historische Evidenz nicht neu.

## Private API

Alle Endpunkte verwenden die vorhandene serverseitig validierte Sitzung. Mutationen behalten den bestehenden Origin-Schutz. Antworten sind `private, no-store`.

| Methode | Pfad | Vertrag |
| --- | --- | --- |
| POST | `/api/bank-imports` | Explizites `reviewed: true`, Request-UUID, Base64-Originalbytes, Mapping, Trenner, exakte Versionen. Keine Browser-Zeilen oder -Kontrollsummen akzeptiert. Bodylimit 3 MiB; Original separat auf 2 MiB begrenzt. |
| GET | `/api/bank-imports?requestId=…` | Quittung derselben eigenen Request-UUID oder `null`; keine Übernahmehandlung. |
| GET | `/api/bank-imports?page=…` | Je 20 eigene Quittungen, mit `hasMore`. |
| GET | `/api/bank-imports/{uuid}?page=…` | Eigene Quittung und höchstens 20 normalisierte Zeilenbelege. Fremde und fehlende Kennungen ergeben `404`. |

Dateiinhalte, Gegenparteien, Referenzen und Kontoalias werden weder in URLs noch in Fehlerlogs oder Audit-Metadaten geschrieben. Audit enthält nur Kennung und Anzahlkontrollen. Die Quittung ist eine technische Übernahme-Evidenz, keine Banksignatur und kein Beweis der Echtheit eines Exports.

## Backup und Restore

Die additive Migration und exakte Capability `20261022050000_add_bank_import_evidence` erweitern die zuvor kombinierte Projekt-/Outbox-/Validierungs-Capability. Die alte Identität `20261022030000_combine_projects_outbox_validation` und alle historischen Capability-Bedeutungen bleiben unverändert.

Neue Backups benötigen `bankImportBatches` und `bankImportRows`, auch wenn leer. Ältere Capabilities dürfen diese Zukunftsabschnitte nicht enthalten. Snapshots enthalten portable UUID-Verknüpfungen, normalisierte Evidenz und Quittungen, keine Originaldatei und keine internen Eigentümer-/Batch-IDs.

Restore prüft den geschlossenen Graphen, UUIDs, Hashes, Mapping, Zeilenpositionen, Kontrollsummen und historischen Prüfhinweise. Beim Tenantwechsel werden nur Eigentümer und interne Verknüpfungen neu gebunden. Bestehende Bankhistorie bleibt auch im Überschreibmodus erhalten. Gleiche unveränderliche Graphen werden übersprungen; abweichende UUID-/Request-/Fingerprint- oder Zeilenkollisionen brechen die gesamte Restore-Transaktion ab. Restore löst keine Zahlungen, Sendungen, neue Importbewertung oder Wiederbuchung aus.
