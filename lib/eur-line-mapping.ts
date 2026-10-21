/**
 * Versioned Anlage-EÜR working-paper mappings.
 *
 * The line numbers below are the numbered rows of the official Anlage EÜR
 * forms. The application deliberately exports a CSV working paper only. It
 * does not implement the authenticated ELSTER data set or claim that a CSV
 * can be imported into ELSTER.
 */

import { EURLineDefinition } from '@/types/eur-export';

export type SupportedEURYear = 2024 | 2025 | 2026;

export const EUR_MAPPING_SOURCES: Record<SupportedEURYear, string> = {
    2024: 'https://www.elster.de/eportal/helpGlobal?themaGlobal=help_euer_ufa_77_2024',
    2025: 'https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Einkommensteuer/2025-08-29-anlage-EUER-2025.pdf?__blob=publicationFile&v=2',
    2026: 'https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Einkommensteuer/2026-09-01-anlage-EUER-2026.pdf?__blob=publicationFile&v=4',
};

export const EUR_MAPPING_VERSIONS: Record<SupportedEURYear, string> = {
    2024: 'anlage-euer-2024-v1',
    2025: 'anlage-euer-2025-v1',
    2026: 'anlage-euer-2026-v1',
};

/** Official rows for the simple single-business working paper supported here. */
const OFFICIAL_LINES: EURLineDefinition[] = [
    { lineNumber: 12, name: 'Betriebseinnahmen als umsatzsteuerlicher Kleinunternehmer', description: 'Umsätze nach § 19 Abs. 1 UStG', type: 'income', section: 'Betriebseinnahmen' },
    { lineNumber: 14, name: 'Betriebseinnahmen als Land- und Forstwirt', description: 'Durchschnittssatzbesteuerung nach § 24 UStG', type: 'income', section: 'Betriebseinnahmen' },
    { lineNumber: 15, name: 'Umsatzsteuerpflichtige Betriebseinnahmen', description: 'Umsatzsteuerpflichtige Betriebseinnahmen', type: 'income', section: 'Betriebseinnahmen' },
    { lineNumber: 16, name: 'Umsatzsteuerfreie / nicht steuerbare Betriebseinnahmen', description: 'Steuerfreie oder nicht steuerbare Umsätze', type: 'income', section: 'Betriebseinnahmen' },
    { lineNumber: 17, name: 'Vereinnahmte Umsatzsteuer', description: 'Vereinnahmte Umsatzsteuer und unentgeltliche Wertabgaben', type: 'income', section: 'Betriebseinnahmen' },
    { lineNumber: 18, name: 'Vom Finanzamt erstattete Umsatzsteuer', description: 'Erstattete oder verrechnete Umsatzsteuer', type: 'income', section: 'Betriebseinnahmen' },
    { lineNumber: 19, name: 'Veräußerung oder Entnahme von Anlagevermögen', description: 'Veräußerung oder Entnahme von Anlagevermögen', type: 'income', section: 'Betriebseinnahmen' },
    { lineNumber: 20, name: 'Private Kfz-Nutzung', description: 'Private Kfz-Nutzung', type: 'income', section: 'Betriebseinnahmen' },
    { lineNumber: 21, name: 'Sonstige Sach-, Nutzungs- und Leistungsentnahmen', description: 'Sonstige Entnahmen', type: 'income', section: 'Betriebseinnahmen' },
    { lineNumber: 22, name: 'Auflösung von Rücklagen und Ausgleichsposten', description: 'Auflösung von Rücklagen', type: 'income', section: 'Betriebseinnahmen' },
    { lineNumber: 23, name: 'Summe Betriebseinnahmen', description: 'Summe der Betriebseinnahmen', type: 'income', section: 'Betriebseinnahmen' },
    { lineNumber: 24, name: 'Betriebsausgabenpauschale', description: 'Pauschale für bestimmte Berufsgruppen', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 25, name: 'Betriebsausgabenpauschale Weinbau', description: 'Richtbeträge für Weinbaubetriebe', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 26, name: 'Betriebsausgabenpauschale Forstwirte', description: 'Pauschale für Forstwirte', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 27, name: 'Waren, Rohstoffe und Hilfsstoffe', description: 'Waren, Rohstoffe und Hilfsstoffe einschließlich Nebenkosten', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 29, name: 'Bezogene Fremdleistungen', description: 'Bezogene Fremdleistungen', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 30, name: 'Ausgaben für eigenes Personal', description: 'Gehälter, Löhne und Versicherungsbeiträge', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 31, name: 'AfA auf Grundstücke', description: 'AfA auf Grundstücke und grundstücksgleiche Rechte', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 32, name: 'AfA auf immaterielle Wirtschaftsgüter', description: 'AfA auf immaterielle Wirtschaftsgüter', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 33, name: 'AfA auf bewegliche Wirtschaftsgüter', description: 'AfA auf bewegliche Wirtschaftsgüter', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 34, name: 'Sonderabschreibungen', description: 'Sonderabschreibungen nach §§ 7b, 7g EStG', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 35, name: 'Herabsetzungsbeträge nach § 7g EStG', description: 'Herabsetzungsbeträge nach § 7g Abs. 2 EStG', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 36, name: 'Geringwertige Wirtschaftsgüter', description: 'Aufwendungen für GWG nach § 6 Abs. 2 EStG', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 37, name: 'Auflösung Sammelposten', description: 'Auflösung von Sammelposten nach § 6 Abs. 2a EStG', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 38, name: 'Restbuchwerte ausgeschiedener Anlagegüter', description: 'Restbuchwerte ausgeschiedener Anlagegüter', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 39, name: 'Miete und Pacht für Geschäftsräume', description: 'Miete/Pacht für Geschäftsräume und Grundstücke', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 40, name: 'Aufwendungen für doppelte Haushaltsführung', description: 'Doppelte Haushaltsführung', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 41, name: 'Sonstige Grundstücksaufwendungen', description: 'Sonstige Aufwendungen für betrieblich genutzte Grundstücke', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 42, name: 'Erhaltungsaufwendungen Grundstücke', description: 'In Zeile 41 enthaltene Erhaltungsaufwendungen', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 43, name: 'Aufwendungen für Telekommunikation', description: 'Telefon und Internet', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 44, name: 'Übernachtungs- und Reisenebenkosten', description: 'Reisenebenkosten des Steuerpflichtigen', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 45, name: 'Fortbildungskosten', description: 'Fortbildungskosten ohne Reisekosten', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 46, name: 'Rechts- und Steuerberatung', description: 'Rechts- und Steuerberatung sowie Buchführung', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 47, name: 'Miete und Leasing beweglicher Wirtschaftsgüter', description: 'Miete/Leasing ohne Kfz', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 48, name: 'Erhaltungsaufwendungen', description: 'Instandhaltung, Wartung und Reparatur', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 49, name: 'Beiträge, Gebühren, Abgaben und Versicherungen', description: 'Beiträge und Versicherungen', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 50, name: 'Laufende EDV-Kosten', description: 'EDV-Beratung, Wartung und Reparatur', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 51, name: 'Arbeitsmittel', description: 'Bürobedarf, Porto und Fachliteratur', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 52, name: 'Abfallbeseitigung und Entsorgung', description: 'Abfallbeseitigung und Entsorgung', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 53, name: 'Verpackung und Transport', description: 'Kosten für Verpackung und Transport', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 54, name: 'Werbekosten', description: 'Werbung und Marketing', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 55, name: 'Schuldzinsen Anlagevermögen', description: 'Schuldzinsen zur Finanzierung von Anlagevermögen', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 56, name: 'Übrige Schuldzinsen', description: 'Übrige Schuldzinsen', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 57, name: 'Abziehbare Vorsteuerbeträge', description: 'Nach § 15 UStG abziehbare Vorsteuer', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 58, name: 'An das Finanzamt gezahlte Umsatzsteuer', description: 'Gezahlte oder verrechnete Umsatzsteuer', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 59, name: 'Rücklagen und stille Reserven', description: 'Rücklagen, stille Reserven und Ausgleichsposten', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 60, name: 'Übrige unbeschränkt abziehbare Betriebsausgaben', description: 'Sonstige Betriebsausgaben, einschließlich zurückgezahlter Hilfen', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 61, name: 'Übertrag Betriebsausgaben', description: 'Summe der unbeschränkt abziehbaren Betriebsausgaben', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 62, name: 'Geschenke', description: 'Beschränkt abziehbare Geschenke', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 63, name: 'Bewirtungsaufwendungen', description: 'Beschränkt abziehbare Bewirtung', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 64, name: 'Verpflegungsmehraufwendungen', description: 'Verpflegungsmehraufwendungen', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 65, name: 'Häusliches Arbeitszimmer', description: 'Aufwendungen für ein häusliches Arbeitszimmer', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 66, name: 'Tagespauschale häusliche Tätigkeit', description: 'Tagespauschale für Tätigkeit in der häuslichen Wohnung', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 67, name: 'Sonstige beschränkt abziehbare Betriebsausgaben', description: 'Sonstige beschränkt abziehbare Ausgaben', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 68, name: 'Kfz-Leasingkosten', description: 'Leasingkosten für Kfz', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 69, name: 'Kfz-Steuern, Versicherungen und Maut', description: 'Kfz-Steuern, Versicherungen und Maut', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 70, name: 'Sonstige tatsächliche Fahrtkosten', description: 'Fahrtkosten ohne AfA und Zinsen', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 71, name: 'Fahrtkosten privates Fahrzeug', description: 'Fahrtkosten für nicht zum Betriebsvermögen gehörende Fahrzeuge', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 72, name: 'Fahrtkosten Wohnung und Betriebsstätte', description: 'Entfernungspauschale und Familienheimfahrten', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 73, name: 'Mindestens abziehbare Fahrtkosten', description: 'Mindestens abziehbare Fahrtkosten', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 74, name: 'Nicht abziehbare Beträge', description: 'Nicht abziehbare Betriebsausgaben', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 75, name: 'Summe Betriebsausgaben', description: 'Summe der Betriebsausgaben', type: 'expense', section: 'Betriebsausgaben' },
    { lineNumber: 90, name: 'Berechneter Überschuss (Übertrag)', description: 'Vereinfachter Übertrag der Summe/Differenz aus Zeilen 76 bis 89; keine vollständige steuerpflichtige Ergebnisermittlung', type: 'result', section: 'Ergebnis' },
];

