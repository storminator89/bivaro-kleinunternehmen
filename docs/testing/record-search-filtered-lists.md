# GitHub #102: gefilterte Listenfortsetzung

Stand: 25.10.2026. Basis `c805e38c519f9d907c01af13430ce3d5926ac702`.
Runtime lokal implementiert und unabhängig statisch geprüft bis `08ee6a02`;
keine abgeschlossene Funktionsabnahme oder Ticket-Schließung behauptet.
Die Nutzerfreigabe vom 25.10.2026, 16:48:45 UTC erlaubt jetzt einen Entwurfs-PR
mit vollständiger gehosteter GitHub-CI und Browser-/PDF-Abnahme. Merge und
Deployment sind nicht freigegeben; #148-Runtime bleibt separat.
Die bereits gelieferte begrenzte Palettensuche einschließlich Vor-/Zurückblättern
bleibt bestehen; dieses Paket ergänzt ausschließlich ihre Listenfortsetzung.

## Vertrag

- „Passende Liste öffnen“ übergibt den aktuellen getrimmten Suchtext erst im
  tatsächlich ausgeführten, bestehenden Review-Navigationscallback. „Bleiben“,
  überholte Aktionen und Sitzungswechsel beginnen keine Übergabe.
- Genau ein flüchtiger React-Context hält Typ/Suchtext/revisionsgebundene
  Übergabe. Keine URL-/Hash-/History-State-/Analytics-/Log-/Storage-Übergabe,
  kein externer Index und keine gespeicherte Suche. Weder bestehende Shell noch
  Review-/Session-/Historybesitzer werden mit einem neuen Key remountet.
- Der Filter gilt nur im vorhandenen passenden Kunden-, Rechnungs- oder
  Belegeingangsarbeitsbereich. Verlassen, angenommene native Historynavigation,
  Reload/Seitenwechsel, BFCache-Rückkehr und Authentifizierungsidentitätswechsel
  entsorgen ihn; Back/Forward rekonstruiert ihn nicht.
- Der sichtbare Hinweis benennt Suchtext und enge Suchfelder; „Suchfilter
  löschen“ ist eine ausdrückliche Aktion mit Fokusrückkehr. Der Hinweis erhält
  bei der Übergabe den Fokus. Gewöhnliche breitere Suchfelder werden während
  dieses Modus ausgeblendet, statt eine andere Suchsemantik vorzutäuschen.
- Die bestehenden Ziel-Detailprüfungen und der unveränderte Belegeingangs-
  Save/Discard/Stay-Vertrag bleiben maßgeblich. Das Löschen eines Suchfilters
  hinter einer schmutzigen Belegprüfung ist ebenfalls kooperativ vorgeprüft.

## Lesende Servergrenze

Drei vorhandenen Listen zugeordnete, same-origin geschützte POST-Reads erhalten
Suchtext ausschließlich im begrenzten JSON-Body und liefern `private, no-store`:

| Endpunkt | Identische Paletten-Suchfelder | Ergebnis |
|---|---|---|
| `/api/customers/search` | eigener `Customer.name` | bestehende eigene Kunden-Arrayprojektion |
| `/api/invoices/search` | eigene `INVOICE`/`CREDIT_NOTE`, nur `invoiceNumber` | bestehende paginierte Rechnungsprojektion mit unveränderten Zahlungsledger-/Capabilityprüfungen |
| `/api/purchase-documents/search` | eigene `invoiceNumber` oder `originalFileName` | bestehende paginierte Belegeingangsprojektion |

Ein gemeinsamer gebundener SQL-Prädikatsvertrag verwendet SQLite
`instr(lower(field), lower(query))`. Prozent, Unterstrich und Backslash bleiben
literale Zeichen; SQLite faltet nur ASCII-Groß-/Kleinschreibung, Unicode bleibt
literal. Kontaktfelder, private Notizen, Lieferanten-/Prüfentwürfe,
Ausgangsdateinamen, Angebote und andere Ausgangstypen erweitern die Suche nicht.

