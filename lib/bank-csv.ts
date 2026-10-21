/** Browser-only, read-only preparation. No network, storage, ledger or booking APIs. */
export const MAX_BANK_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_BANK_CSV_ROWS = 2000;
export const MAX_BANK_CSV_COLUMNS = 64;
export const MAX_BANK_CSV_FIELD_LENGTH = 4000;
const MAX_HEADER_ROW = 50;

export type BankCsvDelimiter = ';' | ',' | '\t';
export type BankCsvParsed = {
  headers: string[];
  /** Data records only; the selected header and preceding records are excluded. */
  rows: string[][];
  delimiter: BankCsvDelimiter;
  /** Zero-based selected header record, excluding an optional sep= directive. */
  skippedLines: number;
  /** One-based physical source line of each data record (including quoted newlines). */
  rowNumbers: number[];
};
export type BankCsvMapping = {
  headerRow: number;
  date: number | null;
  amount: number | null;
  credit: number | null;
  debit: number | null;
  currency: number | null;
  counterparty: number | null;
  reference: number | null;
  externalId: number | null;
  decimalSeparator: ',' | '.';
  accountAlias: string;
  defaultCurrency?: 'EUR';
  amountMode: 'signed' | 'credit-debit';
};
export type BankCsvPreviewRow = {
  rowNumber: number;
  date: string | null;
  amountCents: string | null;
  currency: string | null;
  reference: string;
  counterparty: string;
  externalId: string;
  errors: string[];
  warnings: string[];
  /** Canonical in-memory identity, not a persisted/import id or cryptographic digest. */
  fingerprint: string | null;
  duplicate: boolean;
};
export type BankCsvPreview = {
  rows: BankCsvPreviewRow[];
  errors: string[];
  counts: { total: number; valid: number; invalid: number; incoming: number; outgoing: number; duplicates: number };
  totals: { incomingCents: string; outgoingCents: string; netCents: string };
};
export type BankInvoiceCandidate = {
  id: number;
  invoiceNumber: string;
  customerName: string;
  currency: string;
  /** Only a validated authoritative journal summary may supply this balance. */
  openCents: string;
  canRecordPayment: boolean;
  paymentReviewRequired: boolean;
  existingPayments?: { amountCents: string; paidAt: string | null; reference: string | null; source: string }[];
};
export type BankInvoiceMatch = {
  invoiceId: number;
  invoiceNumber: string;
  confidence: 'strong' | 'medium' | 'review';
  reasons: string[];
  warnings: string[];
  /** A caution about an existing payment, never a proposal to book another one. */
  existingPayment: boolean;
};

export class BankCsvError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'BankCsvError';
  }
}

type CsvRecords = { rows: string[][]; lineNumbers: number[] };
function fail(code: string, message: string): never { throw new BankCsvError(code, message); }

/** Strict RFC-style quoting: no quotes inside bare fields or text after a closing quote. */
function readRecords(text: string, delimiter: BankCsvDelimiter, firstLine: number): CsvRecords {
  const rows: string[][] = [], lineNumbers: number[] = [];
  let row: string[] = [], field = '', quoted = false, closed = false;
  let line = firstLine, rowLine = firstLine, pending = false;
  function append(value: string) {
    field += value;
    if (field.length > MAX_BANK_CSV_FIELD_LENGTH) fail('FIELD_TOO_LONG', 'Ein CSV-Feld darf höchstens 4.000 Zeichen enthalten.');
  }
  function endField() {
    row.push(field);
    if (row.length > MAX_BANK_CSV_COLUMNS) fail('TOO_MANY_COLUMNS', 'Die CSV darf höchstens 64 Spalten enthalten.');
    field = ''; closed = false;
  }
  function endRow() {
    endField(); rows.push(row); lineNumbers.push(rowLine); row = []; pending = false;
    if (rows.length > MAX_BANK_CSV_ROWS + MAX_HEADER_ROW + 1) fail('TOO_MANY_ROWS', 'Die CSV enthält zu viele Zeilen (höchstens 2.000 Buchungen).');
  }
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') { append('"'); index++; }
        else { quoted = false; closed = true; }
      } else if (character === '\r' || character === '\n') {
        append('\n'); line++;
        if (character === '\r' && text[index + 1] === '\n') index++;
      } else append(character);
      continue;
    }
    if (character === delimiter) { endField(); pending = true; continue; }
    if (character === '\r' || character === '\n') {
      endRow(); line++;
      if (character === '\r' && text[index + 1] === '\n') index++;
      rowLine = line; continue;
    }
    if (closed) fail('INVALID_QUOTES', `Ungültiger Text nach einem Anführungszeichen in Zeile ${line}.`);
    if (character === '"') {
      if (field) fail('INVALID_QUOTES', `Anführungszeichen innerhalb eines ungeschützten Felds in Zeile ${line}.`);
      quoted = true; pending = true;
    } else { append(character); pending = true; }
  }
  if (quoted) fail('INVALID_QUOTES', 'Ein CSV-Feld enthält ein nicht geschlossenes Anführungszeichen.');
  if (pending || row.length || field || closed) endRow();
  return { rows, lineNumbers };
}

