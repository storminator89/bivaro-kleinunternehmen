**Prüfung auf Bugs, Sicherheitslücken und Performanceprobleme — 18.09.2026**

Geprüft wurde der aktuelle Arbeitsstand einschließlich der bereits vorhandenen uncommitteten Änderungen. Anwendungscode und vorhandene Änderungen wurden nicht bearbeitet. Dieser Bericht ist das einzige neu hinzugefügte Repository-Dokument.

Die Prüfung umfasst Authentifizierung, Benutzerverwaltung, Mandantentrennung, Dateioperationen, Backup/Restore, Rechnungen, Angebote, Einnahmen/Ausgaben, wiederkehrende Ausgaben, Kassenbuch, Dashboard, EÜR-Export, Prisma-Schema und Produktionsabhängigkeiten. Es handelt sich um eine gezielte Codeprüfung mit isolierten Laufzeitnachweisen, nicht um einen vollständigen Penetrationstest der Produktionsinstallation oder eine steuerrechtliche Zertifizierung.

**Prüfergebnisse und Aussagekraft**

| Prüfung | Ergebnis |
| --- | --- |
| `npm run test` | 187 Tests in 10 Dateien bestanden |
| `npm run lint` | Bestanden, keine ESLint-Meldungen |
| `npm run build` | Bestanden, einschließlich TypeScript-Prüfung |
| `npm run test:e2e` | Vor dem Browserstart abgebrochen: Prisma `Schema engine error` bei der Testdatenbankvorbereitung |
| `npm audit --omit=dev` | 8 betroffene Pakete: 1 kritisch, 3 hoch, 4 mittel; transitive Meldungen enthalten Überschneidungen |
| Isolierte Laufzeitprüfung | Reale Route-Handler und Prisma/SQLite; synthetische Benutzer und Dateien unter `/tmp`; Sitzungsauflösung und Audit-Schreibzugriffe ersetzt |
| KPI-Messung | 62 Prisma-SQL-Abfragen für einen erfolgreichen Aufruf |
| SQLite-Abfrageplan | Einnahmenliste: `SCAN Income` und temporärer B-Baum zum Sortieren |

Die isolierten Prüfungen belegen das Verhalten der Handler nach erfolgreicher Authentifizierung. Sie ersetzen keinen HTTP-/Browser-Test der gesamten Authentifizierungskette. Produktiv- und Entwicklungsdaten wurden für die Reproduktionen nicht verwendet. Die Ursache des E2E-Startfehlers wurde nicht abschließend geklärt; lokal läuft Node 24.15.0, das Dockerfile verwendet Node 22.

Prioritäten: **P0** unmittelbar schließen; **P1** im nächsten Behebungspaket, vor weiterer produktiver Nutzung der betroffenen Funktion; **P2** danach gezielt beheben und messen. Die Priorität bezieht sich auf dieses Projekt und ist kein CVSS-Wert.

**Befunde mit konkretem Behebungsziel**

1. **S01 — P0: Pfadmanipulation beim Speichern von Angeboten. Laufzeitbestätigt.**

   Fundstelle: [Angebots-POST](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/quotes/route.ts:78). `fileName` wird in einen Pfad eingesetzt und anschließend ohne Prüfung mit `writeFileSync` geschrieben. Ein vorangestellter Zeitstempel verhindert `../`-Traversal nicht. Im isolierten Test wurde eine bestehende Markierungsdatei außerhalb von `data/uploads` überschrieben; der Handler antwortete mit HTTP 200. Voraussetzung ist eine gültige Benutzersitzung, die Reichweite hängt von den Dateirechten des Serverprozesses ab. Eine Codeausführung wurde nicht getestet.

   Behebung: Speichername ausschließlich serverseitig mit UUID und erlaubter Erweiterung erzeugen; Originalname nur als Metadatum führen. Pfadprüfung zentralisieren, Lesen/Schreiben/Löschen darüber abwickeln. Beim [Angebots-DELETE](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/quotes/route.ts:171) ebenfalls prüfen: Restore kann ungeprüfte `storedFileName`-Werte persistieren, die später in `unlinkSync` gelangen. Dieser Löschpfad wurde statisch nachvollzogen, nicht gegen reale Dateien ausgeführt.

   Abnahme: Traversal mit Unix-/Windows-Trennzeichen, absoluten Pfaden und Restore-Metadaten wird abgewiesen; keine Datei außerhalb des vorgesehenen Mandantenordners wird verändert.

