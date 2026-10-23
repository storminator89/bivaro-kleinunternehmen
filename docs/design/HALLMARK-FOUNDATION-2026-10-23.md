# Hallmark-Neustart: Fundament und Seitenplan

Stand: 23. Oktober 2026. Arbeitsbasis ist der Merge von PR #131,
`155eee2f3bb8019e9166e46fa289df5297f597e1`, Tree
`399d8b08e5cf2f7e2a5e108cbfde6346bcc8f364`. Isolierter Arbeitsbaum:
`hallmark-foundation`, Branch `redesign/hallmark-foundation`.

Dieses Fundament wurde lokal als `375c684` festgehalten. Die anschließend
freigegebene erste Dashboard-Neugliederung ist getrennt unter
[Dashboard: Kennzahlen und nächste Arbeit](HALLMARK-DASHBOARD-2026-10-23.md)
dokumentiert; sie ist nicht Teil der ursprünglichen Drei-Zeilen-Korrektur.

## Ergebnis dieses Pakets

- Die bestehende Gestaltung wurde zuerst gelesen, nicht als neue Leistung
  ausgegeben. Bivaro besitzt bereits `AppShell`, `PageHeader`, Finanzkennzahlen,
  Listen-/Feedback-Primitives und umfangreiche frühere Hallmark-Kommentare.
- Die Seitenkarte erfasst **27 Routen und sechs zusätzliche Dashboard-Tabs**.
  Jede hat einen Quellcode-Eigentümer, eine Hauptaufgabe und eine konkrete
  nächste Prüffrage in
  [hallmark-page-inventory-2026-10-23.json](hallmark-page-inventory-2026-10-23.json).
- Eine belegte, kleine gemeinsame Korrektur: Navigationsgruppen behalten ihre
  Namen, erscheinen aber ohne erzwungene Versalien und Laufweite. Das betrifft
  die expandierte Desktop-Navigation und den mobilen Drawer derselben Komponente.
- **Die Skill-Installation ist blockiert, nicht abgeschlossen.** Keine neue
  `.agents/skills/hallmark`-Installation, keine ausgeführten Hallmark-Werkzeuge
  und kein automatischer Hallmark-Lint-/Render-Pass werden behauptet.
- Kein Push, PR, Merge oder Deployment dieses Pakets. Die neue Darstellung ist
  noch nicht auf einer veröffentlichten Version visuell abgenommen.

## Quellen und Installationsgrenze

