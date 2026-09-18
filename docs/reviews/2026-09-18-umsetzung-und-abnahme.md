**Umsetzung und Abnahme — 18.09.2026**

Dieser Bericht ergänzt die [ursprüngliche Prüfung](./2026-09-18-pruefung-und-behebungsplan.md). Die dortigen Befunde und Messungen beschreiben den Zustand vor der Behebung. Die Umsetzung erfolgte mit drei ausdrücklich beauftragten Subagents (`gpt-5.6-luna`, Reasoning `max`) und anschließender Gegenprüfung durch den Hauptagenten. Bereits vorhandene Änderungen im Arbeitsverzeichnis wurden berücksichtigt und nicht zurückgesetzt.

**Umgesetzte Pakete und Reihenfolge**

| Reihenfolge | Befunde | Änderungen |
| --- | --- | --- |
| 1 | S01, S02, S03 | Private Mandantenverzeichnisse, serverseitige UUID-Dateinamen, Eigentumsprüfung für Legacy-Dateien und Fremdschlüssel; direkter Zugriff auf `/uploads/*` gesperrt. |
| 2 | S04, S05, S08 | Aktuelle Datenbankrolle und Sitzungsversionsnummer, Widerruf bei Passwort-/Rollenänderung, atomare Erstregistrierung, geteilter SQLite-Limiter, Admin- und API-Änderungsprotokolle. |
| 3 | D01, S07 | Gemeinsame Restore-Validierung, ID-Zuordnung und Datenbanktransaktion; vorbereitete private Dateien und Fehlerbereinigung. Bytebudgets beim Einlesen, ZIP-Entpacklimits, XML-Limit, begrenzte PDF-Konvertierung. |
| 4 | B02, B03, B06 | Gemeinsamer Zahlungsdienst, Einnahme erst bei Bezahlung, mandantenbezogene Dokumentnummern, numerische Fortschreibung, eigenständiges Rechnungsdokument und atomare Angebotsverknüpfung. |
| 5 | B04, B05 | Begrenzte, wiederholbare Nachholung von Ausgaben mit eindeutigem Ausführungsschlüssel; transaktionale Kassenberechnung mit stabiler Sortierung und Centbeträgen. |
| 6 | B01, B02, P01 | Separate Auswertungs-/Anlagen-/Filterendpunkte, vollständige Summen jenseits der Listenpagination, gemeinsame AfA-/Zahlungslogik, Datenbankindizes, weniger KPI-Abfragen, aktive Tabs, entprellte Suche und Abbruchsignale. |
| 7 | B07, S06 | Funktionsfähiger CORS-Preflight mit Prüfung der erlaubten Origin vor Mutation; aktualisierte Abhängigkeiten und Lockfile, reparierte E2E-Datenbankvorbereitung. |

**Bei der Gegenprüfung nachgebessert**

- Alte JWTs ohne Sitzungsversionsnummer werden abgewiesen. Ein Passwortwechsel darf sie nicht nachträglich wieder gültig machen.
- Der Seiten-Proxy prüft die aktuelle Rolle und Version; alte Cookies verursachen dadurch keine Weiterleitungsschleife zwischen Anmeldung und Dashboard.
- Eine erfolgreiche Anmeldung setzt nur das Konto-Limit zurück, nicht den gemeinsamen IP-Zähler.
- Bekannte Legacy-Dateinamen reichen nicht als Eigentumsnachweis. Direkte statische Downloads sind gesperrt.
- Bestehende Logo-Verweise werden beim Lesen auf den geschützten Endpunkt normalisiert. Regressionstests prüfen den Zugriff durch den Eigentümer und die Ablehnung fremder Benutzer.
- Einnahmen und Ausgaben mit Rechnungs-/Kassenbezug dürfen nicht unabhängig von ihrer verknüpften Buchung verändert werden.
- Ressourcenlimits zählen tatsächlich gelesene Bytes; `Content-Length` allein ist kein Schutz.
- Komprimierte PDF-XML-Anhänge werden mit begrenzter Ausgabemenge entpackt. PDF-Konvertierungen werden ohne unbegrenzte Warteschlange begrenzt.
- Wiederherstellungen erhalten Beziehungen, gleichnamige aber unterschiedliche Kunden, Null-/Nullprozentwerte und Kassenbestände. Eine manipulierte Backup-Datei kann die im UI gewählte Zusammenführung nicht mehr in Überschreiben umschalten.
- Vollständige ZIP-Exporte brechen bei fehlenden Dateien oder überschrittenen Wiederherstellungsgrenzen sichtbar ab, statt ein unbrauchbares Archiv auszugeben.

**Prüfnachweise**

Die Schlussprüfung wurde nach einer frischen Installation mit `npm ci` ausgeführt. Nach der letzten Codeänderung wurden Tests, Lint und der vollständige Browserlauf erneut erfolgreich abgeschlossen.

| Prüfung | Ergebnis |
| --- | --- |
| `npm ci` | Erfolgreich; Lockfile reproduzierbar installiert. |
| `npm run test` | 233 Tests in 21 Dateien bestanden; ein optionaler Performance-Test im normalen Lauf übersprungen und gesondert ausgeführt. |
| `npm run lint` | Erfolgreich, keine ESLint-Warnungen. |
| Produktionsbuild und Typprüfung | Erfolgreich als Bestandteil von `npm run test:e2e`. |
| `npm run test:e2e` | 4 von 4 Chromium-Tests bestanden: Registrierung/Dashboard, Rechnungseditor, sichere Restore-Auswahl mit Warnungen, Zugriffsschutz und Sitzungswiderruf. |
| Prisma | Schema gültig; Upgrade bestehender Testdaten, Fremdschlüsselprüfung und Schemavergleich erfolgreich. |
| `npm audit` | 0 gemeldete Schwachstellen einschließlich Entwicklungsabhängigkeiten zum Prüfzeitpunkt. |
| `git diff --check` | Erfolgreich. |