Die vollständige Liste ist keine Wiederholung der maximal 100 Palettentreffer:
gewöhnliche Listenpagination setzt fort. Vorhandene Grenzen bleiben bestehen
(Rechnungsquellenmaximum 10.000, Belegeingang höchstens 50 Zeilen pro Seite und
100.000 zulässige Seiten, vorhandenes unpaginiertes Kundenarray). Zu große
Auswahl verlangt Eingrenzung statt stiller Vollständigkeitsbehauptung.

Rechnungen verwenden denselben extrahierten read-only GET-Projektions-/Ledgerpfad.
Der zusätzliche Clientquery-Key enthält nur eine opake Revision, niemals den
Suchtext; `gcTime: 0` und AbortSignal begrenzen die Lebensdauer. Bestehender
`dashboard/invoices/list`-Prefix und alle bisherigen Rechnungs-/Zahlungs-/
Summary-/Asset-/Jahresinvalidierungen bleiben wirksam. Kein Finanzschreibweg,
Schema, Backup, Finanz-DTO oder externer Anbieter geändert.

## Nachweise und offene Abnahme

Verfasst, **nicht lokal ausgeführt**:

- `filtered-list-contract.test.ts`: strikte Typ-/Schlüssel-/Body-/Seitengrenzen.
- `filtered-list-search.test.ts`: echte isolierte Hosted-Testdaten für
  Mandantentrennung, Literal-/Unicodeparität, ausgeschlossene Suchfelder/Typen,
  bestehende Ledger-/Source-DTOs, Fortsetzung über die Palettengrenze,
  Status-/Aufgabenfilter, unveränderte Datensätze/Audits/Finanzen und sichere
  Auth-/Origin-/Fehler-/Cachegrenzen.
- `record-list-handoff.test.ts`: erlaubte Zielbereiche, Termgrenzen, nur
  abortierbare POST-Bodyübertragung mit Zahlungsjournal-Vertrag 3.
- `record-list-provider-lifecycle.test.ts`: gleiches Listen-Ziel, überholtes
  Fremdziel, explizites Löschen, Popstate/Pagehide/BFCache und synchrones
  Verbergen bei Konto-/Rollen-/Sessionversionswechsel oder Logout ohne
  Shell-Remount/Historyänderung.
- `invoice-detail-session-selection.test.ts`: synchrones Entfernen der
  ausgewählten Rechnungsdetail-DTO bei verifiziertem Identitätswechsel,
  normaler funktionaler Setter, same-owner Expiryrefresh und veraltete Aktionen.
- `record-detail-focus.test.ts`: verbundene Zeilenfokusrückkehr, kein Fokus auf
  abgehängte Ownerzeilen und kein Übernehmen eines neueren Controls/Choosers.
  Der Helper nutzt die bereits vorhandenen Live-/Sichtbarkeits-/Disabled-/
  Inertprüfungen des etablierten Dialog-Opener-Vertrags.
- Bestehender Paletten-Navigationsvertrag um accepted-only/stay/superseded-
  Übergabe ergänzt; einziges bestehendes E2E-Label auf die echte neue Aktion
  umgestellt, keine Assertions entfernt oder gelockert. Die bestehende
  Dashboard-Unitisolation mockt nur den neu extrahierten Selection-Hook; dessen
  tatsächlicher Vertrag hat eigenständige neue Abdeckung.
