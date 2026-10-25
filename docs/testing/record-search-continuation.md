# #102 – Begrenzte Trefferfortsetzung in der vorhandenen Befehlspalette

Stand: 25.10.2026. Ausgangspunkt: `e268d1c8d64dd7f7bceb4b651ba55eb3ebdb7931`.

## Lieferumfang und ehrliche Grenze

Die bestehende Datensatzsuche bleibt erhalten; keine zweite globale Suche und keine Suchbegriff-Übergabe an eine URL. „Weitere Treffer“ und „Vorherige Treffer“ wechseln **innerhalb der Palette je Datensatztyp** eine Ergebnisseite. Andere Typen behalten ihre Seitenposition. Die ungefilterte Listenöffnung bleibt ausdrücklich als solche beschriftet.

- `POST /api/record-search`: `{ query, pages?: { customer?, outbound?, inbound? } }`. Fehlende Positionen beginnen bei `0`; nur ganze Zahlen von `0` bis `19` werden akzeptiert. Ungültige Typen, unbekannte Schlüssel und ungültige Seiten werden vor SQL mit `400` zurückgewiesen; das bestehende 1-KiB-Bodylimit bleibt.
- Je Typ maximal **5 sichtbare Datensätze**, plus eine sechste skalare SQL-Zeile als `hasMore`-Signal. Maximal 20 Seiten/100 sichtbare Treffer je Typ; maximaler SQL-Offset 95. Am Limit mit weiteren Treffern: „Suchgrenze erreicht · Suchbegriff eingrenzen.“ `hasMore` wird am Limit nicht fälschlich auf `false` gesetzt.
- Speicher enthält nur die aktuellen drei Seiten und drei begrenzte Seitenzahlen, keine aufgesammelten Treffer oder Cursorhistorie. Labels bleiben SQL-seitig auf 240 Zeichen begrenzt.
- Jede Anfrage liest den **aktuellen** eigenen Datenbestand. Sortierung wie bisher: Kundenname/ID aufsteigend, Belege Uploadzeit/ID absteigend. Keine datenübergreifende Momentaufnahme: parallele Änderungen können Treffer zwischen Seiten verschieben, wiederholen oder entfernen. Die Oberfläche weist darauf hin; sie verspricht weder Gesamtzahl noch Vollständigkeit. Auch eine nach Löschung leere spätere Seite bietet Zurück.

## Unveränderte Sicherheits- und Fachgrenzen

Authentifizierung, bestehender Request-/CSRF-Schutz, `private, no-store`/`Vary: Cookie`, Mandantenfilter in jeder SQL-Abfrage und erneute Besitzprüfung der bestehenden Detailziele bleiben bestehen. Nur Kundenname, Ausgangsbelegnummer sowie Eingangsbelegnummer/Originaldateiname werden durchsucht. Keine Notizen, Originalinhalte, KI- oder Anhangssuche, kein neuer Index oder Dienst.

Suchtext und Seitenpositionen stehen ausschließlich im POST-Body und flüchtigem React-Zustand: keine Such-URLs, Historyeinträge, Analytics, Logs oder neue Browser-Dauerablage. Seitenwechsel mutiert keine Kunden-/Beleg-/Finanzdaten. Keine Schema-, Backup-, Auth-, Hosting- oder Workflowänderung.

Abbruch wird sofort bei geänderter normalisierter Eingabe, Seitenwechsel, Schließen und Unmount ausgelöst. Zusätzlich prüft die Veröffentlichung die Requestgeneration und die Lebensdauer der Palette. Query **und** Seitenpositionen bestimmen die sichtbare Antwort. Navigation/Konto-/Sessionwechsel entsorgen weiterhin den bestehenden gekeyten Palettenbesitzer. Fehler entfernen alte Treffer; Retry wiederholt dieselbe Seite, alternativ führt „Zur ersten Ergebnisseite“ sicher zurück. Loading/Fehler/Seitenposition sind als Status angesagt. Nach Fortsetzung bleibt der Combobox-Fokus erhalten und der erste Treffer der neuen Typseite wird für Enter ausgewählt (einschließlich Treffer 6).

## Prüfnachweise – strikt getrennt

### Erlaubte statische/Build-Prüfungen

