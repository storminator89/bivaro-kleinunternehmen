/**
 * EÜR Line Mapping Library
 * Maps expense/income categories to official Anlage EÜR line numbers
 * Based on Anlage EÜR 2024 structure
 */

import { EURLineDefinition, EURLineType, CategoryEURMapping } from '@/types/eur-export';

// Official EÜR line definitions (Anlage EÜR 2024)
export const EUR_LINES: EURLineDefinition[] = [
    // === BETRIEBSEINNAHMEN (Zeilen 11-22) ===
    { lineNumber: 11, name: 'Betriebseinnahmen als Land- und Forstwirt', description: 'Umsatzerlöse Land-/Forstwirtschaft', type: 'income', section: 'Betriebseinnahmen' },
    { lineNumber: 14, name: 'Umsatzsteuerfreie Betriebseinnahmen', description: 'Steuerfreie Einnahmen nach § 4 Nr. 8 ff. UStG', type: 'income', section: 'Betriebseinnahmen' },
    { lineNumber: 15, name: 'Umsatzsteuerpflichtige Betriebseinnahmen', description: 'Steuerpflichtige Umsätze (netto, ohne USt)', type: 'income', section: 'Betriebseinnahmen' },
    { lineNumber: 16, name: 'Einnahmen Kleinunternehmer § 19 UStG', description: 'Umsätze als Kleinunternehmer', type: 'income', section: 'Betriebseinnahmen' },
    { lineNumber: 17, name: 'Vereinnahmte Umsatzsteuer', description: 'Eingenommene USt und USt auf Eigenverbrauch', type: 'income', section: 'Betriebseinnahmen' },
    { lineNumber: 18, name: 'Vom Finanzamt erstattete USt', description: 'USt-Erstattungen', type: 'income', section: 'Betriebseinnahmen' },
    { lineNumber: 19, name: 'Sachentnahmen und Privatanteil', description: 'Privatentnahme von Waren/Leistungen', type: 'income', section: 'Betriebseinnahmen' },
    { lineNumber: 20, name: 'Auflösung Rücklagen und stille Reserven', description: 'Gewinnzuführung durch Auflösung', type: 'income', section: 'Betriebseinnahmen' },
    { lineNumber: 21, name: 'Private Kfz-Nutzung', description: 'Privatanteil Kfz-Kosten', type: 'income', section: 'Betriebseinnahmen' },
    { lineNumber: 22, name: 'Sonstige Sach-, Nutzungs-, Leistungsentnahmen', description: 'Weitere Privatentnahmen', type: 'income', section: 'Betriebseinnahmen' },

    // === BETRIEBSAUSGABEN (Zeilen 23-86) ===
    { lineNumber: 23, name: 'Waren, Rohstoffe und Hilfsstoffe', description: 'Wareneinkauf, Materialkosten', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 24, name: 'Bezogene Fremdleistungen (netto)', description: 'Subunternehmer, externe Dienstleister', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 25, name: 'Vorsteuerbeträge', description: 'Gezahlte Vorsteuer', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 26, name: 'An das Finanzamt gezahlte USt', description: 'USt-Zahlungen', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 27, name: 'Personalkosten / Löhne und Gehälter', description: 'Bruttogehälter', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 28, name: 'Sozialversicherungsbeiträge', description: 'AG-Anteil Sozialversicherung', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 31, name: 'Absetzung für Abnutzung (AfA)', description: 'Abschreibungen auf Anlagevermögen', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 32, name: 'AfA auf GWG § 6 (2) EStG', description: 'Sofortabschreibung GWG bis 800€', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 33, name: 'Auflösung Sammelposten', description: 'Pool-Abschreibung GWG', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 35, name: 'Raumkosten und Grundstücksaufwendungen', description: 'Miete, Nebenkosten Geschäftsräume', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 40, name: 'Miete/Pacht für immaterielle WG', description: 'Lizenzen, Software-Miete', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 41, name: 'Sonstige Aufwendungen für Grundstücke', description: 'Grundsteuer, Erhaltungsaufwand etc.', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 45, name: 'Kfz-Kosten und Fahrzeugaufwendungen', description: 'Betriebliche Fahrzeugkosten', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 46, name: 'Aufwendungen für Telekommunikation', description: 'Telefon, Internet, Mobilfunk', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 47, name: 'Fahrtkosten privates Kfz', description: 'Km-Pauschale für Privatfahrzeug', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 48, name: 'Reisekosten', description: 'Übernachtung, Verpflegungsmehraufwand', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 52, name: 'Bewirtungsaufwendungen (70%)', description: 'Geschäftsessen (70% abzugsfähig)', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 53, name: 'Geschenke bis 50€', description: 'Betriebliche Geschenke', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 55, name: 'Schuldzinsen', description: 'Zinsen für Betriebskredite', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 57, name: 'Übrige unbeschränkt abziehbare Ausgaben', description: 'Allgemeine Betriebsausgaben', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 59, name: 'Porto, Telefon', description: 'Kommunikationskosten, Versand', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 60, name: 'Rechts- und Beratungskosten', description: 'Steuerberater, Anwalt, Notar', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 61, name: 'Miete/Leasing für bewegliche WG', description: 'Leasing Geräte, Fahrzeuge etc.', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 62, name: 'Beiträge, Gebühren, Abgaben', description: 'Kammerbeiträge, Versicherungen', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 63, name: 'Werbekosten', description: 'Marketing, Werbung, PR', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 64, name: 'Bürobedarf und Verbrauchsmaterial', description: 'Büromaterial, Druckerpatronen etc.', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 65, name: 'Häusliches Arbeitszimmer', description: 'Anteilige Kosten Homeoffice', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 66, name: 'Tagespauschale häusliche Tätigkeit', description: 'Homeoffice-Pauschale (6€/Tag)', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 72, name: 'Sonstige unbeschränkt abziehbare BA', description: 'Weitere Betriebsausgaben', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 76, name: 'Forderungsverluste', description: 'Uneinbringliche Forderungen', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 81, name: 'Nicht abziehbare Aufwendungen § 3 Nr. 26 EStG', description: 'Aufwendungen zu steuerfreien Einnahmen', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 82, name: 'Übrige nicht abziehbare Aufwendungen', description: 'Nicht abzugsfähige Kosten', type: 'expense', section: 'Betriebsausgaben' },

    // === ERGEBNIS (Zeile 87) ===
    { lineNumber: 87, name: 'Gewinn / Verlust', description: 'Differenz Einnahmen - Ausgaben', type: 'result', section: 'Ergebnis' },
];

