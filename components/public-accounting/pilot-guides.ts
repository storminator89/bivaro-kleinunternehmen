export const pilotGuides = [
  {
    id: 'erste-rechnung',
    title: 'Die erste eigene Rechnung',
    summary: 'Von den Firmendaten bis zur geprüften Datei für Ihren Kunden.',
    steps: [
      'Klären Sie Ihren Steuerstatus und den konkreten Geschäftsfall vorab. Ein kleiner Betrieb ist nicht automatisch Kleinunternehmer nach § 19 UStG. Bivaro ersetzt diese fachliche Entscheidung nicht.',
      'Tragen Sie in den Einstellungen Ihre Firmendaten und Bankverbindung ein. Speichern Sie Ihr bewusst gewähltes Steuerprofil mit Gültigkeitsdatum. Legen Sie anschließend Ihren Kunden mit vollständiger Rechnungsadresse an.',
      'Öffnen Sie Rechnungen und wählen Sie „Rechnung erstellen“. Prüfen Sie Kunde, Leistungsbeschreibung, Beträge, Leistungsdatum und den passenden Steuermodus. Das gespeicherte Steuerprofil ist eine Vorgabe, keine automatische Prüfung Ihrer steuerlichen Voraussetzungen. Prüfen Sie die Auswahl auch im einzelnen Dokument.',
      'Prüfen Sie Vorschau und heruntergeladene Datei vor dem Versand. Der Versand aus Bivaro benötigt eine eingerichtete E-Mail-Konfiguration; alternativ versenden Sie die Datei über Ihr eigenes E-Mail-Programm.',
    ],
    caution: 'Beginnen Sie mit einem einfachen Inlandsfall in Euro. Auslandsfälle, Reverse Charge, Anzahlungen und Teilzahlungen gehören nicht in diesen Startablauf. Eine technisch erzeugte Datei bestätigt nicht die steuerliche Richtigkeit Ihres Falls.',
    links: [
      { href: '/settings#company-settings', label: 'Firmendaten öffnen' },
      { href: '/customers', label: 'Kunden öffnen' },
      { href: '/dashboard?tab=invoices', label: 'Rechnungen öffnen' },
    ],
  },
  {
    id: 'zahlung',
    title: 'Zahlungen und Restbetrag erfassen',
    summary: 'Tatsächliche Geldeingänge mit Betrag, Datum und Bezug einzeln zuordnen.',
    steps: [
      'Prüfen Sie den tatsächlich eingegangenen Betrag und das tatsächliche Zahlungsdatum anhand Ihrer Unterlagen. Bivaro gleicht keine Bankumsätze automatisch ab.',
      'Öffnen Sie bei Ihrer Ausgangsrechnung den Zahlungsdialog. Tragen Sie den eingegangenen Betrag, das tatsächliche Datum und eine nachvollziehbare Zahlungsreferenz ein. Das Datum wird bewusst nicht mit heute vorbelegt. Erst die verbindliche Bestätigung speichert die Zahlung.',
      'Kontrollieren Sie Rechnungssumme, erhaltenen Betrag, Restbetrag und Zahlungsverlauf. Beispiel: Von 120 EUR erhalten Sie 40 EUR an Datum A und später 80 EUR an Datum B; nach der ersten Zahlung bleiben 80 EUR offen. Jeder Zahlungseingang erzeugt eine eigene Einnahme zu seinem tatsächlichen Datum automatisch. Erfassen Sie denselben Geldeingang nicht zusätzlich als manuelle Einnahme.',
      'Bei einer unklaren Speicherantwort prüfen Sie den Zahlungsnachweis oder wiederholen dieselbe Anfrage unverändert. Ein geänderter Saldo erfordert erneute bewusste Prüfung. Bereits vorhandene Einträge im Verlauf sind keine Bestätigung einer neuen Zahlung. Nach Teilzahlungen sind Mahnaktionen bis zur gesonderten Restbetragsprüfung gesperrt.',
    ],
    caution: 'Dieser Ablauf gilt für bestätigte positive Zahlungen auf gewöhnliche Ausgangsrechnungen in Euro, nicht für Lieferanten-, Anzahlungs- oder Schlussrechnungen. Überzahlungen werden nicht gebucht. Gebuchte Zahlungen lassen sich nicht einfach wieder öffnen oder umdatieren. Erstattungen und irrtümliche Buchungen benötigen einen gesonderten Korrekturablauf; ein Storno ist keine bereits ausgeführte Rückzahlung. Historische ungeklärte Zahlungsdaten werden nicht als tatsächliches Datum erfunden.',
    links: [
      { href: '/dashboard?tab=invoices', label: 'Ausgangsrechnung öffnen' },
      { href: '/dashboard?tab=incomes', label: 'Einnahmen prüfen' },
    ],
  },
  {
    id: 'belege',
    title: 'Eine Ausgabe mit Beleg festhalten',
    summary: 'Einen bezahlten betrieblichen Vorgang manuell und nachvollziehbar erfassen.',
    steps: [
      'Öffnen Sie Ausgaben. Erfassen Sie Beschreibung, Betrag und das zutreffende Zahlungsdatum anhand Ihres Belegs und Zahlungsnachweises.',
      'Wählen Sie eine passende Kategorie und prüfen Sie die steuerliche Zuordnung. Laden Sie den Beleg als PDF, JPG oder PNG hoch und prüfen Sie die Lesbarkeit.',
      'Speichern Sie die Ausgabe und kontrollieren Sie den Eintrag samt Beleg erneut in der Liste. Bewahren Sie erforderliche Originalunterlagen nach Ihrem abgestimmten Aufbewahrungsprozess auf.',
    ],
    caution: 'Wichtig bei eingehenden E-Rechnungen: Der Rechnungsimport ist keine automatische Ausgabenbuchung und keine vollständige fachliche Validierung. Nutzen Sie Lieferantenrechnungen nicht wie eigene Ausgangsrechnungen und setzen Sie sie dort nicht auf „Bezahlt“. Stimmen Sie die manuelle Ausgabe und die Aufbewahrung des unveränderten Originals gesondert ab.',
    links: [{ href: '/dashboard?tab=expenses', label: 'Ausgaben öffnen' }],
  },
  {
    id: 'export',
    title: 'Unterlagen prüfen und übergeben',
    summary: 'Mit einem abgestimmten Export statt eines versprochenen Direktimports.',
    steps: [
      'Prüfen Sie den gewünschten Zeitraum, Einnahmen, Ausgaben und die dazugehörigen Belege. Gleichen Sie die Summen mit Ihren Unterlagen ab.',
      'Öffnen Sie „Unterlagen übergeben“, wählen Sie ein Kalenderjahr oder höchstens 366 Tage und prüfen Sie die Vorschau mit Zählungen, fehlenden Originalen und Warnungen. Das ZIP-Paket im Bivaro-Format 2 enthält Tabellen und vorhandene unveränderte Originale. Vereinbaren Sie mit Ihrer Steuerkanzlei vorab, welche Unterlagen und welchen sicheren Übergabekanal sie benötigt.',
      'Prüfen Sie Umfang und Warnungen, bevor Sie den ZIP-Download starten. Öffnen Sie danach die Dateien und README.txt. Stimmen Sie Zeitraum, fehlende Unterlagen und Zahlungsbezüge ab; addieren Sie Rechnungen, Einnahmen und verknüpfte Kassenbewegungen nicht. Es wird nichts automatisch an eine Kanzlei gesendet. Für die separate EÜR-Übertragungshilfe gelten weiterhin deren unterstützte Steuerjahre.',
    ],
    caution: 'Das Übergabepaket ist eine begrenzte Arbeitsunterlage, kein vollständiger GoBD-Prüfexport. Ungebuchte Eingangsbelege sind nicht enthalten. Original-Zahlungsnachweise stehen in payments.csv; Korrekturen und tatsächliche Erstattungen in adjustments.csv sind steuerlich ungeprüft (UNREVIEWED). Rechnung, Einnahme und Zahlungstabelle dürfen nicht addiert werden. Übergabepaket, CSV und EÜR-Übertragungshilfe sind keine ELSTER-Einreichung und kein zugesicherter DATEV-Import. Die EÜR-Übertragungshilfe unterstützt die Jahre 2024, 2025 und 2026 mit eigener Jahreszuordnung für ihren begrenzten Prüfumfang; unbekannte Formularjahre werden abgewiesen. Ein Export ersetzt weder fachliche Prüfung noch eine eigenständige Datensicherung.',
    links: [
      { href: '/handoff', label: 'Unterlagen übergeben' },
      { href: '/dashboard?tab=incomes', label: 'Einnahmen öffnen' },
      { href: '/dashboard?tab=expenses', label: 'Ausgaben und Belege öffnen' },
      { href: '/dashboard?tab=eur', label: 'EÜR prüfen' },
    ],
  },
] as const;

