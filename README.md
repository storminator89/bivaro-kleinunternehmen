<div align="center">

# Bivaro

**Buchhaltung und Büroalltag für Selbstständige und kleine Unternehmen in Deutschland.**

Selbst gehostet · Angebote bis Belegprüfung · Heller und dunkler Modus

**Deutsch** · [English](README.en.md)

</div>

## Funktionen

| Bereich | Aktueller Funktionsumfang |
| --- | --- |
| **Überblick** | Einnahmen, Ausgaben, Kennzahlen, Jahresvergleich und nächste Schritte für offene Rechnungen, Angebote und Belegprüfungen. |
| **Angebote & Rechnungen** | Angebote in Rechnungen übernehmen, Vorlagen, Zahlungsziele, Kleinunternehmer- und Standard-Umsatzsteuermodus. Eigene Rechnungen mit eingebettetem Factur-X-/ZUGFeRD-XML und abschließender PDF/A-3b-Prüfung. |
| **Kunden & Leistungen** | Kunden und Lieferanten, Kundenverlauf, Artikel-/Leistungskatalog sowie geprüfter CSV-Import für Kunden und Artikel. Projekte, manuelle Zeiten, Leistungsaufstellungen und bestätigte wiederkehrende Entwürfe. |
| **Zahlungen & Bank-CSV** | Teilzahlungen, Restbeträge und Zahlungsjournal. CSV-Vorschau mit Dublettenhinweisen; gespeicherte Umsätze ausdrücklich als Zahlung erfassen und unterstützte Zuordnungen ändern. |
| **Belege & Ausgaben** | Originale archivieren, E-Rechnungsdaten auslesen, Prüfentwürfe fortsetzen und unterstützte Ausgaben ausdrücklich bestätigen. Ausgabendetails mit Originalbezug; optionale KI-Vorschläge. |
| **Auswertungen** | Einnahmen-/Ausgabenlisten, Kassenbuch, GWG-Verzeichnis, Steuersimulation, vereinfachtes EÜR-CSV für 2024–2026 und neutrale Übergabepakete. |
| **Versand & Integration** | Optionaler bestätigter SMTP-Versand von Rechnungen und Angeboten, Versandversuche, Benutzerrollen und benutzerspezifische API-Schlüssel. |
| **Datensicherung** | JSON- und vollständige ZIP-Backups mit Vorschau und versionsgebundener Wiederherstellung. |

## Einblicke

<table>
  <tr>
    <td width="50%" valign="top"><strong>Dashboard</strong><br><a href="docs/screenshots/2026-10-25/dashboard-overview-light-1440.png"><img src="docs/screenshots/2026-10-25/dashboard-overview-light-1440.png" alt="Dashboard mit Jahresvergleich, synthetischen Kennzahlen und nächsten Schritten" width="400"></a></td>
    <td width="50%" valign="top"><strong>Rechnungen</strong><br><a href="docs/screenshots/2026-10-25/invoice-redesign-light-1600.png"><img src="docs/screenshots/2026-10-25/invoice-redesign-light-1600.png" alt="Rechnungsliste mit synthetischem teilbezahltem Beleg und ausdrücklich begrenzter Seitensumme" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Kunden</strong><br><a href="docs/screenshots/2026-10-25/customer-redesign-directory-light-1440.png"><img src="docs/screenshots/2026-10-25/customer-redesign-directory-light-1440.png" alt="Kundenverzeichnis mit synthetischen Namen, example.test-Kontakten und Datensatzaktionen" width="400"></a></td>
    <td width="50%" valign="top"><strong>Belegeingang</strong><br><a href="docs/screenshots/2026-10-25/catalog-inbox-receipts-light-1440.png"><img src="docs/screenshots/2026-10-25/catalog-inbox-receipts-light-1440.png" alt="Belegeingang mit synthetischem Original, offenem Prüfstatus und internen Aufgabenfiltern" width="400"></a></td>
  </tr>
</table>

<details>
<summary>Verkauf &amp; nächste Schritte</summary>