export function parseBankCsv(text: string, options: { delimiter?: BankCsvDelimiter; headerRow?: number } = {}): BankCsvParsed {
  if (typeof text !== 'string') fail('INVALID_TEXT', 'Bitte eine UTF-8-Textdatei auswählen.');
  // TextDecoder(fatal:true) belongs at the file boundary; reject replacement and lone
  // surrogate characters here too, rather than silently repairing corrupt input.
  if (/\uFFFD|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) fail('INVALID_UTF8', 'Die Datei enthält ungültigen UTF-8-Text.');
  if (new TextEncoder().encode(text).byteLength > MAX_BANK_CSV_BYTES) fail('TOO_LARGE', 'Die CSV darf höchstens 2 MiB groß sein.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) fail('INVALID_TEXT', 'Die CSV enthält unzulässige Steuerzeichen.');
  const headerRow = options.headerRow ?? 0;
  if (!Number.isInteger(headerRow) || headerRow < 0 || headerRow > MAX_HEADER_ROW) fail('INVALID_HEADER', 'Die Kopfzeile muss zwischen Zeile 1 und 51 liegen.');
  if (options.delimiter !== undefined && ![';', ',', '\t'].includes(options.delimiter)) fail('INVALID_DELIMITER', 'Bitte Semikolon, Komma oder Tabulator wählen.');
  text = text.replace(/^\uFEFF/u, '');
  let firstLine = 1, directive: BankCsvDelimiter | undefined;
  const firstLineEnd = text.search(/[\r\n]/u);
  const firstRecord = firstLineEnd < 0 ? text : text.slice(0, firstLineEnd);
  if (/^sep=/iu.test(firstRecord)) {
    if (!/^sep=[;,\t]$/iu.test(firstRecord)) fail('INVALID_DELIMITER', 'Die sep=-Angabe enthält kein unterstütztes Trennzeichen.');
    directive = firstRecord[4] as BankCsvDelimiter;
    text = firstLineEnd < 0 ? '' : text.slice(firstLineEnd).replace(/^(?:\r\n|\r|\n)/u, '');
    firstLine++;
    if (options.delimiter && options.delimiter !== directive) fail('DELIMITER_CONFLICT', 'Das gewählte Trennzeichen widerspricht der sep=-Angabe.');
  }
  let delimiter = options.delimiter ?? directive;
  let records: CsvRecords | undefined;
  if (!delimiter) {
    const candidates: { delimiter: BankCsvDelimiter; records: CsvRecords }[] = [];
    let firstError: unknown;
    for (const candidate of [';', ',', '\t'] as const) {
      try {
        const parsed = readRecords(text, candidate, firstLine);
        if ((parsed.rows[headerRow]?.length ?? 0) > 1) candidates.push({ delimiter: candidate, records: parsed });
      } catch (error) { firstError ??= error; }
    }
    if (candidates.length > 1) fail('AMBIGUOUS_DELIMITER', 'Das Trennzeichen ist nicht eindeutig. Bitte ausdrücklich wählen.');
    if (!candidates.length) {
      if (firstError instanceof BankCsvError && ['TOO_MANY_COLUMNS', 'TOO_MANY_ROWS', 'FIELD_TOO_LONG'].includes(firstError.code)) throw firstError;
      fail('UNKNOWN_DELIMITER', 'CSV oder Trennzeichen nicht eindeutig erkannt. Bitte Trennzeichen und Kopfzeile prüfen.');
    }
    ({ delimiter, records } = candidates[0]);
  }
  records ??= readRecords(text, delimiter, firstLine);
  const headers = records.rows[headerRow];
  if (!headers?.length || headers.every(value => !value.trim())) fail('INVALID_HEADER', 'Die ausgewählte Kopfzeile ist leer oder fehlt.');
  const rows = records.rows.slice(headerRow + 1);
  if (!rows.length) fail('NO_DATA', 'Die CSV enthält nach der Kopfzeile keine Buchungen.');
  if (rows.length > MAX_BANK_CSV_ROWS) fail('TOO_MANY_ROWS', 'Die CSV darf höchstens 2.000 Buchungen enthalten.');
  return { headers: headers.map(value => value.trim()), rows, delimiter, skippedLines: headerRow, rowNumbers: records.lineNumbers.slice(headerRow + 1) };
}

function normalized(value: string): string { return value.normalize('NFKC').trim().replace(/\s+/gu, ' '); }
function headerKey(value: string): string { return normalized(value).toLocaleLowerCase('de-DE').replace(/[\s_./-]+/gu, ''); }

/** Only exact, unique aliases are inferred. Unknown and ambiguous columns stay unmapped. */
export function inferBankCsvMapping(headers: string[]): BankCsvMapping {
  const keys = headers.map(headerKey);
  function column(aliases: string[]): number | null {
    const found = keys.flatMap((key, index) => aliases.includes(key) ? [index] : []);
    return found.length === 1 ? found[0] : null;
  }
  const amount = column(['betrag', 'umsatz', 'umsatzbetrag', 'amount', 'transactionamount']);
  const credit = column(['haben', 'gutschrift', 'gutschriften', 'credit', 'creditamount']);
  const debit = column(['soll', 'belastung', 'belastungen', 'debit', 'debitamount']);
  return {
    headerRow: 0,
    date: column(['datum', 'buchungstag', 'buchungsdatum', 'date', 'bookingdate', 'transactiondate']),
    amount, credit, debit,
    currency: column(['währung', 'waehrung', 'whrg', 'currency', 'currencycode']),
    counterparty: column(['auftraggeberbegünstigter', 'auftraggeber/begünstigter', 'auftraggeber', 'begünstigter', 'beguenstigter', 'zahlungspartner', 'gegenpartei', 'counterparty', 'name', 'empfänger', 'empfaenger']),
    reference: column(['verwendungszweck', 'buchungstext', 'referenz', 'reference', 'paymentreference', 'remittanceinformation']),
    externalId: column(['buchungsid', 'umsatzid', 'transaktionsid', 'transactionid', 'externalid', 'bankreference']),
    decimalSeparator: ',', accountAlias: '', amountMode: amount !== null || credit === null || debit === null ? 'signed' : 'credit-debit',
  };
}

function isFormula(value: string): boolean { return /^[=+@-]/u.test(value.trimStart()); }
function parseDate(value: string): string | null {
  let iso: string;
  if (/^\d{2}\.\d{2}\.\d{4}$/u.test(value)) iso = `${value.slice(6)}-${value.slice(3, 5)}-${value.slice(0, 2)}`;
  else if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) iso = value;
  else return null;
  if (iso.startsWith('0000-')) return null;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

function parseAmount(value: string, decimal: ',' | '.'): bigint | null {
  const separator = decimal === ',' ? ',' : '\\.';
  const grouping = decimal === ',' ? '\\.' : ',';
  if (!new RegExp(`^[+-]?(?:\\d+|\\d{1,3}(?:${grouping}\\d{3})+)(?:${separator}\\d{1,2})?$`, 'u').test(value)) return null;
  const negative = value.startsWith('-');
  const unsigned = value.replace(/^[+-]/u, '');
  const [whole, fraction = ''] = unsigned.split(decimal);
  const digits = whole.replace(decimal === ',' ? /\./gu : /,/gu, '').replace(/^0+(?=\d)/u, '');
  if (digits.length > 14) return null;
  const result = BigInt(digits) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return negative ? -result : result;
}

function mappingErrors(parsed: BankCsvParsed, mapping: BankCsvMapping): string[] {
  const errors: string[] = [];
  if (mapping.headerRow !== parsed.skippedLines) errors.push('Die Kopfzeile wurde geändert. Bitte die Datei mit dieser Kopfzeile neu einlesen.');
  if (!normalized(mapping.accountAlias) || normalized(mapping.accountAlias).length > 80 || /[\u0000-\u001f\u007f]/u.test(mapping.accountAlias) || isFormula(mapping.accountAlias)) errors.push('Bitte einen Kontonamen mit 1 bis 80 Zeichen ohne Formel- oder Steuerzeichen angeben.');
  if (mapping.decimalSeparator !== ',' && mapping.decimalSeparator !== '.') errors.push('Bitte das Dezimaltrennzeichen ausdrücklich wählen.');
  if (mapping.amountMode !== 'signed' && mapping.amountMode !== 'credit-debit') errors.push('Bitte eine gültige Betragsart wählen.');
  const active: (keyof BankCsvMapping)[] = ['date', 'currency', 'counterparty', 'reference', 'externalId', ...(mapping.amountMode === 'signed' ? ['amount'] as const : ['credit', 'debit'] as const)];
  const selected: number[] = [];
  for (const key of active) {
    const value = mapping[key];
    if (value === null) continue;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= parsed.headers.length) errors.push(`Ungültige Spaltenzuordnung: ${key}.`);
    else selected.push(value);
  }
  if (new Set(selected).size !== selected.length) errors.push('Eine Spalte darf nicht mehreren Feldern zugeordnet werden.');
  if (mapping.date === null) errors.push('Bitte die Datumsspalte zuordnen.');
  if (mapping.amountMode === 'signed' && mapping.amount === null) errors.push('Bitte die Betragsspalte zuordnen.');
  if (mapping.amountMode === 'credit-debit' && (mapping.credit === null || mapping.debit === null)) errors.push('Bitte Haben- und Sollspalte getrennt zuordnen.');
  if (mapping.currency === null && mapping.defaultCurrency !== 'EUR') errors.push('Bitte die Währungsspalte zuordnen oder EUR ausdrücklich bestätigen.');
  if (parsed.headers.some(isFormula)) errors.push('Die Kopfzeile enthält ein Formel-Feld.');
  return errors;
}

