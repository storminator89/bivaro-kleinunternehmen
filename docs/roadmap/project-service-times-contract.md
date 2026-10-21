# Vertrag: Projekte und manuell erfasste Leistungszeiten

## Umfang und Grenzen

Eine Leistungsnotiz gehört einem Kunden und kann optional einem Projekt dieses Kunden zugeordnet sein. Projekte dienen ausschließlich der Organisation. Weder Projekte noch Leistungsnotizen speichern Stundensätze, Budgets oder automatisch berechnete Preise.

Erfassung, Filterung, Projektnamen und Archivierung lösen keine Rechnung, keinen Versand, keine Zahlung und keine Einnahmen- oder Ausgabenbuchung aus. Es gibt keinen laufenden Timer und keine automatische Abrechnung. Preise und Steuerbehandlung werden erst im Rechnungseditor bewusst festgelegt.

## Dauer und Rechnungsmenge

| Wert | Vertrag |
| --- | --- |
| Eingabe `duration` | Stunden und Minuten als `HH:MM`, mit zwei bis vier Stundenziffern und Minuten `00` bis `59`; keine Dezimalstunden. |
| Speicherung `durationMinutes` | Ganze Minuten von `1` bis `60000`; `null` bedeutet **nicht erfasst**, nicht null Minuten. |
| Abgeleitete `quantity` | Minuten geteilt durch 60, deterministisch kaufmännisch auf zwölf Nachkommastellen gerundet. |
| Einheit einer Zeitnotiz | Genau `Stunde`. Eine widersprechende Menge oder Einheit wird abgelehnt. |
| Beispiel | `01:30` → `90` Minuten → `1.5` Stundenmenge; deutsche Anzeige `1,5 Stunde`. |

Die Stundenmenge ist ein gerundeter Übergabewert, keine Behauptung einer exakten Dezimaldarstellung wiederholender Brüche. Beispielsweise wird eine Minute als `0.016666666667` Stunden übergeben. Die bestehenden Rechnungsregeln zur Geldberechnung und Rundung je Position auf Cent bleiben unverändert. Abgerechnet wird die sichtbare gerundete Stundenmenge, nicht ein zweiter rationaler Minuten-Preisweg. An einer halben Centgrenze kann dies einen Cent Unterschied ergeben: `00:59` → `0.983333333333` Stunden zu `0.30 EUR` je Stunde ergibt nach dem bestehenden Mengenvertrag `0.29 EUR` Positionsnetto; der exakte rationale Minutenanteil wäre `0.295 EUR` vor Rundung. Die Auswahl zeigt deshalb die tatsächlich verwendete Stundenmenge und das tatsächliche Positionsnetto vor Rechnungserstellung; eine exakte rationale Minutenabrechnung wird nicht zugesagt.

Eine gewöhnliche Mengenposition bleibt auch mit der Einheit `Stunde` eine Position ohne erfasste Dauer. Aus Menge oder Einheitenbezeichnung wird keine Zeit rückwirkend hergeleitet. Dauerübersichten summieren ausschließlich bekannte ganze Minuten und weisen Notizen ohne Zeitangabe separat aus. `00:00` in einer Summe bedeutet daher nur, dass keine bekannten Minuten in dieser Auswahl vorliegen.

## Eigentum und Projektzustand

- Der angemeldete Eigentümer bestimmt den Mandanten; Kunden, Projekte und Notizen müssen zu diesem Mandanten gehören.
- Eine Projektzuordnung muss zusätzlich zum Kunden der Notiz passen. Fremde, fehlende oder für neue Leistungen archivierte Projekte werden abgelehnt.
- Ein Projektname wird getrimmt und umfasst 1 bis 120 Zeichen. Umbenennen ändert weder Projektidentität noch Kundenzuordnung.
- Archivierung ist reversibel. Bestehende Notizen, Filtermöglichkeiten und Rechnungszuordnungen bleiben erhalten; neue Notizen können erst nach Reaktivierung wieder diesem Projekt zugeordnet werden.
- Archivierung oder Umbenennung verändert keine bereits gespeicherte Rechnungsdatei. Rechnungsdateien sind kein live aus Projektdaten erzeugtes Dokument.