<table>
  <tr>
    <td width="50%" valign="top"><strong>Datensuche</strong><br><a href="docs/screenshots/2026-10-25/record-search-continuation-1440.png"><img src="docs/screenshots/2026-10-25/record-search-continuation-1440.png" alt="Datensuche mit ausgewähltem synthetischem Kunden auf Seite 2, getrennten Beleggruppen und ausdrücklich begrenzter Seitennavigation" width="400"></a></td>
    <td width="50%" valign="top"><strong>Heute erledigen</strong><br><a href="docs/screenshots/2026-10-25/bank-billing-today-light-1440.png"><img src="docs/screenshots/2026-10-25/bank-billing-today-light-1440.png" alt="Tagesübersicht mit synthetischen offenen Schritten und ausdrücklich unbekanntem Belegbetrag" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Angebote</strong><br><a href="docs/screenshots/2026-10-25/quote-redesign-light-1440.png"><img src="docs/screenshots/2026-10-25/quote-redesign-light-1440.png" alt="Angebotsliste mit synthetischem angenommenem Angebot, Wiedervorlage und Folgeaktionen" width="400"></a></td>
    <td width="50%" valign="top"><strong>Rechnung erstellen</strong><br><a href="docs/screenshots/2026-10-25/invoice-editor-1440.png"><img src="docs/screenshots/2026-10-25/invoice-editor-1440.png" alt="Unbefüllter Rechnungseditor mit offenem Steuerprofil, Positionen und Zahlungsziel; noch keine Rechnung erstellt" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Angebot erstellen</strong><br><a href="docs/screenshots/2026-10-25/quote-editor-1440.png"><img src="docs/screenshots/2026-10-25/quote-editor-1440.png" alt="Unbefüllter Angebotseditor mit Steuerwahl, Empfänger, Positionen und Gültigkeitsdatum" width="400"></a></td>
    <td width="50%" valign="top"><strong>Rechnungsdetails · Mobil</strong><br><a href="docs/screenshots/2026-10-25/invoice-details-375.png"><img src="docs/screenshots/2026-10-25/invoice-details-375.png" alt="Mobile Rechnungsdetails eines synthetischen bezahlten Belegs mit Zahlungsstand und Originaldatei" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Teilzahlungen &amp; Zahlungsjournal</strong><br><a href="docs/screenshots/2026-10-25/partial-payments-1440-two-events.png"><img src="docs/screenshots/2026-10-25/partial-payments-1440-two-events.png" alt="Gespeicherter synthetischer Zahlungsnachweis und Zahlungsstand im gescrollten Rechnungsdialog" width="400"></a></td>
    <td width="50%" valign="top"><strong>Mahnwesen</strong><br><a href="docs/screenshots/2026-10-25/records-history-reminder-queue-light-1440.png"><img src="docs/screenshots/2026-10-25/records-history-reminder-queue-light-1440.png" alt="Mahnübersicht mit synthetischer überfälliger Rechnung, offenem Restbetrag und Hinweis auf rein interne Erfassung" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Rechnungshistorie</strong><br><a href="docs/screenshots/2026-10-25/records-history-history-evidence-light-1440.png"><img src="docs/screenshots/2026-10-25/records-history-history-evidence-light-1440.png" alt="Rechnungshistorie mit synthetischem Original, getrenntem Zahlungsnachweis und protokollierten Ereignissen" width="400"></a></td>
  </tr>
</table>

</details>

<details>
<summary>Kunden, Katalog &amp; Leistungen</summary>

