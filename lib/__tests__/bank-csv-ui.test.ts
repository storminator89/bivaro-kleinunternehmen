import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BankCsvPreviewRowCard, BankCsvWorkspace } from '@/components/bank-csv/bank-csv-workspace';
import { buildBankCsvPreview, inferBankCsvMapping, parseBankCsv, type BankCsvPreviewRow, type BankInvoiceCandidate } from '@/lib/bank-csv';
import type { BankCandidateResult } from '@/lib/bank-csv-candidates';

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'synthetic-tenant' } } }) }));
function row(changes: Partial<BankCsvPreviewRow> = {}): BankCsvPreviewRow {
  const csv = parseBankCsv('Datum;Betrag;Währung;Gegenpartei;Verwendungszweck\n21.10.2026;40,00;EUR;Werkstatt;RE-120');
  return { ...buildBankCsvPreview(csv, { ...inferBankCsvMapping(csv.headers), accountAlias: 'Testkonto' }).rows[0], ...changes };
}
function candidate(changes: Partial<BankInvoiceCandidate> = {}): BankInvoiceCandidate { return { id: 7, invoiceNumber: 'RE-120', customerName: 'Werkstatt', currency: 'EUR', openCents: '8000', canRecordPayment: true, paymentReviewRequired: false, ...changes }; }
function result(invoices: BankInvoiceCandidate[] = [candidate()]): BankCandidateResult { return { invoices, reviewInvoices: [], checked: invoices.length, unavailable: 0, truncated: false }; }
function render(bankRow = row(), candidates: BankCandidateResult | null = result()) { return renderToStaticMarkup(createElement(BankCsvPreviewRowCard, { row: bankRow, candidates })); }

describe('bank preview UI safety and clear hierarchy', () => {
  it('starts with an explicitly local, read-only three-step file flow and labelled native input', () => {
    const html = renderToStaticMarkup(createElement(BankCsvWorkspace));
    expect(html).toContain('Bank-CSV prüfen'); expect(html).toContain('aria-label="Bank-CSV Schritte"');
    expect(html).toContain('Nur Vorschau · keine Buchung'); expect(html).toContain('Kein Bankzugang, kein Upload.');
    expect(html).toContain('for="bank-file"'); expect(html).toContain('type="file"');
    expect(html).not.toContain('Zahlung verbindlich erfassen'); expect(html).not.toContain('<main');
  });
  it('shows exact cents, actual date, reasons, checked journal remainder and a read-only invoice link', () => {
    const html = render();
    expect(html).toContain('40,00 €'); expect(html).toContain('21.10.2026'); expect(html).toContain('Starkes Signal');
    expect(html).toContain('vollständiges Kennzeichen'); expect(html).toContain('mögliche Teilzahlung');
    expect(html).toContain('Geprüfter Rechnungsrest: 80,00 €'); expect(html).toContain('/history?invoiceId=7');
    expect(html).toContain('Nur Vorschlag · keine Zahlung erfasst'); expect(html).not.toContain('<button');
  });
  it('labels existing manual evidence as caution, not a new payment proposal or debtor balance', () => {
    const html = render(row(), result([candidate({ openCents: '0', canRecordPayment: false, existingPayments: [{ amountCents: '4000', paidAt: '2026-10-21T00:00:00.000Z', reference: 'RE-120', source: 'MANUAL' }] })]));
    expect(html).toContain('Möglicherweise bereits erfasst'); expect(html).toContain('nicht erneut buchen');
    expect(html).toContain('Nachweis öffnen'); expect(html).not.toContain('Starkes Signal');
    expect(html).not.toContain('Nur Vorschlag · keine Zahlung erfasst');
    expect(html.replace(/<details[\s\S]*?<\/details>/gu, '').match(/Möglicherweise bereits erfasst/gu)).toHaveLength(1);
  });
  it('keeps errors and the essential duplicate caution visible while detailed reasons use native disclosure', () => {
    const html = render(row({ errors: ['Ungültiges Datum'], duplicate: true, warnings: ['Mögliche Dublette — Originalbelege prüfen.'], duplicateWarnings: ['Mögliche Dublette — Originalbelege prüfen.'] }));
    expect(html).toContain('Ungültiges Datum'); expect(html).toContain('Mögliche Dublette');
    expect(html).toContain('<details'); expect(html).not.toContain('<details open'); expect(html).not.toContain('Starkes Signal');
    expect(html.replace(/<details[\s\S]*?<\/details>/gu, '')).toContain('Ungültiges Datum');
  });
  it('consolidates duplicate and existing-payment cautions without dropping any detailed risk reason', () => {
    const reasons = ['Identische Buchungsdaten kommen mehrfach vor.', 'Die externe Bank-ID kommt mehrfach vor.', 'Mehrere Buchungen haben denselben Tag und Betrag.'];
    const html = render(row({ duplicate: true, warnings: reasons, duplicateWarnings: reasons }), result([candidate({ existingPayments: [{ amountCents: '4000', paidAt: '2026-10-21T00:00:00.000Z', reference: 'RE-120', source: 'MANUAL' }] })]));
    const visible = html.replace(/<details[\s\S]*?<\/details>/gu, '');
    expect(visible.match(/Mögliche Dublette\. Keine Zeile entfernt/gu)).toHaveLength(1);
    expect(visible.match(/Möglicherweise bereits erfasst/gu)).toHaveLength(1);
    expect(html).toContain('aria-label="Prüfhinweise zu Bankzeile 2"');
    for (const reason of reasons) { expect(html).toContain(reason); expect(visible).not.toContain(reason); }
    expect(html).toContain('nicht nochmals als neue Zahlung buchen');
  });
  it('keeps missing-reference and missing-customer warnings visible even on duplicate rows', () => {
    const reason = 'Identische Buchungsdaten kommen mehrfach vor.';
    const blockers = ['Verwendungszweck fehlt: keine Rechnungsvorschläge möglich.', 'Zahlungspartner fehlt: kein Kunden-/Betragsabgleich möglich.'];
    const html = render(row({ duplicate: true, reference: '', counterparty: '', warnings: [...blockers, reason], duplicateWarnings: [reason] }));
    const visible = html.replace(/<details[\s\S]*?<\/details>/gu, '');
    for (const blocker of blockers) expect(visible).toContain(blocker);
    expect(visible).not.toContain(reason); expect(html).toContain(reason);
  });
  it('shows a clear no-match result without inventing a candidate', () => {
    expect(render(row(), result([]))).toContain('Kein eindeutiger Rechnungsvorschlag');
    expect(render(row(), null)).not.toContain('Kein eindeutiger Rechnungsvorschlag');
  });
  it('never proposes expenses or foreign-currency conversion', () => {
    const html = render(row({ amountCents: '-505', currency: 'EUR' }));
    expect(html).toContain('−5,05 €'); expect(html).toContain('kein EUR-Eingang'); expect(html).not.toContain('RE-120</h4>');
  });
  it('escapes untrusted bank text rather than rendering markup', () => {
    const html = render(row({ reference: '<img src=x onerror=alert(1)>', counterparty: '<script>unsafe</script>' }), null);
    expect(html).toContain('&lt;script&gt;unsafe&lt;/script&gt;'); expect(html).toContain('&lt;img');
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<img');
  });
});