- `npm run lint`: **bestanden**, Exit 0, gesamtes Repository mit `--max-warnings 0` auf dem finalen Quellstand.
- `tsc --noEmit --incremental false`: **bestanden**, Exit 0, gesamtes Repository. Zunächst drei ältere Paletten-Lifecycle-Gruppenfixtures ohne das neue `page`-Metadatum gefunden; ausschließlich additive Metadaten ergänzt.
- Produktionsbuild: erster Versuch scheiterte an einer Turbopack-Grenze für den nach außen zeigenden `node_modules`-Symlink; durch unabhängige lokale Dependencykopie behoben, ohne Shared-Dependencies oder Projektkonfiguration zu ändern. Zweiter Versuch kompilierte erfolgreich und wurde während TypeScript vom Prozessumfeld beendet (Exit 137). Mit unabhängig kopierten Dependencies und `NODE_OPTIONS=--max-old-space-size=1536` anschließend **vollständig bestanden**, Exit 0; nach den Reviewkorrekturen nochmals regulär einschließlich Pre-/Postbuild bestanden. Kein Server gestartet, keine Datenbankmigration oder Funktionstest ausgeführt.

### Automatisierte Fach-/Browserfälle: verfasst, **nicht ausgeführt**

Keine lokalen Unit-, Funktions-, API- oder Browsertests und kein neuer GitHub-CI-Lauf wurden für dieses Paket gestartet. Bestehende erfolgreiche Suchtests früherer Commits sind kein Nachweis für diese Änderung.

- `lib/__tests__/record-search.test.ts`: Validierung/harte Seitengrenze, unabhängige Typseiten, Treffer 6–10, Rückkehr, letzte Teilseite, leere Seite nach paralleler Löschung, ehrliches `hasMore` am Limit, fremde Mandanten bei gleichen Begriffen, Cache-/Auth-/Bodyfehler für Seitenanfragen; bestehende Read-only-/Unicode-/SQL-Literal-/Privatfeldnachweise bleiben.
- `lib/__tests__/record-search-client.test.ts`: reine POST-Übertragung mit kopierter Seitenidentität, veraltete Antwort bei gleichem Text/anderer Seite, Retry derselben Seite, bestehende Abbruch-/JSON-/Session-/Netzwerkfehlerfälle.
- `lib/__tests__/command-palette-navigation-lifecycle.test.ts`: bestehende Verhaltensassertions unverändert, nur additive `pages`-/`page: 0`-Fixturemetadaten, damit der erweiterte Vertrag typisiert bleibt.
- `e2e/record-search.spec.ts`: bestehende isolierte synthetische Abnahme erweitert um alle drei unabhängigen Typfortsetzungen, Keyboard-Next und Enter auf Treffer 6, Zurück, URL-Konstanz, Seite-2-Fehler/Retry mit identischem Body, verzögerte Seitenantwort nach neuer Eingabe, leere spätere Seite nach modellierter paralleler Löschung und 360/390/1440-px-Captures. Auswahl-Sichtbarkeit und `aria-activedescendant` werden gegen die tatsächlich ausgewählte Option geprüft, auch bei Fortsetzung nicht-erster Gruppen. Bestehende Session-/Konto-/Close-/History-/Privacy-/Read-only-Abnahme bleibt erhalten.

Geplante neue Bilddateien: `record-search-continuation-360.png`, `record-search-continuation-390.png`, `record-search-continuation-1440.png`. **Noch keine tatsächlichen Screenshots und keine Bildkontrolle dieses Kandidaten vorhanden.** Keine CI-Partition oder Artefaktliste wurde verändert.

### Unabhängiges statisches Review

Ein separater lesender Subagent hat den Diff geprüft. Zwei Befunde wurden behoben: cmdk 1.1 synchronisiert bei alleiniger programmgesteuerter `value`-Änderung weder aktiven Nachfahren noch Scrollposition (jetzt öffentlicher Pointer-Interaktionspfad am realen Ref-Ziel mit explizitem Scrollen); eine Cap-Test-Erwartung fehlte das Padding der Seedlabels. Nachprüfung: keine weiteren blockierenden statischen Befunde. Dies ersetzt ausdrücklich keine ausgeführte Browserabnahme.