2. **S02 — P1: Fremde Dateien durch frei wählbare Dateireferenz lesbar. Laufzeitbestätigt.**

   Fundstellen: [Rechnungs-POST](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/invoices/route.ts:24), [Download](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/invoices/download/route.ts:63), [gemeinsamer Dateispeicher](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/lib/upload-path.ts:60). Ein Benutzer kann einen eigenen Rechnungsdatensatz anlegen, dessen Speichername auf eine vorhandene fremde Datei zeigt. Der Download prüft den Eigentümer des neuen Datensatzes, aber nicht den Eigentümer der Datei. Im Test erhielt Benutzer A den Beleginhalt von B mit HTTP 200. Dafür muss der fremde Speichername bekannt sein; blindes Erraten zufälliger UUIDs wurde nicht behauptet.

   Behebung: Upload-Metadaten mit Eigentümer und undurchsichtiger Datei-ID speichern; nur eigene Datei-IDs verbinden. Mandantenbezogene Speicherverzeichnisse und neue Dateinamen beim Restore verwenden. Vorhandene Dateien zunächst anhand ihrer Datenbankreferenzen zuordnen, Mehrfachreferenzen gesondert behandeln.

   Abnahme: A kann auch bei Kenntnis sämtlicher IDs und Dateinamen keinen Beleg von B herunterladen, referenzieren, exportieren oder löschen.

3. **S03 — P1: Fehlende Eigentumsprüfung bei Fremdschlüsseln. Laufzeitbestätigt.**

   Fundstellen: [Einnahmen-POST](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/incomes/route.ts:20), [Einnahmen-PUT](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/incomes/route.ts:141), [Angebote](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/quotes/route.ts:95), [Kassenbuch-Verknüpfungen](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/cashbook/transactions/route.ts:222). Die ID eines Kunden oder Belegs wird übernommen, ohne dessen `userId` zu prüfen. Im Test wurde ein fremder Kunde verbunden und sein Name anschließend in der Einnahmenliste ausgegeben. Angebote laden sogar das ganze Kundenobjekt. Die externe Einnahmen-API prüft den Kunden bereits; die interne API verhält sich anders.

   Behebung: Jede Referenz nach `(id, userId)` prüfen, einschließlich `expenseId`, `incomeId`, Kunden, Ursprungsbelegen und importierten Beziehungen. Gemeinsamen Service für interne und externe APIs verwenden.

   Abnahme: Zwei-Mandanten-Tests für jede schreibbare Relation; keine fremden Daten im Ergebnis und keine blockierenden fremden Verknüpfungen.

4. **S04 — P1: Rollenänderung und Passwortwechsel widerrufen bestehende Sitzungen nicht. Callback-Verhalten bestätigt.**

   Fundstelle: [JWT-/Session-Callbacks](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/lib/auth.ts:119). Die Rolle wird nur bei der Anmeldung ins JWT geschrieben und anschließend unverändert in die Sitzung kopiert. Im isolierten Callback-Test blieb die Tokenrolle `ADMIN`, während der Datenbankbenutzer `USER` war. Admin-Endpunkte vertrauen der Sitzungsrolle. Die nominelle Sitzungsdauer beträgt 24 Stunden; eine feste maximale Restdauer sollte wegen Token-Erneuerung nicht als Widerrufsmechanismus betrachtet werden.

   Behebung: Benutzerexistenz, aktuelle Rolle und eine `sessionVersion` serverseitig prüfen. Passwortwechsel, Kontosperre und relevante Rollenänderungen erhöhen diese Version. Rollen-Whitelist und einheitliche Passwortvalidierung auch in der Benutzerverwaltung einführen; Admin-Änderungen auditieren.

   Abnahme: Bereits ausgestellte Cookies verlieren nach Herabstufung, Löschung oder Passwortreset sofort die entsprechenden Berechtigungen. Letzten Administrator vor versehentlicher Herabstufung schützen.

