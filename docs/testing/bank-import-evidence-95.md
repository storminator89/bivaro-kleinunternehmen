# Bankimport-Evidenz #95 — lokale Prüfnachweise

Stand: 22.10.2026. Umfang: bewusste Speicherung unzugeordneter Bankevidenz und Importquittung. Keine Zahlungszuordnung und keine Bankanbindung. Dies ist keine Veröffentlichungs- oder vollständige Browser-Abnahmebehauptung.

## Automatisierte Fachnachweise

Die Tests verwenden ausschließlich synthetische Daten und frisch erzeugte private SQLite-Fixtures. Relevante neue Testdateien:

- `bank-import-service.test.ts`: tatsächliche Originalbytes/BOM, striktes Mapping, Quell- und Bodylimits, unveränderte Finanzmodelle, wiederholte und konkurrierende Bestätigung, geänderte Payloads unter derselben UUID, identischer Payload unter frischer UUID, Überschneidungen, widersprüchliche Bank-IDs, Kontoalias-/Tenantgrenzen, unveränderliche Quittungen, Pagination, vollständiger Transaktionsrollback, wiederholter Datenbankversuch, Unicode-Begrenzung und Restore.
- `bank-import-backup.test.ts`: exakte neue Capability bei unveränderter alter kombinierter Capability, erforderliche Arrays, historische Zukunftsfeld-Ablehnung, geschlossener portabler Graph, UUID-/Hash-/Zeilenkontrollen, exakte Cent-Kontrollsummen, unveränderte historische Warnungen, kein falscher Eindeutigkeitsbeweis.
- `bank-import-client.test.ts`: unveränderte Originalbytes, Bestätigungspayload ohne Browser-Kontrollsummen, GET-Recovery vor erneutem POST, gleiche UUID bei unbekanntem Ergebnis, vorhandene Quittung bei `409`, kein POST nach fehlgeschlagener Recovery, read-only und HTML-escaped Quittungsansicht.

Die drei neuen Suiten bestehen zusammen aus **42 erfolgreichen Tests**. Die vorhandenen Bankvorschau-/Rechnungsdaten-/UI-Regressionen bleiben Bestandteil der Gesamtprüfung.

## Qualität und Schema

- Vollständiges ESLint mit null Warnungen: erfolgreich.
- Vollständige TypeScript-Prüfung ohne Emit: erfolgreich mit begrenztem Node-Heap und serieller Ausführung. Frühere parallel ausgeführte Versuche wurden vom Executor ohne Compilerdiagnostik beendet; sie sind keine erfolgreichen Typprüfungen.
- Alle Migrationen auf eine frische private SQLite-Fixture angewandt; anschließender Prisma-Schema-Diff: **keine Differenz**.
- Unabhängiger read-only Review: gefundene Probleme bei wiederholten Transaktionswarnungen, History-/Detail-Request-Eigentümerschaft, gekürzten ungültigen IDs und Fokusrückkehr behoben. Erneuter Review ohne weitere belastbare P1/P2-Befunde.

Vollständige Unitprüfung: **2148 bestanden, 8 übersprungen, 0 fehlgeschlagen** über 173 Testdateien; Ergebnis erfolgreich, keine Workerfehler in der abschließenden seriellen Runde mit begrenztem Heap. Eine vorhandene Node-Modultyp-Performancewarnung aus dem Geldmigrationsreport bleibt ohne Produktänderung bestehen. Historische Fixture-Anpassungen entfernen tatsächlich neue Bankabschnitte und Modellabdeckung aus alten Identitäten; die Produktvalidierung wird nicht gelockert.

## Gehostete Abnahme — nur vorbereitet

`hosted-acceptance/bank-import-receipt.spec.ts` und die separate `playwright.bank-import-hosted.config.ts` starten keinen lokalen Server und keinen Build. Sie sind ausschließlich für einen später ausdrücklich freigegebenen veröffentlichten Kandidaten mit synthetischem QA-Tenant bestimmt. **Sie wurden nicht ausgeführt.** Die Konfiguration verlangt einen expliziten HTTPS-Zielursprung, eine zuvor verifizierte Kandidatenkennung sowie ausdrückliche Freigabe für synthetische Bankevidenz-Schreibvorgänge. Zugangsdaten gehören ausschließlich in die Laufzeitumgebung, nicht in Dateien oder Reports.

Vorbereitete Szenarien bei 1440, 360 und 390 px: Vorschau ohne POST, Zurück/Verwerfen mit Fokusrückkehr, explizite Bestätigung, verlorene Antwort nach tatsächlichem Commit, Recovery ohne zweite Speicherung, Reload und read-only Verlauf, Wiederholung derselben Datei unter frischer UUID, keine Einnahme-/Ausgabenänderung, Screenshots und horizontale Überlaufkontrolle.

Zusätzlich bei der echten Abnahme manuell prüfen: leerer Verlauf, defekte/zu große Datei, falsches Dezimalzeichen/Vorzeichen/Datum, verständliche Fehler, tatsächliche Bildkontrolle, Tastatur und sichtbarer Fokus, Navigation/Abbruch während verzögerter Antworten, wiederholtes Öffnen und History-Refresh sowie Wiederherstellung in einem getrennten synthetischen Zieltenant. Screenshots allein sind keine abgeschlossene Bildkontrolle.

## Nicht ausgeführt

Kein nativer App-Build, kein lokaler Browserlauf, kein neuer GitHub-CI-Lauf, keine Veröffentlichung oder produktive Migration. Reale Bankdaten, Bankverbindungen, Zahlungen, KI und externe Uploaddienste sind nicht Teil dieser Prüfung.
