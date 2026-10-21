import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { FullPaymentFields } from '@/components/dashboard/full-payment-dialog';
import { PaymentHistory } from '@/components/payments/payment-history';
import { displayPaymentAmount, paymentAttempt, paymentFailure, paymentIdentityStorageKey, paymentInputCents, paymentPendingStorageKey, readConfirmedPayment, readPaymentPreflight, recoverConfirmedPayment, validatePaymentFields } from '@/lib/full-payment-form';

const summary = (paidCents = '0') => ({ totalCents: '12000', paidCents, openCents: (BigInt(12000) - BigInt(paidCents)).toString(), paid: paidCents === '12000', paymentState: paidCents === '12000' ? 'PAID' : paidCents === '0' ? 'OPEN' : 'PARTIAL' });
const event = (id = 1, amountCents = '4000', key = 'first') => ({ id, invoiceId: 7, amountCents, currency: 'EUR' as const, paidAt: '2026-10-19T00:00:00.000Z', dateCertainty: 'ACTUAL', source: 'MANUAL', reference: 'Statement', idempotencyKey: key });
const preflight = (paidCents = '0', events = paidCents === '0' ? [] : [event(1, paidCents)]) => ({ currency: 'EUR', canRecordPayment: paidCents !== '12000', events, event: events.length === 1 ? events[0] : null, legacyAdoptionRequired: false, reviewRequired: false, summary: summary(paidCents) });

describe('partial-payment form safety', () => {
  it('uses exact checked server remainder and keeps settlement separate from the allocation', () => {
    expect(readPaymentPreflight(preflight())).toMatchObject({ amount: '120.00', amountCents: '12000', canRecordPayment: true });
    expect(readPaymentPreflight(preflight('4000'))).toMatchObject({ amount: '80.00', amountCents: '8000', summary: { paymentState: 'PARTIAL' } });
    expect(readPaymentPreflight(preflight('12000')).canRecordPayment).toBe(false);
    expect(displayPaymentAmount('123456789')).toBe('1.234.567,89 €');
    expect(displayPaymentAmount('1')).toBe('0,01 €');
  });
  it.each([undefined, null, {}, { ...preflight(), currency: undefined }, { ...preflight(), currency: 'USD' }, { ...preflight(), reviewRequired: true }, { ...preflight(), legacyAdoptionRequired: true }, { ...preflight(), summary: null }])('blocks unknown or review-required balances: %j', data => {
    expect(() => readPaymentPreflight(data)).toThrow();
  });
  it('allows read-only history but never entry when capability is false', () => {
    expect(readPaymentPreflight({ ...preflight('4000'), canRecordPayment: false })).toMatchObject({ canRecordPayment: false, events: [event()] });
  });
  it.each(['', '0', '-1', '1.2', '001', '9007199254740992', 'NaN'])('rejects ambiguous/unsafe total cents %s', cents => {
    const data = preflight(); data.summary.totalCents = data.summary.openCents = cents;
    expect(() => readPaymentPreflight(data)).toThrow();
  });
  it('rejects inconsistent totals, state and event sums', () => {
    for (const change of [{ paidCents: '4000' }, { openCents: '1' }, { paymentState: 'PAID' }, { paid: true }]) {
      expect(() => readPaymentPreflight({ ...preflight(), summary: { ...summary(), ...change } })).toThrow();
    }
    expect(() => readPaymentPreflight({ ...preflight('4000'), events: [event(1, '3999')] })).toThrow();
  });
  it.each(['0', '-1', '0.001', '1.001', '1e2', 'NaN', '1.000,00', '90071992547409.92'])('rejects nonpositive, subcent or unsafe editable amounts: %s', amount => {
    expect(() => paymentInputCents(amount)).toThrow();
  });
  it('accepts decimal comma/dot and one cent without rounding', () => {
    expect(paymentInputCents('40,00')).toBe('4000');
    expect(paymentInputCents(' 0.01 ')).toBe('1');
    expect(paymentInputCents('80')).toBe('8000');
  });
  it.each(['', '2026-02-30', '2026-2-01', '2026-10-20T00:00:00.000Z'])('requires a real explicitly entered date: %s', date => {
    expect(validatePaymentFields(date, 'Statement')).toMatch(/Zahlungsdatum/);
  });
  it('accepts an actual past leap date and requires a bounded reference', () => {
    expect(validatePaymentFields('2024-02-29', ' Statement ')).toBeNull();
    for (const reference of ['', 'x'.repeat(256), 'line\nline']) expect(validatePaymentFields('2024-02-29', reference)).toMatch(/Referenz/i);
  });
  it('retains UUID and frozen precondition for identical uncertain retries', () => {
    const uuid = vi.fn().mockReturnValueOnce('first').mockReturnValue('second');
    const first = paymentAttempt(null, 7, '40.00', '2026-10-19', ' Statement ', uuid, '0');
    const retry = paymentAttempt(JSON.parse(JSON.stringify(first)), 7, '40,00', '2026-10-19', 'Statement', uuid, '0');
    expect(retry.idempotencyKey).toBe('first');
    expect(retry.expectedPaidCents).toBe('0');
    expect(uuid).toHaveBeenCalledTimes(1);
    // A later intentional same-looking payment is not a replay of the first.
    expect(paymentAttempt(retry, 7, '40.00', '2026-10-19', 'Statement', uuid, '4000').idempotencyKey).toBe('second');
  });
  it.each(['invoice', 'amount', 'date', 'reference'])('changes UUID for genuinely changed %s', changed => {
    const uuid = vi.fn().mockReturnValueOnce('first').mockReturnValueOnce('new');
    const first = paymentAttempt(null, 7, '40', '2026-10-19', 'Statement', uuid);
    expect(paymentAttempt(first, changed === 'invoice' ? 8 : 7, changed === 'amount' ? '40.01' : '40', changed === 'date' ? '2026-10-18' : '2026-10-19', changed === 'reference' ? 'Other' : 'Statement', uuid).idempotencyKey).toBe('new');
  });
  it('confirms a matching allocation while accepting its still-open whole-ledger summary', () => {
    const draft = paymentAttempt(null, 7, '40', '2026-10-19', 'Statement', () => 'first');
    const response = { event: event(), summary: summary('4000') };
    expect(readConfirmedPayment(response, draft, 7)).toMatchObject({ id: 1, amountCents: '4000', summary: { openCents: '8000', paid: false } });
    for (const mismatch of [{ dateCertainty: 'UNKNOWN' }, { paidAt: '2026-10-20T00:00:00.000Z' }, { currency: 'USD' }, { idempotencyKey: 'other' }, { invoiceId: 8 }, { amountCents: '3999' }]) {
      expect(() => readConfirmedPayment({ ...response, event: { ...event(), ...mismatch } }, draft, 7)).toThrow(/Speicherbestätigung/);
    }
  });
  it('recovers ONLY the known pending key, not any/latest manual event or mere existing history', () => {
    const data = preflight('12000', [event(), event(2, '8000', 'second')]);
    expect(recoverConfirmedPayment(data, 7)).toBeNull();
    expect(recoverConfirmedPayment(data, 7, 'missing')).toBeNull();
    expect(recoverConfirmedPayment(data, 7, 'first')?.id).toBe(1);
    expect(recoverConfirmedPayment(data, 7, 'second')?.id).toBe(2);
    expect(recoverConfirmedPayment({ ...data, events: [{ ...event(), source: 'LEGACY_IMPORT' }] }, 7, 'first')).toBeNull();
    const wrongDraft = paymentAttempt(null, 7, '30', '2026-10-19', 'Statement', () => 'first');
    expect(() => recoverConfirmedPayment(data, 7, 'first', wrongDraft)).toThrow();
  });
  it('explains stale-balance and overpayment conflicts without losing the draft', () => {
    expect(paymentFailure({ code: 'PAYMENT_STATE_CHANGED' })).toMatch(/Eingaben bleiben erhalten/);
    expect(paymentFailure({ code: 'PAYMENT_EXCEEDS_OPEN' })).toMatch(/nichts gebucht/);
    expect(paymentFailure({ code: 'IDEMPOTENCY_CONFLICT' })).toMatch(/keine zweite Zahlung/);
  });
  it('namespaces opaque durable identity by tenant/invoice and hash, not plaintext payment fields', async () => {
    const fingerprint = JSON.stringify([7, '40.00', 'EUR', '2026-10-19', 'Private bank statement', '0']);
    const key = await paymentIdentityStorageKey('user:one', 7, fingerprint);
    expect(key).toMatch(/^bivaro:payment-attempt:user%3Aone:7:[a-f0-9]{64}$/);
    for (const text of ['40.00', '2026-10-19', 'Private']) expect(key).not.toContain(text);
    expect(await paymentIdentityStorageKey('user:two', 7, fingerprint)).not.toBe(key);
    expect(paymentPendingStorageKey('user:one', 7)).toBe('bivaro:payment-pending:user%3Aone:7');
  });
  it('keeps conflict resubmission deliberate and clears pending identity only after confirmed success', () => {
    const dialog = readFileSync('components/dashboard/full-payment-dialog.tsx', 'utf8');
    expect(dialog).toContain('expectedPaidCents: draft.expectedPaidCents');
    expect(dialog).toContain('setConflict(true)');
    expect(dialog).toContain('Aktuellen Restbetrag geprüft');
    expect(dialog).toContain('isSubmitting || conflict}');
    expect(dialog).toContain('pendingKey.current, attempt.current');
    expect(dialog).toContain('setConfirmed(saved);');
    expect(dialog).toContain('sessionStorage.removeItem(identityStorage)');
    expect(dialog).toContain('onEscapeKeyDown');
  });
});

