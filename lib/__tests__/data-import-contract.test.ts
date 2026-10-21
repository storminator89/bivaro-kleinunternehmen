import { describe, expect, it } from 'vitest';
import {
  autoMapColumns, duplicateIdentity, fieldsFor, ImportInputError,
  MAX_IMPORT_BYTES, MAX_IMPORT_CELL_LENGTH, MAX_IMPORT_ROWS,
  normalizeImportRows, parseImportCsv,
} from '@/lib/data-import-contract';

function normalize(kind: 'customers' | 'articles', text: string) {
  const parsed = parseImportCsv(text);
  return normalizeImportRows(kind, parsed, autoMapColumns(kind, parsed.headers));
}

const articleHeader = 'Bezeichnung;Beschreibung;Einheit;Preis;Preisart;Steuersatz';

describe('bounded CSV text parser', () => {
  it('reads BOM, CRLF, semicolon, quoted separators, escaped quotes and embedded line breaks', () => {
    const parsed = parseImportCsv('\uFEFFName;Adresse\r\n"Muster; \"\"Werk\"\"";"Erste Zeile\r\nZweite Zeile"\r\nFolgekunde;Straße 2\r\n');
    expect(parsed).toEqual({
      delimiter: ';', headers: ['Name', 'Adresse'], rows: [
        { line: 2, cells: ['Muster; "Werk"', 'Erste Zeile\nZweite Zeile'] },
        { line: 4, cells: ['Folgekunde', 'Straße 2'] },
      ],
    });
  });

  it('detects comma and tab outside quoted headers, and permits a single-column customer file', () => {
    expect(parseImportCsv('"Name, Firma";Ort\nWerk;Berlin').delimiter).toBe(';');
    expect(parseImportCsv('Name,Ort\nWerk,Berlin').delimiter).toBe(',');
    expect(parseImportCsv('Name\tOrt\nWerk\tBerlin').delimiter).toBe('\t');
    expect(normalize('customers', 'Name\nMuster')).toMatchObject([{ data: { name: 'Muster', email: null }, errors: [] }]);
  });

  it('ignores genuinely empty lines without losing source line numbers', () => {
    expect(parseImportCsv('\nName;Ort\n\nWerk;Berlin\n;\n').rows).toEqual([{ line: 4, cells: ['Werk', 'Berlin'] }]);
  });

  it.each([
    ['', /leer/], ['Name\n', /keine Datenzeilen/], ['Name;\nWerk;Berlin', /Spalte benötigt/],
    ['Name; name \nWerk;Berlin', /mehrfach/], ['=Name\nWerk', /Formelartige Spaltennamen/],
    ['Name\n"Werk', /nicht geschlossen/], ['Name\nWe"rk', /gesamte Feld/],
    ['Name\n"Werk"x', /schließenden/], ['Name\nWerk\u0000', /ungültige Zeichen/],
    ['Name\nWerk\uFFFD', /UTF-8/], ['Name\nWerk\uD800', /UTF-8/],
  ])('rejects malformed or unsafe CSV: %s', (text, message) => {
    expect(() => parseImportCsv(text)).toThrow(message);
  });

  it('limits encoded bytes rather than JavaScript string length', () => {
    try {
      parseImportCsv('Name\n' + 'ä'.repeat(MAX_IMPORT_BYTES / 2));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ImportInputError);
      expect(error).toMatchObject({ status: 413 });
    }
  });

  it('bounds rows, columns and individual cells before normalization', () => {
    expect(parseImportCsv('Name\n' + Array(MAX_IMPORT_ROWS).fill('Werk').join('\n')).rows).toHaveLength(500);
    expect(() => parseImportCsv('Name\n' + Array(MAX_IMPORT_ROWS + 1).fill('Werk').join('\n'))).toThrow(/500 Datenzeilen/);
    expect(() => parseImportCsv(Array.from({ length: 21 }, (_, index) => `C${index}`).join(';') + '\n' + Array(21).fill('x').join(';'))).toThrow(/20 Spalten/);
    expect(() => parseImportCsv('Name\n"' + 'x'.repeat(MAX_IMPORT_CELL_LENGTH + 1) + '"')).toThrow(/2.000 Zeichen/);
  });
});