## Erfassung, Unterbrechung und Wiederholung

Die Oberfläche erzeugt beim ersten Speicherversuch einer Leistung einen `captureKey` als kanonische UUIDv4. Der Server bindet diese Kennung innerhalb des Mandanten an genau einen normalisierten Erfassungsbefehl. Sein SHA-256-Fingerabdruck verwendet die versionierte Kennung `bivaro.service-capture.v1` sowie Kunden-ID, nullable Projekt-ID, Leistungsdatum, Beschreibung, Menge, Einheit und nullable Minutenwert. Veränderliche Projektnamen, Archivstatus und spätere Rechnungszuordnungen gehören nicht zu diesem Fingerabdruck.

Ein erfolgreicher neuer Befehl liefert die angelegte Notiz. Die Wiederholung derselben Kennung mit demselben Inhalt liefert dieselbe Notiz, auch wenn die erste Antwort verloren ging oder die Notiz inzwischen einer Rechnung zugeordnet wurde. Dieselbe Kennung mit abweichendem Inhalt ist ein Konflikt und legt keine zweite Notiz an. Ältere Aufrufer ohne Erfassungsschlüssel haben diese Wiederholungsgarantie nicht.

Bei einer unklaren Netzwerkantwort oder einem Serverfehler hält die Oberfläche den begonnenen Befehl mit derselben Kennung fest und sperrt seine Eingaben bis zur erneuten Prüfung oder zum ausdrücklich bestätigten Schließen. Ein abgebrochener Schließversuch behält den ausstehenden Befehl bei. Ein Bestandsabruf kann eine bereits gespeicherte, passende Notiz auch ohne erneuten Schreibversuch erkennen. Eine Wiederholung darf nicht stillschweigend als neue Leistung gespeichert werden. Eine eindeutige Ablehnung ohne Speicherung lässt die Eingaben zur Korrektur erhalten. Die ausstehende Erfassung ist kein dauerhaft gespeicherter Rechnungsentwurf.

Wird eine noch offene, mit Erfassungsschlüssel angelegte Notiz entfernt, bleibt ihr Erfassungsnachweis mit `deletedAt` erhalten. Sie verschwindet aus der Auswahl und kann nicht durch Wiederholung desselben Befehls wieder entstehen; der Server meldet einen Konflikt. Bereits einer Rechnung zugeordnete Notizen können nicht auf diesem Weg entfernt werden. Ältere Notizen ohne Erfassungsschlüssel besitzen keinen solchen dauerhaften Wiederholungsnachweis.

## Filter und bewusste Rechnungsübernahme

Der Kundenverlauf filtert nach Projekt, Leistungsdatum und offenem beziehungsweise zugeordnetem Zustand. Seine Summen beziehen sich auf die aktuelle Filterauswahl, nicht auf alle Leistungen oder den Rechnungsbetrag.

Im Rechnungseditor werden nur offene Notizen des ausgewählten Kunden angeboten. Eine Auswahl ergänzt Rechnungspositionen mit Startpreis `0,00 €`, erstellt aber noch keine Rechnung und reserviert die Notizen noch nicht. Die Übersicht trennt Quelldauer und Quellenangaben von der aktuellen Rechnungsposition und weist fehlende Zeitangaben sowie noch nicht festgelegte Preise aus.

Projekt- und Datumsfilter ändern die bestehende Auswahl nicht. Verdeckte ausgewählte Notizen bleiben in der vollständigen Auswahlübersicht enthalten und werden gezählt. Ein Kundenwechsel entfernt übernommene Notizpositionen; sie müssen für den neuen Kunden neu ausgewählt werden. Abbrechen oder ein vollständiges Neuladen des Rechnungseditors stellt keine Rechnung aus und beansprucht keine Notiz; die ungespeicherte Auswahl wird nicht wiederhergestellt.

