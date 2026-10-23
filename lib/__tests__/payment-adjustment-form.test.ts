import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PaymentAdjustmentFields, PaymentAdjustmentPanel } from '@/components/payments/payment-adjustment-panel';
import { PaymentHistory } from '@/components/payments/payment-history';
import { InvoiceBalance } from '@/components/dashboard/tabs/invoices-tab';
import { InvoiceAdjustmentEvidence } from '@/components/history/invoice-history-workspace';
import type { Invoice } from '@/types/dashboard';
import { paymentAttempt, readPaymentPreflight } from '@/lib/full-payment-form';
import { adjustmentFingerprintHash, adjustmentPendingStorageKey, paymentAdjustmentAttempt, paymentAdjustmentPayload, persistPendingAdjustment, readConfirmedPaymentAdjustment, readPaymentAdjustmentPreflight, readPendingAdjustment, validatePaymentAdjustmentFields } from '@/lib/payment-adjustment-form';

const token = 'a'.repeat(64), nextToken = 'b'.repeat(64);
const original = { id: 3, invoiceId: 7, amountCents: '12000', currency: 'EUR' as const, paidAt: '2026-10-01T00:00:00.000Z', dateCertainty: 'ACTUAL', source: 'MANUAL', reference: 'Receipt evidence', idempotencyKey: 'receipt' };
const correction = { id: 8, originalPaymentId: 3, kind: 'PAYMENT_CORRECTION' as const, amountCents: '4000', currency: 'EUR' as const, actionDate: '2026-10-20T00:00:00.000Z', accountingEffectiveOn: original.paidAt, reason: 'False receipt', reference: 'Statement check', idempotencyKey: 'correction', cancellationInvoiceId: null, fiscalMappingStatus: 'UNREVIEWED' as const };
function journal(cancelled = false) {
  return { currency: 'EUR', events: [original], adjustments: [correction], ledgerVersion: token,
    ledger: { version: 2, originalReceivedCents: '12000', correctedCents: '4000', validReceivedCents: '8000', refundedCents: '0', netRetainedCents: '8000', collectibleOpenCents: cancelled ? '0' : '4000', refundDueCents: cancelled ? '8000' : '0' },
    summary: { totalCents: '12000', paidCents: '8000', openCents: cancelled ? '0' : '4000', paid: false, paymentState: 'PARTIAL' },
    adjustmentCapacities: [{ originalPaymentId: 3, correctableCents: '8000', refundableCents: cancelled ? '8000' : '0' }], eligibleCancellationBasis: cancelled ? { invoiceId: 9, invoiceNumber: 'ST-9' } : null,
    canRecordPayment: !cancelled, canRecordAdjustment: true, adjustmentReviewReason: null, reviewRequired: false, legacyAdoptionRequired: false };
}
const draftInput = { kind: 'PAYMENT_CORRECTION' as const, originalPaymentId: 3, amount: '40,00', actionDate: '2026-10-20', reason: ' False receipt ', reference: ' Statement check ', expectedLedgerVersion: token };

