# Testqualität: gezielte Bereinigung vom 28.10.2026

Dieser Wartungsschritt folgt auf die frühere
[Fehler-/Sicherheitsprüfung](app-audit-fixes-2026-10-28.md). Deren 628 bestandene
Tests sind ein historischer Stand vor dieser Testbereinigung und werden hier
nicht als aktueller Gesamtnachweis übernommen. Alle Änderungen bleiben lokal
und uncommitted; dieser Schritt ändert keine Produktionslogik, kein Schema und
keine Datenmigration. Keine Veröffentlichung oder Bereitstellung.

Bewertet wurde, ob ein Test einen konkreten fehlerhaften Anwendungszustand
unterscheidet, den verursachten Schaden verständlich meldet und sich bei
unbedenklichen Änderungen stabil verhält. Eine Dateiexistenz, ein CSS-Klassenname,
eine Designversion oder ein historischer Quelltexthash allein ist kein
Verhaltensnachweis. Statische Prüfungen bleiben erhalten, wenn sie einen
konkreten Vertrag sichern und noch kein gleichwertiger Ersatz vorliegt.

## Entfernt, ersetzt und bewusst erhalten

| Änderung | Begründung und verbleibender Schutz |
|---|---|
| Fünf reine Darstellungsfälle entfernt: Restore-Grid in `settings-presentation`, Ledger-/Werkzeugreihenfolge und exaktes 1600px-Grid in `invoice-workspace-design`, Verlauf-Containerbreite in `bank-workspace-redesign`, fünf Überschriften samt Großschreibung in `navigation-section-labels`. | Die Assertions fixierten CSS-/Markupform, Breiten oder redaktionellen Stil. Sie bewiesen weder korrektes Geschäftsverhalten noch tatsächliche Browsergeometrie. Auth-/Rollenlinks, aktuelle Navigation, Fokus, Mindestzielgrößen, Upload-Tastaturbedienung und lesbare Langtexte bleiben geprüft. |
| Zwei Rechnungs-Quelltextinventare durch fünf echte Render-/Callbackfälle in `invoice-list-presentation.test.ts` ersetzt. | Der Test rendert `InvoicesTab` mit echten React-Hooks: alte Zeilen/Beträge/Zähler bei Laden oder Fehler unterdrücken; Fehler-/Statuszustand unterscheiden; Retry tatsächlich mit Seite 3 und Größe 20 aufrufen; leere Suche von leerem Konto unterscheiden; Seitensumme 30 und lokale Zahlungszähler von Ergebniszahl 123 trennen. Geprüft werden reale React-Render-/Callbackverträge; Browserinteraktion wird daraus nicht abgeleitet. |
| Stilform in Artikel-/Bank-/Service-/Rechnungstests vereinfacht. | Entfernt wurden Klasseninventare, Designkommentare/-versionen, Großschreibungsverbote und dekorative Breakpoints. Echte Bankbeträge jenseits sicherer JS-Ganzzahlen, Escaping, Beleg-/Hash-/Revisionsnachweise, Steuermodus, Centbeträge, Schaltflächen-Sperren und Quelldokumentlinks bleiben erhalten. |
| Konkreter Textkontrast-Schutz bewusst erhalten. | `var(--bivaro-color-muted)` statt der als Fläche erzeugten `--color-muted`-Aliasfarbe schützt eine bekannte Text-/Flächenverwechslung. Dieser gezielte Guard bleibt zusammen mit Fokus, reduzierter Bewegung und Langtextumbruch bestehen, bis eine gleichwertige berechnete Stil-/Browserprüfung vorliegt. |
| Bank-/Service-/Rechnungs-/Artikel-Quelltextfingerprints weitgehend behalten. | Darin stecken auch Finanzaktionen, unveränderliche Nachweise, Session-/Owner-Grenzen, Requestkörper und Fokus-Rückgabe. Diese pauschal als „spröde“ zu löschen würde den Schutz verringern. Für einen späteren Ersatz müssen diese konkreten Verträge zuerst verhaltensbezogen abgedeckt werden. Auch `scripts/__tests__/quote-workspace-redesign.test.ts` bleibt deshalb unverändert. |
| Datums-Request-Kreuzprodukt in `legacy-accounting-date-input.test.ts` auf unabhängige Proben reduziert. | Acht Datumsvarianten werden direkt am Parser geprüft; vier Web-/v1- und zwei Kassenbuchproben sichern die Schreibgrenzen unabhängig. Multipart prüft vor Dateischreiben; ein echter gültiger Schalttag sichert den Erfolgsweg. Neuer expliziter Transaktions-Sentinel verhindert unbeabsichtigte Prisma-Zugriffe. 17 fachlich getrennte Tests ersetzen zehn Tests mit einem 48-Request-Kreuzprodukt. |
| Drei breite/ungefähre Zone-3/4-Steuerfälle in `tax-calculator.test.ts` durch einen Default-/explizites-Jahr-Vertrag ersetzt. | Das unabhängige exhaustive Referenzraster bleibt unverändert. Der neue Wrapperfall sichert die Weitergabe des Steuerjahrs; 19 statt 21 Tests. Die vorherigen sieben neuen Regression-Suites bleiben erhalten, da gezielte Mutationen ihre Empfindlichkeit gegen reale Fehler belegen. |
| Fehlende-Nachweis-Kreuzprodukte des fokussierten Browserselektors gruppiert. | Pro Paket wird die gesamte Zahl gesperrter kritischer Pfade geprüft; positive Zuordnungen je Quelle und sämtliche Fail-closed-Verträge bleiben erhalten. Die Auswahl wird dadurch verständlicher, ohne kritische Pfade freizugeben. |
| Drei README-Galerie-Layoutassertions entfernt. | Exakte Zahl von sieben `details`, kein offenes `details` und vier Bilder oberhalb des Folds sind Präsentationsinventar. Link-, Bild-, Hash-/Pixel-, Lizenz-, Provenienz- und Betriebsgrenzen bleiben geprüft. |

