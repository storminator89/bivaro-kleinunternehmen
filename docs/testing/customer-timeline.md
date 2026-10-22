# Kundenverlauf: Lesevertrag

Der Verlauf an der Kundenseite zeigt direkt zugeordnete Angebote, Rechnungen,
Stornobelege sowie Zahlungs- und Anpassungsnachweise. Er erstellt, versendet oder
bucht nichts. Leistungsnotizen und Projektverwaltung bleiben eigenständige Wege.
Es gibt keinen Kundengesamtsaldo und keine Zuordnung über Name, E-Mail oder IBAN.

## Daten und Reihenfolge

- `GET /api/customers/:id/timeline` verlangt die bestehende validierte Sitzung
  und prüft den Kunden sowie jede verwendete Quellbeziehung im selben Mandanten.
- Eine Seite enthält höchstens 20 Einträge. Der Cursor verwendet eine totale
  Reihenfolge aus Erfassungszeit, Quelltyp und ID. Gleichzeitige Einträge verlieren
  dadurch ihre Position nicht. Ein ID-Hochwasserstand je Quelle schließt später
  eingefügte Einträge aus einer laufenden Seitenfolge aus, auch bei Rückdatierung.
- „Neu laden“ beginnt eine neue Seitenfolge. Status und belegbezogener Rest sind
  aktuelle Aussagen beim jeweiligen Lesen, kein eingefrorener historischer Saldo.
- Erfassungszeit und fachliches Beleg-/Zahlungs-/Nachweisdatum sind getrennt.
  Historische oder unbekannte Zahlungsdaten werden nicht als tatsächliche
  Zahlungsdaten ausgegeben. Alte Dokumentinhalte werden nicht umgeschrieben.
- Eine Angebotsübernahme folgt nur der ausdrücklich verknüpften, ebenfalls
  mandanten- und kundengeprüften Rechnung, nicht einem erfundenen Angebotsstatus.
- Angebotsdetails verwenden die bestehende angebotspezifische PDF-Vorschau
  `/api/quotes/download`; Rechnungen öffnen die vorhandene Dokumenthistorie.

## Finanzielle Grenzen

Der belegbezogene Rest verwendet ausschließlich die zentralen Buchbarkeits- und
Zahlungsjournalprüfungen. Einnahmen werden nicht nochmals zum Journal addiert.
Korrektur und Erstattung bleiben verschiedene Nachweisarten; deren fachliche
Prüfung wird nicht behauptet. Ein stornierter Beleg wird nicht zur offenen
Forderung. Angebote, Rechnungsentwürfe, Null-/unbekannte Beträge, Fremdwährungen,
ungeklärte Altzahlungen und widersprüchliche Belege erzeugen keinen geschätzten
Restbetrag.
„Teilweise bezahlt“ folgt dem zentralen Netto-Zahlungsstand nach Korrekturen,
nicht der bloßen Existenz alter Ereignisse. Ein vollständig korrigierter Eingang
begründet deshalb keine Teilzahlungsbehauptung.

Die Evidenzprüfung ist je Dokument und Relation auf 201 gelesene Datensätze
begrenzt. Übersteigt eine Relation 200 Nachweise, erscheint „Zahlungsstand zu
prüfen“ statt eines aus unvollständigen Daten berechneten Rests. Datum und
Datumsqualität des ausgewählten Verlaufseintrags bleiben unabhängig davon
erhalten. Antworten enthalten keine internen Zahlungsreferenzen, Freitexte,
Kontodaten oder vollständigen Dokumentinhalte und werden nicht zwischengespeichert.

## Automatisierte Abdeckung

`lib/__tests__/customer-timeline.test.ts` deckt Mandantengrenzen einschließlich
gemischter Altbeziehungen, direkte statt heuristische Zuordnung, Teilzahlung,
Korrektur, Erstattung nach Storno, Angebote und deren Übernahme, unbekannte
Finanzstände, gleiche Erfassungszeiten, Paging, spätere Einfügungen, aktualisierte
Status, Kundenumbenennung, leere/gelöschte Kunden, Evidenzgrenzen und sichere
Fehlerantworten ab. Wiederholtes Lesen muss sämtliche Finanz- und Versandtabellen
unverändert lassen.

`e2e/customer-timeline.spec.ts` beschreibt die Browserabnahme mit synthetischen
Daten für Desktop und schmale Mobilansichten: Lesen, Seitenfolge, erneutes Laden,
Fehler/Retry, Abbruch, Rückkehr zum Suchkontext, direkte Detailaktionen und
Tastatur/Fokus. Ausführungsnachweise sind getrennt von dieser Testspezifikation zu
bewerten; eine vorhandene Testdatei allein ist kein Browser-Abnahmeergebnis.
