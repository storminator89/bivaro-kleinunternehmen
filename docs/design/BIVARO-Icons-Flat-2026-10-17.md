# BIVARO · Flache Dashboard-Icons und helles Sidebar-Logo

Umgesetzt und am 17. Oktober 2026, 20:46 Uhr Europe/Berlin auf dem bestehenden Server bereitgestellt.

Die bestätigten 14 Sidebar-Icons bleiben erhalten. Das Sidebar-Logo verwendet jetzt eine eigenständige helle, flache Variante mit klarem Kontrast zu Waldgrün. Diese gilt auch für die mobile und eingeklappte Navigation. Die öffentliche Marke und das Favicon bleiben bei ihrer bisherigen Variante.

Das Dashboard einschließlich Aktivitäten, Beleglisten, Formularüberschriften, EÜR und GWG verwendet eine eigene flache Familie. Ein gedämpfter Grünton, maximal 32 px große Motive und transparente Flächen ersetzen die mehrfarbigen 3D-Darstellungen. Im dunklen Farbschema wird derselbe Umriss in einem hellen, zurückhaltenden Salbeigrün dargestellt. Beträge und Beschriftungen behalten ihre bestehende fachliche Farblogik.

## Assets und Implementierung

Alle 13 neuen Motive wurden einzeln mit dem integrierten `image_gen`-Tool erzeugt: zwölf Dashboard-Symbole und eine Logo-Variante. Die PNG-Originale mit echtem Alphakanal liegen in `assets/brand/bivaro-icons/flat/`. Die Webexporte liegen in `public/brand/icons/flat/` beziehungsweise `public/brand/icons/bivaro-sidebar-flat.webp` und benötigen zusammen 56.428 Bytes.

- [Vollständige Einzelprompts und Dateizuordnung](icon-generation-flat-2026-10-17.json)
- [Alphakanal- und Exportnachweis](icon-assets-flat-2026-10-17.json)
- Export erneut ausführen: `node scripts/prepare-flat-icons.mjs`.
- `components/brand/dashboard-icon.tsx` verwendet die generierten Alpha-Umrisse als CSS-Masken. Dadurch entstehen vollständig einfarbige Akzente ohne Texturen, Glanz oder 3D-Schattierung. Die angrenzenden Beschriftungen liefern weiterhin die zugänglichen Namen.
- `components/brand/bivaro-brand.tsx` wählt die helle Variante ausdrücklich für die Sidebar aus; die Sidebar-Funktionsicons werden dadurch nicht verändert.

## Verifikation und Vorschau

ESLint ohne Warnungen, Produktionsbuild einschließlich TypeScript sowie 20/20 E2E-Tests erfolgreich. Zusätzliche Prüfungen belegen den einfarbigen Dashboard-Ton, höchstens 32 px große Motive, vorhandene Masken-Dateien, das helle Sidebar-Logo und die unverändert geladenen 14 Sidebar-Symbole. Responsive Ansichten bei 320/375/414/768/1440 px, Hell/Dunkel, eingeklappte Sidebar und mobile Navigation wurden geprüft. Testdaten befinden sich ausschließlich in einer frisch angelegten temporären SQLite-Fixture.

- [Dashboard mit synthetischen Buchungen](screenshots-2026-10-17-flat/dashboard-populated.png)
- [Dunkles Dashboard](screenshots-2026-10-17-flat/dashboard-dark-desktop.png)
- [Mobile Sidebar mit hellem Logo](screenshots-2026-10-17-flat/sidebar-mobile-dark.png)
- [Eingeklappte Sidebar](screenshots-2026-10-17-flat/sidebar-collapsed.png)
- [Rechnungen](screenshots-2026-10-17-flat/invoices-populated.png)
- [Prüfprotokoll](verification-flat-2026-10-17.json)

## Deployment

Live: http://192.168.0.126:7689/ — `bivaro-app`, Image `bivaro:flat-icons-20261017`.

Vor dem Austausch wurde das Image mit einer isolierten Kopie der vorhandenen Datenbank und ohne Netzwerk geprüft. Alle 28 Migrationen bleiben unverändert. Eine Sicherung beider bestehenden Datenvolumes wurde bei angehaltenem Container erstellt und die Datenbank im Sicherungsarchiv per SHA-256 geprüft. Beide Volume-Zuordnungen und Port 7689 bleiben erhalten. Alle 13 neuen Dateien wurden nach dem Deployment über HTTP mit dem lokalen SHA-256 verglichen; der Health-Endpunkt meldet `healthy`, Datenbank `up`.

- [Deployment-Protokoll ohne Zugangsdaten](deployment-flat-2026-10-17.json)
- [Isolierte Prüfung vor dem Deployment](deployment-preflight-flat-2026-10-17.json)
- Sicherung auf dem Server: `/opt/bivaro/releases/20261017-flat/backup-before-deploy/persistent-volumes.tar.gz`.
- Rollback-Image: `bivaro:rollback-before-flat-icons-20261017`.

Der lokale Arbeitsstand bleibt uncommitted. Es wurden keine Testnutzer oder Testbuchungen auf dem Produktionssystem erstellt.