## Ausgeführte Qualitätsnachweise

Finaler gemeinsamer Bereinigungslauf: **13 Suites / 146 Tests bestanden in
0,732 s**, ausdrücklich mit neuem temporärem `DATABASE_URL`. Er umfasst alle
sieben UI-Suites, die Datumsgrenzen-Schreibtests, Steuerrechner und unabhängiges
Steuerreferenzraster, beide Selektor-Suites und README-Schutzprüfungen.
Abschließend bestanden vollständiger Lint und
`tsc --noEmit --incremental false` jeweils mit **Exit 0**. Elternreview der
konkreten Entfernungen/Ersatztests abgeschlossen; Kontrast-Guard erhalten.

Flüchtige lokale Protokolle, keine persistenten Hosted-/Releasebelege:

- `/tmp/bivaro-test-quality-20261028-final.log`
- `/tmp/bivaro-test-quality-20261028-lint.log`
- `/tmp/bivaro-test-quality-20261028-types.log`

Die folgenden Teil-/Zwischenläufe überschneiden sich; insbesondere werden
**146 und 126 nicht addiert**:

- UI-Ausgangslauf vor der Bereinigung: **6 Suites / 47 Tests bestanden**.
  Danach mit expliziter neuer temporärer `DATABASE_URL`: **7 Suites / 45 Tests
  bestanden**. Der zusätzliche Testbestand prüft Verhalten; eine sinkende oder
  steigende Testzahl war kein Ziel. Nach dem Elternreview wurden die beiden
  konkreten Textkontrast-Assertions beibehalten; die betroffene Service-Suite
  bestand erneut **16/16**. Fokussierter ESLint: null Warnungen.
- Geschäfts-/Datumsbereich nach der Bereinigung: **16 Suites / 126 Tests
  bestanden** unter `America/Los_Angeles`, explizite temporäre Datenbankziele
  und isolierte Integrations-Fixtures; fokussierter ESLint und Diffprüfung
  bestanden.
- Skript-/Selektor-/README-Teilmenge: **3 Suites / 61 Tests bestanden**.
  Diese Teilmenge ist im abschließenden gemeinsamen Lauf enthalten; keine
  zusätzliche Gesamtzahl.

Die ersten UI-Renderläufe vor der späteren erweiterten Schutzvorgabe hatten
kein ausdrücklich gesetztes Fixture-`DATABASE_URL`; sie führten weder
Datenbankhelfer noch Transport-/Browser-Effekte aus. Sämtliche anschließenden
UI-Mutationsproben und Nachläufe setzten explizit ein neues temporäres Ziel.
Die Einschränkung wird nicht nachträglich als damals vorhandene Sicherung
dargestellt.

### Gezielte Gegenproben

Die folgenden Gegenproben verwendeten temporäre Testkopien bzw. temporäre
Vite-Transformationen. Produktionsquellen blieben unverändert. Die nach der
Recovery wiederholten Proben nutzten neue temporäre Datenbankziele; Kopien
wurden danach entfernt. Die frühere unzureichend abgeschirmte Probe ist im
folgenden Vorfallsabschnitt gesondert dokumentiert. Ein
absichtlich fehlgeschlagener Mutant ist ein Testqualitätsnachweis und kein
neu entdeckter Anwendungsfehler.

