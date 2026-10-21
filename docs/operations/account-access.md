# Zugangshilfe und öffentlicher Angebotsstand

Technische Grundlage für BPR-021/BPR-022. Kein Nachweis eines erreichbaren
Supportdiensts, einer rechtlichen Freigabe oder einer produktiven Recoveryprobe.
Keine Zugangsdaten, Personen- oder Kundendaten in dieses Dokument aufnehmen.

## Aktueller Zustand und Grenzen

- `/login` → `/help/access` → `/login?callbackUrl=…` ist ein anonymer, rein
  informativer Weg. Es gibt dort keine Kontoexistenzabfrage und keine Mutation.
  Das sichere Workspace-Ziel bleibt erhalten; nur `tab`, `year`, `status` mit
  begrenzten alphanumerischen Werten bleiben als Query erhalten. Andere Queries
  und Fragmente werden bewusst entfernt, damit keine Diagnose-/Zugangsdaten
  weitergereicht werden. Externe Ziele, Protokolltricks und Anmeldeschleifen
  fallen auf `/dashboard` zurück.
- Credentials-Anmeldung, Rate-Limit, Rollen, NextAuth-JWT und Sessionversion
  bleiben unverändert. SMTP-Einstellungen sind **kein** Passwort-Resetdienst.
  Es gibt keinen E-Mail-Reset, MFA-Neueinrichtung, öffentlichen Recovery-Endpunkt,
  dedizierten „alle Sitzungen widerrufen“-Knopf oder dauerhaften Supportzugang.
- Derzeit sind Kontakt, Anbieter, Modell, Preis und rechtliche Unterlagen nicht
  bestätigt. Deshalb bleibt die Oberfläche ausdrücklich Konzept; sie bietet
  keinen Kauf, Vertragsschluss oder verbindlichen Pilotabschluss.

## Voraussetzungen für betreute Zugangshilfe (Owner-Gate G-SUPPORT)

Vor einer echten Wiederherstellung müssen Betreiberzuständigkeit, erreichbarer
Kontakt und ein unabhängiger Identitäts-/Berechtigungsprüfungsprozess freigegeben
sein. Name oder behauptete E-Mail-Adresse allein sind kein Nachweis. Einen
bereits vereinbarten, unabhängig bestätigten Kanal verwenden; keine neue Adresse
oder Nummer allein aus einer unbestätigten Hilfsanfrage übernehmen. Ergebnisse
sparsamer Prüfung und Freigabe mit Fallreferenz dokumentieren, nicht die
Identitätsdokumente oder Geheimnisse selbst. Bei Zweifel pausieren, ohne gegenüber
Unberechtigten zu bestätigen, ob ein bestimmtes Konto existiert.

Niemals nach bisherigen oder selbst gewählten neuen Passwörtern, Codes,
Sitzungscookies, API-Schlüsseln oder Kundenbackups fragen. Keine Rechnungen,
Datenbankexporte oder unbereinigten Screenshots für die Zugangshilfe sammeln.
Ein nötiges separates Identitätsverfahren und ein sicherer Umgang mit neu
vergebenen Zugangsdaten sind **nicht** durch diese Codegrundlage bereitgestellt;
fehlende Verfahren blockieren eine betreute echte Wiederherstellung. Es gibt
keinen eingebauten erzwungenen Erstwechsel und keinen eigenen Self-Service-
Passwortwechsel, auf den der Betreiber verweisen könnte.

## Vorhandene Administratorfunktion, kein neuer Recovery-Bypass

Nur ein bereits angemeldeter, berechtigter aktiver Administrator darf nach der
freigegebenen Prüfung die vorhandene Benutzerverwaltung `/users` benutzen:

1. Die richtige Installation und das unabhängig geprüfte Zielkonto feststellen.
   Die Rollen-/Datenbesitzgrenzen bleiben erhalten. Keine neue Registrierung
   als Ersatz für den bestehenden Zugang und keine Datenübertragung an neue IDs.
2. „Bearbeiten“ öffnet die bestehende Passwortoption. Ohne neues Passwort bleibt
   das bestehende unverändert; eine reine Namensänderung widerruft keine Sitzung.
   Keine echten Passwörter in Tickets, Terminalverlauf oder Protokolle schreiben.