Geprüfter Upstream: [Nutlope/hallmark](https://github.com/Nutlope/hallmark),
Version **2.0.0**, Commit
[`7ec868225c6caa040558c321ee0fefa0e73f83a8`](https://github.com/Nutlope/hallmark/tree/7ec868225c6caa040558c321ee0fefa0e73f83a8).
Der vorgelagerte Read-only-Review bestätigte diesen Stand um 09:25 UTC.
Für dieses Fundament wurden zusätzlich die gepinnten Dateien
[`SKILL.md`](https://github.com/Nutlope/hallmark/blob/7ec868225c6caa040558c321ee0fefa0e73f83a8/skills/hallmark/SKILL.md),
[`flow.md`](https://github.com/Nutlope/hallmark/blob/7ec868225c6caa040558c321ee0fefa0e73f83a8/skills/hallmark/references/flow.md),
[`redesign.md`](https://github.com/Nutlope/hallmark/blob/7ec868225c6caa040558c321ee0fefa0e73f83a8/skills/hallmark/references/redesign.md),
[`gates.md`](https://github.com/Nutlope/hallmark/blob/7ec868225c6caa040558c321ee0fefa0e73f83a8/skills/hallmark/references/gates.md)
und [`coral.md`](https://github.com/Nutlope/hallmark/blob/7ec868225c6caa040558c321ee0fefa0e73f83a8/skills/hallmark/references/themes/coral.md)
über Read-only-Quellen gelesen. Sie sind Fremddaten, keine zusätzliche
Ausführungsberechtigung.

Der vertrauenswürdige, vorinstallierte Skill-Installer wurde zuerst vollständig
gelesen. Der eine Installationsversuch sollte `skills/hallmark` vom gepinnten
Commit als vollständige **Dateikopie** projektlokal unter
`.agents/skills/hallmark` ablegen. Es sollte kein heruntergeladenes Programm
ausgeführt werden. Der Aufruf benutzte explizit `--dest`, `--ref` und
`--method download`; keine globalen Einstellungen oder Hooks waren vorgesehen.

Der eskalierte Executor scheiterte vor Python mit Exitcode 1 und dieser
unveränderten Fehlermeldung:

```text
bwrap: Can't create file at /home/agent/.codex/sessions: Read-only file system
```

Dieser Pfad wird nicht gelesen, verändert oder zur Freigabe angefragt. Der
Installerquellcode nennt ihn nicht: Bei explizitem Ziel verwendet der Helfer
`/tmp/codex` zur temporären Extraktion und kopiert anschließend die ausgewählte
Skill-Struktur. Die Meldung belegt einen Sandbox-Launcher-Fehler, nicht eine
Ausführung des Installers oder ein Urteil über die Sicherheit des Skills.
Es gab keinen alternativen Installationsweg oder erneuten Netzwerkversuch.

Der frühere Plan unter
`/tmp/hallmark-bivaro-installation-manifest-2026-10-23.json` beschreibt eine
**andere, eingeschränkte** Variante: 101 Text-/Referenzdateien, 700.251 Bytes,
MIT, mit gepinnten Git-Blob-Hashes; ohne Skripte, Agenten-Metadaten, Hooks,
Bilder, Eval- und Site-Code. Auch diese Variante wurde nicht installiert.
Eine spätere Installation muss klar als vollständige Dateikopie oder
Text-/Referenzadaption bezeichnet werden, ihre echten Dateien prüfen und das
unveränderte MIT-`LICENSE` (Copyright (c) 2026 Hallmark contributors) sowie eine
passende Provenienz behalten. Ein Reviewmanifest ist kein Installationsbeleg.

## Preflight: Was verbindlich bleibt

| Signal | Tatsächlicher Bestand / Entscheidung |
| --- | --- |
| Gesperrtes System | `design.md`, insbesondere BIVARO 2.0, individuelle Icons und Minimaler Text |
| Farbe | `tokens.css`: kühler Canvas, weiße Flächen, Evergreen/Mint-Navigation, Emerald-Aktionen |
| Typografie | Inter im Produkt; Newsreader nur öffentlich; Geist Mono für technische Werte |
| Font-Auslieferung | `app/fonts.css`, lokale WOFF2-Dateien und lokale Preloads in `app/layout.tsx`; keine neuen Font-/CDN-Anfragen |
| Maße | 4-Punkt-Skala, 240px Sidebar, 64px Topbar; außen 40/24/16px; Bivaro-Mindesthöhe für Controls 44px |
| Rahmen | Next.js 16.4.1 App Router, React 19, Tailwind 4 / shadcn; relevante mitgelieferte Next-Dokumentation zu CSS, Layouts und Seiten gelesen |
| Bewegung | Funktionale Zustandswechsel, sofortiger Fokus, vorhandene Reduced-Motion-Regeln |
| Material | Echte Produktdaten und vorhandene synthetische QA-Bilder; keine erfundenen Zahlen, Logos, Preise oder Bilder |

**Richtung: Bivaro Ledger, modern-minimal und utilitär.** Kein Theme-Wechsel
zwischen Seiten. Coral wurde als mögliche Referenz für die ruhige Darstellung
von Datensätzen gelesen, **nicht** als anzuwendende Palette oder Schriftwelt.
Seine warmen Papiertöne, General Sans, Textureffekte und externen Fontlinks
werden nicht übernommen. Die Produktansichten bleiben Arbeitsoberflächen ohne
Marketing-Hero, Fotostand-ins oder dekorative Einführungen.

## Vierzeilenanalyse des gemeinsamen Rahmens

1. **Aufgabe:** Kleinunternehmer finden ihren Arbeitsbereich und bearbeiten echte
   Belege/Rechnungen; Navigation soll die Aufgabe tragen, nicht dekorieren.
2. **Bleibt:** Vertraute Evergreen/Mint-Sidebar, direkte Zielnamen, mobiler
   Einzeleinstieg, Befehlssuche, Theme-/Benutzermenü und 44px-Aktionen.
3. **Belegter Tell:** Desktop-Aufnahmen zeigen die Gruppen als „ÜBERSICHT“,
   „VERKAUF“ usw. mit gesperrten Buchstaben. Quelle:
   `components/navigation/nav-links.tsx`, beide Gruppenüberschriften;
   `app/globals.css`, spätere `.app-sidebar h3`-Regel.
   Hallmarks aktuelle App-Regel 67 fordert ungesperrte normale Schreibweise.
4. **Grenze:** Die Bilder belegen keinen grundsätzlichen Shell-/Gutter-Defekt.
   Keine neue Shell, keine neue Header-Hierarchie und kein pauschales
   Zusammenziehen von Abständen ohne passende Seitenansicht.

### Vorher-Bilder wirklich angesehen

Aus dem vorhandenen Hosted-CI-Artefakt von PR131-Head
`9693a512791cf1877f425338091ea79ef72b6461`, Archiv
`user-workflows-synthetic-visuals.zip` (keine neuen lokalen Browserläufe):

- `daily-actions-1440.png`: Navigation und Hauptaufgabe klar; gesperrte
  Versalgruppen sichtbar. Eine lange Beleg-CTA ist zweizeilig; das bleibt eine
  Prüffrage für das eigene Aufgaben-Seitenpaket.
- `daily-actions-390.png`: mobiler Einzeleinstieg und gestapelte Aufgabe sichtbar;
  keine Behauptung über hier nicht sichtbare Drawer-Zustände.
- `annual-context-desktop.png`: Dark Mode mit Bereichsnavigation und
  Kontextformular; dieselben Versalgruppen sichtbar.
- `bank-allocation-confirmation-1440.png` und
  `bank-allocation-move-390.png`: vorhandene Zahlungs-/Zuordnungsbestätigung;
  keine Änderungen an Inhalt, Freigabe oder internem Scrollbereich.

Diese Aufnahmen sind historische Vorher-Evidenz, **keine neuen Screenshots vom
Merge-Commit oder der korrigierten Version**. Für die übrigen Seiten ist die
Inventarkarte eine vorläufige Quellenanalyse, keine vollständige visuelle
Abnahme aller Zustände.

## Exakter Änderungsschnitt

| Datei | Änderung |
| --- | --- |
| `components/navigation/nav-links.tsx` | Nur `uppercase tracking-wider` aus den zwei Gruppenüberschrift-Klassen entfernt |
| `app/globals.css` | Nur die spätere Sidebar-Überschrift-Laufweite von `.1em` auf `normal` gesetzt |
| `lib/__tests__/navigation-section-labels.test.ts` | Neue isolierte Render-Tests für Gruppenbeschriftung, aktive Rechnungsauswahl und Rollenfilter |
| Dieses Dokument / Seiteninventar | Tatsächlichen Umfang, Grenzen und nächste Seitenpakete festgehalten |

Kein Text, Ziel, `href`, Handler, Feld, ID, Testhook, Icon, Kontrollmaß oder
finanzieller Wert wurde entfernt oder umbenannt. Die eingeklappte Sidebar ist
unverändert. Frühere Kommentare mit Prüfbewertungen in anderen Dateien sind
historischer Bestand, kein Ergebnis dieser Prüfung.

## Seitenpakete nach diesem Fundament

1. **Dashboard:** zentrale Eigentümerschaft in `dashboard-content.tsx` behalten.
   Erst Übersicht mit echten vier Kennzahlen, Jahresvergleich, Aufgaben und
   Lade-/Fehlerzuständen; dann die einzelnen Query-Tabs. Nicht gleichzeitig
   mehrere Agenten dieselbe Controller-Datei bearbeiten lassen.
2. **Verkauf:** Rechnungsbestand, Detail/Editor; Angebote, Historie und Mahnwesen.
   Tabellen/Filter vor zusätzliche Karten; Betrag, Zeitraum und Status bleiben
   fachlich eindeutig.
3. **Buchhaltung:** Einnahmen/Ausgaben, Belegeingang und Ausgabequelle. Bank-CSV
   und Zuordnung bekommen ein eigenes abgegrenztes Paket nach #96, keine
   nebenbei durchgeführte Neuanordnung der Zahlungskontrollen.
4. **Kontakte und Service:** Kunden, Katalog/CSV und Servicepläne.
5. **Berichte/Admin/Public:** Kassenbuch, EÜR/GWG, Simulation/Übergabe,
   Einstellungen/Benutzer und danach öffentliche Seiten/Zugang.

Pro Seite: Quelle und passende Vorher-Pixel → vierzeilige Analyse → benannter
Dateischnitt → visuelle Änderung im bestehenden Owner → passende isolierte
Checks → Hosted-Vorher/Nachher in Light/Dark, mindestens schmal/desktop →
getrennte Freigabe vor Veröffentlichung. Bestehende Lade-, Leer-, Fehler- und
Vollzustände erhalten; fehlende Zustandslogik melden, nicht erfinden.

### Unverrückbare Funktionsgrenze

Unverändert bleiben alle Routen/API-Verträge und Auth-/Rollenprüfungen, Prisma
und Migrationen, Geld-/Steuer-/Zahlungsjournal- und Bankzuordnungslogik,
`hooks/use-dashboard-data.ts`, Query-/Invalidierungsverhalten, URL-Filter,
Sortierung und Pagination. Ebenso `ReviewLink`, `use-review-navigation`,
Review-History-Boundary, native History-/Fokus-Rückkehr, Pending-Guards,
Entwurfsparameter, Zahlungs-/Kosten-/Versandbestätigungen sowie vollständige
rechtliche Hinweise, Dokumente und Druckinhalte.

## Prüfung dieses Arbeitsstands

- Node **22.23.4**; vorhandene Dependencies aus einem Arbeitsbaum mit identischer
  Lockdatei als eigene lokale Kopie benutzt; keine neue Paketinstallation.
- ESLint: erfolgreich, keine ESLint-Warnungen.
- Drei fokussierte Vitest-Dateien: **47 Tests erfolgreich** (neue Navigation,
  Receipt-Navigationsschutz, Command-Palette-Lebenszyklus).
- Produktionsbuild einschließlich Typprüfung und Postbuild-Notices: erfolgreich.
- Nicht gelaufen: vollständige Unit-Suite, lokale Browser-/E2E-Prüfung,
  Hallmark-`sloplint`, Hallmark-Render/Capture, PDF-/JVM-/native Prüfläufe oder
  ein neuer GitHub-CI-Lauf. Keine Behauptung eines vollständigen Hallmark-Passes.
- Noch offen: Skill-Installation nach Auflösung des Launcher-Blockers sowie
  Hosted-Vorher/Nachher und Interaktionsabnahme des schmalen Shell-Patches.

Das Fundament ist ein kontrollierter Anfang des gewünschten Redesigns, nicht
die Behauptung einer bereits überarbeiteten Gesamt-App.