Erst die tatsächliche Rechnungsspeicherung prüft Kunde, offene Notizen und passende Rechnungszeilen und ordnet alle gewählten Notizen in derselben Transaktion zu. Bei Konflikt, unpassender Position oder konkurrierender Zuordnung wird die gesamte neue Zuordnung zurückgerollt. Eine Notiz kann nicht unabhängig von der Rechnung oder ein zweites Mal beansprucht werden. Preise und Steuerbehandlung bleiben Teil der ausdrücklich geprüften Rechnung, nicht der Projekt- oder Dauerquelle.

## Versionierte Sicherung und Wiederherstellung

Backup-Format `3.0` mit Schemaidentität `20261021160000_add_project_service_times` führt `serviceProjects` sowie die explizit nullable Notizfelder `projectId`, `durationMinutes`, `captureKey`, `captureFingerprint` und `deletedAt`. Die Fähigkeit wird anhand einer ausdrücklich unterstützten Schemaidentität geprüft, nicht aus der zeitlichen Reihenfolge eines Versionsnamens abgeleitet.

- Projektzustand, ganze Minuten, kanonische Stundenmenge, Erfassungsnachweis und vorhandene Rechnungszuordnung gehören zur Sicherung. Auch entfernte erfasste Notizen behalten ihren Nachweis.
- Vor dem Import werden Feldmenge, Datentypen, Zeitgrenzen, kanonische Menge und Einheit, Erfassungsfingerabdruck, eindeutige Kennungen sowie Kunden-, Projekt- und Rechnungsbeziehungen geprüft.
- Quell-IDs werden auf Kunden, Projekte und Rechnungen des Zielmandanten abgebildet. Gleichlautende Projektnamen sind keine Identität und dürfen keine Projekte verschiedener Kunden zusammenführen.
- Der Fingerabdruck wird zunächst mit den Quellbeziehungen geprüft und nach der Abbildung anhand der Ziel-Kunden- und Ziel-Projekt-ID neu berechnet. Die UUID des Erfassungsnachweises bleibt stabil und mandantenbezogen; Quell-IDs werden nicht als Zielberechtigung übernommen.
- Eine nicht leere Rechnungszuordnung der Quelle muss bei einer bereits vorhandenen Notiz auf dieselbe abgebildete Zielrechnung zeigen. Quelle abgerechnet und Ziel offen, entfernt oder anders zugeordnet ist ein Konflikt: Der gesamte Import einschließlich neu importierter Rechnungen wird zurückgerollt, statt die Notiz offen abrechenbar zu lassen oder sie automatisch neu zuzuordnen. Eine ältere offene Quelle darf einen späteren Zielnachweis hingegen nicht öffnen oder überschreiben.
- Eine erneute Zusammenführung derselben Quellidentität erzeugt keine zweite Notiz oder ein zweites Projekt. Bereits vorhandene Ziel-Projektnamen und Archivzustände bleiben erhalten; bestehende Leistungsdaten und spätere Rechnungszuordnungen werden nicht durch einen älteren Stand überschrieben. Entfernte Notizen werden nicht wieder sichtbar gemacht.
- Ältere unterstützte Sicherungen ohne Projekt- und Zeitfähigkeit behalten ihre gewöhnlichen Mengennotizen. Für sie werden weder Projekte noch Minuten erfunden. Unerwartete neue Projekt-, Dauer- oder Erfassungsfelder unter einer alten Schemaidentität werden nicht stillschweigend verworfen.
- Ein Überschreiben mit vorhandenen Erfassungsnachweisen oder bereits abgerechneten Projekt-/Zeitnotizen wird abgelehnt. Ältere Sicherungen dürfen außerdem keine vorhandenen Projekt-/Zeitdaten destruktiv ersetzen. Nicht sicher auflösbare Beziehungen oder Identitätskonflikte brechen den Import ab, statt Leistungen zu verschieben, neu zu beanspruchen oder wiederzubeleben.