export type PublicAccessState = 'checking' | 'open' | 'closed' | 'setup' | 'unavailable';

// An enabled first-admin bootstrap is not a public customer registration offer.
export function registrationAccessState(value: unknown): PublicAccessState {
  if (!value || typeof value !== 'object') return 'unavailable';
  const data = value as Record<string, unknown>;
  if (typeof data.isFirstUser !== 'boolean' || typeof data.allowRegistration !== 'boolean') return 'unavailable';
  if (data.isFirstUser || data.bootstrapRequired === true) return 'setup';
  return data.allowRegistration ? 'open' : 'closed';
}

export const publicAccessCopy: Record<PublicAccessState, { title: string; description: string; href: string; label: string }> = {
  checking: { title: 'Zugang zu dieser Installation', description: 'Die Verfügbarkeit der Registrierung wird geprüft. Ein vorhandener Zugang bleibt über die Anmeldung erreichbar.', href: '/login', label: 'Mit vorhandenem Konto anmelden' },
  open: { title: 'Registrierung ist freigegeben', description: 'Sie können ein Konto für diese Installation anlegen. Das ist keine Bestellung, kein Hostingvertrag und keine automatisch bereitgestellte eigene Firmeninstanz.', href: '/register', label: 'Zur Registrierung' },
  closed: { title: 'Zugang wird durch den Betreiber vergeben', description: 'Die öffentliche Registrierung dieser Installation ist deaktiviert. Nutzen Sie einen vorhandenen Zugang oder den mit Ihrem Betreiber vereinbarten Kontaktweg.', href: '/login', label: 'Mit vorhandenem Konto anmelden' },
  setup: { title: 'Die Installation benötigt eine betreute Einrichtung', description: 'Die Erstregistrierung ist der Einrichtung durch den Betreiber vorbehalten. Sie ist kein öffentlicher Kundenzugang.', href: '/login', label: 'Mit vorhandenem Konto anmelden' },
  unavailable: { title: 'Registrierungsstatus derzeit nicht verfügbar', description: 'Eine offene Registrierung kann gerade nicht bestätigt werden. Versuchen Sie es später erneut oder nutzen Sie Ihren vorhandenen Zugang.', href: '/login', label: 'Mit vorhandenem Konto anmelden' },
};