/** 2024 and 2025 have the same numbered rows for the supported subset. */
export const EUR_LINES: EURLineDefinition[] = OFFICIAL_LINES;

const CATEGORY_MAPPINGS: Record<string, number> = {
    Einnahmen: 12, Umsatz: 12, Erlöse: 12, Verkauf: 12, Dienstleistung: 12, Honorar: 12, Provision: 12, Barverkauf: 12,
    Waren: 27, Wareneinkauf: 27, Material: 27, Materialkosten: 27, Rohstoffe: 27, Einkauf: 27,
    Fremdleistung: 29, Fremdleistungen: 29, Subunternehmer: 29, 'Externe Dienstleistung': 29,
    Personal: 30, Personalkosten: 30, Löhne: 30, Gehälter: 30, Lohn: 30, Minijob: 30,
    Abschreibung: 33, AfA: 33, Abschreibungen: 33, 'AfA (Abschreibung)': 33,
    GWG: 36, 'Geringwertige Wirtschaftsgüter': 36,
    Miete: 39, Raumkosten: 39, Büromiete: 39, Geschäftsmiete: 39, Nebenkosten: 41, 'Miete / Raumkosten': 39,
    Kfz: 70, 'Kfz-Kosten': 70, Fahrzeugkosten: 70, Benzin: 70, Tankkosten: 70,
    Telefon: 43, Internet: 43, Telekommunikation: 43, Mobilfunk: 43, Handy: 43, 'Telefon / Internet': 43,
    Fahrtkosten: 70, Kilometer: 71, Reisekosten: 44, Reise: 44,
    Bewirtung: 63, Geschäftsessen: 63, Geschenke: 62, Kundengeschenke: 62,
    Zinsen: 56, Bankzinsen: 56, Kreditzinsen: 56,
    Porto: 51, Versand: 53, Paket: 53, 'Porto / Versand': 51,
    Steuerberater: 46, Rechtsanwalt: 46, Beratung: 46, Beratungskosten: 46, 'Steuerberater / Beratung': 46,
    Leasing: 47, 'Miete Geräte': 47,
    Versicherung: 49, Versicherungen: 49, Beiträge: 49, Gebühren: 49, IHK: 49, Kammerbeitrag: 49, 'Versicherungen / Beiträge': 49,
    Werbung: 54, Marketing: 54, Werbekosten: 54, 'Werbung / Marketing': 54,
    Bürobedarf: 51, Büromaterial: 51, Verbrauchsmaterial: 51, Druckerpatronen: 51,
    Homeoffice: 66, Arbeitszimmer: 65, 'Home Office': 66,
    Sonstiges: 60, 'Sonstige Ausgaben': 60, 'Sonstige Kosten': 60, Verschiedenes: 60, 'Sonstige Betriebsausgaben': 60,
};


