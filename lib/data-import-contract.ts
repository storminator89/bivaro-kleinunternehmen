import { CUSTOMER_FIELD_LIMITS, customerBusinessIdentity } from '@/lib/customer-field-contract';

/** Bounded, text-only CSV onboarding. Nothing in this module writes or evaluates cells. */
export type ImportKind = 'customers' | 'articles';
export const MAX_IMPORT_BYTES = 256 * 1024;
export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_COLUMNS = 20;
export const MAX_IMPORT_CELL_LENGTH = 2_000;
export const MAX_IMPORT_PRICE_CENTS = '999999999';

export class ImportInputError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'ImportInputError';
  }
}

export type ImportColumnMapping = Record<string, number>;
export type ImportField = { key: string; label: string; required: boolean; aliases: string[] };
export type ParsedImportCsv = { headers: string[]; rows: { line: number; cells: string[] }[]; delimiter: string };
export type NormalizedImportRow = { line: number; data: Record<string, string | null>; errors: string[] };

const CUSTOMER_FIELDS: ImportField[] = [
  { key: 'name', label: 'Name / Firma', required: true, aliases: ['Name', 'Firma', 'Kunde', 'Kundenname', 'Company'] },
  { key: 'email', label: 'E-Mail', required: false, aliases: ['E-Mail', 'Email', 'Mail'] },
  { key: 'address', label: 'Straße und Hausnummer', required: false, aliases: ['Adresse', 'Straße', 'Strasse', 'Anschrift', 'Address'] },
  { key: 'zipCode', label: 'Postleitzahl', required: false, aliases: ['PLZ', 'Postleitzahl', 'Zip', 'PostalCode'] },
  { key: 'city', label: 'Ort', required: false, aliases: ['Ort', 'Stadt', 'City'] },
  { key: 'contactPerson', label: 'Ansprechpartner', required: false, aliases: ['Ansprechpartner', 'Kontaktperson', 'Contact'] },
  { key: 'phone', label: 'Telefon', required: false, aliases: ['Telefon', 'Telefonnummer', 'Phone'] },
  { key: 'taxNumber', label: 'Steuernummer', required: false, aliases: ['Steuernummer', 'TaxNumber'] },
];
const ARTICLE_FIELDS: ImportField[] = [
  { key: 'name', label: 'Bezeichnung', required: true, aliases: ['Bezeichnung', 'Name', 'Artikel', 'Leistung', 'Artikelname'] },
  { key: 'description', label: 'Beschreibung', required: false, aliases: ['Beschreibung', 'Description', 'Details'] },
  { key: 'unit', label: 'Einheit', required: true, aliases: ['Einheit', 'Unit', 'Mengeneinheit'] },
  { key: 'price', label: 'Einzelpreis in EUR', required: true, aliases: ['Preis', 'Einzelpreis', 'Price', 'Preis EUR', 'Einzelpreis EUR'] },
  { key: 'priceBasis', label: 'Preisart NET / GROSS', required: true, aliases: ['Preisart', 'Preisbasis', 'PriceBasis', 'NettoBrutto'] },
  { key: 'taxRate', label: 'Steuersatz 0 / 7 / 19', required: true, aliases: ['Steuersatz', 'USt', 'MwSt', 'TaxRate'] },
];

export function fieldsFor(kind: ImportKind): ImportField[] {
  if (kind === 'customers') return CUSTOMER_FIELDS.map(field => ({ ...field, aliases: [...field.aliases] }));
  if (kind === 'articles') return ARTICLE_FIELDS.map(field => ({ ...field, aliases: [...field.aliases] }));
  throw new ImportInputError('Bitte Kunden oder Leistungen / Artikel als Importziel wählen.');
}

const controlCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const formulaPrefix = /^[=+\-@]/;
function normalizedText(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('de-DE').replace(/\s+/g, ' ');
}
function headerIdentity(value: string): string {
  return normalizedText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');
}

function detectDelimiter(text: string): string {
  const counts = new Map([[';', 0], [',', 0], ['\t', 0]]);
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted) {
      if (character === '\r' || character === '\n') break;
      if (counts.has(character)) counts.set(character, counts.get(character)! + 1);
    }
  }
  return [...counts].sort((left, right) => right[1] - left[1])[0][0];
}

