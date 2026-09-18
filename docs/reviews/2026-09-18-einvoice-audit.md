# Kritische Prüfung: ZUGFeRD / Factur-X und XRechnung

Stand: 18.09.2026. Geprüft wurden Generator, Erstellungsdialog, PDF/A-Konvertierung, XML/PDF-Import, Viewer und Auswirkungen auf Speicherung/Storno. Anwendungscode wurde nicht verändert.

## Ergebnis und Prüfverfahren

Die Implementierung kann gültige einfache Rechnungs-XMLs erzeugen, verhindert aber mehrere reproduzierbare Standardverletzungen nicht. Zusätzlich gehen beim Import Informationen verloren, die Beträge und Belegarten fachlich verändern.

- Alle **54 bestehenden Tests** in `zugferd-generator.test.ts`, `e-invoice-parser.test.ts` und `pdfa3.test.ts` bestanden.
- **12 synthetische XML-Dateien** wurden gegen das offizielle CII-XSD und die EN-16931-Schematron-XSLT geprüft. Für die 11 XRechnung-Dateien wurde zusätzlich die XRechnung-CII-XSLT ausgeführt.
- Grundlage: [KoSIT-Konfiguration 2026-08-31 für XRechnung 3.0.2](https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/tag/v2026-08-31). Ausführung der ausgelieferten XSLT mit SaxonC und des XSD mit lxml, nicht über das KoSIT-Java-Frontend.
- Alle 12 Dateien bestehen das XSD. **Sieben** scheitern an mindestens einer fatalen Geschäftsregel; zwei weitere erzeugen eine Rechenwarnung. Die übrigen drei bestehen die ausgeführten Regeln.
- Ein über `createPdfA3Invoice` erzeugtes einfaches Test-PDF besteht **veraPDF 1.30.2 / PDF/A-3b: 146 Regeln, 661 Checks, keine Fehler**. XML-Einbettung und erneute Extraktion funktionieren. Das ist kein Nachweis für beliebige Layouts, Fonts, Upload-PDFs oder vollständige Factur-X-Konformität aller Profile.
- Die Factur-X-Basisdatei besteht die gemeinsamen EN-16931-CII-Regeln. Ein vollständiger eigener Factur-X-Profilvalidator wurde nicht zusätzlich ausgeführt.

Reproduktionsdateien, kompakte Ergebnisse und Prüflauf liegen in [2026-09-18-einvoice-audit](./2026-09-18-einvoice-audit/). Es wurden ausschließlich synthetische Daten benutzt.

## Priorisierte Befunde

### 1. P1 – XRechnung lässt obligatorische Kommunikationsdaten weg

**Stellen:** `lib/zugferd-generator.ts:171`, `:417`, `:427`, `:445`; `components/dashboard/create-invoice-modal.tsx:1050`.

Nur die Telefonnummer wird profilspezifisch verlangt. Verkäufer-E-Mail und Käufer-E-Mail dürfen fehlen und werden dann nicht ausgegeben. Die lokale Prüfung meldet trotzdem `isValid: true`, sogar ohne Warnung. Da die elektronische Käuferadresse ausschließlich aus der E-Mail des ausgewählten Kunden stammt, lässt sich eine manuell adressierte Rechnung ohne diese Daten exportieren.

**Nachweis:** `missing_emails.xml` löst **PEPPOL-EN16931-R010**, **R020** und **BR-DE-7** als fatal aus. XRechnung verlangt BT-49, BT-34 und die Kontakt-E-Mail BT-43. Andere zulässige elektronische Adressierungsschemata sind möglich, werden hier aber nicht modelliert.