<table>
  <tr>
    <td width="50%" valign="top"><strong>Kundenverlauf</strong><br><a href="docs/screenshots/2026-10-25/customer-timeline-desktop-1440.png"><img src="docs/screenshots/2026-10-25/customer-timeline-desktop-1440.png" alt="Kundenverlauf mit synthetischen Angeboten, Rechnungen und Zahlungsnachweisen" width="400"></a></td>
    <td width="50%" valign="top"><strong>Artikel &amp; Leistungen</strong><br><a href="docs/screenshots/2026-10-25/catalog-inbox-articles-light-1440.png"><img src="docs/screenshots/2026-10-25/catalog-inbox-articles-light-1440.png" alt="Artikel- und Leistungskatalog mit synthetischen Positionen, Nettopreisen und Steuerangaben" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Kunden-CSV</strong><br><a href="docs/screenshots/2026-10-25/csv-redesign-customer-preview-light-1440.png"><img src="docs/screenshots/2026-10-25/csv-redesign-customer-preview-light-1440.png" alt="Unbestätigte Kunden-CSV-Vorschau mit gültigem, fehlerhaftem und doppeltem synthetischem Datensatz" width="400"></a></td>
    <td width="50%" valign="top"><strong>Artikel-CSV</strong><br><a href="docs/screenshots/2026-10-25/csv-redesign-article-preview-light-1440.png"><img src="docs/screenshots/2026-10-25/csv-redesign-article-preview-light-1440.png" alt="Unbestätigte Artikel-CSV-Vorschau mit synthetischem Bruttopreis, Nettoumrechnung und Steuerangaben" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Projekte &amp; Zeiten</strong><br><a href="docs/screenshots/2026-10-25/project-services-workbench-desktop-1440.png"><img src="docs/screenshots/2026-10-25/project-services-workbench-desktop-1440.png" alt="Leistungsnotizen für synthetische Kunden mit Projektauswahl, manueller Dauer und offenen Leistungen" width="400"></a></td>
    <td width="50%" valign="top"><strong>Leistungsübersicht</strong><br><a href="docs/screenshots/2026-10-25/records-history-service-ledger-top-light-1440.png"><img src="docs/screenshots/2026-10-25/records-history-service-ledger-top-light-1440.png" alt="Synthetische Leistungsnotizen mit manueller Dauer, freier Menge und ausdrücklich zugeordneter Rechnung" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Leistungsaufstellung</strong><br><a href="docs/screenshots/2026-10-25/service-statement-preview-1440.png"><img src="docs/screenshots/2026-10-25/service-statement-preview-1440.png" alt="Vorschau einer synthetischen Leistungsaufstellung mit Dauer und ausdrücklich keiner Rechnung oder Abnahme" width="400"></a></td>
    <td width="50%" valign="top"><strong>Servicepläne</strong><br><a href="docs/screenshots/2026-10-25/bank-billing-service-plans-light-1440.png"><img src="docs/screenshots/2026-10-25/bank-billing-service-plans-light-1440.png" alt="Synthetischer monatlicher Serviceplan mit offenem Zeitraum und bewusster Entwurfs- oder Überspringen-Aktion" width="400"></a></td>
  </tr>
</table>

</details>

<details>
<summary>Buchhaltung &amp; Belegprüfung</summary>

<table>
  <tr>
    <td width="50%" valign="top"><strong>Einnahmen</strong><br><a href="docs/screenshots/2026-10-25/cashflow-income-light-1440.png"><img src="docs/screenshots/2026-10-25/cashflow-income-light-1440.png" alt="Einnahmenliste und ungespeichertes Formular mit synthetischen Herkunfts- und Zuordnungsangaben" width="400"></a></td>
    <td width="50%" valign="top"><strong>Ausgaben · Dunkelmodus</strong><br><a href="docs/screenshots/2026-10-25/cashflow-expense-dark-1440.png"><img src="docs/screenshots/2026-10-25/cashflow-expense-dark-1440.png" alt="Ausgabenliste im Dunkelmodus mit ungespeichertem Formular sowie synthetischen manuellen und originalgebundenen Belegen" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Ausgabe &amp; Original</strong><br><a href="docs/screenshots/2026-10-25/catalog-inbox-expense-light-1440.png"><img src="docs/screenshots/2026-10-25/catalog-inbox-expense-light-1440.png" alt="Synthetische gespeicherte Ausgabe mit unverändertem Originalbezug und getrennten Zahlungs- und Originaldaten" width="400"></a></td>
    <td width="50%" valign="top"><strong>Belegprüfung &amp; Prüfentwurf</strong><br><a href="docs/screenshots/2026-10-25/receipt-sequence-desktop-1440.png"><img src="docs/screenshots/2026-10-25/receipt-sequence-desktop-1440.png" alt="Gespeicherter, ausdrücklich nicht gebuchter synthetischer Prüfentwurf mit Belegfolge und manuellen Feldern" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>E-Rechnungsprüfung</strong><br><a href="docs/screenshots/2026-10-25/incoming-validation-desktop-1440.png"><img src="docs/screenshots/2026-10-25/incoming-validation-desktop-1440.png" alt="Technische Prüfung einer synthetischen E-Rechnung mit Regelpaket, Prüfschritten und ausdrücklicher fachlicher Prüfgrenze" width="400"></a></td>
    <td width="50%" valign="top"><strong>Lieferantenaufgaben</strong><br><a href="docs/screenshots/2026-10-25/supplier-tasks-1440.png"><img src="docs/screenshots/2026-10-25/supplier-tasks-1440.png" alt="Gespeicherte synthetische Lieferantenvormerkung ohne Zahlung, Buchung oder Benachrichtigung" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Kassenbuch · Einstieg</strong><br><a href="docs/screenshots/2026-10-25/cashbook-1440.png"><img src="docs/screenshots/2026-10-25/cashbook-1440.png" alt="Kassenbuch-Einstiegsseite ohne angelegte Kasse mit Aktion zum Erstellen" width="400"></a></td>
  </tr>
