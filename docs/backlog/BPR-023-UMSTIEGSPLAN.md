# BPR-023 / GitHub #57 – begrenzte Umstiegsvorbereitung

Stand: 26.10.2026. **Teilumsetzung, nur lokal; keine Veröffentlichung oder Abnahme.**
Issue: <https://github.com/storminator89/bivaro-kleinunternehmen/issues/57>

## Nutzbarer Funktionsumfang

Die vorhandene öffentliche Hilfe bindet unter `/help#umstieg` eine interaktive
Vorbereitung ein. Sechs native, beschriftete Statusauswahlen behandeln Firma und
Zuständigkeit, Nummernkreise, offene Posten, Startdatum, Doppelerfassung und
Kontrollsummen. „Noch offen“, „Selbst vorbereitet“ und „Prüfbedarf“ werden
getrennt gezählt. Auch sechs vorbereitete Punkte ergeben keine Umstiegsfreigabe.

Ein manuell herunterladbarer UTF-8-Textbogen enthält genau diese aktuelle
Selbsteinschätzung, die Prüfpunkte, benötigte separate Nachweise und leere Felder
für Betriebsmodell, Stichtag, geprüfte Installation/Build-Version, Zuständigkeit
und fachliches Review. Der lesbare, kopierbare Text ist unabhängig vom Download
verfügbar; Downloadfehler lassen die Auswahl bestehen. Ergänzen, Ausdrucken und
freiwillige Weitergabe erfolgen außerhalb der Checkliste und ohne Versandfunktion.

Es gibt keine Abfrage freier Texte, Firmen-/Kontodaten oder realer Dokumente,
keine Speicherung in Browser-Storage, keine API-Anbindung und kein Tracking
durch diese Checkliste. Neuladen setzt den Auswahlstand zurück; das wird vor
den Steuerelementen erklärt. Explizites Zurücksetzen verändert keine bereits
heruntergeladenen Dateien. Die bestehende Hilfeseite kann unabhängig davon
ihre bisherigen Zugangs-/Sitzungsabfragen ausführen.

## Grenzen und unveränderte Verträge

- Keine Konten, echten Nummernkreise, Datenimporte, Schema-/Datenänderungen,
  Betreiberangebote, Kontaktaufnahmen oder erfundenen Demo-Assets.
- Selbstbetrieb, betreute Instanz und SaaS werden fachlich gleich eingeordnet;
  nicht zugesagte Varianten bleiben Konzept. Verfügbarkeit und Zuständigkeiten
  sind mit dem Betreiber zu klären.
- Ungeklärte bzw. nicht vollständig unterstützte Fälle behalten ausdrücklich
  Prüfbedarf; keine Steuerberatung oder zugesicherte fachliche Freigabe.
- Keine Änderung von `proxy.ts`, Authentifizierung, APIs, `next.config.ts`,
  gemeinsamen Public-CSS-/Scrollregeln oder bestehenden nativen Fragmentlinks.
- Die neue Sektion verändert die Seitengeometrie. Sie ist **kein Nachweis einer
  Korrektur von #183** und gehört nicht in dessen unveränderte Diagnoseläufe.
- Ausgangspunkt ist der lokale quellgleiche Checkpoint `338fe04b9fd216a98f779e88b9ee40adebed8bd3`,
  Tree `990ea095`, zu GitHub-main `83cabef`; keine Behauptung identischer Commit-Abstammung.

## Tatsächlich ausgeführte Nachweise

- Node **24.22.1**; vorhandene kanonische `bivaro54/node_modules` wiederverwendet,
  keine Installation, Generierung eines Prisma-Clients oder Paketduplikation.
- **3 gezielte Vitest-Suites / 30 Tests bestanden**: reine Status-/Textfunktionen,
  React-SSR-Markup sowie eng begrenzte Hook-/DOM-Mocks für Produktionshandler.
  Enthalten sind ungültige Statuswerte, alle-sechs-ohne-Freigabe, aktueller
  Downloadtext, wiederholte Downloads, URL-Freigabe, URL-/Klickfehler,
  Kopierfallback, Reset und neue Komponenteninstanz.
- Next-Routentypgenerierung und vollständiges TypeScript
  `--noEmit --incremental false` bestanden. Gezieltes ESLint aller geänderten
  TypeScript-Dateien mit null Warnungen bestanden. Der zusätzliche vollständige
  ESLint-Lauf wurde ohne Diagnostik vom System beendet (`Killed`, Exit 137);
  nicht bestanden, kein erneuter Voll-Lauf oder Prüfungs-Bypass.
- Keine lokalen Browser-/Anwendungsserver-/Datenbankläufe, kein Produktionsbuild,
  keine neuen GitHub-CI-Läufe, kein Push/PR/Merge/Deployment und kein Issue-Abschluss.

