import { describe, expect, it } from 'vitest';
import {
  BankCsvError, MAX_BANK_CSV_BYTES, bankCsvExistingPaymentWarnings,
  buildBankCsvPreview, inferBankCsvMapping, parseBankCsv, suggestBankInvoiceMatches,
  type BankCsvMapping, type BankCsvPreviewRow, type BankInvoiceCandidate,
} from '@/lib/bank-csv';

const header = 'Datum;Betrag;Währung;Zahlungspartner;Verwendungszweck;Transaktions-ID';
function preview(body = '21.10.2026;100,00;EUR;Muster GmbH;RE-2026-001;bank-1', changes: Partial<BankCsvMapping> = {}) {
  const parsed = parseBankCsv(`${header}\n${body}`);
  const mapping = { ...inferBankCsvMapping(parsed.headers), accountAlias: 'Geschäftskonto', ...changes };
  return buildBankCsvPreview(parsed, mapping);
}
function invoice(changes: Partial<BankInvoiceCandidate> = {}): BankInvoiceCandidate {
  return { id: 1, invoiceNumber: 'RE-2026-001', customerName: 'Muster GmbH', currency: 'EUR', openCents: '10000', canRecordPayment: true, paymentReviewRequired: false, ...changes };
}
function row(changes: Partial<BankCsvPreviewRow> = {}): BankCsvPreviewRow { return { ...preview().rows[0], ...changes }; }
function errorCode(callback: () => unknown): string {
  try { callback(); } catch (error) { expect(error).toBeInstanceOf(BankCsvError); return (error as BankCsvError).code; }
  throw new Error('Expected a CSV error');
}