`git diff --check`: bestanden. Lokale Logs: `/tmp/bivaro-102-types.log`, `/tmp/bivaro-102-lint.log`, `/tmp/bivaro-102-build.log`.

## Noch offenes Freigabegate

Issue #102 bleibt offen. Kein Push, keine PR-Erstellung, Veröffentlichung, Zusammenführung oder Bereitstellung ist Teil dieses lokalen Pakets. Vor einer Lieferbehauptung sind die konkrete Veröffentlichung sowie freigegebene gehostete Funktions-/Browserabnahme einschließlich wirklicher Bildkontrolle erforderlich. Bei gehosteter Prüfung nur isolierte synthetische Mandanten verwenden; keine produktiven Finanzdaten oder Originale verändern.

## Separat freigegebene Veröffentlichungsphase

Am 25.10.2026 wurde anschließend die Veröffentlichung als **Entwurfs-PR mit vollständiger GitHub-CI und gehosteter Browserprüfung** freigegeben; kein Merge, keine Bereitstellung oder Ticket-Schließung. Die obigen lokalen Prüfnachweise bleiben historisch getrennt. Lokale Funktionstests bleiben untersagt.

Für diesen Kandidaten ergänzt `.github/workflows/browser-acceptance.yml` eine unabhängige, verpflichtende Drei-Bild-Partition für die oben benannten Fortsetzungsbilder. Alle akzeptierten 209 bisherigen Namen, Auth-/Browserassertions, Workflowpräfixbytes und 28 MiB bisherigen Ausgabebudgets bleiben unverändert. Zusätzlich maximal 1 MiB Ausgabe, maximal 2 MiB Gesamteingabe und 1 MiB je Eingabedatei; sichere reguläre Pfade und begrenzte Reads, vollständige verlustfreie Pixel-/Metadatenprüfung, zwei begrenzte Prozesse, vorhandene Timeouts und ein Tag Aufbewahrung bleiben. Fehlende oder doppelte Bilder scheitern geschlossen. Bestehende Bounds-Tests prüfen weiterhin ihr akzeptiertes Präfix; neue Bounds-Tests prüfen zusätzlich alle 212 eindeutigen Namen und die neue Partition. Keine #59/#130-Bilder werden auf diesem unabhängigen #102-Zweig vorausgesetzt.

Tatsächliche gehostete Ergebnisse und Bildkontrolle werden erst nach dem Lauf dokumentiert; ein grüner lokaler Build ist kein Ersatz dafür.

### Erster gehosteter Lauf und eng begrenzte Nacharbeit

Entwurfs-PR #145, erster Kandidat `0ccbd70ea5e8a0485ed5dc9d40e249812beed01d`: CI `40171085265` bestand einschließlich 4282 Unit-/Fachtests (275 Dateien bestanden; bestehende 3 Dateien/20 Tests übersprungen), Lint/Typen, Build und Security. Die x64-/arm64-PDF-A-Konformität `40171085262` bestand ebenfalls.

Browserlauf `40171085260` scheiterte mit **165 bestandenen und 2 fehlgeschlagenen Fällen**. Die Suchfortsetzung hatte nach dem ersten Typseitenwechsel keinen aktiven Combobox-Nachfahren: cmdk konnte das reale Options-Ref erst nach dem Bereitschaftseffekt der Palette anhängen. Die Auswahl wird nun bei tatsächlicher Ref-Bereitschaft erneut synchronisiert und einmalig verbraucht. Ein reiner Pointer-Wertwechsel über die bestehende neutrale Listenoption zurück zum Ziel erzwingt dabei auch für ein bereits automatisch vorselektiertes Ziel die Nachfahren-Synchronisierung; es wird weder geklickt noch die Listenaktion ausgeführt; die Typseitenassertions verlangen den konkreten erwarteten Ausgangs-/Eingangstreffer. Ein zusätzlicher Lifecycle-Regressionsfall bildet verspätetes Ref-Anhängen ab. Der zweite Fehler war ausschließlich der veraltete Listenlabel-Locator in `incoming-review-cross-navigation.spec.ts`; dieser folgt jetzt dem neuen ausdrücklichen ungefilterten Label, sämtliche echten Vorprüfungs-, Auth-, Originalbytes- und Nichtbuchungsassertions bleiben.