3. `PATCH /api/users/[id]` prüft eine aktive Adminsitzung, Passwortpolicy und den
   aktuellen Actor erneut in der Transaktion. Hashing läuft über
   `lib/password.ts`. Bei Passwort-, E-Mail- oder Rollenänderung wird
   `sessionVersion` atomar erhöht. Es werden `ADMIN_USER_CHANGE` und beim
   Passwortwechsel `AUTH_PASSWORD_CHANGED` protokolliert, nicht das Passwort.
4. `lib/auth.ts`, `lib/get-user-id.ts` und `proxy.ts` vergleichen die aktuelle
   Sessionversion. Ein alter JWT wird beim nächsten geprüften Zugriff
   zurückgewiesen; eine Browseranzeige kann bis zur nächsten Anfrage noch offen
   aussehen. Keine sofortige Push-Abmeldung versprechen.
5. Nach einem autorisierten Vorgang Ergebnis, Zeitpunkt und nicht-sensitive
   Fallreferenz dokumentieren; keine Erfolgsbehauptung ohne prüfbaren Nachweis.
   Bei Eigenänderung muss auch der Administrator mit Abmeldung rechnen.

Sitzungswiderruf ist nicht gleich API-Schlüsselwiderruf: Ein Passwortwechsel
ändert vorhandene API-Schlüssel nicht automatisch. Bei einem Sicherheitsvorfall
müssen deren Zuständigkeit und gesonderte autorisierte Sperrung geprüft werden.
Die bestehende Kontodeaktivierung (`DELETE /api/users/[id]`) sperrt Sitzungen
und API-Schlüssel, erhält aber Geschäftshistorie. Sie ist kein Passwortreset
und darf nicht als allgemeiner Supportschritt zweckentfremdet werden.

### Einziger Administrator ausgesperrt

Der letzte aktive Administrator kann nicht herabgestuft oder deaktiviert werden;
Selbstdeaktivierung ist gesperrt. Der initiale Bootstrap ist nur für eine
uninitialisierte Installation bestimmt. Er darf bei einer bestehenden
Installation nicht durch Datenlöschung, Rollenmanipulation, neue Secrets oder
Änderung von Registrierungseinstellungen wieder geöffnet werden.

Ohne berechtigte aktive Adminsitzung gibt es in dieser Grundlage **keinen**
unterstützten öffentlichen Wiederherstellungsschritt. An den verifizierten
verantwortlichen Betreiber eskalieren. Eine privilegierte Betriebsmaßnahme
benötigt einen gesondert freigegebenen, nachvollziehbaren Prozess; dieses
Runbook enthält absichtlich keine Datenbank-/Hash-/Token-Umgehungsbefehle.

## Störung und minimale Diagnose

Zunächst Installationsadresse, Zeitpunkt/Zeitzone, betroffene Route und bereinigte
Fehlerreferenz notieren. Eine Release-/Appversion nur aus verifizierter
Deployment-Metadatenquelle angeben, nicht aus Erinnerung. `package.json` nennt
`0.1.0`; das ist **keine** sichere Zuordnung zum laufenden Commit. Die öffentliche
Konfigurationsrevision ist ebenfalls kein Releasebeweis. Kein ungefragter
Log-/Backup-/Rechnungsupload; technische Logprüfung nur innerhalb autorisierter
Betreiberzugriffe und mit Datenminimierung. Bei Retry keine Buchungen/Zahlungen
blind wiederholen. Erreichbarkeit, Antwortzeit, RPO/RTO oder 24/7-Support nicht
zusagen, solange nicht tatsächlich bestätigt.

## Öffentliche Konfiguration, G-MODEL/G-OFFER/G-LEGAL/G-SUPPORT

`lib/public-offer.ts` ist mit `server-only` gegen Clientimport geschützt.
`getPublicOffer()` enthält ausschließlich eine explizite Quellkonfiguration,
keinen beliebigen Zugriff auf Env-, SMTP-, Settings- oder Datenbankobjekte.
Änderungen benötigen eine überprüfte Konfigurationsrevision; die Prüfung
`parsePublicOffer()` whitelisted folgende freizugebende Felder:

| Feld | Zweck / Vollständigkeitskriterium |
| --- | --- |
| `providerName` | Tatsächlicher verantwortlicher Anbieter |
| `operatingModel` | Genau bestätigte Variante: `self-hosted`, `managed-instance` oder `saas`; kein Default |
| `included`, `excluded` | Nichtleere explizite Leistungs-/Ausschlusslisten |
| `responsibilities` | Einrichtung, Updates, Sicherung und Wiederherstellung |
| `price` | Nichtnegative sichere Ganzzahl `amountCents`, `currency: EUR`, `interval`, `taxNote`; fehlend ist nicht null Euro |
| `term` | Laufzeit und Kündigung |
| `support` | Umfang und tatsächliche Erreichbarkeit; keine abgeleitete SLA |
| `exit` | Datenübergabe, Fristen, Lösch-/Aufbewahrungsverantwortung |
| `supportContact` | Bestätigtes Label und HTTPS-/einfaches mailto-Ziel; zusätzlich `gates.support` |
| `documents` | Bestätigte HTTPS-Links `provider`, `privacy`, `terms`; keine automatisch generierten Rechtstexte |
| `source` | HTTPS-Source-/Lizenzlink, genaue `revision`, `matchesDeployment: true` und Source-Gate; extern zu bestätigen |

Nur Felder in `approvedFields` und mit einer nichtleeren `revision` werden
übernommen. Unbekannte Felder verschwinden. Vollständig ist nur ein Satz mit
allen gültigen Feldern, `status: approved` und den expliziten Gates `model`,
`offer`, `legal`, `support`, `source` gleich `true`. Die maschinenlesbare
`missing`-Liste benennt offene Software-/Konfigurationskriterien, ersetzt aber
keine Fach-/Rechts-/Betriebsabnahme. Ein vollständiger Satz aktiviert auch dann
**keinen** Onlineabschluss (`onlineConclusionEnabled` ist immer `false`).

Aktuell: Revision `concept-unconfigured-v1`, keine freigegebenen Felder, alle
Gates offen. Ein unabhängig bestätigter Supportkontakt kann vor einem vollständigen
Angebot freigegeben werden; niemals aus SMTP-Absender, GitHub-Autor oder
unbestätigter E-Mail ableiten. Links erlauben keine ausführbaren Schemes,
Protokollrelativität, URL-Zugangsdaten oder mailto-Headerparameter.

## Source-/Lizenzcheck vor einem echten Release

`package.json`, `LICENSE` und README benennen AGPL-3.0-only. Das öffentliche
Projekt-Repository ist `https://github.com/storminator89/bivaro-kleinunternehmen`.
Ein Projekt-/Branchlink allein belegt nicht den tatsächlich ausgelieferten
vollständigen korrespondierenden Quellstand. Vor Freigabe dessen Revision und
Artefakt samt lokalen Änderungen, Build-/Installationsbestandteilen und
Lizenztext mit dem realen Deployment abgleichen. Erst danach Sourcefelder und
Gate freigeben. Die Grundlage erzeugt keine Rechtsfreigabe oder Behauptung,
dass der aktuelle Dienst bereits exakt diesem Sourceartefakt entspricht.

## Prüfungen und getrennte Abnahme

- Gezielte Schematests: `lib/__tests__/public-offer.test.ts`, einschließlich
  vollständig fiktiver Testkonfiguration unter `.invalid`; niemals produktiv
  als Angebot verwenden.
- Routing-/Contenttests: `lib/__tests__/access-help.test.ts` und
  `lib/__tests__/public-pilot.test.ts`. Test-only `server-only`-Alias entspricht
  dem leeren Servermarker aus Next und ändert den Produktionsimport nicht.
- Vorhandene isolierte Sessionnachweise:
  `lib/__tests__/auth-hardening.test.ts` (JWT nach Passwort-/Rollenwechsel),
  `lib/__tests__/user-deactivation.test.ts` (Sperre, Historie, letzte Adminrolle).
- Eine operative Demonstration darf nur ein explizit autorisiertes synthetisches
  Testkonto im getrennten Ziel benutzen. Alter Sitzungstoken muss danach beim
  nächsten geprüften Zugriff scheitern; kein echter Benutzer wird für die
  Dokumentation geändert. Das ist **noch kein** produktiver Betriebsdrill.
- Browserabnahme separat am exakt dokumentierten Kandidaten: anonymer Direktlink,
  Login → Hilfe → Login mit sicherem Ziel, Reload/zweiter Tab, Zurück, fehlender
  Kontakt, 360/390/768/1440 px und Tastaturfokus. Kein bestandener Browsernachweis
  wird aus Unit-/Contenttests abgeleitet.
