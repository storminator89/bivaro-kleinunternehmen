# Bivaro – Buchhaltung für Kleinunternehmer

Bivaro ist eine moderne, webbasierte Buchhaltungsanwendung, die speziell für Kleinunternehmer in Deutschland entwickelt wurde. Sie hilft dabei, Einnahmen und Ausgaben zu verwalten, Rechnungen zu erstellen und den Überblick über die Finanzen zu behalten – alles unter Berücksichtigung der Kleinunternehmerregelung (§ 19 UStG).

## 🚀 Features

### 📊 Dashboard & Übersicht
*   **Echtzeit-KPIs**: Umsatz (Monat/Jahr), Ausgaben, Offene Forderungen und Gewinnmarge auf einen Blick.
*   **Kleinunternehmer-Tracker**: Visueller Fortschrittsbalken für die neuen Grenzen ab 2025 (25.000 € Vorjahresgrenze, 100.000 € harte Grenze). Warnt bei Annäherung und zeigt sofortige Steuerpflicht bei Überschreitung der 100.000 €-Grenze an.
*   **Interaktive Charts**: Monatliche Einnahmen vs. Ausgaben im Jahresverlauf.
*   **Letzte Aktivitäten**: Schneller Zugriff auf die neuesten Buchungen.

### 📝 Rechnungsstellung (Neu!)
*   **PDF-Rechnungsgenerator**: Erstellen Sie professionelle Rechnungen direkt im Browser.
*   **Rechtssicher**: Automatische Hinweise auf § 19 UStG (Steuerbefreiung).
*   **GiroCode (EPC069-12)**: Optionaler QR-Code auf der Rechnung, damit Kunden per Banking-App scannen & zahlen können.
*   **Kundenverwaltung**: Empfänger aus der Datenbank auswählen oder manuell eingeben.
*   **Individuelles Design**: Logo, Firmenadresse und Fußzeile werden automatisch aus den Einstellungen geladen.

### 💰 Einnahmen & Ausgaben
*   **Erfassung**: Einfaches Hinzufügen von Belegen mit Kategorien, Datum und Betrag.
*   **Beleg-Upload**: Speichern von Rechnungsbelegen (PDF/Bild) direkt zur Buchung.
*   **Filter & Suche**: Finden Sie Buchungen nach Datum, Kategorie oder Text.
*   **Export**: Datenexport für den Steuerberater oder das Finanzamt (z.B. GWG-Verzeichnis).

### ⚙️ Einstellungen
*   **Firmendaten**: Hinterlegen Sie Name, Adresse, Steuernummer und Bankverbindung zentral.
*   **Bankverbindung**: Strukturierte Erfassung von IBAN/BIC für fehlerfreie QR-Codes.
*   **Logo-Upload**: Laden Sie Ihr Firmenlogo hoch, um es auf Rechnungen zu platzieren.

### ⚖️ Steuer-Simulation
*   **Einkommensteuer-Rechner**: Schätzen Sie Ihre voraussichtliche Steuerlast basierend auf Ihrem Gewinn.

## 🛠️ Technologie-Stack

*   **Frontend**: Next.js 14 (App Router), React, Tailwind CSS, Shadcn UI
*   **Backend**: Next.js API Routes
*   **Datenbank**: SQLite (via Prisma ORM)
*   **PDF-Generierung**: pdf-lib
*   **QR-Code**: qrcode

## 📦 Installation & Start

1.  **Repository klonen:**
    ```bash
    git clone <repository-url>
    cd buchhaltung
    ```

2.  **Abhängigkeiten installieren:**
    ```bash
    npm install
    ```

3.  **Datenbank initialisieren:**
    ```bash
    npx prisma migrate dev
    ```

4.  **Entwicklungsserver starten:**
    ```bash
    npm run dev
    ```
    Die App ist nun unter `http://localhost:3000` erreichbar.

## 🔒 Datenschutz & Sicherheit
Alle Daten werden lokal in Ihrer SQLite-Datenbank gespeichert. Es erfolgt keine Übertragung an externe Cloud-Dienste (außer Sie hosten die App selbst in der Cloud).

## 📝 Lizenz
Dieses Projekt ist für die private oder gewerbliche Nutzung als Kleinunternehmer vorgesehen.