describe('strict, bounded bank CSV parsing', () => {
  it.each([';', ',', '\t'] as const)('detects %j with BOM, CRLF and a trailing newline', delimiter => {
    const parsed = parseBankCsv(`\uFEFFDatum${delimiter}Betrag\r\n2026-10-21${delimiter}100.00\r\n`);
    expect(parsed).toEqual({ headers: ['Datum', 'Betrag'], rows: [['2026-10-21', '100.00']], delimiter, skippedLines: 0, rowNumbers: [2] });
  });
  it('supports quoted delimiters, escaped quotes and multiline fields with physical line numbers', () => {
    const parsed = parseBankCsv('Datum;Betrag;Text\n2026-10-21;1;"Hallo; \"\"Welt\"\"\r\nZeile 2"\n2026-10-22;2;weiter');
    expect(parsed.rows).toEqual([['2026-10-21', '1', 'Hallo; "Welt"\nZeile 2'], ['2026-10-22', '2', 'weiter']]);
    expect(parsed.rowNumbers).toEqual([2, 4]);
  });
  it('supports an explicit separator directive and a selected preamble/header record', () => {
    const parsed = parseBankCsv('sep=;\nExport;;\nDatum;Betrag;Währung\n2026-10-21;1;EUR', { headerRow: 1 });
    expect(parsed.headers).toEqual(['Datum', 'Betrag', 'Währung']);
    expect(parsed.skippedLines).toBe(1);
    expect(parsed.rowNumbers).toEqual([4]);
  });
  it('does not guess when a header contains several plausible separators', () => {
    const text = 'Datum;Betrag,Währung\n2026-10-21;100,EUR';
    expect(errorCode(() => parseBankCsv(text))).toBe('AMBIGUOUS_DELIMITER');
    expect(parseBankCsv(text, { delimiter: ';' }).headers).toEqual(['Datum', 'Betrag,Währung']);
  });
  it.each(['a;b\n"not closed;b', 'a;b\na"bad;b', 'a;b\n"closed"text;b', 'a;b\n "quoted";b'])('rejects malformed quotes: %j', text => {
    expect(errorCode(() => parseBankCsv(text, { delimiter: ';' }))).toBe('INVALID_QUOTES');
  });
  it.each(['sep=|\na;b\n1;2', 'sep=; extra\na;b\n1;2'])('rejects unsupported or malformed separator directives', text => {
    expect(errorCode(() => parseBankCsv(text))).toBe('INVALID_DELIMITER');
  });
  it('rejects a directive/explicit separator conflict', () => {
    expect(errorCode(() => parseBankCsv('sep=;\na;b\n1;2', { delimiter: ',' }))).toBe('DELIMITER_CONFLICT');
  });
  it('rejects empty data and invalid header controls', () => {
    expect(errorCode(() => parseBankCsv('Datum;Betrag'))).toBe('NO_DATA');
    expect(errorCode(() => parseBankCsv('Datum;Betrag\n1;2', { headerRow: 51 }))).toBe('INVALID_HEADER');
    expect(errorCode(() => parseBankCsv('Datum;Betrag\n1;2', { headerRow: -1 }))).toBe('INVALID_HEADER');
  });
  it('bounds actual UTF-8 bytes rather than UTF-16 string length', () => {
    expect(errorCode(() => parseBankCsv(`A;B\n${'ä'.repeat(MAX_BANK_CSV_BYTES / 2)};1`, { delimiter: ';' }))).toBe('TOO_LARGE');
  });
  it.each(['A;B\n1;\u0000', 'A;B\n1;\u007f'])('rejects control bytes', text => {
    expect(errorCode(() => parseBankCsv(text))).toBe('INVALID_TEXT');
  });
  it.each(['A;B\n1;\uFFFD', 'A;B\n1;\uD800', 'A;B\n1;\uDC00'])('does not silently replace invalid text', text => {
    expect(errorCode(() => parseBankCsv(text))).toBe('INVALID_UTF8');
  });
  it('preserves valid non-BMP Unicode text without mistaking surrogate pairs for corruption', () => {
    expect(parseBankCsv('A;B\n1;💶').rows[0][1]).toBe('💶');
  });
  it('bounds every quoted or unmapped CSV cell before rendering or value parsing', () => {
    expect(parseBankCsv(`A;B\n1;${'x'.repeat(4000)}`, { delimiter: ';' }).rows[0][1]).toHaveLength(4000);
    for (const value of ['x'.repeat(4001), `"${'x'.repeat(4001)}"`]) {
      expect(errorCode(() => parseBankCsv(`A;B\n1;${value}`, { delimiter: ';' }))).toBe('FIELD_TOO_LONG');
    }
  });
  it('accepts exactly 2,000 data rows, rejects 2,001 and 64/65 columns', () => {
    expect(parseBankCsv(`A;B\n${Array.from({ length: 2000 }, () => '1;2').join('\n')}`).rows).toHaveLength(2000);
    expect(errorCode(() => parseBankCsv(`A;B\n${Array.from({ length: 2001 }, () => '1;2').join('\n')}`))).toBe('TOO_MANY_ROWS');
    expect(parseBankCsv(`${Array(64).fill('A').join(';')}\n${Array(64).fill('1').join(';')}`).headers).toHaveLength(64);
    expect(errorCode(() => parseBankCsv(`${Array(65).fill('A').join(';')}\n${Array(65).fill('1').join(';')}`, { delimiter: ';' }))).toBe('TOO_MANY_COLUMNS');
  });
});