describe('accessible payment fields and history cards', () => {
  const props = { id: 'payment', paidAt: '', reference: '', disabled: false, onDateChange: vi.fn(), onReferenceChange: vi.fn() };
  it('starts with empty date and visible labels, help and required fields', () => {
    const html = renderToStaticMarkup(createElement(FullPaymentFields, props));
    for (const text of ['for="payment-date"', 'aria-describedby="payment-date-help"', 'type="date"', 'value=""', 'kein heutiges Datum vorbelegt', 'for="payment-reference"', 'maxLength="255"']) expect(html).toContain(text);
    expect(html.match(/required=""/g)).toHaveLength(2);
  });
  it('locks entered evidence while submitting', () => {
    const html = renderToStaticMarkup(createElement(FullPaymentFields, { ...props, disabled: true, paidAt: '2026-10-19', reference: 'Statement' }));
    expect(html).toContain('value="2026-10-19"');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
  it('renders both allocations, actual dates, references and historical uncertainty as readable cards', () => {
    const events = [event(), { ...event(2, '8000', 'second'), paidAt: null, source: 'LEGACY_IMPORT', dateCertainty: 'UNKNOWN' }];
    const html = renderToStaticMarkup(createElement(PaymentHistory, { events }));
    expect(html.match(/<li /g)).toHaveLength(2);
    for (const text of ['aria-label="Zahlungsverlauf"', '40,00', '80,00', '19.10.2026', 'Tatsächliches Datum', 'Quelle: ', 'Manuell', 'Historische Übernahme', 'Datum unbekannt', 'Statement']) expect(html).toContain(text);
    expect(html).not.toContain('hidden');
  });
});