describe('mapping and customer normalization', () => {
  it('maps German aliases, preserves unknown vs absent data, leading-zero ZIPs and safe international phone text', () => {
    expect(normalize('customers', 'Firma;E-Mail;PLZ;Telefon;Ort\n Musterwerk ;werk@example.test;01234;+49 (30) 123-456; Berlin ')).toEqual([{
      line: 2,
      data: { name: 'Musterwerk', email: 'werk@example.test', address: null, zipCode: '01234', city: 'Berlin', contactPerson: null, phone: '+49 (30) 123-456', taxNumber: null },
      errors: [],
    }]);
  });

  it('does not guess an ambiguous alias mapping', () => {
    expect(autoMapColumns('customers', ['Name', 'Firma', 'E-Mail'])).toEqual({ email: 2 });
    expect(() => normalize('customers', 'Name;Firma\nWerk;Werk')).toThrow(/Pflichtspalte/);
  });

  it('requires deliberate unique, in-range mappings and rejects unknown keys', () => {
    const parsed = parseImportCsv('Name;Ort\nWerk;Berlin');
    expect(() => normalizeImportRows('customers', parsed, { name: 0, city: 0 })).toThrow(/nur einem/);
    expect(() => normalizeImportRows('customers', parsed, { name: 2 })).toThrow(/ungültige CSV-Spalte/);
    expect(() => normalizeImportRows('customers', parsed, { name: 0.5 })).toThrow(/ungültige CSV-Spalte/);
    expect(() => normalizeImportRows('customers', parsed, { name: 0, userId: 1 })).toThrow(/unbekanntes/);
    expect(normalizeImportRows('customers', parsed, { name: 0, city: -1 })[0].data.city).toBeNull();
  });

  it('keeps row errors reviewable rather than dropping invalid rows', () => {
    const rows = normalize('customers', 'Name;E-Mail;Ort\n;falsch;Berlin\nWerk;werk@example.test\n' + 'x'.repeat(256) + ';;Bonn');
    expect(rows).toHaveLength(3);
    expect(rows[0].errors).toEqual(expect.arrayContaining([expect.stringContaining('fehlt'), expect.stringContaining('E-Mail-Adresse')]));
    expect(rows[1].errors).toEqual(expect.arrayContaining([expect.stringContaining('2 statt 3')]));
    expect(rows[2].errors).toEqual(expect.arrayContaining([expect.stringContaining('255 Zeichen')]));
  });

  it.each(['=HYPERLINK("example")', '+SUM(1)', '-2+3', '@SUM(1)', '  =1+1'])('rejects formula-like values, including ignored columns: %s', value => {
    const escaped = '"' + value.replaceAll('"', '""') + '"';
    const rows = normalize('customers', `Name;Unbekannt\nWerk;${escaped}`);
    expect(rows[0].errors).toEqual(expect.arrayContaining([expect.stringContaining('Formelartige Werte')]));
  });

  it('only permits plus-prefixed international numbers in the mapped phone field', () => {
    expect(normalize('customers', 'Name;Telefon\nWerk;+49 123-456')[0].errors).toEqual([]);
    expect(normalize('customers', 'Name;Telefon\nWerk;+49SUM(1)')[0].errors).toEqual(expect.arrayContaining([expect.stringContaining('Formelartige')]));
    expect(normalize('customers', 'Name;Unbekannt\nWerk;+49 123-456')[0].errors).toEqual(expect.arrayContaining([expect.stringContaining('Formelartige')]));
  });

  it('forms deterministic customer identities but does not conflate different business addresses', () => {
    const first = { name: ' Musterwerk ', email: 'WERK@example.test', address: 'Straße 1', zipCode: '01234', city: 'Berlin' };
    expect(duplicateIdentity('customers', first)).toBe(duplicateIdentity('customers', { ...first, name: 'musterwerk', email: 'werk@example.test' }));
    expect(duplicateIdentity('customers', first)).not.toBe(duplicateIdentity('customers', { ...first, address: 'Straße 2' }));
    // JSON boundaries prevent ambiguous field concatenation.
    expect(duplicateIdentity('customers', { name: 'a|b', email: 'c' })).not.toBe(duplicateIdentity('customers', { name: 'a', email: 'b|c' }));
  });

  it('does not expose mutable shared field definitions', () => {
    fieldsFor('customers')[0].aliases.push('Unbekannt');
    expect(autoMapColumns('customers', ['Unbekannt'])).toEqual({});
    expect(() => fieldsFor('invoices' as 'customers')).toThrow(ImportInputError);
  });
});

