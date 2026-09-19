# Welle 4 – Steuer, EÜR und Kontodeaktivierung

Stand: 19.09.2026, 22:12 Europe/Berlin. Die Welle liefert technische
Teilumsetzungen. Sie erteilt keine Steuer-, Rechts-, GoBD- oder
Produktivfreigabe.

## Zuständigkeiten und Scope

| Besitzer | Tickets | Gelieferte Scheibe | Grenze |
|---|---|---|---|
| `steuer` | BV-019–BV-024 | Vollständige serverseitige Steuer-Summary, gemeinsame Accounting-Jahresbasis, jahresbezogene Regelpakete 2025/2026, §35-Begrenzung, Soli-/Tarif-Endrundung und explizite Grenzen | Keine gemeinsame Veranlagung, weiteren Einkünfte, Verlustvor-/rückträge oder allgemeine Steuerberatung; fachliche Steuerabnahme offen |
| `eur` | BV-026/BV-027 | Vorzeichenrichtige Korrekturen/Erstattungen, gemeinsame EÜR-Accounting-Summe, jahresversioniertes Mapping, Kontrollsummen, Quellen und CSV-Arbeitsunterlage | Kein ELSTER-Import; Formularzeilen, AfA-Anlagearten, Sonderbelege und fachliche Exportabnahme offen |
| `root` | BV-007 | Additive Deaktivierung mit `deactivatedAt`, Erhalt der Finanzhistorie, Entzug von Session/API-Key-Zugriff und transaktionales Audit | E2E 11/11 und zentrale technische Prüfung grün; Retention-/Legal-Hold-Workflow, Ownernachfolge und AC3/AC4 offen |
| `dokumentation` | Prüfumfang | [Prüf- und Abnahmeplan](PRUEFPLAN-GOBD-RECHT.md), [BV-007-Bericht](BV-007.md), zentrale Statusdateien | Keine Produktcodeänderung und keine fachliche Freigabe |

## Gezielte Evidenz

- BV-007: `user-deactivation.test.ts` 5/5; kombinierter Auth-/API-Key-/Deaktivierungslauf 24/24.
- Steuer: `tax-summary.test.ts`, `tax-calculator.test.ts` und unabhängiges
  `tax-reference-grid.test.ts`; das Referenzgitter umfasst vier Tests mit
  1.000.004 ganzzahligen Vergleichswerten für 2025/2026.
- EÜR/Steuer: gezielter Lauf aus `tax-calculator`, `tax-summary`,
  `eur-line-mapping`, `eur-export-accounting`, `dashboard-accounting` und
  `user-deactivation`: 7 Dateien, 76 Tests bestanden; die 76 Tests sind die
  gemeinsame Welle-4-Scheibe und keine isolierte EÜR-Testzahl.
- Steuer-Summary-Route: 3/3 Integrationstests für Mandantentrennung,
  Authentifizierung, mehr als 100 Buchungen und nicht unterstützte
  Kombinationen bestanden.
- Die Tests verwenden isolierte Datenbanken bzw. reine Fixtures. Die
  Testzahlen sind kein Nachweis einer Steuerberaterprüfung, eines
  ELSTER-Imports, einer GoBD-Konformität oder eines Produktiv-Restore.
- Die Migration `20260919200000_user_deactivation` wurde nur in isolierten
  Testdatenbanken verwendet; `prisma/dev.db` wurde dafür nicht migriert. Vor
  einem neuen Server ist das vorgesehene Datenbankziel mit
  `npm run db:migrate` zu aktualisieren.

## Abschlusskriterien der Welle

Die zentrale technische Prüfung ist abgeschlossen: 35 Testdateien mit 285
Tests bestanden und 1 Skip, Lint/Typecheck grün sowie E2E 11/11 mit
Productionbuild. Die technische Scheibe bleibt Teilumsetzung, weil für die
fachliche Abnahme unabhängige Steuerbeispiele, amtliche Formularstände und
eine benannte verantwortliche Fachperson noch fehlen. Für
GoBD und Recht gelten die Gates in [PRUEFPLAN-GOBD-RECHT.md](PRUEFPLAN-GOBD-RECHT.md):
Scope/Betriebsform, Verfahrensdokumentation, Retention/Legal Hold,
Originalerhalt, Export/Restore, Betreiberkontrollen und Rechtsreview.