5. **S05 — P1: Mehrere erste Administratoren bei paralleler Registrierung. Laufzeitbestätigt.**

   Fundstelle: [Registrierung](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/auth/register/route.ts:77). Benutzeranzahl, Passwort-Hashing, Benutzeranlage und Registrierungssperre sind getrennte Operationen. Auf einer leeren isolierten Datenbank ergaben zwei parallele Anfragen zweimal HTTP 201 und zweimal `ADMIN`.

   Behebung: Bootstrap als atomare, einmalige Operation mit eindeutigem Singleton-Datensatz modellieren. Passwort-Hash vor der kurzen Transaktion berechnen; innerhalb der Transaktion Bootstrap-Berechtigung erneut prüfen und Registrierungseinstellung setzen. Optional ein einmaliges Setup-Token für öffentlich erreichbare Neuinstallationen.

   Abnahme: Auch bei mindestens 20 parallelen Erstanmeldungen entsteht genau ein Administrator und ein eindeutiger AppSettings-Datensatz.

6. **S06 — P1, bei passender Exposition P0: Verwundbare Produktionsabhängigkeiten. Audit bestätigt; Ausnutzbarkeit installationsabhängig.**

   Installiert sind unter anderem Next.js 16.2.12, sharp 0.35.3, Nodemailer 9.0.3, PostCSS 8.5.18 und nanoid 3.3.16. [package.json](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/package.json) pinnt sharp und PostCSS zusätzlich über Overrides.

   Die offiziellen Next.js-Mitteilungen nennen 16.3.3 als korrigierte 16er-Version für die [AVIF-Bildoptimierung](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4) und den [Windows-spezifischen Angriff](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36). Der Windows-Befund trifft nicht auf den geprüften Linux-Host zu. Die Erreichbarkeit manipulierter AVIF-Daten in der konkreten Installation ist gesondert zu prüfen. Für Nodemailer ist unter anderem ein [CPU-/DoS-Problem im Adressparser](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-2x7j-588g-ccc2) gemeldet; dieser einzelne Befund ist ab 9.1.0 korrigiert, während der Audit weitere Meldungen enthält.

   Behebung: Unterstützte korrigierte Versionen und kompatibles `eslint-config-next` auswählen, Overrides überprüfen, Lockfile neu auflösen. Kein unkontrolliertes `npm audit fix --force`: Der Audit schlägt für next-auth teilweise einen ungeeigneten Major-Downgrade vor. Verbleibende transitive Meldungen einzeln auf tatsächliche Erreichbarkeit prüfen.

   Abnahme: Neuaufbau aus sauberem `npm ci`, Regressionstests für Anmeldung, Bildverarbeitung, PDF und E-Mail; jede verbleibende Audit-Meldung mit begründeter Entscheidung dokumentieren.

7. **D01 — P1: Restore kann Daten löschen und trotz fehlgeschlagenem Import Erfolg melden. Laufzeitbestätigt.**

   Fundstellen: [JSON-Restore](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/backup/restore/route.ts:23), [ZIP-Restore](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/backup/full/restore/route.ts:46). Nur die Löschphase ist transaktional. Importfehler werden anschließend pro Datensatz abgefangen. Eine vorhandene Ausgabe wurde im Test gelöscht; die fehlerhafte Ersatz-Ausgabe wurde übersprungen, trotzdem kamen HTTP 200 und `success: true` zurück.

   Zusätzlich gehen beim Restore Beziehungen von Kassenbuchtransaktionen zu Einnahmen/Ausgaben verloren. `0` beim Abzugsanteil wird durch `|| null` verändert; `validUntil` der Angebote wird nicht wiederhergestellt. Bestehende Audit-Logs werden im Überschreibmodus gelöscht.

   Behebung: Version, Typen, Werte, Referenzen und Dateien vollständig vorab validieren. Dateien in einen isolierten Staging-Bereich mit neuen IDs schreiben. Löschen und Einfügen der Daten in einer Transaktion ausführen; Dateiübernahme mit dokumentiertem Wiederanlauf-/Rollbackverfahren koordinieren. Vollständige ID-Mappings und Roundtrip-Vergleich einführen. Unveränderliche Wiederherstellungsprotokolle außerhalb des ersetzten Datenbestands erhalten.

   Abnahme: Fehler in jedem Importschritt lassen den bisherigen Bestand unverändert. Export → Restore erhält Werte, Beziehungen und Dateiinhalte; Teilimport wird niemals als vollständiger Erfolg ausgegeben.

