# Prüfvorfall 2026-09-19: unbeabsichtigtes `migrate deploy` auf `prisma/dev.db`

Status: dokumentiert, keine Rücknahme und keine weitere Datenbankprüfung durch
diesen Agenten. Dieser Bericht enthält nur belegte Fakten aus dem Toolverlauf,
vorhandenen Ausgaben und bereits bekannten Dateimetadaten. Datenwerte und
Secrets werden nicht wiedergegeben.

## Auslöser und tatsächlich ausgeführter Befehl

Arbeitsverzeichnis des Befehls war:

`/home/pmeyhoefer/Dokumente/bivaro-kleinunternehmen`

Ausgeführt wurde exakt:

```sh
set -eu
probe_dir=$(mktemp -d /tmp/bivaro-start-probe-XXXXXX)
mkdir "$probe_dir/data"
probe_db="$probe_dir/data/prod.db"
node node_modules/prisma/build/index.js migrate deploy --schema="$PWD/prisma/schema.prisma" >/tmp/bivaro-start-migrate.out 2>&1 <<EOF
EOF
```

`probe_dir` und `probe_db` wurden zwar angelegt bzw. gesetzt, aber `probe_db`
wurde dem Prisma-Prozess nicht als `DATABASE_URL` übergeben. Es gab in diesem
Befehl keine `DATABASE_URL`-Überschreibung. Prisma lud deshalb die Repository-
`.env` und verwendete deren `DATABASE_URL="file:./dev.db"`, also
`prisma/dev.db` relativ zum Schema.

Der vorhandene Log [bivaro-start-migrate.out](/tmp/bivaro-start-migrate.out)
belegt:

```text
Environment variables loaded from .env
Prisma schema loaded from prisma/schema.prisma
Datasource "db": SQLite database "dev.db" at "file:./dev.db"
22 migrations found in prisma/migrations
Applying migration `20260918120000_auth_hardening`
Applying migration `20260918195000_bookkeeping_integrity`
The following migration(s) have been applied:
  20260918120000_auth_hardening
  20260918195000_bookkeeping_integrity
All migrations have been successfully applied.
```

Damit ist belegt, dass genau diese beiden Migrationen angewandt wurden:

- `20260918120000_auth_hardening`
- `20260918195000_bookkeeping_integrity`

## Belegter Datenbankeffekt

Der Prisma-Migrationsprozess hat `prisma/dev.db` geöffnet, den
Migrationsstand gelesen und die beiden genannten Migrationen angewandt. Die
Datei hatte danach laut bereits ausgeführtem Metadatenaufruf den Zeitstempel
`2026-09-19 09:58:19.851534317 +0200` und die Größe `327680` Bytes.

Es wurde von diesem Agenten vor dem Befehl keine Sicherung, kein Hash und kein
Snapshot von `prisma/dev.db` erstellt. Ob vor Beginn eine unabhängige Sicherung
existierte, wurde nicht geprüft und ist unbekannt. Der ausgeführte Befehl hat
keine Sicherung angelegt. Es wurde kein `VACUUM INTO`, kein `sqlite3`-Dump, kein
`PrismaClient`-Leseprogramm und kein Kopieren/Löschen von
`prisma/dev.db` ausgeführt. Es wurden keine Anwendungsdatenwerte ausgegeben.

Der genaue Zustand von Schema, Migrationsmetadaten und Daten vor dem Befehl ist
unbekannt. Eine Rücknahme oder ein Restore wurde nicht versucht.

Die Hauptaufgabe hat anschließend ausschließlich die beiden versionierten
SQL-Quelldateien gelesen, ohne die Datenbank zu öffnen:

- `20260918120000_auth_hardening` ergänzt `User.sessionVersion` mit Standardwert
  `0`, `AppSettings.singletonKey` mit Standardwert `global`, setzt diesen neuen
  Schlüssel bei zusätzlichen Settings-Zeilen auf `legacy-<id>` und legt
  `RateLimitBucket` samt Indizes an.
- `20260918195000_bookkeeping_integrity` ergänzt optionale Serien-/Terminfelder
  an `Expense` und die Angebotsreferenz an `Invoice`, erstellt Indizes und
  `InvoiceNumberCounter` und ersetzt den globalen Rechnungsnummernindex durch
  einen Index je Benutzer.

Diese SQL-Dateien enthalten weder eine Datensatzlöschung noch ein Update von
Betragsfeldern. Ohne Vorher-Sicherung oder Vorher-Messung ist damit trotzdem
kein vollständiger Nachweis über unveränderte Bestandsdaten möglich.

Die nachträgliche Metadatenprüfung ergab, dass `prisma/dev.db` von Git ignoriert
wird (`git status --short --ignored -- prisma/dev.db` zeigte `!! prisma/dev.db`);
`git ls-files` und `git log` lieferten dafür keinen Eintrag. Das sagt nichts
über eine vorhandene externe Sicherung aus.