describe('explicit mapping and strict preview values', () => {
  it('infers only unique known headers, never a currency or account confirmation', () => {
    const mapping = inferBankCsvMapping(['Buchungstag', 'Betrag', 'Währung', 'Verwendungszweck']);
    expect(mapping).toMatchObject({ date: 0, amount: 1, currency: 2, reference: 3, counterparty: null, accountAlias: '' });
    expect(mapping.defaultCurrency).toBeUndefined();
    expect(inferBankCsvMapping(['Datum', 'Buchungstag', 'Betrag']).date).toBeNull();
    expect(inferBankCsvMapping(['Datum', 'Haben', 'Soll']).amountMode).toBe('credit-debit');
    expect(inferBankCsvMapping(['Gegenpartei', 'Umsatz-ID'])).toMatchObject({ counterparty: 0, externalId: 1 });
  });
  it('builds canonical ISO dates, integer cents and a stable account-bound fingerprint', () => {
    const first = preview().rows[0];
    expect(first).toMatchObject({ date: '2026-10-21', amountCents: '10000', currency: 'EUR', errors: [], duplicate: false });
    expect(preview().rows[0].fingerprint).toBe(first.fingerprint);
    expect(preview(undefined, { accountAlias: 'Anderes Konto' }).rows[0].fingerprint).not.toBe(first.fingerprint);
    expect(preview('2026-10-21;100,0;EUR;Muster GmbH;RE-2026-001;bank-1').rows[0].fingerprint).toBe(first.fingerprint);
  });
  it.each(['31.02.2026', '29.02.2025', '2026-02-30', '21.10.26', '1.10.2026', '2026-1-01', '10/21/2026', '2026-10-21T00:00:00Z', '0000-01-01'])('rejects invalid or noncanonical date %s', date => {
    expect(preview(`${date};100,00;EUR;Muster GmbH;RE-2026-001;bank-1`).rows[0].errors.join(' ')).toContain('Datum');
  });
  it('accepts a genuine leap day by round-trip validation', () => {
    expect(preview('29.02.2024;100,00;EUR;Muster GmbH;RE-2026-001;bank-1').rows[0].date).toBe('2024-02-29');
  });
  it.each([['1.234,56', ',', '123456'], ['-1.234,56', ',', '-123456'], ['+12,5', ',', '1250'], ['1,234.56', '.', '123456'], ['-0.01', '.', '-1'], ['90071992547409.91', '.', '9007199254740991']] as const)('parses exact mapped amount %s', (amount, decimal, cents) => {
    const result = preview(`21.10.2026;${amount};EUR;Muster GmbH;RE-2026-001;bank-1`, { decimalSeparator: decimal }).rows[0];
    expect(result.errors).toEqual([]);
    expect(result.amountCents).toBe(cents);
  });
  it.each(['1,234', '1.23,45', '1,001', '--1,00', '+-1,00', '1e2', '(1,00)', '1,00-', '10 EUR', 'NaN', '90071992547409,92'])('rejects imprecise/contradictory/out-of-range amount %s', amount => {
    expect(preview(`21.10.2026;${amount};EUR;Muster GmbH;RE-2026-001;bank-1`).rows[0].errors.join(' ')).toContain('Betrag');
  });
  it('never infers EUR from a blank/unknown/foreign mapped currency or uses a fallback', () => {
    for (const currency of ['', 'USD', 'EURO', 'unknown']) {
      const result = preview(`21.10.2026;100,00;${currency};Muster GmbH;RE-2026-001;bank-1`, { defaultCurrency: 'EUR' });
      expect(result.counts.valid).toBe(0);
      expect(suggestBankInvoiceMatches(result.rows[0], [invoice()])).toEqual([]);
    }
    expect(preview(undefined, { currency: null }).errors.join(' ')).toContain('Währung');
    expect(preview(undefined, { currency: null, defaultCurrency: 'EUR' }).counts.valid).toBe(1);
  });
  it('requires account alias, consistent header selection and one column per role', () => {
    for (const accountAlias of ['', ' '.repeat(3), 'x'.repeat(81), '=konto', 'ok\nwrong']) expect(preview(undefined, { accountAlias }).errors.length).toBeGreaterThan(0);
    expect(preview(undefined, { headerRow: 1 }).errors.join(' ')).toContain('Kopfzeile');
    expect(preview(undefined, { reference: 1 }).errors.join(' ')).toContain('mehreren');
    expect(preview(undefined, { date: 99 }).errors.join(' ')).toContain('Spaltenzuordnung');
  });
  it.each(['=HYPERLINK("evil")', '+cmd', '@SUM(1)', '-cmd', '  =1+1'])('rejects formula content outside mapped amounts: %s', reference => {
    const safeCsv = reference.replace(/"/gu, '""');
    const result = preview(`21.10.2026;100,00;EUR;Muster GmbH;"${safeCsv}";bank-1`).rows[0];
    expect(result.errors.join(' ')).toContain('Formel');
    expect(result.fingerprint).toBeNull();
  });
  it('also checks unmapped fields, but allows legitimate signed amounts only in active amount fields', () => {
    const result = preview('21.10.2026;-10,00;EUR;+cmd;RE-2026-001;bank-1', { counterparty: null }).rows[0];
    expect(result.amountCents).toBe('-1000');
    expect(result.errors.join(' ')).toContain('Formel');
  });
  it('marks missing reference and customer visibly without guessing suggestions', () => {
    const result = preview('21.10.2026;100,00;EUR;;;bank-1').rows[0];
    expect(result.errors).toEqual([]);
    expect(result.warnings.join(' ')).toContain('Verwendungszweck fehlt');
    expect(result.warnings.join(' ')).toContain('Zahlungspartner fehlt');
    expect(suggestBankInvoiceMatches(result, [invoice()])).toEqual([]);
  });
  it('reports malformed row widths in preview rather than dropping a row', () => {
    const result = preview('21.10.2026;100,00;EUR;Muster GmbH;RE-2026-001');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].errors.join(' ')).toContain('Anzahl');
    expect(result.counts.invalid).toBe(1);
    expect(result.totals.incomingCents).toBe('0');
  });
  it('uses separate credit/debit fields with no ambiguous signs or filled zero counterpart', () => {
    const parsed = parseBankCsv('Datum;Haben;Soll;Währung;Verwendungszweck\n21.10.2026;100,00;;EUR;RE1\n21.10.2026;;25,01;EUR;RE2\n21.10.2026;1;0;EUR;RE3\n21.10.2026;-1;;EUR;RE4\n21.10.2026;;+1;EUR;RE5\n21.10.2026;;;EUR;RE6');
    const result = buildBankCsvPreview(parsed, { ...inferBankCsvMapping(parsed.headers), accountAlias: 'Konto' });
    expect(result.rows.map(item => item.amountCents)).toEqual(['10000', '-2501', null, null, null, null]);
    expect(result.counts).toMatchObject({ valid: 2, invalid: 4, incoming: 1, outgoing: 1 });
    expect(result.totals).toEqual({ incomingCents: '10000', outgoingCents: '2501', netCents: '7499' });
  });
  it('keeps exact duplicates and conflicting reused external IDs visible', () => {
    const result = preview('21.10.2026;100,00;EUR;Muster GmbH;RE-2026-001;bank-1\n21.10.2026;100,00;EUR;Muster GmbH;RE-2026-001;bank-1\n22.10.2026;80,00;EUR;Anderer Kunde;Andere Referenz;bank-1');
    expect(result.rows).toHaveLength(3);
    expect(result.counts.duplicates).toBe(3);
    expect(result.rows[0].warnings.join(' ')).toContain('Identische');
    expect(result.rows[2].warnings.join(' ')).toContain('externe Buchungs-ID');
    expect(result.totals.incomingCents).toBe('28000');
  });
  it('does not discard legitimate same-day/amount rows with different references', () => {
    const result = preview('21.10.2026;100,00;EUR;Muster GmbH;RE-2026-001;bank-1\n21.10.2026;100,00;EUR;Anderer Kunde;RE-2026-002;bank-2');
    expect(result.counts.valid).toBe(2);
    expect(result.rows[0].fingerprint).not.toBe(result.rows[1].fingerprint);
    expect(result.rows.every(item => item.duplicate)).toBe(true);
    expect(suggestBankInvoiceMatches(result.rows[0], [invoice()])[0].confidence).toBe('review');
  });
});