/**
 * Explicit crosswalk for this existing subset, BMF 01.09.2026, PDF pages 3–6.
 * This is NOT a form-wide offset: goods move 27 -> 29, while income is stable.
 * New agricultural reserve 27 and transfer subtotal 28 are deliberately absent.
 * Labels/types retain the bounded working-paper semantics, not fiscal approval.
 */
const ROWS_2026: Record<number, number> = {
    12: 12, 14: 14, 15: 15, 16: 16, 17: 17, 18: 18, 19: 19, 20: 20, 21: 21, 22: 22, 23: 23,
    24: 24, 25: 25, 26: 26, 27: 29,
    29: 30, 30: 31, 31: 32, 32: 33, 33: 34, 34: 35, 35: 36, 36: 37, 37: 38, 38: 39,
    39: 40, 40: 41, 41: 42, 42: 43, 43: 44, 44: 45, 45: 46, 46: 47, 47: 48, 48: 49,
    49: 50, 50: 51, 51: 52, 52: 53, 53: 54, 54: 55, 55: 56, 56: 57, 57: 58, 58: 59,
    59: 60, 60: 61, 61: 62, 62: 63, 63: 64, 64: 65, 65: 66, 66: 67, 67: 68,
    68: 69, 69: 70, 70: 71, 71: 72, 72: 73, 73: 74, 74: 75, 75: 76, 90: 91,
};