- `e2e/record-search-filtered-lists.spec.ts`: zusätzliche gehostete echte
  Tastatur-/Listen-/Detail-/Clear-/History-/Privacy-/Fehler-/Stale-/Session-
  Abläufe bei 1440/360/390 px. Der Ownerwechselfall primt ausdrücklich den
  gewöhnlichen Owner-Invoicequery und hält nach echter Sessionersetzung den
  Foreign-GET: echte alte ID/Nummer müssen bereits vor dessen Antwort fehlen;
  danach muss der neue eigene Datensatz erscheinen. Ein zusätzlicher Fall prüft echten
  Kontowechsel bei bereits geöffneten Rechnungsdetails, deren Entfernung vor
  Foreign-GET-Antwort sowie erneutes Öffnen/Schließen der richtigen neuen
  Details mit Fokusrückkehr. Drei weitere Fälle prüfen nach parallelem
  Datenwechsel leere passende Listen samt weiterhin sichtbarem Filter und
  bewusstem Löschen, ohne irreführende Erstkunden-Anlegebehauptung. Insgesamt
  21 neue parametrisierte Hosted-Fälle; am lokalen Vorbereitungsstand wurde
  keine funktionale Ausführung behauptet. Keine lokalen Browser-/API-/Unit-/
  Funktionstests, Testserver, Fixture-Datenbanken oder Migrationen gestartet.
  Neun neue Pflichtbilder der gefilterten Listen bei 1440/360/390 px werden
  in einer zusätzlichen begrenzten Partition abgelegt. Ein bildloser1920px-
  Regressionsfall prüft außerdem, dass der Filterhinweis beide Gridspalten
  überspannt und die Rechnungsliste nicht in die schmale Werkzeugspalte rutscht; sämtliche bestehenden
  235 Bildnamen, Pfad-/Readgrenzen und Verlustfreiheitsnachweise bleiben erhalten.

Unabhängiger statischer Review der 20 Runtime-Dateien `92acc87`, des engen
Dependency-Fixes `1829b04` und der privaten Fehlerabbildung `6241900`: keine
konkreten P1/P2 gefunden. Der #148-Owner prüfte zusätzlich den exakt begrenzten
Invoicefallback-Hunk `5fd6e5e4`: Session-keyed Normalquery, GC0 und aktuelle
Querydaten verhindern den statisch identifizierten Altmandanten-Fallback;
kein Laufzeit-Leak wird als beobachtet behauptet. Derselbe Owner prüfte
anschließend den exakt begrenzten Detail-Selection-Hook `cbbc916` (nur ein
Import/eine Statezeile im Dashboard) ohne konkrete P1/P2. Der abschließende
Fokusdelta `cbbc916..8827ea5` wurde ebenso ohne konkrete P1/P2 gelesen und
verwendet bestehende Live-Opener-Prüfungen statt eines neuen konkurrierenden
Fokusbesitzers. Dies ersetzt keine
funktionale Abnahme. Lokale ESLint- und TypeScript-Prüfung nach Runtimefix
bestanden; der erste ungedrosselte TypeScriptprozess wurde ohne Diagnose mit
Exit 137 beendet, der gedeckelte Wiederanlauf bestand. Der gewöhnliche Build bestand Präbuild und Turbopack-Kompilierung
(39,2 s), wurde in seiner integrierten TypeScriptphase aber mit Exit137/Killed
beendet. Kein erfolgreicher Gesamtbuild und kein Nachbuild behauptet; kein
weiterer lokaler Buildretry oder Typ-/PDFguard-Bypass. Abschließendes separates
TypeScript und Full ESLint am finalen Quellstand bestanden; tatsächliche
Funktions-/Hosted-Nachweise bleiben offen.

**Jetzt freigegeben, Ergebnis noch offen:** Entwurfs-PR und vollständige
gehostete GitHub-CI einschließlich Browser-/PDF-Abnahme am exakten Kandidaten.
Lokale Funktionstests bleiben untersagt. Die frühere Sites-spezifische
Abnahmeformulierung war irrtümlich: die ForgeCommunity-Regel gilt nicht für
Bivaro; kein Bivaro-Sites-Deployment wird vorausgesetzt oder ausgeführt.
Echte Desktop-/Mobilebilder kontrollieren und sämtliche bestehenden
ungeschwächten Regressionsgates belegen. Endergebnisse werden im Entwurfs-PR
mit exaktem Head/Tree und Runlinks dokumentiert, ohne neue reine
Dokumentations-Commit-Schleife. Bis dahin bleibt GitHub #102 offen.
Kein Merge, Deployment oder Ticket-Abschluss durch dieses Paket.
