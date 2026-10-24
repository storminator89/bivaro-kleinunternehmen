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
    <td width="50%" valign="top"><strong>Kunden</strong><br><a href="docs/screenshots/customer-redesign-directory-light-1440.png"><img src="docs/screenshots/customer-redesign-directory-light-1440.png" alt="Kundenverzeichnis mit synthetischen Kontakten und Datensatzaktionen" width="440"></a></td>
    <td width="50%" valign="top"><strong>Rechnungen</strong><br><a href="docs/screenshots/invoice-redesign-light-1600.png"><img src="docs/screenshots/invoice-redesign-light-1600.png" alt="Rechnungsarbeitsbereich mit synthetischen Belegen, Status und Beträgen" width="440"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Einnahmen</strong><br><a href="docs/screenshots/cashflow-income-light-1440.png"><img src="docs/screenshots/cashflow-income-light-1440.png" alt="Einnahmenübersicht mit geöffnetem Erfassungsformular, synthetischen Beträgen und getrennten Herkunfts- und Zuordnungshinweisen" width="440"></a></td>
    <td width="50%" valign="top"><strong>Ausgaben · Dunkelmodus</strong><br><a href="docs/screenshots/cashflow-expense-dark-1440.png"><img src="docs/screenshots/cashflow-expense-dark-1440.png" alt="Ausgabenübersicht im Dunkelmodus mit Erfassungsformular und synthetischen originalgebundenen und manuellen Belegen" width="440"></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Leistungskatalog</strong><br><a href="docs/screenshots/catalog-inbox-articles-light-1440.png"><img src="docs/screenshots/catalog-inbox-articles-light-1440.png" alt="Leistungskatalog mit synthetischen Artikeln, Nettopreisen und Steuerangaben" width="440"></a></td>
    <td width="50%" valign="top"><strong>Belegeingang</strong><br><a href="docs/screenshots/catalog-inbox-receipts-light-1440.png"><img src="docs/screenshots/catalog-inbox-receipts-light-1440.png" alt="Belegeingang mit synthetischen Originalen, Prüfstatus und Beträgen" width="440"></a></td>
  </tr>
</table>

Echte Oberfläche mit synthetischen Testdaten. Bilder öffnen das vollständige Original. [Bildnachweise und Prüfgrenzen](docs/screenshots/README.md).

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

Die Anwendung steht unter **[Apache License 2.0](LICENSE)**. Drittanbieter und Schriftarten behalten ihre eigenen Lizenzen; dies ist keine pauschale Lizenzfreigabe des Containers. [Drittanbieterhinweise](docs/operations/pdf-third-party-notices.md) · [Lizenzdetails](docs/legal/application-license-transition.md).