</table>

</details>

<details>
<summary>Bank-CSV &amp; Zuordnung</summary>

<table>
  <tr>
    <td width="50%" valign="top"><strong>Bank-CSV &amp; Vorschau</strong><br><a href="docs/screenshots/2026-10-25/bank-billing-bank-preview-light-1440.png"><img src="docs/screenshots/2026-10-25/bank-billing-bank-preview-light-1440.png" alt="Unbestätigte Vorschau synthetischer Bank-CSV-Zeilen mit getrennten Ein- und Ausgängen" width="400"></a></td>
    <td width="50%" valign="top"><strong>Zahlungszuordnung</strong><br><a href="docs/screenshots/2026-10-25/bank-billing-bank-allocation-light-1440.png"><img src="docs/screenshots/2026-10-25/bank-billing-bank-allocation-light-1440.png" alt="Unbestätigte Zuordnung eines synthetischen CSV-Umsatzes zu einer Rechnung mit ausdrücklicher Zahlungskontrolle" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Bank-Zuordnungsprofile</strong><br><a href="docs/screenshots/2026-10-25/feature-profiles-light-1440.png"><img src="docs/screenshots/2026-10-25/feature-profiles-light-1440.png" alt="Synthetisches CSV-Zuordnungsprofil mit Revision, Spaltenauswahl und getrennten Importbestätigungen" width="400"></a></td>
  </tr>
</table>

</details>

<details>
<summary>Auswertungen &amp; Übergabe</summary>

<table>
  <tr>
    <td width="50%" valign="top"><strong>EÜR</strong><br><a href="docs/screenshots/2026-10-25/financial-reports-eur-light-1440.png"><img src="docs/screenshots/2026-10-25/financial-reports-eur-light-1440.png" alt="EÜR-Bericht mit synthetischen Beträgen, Einnahmen-Ausgaben-Vergleich und getrennten Privatentnahmen" width="400"></a></td>
    <td width="50%" valign="top"><strong>GWG-Verzeichnis</strong><br><a href="docs/screenshots/2026-10-25/financial-reports-gwg-light-1440.png"><img src="docs/screenshots/2026-10-25/financial-reports-gwg-light-1440.png" alt="GWG-Verzeichnis mit synthetischem Wirtschaftsgut, Nettobetrag und Jahresauswahl" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Steuer-Simulation</strong><br><a href="docs/screenshots/2026-10-25/tax-studio-1440.png"><img src="docs/screenshots/2026-10-25/tax-studio-1440.png" alt="Vollständige Steuersimulation für ein synthetisches Regeljahr mit Nebenerwerbsannahmen, In-App-Datenbasis und Modellgrenzen" width="400"></a></td>
    <td width="50%" valign="top"><strong>Unterlagen übergeben</strong><br><a href="docs/screenshots/2026-10-25/accountant-guide-1440-readiness.png"><img src="docs/screenshots/2026-10-25/accountant-guide-1440-readiness.png" alt="Synthetische Übergabevorschau mit offenen Prüfaufgaben, fehlendem Original und noch nicht bestätigter Freigabe" width="400"></a></td>
  </tr>
</table>

</details>

<details>
<summary>Einstellungen, Verwaltung &amp; API</summary>