8. **B01 — P1: Dashboard-Auswertungen berücksichtigen höchstens 100 Datensätze. Laufzeitbestätigt.**

   Fundstellen: [Daten-Hook](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/hooks/use-dashboard-data.ts:109), [API-Limit](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/incomes/route.ts:43), [Summenbildung](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/components/dashboard/dashboard-content.tsx:660). Der Hook fordert `pageSize=10000`, die API begrenzt auf 100. Bei 105 Testeinnahmen wurden genau 100 zurückgegeben. `incomesAll`/`expensesAll` werden trotzdem für EÜR-Anzeige, Diagramme, Kategorien und GWG verwendet.

   Behebung: Eigene serverseitige Aggregationen für den gewählten Zeitraum und eigene Abfragen für Filteroptionen und Anlagegüter. Listen bleiben paginiert. Das Limit einfach auf 10000 zu erhöhen wäre keine dauerhafte Lösung. Lade- und Fehlerzustände der Queries sichtbar machen, damit Ausfälle nicht als Nullsummen erscheinen.

   Abnahme: Identische Summen bei 99, 100, 101 und 10000 Einträgen; ältere Anlagen bleiben trotz vieler neuer Ausgaben enthalten.

9. **B02 — P1: Abweichende Berechnungen für Anzeige, EÜR-Export und Rechnungsstatus. Statisch bestätigt.**

   Fundstellen: [EÜR-Export](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/eur-export/route.ts:46), [AfA und Abzugsanteil im Dashboard](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/components/dashboard/dashboard-content.tsx:713), [Ausgaben-API](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/expenses/route.ts:110).

   Der Export lädt nur im Exportjahr angeschaffte Ausgaben; ältere noch laufende Abschreibungen fehlen dadurch. Im AfA-Zweig überschreibt er den zuvor berechneten Abzugsanteil. Das Dashboard behandelt `0 %` durch `|| 100` als `100 %`. Die unterjährige AfA kürzt das erste Jahr, lässt aber das entsprechende Restjahr aus: Bei Anschaffung im Juli und drei Jahren ergibt die implementierte Staffel nur 2,5 Jahresbeträge. Stornierte Rechnungen werden in der Dashboard-EÜR ausgeschlossen, im Export werden deren Einnahmen weiter summiert. Upload und Angebotskonvertierung erzeugen bereits bei DRAFT eine Einnahme; `PAID` setzt in der internen Rechnungs-API kein Zahlungsdatum.

   Behebung: Eine gemeinsame, getestete Berechnungsfunktion mit expliziter Datums-, Status-, Zahlungs- und Rundungssemantik für Anzeige und Export. `??` statt `||` bei zulässigen Nullwerten. Aktive Anlagen unabhängig vom Anschaffungsjahr laden. Zahlungsereignisse und Rechnungserstellung sauber trennen; die gewünschte Buchungssemantik vor Datenmigration festlegen.

   Abnahme: Anzeige und Export stimmen für dieselben Daten überein. Fälle: 0/50/100 Prozent, unterjährige Anschaffung, letztes AfA-Jahr, Jahreswechsel, offene/bezahlte/stornierte Rechnung und nachträgliche Korrektur. Keine pauschale Neubewertung vorhandener Zahlungsdaten ohne Migrationsregel.

