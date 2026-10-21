export const pilotGuides = [
  {
    id: 'erste-rechnung', title: 'Rechnung erstellen',
    summary: 'Firmendaten → Kunde → Rechnung.',
    steps: [
      'Steuerstatus klären: Kleingewerbe ≠ Kleinunternehmer (§ 19 UStG).',
      'Firmendaten, Bankverbindung und Steuerprofil speichern. Kunden anlegen.',
      'Kunde, Positionen, Leistungsdatum und Steuern prüfen.',
      'Datei prüfen und per E-Mail versenden.',
    ],
    caution: 'Für einfache Inlandsfälle in Euro. Ausland, Reverse Charge, Anzahlungen und Schlussrechnungen gesondert klären. Eine erzeugte Datei bestätigt keine steuerliche Richtigkeit.',
    links: [
      { href: '/settings#company-settings', label: 'Firmendaten' },
      { href: '/customers', label: 'Kunden' },
      { href: '/dashboard?tab=invoices', label: 'Rechnungen' },
    ],
  },
  {
    id: 'zahlung', title: 'Zahlung erfassen',
    summary: 'Betrag, Zahlungsdatum und Referenz laut Nachweis.',
    steps: [
      'Geldeingang anhand des Zahlungsnachweises prüfen.',
      'Rechnung → Zahlung erfassen. Betrag, tatsächliches Datum und Referenz eingeben und verbindlich bestätigen.',
      'Restbetrag und Zahlungsverlauf prüfen. Einnahme nicht zusätzlich manuell erfassen.',
      'Speicherung unklar? Verlauf prüfen oder unverändert wiederholen.',
    ],
    caution: 'Kein automatischer Bankabgleich. Jede Teilzahlung erzeugt eine Einnahme am Zahlungsdatum; nicht zusätzlich manuell erfassen. Bei geändertem Saldo erneut prüfen. Nur positive Zahlungen auf gewöhnliche Ausgangsrechnungen in Euro; keine Überzahlung. Gebuchte Zahlungen sind unveränderlich. Fehler und Erstattungen separat korrigieren: Ein Storno zahlt kein Geld zurück. Mahnungen nach Teilzahlung benötigen eine Restbetragsprüfung. Unbekannte historische Zahlungsdaten bleiben ungeklärt.',
    links: [
      { href: '/dashboard?tab=invoices', label: 'Rechnungen' },
      { href: '/dashboard?tab=incomes', label: 'Einnahmen' },
    ],
  },
  {
    id: 'belege', title: 'Ausgabe erfassen',
    summary: 'Bezahlte Ausgabe und Original zusammenhalten.',
    steps: [
      'Beschreibung, Betrag und Zahlungsdatum laut Nachweis eingeben.',
      'Kategorie und Steuerzuordnung prüfen. Beleg hochladen.',
      'Eintrag prüfen und Original aufbewahren.',
    ],
    caution: 'Ein E-Rechnungsimport bucht keine Ausgabe und ersetzt keine fachliche Prüfung. Lieferantenrechnungen nicht als eigene Ausgangsrechnung auf „Bezahlt“ setzen. Ausgabe und unverändertes Original gesondert zuordnen.',
    links: [{ href: '/dashboard?tab=expenses', label: 'Ausgaben' }],
  },
  {
    id: 'export', title: 'Unterlagen übergeben',
    summary: 'Zeitraum wählen → Vorschau prüfen → ZIP herunterladen.',
    steps: [
      'Unterlagen abgleichen und Übergabe mit der Steuerkanzlei abstimmen.',
      'Zeitraum wählen. Vorschau, Originale und Warnungen prüfen.',
      'ZIP herunterladen, prüfen und selbst übergeben.',
    ],
    caution: 'Maximal 366 Tage. Bivaro-Format 2, kein automatischer Versand. Kein vollständiger GoBD-Prüfexport, DATEV-Import oder ELSTER-Versand. Ungebuchte Eingangsbelege fehlen. payments.csv enthält Zahlungsnachweise; adjustments.csv enthält steuerlich ungeprüfte Korrekturen und Erstattungen (UNREVIEWED). Keine Addition von Rechnung, Einnahme und Zahlung. Die separate EÜR-Übertragungshilfe unterstützt nur 2024, 2025 und 2026; unbekannte Jahre werden abgewiesen. Export ersetzt weder fachliche Prüfung noch Datensicherung.',
    links: [
      { href: '/handoff', label: 'Unterlagen übergeben' },
      { href: '/dashboard?tab=incomes', label: 'Einnahmen' },
      { href: '/dashboard?tab=expenses', label: 'Ausgaben' },
      { href: '/dashboard?tab=eur', label: 'EÜR' },
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
  checking: { title: 'Zugang zu dieser Installation', description: '', href: '/login', label: 'Anmelden' },
  open: { title: 'Registrierung ist freigegeben', description: 'Konto für diese Installation; kein Kauf.', href: '/register', label: 'Zur Registrierung' },
  closed: { title: 'Zugang über den Betreiber', description: 'Registrierung geschlossen.', href: '/login', label: 'Anmelden' },
  setup: { title: 'Einrichtung erforderlich', description: 'Bitte den Betreiber kontaktieren.', href: '/login', label: 'Anmelden' },
  unavailable: { title: 'Registrierungsstatus nicht verfügbar', description: '', href: '/login', label: 'Anmelden' },
};