## Abgrenzung der danach ausgeführten Experimente

Nach Erkennen des Fehlers wurden keine weiteren Befehle gegen
`prisma/dev.db` ausgeführt. Die folgenden späteren Datenbankexperimente
verwendeten ausdrücklich temporäre `/tmp`-Pfade:

```sh
DATABASE_URL="file:$probe_db" node node_modules/prisma/build/index.js migrate deploy --schema="$PWD/prisma/schema.prisma"
DATABASE_URL="file:$probe_db" DEBUG='*' node node_modules/prisma/build/index.js migrate deploy --schema="$PWD/prisma/schema.prisma"
DATABASE_URL="file:$probe_db" node --input-type=module   # nur SELECT 1 via PrismaClient
APP_ROOT="$PWD" DATABASE_URL="file:$probe_db" PRISMA_SCHEMA="$PWD/prisma/schema.prisma" PRISMA_CLI="$PWD/node_modules/prisma/build/index.js" sh docker-entrypoint.sh
```

Die beiden expliziten temporären `migrate deploy`-Versuche endeten mit
`Schema engine error`; der Startcheck gegen einen temporären Pfad endete vor
dem Serverstart am erwarteten Schema-Drift und ließ den vorher/nachher
verglichenen temporären Datei-Hash unverändert. Diese Vorgänge sind kein
Restore und ändern den Vorfallzustand von `prisma/dev.db` nicht.

Die URL-Experimente erzeugten außerdem folgende synthetische Nebenartefakte
unter `prisma/`. Nach Bestätigung ihrer Herkunft durch den verursachenden
Agenten hat die Hauptaufgabe ausschließlich diese beiden Testdateien entfernt:

- `prisma/%2Ftmp%2Fbivaro-encoded-q0L8Nr%2Fx%20y.db`
- `prisma/%2Ftmp%2Fbivaro-url-probe-lRf35e%2Fname%20with%20space.db`

Diese Artefakte stammen aus den Resolver-/Prisma-URLtests und waren nicht Teil
des Produktdatenpfads. Für die übrigen temporären Verzeichnisse und Logs unter
`/tmp` wurde nach dem letzten bekannten Toolaufruf kein neuer Existenzcheck
durchgeführt; ihr aktueller Zustand ist daher unbekannt.

## Separater Betriebs-/Secretvorfall

Unabhängig vom `dev.db`-Vorfall führte der Betriebsagent im Repository-Kontext
folgenden Befehl aus:

```sh
docker compose config >/tmp/bivaro-compose-config.out && sed -n '1,80p' /tmp/bivaro-compose-config.out
```

Root prüfte daraus ausschließlich Schlüsselnamen bzw. den Beleg, ob Werte nicht
leer waren. Der ausgegebene Konfigurationsbereich belegte:

- `NEXTAUTH_SECRET`: `nonempty=true`
- `SMTP_PASSWORD`: `nonempty=false`

Der Wert von `NEXTAUTH_SECRET` wird hier nicht wiedergegeben. Die temporäre
Datei `/tmp/bivaro-compose-config.out` wurde von Root exakt gelöscht; keine
andere Datei wurde dabei gelöscht. Die Toolausgabehistorie kann den Secretwert
weiterhin enthalten. Ob weitere Logs oder Stellen den Wert enthalten, wurde
nicht geprüft. Es gab keine automatische Rotation und keine Änderung an `.env`.

Der Docker-Build war unabhängig davon erfolgreich und erzeugte den Tag
`bivaro-bv001002-test:local`. Dieser Build ist kein Nachweis für eine Secret-
Rotation oder eine Freigabe des Datenbankzustands. Eine kontrollierte Rotation
von `NEXTAUTH_SECRET` ist eine offene Nutzer-/Betreibermaßnahme; sie wurde nicht
ausgeführt.

## Recovery-Optionen ohne Vollzug

1. Eine vorhandene Betreiber- oder Volume-Sicherung identifizieren und vor
   jeder Entscheidung ihre Erstellungszeit, den Migrationsstand und die
   Integrität prüfen.
2. Falls keine Sicherung existiert, die beiden Migration-SQL-Dateien und den
   aktuellen Datenbankzustand durch den zuständigen Betreiber prüfen lassen;
   insbesondere nicht von einer automatischen Rückwärtsmigration ausgehen.
3. Vor einer etwaigen Wiederherstellung eine unveränderliche Kopie des
   aktuellen Zustands anlegen und den Vergleich von Daten-/Schemaumfang,
   Migrationsmetadaten und Anwendungskompatibilität dokumentieren.

Keine dieser Optionen wurde durch diesen Agenten ausgeführt. Eine fachliche
Freigabe des aktuellen Datenbankzustands liegt nicht vor.