10. **B03 — P1: Rechnungsnummern kollidieren zwischen Benutzern und ab Nummer 100. Teilweise laufzeitbestätigt.**

    Fundstellen: [Nummerngenerator](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/invoices/next-number/route.ts:12), [globaler Unique-Constraint](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/prisma/schema.prisma:80). Nummern werden pro Benutzer ermittelt, sind aber global eindeutig. Benutzer B kann damit nicht dieselbe erste Jahresnummer wie A verwenden. Die lexikografische Sortierung bevorzugt `2026-99` gegenüber `2026-100`; im Test wurde nach beiden vorhandenen Nummern erneut `2026-100` vorgeschlagen. Vorschlag und Speicherung reservieren außerdem keine Nummer atomar.

    Behebung: Nummernkreis fachlich festlegen; mindestens mandantenbezogene Eindeutigkeit und numerischen Zähler pro Mandant/Jahr/Belegart einführen. Nummer erst beim endgültigen Speichern atomar vergeben. Rechnungs-, Angebots-, Gutschrift- und Konvertierungswege gemeinsam umstellen; vorhandene Belegnummern unverändert lassen.

    Abnahme: 99 → 100 → 101; zwei Mandanten unabhängig; parallele Speicherung ohne Duplikate; verständlicher 409-Konflikt bei bewusst doppelter externer Nummer.

11. **B04 — P1: Wiederkehrende Ausgaben überspringen Monate und können doppelt entstehen. Datumsfehler laufzeitbestätigt.**

    Fundstelle: [Ausführung](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/recurring-expenses/execute/route.ts:8). `setMonth` wird vor dem Begrenzen des Monatstages aufgerufen. Der 31. Januar wird dadurch auf den 31. März fortgeschrieben; Februar entfällt. Ist `endDate` bereits vergangen, wird vor dem Nachholen deaktiviert, selbst wenn noch gültige frühere Termine fehlen. Anlage der Ausgaben und Fortschreiben von `nextExecution` sind nicht atomar; Parallelaufrufe oder ein Abbruch dazwischen können doppelte Buchungen erzeugen.

    Behebung: Zieljahr/-monat vom ersten Monatstag aus berechnen und Tag anschließend begrenzen. Bis `min(heute, endDate)` nachholen. Eindeutigen Ausführungsschlüssel `(recurringExpenseId, scheduledDate)` und Transaktion einführen; Nachholmenge begrenzen und fortsetzbar machen.

    Abnahme: 29./30./31. Tag, Februar und Schaltjahr, vergangenes Enddatum, zwei parallele Aufrufe, Abbruch und Wiederholung ohne Duplikate.

12. **B05 — P1: Kassenbestand wird nach Änderung des Anfangsbestands falsch angezeigt. Laufzeitbestätigt.**

    Fundstellen: [Kassenbuch-PUT](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/cashbook/route.ts:129), [Neuberechnung](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/cashbook/transactions/route.ts:13). Nach Änderung des Anfangsbestands von 100 auf 200 blieb der angezeigte Bestand bei einer Einnahme von 10 im Test bei 110 statt 210. Die Liste verwendet außerdem nur `date` zur Auswahl des letzten Saldos, während die Neuberechnung zusätzlich `createdAt` verwendet. Alle Salden werden nach jeder Mutation außerhalb einer gemeinsamen Transaktion durchlaufen und ggf. einzeln geschrieben.

    Behebung: Änderung des Anfangsbestands mit Buchungen sperren oder atomar neu berechnen. Einheitliche stabile Reihenfolge `(date, createdAt, id)` verwenden; Paralleländerungen serialisieren. Nur betroffenen Abschnitt neu berechnen bzw. Saldenmodell vereinfachen. Validierung von PUT auf das Niveau von POST bringen.

    Abnahme: Anfangsbestandsänderung, mehrere Buchungen am selben Tag, Rückdatierung, Löschung und Parallelzugriff ergeben denselben Bestand wie eine unabhängige Neusummierung.

