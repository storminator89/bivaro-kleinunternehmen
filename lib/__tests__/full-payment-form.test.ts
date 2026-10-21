import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FullPaymentFields } from '@/components/dashboard/full-payment-dialog';
import { displayPaymentAmount, paymentAttempt, paymentFailure, paymentIdentityStorageKey, readConfirmedPayment, readPaymentPreflight, recoverConfirmedPayment, validatePaymentFields } from '@/lib/full-payment-form';

const preflight = () => ({ currency: 'EUR', canRecordPayment: true, event: null, legacyAdoptionRequired: false, summary: { totalCents: '12345', paidCents: '0', openCents: '12345', paid: false } });

describe('first full-payment form safety', () => {
  it('uses checked server cents without a floating point or locale round trip', () => {
    expect(readPaymentPreflight(preflight())).toEqual({ amount: '123.45', amountCents: '12345' });
    const whole = preflight(); whole.summary.totalCents = whole.summary.openCents = '12000';
    expect(readPaymentPreflight(whole).amount).toBe('120.00');
    expect(displayPaymentAmount('123456789')).toBe('1.234.567,89 €');
    expect(displayPaymentAmount('1')).toBe('0,01 €');
  });

  it.each([undefined, null, {}, { ...preflight(), currency: undefined }, { ...preflight(), currency: 'USD' }, { ...preflight(), canRecordPayment: false }])('blocks unknown currency/eligibility or missing data: %j', data => {
    expect(() => readPaymentPreflight(data)).toThrow();
  });

  it.each(['', '0', '-1', '1.2', '001', '9007199254740992', 'NaN'])('rejects ambiguous/unsafe total cents %s', cents => {
    const data = preflight(); data.summary.totalCents = data.summary.openCents = cents;
    expect(() => readPaymentPreflight(data)).toThrow();
  });

  it('refuses partial, prior and historical payments rather than making another income', () => {
    expect(() => readPaymentPreflight({ ...preflight(), legacyAdoptionRequired: true, summary: null })).toThrow(/historische/i);
    expect(() => readPaymentPreflight({ ...preflight(), event: { id: 1 } })).toThrow(/bereits/i);
    const partial = preflight(); partial.summary.paidCents = '1'; partial.summary.openCents = '12344';
    expect(() => readPaymentPreflight(partial)).toThrow(/Teilzahlungen/);
  });

  it.each(['', '2026-02-30', '2026-2-01', '2026-10-20T00:00:00.000Z'])('requires a real explicitly entered calendar date: %s', date => {
    expect(validatePaymentFields(date, 'Kontoauszug')).toMatch(/Zahlungsdatum/);
  });
  it('accepts an actual past date including a leap day, and requires a bounded reference', () => {
    expect(validatePaymentFields('2024-02-29', ' Kontoauszug ')).toBeNull();
    expect(validatePaymentFields('2024-02-29', '')).toMatch(/Referenz/i);
    expect(validatePaymentFields('2024-02-29', 'x'.repeat(256))).toMatch(/Referenz/i);
    expect(validatePaymentFields('2024-02-29', 'line\nline')).toMatch(/Referenz/i);
  });

  it('retains the same UUID across failed retries, reload and trimmed-reference equivalence', () => {
    const uuid = vi.fn().mockReturnValueOnce('first').mockReturnValue('second');
    const first = paymentAttempt(null, 7, '123.45', '2026-10-19', ' Statement ', uuid);
    const restored = JSON.parse(JSON.stringify(first));
    const retry = paymentAttempt(restored, 7, '123.45', '2026-10-19', 'Statement', uuid);
    expect(retry.idempotencyKey).toBe('first');
    expect(uuid).toHaveBeenCalledTimes(1);
    expect(paymentAttempt(retry, 7, '123.45', '2026-10-18', 'Statement', uuid).idempotencyKey).toBe('second');
  });

  it.each(['invoice', 'amount', 'date', 'reference'])('changes the UUID for a genuine changed %s payload', changed => {
    const uuid = vi.fn().mockReturnValueOnce('first').mockReturnValueOnce('new');
    const first = paymentAttempt(null, 7, '123.45', '2026-10-19', 'Statement', uuid);
    const next = paymentAttempt(first, changed === 'invoice' ? 8 : 7, changed === 'amount' ? '123.46' : '123.45', changed === 'date' ? '2026-10-18' : '2026-10-19', changed === 'reference' ? 'Other' : 'Statement', uuid);
    expect(next.idempotencyKey).toBe('new');
  });

  it('only displays a real matching saved payment and actual date as success', () => {
    const draft = paymentAttempt(null, 7, '123.45', '2026-10-19', 'Statement', () => 'key');
    const response = { replayed: true, event: { id: 3, invoiceId: 7, amountCents: '12345', currency: 'EUR', paidAt: '2026-10-19T00:00:00.000Z', source: 'MANUAL', dateCertainty: 'ACTUAL', reference: 'Statement', idempotencyKey: 'key' }, summary: { paid: true, totalCents: '12345', paidCents: '12345', openCents: '0' } };
    expect(readConfirmedPayment(response, draft, 7, '12345').paidAt).toBe('2026-10-19T00:00:00.000Z');
    expect(recoverConfirmedPayment({ ...response, canRecordPayment: false }, 7)?.id).toBe(3);
    expect(recoverConfirmedPayment({ event: null }, 7)).toBeNull();
    expect(recoverConfirmedPayment({ ...response, event: { ...response.event, source: 'LEGACY_IMPORT', dateCertainty: 'UNKNOWN' } }, 7)).toBeNull();
    for (const mismatch of [{ dateCertainty: 'UNKNOWN' }, { paidAt: '2026-10-20T00:00:00.000Z' }, { currency: 'USD' }, { idempotencyKey: 'different' }, { invoiceId: 8 }, { amountCents: '12344' }]) {
      expect(() => readConfirmedPayment({ ...response, event: { ...response.event, ...mismatch } }, draft, 7, '12345')).toThrow(/Speicherbestätigung/);
    }
  });

  it('explains conflict and full-payment restrictions without suggesting a second payment', () => {
    expect(paymentFailure({ code: 'IDEMPOTENCY_CONFLICT' })).toMatch(/keine zweite Zahlung/);
    expect(paymentFailure({ code: 'FULL_PAYMENT_REQUIRED' })).toMatch(/Teil- oder Überzahlungen/);
    expect(paymentFailure({ code: 'PAYMENT_ALREADY_EXISTS' })).toMatch(/vorhandenen Zahlungseingang/);
  });

  it('namespaces durable UUID identity by tenant, invoice and hashed payload without storing plaintext financial fields', async () => {
    const fingerprint = JSON.stringify([7, '123.45', 'EUR', '2026-10-19', 'Private bank statement']);
    const key = await paymentIdentityStorageKey('user:one', 7, fingerprint);
    expect(key).toMatch(/^bivaro:payment-attempt:user%3Aone:7:[a-f0-9]{64}$/);
    expect(key).not.toContain('123.45');
    expect(key).not.toContain('2026-10-19');
    expect(key).not.toContain('Private');
    expect(await paymentIdentityStorageKey('user:one', 7, fingerprint)).toBe(key);
    expect(await paymentIdentityStorageKey('user:two', 7, fingerprint)).not.toBe(key);
    expect(await paymentIdentityStorageKey('user:one', 8, fingerprint)).not.toBe(key);
    expect(await paymentIdentityStorageKey('user:one', 7, `${fingerprint}changed`)).not.toBe(key);
  });
});

describe('accessible full-payment fields', () => {
  const props = { id: 'payment', paidAt: '', reference: '', disabled: false, onDateChange: vi.fn(), onReferenceChange: vi.fn() };
  it('starts with an empty date and visible labels, help and native required inputs', () => {
    const html = renderToStaticMarkup(createElement(FullPaymentFields, props));
    expect(html).toContain('for="payment-date"');
    expect(html).toContain('id="payment-date"');
    expect(html).toContain('aria-describedby="payment-date-help"');
    expect(html).toContain('type="date"');
    expect(html).toContain('value=""');
    expect(html).toContain('kein heutiges Datum vorbelegt');
    expect(html).toContain('for="payment-reference"');
    expect(html).toContain('maxLength="255"');
    expect(html.match(/required=""/g)).toHaveLength(2);
    expect(html).not.toContain('type="number"');
  });
  it('keeps entered actual date and reference visible while both controls are locked for submission', () => {
    const html = renderToStaticMarkup(createElement(FullPaymentFields, { ...props, disabled: true, paidAt: '2026-10-19', reference: 'Statement' }));
    expect(html).toContain('value="2026-10-19"');
    expect(html).toContain('value="Statement"');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});
