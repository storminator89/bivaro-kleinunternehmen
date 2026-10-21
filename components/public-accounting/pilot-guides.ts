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
    title: 'Eine vollständige Zahlung erfassen',
    summary: 'Erst den tatsächlichen Geldeingang prüfen, dann die eigene Rechnung zuordnen.',
    steps: [
      'Prüfen Sie den vollständigen Geldeingang und das Zahlungsdatum anhand Ihrer Unterlagen. Bivaro gleicht keine Bankumsätze automatisch ab.',
      'Prüfen Sie das Datum, bevor Sie den Status ändern: Die aktuelle Rechnungsoberfläche übernimmt beim Wechsel zu „Bezahlt“ den aktuellen Buchungszeitpunkt als Zahlungsdatum. Ein eigenes Datumsfeld gibt es dort nicht. Nutzen Sie diese Aktion nur, wenn das zum tatsächlichen Geldeingang passt; klären Sie ältere Zahlungen vorab mit Ihrem Ansprechpartner.',
      'Wählen Sie bei der passenden Ausgangsrechnung den Status „Bezahlt“ und kontrollieren Sie anschließend die zugehörige Buchung unter Einnahmen. Der Status „Bezahlt“ erzeugt die Einnahme zur Rechnung automatisch. Erfassen Sie denselben Geldeingang nicht zusätzlich als manuelle Einnahme.',
    ],
    caution: 'Dieser Ablauf gilt für Ihre Ausgangsrechnungen und den vollen Rechnungsbetrag, nicht für Lieferantenrechnungen. Gebuchte Zahlungen lassen sich nicht einfach wieder öffnen oder umdatieren. Teilzahlungen, Erstattungen und irrtümliche Buchungen müssen vorab gesondert geklärt werden. Ein Storno ist keine bereits ausgeführte Rückzahlung.',
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
      'Öffnen Sie „Unterlagen übergeben“, wählen Sie ein Kalenderjahr oder höchstens 366 Tage und prüfen Sie die Vorschau mit Zählungen, fehlenden Originalen und Warnungen. Das ZIP-Paket im Bivaro-Format 1 enthält Tabellen und vorhandene unveränderte Originale. Vereinbaren Sie mit Ihrer Steuerkanzlei vorab, welche Unterlagen und welchen sicheren Übergabekanal sie benötigt.',
      'Prüfen Sie Umfang und Warnungen, bevor Sie den ZIP-Download starten. Öffnen Sie danach die Dateien und README.txt. Stimmen Sie Zeitraum, fehlende Unterlagen und Zahlungsbezüge ab; addieren Sie Rechnungen, Einnahmen und verknüpfte Kassenbewegungen nicht. Es wird nichts automatisch an eine Kanzlei gesendet. Für die separate EÜR-Übertragungshilfe gelten weiterhin deren unterstützte Steuerjahre.',
    ],
    caution: 'Das Übergabepaket ist eine begrenzte Arbeitsunterlage, kein vollständiger GoBD-Prüfexport. Ungebuchte Eingangsbelege, Teilzahlungszuordnungen und ein separates Zahlungs-/Erstattungsjournal sind nicht enthalten. Übergabepaket, CSV und EÜR-Übertragungshilfe sind keine ELSTER-Einreichung und kein zugesicherter DATEV-Import. Die EÜR-Übertragungshilfe unterstützt derzeit die Jahre 2024 und 2025, nicht 2026. Ein Export ersetzt weder fachliche Prüfung noch eine eigenständige Datensicherung.',
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