describe('exact service/article price meaning', () => {
  it.each([
    ['49,90', 'NET', '19', '4990', '4990'],
    ['119.00', 'GROSS', '19%', '11900', '10000'],
    ['107', 'BRUTTO', '7', '10700', '10000'],
    ['10,00', 'NETTO', '0', '1000', '1000'],
    ['0,00', 'NET', '0', '0', '0'],
    ['0,01', 'GROSS', '19', '1', '1'],
    ['0,03', 'GROSS', '19', '3', '3'],
    ['9999999.99', 'NET', '19', '999999999', '999999999'],
  ])('preserves explicit %s %s tax %s as exact cents', (price, basis, tax, source, net) => {
    expect(normalize('articles', `${articleHeader}\nBeratung;Vor Ort;Stunde;${price};${basis};${tax}`)[0]).toEqual({
      line: 2, errors: [], data: { name: 'Beratung', description: 'Vor Ort', unit: 'Stunde', taxRate: tax.replace('%', ''), sourcePriceCents: source, sourcePriceBasis: basis === 'GROSS' || basis === 'BRUTTO' ? 'GROSS' : 'NET', unitPriceCents: net },
    });
  });

  it('rejects missing tax and price without inventing zero values', () => {
    const row = normalize('articles', `${articleHeader}\nBeratung;;Stunde;;NET;`)[0];
    expect(row.errors).toEqual(expect.arrayContaining([expect.stringContaining('Einzelpreis'), expect.stringContaining('Steuersatz')]));
    expect(row.data).toMatchObject({ sourcePriceCents: null, taxRate: null, unitPriceCents: null });
  });

  it.each(['1.234,56', '1,234.56', '1e2', '-1', '1.001', 'NaN', '€ 10', '10000000.00'])('rejects ambiguous, signed, sub-cent or oversized price %s', price => {
    expect(normalize('articles', `${articleHeader}\nBeratung;;Stunde;${price};NET;19`)[0].errors.length).toBeGreaterThan(0);
  });

  it('rejects overly long units rather than importing an unreadable catalog entry', () => {
    expect(normalize('articles', `${articleHeader}\nBeratung;;${'x'.repeat(101)};10;NET;19`)[0].errors).toEqual(expect.arrayContaining([expect.stringContaining('100 Zeichen')]));
  });

  it('rejects unknown price meaning, unsupported tax and article names that exceed backup-safe limits', () => {
    const row = normalize('articles', `${articleHeader}\n${'x'.repeat(201)};;Stunde;10;unbekannt;20`)[0];
    expect(row.errors).toEqual(expect.arrayContaining([expect.stringContaining('200 Zeichen'), expect.stringContaining('Preisart'), expect.stringContaining('Steuersatz')]));
    expect(row.data.unitPriceCents).toBeNull();
  });

  it('does not infer fiscal profile and treats same-name article variants as deliberate duplicate review', () => {
    const row = normalize('articles', `${articleHeader}\nBeratung;;Stunde;100;NET;19`)[0];
    expect(row.data).not.toHaveProperty('fiscalTaxRegime');
    expect(duplicateIdentity('articles', row.data)).toBe(duplicateIdentity('articles', { ...row.data, name: ' BERATUNG ', unit: 'Tag', unitPriceCents: '50000' }));
  });
});