13. **B06 — P2: Angebotskonvertierung verwendet weiter das Angebots-PDF. Statisch bestätigt.**

    Fundstelle: [Konvertierungsroute](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/quotes/[id]/convert/route.ts:53). Die Route vergibt eine neue Rechnungsnummer, übernimmt aber Datei und `parsedData` des Angebots. Das Dokument passt deshalb nicht zum Rechnungsdatensatz. Angebotslöschung entfernt die gemeinsam genutzte Datei. Bereits akzeptierte Angebote können erneut konvertiert werden; mehrere Datenbankschritte sind nicht transaktional. Die aktuelle Dashboard-Oberfläche öffnet einen Editor zur Übernahme; der Befund betrifft ausdrücklich den weiterhin vorhandenen API-Endpunkt.

    Behebung: API und Editor auf einen gemeinsamen Konvertierungsdienst führen oder ungenutzte Route entfernen. Neue Rechnungsdatei und konsistente Metadaten erzeugen; Ursprungsangebot verknüpfen und Wiederholungen idempotent beantworten.

    Abnahme: PDF/XML und Datensatz haben dieselbe Nummer und Belegart; Angebotslöschung beschädigt keine Rechnung; doppelte Anfragen erzeugen keinen zweiten Beleg.

14. **P01 — P2: Zu viele KPI-Abfragen und fehlende passende Indizes. Gemessen.**

    Fundstellen: [KPI-Endpunkt](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/dashboard/kpis/route.ts:140), [Monatsschleife](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/dashboard/kpis/route.ts:206), [Schema](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/prisma/schema.prisma:43). Ein Aufruf erzeugt 62 SQL-Abfragen, darunter 48 Monatsaggregate. Für die Einnahmenliste zeigte SQLite einen vollständigen Tabellenscan und temporäres Sortieren. Expense, Income und Invoice haben keine auf die häufigen Benutzer-/Datumsfilter zugeschnittenen Indizes. Die KPI-Logik zählt außerdem bei offenen Rechnungen Angebote und Stornos mit und hat bei manchen Zeiträumen keine obere Grenze.

    Behebung: Zeiträume und Belegstatus zuerst mit B02 vereinheitlichen. Monatssummen gruppiert oder aus wenigen gezielt geladenen Spalten ermitteln. Indizes anhand tatsächlicher Abfragen hinzufügen, z. B. Income/Expense `(userId, date)` und Invoice `(userId, type, uploadedAt)`; Statusindizes nur bei nachgewiesenem Nutzen. Große `parsedData`/XML-Felder aus Listenantworten entfernen und separat laden. Im Hook nur aktive Tabs laden, Eingaben entprellen und Query-Abbruchsignale nutzen.

    Abnahme: 100/10000/100000 synthetische Datensätze; SQL-Anzahl, übertragene Bytes, p50/p95 und Prozessspeicher messen. Ziel: höchstens etwa 10 KPI-Abfragen und indexgestützte Listenabfragen. Latenzverbesserung erst nach vergleichbarer Vorher-/Nachher-Messung behaupten.

15. **S07 — P1/P2: Fehlende Ressourcenlimits bei Upload, ZIP und PDF-Konvertierung. Statisch bestätigt.**

    Fundstellen: [Rechnungsupload](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/invoices/upload/route.ts:89), [ZIP-Vorschau](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/backup/full/preview/route.ts:17), [ZIP-Restore](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/backup/full/restore/route.ts:19), [PDF-Konvertierung](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/app/api/pdfa3/route.ts:23). Diese Wege puffern Eingaben vollständig und haben keine eigenen verlässlichen Größen-/Entpacklimits. Synchrones Datei-I/O und ZIP-Verarbeitung belasten denselben Serverprozess. Ein authentifizierter Nutzer kann dadurch Speicher, CPU und Platte beanspruchen; ein Last-/DoS-Angriff wurde nicht ausgeführt. Externe Proxy-Limits wurden nicht verifiziert.

    Behebung: Grenzen am Eingang und während des Einlesens, pro Datei und pro Benutzer; ZIP-Eintragszahl, tatsächlich entpackte Bytes und Kompressionsverhältnis begrenzen. Parser-/Konvertierungsparallelität und Laufzeit beschränken. Asynchrones I/O, Staging-Cleanup und bei größeren Exporten Streaming/Jobverarbeitung einsetzen.

    Abnahme: Zu große oder stark komprimierte Testarchive werden mit kontrolliertem Fehler beendet; parallele Konvertierungen blockieren normale Leseanfragen nicht; keine verwaisten Dateien.

