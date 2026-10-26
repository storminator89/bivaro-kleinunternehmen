# #43 — Eingangsbelege nach Rechnungsdatum finden

Stand: 26.10.2026. Lokale technische Teilumsetzung, **nicht veröffentlicht oder
abgenommen**. #43 bleibt offen; dieses Paket schließt nicht die gesamte mobile
Inbox-Roadmap ab.

## Tatsächlich neuer Umfang

Die vorhandene Inbox erhält einen ausdrücklich anzuwendenden, rein lesenden
Rechnungsdatumbereich mit offenen oder beidseitigen, einschließlich geltenden
Kalendertagen. Eine getrennte Auswahl findet ausschließlich Belege **ohne
ausgelesenes Rechnungsdatum**. Ohne Datumsfilter bleiben diese Belege enthalten.

Maßgeblich ist ausschließlich `PurchaseDocument.invoiceDate`. Uploaddatum,
gespeicherter Prüfentwurf und manuell bestätigter Foto-Snapshot ersetzen dieses
Feld nicht. Dies wird unmittelbar am Filter erklärt. Das Paket ändert keine
Quell-, Entwurfs-, Freigabe- oder Buchungswerte und fügt keine Buchungsmöglichkeit
hinzu. Insbesondere bleibt ein Foto mit Entwurfsdatum im Bereichsfilter außen
vor, solange kein ausgelesenes Quelldatum vorliegt.

Filterparameter: `invoiceDateFrom`, `invoiceDateTo` und
`invoiceDateMissing=only`. Alle Datumswerte sind strikte Geschäftskalendertage
von `0001-01-01` bis `9999-12-31`; ungültige Tage, umgekehrte Bereiche,
Mehrfachparameter und die widersprüchliche Kombination aus Bereich/fehlendem
Datum werden serverseitig abgewiesen. Die obere Grenze ist UTC-Tagesende,
ohne lokale Zeitzonenumrechnung oder Überlauf ins Jahr 10000.

Die bestehende Owner-Bedingung bleibt sowohl im normalen Prisma-Filter als
auch in beiden gebundenen SQL-Abfragen der Befehlspaletten-Listenfortsetzung
erhalten. Datum und Status/Aufgabenfilter wirken **vor** Zählung und Pagination;
Seitenlimits und begrenzte Metadatenprojektion bleiben unverändert. Der private
Palettensuchtext bleibt ausschließlich im JSON-Body und wird nicht in eine URL
oder Browserdauerablage verschoben.

Die Oberfläche verwendet die vorhandene Navigationsvorprüfung und
Query-Intent-Komposition. Anwenden/Zurücksetzen entfernt Seite und offene
Detailauswahl, nicht Suche, Prüfstatus oder Aufgabenfilter. Öffnen/Schließen von
Details und Browsernavigation behalten die akzeptierten Datumsparameter.

## Bewusst nicht implementiert

Eine zunächst erwogene PDF-Originalvorschau wurde **nicht** umgesetzt.
Die unveränderte Eingangsoriginalroute liefert ausdrücklich Attachment,
Sandbox-CSP und `X-Frame-Options: DENY`. Dieses Paket entfernt oder umgeht diese
Vorgaben nicht über eine Blob-/Iframe-Konvertierung. Es gibt keinen neuen
Renderer, Dienst, Endpunkt, öffentlichen Dateilink oder automatischen Viewer.
Foto-Vorschau und bisheriger Originaldownload bleiben unverändert.

Keine Schema-/Migrations-, Dependency-/Lockfile-, Auth-/Rollen-, Security-/CSP-,
Hosting-, Workflow- oder Finanzschreibänderung.

## Tatsächlich ausgeführte lokale Prüfungen

- 51 reine bzw. vollständig gemockte Fälle in fünf Dateien bestanden:
  Kalenderparser einschließlich Randjahre/Schalttage, widersprüchliche Filter,
  body-only Listenvertrag, Query-/Navigations-Intents, kontrollierte
  Komponenteninteraktionen sowie explizit gemockte Prisma-/SQL-Aufrufe.
- Vollständige TypeScript-Prüfung ohne Emit und inkrementelle Ausgabe bestanden.
  Wiederverwendet wurden die vorhandenen generierten Routentypen des
  sourcegleichen main-Checkpoints und die kanonischen `bivaro54/node_modules`;
  keine Dependency- oder Buildkopie.
- ESLint der betroffenen Quell-/Testdateien ohne Warnungen und Diff-Prüfung
  bestanden. Neue Akzeptanzquellen werden vor Handoff nochmals geprüft.

Prüfhistorie: Zunächst wurden ausschließlich neue Fixture-Typfehler anhand der
tatsächlichen zusammengesetzten Schema-Schlüssel korrigiert; die folgende
vollständige Typprüfung bestand. Nach Root-Review wurde nur der verfasste
Browsernachweis um die echte Palettenleseroute und abgeschlossene echte
Session-Bodies ergänzt. Dessen vollständige Typprüfung endete einmal mit
Exit 137 ohne TypeScript-Diagnose; die Ursache ist nicht nachgewiesen.
Nach Freigabe der exklusiven Prüflane bestand genau eine ressourcenkoordinierte
vollständige Typprüfung desselben finalen Stands mit Exit 0 ohne Diagnosen.
Der fehlgeschlagene Versuch bleibt dokumentiert und wird nicht als OOM
umgedeutet. Scoped ESLint bestand auch auf diesem Stand; weder Testscope noch
Konfiguration wurden dafür gelockert.

