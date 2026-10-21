import { describe, expect, it } from 'vitest';
import legacyLines from './fixtures/eur-legacy-lines.json';
import {
  EUR_MAPPING_SOURCES,
  getDefaultExpenseLineForYear,
  getDefaultIncomeLineForKleinunternehmer,
  getEURLineDefinition,
  getEURLineForCategoryForYear,
  getEURLinesForYear,
  getEURMappingVersion,
  getEURSourceReferences,
  getEURYearContract,
  getSupportedEURYears,
  isSupportedEURYear,
} from '../eur-line-mapping';

// 2026 expected positions are independent constants transcribed from the
// visually reviewed BMF 01.09.2026 PDF (URL revision v=4), pages 3–6.
// These cases are not evidence of complete fiscal/ELSTER certification.
describe('BMF 2026 supported working-paper subset', () => {
  it.each([
    ['Wareneinkauf', 29], ['Fremdleistungen', 30], ['Personal', 31],
    ['AfA', 34], ['GWG', 37], ['Miete', 40], ['Nebenkosten', 42],
    ['Telefon', 44], ['Reisekosten', 45], ['Steuerberater', 47],
    ['Versicherung', 50], ['Bürobedarf', 52], ['Werbung', 55],
    ['Zinsen', 57], ['Sonstiges', 61], ['Geschenke', 63],
    ['Bewirtung', 64], ['Arbeitszimmer', 66], ['Homeoffice', 67],
    ['Kfz', 71], ['Kilometer', 72], ['Einnahmen', 12],
  ] as const)('maps %s to verified row %i', (category, row) => {
    expect(getEURLineForCategoryForYear(category, 2026)).toBe(row);
  });

  it('keeps income and lump-sum rows stable, without adding agricultural reserve or subtotal postings', () => {
    for (const row of [12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26]) {
      expect(getEURLineDefinition(row, 2026)).toEqual(getEURLineDefinition(row, 2025));
    }
    expect(getEURLineDefinition(13, 2026)).toBeUndefined();
    expect(getEURLineDefinition(27, 2026)).toBeUndefined();
    expect(getEURLineDefinition(28, 2026)).toBeUndefined();
    expect(getEURLineDefinition(29, 2026)?.name).toBe('Waren, Rohstoffe und Hilfsstoffe einschließlich der Nebenkosten');
    expect(getEURLineDefinition(33, 2026)?.name).toBe('AfA auf immaterielle Wirtschaftsgüter');
    expect(getEURLineDefinition(34, 2026)?.name).toBe('AfA auf bewegliche Wirtschaftsgüter');
    expect(getEURLineDefinition(61, 2026)?.name).toBe('Übrige unbeschränkt abziehbare Betriebsausgaben');
    expect(getEURLineDefinition(91, 2026)?.type).toBe('result');
    expect(getEURLineDefinition(90, 2026)).toBeUndefined();
    const rows = getEURLinesForYear(2026).map(line => line.lineNumber);
    expect(new Set(rows).size).toBe(rows.length);
    expect(rows.every(Number.isInteger)).toBe(true);
  });

  it('exposes one contract for API and UI roles, provenance and bounded result wording', () => {
    const contract = getEURYearContract(2026);
    expect(contract.roles).toEqual({ defaultIncome: 12, fallbackExpense: 61, movableDepreciation: 34, intermediateResult: 91 });
    expect(getDefaultIncomeLineForKleinunternehmer(2026)).toBe(12);
    expect(getDefaultExpenseLineForYear(2026)).toBe(61);
    expect(contract.mappingVersion).toBe('anlage-euer-2026-v1');
    expect(contract.sourceVersion).toBe('BMF 01.09.2026, PDF-URL v=4, 44 Seiten, Hauptformular S. 3–6');
    expect(contract.sourceReferences[0]).toBe(EUR_MAPPING_SOURCES[2026]);
    expect(contract.sourceReferences[0]).toContain('2026-09-01-anlage-EUER-2026.pdf?__blob=publicationFile&v=4');
    expect(contract.sourceSha256).toBe('03d3033acc5c5a126729e58743128596ae39193759c55b207872da9432b83a8f');
    expect(contract.checkedScope).toContain('keine vollständige steuerliche Ergebnisermittlung');
    expect(contract.resultDescription).toContain('77 bis 90');
    expect(contract.resultCaveat).toContain('Zeile 91');
    expect(contract.resultCaveat).toContain('Zeilen 93, 96 und 98');
  });

  it.each([2024, 2025])('preserves every accepted %i line, mapping version and legacy role', year => {
    // Frozen from accepted 79e07e2, not a recertification of legacy tax semantics.
    expect(getEURLinesForYear(year)).toEqual(legacyLines);
    expect(getEURMappingVersion(year)).toBe(`anlage-euer-${year}-v1`);
    expect(getEURYearContract(year).roles).toEqual({ defaultIncome: 12, fallbackExpense: 60, movableDepreciation: 33, intermediateResult: 90 });
    expect(getEURLineForCategoryForYear('Wareneinkauf', year)).toBe(27);
    expect(getEURYearContract(year).resultCaveat).toBe('Der ausgewiesene Betrag ist ein vereinfachter Überschuss für den Übertrag in Zeile 90 (Summe/Differenz der Zeilen 76 bis 89). Die vollständige steuerpflichtige Ergebnisermittlung der späteren amtlichen Zeilen 92, 95 und 97 wird hier nicht berechnet.');
  });

  it('never guesses future-year mappings or unfamiliar categories', () => {
    expect(getSupportedEURYears()).toEqual([2024, 2025, 2026]);
    for (const year of [2027, 2030, 0, NaN]) {
      expect(isSupportedEURYear(year)).toBe(false);
      expect(getEURLinesForYear(year)).toEqual([]);
      expect(getEURLineForCategoryForYear('Wareneinkauf', year)).toBeNull();
      expect(getEURMappingVersion(year)).toBeNull();
      expect(getEURSourceReferences(year)).toEqual([]);
      expect(() => getEURYearContract(year)).toThrow('Nicht unterstütztes EÜR-Jahr');
    }
    expect(getEURLineForCategoryForYear('Rücklage Tierbewertung', 2026)).toBeNull();
    expect(getEURLineForCategoryForYear('Telefon und Fax', 2026)).toBeNull();
  });
});