// Default category to EÜR line mappings
// This maps common German category names to EÜR line numbers
export const DEFAULT_CATEGORY_MAPPINGS: Record<string, number> = {
    // === EINNAHMEN ===
    'Einnahmen': 16,
    'Umsatz': 16,
    'Erlöse': 16,
    'Verkauf': 16,
    'Dienstleistung': 16,
    'Honorar': 16,
    'Provision': 16,
    'Barverkauf': 16,

    // === AUSGABEN ===
    // Material & Waren
    'Waren': 23,
    'Wareneinkauf': 23,
    'Material': 23,
    'Materialkosten': 23,
    'Rohstoffe': 23,
    'Einkauf': 23,

    // Fremdleistungen
    'Fremdleistung': 24,
    'Fremdleistungen': 24,
    'Subunternehmer': 24,
    'Externe Dienstleistung': 24,

    // Personal
    'Personal': 27,
    'Personalkosten': 27,
    'Löhne': 27,
    'Gehälter': 27,
    'Lohn': 27,
    'Minijob': 27,

    // AfA
    'Abschreibung': 31,
    'AfA': 31,
    'Abschreibungen': 31,

    // GWG
    'GWG': 32,
    'Geringwertige Wirtschaftsgüter': 32,

    // Raumkosten
    'Miete': 35,
    'Raumkosten': 35,
    'Büromiete': 35,
    'Geschäftsmiete': 35,
    'Nebenkosten': 35,

    // Kfz
    'Kfz': 45,
    'Kfz-Kosten': 45,
    'Fahrzeugkosten': 45,
    'Benzin': 45,
    'Tankkosten': 45,

    // Telekommunikation
    'Telefon': 46,
    'Internet': 46,
    'Telekommunikation': 46,
    'Mobilfunk': 46,
    'Handy': 46,

    // Fahrtkosten
    'Fahrtkosten': 47,
    'Kilometer': 47,
    'Reisekosten': 48,
    'Reise': 48,

    // Bewirtung
    'Bewirtung': 52,
    'Geschäftsessen': 52,

    // Geschenke
    'Geschenke': 53,
    'Kundengeschenke': 53,

    // Zinsen
    'Zinsen': 55,
    'Bankzinsen': 55,
    'Kreditzinsen': 55,

    // Porto & Telefon
    'Porto': 59,
    'Versand': 59,
    'Paket': 59,

    // Beratung
    'Steuerberater': 60,
    'Rechtsanwalt': 60,
    'Beratung': 60,
    'Beratungskosten': 60,

    // Leasing
    'Leasing': 61,
    'Miete Geräte': 61,

    // Versicherung & Beiträge
    'Versicherung': 62,
    'Versicherungen': 62,
    'Beiträge': 62,
    'Gebühren': 62,
    'IHK': 62,
    'Kammerbeitrag': 62,

    // Werbung
    'Werbung': 63,
    'Marketing': 63,
    'Werbekosten': 63,

    // Bürobedarf
    'Bürobedarf': 64,
    'Büromaterial': 64,
    'Verbrauchsmaterial': 64,
    'Druckerpatronen': 64,

    // Homeoffice
    'Homeoffice': 66,
    'Arbeitszimmer': 65,
    'Home Office': 66,

    // Sonstiges
    'Sonstiges': 72,
    'Sonstige Ausgaben': 72,
    'Sonstige Kosten': 72,
    'Verschiedenes': 72,
    'Sonstige Betriebsausgaben': 72,

    // === Combined category names from dropdown ===
    'AfA (Abschreibung)': 31,
    'Miete / Raumkosten': 35,
    'Telefon / Internet': 46,
    'Porto / Versand': 59,
    'Steuerberater / Beratung': 60,
    'Versicherungen / Beiträge': 62,
    'Werbung / Marketing': 63,
};