export interface EURYearContract {
    year: SupportedEURYear;
    mappingVersion: string;
    /** Retrieval identity; distinct from the application's mapping version. */
    sourceVersion: string;
    sourceSha256?: string;
    sourceReferences: string[];
    checkedScope: string;
    roles: {
        defaultIncome: number;
        fallbackExpense: number;
        movableDepreciation: number;
        intermediateResult: number;
    };
    resultDescription: string;
    resultCaveat: string;
    laterResultRowsLabel: string;
    lines: EURLineDefinition[];
    categoryMappings: Record<string, number>;
}

const LEGACY_RESULT_DESCRIPTION = OFFICIAL_LINES.find(line => line.lineNumber === 90)!.description;
const RESULT_DESCRIPTION_2026 = 'Vereinfachter Übertrag der Summe/Differenz aus Zeilen 77 bis 90; keine vollständige steuerpflichtige Ergebnisermittlung';
const LINES_2026 = OFFICIAL_LINES.map(line => ({
    ...line,
    lineNumber: ROWS_2026[line.lineNumber],
    ...(line.lineNumber === 27 ? {
        name: 'Waren, Rohstoffe und Hilfsstoffe einschließlich der Nebenkosten',
        description: 'Waren, Rohstoffe und Hilfsstoffe einschließlich der Nebenkosten',
    } : {}),
    ...(line.lineNumber === 42 ? { description: 'In Zeile 42 enthaltene Erhaltungsaufwendungen' } : {}),
    ...(line.lineNumber === 90 ? { description: RESULT_DESCRIPTION_2026 } : {}),
}));
const CATEGORY_MAPPINGS_2026 = Object.fromEntries(Object.entries(CATEGORY_MAPPINGS)
    .map(([category, row]) => [category, ROWS_2026[row]]));
const CHECKED_SCOPE = 'Jahresbezogene Zeilen des bestehenden vereinfachten Einzelbetriebs-Arbeitspapiers; keine vollständige steuerliche Ergebnisermittlung, Anlagenartprüfung oder ELSTER-Datensatzprüfung.';