Reine SSR-/Mock-Nachweise sind keine Browser-, Tastatur-, Layout-, Download-
oder Produktabnahme. Die drei Browserfälle in
`e2e/public-switching-checklist.spec.ts` sind **nur verfasst und nicht ausgeführt**:
anonymer Download/Kopiertext ohne Schreibrequest, vollständige Selbsteinschätzung
mit Reviewgate/Reset/Reload sowie 360px/Tastatur und lesbarer Fallback. Es gibt
keine erzeugten oder geprüften Browser-Screenshots dieses Kandidaten.

## Für #57 weiterhin offen

Ein tatsächlicher geführter Ablauf Rechnung → Teilzahlung → Beleg → Korrektur →
Übergabe, sichere synthetische Beispielbelege und aus dem tatsächlich abgenommenen
Build erzeugte/versionierte Dateien oder Screenshots sind nicht umgesetzt.
Direktlink-/Rückweg-/Mobil-/Tastatur-/Download-Browserabnahme des exakten
Kandidaten und vollständige Build-/CI-Nachweise fehlen. Ein freiwilliger
Empfänger-/Kanzleireview benötigt konkrete Freigabe und ist nicht erfolgt.
Abhängigkeiten und fachliche, Betreiber- und Releaseentscheidungen bleiben offen.

Die zentrale gepaarte Statusdokumentation wird durch den zuständigen
Dokumentationsowner geführt; die historischen 160 BV-Tickets sind nicht #57.

## Enger unabhängiger Fixture-Review

Der ursprüngliche Feature-Checkpoint `ad4a57d` / Tree `fea1204` bleibt als
unveränderte Historie erhalten. Die anschließende Korrektur ändert keine
Produktionslogik, bestehende Hilfsanker oder die unveränderte #183-Diagnose.

- Alle drei verfassten Browserfälle blockieren und protokollieren unerwartete
  Nicht-Lesezugriffe vor der Übermittlung. Nur der exakte POST auf den
  konfigurierten Ursprung und `/api/auth/_log` ohne Query wird separat als
  Auth-Diagnose eingeordnet; keine Ausnahme für den Auth-Namensraum. Auch eine
  solche Diagnose bleibt ein fehlgeschlagenes Abnahmekriterium, nicht ein
  tolerierter Auth-Fehler. Es werden höchstens zehn bereinigte Level-/Code-Paare
  ohne Nachrichten, Stacks, URLs, Session- oder Anfragedaten aufbewahrt.
- Die realen Session- und Zugangsabfragen werden vor Interaktionen und Reload
  abgeschlossen. Eine anonyme Session wird anhand des vorhandenen NextAuth-
  Vertrags `{}` geprüft; kein künstlicher Erfolg oder Session-Mock.
- Tastaturverträge umfassen Tab-Rückkehr, sichtbaren Fokus sowie Download und
  Reset per Enter. UTF-8-Downloadbytes werden erst nach dem Zusammenfügen
  dekodiert, damit Streamgrenzen keine Umlaute beschädigen.
- Zwei dedizierte Viewportbilder sind nur verfasst:
  `public-switching-review-desktop.png` (1440 × 1000) und
  `public-switching-review-mobile.png` (360 × 800). Reale Schrift-/Fortschritts-
  und Header-/Hit-Test-Verträge ersetzen Vollseitenbilder oder verdeckte UI.
  Die additive, exakt begrenzte Bildzustellung wird separat durch den Test-/CI-
  Owner geprüft. Keine bestehenden Bildnamen, Limits oder Workflow-Hashes werden
  hier geändert; tatsächliche PNGs und visuelle Abnahme bleiben offen.
- Die bisherigen 30 reinen Tests bleiben erhalten. 20 zusätzliche reine
  Guard-/Metadatenfälle bestehen ebenfalls: insgesamt vier Suites / 50 Tests.
  Gezieltes ESLint aller betroffenen TypeScript-Dateien besteht mit null
  Warnungen. Ein erster Voll-Typecheck mit 768-MiB-Heap endet ohne TypeScript-
  Diagnose am Heaplimit (Exit 134); das ist kein Pass. Der anschließend mit
  dem Root und den anderen Workern koordinierte einzelne vollständige
  Typecheck mit 1536-MiB-Heap besteht (Exit 0, keine Diagnose).
  Der frühere vollständige ESLint-Ressourcenabbruch bleibt dadurch ungelöst;
  kein vollständiger Lint-/Build-/CI-Pass wird behauptet.

Kein Browserlauf, Anwendungsserver, Datenbankzugriff, Build, GitHub-Schreibzugriff,
neuer CI-Lauf, Merge oder Deployment wurde für diese Korrektur ausgeführt.