/**
 * Get the EÜR line number for a given category
 * Uses fuzzy matching with lowercase comparison
 */
export function getEURLineForCategory(category: string): number | null {
    if (!category) return null;

    const normalizedCategory = category.toLowerCase().trim();

    // Direct match
    for (const [key, lineNumber] of Object.entries(DEFAULT_CATEGORY_MAPPINGS)) {
        if (key.toLowerCase() === normalizedCategory) {
            return lineNumber;
        }
    }

    // Partial match (category contains key or key contains category)
    for (const [key, lineNumber] of Object.entries(DEFAULT_CATEGORY_MAPPINGS)) {
        const normalizedKey = key.toLowerCase();
        if (normalizedCategory.includes(normalizedKey) || normalizedKey.includes(normalizedCategory)) {
            return lineNumber;
        }
    }

    return null;
}

/**
 * Get the EÜR line definition by line number
 */
export function getEURLineDefinition(lineNumber: number): EURLineDefinition | undefined {
    return EUR_LINES.find(line => line.lineNumber === lineNumber);
}

/**
 * Get all income-related EÜR lines
 */
export function getIncomeLines(): EURLineDefinition[] {
    return EUR_LINES.filter(line => line.type === 'income');
}

/**
 * Get all expense-related EÜR lines
 */
export function getExpenseLines(): EURLineDefinition[] {
    return EUR_LINES.filter(line => line.type === 'expense');
}

/**
 * Format amount for German locale (Elster format)
 * Uses comma as decimal separator, no thousand separator
 */
export function formatAmountForElster(amount: number): string {
    return amount.toFixed(2).replace('.', ',');
}