describe('read-only authoritative invoice matching', () => {
  it('strongly matches exact invoice tokens, including partial payments, without modifying inputs', () => {
    const bankRow = row({ reference: 'Zahlung (RE-2026-001), danke' });
    const candidate = invoice({ openCents: '15000' });
    const before = JSON.stringify([bankRow, candidate]);
    expect(suggestBankInvoiceMatches(bankRow, [candidate])).toMatchObject([{ invoiceId: 1, confidence: 'strong', existingPayment: false }]);
    expect(JSON.stringify([bankRow, candidate])).toBe(before);
  });
  it.each(['RE-2026-0010', 'XRE-2026-001', 'RE-2026-001-X', 'RE-2026-001/2', 'RE-2026-001_suffix'])('does not match invoice substring %s', reference => {
    expect(suggestBankInvoiceMatches(row({ reference, counterparty: 'Unbekannt' }), [invoice()])).toEqual([]);
  });
  it('uses customer+exact open amount only as medium evidence and never amount alone', () => {
    expect(suggestBankInvoiceMatches(row({ reference: 'Danke für die Zusammenarbeit' }), [invoice()])[0].confidence).toBe('medium');
    expect(suggestBankInvoiceMatches(row({ reference: 'Danke', counterparty: 'Unbekannt' }), [invoice()])).toEqual([]);
    expect(suggestBankInvoiceMatches(row({ reference: 'Danke' }), [invoice({ openCents: '15000' })])).toEqual([]);
  });
  it.each([
    { currency: 'USD' }, { canRecordPayment: false }, { paymentReviewRequired: true }, { openCents: '9999' },
    { openCents: '0' }, { openCents: '-1' }, { openCents: '1.00' }, { openCents: '9007199254740992' },
  ])('does not propose ineligible/overpaid/unvalidated invoices: %j', changes => {
    expect(suggestBankInvoiceMatches(row(), [invoice(changes)])).toEqual([]);
  });
  it.each([{ amountCents: '-10000' }, { amountCents: '0' }, { currency: 'USD' }, { errors: ['Invalid'] }, { reference: '' }, { reference: '   ' }, { date: null }, { date: '2026-02-30' }])('does not suggest unsupported bank rows: %j', changes => {
    expect(suggestBankInvoiceMatches(row(changes), [invoice()])).toEqual([]);
  });
  it('reduces multiple exact invoice references or customer matches to review', () => {
    const invoices = [invoice(), invoice({ id: 2, invoiceNumber: 'RE-2026-002' })];
    const matches = suggestBankInvoiceMatches(row({ reference: 'RE-2026-001 und RE-2026-002' }), invoices);
    expect(matches).toHaveLength(2);
    expect(matches.every(match => match.confidence === 'review' && match.warnings.join(' ').includes('Mehrere Rechnungen'))).toBe(true);
    expect(suggestBankInvoiceMatches(row({ reference: 'Danke' }), invoices).every(match => match.confidence === 'review')).toBe(true);
  });
  it('surfaces an existing manual payment as caution even when fully paid/closed', () => {
    const candidate = invoice({ openCents: '0', canRecordPayment: false, existingPayments: [{ amountCents: '10000', paidAt: '2026-10-21T00:00:00.000Z', reference: 'Manuell erfasst', source: 'MANUAL' }] });
    const matches = suggestBankInvoiceMatches(row(), [candidate]);
    expect(matches).toMatchObject([{ confidence: 'review', existingPayment: true }]);
    expect(bankCsvExistingPaymentWarnings(row(), [candidate]).join(' ')).toContain('nicht nochmals');
  });
  it('also detects an exact existing payment reference on a different date', () => {
    const candidate = invoice({ existingPayments: [{ amountCents: '10000', paidAt: '2026-10-20T00:00:00.000Z', reference: 'RE-2026-001', source: 'MANUAL' }] });
    expect(suggestBankInvoiceMatches(row(), [candidate])[0].existingPayment).toBe(true);
  });
  it('does not label unrelated equal-amount/date manual events or unequal manual amounts as duplicate evidence', () => {
    const candidate = invoice({ invoiceNumber: 'UNRELATED', customerName: 'Anderer Kunde', existingPayments: [{ amountCents: '10000', paidAt: '2026-10-21T00:00:00.000Z', reference: 'Andere Referenz', source: 'MANUAL' }] });
    expect(suggestBankInvoiceMatches(row(), [candidate])).toEqual([]);
    expect(suggestBankInvoiceMatches(row(), [invoice({ existingPayments: [{ amountCents: '5000', paidAt: '2026-10-21T00:00:00.000Z', reference: 'RE-2026-001', source: 'MANUAL' }] })])[0].existingPayment).toBe(false);
  });
});