**Korrektur:** Pflichtangaben vor Export prüfen; Kontakt-E-Mail und elektronische Adressen mit jeweiligem Schema getrennt modellieren. Quelle: [XRechnung 3.0.2, Geschäftsregeln](https://xeinkauf.de/app/uploads/2024/07/XRechnung-v3.0.2.pdf).

### 2. P1 – Käuferreferenz wird mit der eigenen Rechnungsnummer erfunden

**Stelle:** `lib/zugferd-generator.ts:408`.

`BuyerReference` erhält immer `data.invoiceNumber`. Das erfüllt zwar eine reine Existenzprüfung, ist aber nicht die vom Käufer vorgegebene Referenz. Insbesondere kann die richtige Leitweg-ID für einen öffentlichen Auftraggeber nicht eingetragen werden. Die Basisdatei ist deshalb technisch regelkonform, ohne dass ihre Käuferreferenz fachlich korrekt wäre.

**Korrektur:** Eigenes Feld für BT-10 durch Datenmodell, Dialog und Generator führen; für XRechnung verlangen. Eine Leitweg-ID ist nicht für jeden privaten Empfänger zwingend, die Referenz darf aber nicht pauschal durch die Rechnungsnummer ersetzt werden. Quelle: [Definition BT-10](https://docs.peppol.eu/poacc/billing/3.0/syntax/ubl-invoice/cbc-BuyerReference/).

### 3. P1 – Rundung erzeugt widersprüchliche Rechnungs- und Steuersummen

**Stellen:** `components/dashboard/create-invoice-modal.tsx:1026`; `lib/zugferd-generator.ts:320`, `:334`, `:354`, `:463`.

Die Berechnung summiert ungerundete Positionsbeträge und Steuern. Erst beim Schreiben werden einzelne Beträge unabhängig mit `toFixed(2)` gerundet.

- `rounding_lines.xml`: Drei Positionsbeträge von intern 0,333 EUR erscheinen als jeweils 0,33 EUR, ihre Kopf-Summe aber als 1,00 EUR. **BR-CO-10 fatal**.
- `rounding_tax.xml`: Je 0,08 EUR netto zu 19 % und 7 % ergeben im XML Steuergruppen von 0,02 und 0,01 EUR, aber nur 0,02 EUR Gesamtsteuer. **BR-CO-14 fatal**.
- `wrong_net.xml`: 100 EUR Positionen und 200 EUR Kopf-Netto werden nur als Warnung behandelt und trotzdem exportiert. **BR-CO-10 fatal**.

**Korrektur:** Eine gemeinsame Dezimalberechnung verwenden: Positionsnettobeträge runden, diese summieren, Steuer je Kategorie/Satz berechnen und runden, Gesamtsteuer aus diesen Steuerbeträgen bilden. Inkonsistente Eingabewerte müssen den Export verhindern. Quellen: [BR-CO-10](https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/BR-CO-10/), [BR-CO-14](https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/BR-CO-14/).

### 4. P1 – Steuerbefreiung wird aus dem Steuerbetrag abgeleitet

**Stellen:** `lib/zugferd-generator.ts:277`, `:295`, `:348`.

`taxAmount === 0` wird als Kleinunternehmerstatus interpretiert. Jede 0-%-Position erhält Kategorie E. Eine Nullsteuer kann aber andere Gründe haben und beispielsweise Kategorie Z oder AE erfordern. Der Steuerbetrag allein bestimmt weder Kategorie noch Befreiungsgrund.

Bei gemischten 0-%-/19-%-Positionen entsteht ein unmittelbar nachgewiesener Regelverstoß: Die E-Steuergruppe bekommt keinen Befreiungsgrund, weil die Gesamtsteuer positiv ist. `mixed_exempt_standard.xml` scheitert an **BR-E-10**.

**Korrektur:** Steuerkategorie und Befreiungsgrund explizit erfassen; §-19-Modus ausdrücklich konfigurieren und seine zulässigen Eingaben begrenzen. Kategorie E für einen tatsächlich einschlägigen Befreiungsfall ist nicht selbst der Fehler. Quelle: [BR-E-10](https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/BR-E-10/).

### 5. P1 – Überweisung wird ohne Zahlungskonto exportiert

**Stellen:** `lib/zugferd-generator.ts:168`, `:381`.

Ohne IBAN wird nur gewarnt, der Generator gibt trotzdem Zahlungsmittelcode 30 aus. Ein Zahlungskonto fehlt vollständig.

**Nachweis:** `missing_iban.xml` verletzt **CII-SR-470** und **BR-DE-23-a**, jeweils fatal. Der Fehler betrifft bereits die gemeinsame CII-Validierung und damit auch den entsprechenden Factur-X-Export.

**Korrektur:** Für Überweisung eine passende Konto-ID verlangen. Andere Zahlungsarten müssen explizit ausgewählt und mit ihren eigenen Pflichtangaben ausgegeben werden. Nicht jede Zahlungsart benötigt eine IBAN. Quelle: offizielle KoSIT-Validierungsartefakte und XRechnung BR-DE-23.

### 6. P1 – Import verwechselt Gesamtbetrag und offenen Zahlbetrag

**Stellen:** `lib/e-invoice-parser.ts:266`, `:286`; Speicherung `app/api/invoices/upload/route.ts:280`; Weiterverwendung `lib/invoice-payments.ts:59`.

CII priorisiert `GrandTotalAmount` (BT-112), UBL dagegen `PayableAmount` (BT-115). Bei 100 EUR brutto und 40 EUR Vorauszahlung liefert CII daher 100, UBL 60 als dasselbe interne Feld `totalAmount`. Zahlung, Darstellung und Speicherung hängen dadurch von der Syntax statt vom wirtschaftlichen Sachverhalt ab.

**Korrektur:** BT-112, BT-113, BT-114 und BT-115 getrennt importieren und konsistent verwenden. Parser-Reproduktion ist in `parser-results.json` dokumentiert; die modifizierte UBL-Testvorlage wurde hierbei als Mappingtest benutzt, nicht als zusätzlich vollständig validierte Rechnung. Quellen: [BT-112](https://docs.peppol.eu/poacc/billing/3.0/syntax/ubl-invoice/cac-LegalMonetaryTotal/cbc-TaxInclusiveAmount/), [BT-115](https://docs.peppol.eu/poacc/billing/3.0/syntax/ubl-invoice/cac-LegalMonetaryTotal/cbc-PayableAmount/).

### 7. P1 – Belegtyp geht verloren; Gutschriften werden falsch behandelt

**Stellen:** `lib/e-invoice-parser.ts:261`, `:397`; `app/api/invoices/upload/route.ts:274`.

Der CII-Parser ignoriert `ExchangedDocument/TypeCode`. Eine CII-Gutschrift mit Code 381 und positivem Gutschriftsbetrag wird wie eine normale Rechnung geparst und im Upload fest als `INVOICE` gespeichert. UBL `CreditNote` wird dagegen überhaupt nicht erkannt. Der Parser reproduziert beides.

**Korrektur:** Dokumenttyp mitführen und Gutschriften einschließlich ihrer Vorzeichen-/Buchungssemantik korrekt abbilden. Nicht unterstützte Typen ausdrücklich ablehnen, statt sie als Rechnung zu buchen. Ergänzend erzeugt der bestehende Stornoablauf nur ein normales PDF und setzt `rawXml: null`; eine strukturierte E-Gutschrift ist dort derzeit nicht implementiert. Das ist eine Funktionslücke, keine Aussage zur gesetzlichen Pflicht im Einzelfall.

### 8. P1 – Fremdwährung wird verworfen und als Euro dargestellt

**Stellen:** `lib/e-invoice-parser.ts:30`, `:261`, `:281`; `lib/e-invoice-viewer.ts:150`.

BT-5 wird nicht in `ParsedEInvoice` übernommen. Der Viewer setzt die Währung fest auf EUR. Eine importierte Rechnung über 100 USD erscheint dadurch als 100 EUR; `rawXml` enthält die Originalwährung zwar noch, die strukturierte Weiterverarbeitung jedoch nicht.

**Korrektur:** Rechnungswährung durch Parser, Speicherung, Viewer und Buchungslogik führen. Wenn nur EUR unterstützt werden soll, andere Währungen ausdrücklich zurückweisen. Keine automatische Umdeutung. Quelle: [BT-5](https://docs.peppol.eu/poacc/billing/3.0/syntax/ubl-invoice/cbc-DocumentCurrencyCode/).

### 9. P2 – Mengen und Einzelpreise verlieren Dezimalstellen

**Stellen:** `lib/zugferd-generator.ts:307`, `:311`.

`formatAmt()` wird auch für Mengen und Einzelpreise verwendet. Dadurch werden beispielsweise 100 × 0,3333 EUR als 100 × 0,33 EUR bei unverändert 33,33 EUR Positionsbetrag ausgegeben. Bei 0,333 × 100 EUR wird die Menge zu 0,33, der Positionsbetrag bleibt 33,30 EUR.

**Nachweis:** `price_precision.xml` und `quantity_precision.xml` erzeugen **PEPPOL-EN16931-R120**. Die geprüfte CII-Konfiguration stuft diese Regel als **warning**, nicht fatal ein. Der Zahlenwiderspruch ist dennoch real.

**Korrektur:** Für Preis, Menge, Prozentsatz und Geldbetrag separate Präzisionsregeln nutzen; den Positionsbetrag aus den tatsächlich übertragenen Werten ableiten.

### 10. P2 – Land und Adresszeilen werden verfälscht oder abgeschnitten

**Stellen:** `lib/zugferd-generator.ts:99`, `:118`, `:130`; `lib/e-invoice-parser.ts:183`, `:204`.

Das Exportland ist immer DE. Der Adressparser versteht nur eine letzte Zeile mit fünfstelliger PLZ und übernimmt lediglich die erste verbleibende Adresszeile. Bei „Name / Abteilung / Straße / PLZ Ort“ bleibt beispielsweise die Abteilung erhalten, die Straße verschwindet. Ausländische Käufer mit separat ausgefüllter PLZ und Stadt können fälschlich mit DE exportiert werden. Auch der Import nimmt bei mehreren Adresszeilen nur die erste vorhandene.

**Korrektur:** Land und Adresszeilen strukturiert speichern und vollständig übertragen. Alternativ den unterstützten Adressumfang explizit beschränken, ohne stille Datenänderung. Dies ist ein semantischer Fehler, den eine reine Existenz-/Codelistenprüfung nicht zuverlässig erkennt.

### 11. P2 – Preisbasismengen und Positionsnachlässe gehen beim Import verloren

**Stellen:** `lib/e-invoice-parser.ts:212`, `:230`; Folgepfad `app/api/invoices/cancel/route.ts:72`, `lib/credit-note-pdf.ts:239`.

Der Parser übernimmt den Preis, aber nicht die Preisbasismenge BT-149 oder die Positionszu-/abschläge. Beispiel: 200 Stück zu 5 EUR je 100 Stück entsprechen 10 EUR. Importiert werden Menge 200 und Preis 5. Die Storno-PDF-Berechnung multipliziert beides erneut und würde daraus 1.000 EUR machen. Auch ein bereits im Positionsbetrag berücksichtigter Nachlass geht bei dieser Neuberechnung verloren.

**Korrektur:** Preisbasis, Zu-/Abschläge und Originalpositionsbetrag erhalten; Folgedokumente dürfen nicht aus einem verlustbehafteten Teilmodell rekonstruiert werden. Dieser Folgefehler wurde anhand des Codepfads festgestellt, nicht durch einen Datenbank-Storno-End-to-End-Test.

## Weitere Validierungslücken und Einordnung

- Die lokale Prüfung akzeptiert beliebige drei Großbuchstaben als Währung. `wrong_currency.xml` mit ZZZ scheitert an **BR-CL-03/04**. Der aktuelle Dialog setzt zwar EUR fest, der Generator selbst ist nicht entsprechend abgesichert.
- `parseEInvoiceXml` ist ein toleranter Extraktor, kein Konformitätsvalidator. XML-Namensräume, Profilkennung und Geschäftsregeln werden nicht geprüft. Der Upload sollte einen expliziten Validierungsstatus speichern oder ungültige Dokumente abweisen, wenn Konformität zugesichert werden soll.
- Die vorhandenen String-/Parser-/Metadatentests sind sinnvoll, erkennen aber die hier reproduzierten Schematronfehler nicht. Einige Tests schreiben sogar die Rechnungsnummer als Käuferreferenz und den Export ohne IBAN fest.
- Bei fehlendem Fälligkeitsdatum erzeugt der Generator auch keine alternativen Zahlungsbedingungen. Die allgemeine Regel [BR-CO-25](https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/BR-CO-25/) verlangt bei positivem Zahlbetrag mindestens eine dieser Informationen. Die verwendete CII-XSLT enthält diese Prüfung jedoch nicht; `missing_due_date.xml` bleibt deshalb im ausgeführten Prüflauf ohne Fehler. Dieser Fall ist ausdrücklich **kein durch diesen Prüflauf bestätigter Fatal-Befund** und sollte anhand der vorgesehenen Profil-/Empfängerregeln abgesichert werden.
- Die XRechnung-Kennung `...xrechnung_3.0` ist für Version 3.0.2 korrekt. Ein Ersetzen durch `...xrechnung_3.0.2` wäre keine notwendige Reparatur.
- Kein nachgewiesener PDF/A-Fehler im geprüften Beispiel. Ein fehlender veraPDF-Test in der bisherigen Suite allein ist kein Beweis für ungültige PDF-Ausgabe.

## Empfohlene Reihenfolge

1. Gemeinsames Rechnungsmodell für Dokumenttyp, Käuferreferenz, elektronische Adressen, Steuerkategorien, Währung und getrennte Summen definieren.
2. Berechnung und Export korrigieren; Pflicht-/Konsistenzfehler blockieren statt nur in der Browserkonsole zu protokollieren.
3. Import und Buchungs-/Stornofolgen auf dieses Modell umstellen.
4. Offizielle XSD-/Schematron-Regressionstests mit positiven und negativen Beispielen sowie veraPDF für finale PDFs ergänzen. Validatorversionen festhalten.

## Reproduktion

Die im Unterverzeichnis gespeicherten XML-Dateien stammen unverändert aus dem aktuellen Generator mit synthetischen Eingaben. Für erneute Validierung das oben verlinkte KoSIT-Release entpacken und eine isolierte Python-Umgebung mit `lxml` und `saxonche` verwenden:

```bash
python check.py /pfad/zur/entpackten/kosit-konfiguration
```

`check.py` aktualisiert `validation-results.json`. Die Parser-Ergebnisse sind separate Mapping-Reproduktionen. Der veraPDF-Report verweist auf das temporäre synthetische Test-PDF; er belegt ausschließlich den geprüften Testfall. Keine Produktionsbelege oder Datenbanken wurden verändert.