export function parseImportCsv(input: string): ParsedImportCsv {
  if (typeof input !== 'string') throw new ImportInputError('Bitte eine CSV-Datei als UTF-8-Text auswählen.');
  if (new TextEncoder().encode(input).byteLength > MAX_IMPORT_BYTES) throw new ImportInputError('Die CSV-Datei darf höchstens 256 KiB groß sein.', 413);
  const text = input.replace(/^\uFEFF/, '');
  if (!text.trim()) throw new ImportInputError('Die CSV-Datei ist leer.');
  if (controlCharacters.test(text) || text.includes('\uFFFD') || /[\uD800-\uDFFF]/u.test(text)) throw new ImportInputError('Die CSV-Datei enthält ungültige Zeichen. Bitte als UTF-8 speichern.');
  const delimiter = detectDelimiter(text);
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let state: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
  let line = 1;
  let recordLine = 1;
  function finishCell() {
    if (cell.length > MAX_IMPORT_CELL_LENGTH) throw new ImportInputError(`Zeile ${recordLine}: Ein Feld darf höchstens 2.000 Zeichen enthalten.`);
    cells.push(cell);
    if (cells.length > MAX_IMPORT_COLUMNS) throw new ImportInputError('Die CSV-Datei darf höchstens 20 Spalten enthalten.');
    cell = '';
    state = 'start';
  }
  function finishRecord() {
    finishCell();
    if (cells.some(value => value.trim() !== '')) {
      records.push({ line: recordLine, cells });
      if (records.length > MAX_IMPORT_ROWS + 1) throw new ImportInputError('Die CSV-Datei darf höchstens 500 Datenzeilen enthalten.');
    }
    cells = [];
  }
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    const newline = character === '\r' || character === '\n';
    if (state === 'quoted') {
      if (character === '"') {
        if (text[index + 1] === '"') { cell += '"'; index++; }
        else state = 'closed';
      } else if (newline) {
        cell += '\n';
        if (character === '\r' && text[index + 1] === '\n') index++;
        line++;
      } else cell += character;
    } else if (character === delimiter) finishCell();
    else if (newline) {
      finishRecord();
      if (character === '\r' && text[index + 1] === '\n') index++;
      line++;
      recordLine = line;
    } else if (state === 'closed') {
      throw new ImportInputError(`Zeile ${line}: Nach einem schließenden Anführungszeichen sind nur Trennzeichen oder Zeilenende erlaubt.`);
    } else if (character === '"') {
      if (state !== 'start') throw new ImportInputError(`Zeile ${line}: Anführungszeichen müssen das gesamte Feld umschließen.`);
      state = 'quoted';
    } else { cell += character; state = 'plain'; }
    // Bound allocation during quoted fields too, not only when the field closes.
    if (cell.length > MAX_IMPORT_CELL_LENGTH) throw new ImportInputError(`Zeile ${recordLine}: Ein Feld darf höchstens 2.000 Zeichen enthalten.`);
  }
  if (state === 'quoted') throw new ImportInputError(`Zeile ${recordLine}: Ein Anführungszeichen wurde nicht geschlossen.`);
  if (cell !== '' || cells.length || state === 'closed') finishRecord();
  const first = records.shift();
  if (!first) throw new ImportInputError('Eine Kopfzeile mit Spaltennamen fehlt.');
  const headers = first.cells.map(value => value.trim());
  const seen = new Set<string>();
  for (const header of headers) {
    if (!header) throw new ImportInputError('Jede Spalte benötigt einen Namen in der Kopfzeile.');
    if (formulaPrefix.test(header)) throw new ImportInputError('Formelartige Spaltennamen sind nicht erlaubt.');
    const identity = normalizedText(header);
    if (seen.has(identity)) throw new ImportInputError(`Der Spaltenname „${header}“ kommt mehrfach vor. Bitte eindeutig benennen.`);
    seen.add(identity);
  }
  if (!records.length) throw new ImportInputError('Die CSV-Datei enthält keine Datenzeilen.');
  return { headers, rows: records, delimiter };
}

export function autoMapColumns(kind: ImportKind, headers: string[]): ImportColumnMapping {
  const mapping: ImportColumnMapping = {};
  const used = new Set<number>();
  for (const field of fieldsFor(kind)) {
    const aliases = new Set([field.key, field.label, ...field.aliases].map(headerIdentity));
    const matches = headers.map((header, index) => aliases.has(headerIdentity(header)) ? index : -1).filter(index => index >= 0 && !used.has(index));
    // Ambiguous matches require a deliberate user choice instead of guessing.
    if (matches.length === 1) { mapping[field.key] = matches[0]; used.add(matches[0]); }
  }
  return mapping;
}

function validateMapping(kind: ImportKind, parsed: ParsedImportCsv, mapping: ImportColumnMapping): ImportField[] {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw new ImportInputError('Bitte die CSV-Spalten zuordnen.');
  const fields = fieldsFor(kind);
  const allowed = new Set(fields.map(field => field.key));
  const used = new Set<number>();
  for (const [key, index] of Object.entries(mapping)) {
    if (!allowed.has(key)) throw new ImportInputError('Die Spaltenzuordnung enthält ein unbekanntes Zielfeld.');
    if (index === -1) continue;
    if (!Number.isInteger(index) || index < 0 || index >= parsed.headers.length) throw new ImportInputError('Die Spaltenzuordnung enthält eine ungültige CSV-Spalte.');
    if (used.has(index)) throw new ImportInputError('Jede CSV-Spalte darf nur einem Zielfeld zugeordnet werden.');
    used.add(index);
  }
  for (const field of fields) {
    if (field.required && (mapping[field.key] === undefined || mapping[field.key] === -1)) throw new ImportInputError(`Bitte die Pflichtspalte „${field.label}“ zuordnen.`);
  }
  return fields;
}