16. **B07 — P2: CORS-Preflight ignoriert konfigurierte Benutzer-Origin. Statisch bestätigt.**

    Fundstelle: [handleCors](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/lib/api-auth.ts:431). OPTIONS erhält keinen Request und erzeugt in Produktion einen leeren `Access-Control-Allow-Origin`. Die späteren benutzerspezifischen Header helfen dann nicht, weil der Browser die authentifizierte Anfrage bereits am Preflight stoppt.

    Behebung: Einheitliche, Request-bezogene Preflight-Strategie ohne erwarteten API-Key im OPTIONS-Request. Da die externe API explizite Bearer-Keys verwendet, Cookie-Credentials dort vermeiden; erlaubte Origins für Preflight und Antwort konsistent behandeln und `Vary: Origin` setzen.

    Abnahme: Browser-Integration mit freigegebener und nicht freigegebener Origin, einschließlich PUT/DELETE und fehlendem/ungültigem API-Key.

17. **S08 — P2: Unvollständige Änderungsprotokolle und Login-Limits. Statisch bestätigt.**

    In den geprüften `app/api/v1`-Mutationen fehlen die fachlichen `auditCreate`/`auditUpdate`/`auditDelete`-Einträge; `ApiLog` protokolliert lediglich den Zugriff. Die [Login-Limit-Map](/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen/lib/auth.ts:8) entfernt abgelaufene Einträge unbekannter E-Mail-Adressen nicht und begrenzt nur pro Adresse. Die Registrierungs-IP stammt ungeprüft aus Forwarding-Headern; ob diese überschreibbar sind, hängt vom vorgeschalteten Proxy ab.

    Behebung: Fachliches Audit in gemeinsamen Mutationsdiensten verankern. Begrenzten TTL-Speicher bzw. instanzübergreifenden Limiter nach Topologie wählen, Limits für IP und Konto kombinieren und Proxy-Vertrauen explizit konfigurieren. Bei API-Keys `lastUsedAt` nicht für jeden bereits zu limitierenden Request synchron schreiben.

    Abnahme: Gleiche fachliche Änderung erzeugt intern und extern denselben Audit-Typ; Sperren gelten über Instanzen hinweg; Speicher wächst bei vielen abgelaufenen Schlüsseln nicht unbegrenzt.

**Empfohlene Implementierungsreihenfolge**

Jede Zeile sollte ein eigenes überprüfbares Änderungspaket bilden. Die Tests werden zusammen mit dem jeweiligen Fix ergänzt, nicht erst am Ende.

