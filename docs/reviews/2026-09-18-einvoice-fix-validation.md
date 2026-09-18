# Validierung der E-Rechnungs-Korrekturen

Stand: 18.09.2026. Die XML-Dateien wurden bei jedem Lauf neu aus dem aktuellen
`lib/zugferd-generator.ts` erzeugt. Die Berechnung stammt aus
`lib/invoice-calculation.ts`; der Harness verwendet keine eigene Ersatzrechnung.

## Umgesetzte Korrekturen und Gegenprüfung

Drei Agenten mit Modell Luna und Reasoning `xhigh` bearbeiteten Export,
Import/Storno und den offiziellen XML-Prüflauf. Die Integration in den
Erstellungsdialog und die abschließende Gegenprüfung erfolgten durch den
Hauptagenten. Dabei wurden unter anderem die Steuergruppenrundung,
XML-Adressreihenfolge, exakte Steuergruppensummen und die Behandlung alter
Importdaten nochmals korrigiert.

* PDF und XML verwenden dieselbe dezimale Berechnung: gerundete
  Positionsbeträge, Steuerberechnung je Kategorie/Satz und daraus gebildete
  Kopf-Summen. Mengen und Einzelpreise behalten ihre Präzision.
* Käuferreferenz, elektronische Adressen, Land, Zahlungsart sowie expliziter
  Steuermodus und Befreiungsgründe werden erfasst und geprüft. Fehlende
  Pflichtangaben und widersprüchliche Beträge verhindern den Export.
* Der Import unterscheidet Dokumenttyp, Währung, Bruttobetrag, Vorauszahlung,
  Rundung und Zahlbetrag. Adresszeilen, Preisbasismengen und Zu-/Abschläge
  bleiben erhalten. Der Viewer weist die fehlende Konformitätsprüfung aus.
* Beide Upload-APIs lehnen nicht unterstützte Buchungsfälle mit HTTP 422 ab.
  Zahlung und Storno prüfen vorhandene Original-XML erneut. Die Stornierung
  übernimmt Originalpositionsbeträge und Originalsummen.

Die sechs Browser-End-to-End-Tests bestehen, einschließlich zweier neuer
Tests für Erzeugung, Download und Speicherung von XRechnung und Factur-X.
Die tatsächliche Browser-XRechnung und das aus der Browser-PDF extrahierte
XML wurden zusätzlich unabhängig geprüft: beide bestehen CII-XSD und
EN-16931, die XRechnung zusätzlich die XRechnung-Regeln.

Abschließender gemeinsamer Stand: **215 Unit-Tests bestanden**, ein optionaler
Benchmark übersprungen; `npm run lint` ohne Warnungen und `npm run build`
einschließlich TypeScript-Prüfung erfolgreich. `git diff --check` meldet keine
Whitespace-Fehler.

Die tatsächliche Browser-PDF besteht **veraPDF 1.30.2 / PDF/A-3b: 146 Regeln,
2.961 Checks, keine Fehler**. Eine gerenderte Sichtprüfung bestätigt die
Darstellung der Menge `0,333`, der gerundeten Positionsbeträge und des
Gesamtbetrags von `0,99 EUR` ohne abgeschnittene Inhalte.

## Bewusste Grenzen

Die Buchhaltung unterstützt weiterhin EUR-Rechnungen. Fremdwährungen,
Gutschriftimporte, Vorauszahlungen und explizite Rundungsbeträge werden
abgewiesen; für diese Fälle wurde keine neue Buchungslogik eingeführt.
Der Export unterstützt die Steuerkategorien S, E und Z. Weitere Kategorien
und nicht unterstützte Länder-, Währungs-, Einheiten- oder Adressschemacodes
werden ausdrücklich zurückgewiesen.

Der Import ist ein Extraktor mit Sicherheitsprüfungen für die Buchung,
kein vollständiger Konformitätsvalidator. Importierte Dokumente tragen
`validationStatus: NOT_VALIDATED`. Stornos bleiben gewöhnliche PDFs; eine
strukturierte E-Gutschrift wurde nicht ergänzt. Die Prüfungen bestätigen
die getesteten Fälle und ersetzen keine vollständige Factur-X-Profilprüfung.
Es gibt keine Datenbankmigration und keine automatische Änderung vorhandener
Produktionsbelege.

## Ergebnis

Der Lauf bestand mit **21/21 Fällen**:

* CII 16B XSD: alle Fälle gültig.
* EN-16931-CII-Schematron: alle positiven Fälle ohne fatalen Fehler oder
  Warnung.
* XRechnung-3.0.2-CII-Schematron: alle positiven XRechnung-Fälle ohne fatalen
  Fehler oder Warnung.
* Der absichtlich fehlende Leistungszeitpunkt wird von KoSIT mit der
  Information `BR-DE-TMP-32` gemeldet. Diese Information wird im Ergebnis
  erhalten, ist aber keine Warnung und lässt den Fall bestehen.

Die positiven Fälle decken Standardsteuer, gruppierte Rundungsbeträge,
`0.10 + 0.20` als gleiche Steuergruppe, gemischte 19%/7%-Sätze, einen
expliziten `E`-Befreiungsgrund, `Z`-Nullsteuer, §19 UStG,
Einzelpreis-/Mengenpräzision, strukturierte internationale 4-stellige
Postleitzahlen, drei Anschriftzeilen, SEPA-Code 58, Barzahlung-Code 10 und
den gemeinsamen EN-16931-Teil von Factur-X ab.

Die negativen Kontrollen werden aus gültigen, frisch erzeugten XML-Dateien
mutiert und lösen die erwarteten offiziellen Regeln aus:

| Kontrolle | Nachweis |
| --- | --- |
| Zahlungskonto entfernt | `CII-SR-470`, `BR-DE-23-a` |
| Kopf-Netto verändert | `BR-CO-10`, `BR-CO-13` |
| Befreiungsgrund entfernt | `BR-E-10` |
| Währung auf `ZZZ` geändert | `BR-CL-03`, `BR-CL-04` |
| Käuferreferenz entfernt | `BR-DE-15` |

Zusätzliche Anwendungskontrollen bestätigen, dass `validateZugferdData` die
ungültigen Eingaben `countryCode: 'ZZ'`, `currency: 'ZZZ'`, SEPA-Code 58 ohne
Konto, Überweisung ohne Konto bei einem Nullbetrag und ein unbekanntes
elektronisches Adressschema ablehnt.

## Reproduktion

Der Harness liegt in
[`scripts/einvoice-validation`](../../scripts/einvoice-validation/README.md).
Mit der bereitgestellten isolierten Umgebung lautet der Lauf:

```bash
node --experimental-strip-types scripts/einvoice-validation/run.mjs
```

Der Lauf verwendet die KoSIT-Konfiguration **v2026-08-31** für XRechnung 3.0.2
und `lxml`/`saxonche` aus `/tmp/bivaro-einvoice-review/venv`. Die offiziellen
Artefakte werden über den [KoSIT-Release-Tag v2026-08-31](https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/tag/v2026-08-31)
bezogen. Ergebnisse und erzeugte XML bleiben standardmäßig in einem
temporären Verzeichnis; die bisherigen Audit-Fixtures und deren Ergebnisse
werden nicht überschrieben.

Die Prüfung bestätigt die CII-/EN-16931-/XRechnung-XML-Ausgabe. Eine
PDF/A-3- oder vollständige Factur-X-Profilprüfung ist in diesem Lauf nicht
enthalten.