**Nicht ausgeführt:** echte Datenbank-, API-, Browser-, Upload-, PDF- oder
Finanzfunktionstests; kein neuer lokaler Produktionsbuild und kein neuer
GitHub-Lauf. Mocknachweise sind weder SQL-Laufzeit- noch Browserabnahme.

## Verfasste, noch ungestartete Akzeptanz

`lib/__tests__/incoming-invoice-date-fixture.test.ts` nutzt ausschließlich den
vorhandenen Fresh-Temporary-SQLite-Helfer. Synthetischer Owner/Fremdowner,
inklusive Randtage, Tage außerhalb des Bereichs und NULL mit irreführendem
Draft-/Uploaddatum prüfen echte Count/Page-Resultate in normaler und
Palettenroute, Task-Konjuktion, 400-/401-Grenzen und unveränderte vollständige
Quell-/Account-/Finanz-/Outbox-/Audit-Snapshots der beiden Fixture-Owner.

`e2e/incoming-invoice-date-filter.spec.ts` ist zusätzlich auf GitHub Actions,
Loopback und die exakte frische Runner-Datenbank begrenzt. Der vorhandene
Login/Upload und synthetische UBL-Originale erzeugen die Fixtures; danach
blockiert ein all-route Same-Origin-Guard sämtliche UI-Nichtleseanfragen außer
den beiden ausdrücklich benannten, JSON-/Bodylimit-/Vertrag-geprüften
Palettenleserouten. Externe Requests sowie unbekannte POSTs einschließlich
Auth-Diagnosebeacons scheitern; begrenzte Auth-Diagnosecodes werden zusätzlich
auf unerwartete Meldungen geprüft. Ein synchron am Ziel-Dokument erfasster
echter Session-GET muss bei Login, Navigation, Reload und Back mit abgeschlossenem
Body die tatsächliche Fixture-ID/-Rolle/-Sessiongeneration bestätigen, bevor
weiter navigiert wird. Kein erfundener Versionswert oder Sessionersatz.
Geplant sind 360px, Tastatur-Anwenden,
inklusive Grenzen, NULL/Draft-Kontrast, Inlinefehler/Fokus, Detail/Escape-Fokus,
Reload/Back, Reset, echte Palettenfortsetzung und volle Nichtmutations-Snapshots.
Keine erfundene Sessionversion oder echte Anbieter-/Geschäftsdaten.

Beide Dateien wurden nur verfasst und statisch typgeprüft, nicht ausgeführt.
Erforderlich bleiben unabhängige Quellprüfung und Root-Freigabe vor einem
Entwicklungs-PR, vollständige Hosted-Gates für den exakten Kandidaten und
tatsächliche UI-/Mobile-/Dark-/Tastatur-Sichtprüfung. Keine bestehende Capture-
Allowlist, Bildanzahl oder Assertion wurde geändert. Neue visuelle Nachweise
sind vor deren Veröffentlichung separat mit dem bestehenden Artefaktvertrag
abzugleichen; hier wird keine Bildabnahme behauptet.

## Risikobasierte mobile UX-Korrektur nach dem ersten Draft-Lauf

Der erste veröffentlichte Kandidat `4e554a12` wurde in der vollständigen
Hosted-Suite tatsächlich geprüft: CI mit 4.576 bestandenen Fällen und 20
vorhandenen Skips, einschließlich aller acht neuen echten Datenbank-/API-Fälle,
vollständige Lint-/Typprüfung, Security und normaler Produktionsbuild bestanden.
Native PDF-A-/Containerprüfungen bestanden ebenfalls. Der Browserlauf
`40297603399` scheiterte mit **211 bestanden / 2 fehlgeschlagen**: Die bestehenden
360-/390px-Listenfortsetzungen konnten den echten ersten Eingangsbeleg bei
fokussiertem Suchhinweis nicht mehr im Viewport sehen. Das dauerhaft geöffnete
neue Datumsformular hatte die Liste nach unten verschoben. Die fehlende
Pflicht-Bildpartition und der ausgelassene nachgelagerte PDF-Rendergate bleiben
fehlgeschlagen, nicht nachträglich als abgenommen eingeordnet.

Die tatsächliche UX-Korrektur verwendet eine native Tastatur-Disclosure:
inaktiv zunächst geschlossen, bei akzeptierten aktiven oder fehlerhaften
Datumsfiltern geöffnet, mit verständlicher Zusammenfassung. Benutzerseitiges
Schließen bleibt bei unveränderten Filtern trotz Listen-/Detail-Refresh erhalten.
Zurücksetzen fokussiert die weiterhin sichtbare Zusammenfassung. Input-IDs,
Owner-/Navigationsguards, Backendfilter und sämtliche bestehenden
Viewport-Assertions bleiben unverändert; kein erzwungenes Testscrollen und
keine schwächere Behauptung.

Für diese eng begrenzte Korrektur gilt die anschließend ausdrücklich reduzierte,
risikobasierte Nutzerfreigabe: **55 reine SSR-/Mock-/Vertragsfälle bestanden**,
fokussierte Typ- und Lintprüfung statt erneutem vollständigem Browser-/Bildlauf.
Die eigene mobile Kernreise ist für eine gegebenenfalls notwendige fokussierte
Hosted-Prüfung angepasst; sie öffnet den Filter ausdrücklich per Tastatur und
prüft Schließen/Refresh sowie Reset-Fokus. Dies ist noch kein neuer
Browser-Erfolgsnachweis. Keine zusätzlichen Screenshot-Allowlists, Bildpflichten
oder 256-/258-Bildnachweise werden für diese Korrektur eingeführt.