describe('bounded payment adjustment UI contract', () => {
  it('separates original evidence, corrected receipts, collectible balance and cancellation refund due', () => {
    expect(readPaymentPreflight(journal())).toMatchObject({ amount: '40.00', ledgerVersion: token, summary: { paidCents: '8000' } });
    expect(readPaymentPreflight(journal(true))).toMatchObject({ canRecordPayment: false, amount: '0.00', summary: { paid: false, openCents: '0' } });
    expect(readPaymentAdjustmentPreflight(journal(true), 7)).toMatchObject({ ledger: { refundDueCents: '8000', netRetainedCents: '8000' }, eligibleCancellationBasis: { invoiceId: 9 } });
  });
  it('allows immutable originals above face after a false receipt correction and replacement', () => {
    const data = journal();
    data.events.push({ ...original, id: 4, amountCents: '4000', idempotencyKey: 'replacement' });
    data.ledger = { ...data.ledger, originalReceivedCents: '16000', validReceivedCents: '12000', netRetainedCents: '12000', collectibleOpenCents: '0' };
    data.summary = { ...data.summary, paidCents: '12000', openCents: '0', paid: true, paymentState: 'PAID' };
    expect(readPaymentPreflight(data).summary.paid).toBe(true);
    expect(readPaymentAdjustmentPreflight(data, 7).events).toHaveLength(2);
  });
  it('retains read-only unsupported balances and explains why actions are blocked', () => {
    const data = { ...journal(true), canRecordAdjustment: false, adjustmentReviewReason: 'Stornobeleg muss geprüft werden.', eligibleCancellationBasis: null, adjustmentCapacities: [{ originalPaymentId: 3, correctableCents: '0', refundableCents: '0' }] };
    expect(readPaymentAdjustmentPreflight(data, 7)).toMatchObject({ canRecordAdjustment: false, ledger: { refundDueCents: '8000' } });
  });
  it('keeps full receipt settlement independent from a real partial refund after full cancellation', () => {
    const refund = { ...correction, id: 9, kind: 'CUSTOMER_REFUND' as const, amountCents: '2000', accountingEffectiveOn: correction.actionDate, cancellationInvoiceId: 9, idempotencyKey: 'refund', reference: 'Actual payout' };
    const data = { ...journal(true), adjustments: [refund], ledger: { version: 2, originalReceivedCents: '12000', correctedCents: '0', validReceivedCents: '12000', refundedCents: '2000', netRetainedCents: '10000', collectibleOpenCents: '0', refundDueCents: '10000' }, summary: { totalCents: '12000', paidCents: '12000', openCents: '0', paid: true, paymentState: 'PAID' }, adjustmentCapacities: [{ originalPaymentId: 3, correctableCents: '10000', refundableCents: '10000' }] };
    expect(readPaymentAdjustmentPreflight(data, 7)).toMatchObject({ summary: { paid: true }, ledger: { refundedCents: '2000', refundDueCents: '10000' } });
    const draft = paymentAdjustmentAttempt(null, { ...draftInput, kind: 'CUSTOMER_REFUND', cancellationInvoiceId: 9, amount: '20', reference: 'Actual payout' }, () => 'refund');
    expect(readConfirmedPaymentAdjustment({ ...data, adjustment: refund }, draft)).toMatchObject({ kind: 'CUSTOMER_REFUND', amountCents: '2000' });
    expect(() => readPaymentAdjustmentPreflight({ ...data, adjustments: [{ ...refund, accountingEffectiveOn: original.paidAt }] }, 7)).toThrow();
  });
  it.each([
    { ledgerVersion: 'old' }, { adjustments: [] }, { adjustmentCapacities: [{ originalPaymentId: 88, correctableCents: '1', refundableCents: '0' }] },
    { adjustmentCapacities: [{ originalPaymentId: 3, correctableCents: '8001', refundableCents: '0' }] },
    { adjustments: [{ ...correction, originalPaymentId: 88 }] }, { adjustments: [{ ...correction, amountCents: '12001' }] },
    { adjustments: [{ ...correction, fiscalMappingStatus: 'APPROVED' }] }, { adjustments: [correction, correction] },
    { reviewRequired: true }, { legacyAdoptionRequired: true }, { currency: 'USD' },
  ])('fails closed on inconsistent or unsupported journal data: %j', change => { expect(() => readPaymentAdjustmentPreflight({ ...journal(), ...change }, 7)).toThrow(); });
  it('requires an exact actual original, while preserving historical-status actual instants', () => {
    const data = journal();
    data.events[0] = { ...original, source: 'LEGACY_STATUS', paidAt: '2026-10-01T14:35:12.123Z' };
    data.adjustments[0] = { ...correction, accountingEffectiveOn: data.events[0].paidAt };
    expect(readPaymentAdjustmentPreflight(data, 7).adjustments[0].accountingEffectiveOn).toBe('2026-10-01T14:35:12.123Z');
    expect(() => readPaymentAdjustmentPreflight({ ...data, events: [{ ...original, source: 'LEGACY_IMPORT', dateCertainty: 'UNKNOWN', paidAt: null }] }, 7)).toThrow();
    expect(() => readPaymentAdjustmentPreflight(journal(), 8)).toThrow();
  });
  it('keeps correction, refund and changed-ledger UUID identities separate', () => {
    const uuid = vi.fn().mockReturnValueOnce('first').mockReturnValue('next');
    const first = paymentAdjustmentAttempt(null, draftInput, uuid);
    expect(paymentAdjustmentAttempt(first, { ...draftInput, amount: '40.00', reason: 'False receipt', reference: 'Statement check' }, uuid).idempotencyKey).toBe('first');
    expect(paymentAdjustmentAttempt(first, { ...draftInput, expectedLedgerVersion: nextToken }, uuid).idempotencyKey).toBe('next');
    const refund = paymentAdjustmentAttempt(first, { ...draftInput, kind: 'CUSTOMER_REFUND', cancellationInvoiceId: 9 }, uuid);
    expect(refund).toMatchObject({ cancellationInvoiceId: 9, currency: 'EUR' });
    expect(paymentAdjustmentPayload(first)).toMatchObject({ declarationNeverReceived: true, amount: '40.00', expectedLedgerVersion: token });
    expect(paymentAdjustmentPayload(refund)).not.toHaveProperty('declarationNeverReceived');
    expect(paymentAdjustmentPayload(first)).not.toHaveProperty('fingerprint');
    expect(paymentAdjustmentPayload(first)).not.toHaveProperty('amountCents');
    expect(paymentAdjustmentPayload(first)).not.toHaveProperty('currency');
    expect(() => paymentAdjustmentAttempt(null, { ...draftInput, kind: 'CUSTOMER_REFUND' }, uuid)).toThrow();
    expect(paymentAttempt(null, 7, '40', '2026-10-20', 'Statement', () => 'positive', '8000', token).expectedLedgerVersion).toBe(token);
  });
  it('requires explicit dates, evidence, reason and the correct real-world declaration', () => {
    expect(validatePaymentAdjustmentFields('PAYMENT_CORRECTION', '', 'Reason', 'Proof', true)).toMatch(/Datum/);
    expect(validatePaymentAdjustmentFields('CUSTOMER_REFUND', '2026-02-30', 'Reason', 'Proof', true)).toMatch(/Auszahlungsdatum/);
    expect(validatePaymentAdjustmentFields('PAYMENT_CORRECTION', '2026-10-20', 'Reason', 'Proof', false)).toMatch(/nie eingegangen/);
    expect(validatePaymentAdjustmentFields('CUSTOMER_REFUND', '2026-10-20', 'Reason', 'Proof', false)).toMatch(/tatsächlich ausgezahlt/);
    for (const reason of ['', 'x'.repeat(1001), 'a\nb']) expect(validatePaymentAdjustmentFields('PAYMENT_CORRECTION', '2026-10-20', reason, 'Proof', true)).toMatch(/Grund/);
    expect(validatePaymentAdjustmentFields('CUSTOMER_REFUND', '2026-10-20', 'Reason', '', true)).toMatch(/Auszahlungsnachweis/);
    expect(validatePaymentAdjustmentFields('CUSTOMER_REFUND', '2026-10-20', 'Reason', 'Proof', true)).toBeNull();
  });
  it('accepts only an exact persisted confirmation, never merely an OK response', () => {
    const draft = paymentAdjustmentAttempt(null, draftInput, () => 'correction');
    const response = { ...journal(), adjustment: correction };
    expect(readConfirmedPaymentAdjustment(response, draft).id).toBe(8);
    expect(() => readConfirmedPaymentAdjustment(response, draft, '2026-10-02T00:00:00.000Z')).toThrow(/Speicherbestätigung/);
    for (const change of [{ amountCents: '3999' }, { originalPaymentId: 4 }, { reference: 'Different' }, { actionDate: '2026-10-21T00:00:00.000Z' }, { cancellationInvoiceId: 9 }, { idempotencyKey: 'other' }]) expect(() => readConfirmedPaymentAdjustment({ ...response, adjustment: { ...correction, ...change } }, draft)).toThrow(/Speicherbestätigung/);
    expect(() => readConfirmedPaymentAdjustment({}, draft)).toThrow(/Speicherbestätigung/);
  });
  it('persists only opaque scoped retry identity, not bank references or monetary evidence', async () => {
    const draft = paymentAdjustmentAttempt(null, draftInput, () => '12345678-1234-1234-1234-123456789012');
    const fingerprintHash = await adjustmentFingerprintHash(draft.fingerprint);
    const serialized = JSON.stringify({ idempotencyKey: draft.idempotencyKey, expectedLedgerVersion: token, fingerprintHash });
    expect(readPendingAdjustment(serialized)?.idempotencyKey).toBe(draft.idempotencyKey);
    expect(readPendingAdjustment('{}')).toBeNull(); expect(readPendingAdjustment('bad')).toBeNull();
    for (const evidence of ['False receipt', 'Statement check', '40.00', '2026-10-20']) expect(serialized).not.toContain(evidence);
    expect(adjustmentPendingStorageKey('user:one', 7)).toBe('bivaro:payment-adjustment-pending:user%3Aone:7');
  });
  it('requires a durable opaque identity write and exact readback before any adjustment request', () => {
    const pending = { idempotencyKey: '12345678-1234-1234-1234-123456789012', expectedLedgerVersion: token, fingerprintHash: nextToken };
    let stored: string | null = null;
    const storage = { setItem: vi.fn((_key: string, value: string) => { stored = value; }), getItem: vi.fn(() => stored) };
    expect(() => persistPendingAdjustment(storage, 'opaque', pending)).not.toThrow();
    expect(() => persistPendingAdjustment({ setItem: () => { throw new Error('Disabled'); }, getItem: () => null }, 'opaque', pending)).toThrow(/Keine Anfrage gesendet/);
    expect(() => persistPendingAdjustment({ setItem: vi.fn(), getItem: () => 'different' }, 'opaque', pending)).toThrow(/Eingaben bleiben erhalten/);
    const panel = readFileSync('components/payments/payment-adjustment-panel.tsx', 'utf8');
    expect(panel.indexOf('persistPendingAdjustment(sessionStorage')).toBeLessThan(panel.indexOf('const response = await fetch'));
    expect(panel).toContain('stored !== null && !restored');
    expect(panel).toContain('disabled || storageError || confirmed');
  });
});

