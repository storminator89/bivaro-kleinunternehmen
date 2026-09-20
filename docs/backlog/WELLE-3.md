# Welle 3 – Snapshot, Business-Date und Kassenatomizität

Aktueller Abschlussstand: [Welle 7](WELLE-7.md) führt die zwölf ACs fort.
BV-011, BV-025 und BV-030 sind dort mit jeweils 4/4 Kriterien technisch
abgeschlossen. Die
folgenden Tabellen und Prüfstände bewahren den historischen Startstand dieser
Welle.

Stand: 19.09.2026, 10:57:43 Europe/Berlin. Auditbasis:
`85972ed9fe61d268b6640882ea2ddc6e616d1859`.

Welle 3 startet drei begrenzte Pakete. Sie baut auf den technischen
Teilumsetzungen aus Welle 2 auf und behauptet keine vollständige
Money-/Zeitzonenmigration, keine fachliche Freigabe und keinen produktiven
Rollout. Es sind keine neuen Schemaänderungen geplant.

## Zuordnung

| Ticket | Besitzer | Begrenzte Scheibe | Status | Abhängigkeiten und offene Punkte |
|---|---|---|---|---|
| BV-030 | `architektur_vorpruefung` | Gemeinsamer konsistenter DB-Read-Snapshot für JSON- und ZIP-Backup, Snapshot-Metadaten, kurze Lockphase und ein echter Parallel-Payment-Test. | In Arbeit | Baut auf BV-029-Manifest/Restore und BV-006-Finanz-Audit auf; Export-/Restore-ACs, Performancegrenzen, Rollout und fachliche Abnahme offen. |
| BV-025 | `betriebssicherheit` | Pflichtfeld `BusinessDate` für manuelle Einnahmen in Web, v1 und UI; eng begrenzte BV-057-Grundlage und transaktionales Audit an der BV-006-Grenze. | In Arbeit | Keine Rückdatierung von Altbeständen; vollständige Business-Date-/UTC-Modellierung, weitere Einnahmewege, AC-Nachweise und Freigaben offen. |
| BV-011 | `root` | Negative chronologische Kassen-Zwischenstände atomar verhindern, mit Centarithmetik sowie echten Rollback- und Paralleltests. | In Arbeit | Keine vollständige BV-012-Money-Migration; bestehende Kassenfachlogik, konkurrierende Buchungen, Negativmatrix und fachliche Abnahme offen. |

## Gemeinsame Grenzen

- BV-030 liefert den gemeinsamen Snapshot als Grundlage für Backup v3; es
  ersetzt keine vollständige Modellabdeckung aus BV-029 und führt keine neue
  Restore-Fachsemantik ein.
- BV-025 führt `BusinessDate` nur für den begrenzten manuellen
  Einnahmepfad. UTC-Ereigniszeit und weitere fachliche Datumssemantik bleiben
  getrennt; Altbestände werden nicht rückdatiert.
- BV-011 nutzt Centarithmetik an der Kassenservicegrenze. Das ist eine
  atomare Guard-Scheibe und keine vollständige Umstellung des Money-Modells
  aus BV-012.
- Root koordiniert gemeinsame Transaktions-, Audit- und Testgrenzen. Kein
  Paket erteilt allein eine fachliche oder produktive Freigabe.

## Prüfstand

Die letzte grüne Gesamtbaseline bleibt: 26 Testdateien, 240 Tests bestanden,
1 Skip in 15,48 s, `npm run lint` ohne Warnungen und 7/7 E2E in 17,0 s mit
Productionbuild, Typecheck, Standalone und isolierter `e2e.db`. Zusätzlich sind
10/10 File-Security-Integration und 25/25 Betriebsagententests dokumentiert.

Für Welle 3 liegt noch kein paketbezogener Testnachweis vor. Neue Tests müssen
synthetische oder isolierte Ziele verwenden und werden mit echten
Parallel-/Rollbackfällen je Paket ergänzt. Remote-CI und Produktivdeployment
bleiben außerhalb dieser Welle.

## Statusgrenze

BV-011, BV-025 und BV-030 bleiben „In Arbeit“, bis ihre begrenzten Scheiben,
Negativfälle, verlinkte AC-Evidenz und die Root-koordinierte Prüfung vorliegen.
Die technische Lieferung wird nicht als vollständige Money-, Business-Date-
oder Backup-Freigabe ausgegeben.