Die neue verpflichtende Bildpartition scheiterte erwartungsgemäß geschlossen, da die Suchprüfung vor ihren Bildern stoppte. Keine Gates, bestehenden Bildbudgets oder Zeitgrenzen werden zur Nacharbeit gelockert. Ein neuer vollständiger gehosteter Lauf und die tatsächliche Bildkontrolle bleiben bis zum erneuten Ergebnis offen; lokale Funktionstests wurden weiterhin nicht ausgeführt.

### Zweiter Lauf: ARIA bestanden, Geräteabläufe weiter zu prüfen

Kandidat `9b8bf1f7dc2adceb42d37a58d6ed55552baa0078`: CI `40173802784` bestand mit 4283 Tests, einschließlich der zusätzlichen verspäteten Ref-Regression; Security/Build/Typen/Lint und x64-/arm64-PDF-A `40173802782` bestanden. Browser `40173802803` erreichte **166 bestandene und 1 fehlgeschlagenen Fall**. Die echten ARIA-/Typseitenprüfungen und sämtliche Belegeingangs-Vorprüfungen bestanden nun. Die spätere sechste Tastaturauswahl öffnete nach einem Wechsel des Viewports aber die inzwischen vorselektierte ungefilterte Liste statt des zuvor ausgewählten Kunden.

Alle drei neuen Bilder wurden innerhalb ihrer unveränderten Pflichtpartition geliefert und tatsächlich betrachtet: bei 360/390 px war der sechste Kunde markiert, nach Rückkehr zu 1440 px die ungefilterte Liste. Der getrennte, ausdrücklich nicht als Abnahme zählende Diagnosezweig reproduzierte dies (`40175454132`: 42 bestanden/1 fehlgeschlagen). Nur das Parken des Zeigers vor dem Live-Gerätewechsel reichte nicht (`40176129823`: ebenfalls 42/1).

Die nächste, noch nicht gehostet bestätigte Prüfung trennt deshalb vollständige echte Geräteabläufe: Palette vor jedem Viewportwechsel schließen, danach neu öffnen und jeweils mit Home/Pfeiltasten fortsetzen, den konkreten sechsten Datensatz samt aktivem Nachfahren/Fokus/Sichtbarkeit prüfen, Bild erzeugen und mit echtem Enter genau dessen ID-Ziel öffnen; dann Zurück und die geschlossene Palette prüfen. Keine erneute Zielauswahl nach dem Bild, kein Zielklick, kein erzwungener Klick und keine Lockerung der Daten-/Auth-/Bildgates. Diese strengeren getrennten Geräteabläufe und der abschließende vollständige gehostete Lauf sind weiterhin offen. Die Anwendung wurde dafür nicht umgebaut.

### Getrennte Geräte-Diagnose bestanden; vollständige Abnahme noch offen

Die oben beschriebenen getrennten echten Geräteabläufe wurden anschließend auf Diagnosecommit `abf4513b7d43919d974e36676fed1b471f3580ab` tatsächlich gehostet geprüft: Lauf `40177250252` bestand mit **43 Tests**, einschließlich echter Bootstrap-Abhängigkeiten, aller drei sechsten Tastaturtreffer/ID-Ziele und der vollständigen ausgewählten Belegeingangs-Vorprüfungsfälle. Quellstand und Geräteabläufe wurden unabhängig statisch geprüft; lokale Typ-/Lint-/Diff-Prüfungen bestanden. Die davor blockierte Diagnoseveröffentlichung wurde erst nach einer erneuten ausdrücklichen Freigabe ausgeführt, ohne Umgehung.

Dies ist bewusst **nur fokussierte Diagnose, keine vollständige Abnahme**. Der bestätigte Geräte-Teststand wird jetzt im begrenzten PR-#145-Kandidaten veröffentlicht; vollständige CI und der unveränderte gesamte Browserlauf einschließlich aller 212 zulässigen Bilder/Verlustfreiheitsnachweise sowie tatsächliche Bildkontrolle des endgültigen Kandidaten bleiben bis zu deren Ergebnis offen. Kein Merge, Deployment oder Ticket-Abschluss.