<table>
  <tr>
    <td width="50%" valign="top"><strong>Einstellungen</strong><br><a href="docs/screenshots/2026-10-25/settings-redesign-light-1440.png"><img src="docs/screenshots/2026-10-25/settings-redesign-light-1440.png" alt="Vollständige Einstellungsseite mit synthetischen Firmendaten, Steuerprofil und optionalen Integrationen" width="400"></a></td>
    <td width="50%" valign="top"><strong>Backup-Vorschau</strong><br><a href="docs/screenshots/2026-10-25/settings-redesign-backup-light-1440.png"><img src="docs/screenshots/2026-10-25/settings-redesign-backup-light-1440.png" alt="Synthetische Backup-Vorschau mit fehlenden Dateien und ausdrücklicher Warnung vor dem Überschreiben" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Nummernkreise</strong><br><a href="docs/screenshots/2026-10-25/feature-numbering-light-1440.png"><img src="docs/screenshots/2026-10-25/feature-numbering-light-1440.png" alt="Originalaufnahme des Nummernkreis-Bereichs mit synthetischem Rechnungsformat und nicht reservierter Vorschau" width="400"></a></td>
    <td width="50%" valign="top"><strong>Optionale Beleg-KI</strong><br><a href="docs/screenshots/2026-10-25/ai-receipt-settings-desktop.png"><img src="docs/screenshots/2026-10-25/ai-receipt-settings-desktop.png" alt="Optionale KI-Beleganalyse mit synthetischer Anbieteradresse, verborgenem Schlüssel und bewusster Automatikfreigabe" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Benutzerverwaltung</strong><br><a href="docs/screenshots/2026-10-25/users-1440.png"><img src="docs/screenshots/2026-10-25/users-1440.png" alt="Benutzerverwaltung mit einem aktiven synthetischen example.test-Administratorkonto und Rollenaktionen" width="400"></a></td>
    <td width="50%" valign="top"><strong>API-Schlüssel · Einstieg</strong><br><a href="docs/screenshots/2026-10-25/api-keys-1440.png"><img src="docs/screenshots/2026-10-25/api-keys-1440.png" alt="API-Schlüsselverwaltung mit leerer Schlüsselliste, Erstellen-Aktion und CORS-Einstellungen; keine Zugangsdaten sichtbar" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>API-Dokumentation</strong><br><a href="docs/screenshots/2026-10-25/api-docs-1440.png"><img src="docs/screenshots/2026-10-25/api-docs-1440.png" alt="Vollständige API-Dokumentation mit Platzhalterschlüsseln, Endpunkten, Beispielen und begrenzten API-Hinweisen" width="400"></a></td>
    <td width="50%" valign="top"><strong>Audit-Log</strong><br><a href="docs/screenshots/2026-10-25/audit-1440.png"><img src="docs/screenshots/2026-10-25/audit-1440.png" alt="Audit-Log mit synthetischen Registrierungs- und Anmeldeereignissen und maskierter lokaler IP-Adresse" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Verfahrensdokumentation</strong><br><a href="docs/screenshots/2026-10-25/procedures-1440.png"><img src="docs/screenshots/2026-10-25/procedures-1440.png" alt="Noch nicht gespeicherte Verfahrensdokumentation mit Musterfeldern, Systeminformationen und Abschnittsauswahl" width="400"></a></td>
  </tr>
</table>

</details>

<details>
<summary>Produkt, Hilfe &amp; Zugang</summary>

<table>
  <tr>
    <td width="50%" valign="top"><strong>Produktübersicht · Mobil</strong><br><a href="docs/screenshots/2026-10-25/home-pilot-390.png"><img src="docs/screenshots/2026-10-25/home-pilot-390.png" alt="Mobile Produktübersicht mit ausdrücklich gekennzeichneter Demoansicht, Aufgabenlinks und Zugang über den Betreiber" width="400"></a></td>
    <td width="50%" valign="top"><strong>Aufgabenhilfe · Mobil</strong><br><a href="docs/screenshots/2026-10-25/help-pilot-390.png"><img src="docs/screenshots/2026-10-25/help-pilot-390.png" alt="Mobile Aufgabenhilfe mit Schritten für Rechnung, Zahlung, Ausgabe und Unterlagenübergabe" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Zugangshilfe</strong><br><a href="docs/screenshots/2026-10-25/access-help-1440.png"><img src="docs/screenshots/2026-10-25/access-help-1440.png" alt="Zugangshilfe mit Wiederherstellungs- und Sicherheitshinweisen, ohne Resetlink, Kennwörter oder vertrauliche Eingaben" width="400"></a></td>
    <td width="50%" valign="top"><strong>Anmelden</strong><br><a href="docs/screenshots/2026-10-25/login-public.png"><img src="docs/screenshots/2026-10-25/login-public.png" alt="Leere öffentliche Anmeldemaske mit Passwortfeld und Link zur Zugangshilfe" width="400"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Registrierung · geschlossen</strong><br><a href="docs/screenshots/2026-10-25/register-public.png"><img src="docs/screenshots/2026-10-25/register-public.png" alt="Registrierungsseite im tatsächlich geschlossenen Zustand mit Verweis auf den Administrator" width="400"></a></td>
  </tr>