| Gegenprobe | Tatsächliches Ergebnis |
|---|---|
| Nur Wurzel-CSS-Klasse der Rechnungsansicht umbenennen | Neue fünf Renderfälle bleiben **5/5 grün**. |
| Alte Summen während Laden/Fehler sichtbar machen | **2 Renderfälle schlagen fehl**. |
| Rechnungs-Retry fälschlich auf Seite 1 zurücksetzen | **1 Callbackfall schlägt fehl**. |
| Gesamtergebniszahl 123 statt Seitensumme 30 anzeigen | **1 Summenfall schlägt fehl**. |
| Selektor: Rechnungsvertragsnachweis entfernen | Guard fällt von erwarteten acht blockierten Pfaden auf null; Test schlägt fehl. |
| Selektor: finanzielle Nachweisabhängigkeit überspringen | Erwartete neun blockierte Pfade werden acht; Test schlägt fehl. |
| Selektor: nicht freigegebenen Accounting-Pfad pauschal ausnehmen | Erwarteter unbekannter Pfad verschwindet; Test schlägt fehl. |
| Rechnungs-Sortierung entfernen | **6 Sortierfälle schlagen fehl**. |
| Lokale statt UTC-Rechnungs-/Ledgergrenzen verwenden | **6 Rechnungs- und 5 Ledgerfälle schlagen fehl**. |
| Kalenderprüfung vor Ausgaben-/Kassenbuchschreiben entfernen | **15 Fälle schlagen fehl**, einschließlich aller sechs Endpunktproben und Multipart; Kassenbuch trifft den expliziten Mock-Sentinel. |
| Alten Logo-Dateitypfehler oder gesamten Clientfilter-Spread zurückbringen | Je **1 Regression schlägt fehl**. |
| Falsches Default-Steuerjahr oder lokale Steuerjahresgrenze verwenden | **5 Steuerfälle** einschließlich neuem Wrapper bzw. **1 Jahresgrenzenfall** schlagen fehl. |

## Prüfvorkommnis und Recovery

Eine frühere Datums-Mutationsprobe des Geschäftsagenten verletzte die Vorgabe
eines expliziten neuen `DATABASE_URL`. Durch das absichtliche Deaktivieren der
Kalenderprüfung wurde eine zuvor fehlende Prisma-Abschirmung sichtbar: Zwei
unabhängige Kassenbuchfälle führten **zwei bestätigte Leseabfragen** über den
geerbten/defaultkonfigurierten Prisma-Pfad aus. Für den synthetischen Owner
`date-owner` und ID `1` wurden Buch bzw. Transaktion nicht gefunden; die
Servicepfade endeten mit 404. Der tatsächliche Zielpfad wurde nicht unabhängig
identifiziert. Es erfolgte keine nachträgliche Inspektion einer Repository-
oder Produktionsdatenbank.

Die nachvollzogenen Servicepfade werfen diese Fehler vor finanziellen oder
Audit-Schreiboperationen. Damit sind **keine solchen Anwendungsschreibzugriffe
beobachtet**; eine unabhängig bewiesene Dateisystem-/Datenbankunverändertheit
wird ausdrücklich nicht behauptet. Der Vorfall darf nicht als vollständig
isolierter ursprünglicher Testlauf dargestellt werden.

Recovery: `legacy-accounting-date-input.test.ts` mockt die Prisma-Transaktion
jetzt mit einem ablehnenden Sentinel und prüft, dass sie bei ungültigen Daten
gar nicht geöffnet wird. Jeder weitere Testaufruf erhielt ein ausdrücklich
neues temporäres `DATABASE_URL`; Integrationshelfer behalten zusätzlich ihre
eigenen frisch migrierten Fixtures. Wiederholte Mutationen und der tatsächliche
Nachlauf bestanden mit diesen Grenzen. Historische Vorfallsdokumente und
Audit-/Backlogquellen bleiben unverändert erhalten.

## Grenzen

Dies ist eine begrenzte, begründete Testbereinigung, keine vollständige
Bewertung sämtlicher Tests. Die gezielten Gegenproben sind selektive
Regressionsexperimente, kein berechneter globaler Mutation-Score. Kein
Testfile wurde als Ganzes gelöscht. Besonders breit eingefrorene Quelltexthashes
bleiben ein Kandidat für spätere gezielte Verhaltensersatztests. Statische
Fokus-/Kontrast-/Zielgrößenprüfungen ersetzen keine gemessene Browsergeometrie.
Kein neuer Build, Browserlauf, Screenshot oder Hosted-/Releasebeleg wird aus
Render-, Selektor- oder Mutationsnachweisen abgeleitet. Der frühere
Standard-Turbopack-/Browserblocker `EPERM` bleibt offen. Historische 160
Backlogtickets werden nicht neu klassifiziert oder abgeschlossen.
