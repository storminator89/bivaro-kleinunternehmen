# Leistungsaufstellung aus expliziter Auswahl · #103

## Umfang

Die Aktion „Aufstellung“ ergänzt den vorhandenen Leistungsverlauf eines Kunden. Gewählt werden ein Zeitraum mit Beginn und Ende, optional ein Projekt, ein Status und einzelne vorhandene Leistungsnotizen. Die Auswahl zeigt 25 Zeilen pro Seite und umfasst höchstens 100 Notizen. Beschreibungen werden nur nach ausdrücklicher Auswahl übernommen; interne Kundenhinweise, Adressdaten und Preise sind nicht Teil der Ausgabe.

`POST /api/billing-notes/statement` prüft Kunden-, Projekt-, Notiz- und Rechnungszugehörigkeit und liest die ausgewählten, nicht entfernten Quellen in einer Transaktion. Fehlende, fremde, inzwischen geänderte Beschreibungen oder nicht filterkonforme Quellen führen zu einer Fehlermeldung statt zu einer Teilausgabe. Grenzen: 256 KiB Request und 2 MiB PDF.

Vorschau und PDF stammen aus demselben serverseitigen Snapshot mit Datenstand, gewählten Filtern und Originalmengen/-einheiten. Wiederholte Downloads und die Dateivorschau verwenden dieselbe bereits erzeugte Datei. Eine neue Auswahl erstellt einen neuen Snapshot; eine bestehende Vorschau verändert sich nicht nachträglich.

Bekannte Minuten und Notizen ohne Zeitangabe werden getrennt dargestellt. 01:30 bleibt 90 Minuten; eine alte Dezimalmenge ohne explizite Dauer wird nicht nachträglich in Minuten umgerechnet. Archivierte Projekte und bereits einer Rechnung zugeordnete Leistungen bleiben lesbar.

Das Dokument trägt die Kennzeichnung „Leistungsaufstellung“ und „Keine Rechnung / keine Abnahmebestätigung“. Es enthält keine Unterschrift, Preise oder behauptete Kundenzustimmung. Lesen, Vorschau, Download, Wiederholung und Abbruch ändern keine Leistungszuordnung, Rechnung, Zahlung oder Finanzbuchung und lösen keinen Versand aus. Keine Schemaänderung, Migration oder zusätzliche Abhängigkeit.

Die vorhandenen Helvetica-Schriften unterstützen nicht sämtliche Unicode-Zeichen. Nicht unterstützte Zeichen führen zu einer verständlichen Fehlermeldung statt zu einer still veränderten Beschreibung. Auch HTML-/ungültige Gatewayantworten ergeben eine verständliche Fehlermeldung; die Auswahl bleibt für einen erneuten Versuch erhalten. Temporäre Datei-URLs werden beim Schließen freigegeben; es gibt keine neue Browser-Dauerablage.

## Prüfnachweise

Geprüfter Quell-/Testcommit: `9b98a82f4187da3ab5fffbc20d693a6212896713`, auf Basis `cec73ab`.

- Fokussierter Vitest-Lauf: **5 Dateien / 62 Tests bestanden**, kein Skip, 4,83 s; davon 28 neue Statement-/Clienttests. Abgedeckt sind unter anderem Mandantentrennung, Filter, unveränderte Beschreibungen, entfernte Quellen, fehlende Dauer, parallele Wiederholung ohne Schreibwirkung, verständliche Fehler, 100/101-Auswahl und mehrseitige PDFs. Die Datenbanktests verwenden isolierte temporäre Fixtures.
- ESLint für alle geänderten TypeScript-/TSX-Pfade: bestanden, keine Warnungen.
- Vollständige TypeScript-Prüfung: bestanden.
- Synthetisches einseitiges PDF und eine Folgeseite einer 21-seitigen 100-Zeilen-Aufstellung mit Poppler gerendert und visuell geprüft. Ergänzende Textextraktion bestätigt die 90 Minuten und die getrennte unbekannte Dauer. Dies ersetzt keine Browserabnahme.
- Statischer Review des Exportvertrags: keine Mandantentrennungs-, Schreib-/Zuordnungs- oder Snapshotlücke gefunden. Der dabei identifizierte Gatewayfehler wurde behoben und durch Clienttests ergänzt.

## Offene Abnahme

`e2e/service-statement.spec.ts` enthält den noch auszuführenden Browserweg für 1440/360/390 px: Auswahl und Pagination, ungültiger Zeitraum, leere Daten, JSON-/HTML-Fehler mit sicherem Retry, Tastatur/Fokus, tatsächliches Öffnen der Dateivorschau, identische Wiederholungsdownloads, nachträgliche Quelländerung ohne Änderung der alten Datei, neuer Export, Abbruch, Reload und unveränderte fachliche Tabellen.

Zwei neue Viewport-PNG-Namen (1440/390 px) ergänzen die bestehende vollständige Allowlist; 360 px wird funktional geprüft. Das 5-MiB-Gesamtbudget und die verlustlose Vollpixelprüfung bleiben unverändert.

Productionbuild, vollständige CI, gehostete Browserausführung und tatsächliche Bildkontrolle der neuen UI stehen noch aus. Die Implementierung wird deshalb nicht als vollständig browserabgenommen oder veröffentlicht bezeichnet.
