# Rechnungsarbeitsplatz: Ledger zuerst

Stand: 23. Oktober 2026. Lokales Redesign auf Basis von `dafbcea`.

## Vorher und Entscheidung

- Aufgabe: Rechnungen finden, Zahlungsstand lesen und vorhandene Belegaktionen öffnen.
- Beibehalten: Bivaro Ledger, Inter, explizit seitenbezogene Summen und Statuszahlen, alle bestehenden Fachfunktionen.
- Ausgangslage im Quellcode: Bestandskarte, zwei Werkzeugkarten und Import stehen vor der Rechnungsliste. Die historische [Rechnungsansicht](screenshots-2026-10-17-flat/invoices-populated.png) zeigt die frühere vertikale Gewichtung, aber nicht den aktuellen Stand.
- Entscheidung: vollständige Neukomposition innerhalb des bestehenden App-Shells, keine neue Finanzlogik und kein Themewechsel.

## Sichtbarer Umfang

Die Liste führt jetzt den Arbeitsbereich. Bestandszahlen gehören zu ihrem Kopf statt zu einer zusätzlichen Karte. Suche, Zahlungsstatus und Zeitraum bilden eine ruhige Werkzeugleiste; die Suche steht auch in der Tastaturreihenfolge zuerst.

Am Desktop beginnt die Tabelle mit der Rechnungsidentität statt mit dem Datum. Kundennamen und umgebrochene Dateinamen bleiben beim Beleg; Beträge stehen rechts, Zahlungsinformationen darunter. Bestehende Sortierungen, Details und Aktionsmenüs bleiben erhalten.

Mobile Datensätze zeigen Identität, Dateiname, Kunde, Datum, Betrag und Zahlungsstand in getrennten Zeilen. Die Aktionsreihe ist durch eine Haarlinie abgesetzt. Lange Beträge und Dateinamen dürfen umbrechen. Statusfilter stehen auf Telefonen in zwei Spalten; Such- und Zeitraumfelder verwenden dort 16 px Schrift.

Import, Servicepläne und Bank-CSV bilden eine gemeinsame sekundäre Werkzeugfläche. Unter 1600 px steht sie nach dem Ledger, auf breiten Arbeitsflächen daneben. Import bleibt ein vorhandenes, bei gewählter Datei geöffnetes Disclosure. Es gibt keine neuen Buchungsaktionen.

Lade- und Leerzustände haben in beiden Darstellungen dieselbe Struktur. Die mobile Leerdarstellung verwendet nun die bereits vorhandene Desktop-Erklärung und Erstellaktion. Fehler behalten die bestehende Wiederholungsaktion. Unbekannte Werte bleiben Striche.

## Erhaltene Verträge

- Keine Änderungen an APIs, Hooks, Services, Schemata, Zahlungsdialogen oder Finanzberechnungen.
- Unveränderte Lösch- und Statusberechtigung, Zahlungsdarstellung, Statuszählung, öffentliche Props und Rechnungsaktionsmenüs: sieben eingefrorene Deklarationen.
- 87 bestehende technische JSX-Bindungen durch einen AST-basierten Quellvertrag geschützt: Felder, Werte, Callback-Ausdrücke, Routen, deaktivierte Zustände, Sortierung und Fokus-Rückgabe. Dekorative Icon-Namen sind ausdrücklich keine Formularfeldnamen.
- Bestehende Tests bleiben unverändert. Neue Tests prüfen die Präsentationsgrenze und ersetzen keine Funktionstests.
- Seitenbezogene Gesamtsumme, Uploadformate, Statusfilter, Seitengrößen und Pagination behalten ihre Herkunft und Bedeutung.
- Rechtliche und fachliche Hinweise bleiben unverändert, insbesondere zur manuellen Bank-CSV-Prüfung und zur Löschbarkeit unausgestellter Entwürfe.

Bewusste Präsentationsänderungen: Der große dekorative Bestands-Iconblock entfällt. „Ihr Rechnungsbestand“ bleibt als nicht sichtbare Regionsüberschrift erhalten. Die Formatzeile des Imports trennt „PDF / XML“ mit einem Schrägstrich statt einem Mittelpunkt. Die mobile Leerdarstellung übernimmt die bestehende Desktop-Fassung. Keine neue Kennzahl oder finanzielle Behauptung wurde ergänzt.

## Prüfung und Grenzen

| Prüfung | Ergebnis |
| --- | --- |
| Fokussierte reine Tests | 91 bestanden, 5 Dateien; inklusive Zahlungs-, Fokus- und neuem Quellvertrag |
| TypeScript | Bestanden unter Node 22.23.4 |
| ESLint gesamt | Bestanden ohne ESLint-Warnungen |
| Produktionsbuild einschließlich Typprüfung und Notices | Bestanden unter Node 22.23.4, auch nach den abschließenden CSS-Korrekturen |
| Quellreview durch zweiten Bearbeiter | Abgeschlossen; Statusfilterbreite, mobile Feldschrift und Fokus-Clipping korrigiert |
| Veröffentlichte Funktions- und Sichtprüfung | Nicht ausgeführt; kein Deployment in diesem Arbeitspaket |

Farben, Schrift, Radien und Abstände verwenden die bestehenden Tokens. Fokus erscheint sofort; neue Dekoration oder Eintrittsanimationen gibt es nicht. Die vorhandene Statuskomponente und finanzielle Hinweistexte sind unverändert übernommen.

Es wurde kein lokaler Browser-, nativer PDF-/JVM- oder neuer GitHub-CI-Testlauf gestartet. Es gibt keine neue Nachher-Aufnahme und keinen behaupteten visuellen Hallmark-Gate-Pass. Historische Produkt- und aufbewahrte CI-Bilder ersetzen diese Prüfung nicht.

Vor Veröffentlichung sind auf der veröffentlichten Version insbesondere 320, 375, 414, 768, 1440 und breite Desktopgrößen zu prüfen: lange Belegnamen/Beträge, Teilzahlungen und Stornohinweise, Suche/Status/Zeitraum, alle drei Sortierungen, Pagination, Details-/E-Mail-Fokus-Rückgabe sowie Import mit und ohne ausgewählte Datei. Light/Dark und Tastaturbedienung gehören dazu.
