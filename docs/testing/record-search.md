# Begrenzte Datensatzsuche in der Befehlspalette (#102)

## Öffentlicher Funktionsvertrag

- Die vorhandene Palette bleibt über Strg/⌘+K und den Suchknopf erreichbar. Seiten, Aktionen und Theme-Auswahl bleiben erhalten; Datensätze stehen in eigenen kleinen Gruppen.
- Ab drei Zeichen werden eigene Kundennamen, Ausgangsbelegnummern (Rechnungen/Gutschriften) sowie Eingangsbelegnummern und Originaldateinamen gesucht. Angebote, Kontaktfelder, private Notizen, Originalinhalte und KI-Ergebnisse gehören nicht zur Suche.
- Literale Teilzeichenfolge, keine unscharfe Zuordnung oder Transliteration. ASCII-Groß-/Kleinschreibung wird ignoriert; sonstige Unicode-Zeichen stimmen wörtlich überein. Insbesondere werden `Ä` und `ä` sowie `Ü` und `ü` nicht gleichgesetzt. Prozent, Unterstrich, Anführungszeichen und Backslash sind keine Suchoperatoren.
- Höchstens 100 Eingabezeichen, 250 ms Verzögerung, drei tenantgebundene SQL-Projektionen mit je höchstens sechs zurückgegebenen Zeilen. Angezeigt werden höchstens fünf Ergebnisse pro Typ; die sechste Zeile belegt ausschließlich die Kürzung. Labels sind bereits in SQL auf 240 Zeichen begrenzt.
- Ein Ergebnis enthält ausschließlich Typ, ID, Label und ein bestehendes internes Ziel. Kunden verwenden die ausgewählte Ansicht ihrer vorhandenen Liste, Ausgangsbelege die vorhandene Dokumentauswahl und Eingangsbelege den vorhandenen Prüfbereich. Die Ziele prüfen Besitz erneut. Es werden keine fremden Kontakt- oder Finanzrelationen geladen.
- „Alle … öffnen (ungefiltert)“ führt bewusst zur vorhandenen vollständigen Liste; Suchbegriffe werden nicht in Ziel-URLs übernommen.
- Die lesende Anfrage verwendet `POST /api/record-search` mit begrenztem JSON-Body und vorhandener Authentifizierungs-/Ursprungsprüfung. Antworten sind `private, no-store`; Suchbegriffe werden weder geloggt noch in URLs, Analytics oder Browser-Dauerablage geschrieben. Keine externen Suchanbieter oder Indizes.
- Neue Eingabe, Schließen, Navigation und Konto-/Sessionwechsel verwerfen vorherige Arbeit. Abgebrochene Transporte dürfen auch bei verspätetem Abschluss keine Ergebnisse veröffentlichen. Gleichwertige Eingaben mit zusätzlichem Außenleerraum behalten ihren Zustand.
- Kurze Eingabe, Laden, keine Datensätze, Verbindungsfehler mit Retry und abgelaufene Sitzung sind getrennt erkennbar. Escape gibt den Fokus an den vorhandenen Auslöser zurück.
- Öffnen, Suchen, Wiederholen und Abbrechen erstellen, buchen, versenden oder reservieren nichts. Keine Schema- oder Abhängigkeitsänderungen; die einzige Workflowänderung sind zwei zusätzliche Screenshotnamen in der bestehenden Allowlist.

## Automatisierte Nachweise

Am 22.10.2026 lokal geprüft:

- `record-search.test.ts`: neun Datenbank-/API-Fälle mit frischen synthetischen SQLite-Fixtures: Begrenzungen, stabile Reihenfolge/Kürzung, identische fremde Nummern, keine Fremdrelationen, Sonderzeichen/Unicode, private Inhalte ausgeschlossen, begrenzte SQL-Projektion, unveränderte Finanz-/Auditdaten, Authentifizierung/Ursprung/Bodylimit/Cache und private Fehler ohne Logs.
- `record-search-client.test.ts`: acht Fälle zu POST-Transport, Abbruch trotz später Response/JSON-Auflösung, Sessionablauf und HTTP-/Netzwerk-/Parserfehlern.
- Zusammen mit elf bestehenden Tagesübersichtsfällen und zwei bestehenden Nachweisen zur verlustfreien PNG-Behandlung: **30 Vitest-Fälle bestanden**; die PNG-Prüfung enthält zusätzlich zehn erfolgreiche Python-Fälle.
- Vollständiges `npm run lint` (null ESLint-Warnungen) und `tsc --noEmit --incremental false` bestanden.
- Unabhängige Codeprüfung: zwei gefundene Randfälle (Außenleerraum und erneute Kunden-Besitzprüfung) korrigiert und erneut geprüft; kein verbleibender Implementierungsblocker berichtet.

## Noch ausstehende Browser-Abnahme

`e2e/record-search.spec.ts` ist für den bestehenden isolierten Acceptance-Runner verfasst, aber noch nicht ausgeführt. Sie deckt Desktop 1440 px und Mobil 360/390 px, Keyboard-Auswahl/Fokusrückkehr, bestehende Aktionen, leere/kurze/Unicode-Eingaben, Limit/Kürzung, genaue Detailziele und fremde IDs, Back/Forward/Reload, Fehler/Retry/Sessionablauf, langsame alte Antworten einschließlich Schließen/Neuöffnen und tatsächlichem Kontowechsel sowie unveränderte Finanzdaten/Originalbytes ab.

Die Screenshot-Allowlist wurde gegenüber den 42 bestehenden Namen ausschließlich um die zwei normalen Viewport-Belege ergänzt (44 insgesamt): `record-search-1440.png` und `record-search-390.png`. Alle übrigen Workflow-Bytes, die aggregierte 5-MiB-Grenze, die verlustfreie Vollpixel-/Metadatenprüfung und die eintägige Aufbewahrung bleiben unverändert. Keine Screenshots oder visuelle Abnahme liegen vor. Produktionsbuild und Browser-Abnahme sind nicht ausgeführt; die Funktion ist damit noch nicht als vollständig abgenommen oder veröffentlicht ausgewiesen.

### Konkreter Ausgangsbeleg-Deep-Link

Die verfasste Browser-Abnahme wählt einen Suchtreffer über die Palette aus, wartet auf den tatsächlichen authentifizierten Listenaufruf mit `document=<id>`, prüft exakt die eigene ID und öffnet anschließend den bestehenden **Details**-Dialog. Darin werden die konkrete Rechnungsnummer und der echte gespeicherte Dateiname geprüft; ein bloßes `href`-Matching genügt nicht.

Der bestehende Ausgangsbeleg-Listenvertrag liefert bei einer fremden ausgewählten ID **200 mit leerem `items`**, nicht 404. Die Browser-Abnahme navigiert zusätzlich direkt zu diesem fremden Ziel und erwartet keine Detailaktion/keinen fremden Dateinamen. Der zugehörige Originalabruf `/api/invoices/download?id=<fremde-id>` liefert **404**; auch das wird geprüft. Der Eingangsbeleg-Detailabruf liefert für fremde IDs **404**. Diese Tests sind verfasst, aber noch nicht ausgeführt; die bestehenden API-Verträge werden nicht verändert.
