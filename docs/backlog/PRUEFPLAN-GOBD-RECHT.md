# Prüf- und Abnahmeplan: GoBD, Steuer und rechtliche Restarbeit

Stand: 19.09.2026. Dieser Plan beschreibt die noch erforderlichen Nachweise.
Er ist keine Steuerberatung, keine Rechtsberatung und keine GoBD-Zertifizierung.
Eine technische Testreihe allein erteilt keine fachliche oder produktive Freigabe.

## 1. Prüfrahmen vor der Abnahme festlegen

Vor jedem fachlichen Urteil müssen Betreiber und fachliche Prüfer den
Anwendungsbereich schriftlich festlegen. Ohne diese Festlegung kann ein grüner
Test nur für die konkrete Testkonfiguration gelten.

| Festlegung | Mindestens zu dokumentieren | Abnahmekriterium |
|---|---|---|
| Betriebsform | Einzelunternehmen/andere Rechtsform, EÜR oder Bilanzierung, Kleinunternehmerstatus, eigene Nutzung oder Dienstbetrieb | Verantwortlicher Steuerfachprüfer bestätigt, welche Fälle die Anwendung abdecken soll. Nicht unterstützte Fälle werden im Produkt und in der Verfahrensdokumentation als Grenze geführt. |
| Steuerjahre | Erstes und letztes unterstütztes Veranlagungsjahr, Version der Tarife und Formularstände | Jede Berechnung und jeder Export trägt das Jahr und die verwendete Regelversion. Ein nicht unterstütztes Jahr wird abgelehnt oder klar als nicht geprüft ausgegeben. |
| Datenarten | Rechnungen, Zahlungen, Kassenbuch, Ausgaben, Belege, EÜR-Export, Auditdaten, Backups und Dokumentation | Für jede Datenart gibt es eine verantwortliche Person, einen Entstehungsprozess, eine Aufbewahrungsklasse und einen Wiederherstellungsweg. |
| Betriebsmodell | Lokale Installation, eigener Server oder Hosting; Datenbank, Dateispeicher, Backups, Zugriff durch Dienstleister | Betreiber kontrolliert Verschlüsselung, Zugriffe, Sicherungsort und Wiederherstellung separat. Das Programm behauptet diese Kontrollen nicht automatisch. |