function priceCents(value: string | null): string | null {
  if (value === null || !/^\d+(?:[.,]\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split(/[.,]/);
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
  return cents <= BigInt(MAX_IMPORT_PRICE_CENTS) ? cents.toString() : null;
}

export function normalizeImportRows(kind: ImportKind, parsed: ParsedImportCsv, mapping: ImportColumnMapping): NormalizedImportRow[] {
  const fields = validateMapping(kind, parsed, mapping);
  return parsed.rows.map(row => {
    const errors: string[] = [];
    const data: Record<string, string | null> = {};
    if (row.cells.length !== parsed.headers.length) errors.push(`Die Zeile hat ${row.cells.length} statt ${parsed.headers.length} Spalten.`);
    // Inspect all source cells, including ignored columns. We never execute formulas.
    if (row.cells.some((value, index) => {
      const trimmed = value.trim();
      const safeInternationalPhone = kind === 'customers' && mapping.phone === index && /^\+[0-9][0-9 ()-]*$/.test(trimmed);
      return formulaPrefix.test(trimmed) && !safeInternationalPhone;
    })) errors.push('Formelartige Werte (=, +, - oder @ am Anfang) sind nicht erlaubt. Als reinen Text ohne Formelzeichen speichern.');
    for (const field of fields) {
      const index = mapping[field.key];
      const value = index === undefined || index === -1 ? '' : (row.cells[index] ?? '').trim();
      data[field.key] = value || null;
      if (field.required && !value) errors.push(`„${field.label}“ fehlt.`);
      if (kind === 'articles' && field.key === 'name' && value.length > 200) errors.push('Der Name darf höchstens 200 Zeichen enthalten.');
    }
    if (kind === 'customers') {
      for (const [key, limit] of Object.entries(CUSTOMER_FIELD_LIMITS)) {
        if (data[key] && data[key]!.length > limit) errors.push(`„${fields.find(field => field.key === key)!.label}“ darf höchstens ${limit} Zeichen enthalten.`);
      }
      if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push('Die E-Mail-Adresse ist ungültig.');
    } else {
      if (data.unit && data.unit.length > 100) errors.push('Die Einheit darf höchstens 100 Zeichen enthalten.');
      const sourcePriceCents = priceCents(data.price);
      if (data.price && sourcePriceCents === null) errors.push('Der Einzelpreis muss ein nicht negativer EUR-Betrag mit höchstens zwei Nachkommastellen sein (z. B. 49,90), ohne Tausendertrennzeichen; höchstens 9.999.999,99 EUR.');
      const basis = data.priceBasis?.toUpperCase();
      const sourcePriceBasis = basis === 'NET' || basis === 'NETTO' ? 'NET' : basis === 'GROSS' || basis === 'BRUTTO' ? 'GROSS' : null;
      if (data.priceBasis && sourcePriceBasis === null) errors.push('Die Preisart muss ausdrücklich NET / NETTO oder GROSS / BRUTTO sein.');
      const tax = data.taxRate?.replace(/\s*%$/, '');
      const taxRate = tax === '0' || tax === '7' || tax === '19' ? tax : null;
      if (data.taxRate && taxRate === null) errors.push('Der Steuersatz muss ausdrücklich 0, 7 oder 19 sein. Leer bedeutet nicht 0 %.');
      let unitPriceCents: string | null = null;
      if (sourcePriceCents !== null && sourcePriceBasis !== null && taxRate !== null) {
        const source = BigInt(sourcePriceCents);
        const divisor = BigInt(100 + Number(taxRate));
        unitPriceCents = sourcePriceBasis === 'NET' ? source.toString() : ((source * BigInt(100) + divisor / BigInt(2)) / divisor).toString();
      }
      delete data.price;
      delete data.priceBasis;
      data.sourcePriceCents = sourcePriceCents;
      data.sourcePriceBasis = sourcePriceBasis;
      data.taxRate = taxRate;
      data.unitPriceCents = unitPriceCents;
    }
    return { line: row.line, data, errors };
  });
}

/** Stable identity is conservative: duplicates are reported/skipped, never merged. */
export function duplicateIdentity(kind: ImportKind, data: Record<string, string | null>): string {
  if (kind === 'customers') return customerBusinessIdentity(data);
  const keys = ['name'];
  return JSON.stringify(keys.map(key => normalizedText(data[key] ?? '')));
}