export function buildBankCsvPreview(parsed: BankCsvParsed, mapping: BankCsvMapping): BankCsvPreview {
  const errors = mappingErrors(parsed, mapping);
  const amountColumns = new Set(mapping.amountMode === 'signed' ? [mapping.amount] : [mapping.credit, mapping.debit]);
  const rows: BankCsvPreviewRow[] = parsed.rows.map((fields, index) => {
    const rowErrors: string[] = [], warnings: string[] = [];
    const field = (column: number | null) => typeof column === 'number' ? (fields[column] ?? '').trim() : '';
    if (errors.length) rowErrors.push('Die Spaltenzuordnung ist noch nicht gültig.');
    if (fields.length !== parsed.headers.length) rowErrors.push('Die Anzahl der Felder stimmt nicht mit der Kopfzeile überein.');
    fields.forEach((value, column) => {
      if (amountColumns.has(column)) {
        if (/^[=@]/u.test(value.trimStart())) rowErrors.push('Das Betragsfeld enthält eine unzulässige Formel.');
      } else if (isFormula(value)) rowErrors.push(`Spalte ${column + 1} enthält eine unzulässige Formel.`);
    });
    const date = parseDate(field(mapping.date));
    if (!date) rowErrors.push('Ungültiges Datum: TT.MM.JJJJ oder JJJJ-MM-TT erforderlich.');
    let amount: bigint | null = null;
    if (mapping.amountMode === 'signed') {
      amount = parseAmount(field(mapping.amount), mapping.decimalSeparator);
      if (amount === null) rowErrors.push('Ungültiger Betrag: Dezimaltrennzeichen und centgenaue Schreibweise prüfen.');
    } else {
      const credit = field(mapping.credit), debit = field(mapping.debit);
      if (!!credit === !!debit) rowErrors.push('Genau eines der Felder Haben oder Soll muss gefüllt sein; auch 0 zählt als befüllt.');
      else {
        const value = parseAmount(credit || debit, mapping.decimalSeparator);
        if (value === null || /^[+-]/u.test(credit || debit)) rowErrors.push('Haben/Soll muss einen vorzeichenlosen, centgenauen Betrag enthalten.');
        else amount = credit ? value : -value;
      }
    }
    if (amount === BigInt(0)) rowErrors.push('Buchungen mit Betrag 0 werden nicht berücksichtigt.');
    const currencyText = mapping.currency === null ? mapping.defaultCurrency ?? '' : field(mapping.currency).toUpperCase();
    const currency = currencyText === '€' ? 'EUR' : currencyText || null;
    if (currency !== 'EUR') rowErrors.push('Nur eindeutig zugeordnete EUR-Buchungen sind unterstützt; keine Währungsumrechnung.');
    const reference = normalized(field(mapping.reference));
    const counterparty = normalized(field(mapping.counterparty));
    const externalId = normalized(field(mapping.externalId));
    if (!reference) warnings.push('Verwendungszweck fehlt: keine Rechnungsvorschläge möglich.');
    if (!counterparty) warnings.push('Zahlungspartner fehlt: kein Kunden-/Betragsabgleich möglich.');
    if (reference.length > 2000 || counterparty.length > 255 || externalId.length > 255) rowErrors.push('Verwendungszweck, Zahlungspartner oder externe ID ist zu lang.');
    return {
      rowNumber: parsed.rowNumbers[index], date, amountCents: amount === null ? null : amount.toString(), currency,
      reference, counterparty, externalId, errors: [...new Set(rowErrors)], warnings, duplicate: false,
      fingerprint: rowErrors.length || !date || amount === null || currency !== 'EUR' ? null : JSON.stringify(['bank-csv-v1', normalized(mapping.accountAlias), date, amount.toString(), currency, counterparty, reference, externalId]),
    };
  });
  function mark(groups: Map<string, BankCsvPreviewRow[]>, message: string) {
    for (const group of groups.values()) if (group.length > 1) for (const row of group) { row.duplicate = true; row.warnings.push(message); }
  }
  const fingerprints = new Map<string, BankCsvPreviewRow[]>(), externalIds = new Map<string, BankCsvPreviewRow[]>(), sameDayAmounts = new Map<string, BankCsvPreviewRow[]>();
  for (const row of rows) {
    function add(groups: Map<string, BankCsvPreviewRow[]>, key: string) { groups.set(key, [...(groups.get(key) ?? []), row]); }
    if (row.fingerprint) add(fingerprints, row.fingerprint);
    if (row.externalId) add(externalIds, row.externalId);
    if (row.date && row.amountCents !== null && row.currency) add(sameDayAmounts, JSON.stringify([row.date, row.amountCents, row.currency]));
  }
  mark(fingerprints, 'Identische Buchungsdaten kommen mehrfach vor. Keine Zeile wurde entfernt; bitte Originalbelege prüfen.');
  mark(externalIds, 'Die externe Buchungs-ID kommt mehrfach vor. Bitte mögliche Doppelbuchung oder widersprüchliche Daten prüfen.');
  mark(sameDayAmounts, 'Mehrere Buchungen haben denselben Tag und Betrag. Es können eigenständige Buchungen sein; keine automatische Zuordnung.');
  let incoming = BigInt(0), outgoing = BigInt(0), incomingCount = 0, outgoingCount = 0;
  for (const row of rows) if (!row.errors.length && row.amountCents !== null) {
    const amount = BigInt(row.amountCents);
    if (amount > BigInt(0)) { incoming += amount; incomingCount++; }
    if (amount < BigInt(0)) { outgoing -= amount; outgoingCount++; }
  }
  const valid = rows.filter(row => !row.errors.length).length;
  return {
    rows, errors,
    counts: { total: rows.length, valid, invalid: rows.length - valid, incoming: incomingCount, outgoing: outgoingCount, duplicates: rows.filter(row => row.duplicate).length },
    totals: { incomingCents: incoming.toString(), outgoingCents: outgoing.toString(), netCents: (incoming - outgoing).toString() },
  };
}