function createYearContract(year: SupportedEURYear): EURYearContract {
    const is2026 = year === 2026;
    const intermediateResult = is2026 ? 91 : 90;
    const sourceRange = is2026 ? '77 bis 90' : '76 bis 89';
    const laterResultRowsLabel = is2026 ? '93, 96 und 98' : '92, 95 und 97';
    return {
        year,
        mappingVersion: EUR_MAPPING_VERSIONS[year],
        sourceVersion: year === 2024 ? 'ELSTER-Hilfe Anlage EÜR 2024 (ohne angezeigtes Revisionsdatum)'
            : is2026 ? 'BMF 01.09.2026, PDF-URL v=4, 44 Seiten, Hauptformular S. 3–6'
                : 'BMF 29.08.2025, PDF-URL v=2',
        ...(is2026 ? { sourceSha256: '03d3033acc5c5a126729e58743128596ae39193759c55b207872da9432b83a8f' } : {}),
        sourceReferences: [EUR_MAPPING_SOURCES[year], 'https://www.elster.de/eportal/formulare-leistungen/alleformulare/euer'],
        checkedScope: CHECKED_SCOPE,
        roles: { defaultIncome: 12, fallbackExpense: is2026 ? 61 : 60, movableDepreciation: is2026 ? 34 : 33, intermediateResult },
        resultDescription: is2026 ? RESULT_DESCRIPTION_2026 : LEGACY_RESULT_DESCRIPTION,
        resultCaveat: `Der ausgewiesene Betrag ist ein vereinfachter Überschuss für den Übertrag in Zeile ${intermediateResult} (Summe/Differenz der Zeilen ${sourceRange}). Die vollständige steuerpflichtige Ergebnisermittlung der späteren amtlichen Zeilen ${laterResultRowsLabel} wird hier nicht berechnet.`,
        laterResultRowsLabel,
        lines: is2026 ? LINES_2026 : OFFICIAL_LINES,
        categoryMappings: is2026 ? CATEGORY_MAPPINGS_2026 : CATEGORY_MAPPINGS,
    };
}

const YEAR_CONTRACTS: Record<SupportedEURYear, EURYearContract> = {
    2024: createYearContract(2024),
    2025: createYearContract(2025),
    2026: createYearContract(2026),
};

export function getEURYearContract(year: number): EURYearContract {
    if (!isSupportedEURYear(year)) throw new Error(`Nicht unterstütztes EÜR-Jahr: ${year}`);
    return YEAR_CONTRACTS[year];
}


function normalizeCategory(category: string): string {
    return category.toLowerCase().trim();
}

export function isSupportedEURYear(year: number): year is SupportedEURYear {
    return year === 2024 || year === 2025 || year === 2026;
}

export function getSupportedEURYears(): SupportedEURYear[] {
    return [2024, 2025, 2026];
}

export function getEURMappingVersion(year: number): string | null {
    return isSupportedEURYear(year) ? EUR_MAPPING_VERSIONS[year] : null;
}

export function getEURSourceReferences(year: number): string[] {
    return isSupportedEURYear(year) ? getEURYearContract(year).sourceReferences : [];
}

export function getEURLinesForYear(year: number): EURLineDefinition[] {
    if (!isSupportedEURYear(year)) return [];
    return getEURYearContract(year).lines;
}

export function getEURLineForCategoryForYear(category: string, year: number): number | null {
    if (!isSupportedEURYear(year) || !category) return null;
    const normalized = normalizeCategory(category);
    for (const [key, lineNumber] of Object.entries(getEURYearContract(year).categoryMappings)) {
        if (normalizeCategory(key) === normalized) return lineNumber;
    }
    return null;
}

export function getEURLineForCategory(category: string, year = 2025): number | null {
    return getEURLineForCategoryForYear(category, year);
}

export function getEURLineDefinition(lineNumber: number, year = 2025): EURLineDefinition | undefined {
    return getEURLinesForYear(year).find(line => line.lineNumber === lineNumber);
}

export function getIncomeLines(year = 2025): EURLineDefinition[] {
    return getEURLinesForYear(year).filter(line => line.type === 'income');
}

export function getExpenseLines(year = 2025): EURLineDefinition[] {
    return getEURLinesForYear(year).filter(line => line.type === 'expense');
}

export function formatAmountForElster(amount: number): string {
    return amount.toFixed(2).replace('.', ',');
}

export type EURCSVCorrection = {
    expenseId?: number;
    date: string;
    description?: string | null;
    category: string;
    amount: number;
    lineNumber: number | null;
    correctionReason: string;
    originalExpenseId?: number | null;
};