describe('adjustment fields and immutable history presentation', () => {
  const fields = { id: 'adjustment', kind: 'PAYMENT_CORRECTION' as const, amount: '', actionDate: '', reason: '', reference: '', acknowledged: false, disabled: false, onAmountChange: vi.fn(), onDateChange: vi.fn(), onReasonChange: vi.fn(), onReferenceChange: vi.fn(), onAcknowledgedChange: vi.fn() };
  it('starts with no date or declaration, labels reason and evidence, and locks all fields during retries', () => {
    const html = renderToStaticMarkup(createElement(PaymentAdjustmentFields, fields));
    for (const content of ['Nie erhaltener Betrag', 'Datum der entdeckten Fehlbuchung', 'for="adjustment-date"', 'type="date"', 'kein heutiges Datum', 'Nachvollziehbarer Grund', 'Prüfbarer Korrekturbezug', 'nie eingegangen']) expect(html).toContain(content);
    expect(html).not.toContain('checked=""');
    expect(renderToStaticMarkup(createElement(PaymentAdjustmentFields, { ...fields, disabled: true })).match(/disabled=""/g)).toHaveLength(5);
    const refundHtml = renderToStaticMarkup(createElement(PaymentAdjustmentFields, { ...fields, kind: 'CUSTOMER_REFUND' }));
    for (const content of ['Tatsächliches Auszahlungsdatum', 'Nachweis der tatsächlichen Auszahlung', 'keine Überweisung ausgelöst', 'geplante Überweisung reicht nicht']) expect(refundHtml).toContain(content);
  });
  it('renders original-linked correction and payout evidence without overwriting original amount or reference', () => {
    const refund = { ...correction, id: 9, kind: 'CUSTOMER_REFUND' as const, amountCents: '2000', accountingEffectiveOn: correction.actionDate, cancellationInvoiceId: 10, reference: 'Actual payout' };
    const html = renderToStaticMarkup(createElement(PaymentHistory, { events: [original], adjustments: [correction, refund] }));
    for (const content of ['120,00', '40,00', '20,00', 'Original-Zahlungsnachweis #3', 'Folgebeleg #8', 'Folgebeleg #9', 'Korrektur: nie erhalten', 'Erstattung: tatsächlich zurückgezahlt', 'Receipt evidence', 'Actual payout', 'steuerlich prüfpflichtig, nicht freigegeben']) expect(html).toContain(content);
  });
  it('always separates refund due and flags absent fiscal signoff', () => {
    const html = renderToStaticMarkup(createElement(PaymentAdjustmentPanel, { invoiceId: 7, tenantId: 'user', journal: readPaymentAdjustmentPreflight(journal(true), 7), disabled: false, loading: false, onEditingChange: vi.fn(), onBusyChange: vi.fn(), onReload: vi.fn(), onRecorded: vi.fn() }));
    for (const content of ['Noch zu erstatten', '80,00', 'Hier wird niemals Geld überwiesen', 'Steuerliche Zuordnung: prüfpflichtig, nicht fachlich freigegeben']) expect(html).toContain(content);
  });
  it('lets every adjustment action wrap naturally at mobile widths without clipping or shortening safety copy', () => {
    const html = renderToStaticMarkup(createElement(PaymentAdjustmentPanel, { invoiceId: 7, tenantId: 'user', journal: readPaymentAdjustmentPreflight(journal(true), 7), disabled: false, loading: false, onEditingChange: vi.fn(), onBusyChange: vi.fn(), onReload: vi.fn(), onRecorded: vi.fn() }));
    expect(html).toContain('class="min-w-0 space-y-4');
    const entry = html.match(/<button\b[^>]*>Korrektur \/ Erstattung dokumentieren<\/button>/)?.[0];
    expect(entry).toBeDefined();
    const classes = entry?.match(/class="([^"]*)"/)?.[1].split(/\s+/) ?? [];
    for (const name of ['h-auto', 'min-h-11', 'min-w-0', 'max-w-full', 'w-full', 'whitespace-normal', 'break-words', 'leading-snug']) expect(classes).toContain(name);
    for (const name of ['h-11', 'whitespace-nowrap', 'truncate', 'overflow-hidden']) expect(classes).not.toContain(name);
    const panel = readFileSync('components/payments/payment-adjustment-panel.tsx', 'utf8');
    const buttons = panel.match(/<Button\b[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(6);
    for (const button of buttons) expect(button).toContain('adjustmentActionClassName');
    for (const copy of ['Erstattung verbindlich dokumentieren', 'Korrektur verbindlich speichern', 'Unverändert erneut bestätigen', 'Aktuellen Journalstand geprüft', 'Zurück zum Zahlungseingang']) expect(panel).toContain(copy);
    expect(panel).toContain('<fieldset disabled={locked} className="min-w-0');
    expect(panel).toMatch(/<select\b[^>]*className="min-h-11 w-full min-w-0/);
    const history = renderToStaticMarkup(createElement(PaymentHistory, { events: [original] }));
    expect(history).toContain('aria-label="Zahlungsverlauf" class="min-w-0"');
    const dialog = readFileSync('components/dashboard/full-payment-dialog.tsx', 'utf8');
    expect(dialog).toMatch(/<DialogContent className="[^"]*grid-cols-1/);
    expect(panel).not.toMatch(/overflow-(?:x-)?(?:hidden|clip)|truncate/);
  });
  it('keeps monetary axes and fiscal limitation visible while disclosing only optional explanation', () => {
    const html = renderToStaticMarkup(createElement(PaymentAdjustmentPanel, { invoiceId: 7, tenantId: 'user', journal: readPaymentAdjustmentPreflight(journal(true), 7), disabled: false, loading: false, onEditingChange: vi.fn(), onBusyChange: vi.fn(), onReload: vi.fn(), onRecorded: vi.fn() }));
    const primaryContent = html.slice(0, html.indexOf('<details'));
    for (const content of ['Gültig eingegangen', 'Nie erhalten / korrigiert', 'Bereits zurückgezahlt', 'Tatsächlich einbehalten', 'Noch einzuziehen', 'Noch zu erstatten', 'Steuerlich nicht freigegeben']) expect(primaryContent).toContain(content);
    expect(html).toContain('Hinweise und Grenzen');
    expect(html).not.toContain('<details open');
    expect(primaryContent).not.toContain('Kassenbuch');
    const panel = readFileSync('components/payments/payment-adjustment-panel.tsx', 'utf8');
    expect(panel).toContain("!conflictVersion && <Button type=\"submit\"");
    expect(panel).toContain('choiceRef.current?.focus()'); expect(panel).toContain('entryRef.current?.focus()');
  });
  it('keeps compact original evidence visible and collapses long history without removing any evidence', () => {
    const events = [original, { ...original, id: 4 }, { ...original, id: 5 }];
    const html = renderToStaticMarkup(createElement(PaymentHistory, { events, adjustments: [correction] }));
    expect(html).toContain('3 Eingänge'); expect(html).toContain('1 Folgebeleg');
    expect(html).toContain('Nachweisdetails'); expect(html).toContain('Folgebeleg ansehen');
    expect(html).toContain('Statement check'); expect(html).toContain('False receipt');
    expect(html.slice(0, html.indexOf('<ol'))).not.toContain('open=""');
    const short = renderToStaticMarkup(createElement(PaymentHistory, { events: [original] }));
    expect(short.slice(0, short.indexOf('<ol'))).toContain('open=""');
  });
  it('shows cancellation liabilities and actual refunds rather than an open collectible debt', () => {
    const checked = readPaymentAdjustmentPreflight(journal(true), 7);
    if (checked.ledger.version !== 2) throw new Error('Expected historical v2 fixture');
    const invoice: Invoice = { id: 7, fileName: 'Invoice', uploadedAt: original.paidAt, status: 'CANCELLED', paymentSummary: checked.summary, paymentLedger: { ...checked.ledger, refundedCents: '2000', netRetainedCents: '6000', refundDueCents: '6000' } };
    const html = renderToStaticMarkup(createElement(InvoiceBalance, { invoice }));
    for (const content of ['Tatsächlich erstattet 20,00', 'Noch zu erstatten 60,00']) expect(html).toContain(content);
    expect(html).not.toContain('Offen');
    const active = renderToStaticMarkup(createElement(InvoiceBalance, { invoice: { ...invoice, status: 'SENT', paymentLedger: readPaymentAdjustmentPreflight(journal(), 7).ledger } }));
    for (const content of ['Gültig erhalten 80,00', 'Nie erhalten / korrigiert 40,00', 'Offen 40,00']) expect(active).toContain(content);
    expect(renderToStaticMarkup(createElement(InvoiceBalance, { invoice: { ...invoice, paymentLedger: null } }))).toContain('Erstattungsstand prüfen');
  });
  it('renders bounded original-linked document-history DTOs without private payment references', () => {
    const event = { ...correction, recordedAt: '2026-10-20T14:00:00.000Z', reason: '<script>unsafe</script>' };
    const html = renderToStaticMarkup(createElement(InvoiceAdjustmentEvidence, { adjustments: [event], adjustmentCount: 51 }));
    for (const content of ['Korrektur: nie erhalten', 'Original-Zahlungsnachweis #3', 'Folgebeleg #8', '40,00', 'Buchungszuordnung', 'Protokolliert', 'neuesten 1 von 51', 'Steuerlich ungeprüft', '&lt;script&gt;']) expect(html).toContain(content);
    expect(html).not.toContain('Statement check'); expect(html).not.toContain('idempotency');
    expect(renderToStaticMarkup(createElement(InvoiceAdjustmentEvidence, {}))).toContain('in diesem Datenstand nicht enthalten');
    expect(renderToStaticMarkup(createElement(InvoiceAdjustmentEvidence, { adjustments: [], adjustmentCount: 0 }))).toContain('Keine Korrektur- oder Erstattungsbelege');
  });
  it('guards repeated submission, dismissal, stale-state resubmit and unknown outcomes in integration source', () => {
    const panel = readFileSync('components/payments/payment-adjustment-panel.tsx', 'utf8'), dialog = readFileSync('components/dashboard/full-payment-dialog.tsx', 'utf8');
    for (const content of ['submitting.current || disabled', 'pending.current.fingerprintHash !== fingerprintHash', 'readConfirmedPaymentAdjustment(data, draft,', 'setConflictVersion(journal.ledgerVersion)', 'journal.ledgerVersion === conflictVersion', 'Aktuellen Journalstand geprüft', 'saved.idempotencyKey', 'sessionStorage.removeItem(storageKey)', 'busy || disabled || uncertain']) expect(panel).toContain(content);
    for (const content of ['adjustmentSubmitting.current', 'expectedLedgerVersion: draft.expectedLedgerVersion', ':ledger-version', 'onEscapeKeyDown', 'onPointerDownOutside']) expect(dialog).toContain(content);
  });
  it('discards pre-save journal axes after a verified receipt and rechecks them without erasing its saved proof', () => {
    const dialog = readFileSync('components/dashboard/full-payment-dialog.tsx', 'utf8');
    const save = dialog.slice(dialog.indexOf('const saved = readConfirmedPayment(data, draft, invoice.id);'), dialog.indexOf('} catch (failure)', dialog.indexOf('const saved = readConfirmedPayment(data, draft, invoice.id);')));
    const sequence = ['setConfirmed(saved);', 'clearIdentity();', 'setAdjustmentJournal(null);', 'setPreflight(null);', 'setLoadError(null);', 'setIsLoading(true);', 'setReload(value => value + 1);', 'await refreshLists();'];
    let previous = -1;
    for (const step of sequence) { const index = save.indexOf(step); expect(index).toBeGreaterThan(previous); previous = index; }
    expect(dialog).toContain("headers: { 'X-Bivaro-Payment-Contract': '3' }, signal: controller.signal");
    expect(dialog).toContain('setAdjustmentJournal(adjustments)');
    const savedView = dialog.slice(dialog.indexOf(' : confirmed ? ('), dialog.indexOf(') : preflight &&'));
    for (const content of ['isLoading &&', 'Aktueller Journalstand wird geprüft', 'ref={successRef}', 'Zahlung gespeichert', 'confirmed.amountCents', 'loadError &&', 'der aktuelle Journalstand konnte nicht geladen werden', 'Nicht erneut buchen.', 'onClick={reloadPaymentData}>Journal erneut laden']) expect(savedView).toContain(content);
    const retry = dialog.slice(dialog.indexOf('const reloadPaymentData = () =>'), dialog.indexOf('const submit = async'));
    expect(retry).toContain('setLoadError(null)'); expect(retry).toContain('setReload(value => value + 1)');
    for (const content of ['setConfirmed(', 'clearIdentity(', 'fetch(', 'method:', '.focus(']) expect(retry).not.toContain(content);
    const failure = dialog.slice(dialog.lastIndexOf('} catch (failure)'), dialog.indexOf('\n  return ('));
    expect(failure).not.toContain('setConfirmed(');
  });
  it('uses the strictly validated adjustment response ledger until a newer journal includes that saved adjustment', () => {
    const panel = readFileSync('components/payments/payment-adjustment-panel.tsx', 'utf8');
    const verified = panel.indexOf('const saved = readConfirmedPaymentAdjustment(data, draft,');
    const authority = panel.indexOf('setConfirmedLedger(readPaymentLedger((data as { ledger: unknown }).ledger))');
    expect(verified).toBeGreaterThan(-1); expect(authority).toBeGreaterThan(verified);
    expect(authority).toBeLessThan(panel.indexOf('setConfirmed(saved); clearPending();'));
    expect(panel).toContain('confirmedLedger && !journal.adjustments.some(event => event.id === confirmed?.id) ? confirmedLedger : journal.ledger');
    expect(panel).toContain('const displayAmounts = invoicePaymentAmounts(displayLedger)');
    for (const axis of ['valid', 'corrected', 'refunded', 'retained', 'open', 'refundDue']) {
      expect(panel).toContain(`displayPaymentAmount(displayAmounts.${axis})`);
      expect(panel).not.toContain(`displayPaymentAmount(journal.ledger.${axis})`);
    }
    const recovery = panel.slice(panel.indexOf('useEffect(() => {'), panel.indexOf('useEffect(() => { if (error)'));
    expect(recovery).toContain('setConfirmed(saved)');
    expect(recovery).not.toContain('setConfirmedLedger(');
  });
});