| Reihenfolge | Paket und Ergebnis | Datenbank-/Bestandsauswirkung | Abhängigkeit |
| --- | --- | --- | --- |
| 0 | Reproduzierbare Prüfumgebung: E2E-Prisma-Fehler beheben, Node-Version mit CI/Docker abstimmen, isolierte Route-Tests übernehmen | Nur Testdatenbanken | Grundlage für alle Abnahmen; S01 nicht deswegen verzögern |
| 1 | S01 schließen: sichere Speicher- und Löschpfade für Angebote und Restore | Bestehende verdächtige Pfade erkennen und sperren; keine unkontrollierte Bereinigung | Sofort |
| 2 | S06: Abhängigkeiten und Overrides korrigieren, saubere Installation prüfen | Keine geplante Schemaänderung | Unabhängig von Fachlogik |
| 3 | S02/S03: Datei-Eigentum, Mandantenprüfungen und gemeinsame Validierung | Upload-Metadaten/Dateizuordnung migrieren; fremde Altverknüpfungen zunächst berichten | Sichere Pfade aus 1 |
| 4 | S04/S05: Sitzungswiderruf und atomare Erstregistrierung | `sessionVersion`, eindeutige AppSettings-/Bootstrap-Struktur; bestehende Cookies ggf. gezielt invalidieren | Gemeinsame Auth-Prüfung |
| 5 | D01 und S07: Restore vorab validieren, atomar importieren, Dateien stagen und Eingaben begrenzen | Neue Backup-Version/Migrationsregeln, vollständige ID-Mappings; Roundtrip vor produktiver Migration | Datei-Eigentum aus 3 |
| 6 | B03: Mandantenbezogene Nummernkreise und atomare Vergabe | Unique-Constraint und Zählertabelle; Zähler aus vorhandenen Nummern initialisieren | Validierung und Isolation aus 3 |
| 7 | B04/B05/B06: Wiederholbarkeit von Buchungen, Kassenbestand und Konvertierung | Ausführungsschlüssel, ggf. Angebotsreferenz; Altduplikate nur berichten, nicht automatisch löschen | Nummernvergabe aus 6 |
| 8 | B01/B02: Gemeinsame Berechnungen und vollständige Auswertungen | Zahlungs-/Datumsmodell nur mit festgelegter Bestandsmigration ändern; Beträge vorzugsweise als ganzzahlige Cent mit expliziter Rundung | Stabile Buchungslogik aus 7 |
| 9 | P01: Abfragen, Indizes, Listenprojektionen und Client-Ladeverhalten optimieren | Additive Indizes; gegen repräsentative Daten messen | Korrekte fachliche Filter aus 8 |
| 10 | B07/S08: CORS, konsistentes Audit und belastbare Rate-Limits | Audit-/TTL-Aufbewahrung und Proxy-Konfiguration festlegen | Gemeinsame Services aus 3–8 |
| 11 | Gesamtabnahme und Rollout | Wiederherstellbarer Snapshot aus DB und Dateien, Migrationsprobe und dokumentierter Rückweg | Alle Pakete |

S07-Eingangsgrößenlimits können als kleiner früher Fix bereits mit Paket 1–3 umgesetzt werden; umfangreiche Streaming-/Jobänderungen gehören in Paket 5 bzw. 9.

**Verbindliche Gesamtabnahme**

- Build, ESLint und bestehende Unit-Tests bestehen; der reguläre Playwright-Lauf ist wieder lauffähig.
- Route-Integrationstests verwenden mindestens zwei Mandanten und prüfen alle Referenz-, Datei- und Admin-Grenzen.
- Paralleltests decken Erstregistrierung, Nummernvergabe, wiederkehrende Ausgaben und Konvertierung ab.
- Restore besteht Roundtrip-, Fehler-Injektions- und Wiederanlauftests einschließlich Dateien und Beziehungen.
- Anzeige und Export stimmen bei mehr als 100 Buchungen, mehreren Jahren, 0-Prozent-Abzug, Abschreibungen und Stornos überein.
- Performance wird mit festen synthetischen Datensätzen, identischer Hardware und Warm-/Kaltläufen dokumentiert. Die bisherige Messung belegt SQL-Aufwand, noch keine Produktionslatenz.
- Vorhandene Daten werden zunächst auf widersprüchliche Verknüpfungen, Salden, Nummern und fehlende Dateien geprüft. Korrekturen an historischen Buchungen erfolgen nach expliziter Regel und mit Audit-Protokoll.

Als ergänzende Nachprüfung sinnvoll: tatsächlich vorhandene Legacy-Dateien in `public/uploads`, tatsächliche Reverse-Proxy-Limits/Headers, Geldpräzision durch Float-Felder und CSV-Formelauswertung bei extern gelieferten Texten. Diese Punkte sind hier keine vollständig nachgewiesenen Produktionslücken und sollten die bestätigten P0-/P1-Fixes nicht verdrängen.