/** Generate a readable CSV working paper, never an ELSTER submission. */
export function generateElsterCSV(
    lines: Array<{ lineNumber: number; name: string; amount: number }>,
    year: number,
    companyName?: string,
    taxNumber?: string,
    options?: { mappingVersion?: string; sourceVersion?: string; sourceSha256?: string; checkedScope?: string; sourceReferences?: string[]; corrections?: EURCSVCorrection[]; warnings?: string[] },
): string {
    const BOM = '\uFEFF';
    let csv = BOM;
    csv += 'Anlage EÜR - CSV-Übertragungshilfe (keine ELSTER-Einreichung)\n';
    csv += `Veranlagungsjahr: ${year}\n`;
    if (options?.mappingVersion) csv += `Mappingversion: ${options.mappingVersion}\n`;
    if (options?.sourceVersion) csv += `Quellenversion: ${csvCell(options.sourceVersion)}\n`;
    if (options?.sourceSha256) csv += `Quellen-SHA256: ${options.sourceSha256}\n`;
    if (options?.checkedScope) csv += `Prüfumfang: ${csvCell(options.checkedScope)}\n`;
    for (const source of options?.sourceReferences ?? []) csv += `Quelle: ${csvCell(source)}\n`;
    if (companyName) csv += `Betrieb: ${csvCell(companyName)}\n`;
    if (taxNumber) csv += `Steuernummer: ${csvCell(taxNumber)}\n`;
    csv += 'Hinweis: Diese Datei ist eine Arbeitsunterlage für die Übertragung durch eine fachkundige Person.\n\n';
    csv += 'Zeile;Bezeichnung;Betrag (EUR)\n';
    const sortedLines = [...lines].sort((a, b) => a.lineNumber - b.lineNumber);
    for (const line of sortedLines) {
        if (line.amount !== 0) csv += `${line.lineNumber};${csvCell(line.name)};${formatAmountForElster(line.amount)}\n`;
    }
    if (options?.corrections && options.corrections.length > 0) {
        csv += '\nKorrekturen / Erstattungen (Prüfspur)\n';
        csv += 'Buchungs-ID;Geschäftstag;Beschreibung;Kategorie;Betrag (EUR);EÜR-Zeile;Grund;Ursprungs-ID\n';
        for (const correction of options.corrections) {
            const cells = [
                correction.expenseId ?? '', correction.date.slice(0, 10), correction.description ?? '', correction.category,
                formatAmountForElster(correction.amount), correction.lineNumber ?? '', correction.correctionReason,
                correction.originalExpenseId ?? '',
            ].map(value => csvCell(String(value)));
            csv += `${cells.join(';')}\n`;
        }
    }
    if (options?.warnings && options.warnings.length > 0) {
        csv += '\nPrüfhinweise\n';
        csv += 'Hinweis\n';
        for (const warning of options.warnings) csv += `${csvCell(warning)}\n`;
    }
    return csv;
}

function csvCell(value: string): string {
    return /[;"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function getDefaultIncomeLineForKleinunternehmer(year = 2025): number {
    if (!isSupportedEURYear(year)) throw new Error(`Nicht unterstütztes EÜR-Jahr: ${year}`);
    return getEURYearContract(year).roles.defaultIncome;
}

export function getDefaultExpenseLineForYear(year: number): number {
    if (!isSupportedEURYear(year)) throw new Error(`Nicht unterstütztes EÜR-Jahr: ${year}`);
    return getEURYearContract(year).roles.fallbackExpense;
}

export function getDefaultExpenseLine(year = 2025): number {
    return getDefaultExpenseLineForYear(year);
}

export function getRecommendedExpenseCategories(): string[] {
    return [
        'Privatentnahme', 'Wareneinkauf', 'Fremdleistungen', 'Personalkosten', 'AfA (Abschreibung)', 'GWG',
        'Miete / Raumkosten', 'Kfz-Kosten', 'Telefon / Internet', 'Fahrtkosten', 'Reisekosten', 'Bewirtung',
        'Geschenke', 'Zinsen', 'Porto / Versand', 'Steuerberater / Beratung', 'Leasing', 'Versicherungen / Beiträge',
        'Werbung / Marketing', 'Bürobedarf', 'Homeoffice', 'Sonstige Ausgaben',
    ].sort((a, b) => a.localeCompare(b, 'de'));
}

export function getRecommendedIncomeCategories(): string[] {
    return ['Privateinlage', 'Dienstleistung', 'Honorar', 'Provision', 'Verkauf', 'Umsatzerlöse', 'Sonstige Einnahmen']
        .sort((a, b) => a.localeCompare(b, 'de'));
}

export function getCategoryWithEURInfo(category: string, year = 2025): { category: string; eurLine: number | null; eurLineName: string | null } {
    const eurLine = getEURLineForCategoryForYear(category, year);
    const lineDef = eurLine ? getEURLineDefinition(eurLine, year) : null;
    return { category, eurLine, eurLineName: lineDef?.name || null };
}