/**
 * Generate CSV content in Elster-compatible format
 */
export function generateElsterCSV(
    lines: Array<{ lineNumber: number; name: string; amount: number }>,
    year: number,
    companyName?: string,
    taxNumber?: string
): string {
    const BOM = '\uFEFF'; // UTF-8 BOM for Excel
    let csv = BOM;

    // Header
    csv += 'Anlage EÜR - Export\n';
    csv += `Veranlagungsjahr: ${year}\n`;
    if (companyName) csv += `Betrieb: ${companyName}\n`;
    if (taxNumber) csv += `Steuernummer: ${taxNumber}\n`;
    csv += '\n';

    // Column headers
    csv += 'Zeile;Bezeichnung;Betrag (EUR)\n';

    // Data rows (sorted by line number)
    const sortedLines = [...lines].sort((a, b) => a.lineNumber - b.lineNumber);

    for (const line of sortedLines) {
        if (line.amount !== 0) {
            csv += `${line.lineNumber};${line.name};${formatAmountForElster(line.amount)}\n`;
        }
    }

    return csv;
}

/**
 * Get the default EÜR line for Kleinunternehmer income
 * Returns line 16 (§ 19 UStG Kleinunternehmer)
 */
export function getDefaultIncomeLineForKleinunternehmer(): number {
    return 16;
}

/**
 * Get the default EÜR line for uncategorized expenses
 * Returns line 72 (Sonstige unbeschränkt abziehbare BA)
 */
export function getDefaultExpenseLine(): number {
    return 72;
}

/**
 * Get recommended expense categories for the dropdown
 * Returns only primary category names (one per EÜR line) to avoid clutter
 */
export function getRecommendedExpenseCategories(): string[] {
    // Primary categories - one clear name per EÜR line
    // The mapping still recognizes all synonyms, but the dropdown shows only these
    const primaryCategories = [
        'Privatentnahme',         // Nicht steuerrelevant - Entnahme ins Privatvermögen
        'Wareneinkauf',           // Zeile 23
        'Fremdleistungen',        // Zeile 24
        'Personalkosten',         // Zeile 27
        'AfA (Abschreibung)',     // Zeile 31
        'GWG',                    // Zeile 32
        'Miete / Raumkosten',     // Zeile 35
        'Kfz-Kosten',             // Zeile 45
        'Telefon / Internet',     // Zeile 46
        'Fahrtkosten',            // Zeile 47
        'Reisekosten',            // Zeile 48
        'Bewirtung',              // Zeile 52
        'Geschenke',              // Zeile 53
        'Zinsen',                 // Zeile 55
        'Porto / Versand',        // Zeile 59
        'Steuerberater / Beratung', // Zeile 60
        'Leasing',                // Zeile 61
        'Versicherungen / Beiträge', // Zeile 62
        'Werbung / Marketing',    // Zeile 63
        'Bürobedarf',             // Zeile 64
        'Homeoffice',             // Zeile 66
        'Sonstige Ausgaben',      // Zeile 72
    ];

    return primaryCategories.sort((a, b) => a.localeCompare(b, 'de'));
}

/**
 * Get recommended income categories for the dropdown
 */
export function getRecommendedIncomeCategories(): string[] {
    const incomeCategories = [
        'Privateinlage',          // Nicht steuerrelevant - Einlage aus Privatvermögen
        'Dienstleistung',
        'Honorar',
        'Provision',
        'Verkauf',
        'Umsatzerlöse',
        'Sonstige Einnahmen',
    ];

    return incomeCategories.sort((a, b) => a.localeCompare(b, 'de'));
}

/**
 * Get a category with its EÜR line info for display
 */
export function getCategoryWithEURInfo(category: string): { category: string; eurLine: number | null; eurLineName: string | null } {
    const eurLine = getEURLineForCategory(category);
    const lineDef = eurLine ? getEURLineDefinition(eurLine) : null;

    return {
        category,
        eurLine,
        eurLineName: lineDef?.name || null
    };
}