Maßgebliche Startpunkte und Fristen sind je Unterlagenart zu bestimmen. § 147
AO knüpft den Beginn unter anderem an das Ende des Kalenderjahres, in dem der
Buchungsbeleg entstanden oder die Aufzeichnung vorgenommen wurde. Die konkrete
Einordnung und ein möglicher Legal Hold müssen durch die verantwortliche
Fachperson erfolgen; ein pauschaler Timer im Programm ersetzt diese Prüfung
nicht. Siehe [§ 147 AO](https://www.gesetze-im-internet.de/ao_1977/__147.html).

## 2. Verfahrensdokumentation fachlich freigeben

Das vorhandene Template ist ein Ausgangspunkt. Es wird erst durch betriebliche
Angaben, Version, Gültigkeitsdatum, Verantwortlichen und Freigabe zu einer
verwendbaren Verfahrensdokumentation.

Der Prüfer bestätigt anhand eines konkreten Prozessdurchlaufs:

1. Belegannahme und Erfassung mit Quelle, Datum, Betrag, Zuordnung und
   Bearbeiter;
2. Prüfung, Korrektur und Freigabe einschließlich des ursprünglichen Zustands;
3. Zahlung, Kassenbuch, EÜR-Zuordnung und ggf. Erstattung als getrennte,
   nachvollziehbare Ereignisse;
4. Belegablage einschließlich Dateiname, Original, Zugriff und Export;
5. Sicherung, Restore, Fehlerbehandlung und Wiederanlauf;
6. Rollen, Vertretung, Supportzugriff und regelmäßige Kontrolle; und
7. Änderungen an Programm, Datenmodell und Verfahren mit alter Version,
   Freigabe und Wirksamkeitsdatum.

Als fachliche Referenz ist die aktuelle Fassung der [GoBD einschließlich der
2. Änderung vom 14.07.2025](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Weitere_Steuerthemen/Abgabenordnung/2025-07-14-GoBD-2-aenderung.html)
zu verwenden. Die Verfahrensdokumentation muss die tatsächliche
Betriebsumgebung beschreiben; ein unveränderter Template-Text genügt nicht.

## 3. Offene GoBD- und Lebenszyklusprüfungen

| Prüfpunkt | Konkreter Nachweis | Sperre für Freigabe |
|---|---|---|
| Deaktivierung und Historie (BV-007 AC1/AC2) | Isolierte Fixture mit Benutzer, Rechnung, Zahlung, Beleg und Audit; Deaktivierung in einer Transaktion; alter Session-/API-Key wird serverseitig abgewiesen; Datensätze und Audit-Referenzen bleiben lesbar. | Einer der beiden Zugriffs- oder Erhaltungsnachweise fehlt. |
| Retention und Legal Hold (BV-007 AC3/AC4, BV-009) | Fristklassen und Startregeln je Datenart, Hold-Fall, abgelaufener Fall, Freigabe durch benannte Rolle, datensparsamer Löschentscheidungsnachweis; Test des abgelehnten Löschens unter Hold. | Es gibt nur eine globale Löschfrist, keinen Hold-Nachweis oder keine verantwortliche Freigabe. |
| Auditabdeckung (BV-006/BV-009) | Matrix aller schreibenden Routen inklusive Import, Quote-Umwandlung, Zahlung, Kasse, Restore und Benutzerverwaltung; je Route Transaktion, Auditereignis oder dokumentierte Begründung. | Eine buchungsrelevante Mutation ist weder in derselben Transaktion protokolliert noch ausdrücklich begründet. |
| Originalerhalt und Änderungen | Fixture mit Originalbeleg, Korrektur, Erstattung und Statuswechsel; Originalinhalt, Herkunft, Zeit, Bearbeiter und Gegenereignis bleiben prüfbar. | Nachträgliche Änderung überschreibt den ursprünglichen prüfungsrelevanten Zustand oder trennt Audit und Fachänderung. |
| Export und Zugriff | EÜR-/JSON-/ZIP-Export mit Zeitraum, Datenstand, Version und Prüfsumme; maschinell lesbarer Export wird in einer frischen isolierten Umgebung eingelesen und verglichen. | Export enthält nicht alle erwarteten Daten, ist zeitlich nicht bestimmbar oder kann nicht nachvollziehbar eingelesen werden. |
| Restore (BV-029 bis BV-033) | Vorsicherung, Dry-run, Hash-/Manifestprüfung, fachliche Summen, negative und widersprüchliche Fälle, Restore-Abbruch ohne Teilübernahme, Reconciliation nach Restore. | Restore verändert trotz Fehlern teilweise Daten oder es fehlt eine geprüfte Vorsicherung. |
| Betreiberkontrollen | Nachweis über Verschlüsselung, Zugriffsschutz, Sicherungsort, Restore-Verantwortlichen und regelmäßige Kontrolle in der konkreten Umgebung. | Template behauptet eine Kontrolle, die in der Betriebsumgebung nicht nachgewiesen ist. |

Für die Aufbewahrung sind die konkrete Unterlagenart, die gesetzliche
Einordnung, Beginn, Ende, Hold und Freigabe zu protokollieren. Das Programm
darf keine pauschale GoBD-Erfüllung aus dem Vorhandensein eines Audit-Logs
ableiten.

## 4. Steuerliche Fachabnahme mit reproduzierbaren Beispielen

Die Steuer- und EÜR-Agenten liefern Code und Tests für BV-019 bis BV-024 sowie
BV-026/BV-027. Die fachliche Abnahme erfolgt anschließend mit einem unabhängig
berechneten Erwartungsblatt des Steuerfachprüfers. Für jedes Beispiel werden
Eingabedaten, Steuerjahr, Regelstand, erwartete Zwischensummen, Ergebnis,
Rundungsregel und Exportdatei archiviert.

Mindestens abzunehmen sind:

- mehr als 100 Einnahmen und Ausgaben sowie ein Vergleich mit der vollständigen
  Serveraggregation;
- identischer Gewinn in Dashboard, EÜR und Steuersimulation, einschließlich
  Abschreibung, Steuerrelevanz und abziehbarem Anteil;
- positive und negative Korrekturen, Erstattungen, Stornos und Zahlungen mit
  fachlichem Zahlungsdatum;
- §-35-Anrechnung, Freibetrag, Hebesatz und Begrenzung auf den zutreffenden
  Gewerbesteueranteil;
- Einkommensteuertarif, Solidaritätszuschlag, Mindest-/Freigrenzen und
  Endrundung für jedes unterstützte Jahr;
- explizit unterstützte und abgelehnte Sonderfälle (weitere Einkünfte,
  Verluste, unterschiedliche Unternehmens-/Veranlagungsarten); und
- jahresversionierter EÜR-Export mit der tatsächlich belegten
  Formatbezeichnung. Ein behaupteter ELSTER-Import braucht einen echten
  Importnachweis für den angegebenen Formularstand.

Ein bestandener Unit-Test oder ein Vergleich mit derselben Implementierung ist
kein unabhängiger fachlicher Erwartungswert. Die Abnahme benötigt deshalb
eine zweite Berechnung oder eine benannte fachkundige Prüfung.

## 5. Rechtlicher Review und Freigabegates

Der rechtliche Review prüft mindestens Datenschutz, Rollen-/Zugriffsmodell,
Aufbewahrung und Löschung, Beleg-/Originalerhalt, Backup-/Restore-Zugriff,
Produkttexte sowie die Abgrenzung von Steuerinformation und Steuerberatung.
Die prüfende Person dokumentiert Rechtsgrundlage, Betriebsannahme, Datum,
Version und offene Einschränkungen. Ein Review darf keine allgemeine
Konformität zusagen, wenn Betriebsprozesse oder externe Kontrollen fehlen.

Die Freigabefolge lautet:

1. **G0 – Scope:** Betriebsform, Steuerjahre, Datenarten und Betriebsmodell
   sind bestätigt.
2. **G1 – technische Evidenz:** betroffene Tests, Audit-/Exportmatrix,
   Restore- und Retention-Fälle laufen in isolierten Fixtures; Testzahlen und
   Commit werden festgehalten.
3. **G2 – Fachabnahme:** Steuerfachprüfung und Verfahrensdokumentation sind
   durch Verantwortliche signiert; negative und nicht unterstützte Fälle sind
   sichtbar.
4. **G3 – rechtliche/operative Freigabe:** Rechtsreview, Betreiberkontrollen,
   Backup-/Restore-Verantwortung und Rollbackplan liegen für die konkrete
   Umgebung vor.

Bis G3 darf die Produktkommunikation nur „technisch geprüft für den
beschriebenen Umfang“ beziehungsweise „offene Betreiber-/Fachprüfung“ sagen.
Ein grüner Build, eine Testgesamtzahl oder ein ausgefülltes Template hebt die
Gates nicht auf.

## 6. Status und Evidenzführung

Für jeden Prüfpunkt werden Ticket, AC, Test/Fixture, Ergebnis, Datum,
Verantwortlicher, Commit oder uncommitted-Stand, offene Abweichung und Link
zum Artefakt in `TICKETSTATUS.md` und `ticket-status.json` geführt. Fehlende
Nachweise bleiben „offen“; sie werden nicht aus einer plausiblen
Implementierung abgeleitet. Diese Datei ergänzt die Ticketstatusdateien und
ändert keine Produktclaims.