Die KPI-Route benötigt fünf statt ursprünglich 62 SQL-Abfragen. Im lokalen Vergleich der Zwischenlösung mit der abschließenden SQL-Aggregation sank bei 100.000 Zeilen je Einnahmen-/Ausgabentabelle die mediane Laufzeit von 1.440,30 auf 199,33 ms. Die maximal beobachtete zusätzliche RSS-Speicherbelegung sank von 307,85 auf 4,50 MiB. Messaufbau und Grenzen stehen in der [Performance-Messung](./2026-09-18-performance-messung.md).

Bereits gesondert überprüft:

- Upgrade einer temporären Datenbank vom bisherigen Migrationsstand: historische Beträge, Rechnungsnummern und Dateinamen bleiben erhalten; doppelte AppSettings bleiben mit Legacy-Schlüsseln erhalten. Fremdschlüsselprüfung ohne Fehler. Prisma-Schemavergleich: keine Abweichung.
- Parallele Erstregistrierung mit 20 Versuchen: genau ein Administrator.
- Parallele Nummernvergabe, Nachholen von Monatsausgaben, Rückdatierung im Kassenbuch und wiederholtes Bezahlen einer Rechnung in isoliertem SQLite.
- Offline-MIME-Erzeugung mit Nodemailer und AVIF-Dekodierung mit sharp bestanden; keine E-Mail versendet.
- `npm audit` einschließlich Entwicklungsabhängigkeiten: keine gemeldeten Schwachstellen zum Prüfzeitpunkt. Das ist keine Garantie gegen unbekannte Lücken.

**Datenbank- und Betriebsänderungen**

Die Migrationen `20260918120000_auth_hardening` und `20260918195000_bookkeeping_integrity` ergänzen Sitzungswiderruf, Registrierungs-Singleton, Limiter, Buchungsverknüpfungen, Nummernzähler und Indizes. Die bisher globale Eindeutigkeit von Rechnungsnummern wird durch Eindeutigkeit pro Benutzer ersetzt. Historische Beträge und Dokumentnummern werden nicht umgeschrieben.

Es wurden keine Migrationen gegen die Entwicklungs- oder Produktionsdatenbank ausgeführt. Vor dem produktiven Update sind Datenbank und beide bisherigen Upload-Speicher zu sichern; danach werden die Migrationen mit `npm run db:migrate` angewendet. Bestehende Sitzungen ohne Versionsnummer müssen sich nach dem Update neu anmelden.

Node ist auf unterstützte Versionen ab 22.13 bis vor 25 eingeschränkt; `.nvmrc` verwendet 22. Das Docker-Image verwendet weiterhin Node 22. Die privaten Dateien unter `/app/data/uploads` liegen im bestehenden Daten-Volume. Legacy-Dateien werden weiterhin über geschützte API-Zugriffe aufgelöst; eine automatische Löschung oder unkontrollierte Verschiebung des Altbestands erfolgt nicht.

`TRUST_PROXY=true` darf nur bei einem vorgeschalteten Proxy gesetzt werden, der eingehende Forwarding-Header überschreibt. Ohne diese Einstellung verwendet das IP-Limit einen gemeinsamen konservativen Zähler; das Konto-Limit bleibt separat.

**Verhalten bei unvollständigen oder alten Daten**

JSON-Backups enthalten keine Dateibytes. Verfügbare eigene Dateien werden übernommen; fehlende Dateien werden nicht durch leere PDFs ersetzt. Die Wiederherstellung liefert Warnungen, die auch die Oberfläche anzeigt. Für einen Umzug samt Dateien ist das vollständige ZIP-Backup vorgesehen. API-Schlüssel müssen nach einem überschreibenden Restore neu angelegt werden.

Ein Rechnungsstorno ist keine automatische Rückerstattung. Bereits erfasste Zahlungen bleiben bestehen; bei einer als bezahlt markierten Alt-Rechnung ohne `paidAt` wird beim Storno das Datum ihrer bestehenden Einnahme erhalten. Ein separater Ablauf zur Bestätigung einer tatsächlichen Rückerstattung wurde nicht neu eingeführt.

Ressourcenbudgets: Rechnungsupload 25 MiB, XML 8 MiB, PDF-Konvertierung 20 MiB PDF und 25 MiB kombiniert, ZIP 100 MiB komprimiert/250 MiB entpackt, höchstens 2.000 ZIP-Einträge und 50 MiB je Eintrag. Ghostscript läuft höchstens 30 Sekunden; maximal zwei Dokumentverarbeitungen gleichzeitig pro Prozess und eine pro Benutzer im begrenzten Verarbeitungsschritt. Details und Konstanten stehen in `lib/resource-limits.ts` und `lib/processing-limit.ts`.

Die [Performance-Messung](./2026-09-18-performance-messung.md) dokumentiert die Prüfung mit 100, 10.000 und 100.000 synthetischen Zeilen je Tabelle sowie die Indexnutzung.

**Grenzen der Abnahme**

Die Prüfung verwendet synthetische Testdaten und eine isolierte Browserdatenbank. Die tatsächliche Produktionskonfiguration, Reverse-Proxy-Regeln, externe SMTP-Zustellung und ein vollständiger Last-/Penetrationstest sind damit nicht abgedeckt. Die PDF-Prozessbegrenzung gilt pro Node-Prozess; sie ist keine installationsweite Ressourcenquote über mehrere Replikate. Vorhandene historisch unklare Zahlungs- oder Dateizuordnungen werden nicht automatisch als fachlich korrekt umgedeutet.