</table>

</details>

49 echte Ansichten aller Seiten und Dashboard-Tabs mit synthetischen Testdaten, Stand 25.10.2026. Bereiche oben aufklappen; jedes Bild öffnet das vollständige Original. [Bildnachweise und Abdeckung](docs/screenshots/README.md).

## Schnellstart

Voraussetzung: Docker Engine mit Compose-Plugin und Git.

```bash
git clone https://github.com/storminator89/bivaro-kleinunternehmen.git
cd bivaro-kleinunternehmen
cp .env.example .env
```

In `.env` **eigene Werte** setzen: `NEXTAUTH_SECRET` (z. B. `openssl rand -base64 32`), `BIVARO_SETUP_TOKEN` (z. B. `openssl rand -hex 32`) und `NEXTAUTH_URL` (lokal `http://localhost:3000`, öffentlich die exakte HTTPS-URL).

```bash
docker compose config --quiet
docker compose up -d --build
```

`http://localhost:3000/register` öffnen und das erste Admin-Konto mit dem Setup-Token erstellen. Anschließend Firmendaten, Steuerprofil und Bankverbindung prüfen. Weitere Registrierung muss ein Admin freigeben.

**Bestehende Installation:** Datenbank und Uploads sichern, vor Migrationen alle DB-Schreiber stoppen. Eine App-Instanz je SQLite-Datenbank; `docker compose down -v` löscht Daten. [Einrichtung, Updates, Backup, SMTP/KI und Entwicklung](docs/operations/getting-started.de.md).

## Wichtige Grenzen

- **Keine Steuer- oder Compliance-Zertifizierung:** technische PDF-/XML-Prüfung ist keine fachliche Freigabe; kein ELSTER-Versand.
- **Keine Bankautomatik:** kein Bankzugang, keine Überweisung oder automatische Abstimmung. CSV-Speichern bucht nichts und archiviert nicht die Rohdatei. Zahlungserfassung/Umzuordnung unterstützen nur begrenzte EUR-Kleinunternehmerfälle; Korrekturen können Auswertungen sperren. [Zahlungsregeln](docs/features/bank-payment-allocation.md).
- **Bewusste Freigaben:** keine automatische Serviceabrechnung, Zahlung oder Wiederholung unbekannter Versandresultate. SMTP-Annahme ist kein Zustellnachweis.
- **KI optional:** standardmäßig aus, eigene Anbieterfreigabe und mögliche Kosten/Datenschutzpflichten. Vorschläge bleiben ungeprüft; PDFs sind auf 6 MiB und 1–4 vollständige Seiten begrenzt. [KI-Vertrag](docs/ai/provider-contract.md).
- **Sicher betreiben:** öffentlich nur mit HTTPS; Geheimnisse privat halten. Für Originaldateien vollständige ZIP-Backups verwenden; Servergeheimnisse und Anbieterzugänge separat sichern. Kein eingebauter E-Mail-Passwortreset oder MFA-Self-Service. [Zugangshilfe](docs/operations/account-access.md).

## Lizenz

Die Anwendung steht unter **[Apache License 2.0](LICENSE) (`Apache-2.0`)**. Drittanbieter und Schriftarten behalten ihre eigenen Lizenzen; dies ist keine pauschale Lizenzfreigabe des Containers. [Drittanbieterhinweise](docs/operations/pdf-third-party-notices.md) · [Lizenzdetails](docs/legal/application-license-transition.md).
