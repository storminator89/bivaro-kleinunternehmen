# BIVARO · Individuelle Icon-Familie

Stand: 17. Oktober 2026. Implementiert und auf dem bestehenden Docker-Server ausgeliefert. Änderungen im lokalen Arbeitsverzeichnis sind uncommitted.

## Gestaltung und Bildgenerierung

24 eigenständige Bilder wurden mit dem integrierten `image_gen`-Tool erzeugt, jeweils in einem eigenen Aufruf mit `transparent_background: true`. Keine Sammeltafel oder ausgeschnittenen Sprite-Zellen. Die Familie verwendet plastische Emaille-Flächen in Waldgrün und Mint mit elfenbeinfarbenen Reflexen. Mahnwesen und Steuerfunktionen erhalten kleine gelbe, Ausgaben korallfarbene Akzente.

- 14 Sidebar-Symbole: Dashboard, Rechnungen, Angebote, Mahnwesen, Kunden, Einnahmen, Ausgaben, Kassenbuch, EÜR, GWG, Steuer-Simulation, Einstellungen, Benutzer und Abmelden.
- 7 Dashboard-Motive: Einnahmen, Ausgaben, Gewinn, offene Rechnungen, Jahresvergleich, Aktivitäten und Umsatzgrenzen.
- 2 Dokumentmotive: Rechnungsimport und einzelner Beleg.
- 1 neues BIVARO-App-Zeichen: ein geometrisches B mit mintfarbener Diagonale, in der öffentlichen Navigation, Sidebar, mobilen Navigation und kompakten Sidebar sowie als Favicon und Touch-Icon.

Die Familie wird außerdem in den passenden EÜR-/GWG-Kacheln, Formularüberschriften, Beleglisten und der Befehlspalette wiederverwendet. Suche, Sortierung, Aufklappen und andere kleine Bedienzeichen behalten ihre funktionalen Symbole. Dekorative Bilder haben leere Alternativtexte; die vorhandenen Beschriftungen liefern die zugänglichen Namen.

## Dateien und Reproduktion

- [Vollständige Prompts und Zuordnung aller 24 Einzelbilder](icon-generation-2026-10-17.json)
- Originale: `assets/brand/bivaro-icons/*.png` — unveränderte generierte RGBA-PNGs.
- Webdateien: `public/brand/icons/*.webp` — 128 px, App-Zeichen 192 px; zusammen 145.300 Bytes.
- Next.js-Dateikonventionen: `app/icon.png` mit 512 px, `app/apple-icon.png` mit 180 px und `app/favicon.ico` mit 16/32/48/64/128/256 px.
- [Exportnachweis einschließlich Alphakanal und Dateigrößen](icon-assets-2026-10-17.json)
- Gemeinsame Komponenten: `components/brand/bivaro-icon.tsx` und `components/brand/bivaro-brand.tsx`.

`node scripts/prepare-brand-icons.mjs` erzeugt die Web-/Favicon-Dateien erneut aus den Projektoriginalen. Der Export ändert ausschließlich Format und Auflösung. Die Originale bleiben erhalten und werden vom Docker-Build ausgeschlossen.

## Verifikation

- ESLint: erfolgreich, keine Warnungen.
- Produktionsbuild einschließlich TypeScript: erfolgreich.
- 20/20 Playwright-E2E-Tests in einer frisch migrierten temporären SQLite-Fixture, ohne Zugriff auf die lokale Entwicklungsdatenbank. Die Tests prüfen zusätzlich alle 14 Sidebar-Bilder, vier Kennzahlenmotive, tatsächliches Laden, unveränderte Bildfarben und die drei Icon-Routen.
- Responsive Ansichten: bestehende E2E-Prüfungen bei 320/375/414/768/1440 px; Hell/Dunkel und mobile Navigation geprüft.
- Eingeklappte Sidebar: neuer Markenbereich und Aufklappschalter überlappen nicht.
- Alle 24 Originale und Webexporte besitzen einen echten Alphakanal.

Screenshots mit synthetischen Testdaten:

- [Dashboard mit individuellen Icons](screenshots-2026-10-17-icons/dashboard-populated.png)
- [Desktop im dunklen Farbschema](screenshots-2026-10-17-icons/dashboard-dark-desktop.png)
- [Eingeklappte Sidebar](screenshots-2026-10-17-icons/sidebar-collapsed.png)
- [Mobile Sidebar](screenshots-2026-10-17-icons/sidebar-mobile-dark.png)
- [Rechnungen](screenshots-2026-10-17-icons/invoices-populated.png)

## Docker-Deployment

Live: http://192.168.0.126:7689/ — Container `bivaro-app`, Image `bivaro:design-icons-20261017`.

Das Image wurde auf dem Server aus dem aktuellen Arbeitsverzeichnis gebaut. Der übertragene Build-Kontext enthielt keine Umgebungsdateien, Datenbanken oder Uploads. Vor dem Austausch startete das Image mit einer isolierten Datenbankkopie, explizitem Fixture-Ziel und deaktiviertem Netzwerk. Alle 28 vorhandenen Migrationen waren kompatibel; eine Migration war nicht erforderlich.

Vor dem Austausch wurde der bestehende Container angehalten und eine konsistente Sicherung beider Datenvolumes erstellt. Der Datenbankinhalt im Archiv wurde per SHA-256 mit der angehaltenen Originaldatei verglichen. Anschließend wurde ausschließlich die Image-Referenz des bestehenden Compose-Dienstes ersetzt. Die Volumes `bibarodockerhub_bivaro-data` und `bibarodockerhub_bivaro-uploads` sowie Port 7689 bleiben erhalten.

- Server-Sicherung: `/opt/bivaro/releases/20261017-icons/backup-before-deploy/persistent-volumes.tar.gz`.
- Vorheriges Image: `bivaro:rollback-before-design-icons-20261017`.
- Ursprüngliche Stack-Konfiguration: `/opt/bivaro/releases/20261017-icons/backup-before-deploy/compose.yaml`.
- [Deployment-Protokoll ohne Zugangsdaten](deployment-2026-10-17-icons.json)
- [Prüfung der isolierten Datenbankkopie](deployment-preflight-2026-10-17-icons.json)

Nach dem Deployment: Container `healthy`, Datenbank `up`, alle 27 Icon-Dateien über HTTP mit identischem SHA-256 ausgeliefert. Die Login-Oberfläche wurde im Browser einschließlich neuem Zeichen bei 1440/375/320 px geprüft. Auf dem Produktionssystem wurden keine Testnutzer oder Testbuchungen angelegt.

Rollback bei Bedarf: Die ursprüngliche Compose-Datei aus der Sicherung wiederherstellen, `docker compose config --quiet` im Stack-Verzeichnis prüfen und `docker compose up -d --no-deps --pull never bivaro` ausführen. Die bestehende Datenbank bleibt dabei bestehen; eine Datenwiederherstellung ist für diesen rein kompatiblen Releasewechsel nicht erforderlich.