function checkedCents(value: string): bigint | null {
  if (!/^(?:0|[1-9]\d{0,15})$/u.test(value)) return null;
  const cents = BigInt(value);
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? cents : null;
}
function nameKey(value: string): string { return normalized(value).toLocaleLowerCase('de-DE').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function hasInvoiceToken(reference: string, invoiceNumber: string): boolean {
  const number = normalized(invoiceNumber).toLocaleLowerCase('de-DE');
  if (!number) return false;
  const escaped = number.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_/-])${escaped}(?=$|[^\\p{L}\\p{N}_/-])`, 'u').test(normalized(reference).toLocaleLowerCase('de-DE'));
}

/** Suggestions are evidence labels only. This module cannot authorize or record payments. */
export function suggestBankInvoiceMatches(row: BankCsvPreviewRow, invoices: BankInvoiceCandidate[]): BankInvoiceMatch[] {
  if (row.errors.length || row.currency !== 'EUR' || !normalized(row.reference) || row.date === null || parseDate(row.date) !== row.date) return [];
  const amount = row.amountCents === null ? null : checkedCents(row.amountCents);
  if (amount === null || amount <= BigInt(0)) return [];
  const exact: BankInvoiceMatch[] = [], customer: BankInvoiceMatch[] = [], existing: BankInvoiceMatch[] = [];
  for (const invoice of invoices) {
    if (!Number.isSafeInteger(invoice.id) || invoice.id <= 0 || invoice.currency !== 'EUR' || invoice.paymentReviewRequired !== false) continue;
    const open = checkedCents(invoice.openCents);
    if (open === null) continue;
    const exactReference = hasInvoiceToken(row.reference, invoice.invoiceNumber);
    const customerName = nameKey(invoice.customerName);
    const sameCustomer = customerName.length >= 3 && customerName === nameKey(row.counterparty);
    if (!exactReference && !sameCustomer) continue;
    const manual = invoice.existingPayments?.some(event => {
      if (event.source !== 'MANUAL' || checkedCents(event.amountCents) !== amount) return false;
      const sameDate = event.paidAt !== null && row.date !== null && event.paidAt.slice(0, 10) === row.date && parseDate(event.paidAt.slice(0, 10)) !== null;
      const sameReference = !!event.reference?.trim() && normalized(event.reference).toLocaleLowerCase('de-DE') === row.reference.toLocaleLowerCase('de-DE');
      return sameDate || sameReference;
    }) ?? false;
    if (manual) {
      existing.push({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, confidence: 'review', existingPayment: true,
        reasons: ['Ein vorhandener manueller Zahlungsnachweis passt zu Betrag und Datum oder Referenz.'],
        warnings: ['Möglicherweise bereits erfasst. Vorhandenen Zahlungsnachweis prüfen; nicht nochmals als neue Zahlung buchen.'] });
      continue;
    }
    if (invoice.canRecordPayment !== true || open < amount || open === BigInt(0)) continue;
    if (!exactReference && (!sameCustomer || amount !== open)) continue;
    const match: BankInvoiceMatch = {
      invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, confidence: exactReference ? 'strong' : 'medium', existingPayment: false,
      reasons: exactReference ? ['Die Rechnungsnummer ist als vollständiges Kennzeichen im Verwendungszweck enthalten.'] : ['Zahlungspartner und offener Restbetrag stimmen überein; Rechnungsreferenz nicht bestätigt.'],
      warnings: [],
    };
    if (exactReference && amount < open) match.reasons.push('Der Betrag liegt unter dem offenen Restbetrag (mögliche Teilzahlung).');
    (exactReference ? exact : customer).push(match);
  }
  const matches = [...existing, ...(exact.length ? exact : customer)];
  const ambiguous = new Set(matches.map(match => match.invoiceId)).size > 1;
  for (const match of matches) {
    if (row.duplicate || ambiguous) {
      match.confidence = 'review';
      if (row.duplicate) match.warnings.push('Mehrfach vorkommende oder gleichartige CSV-Buchung: Zuordnung nur nach Belegprüfung.');
      if (ambiguous) match.warnings.push('Mehrere Rechnungen passen; keine eindeutige Zuordnung.');
    }
  }
  return matches;
}

/** Also surfaces existing-payment cautions for closed invoices, without new-booking proposals. */
export function bankCsvExistingPaymentWarnings(row: BankCsvPreviewRow, invoices: BankInvoiceCandidate[]): string[] {
  return [...new Set(suggestBankInvoiceMatches(row, invoices).filter(match => match.existingPayment).flatMap(match => match.warnings))];
}
