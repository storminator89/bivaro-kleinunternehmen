import { describe, expect, it } from 'vitest';
import { durationToQuantity, formatManualDuration, parseManualDuration, summarizeServiceDuration } from '@/lib/service-duration';
import { parseBillingNoteInput } from '@/lib/billing-notes';
import { calculateInvoiceAmounts } from '@/lib/invoice-calculation';

describe('manual service duration contract', () => {
  it.each([
    ['00:01', 1, 0.016666666667], ['00:59', 59, 0.983333333333],
    ['01:00', 60, 1], ['01:01', 61, 1.016666666667],
    ['01:30', 90, 1.5], ['1000:00', 60_000, 1000],
  ])('preserves %s as integer minutes and canonical rounded hours', (text, minutes, quantity) => {
    expect(parseManualDuration(text)).toBe(minutes);
    expect(durationToQuantity(minutes)).toBe(quantity);
    expect(formatManualDuration(minutes)).toBe(text);
    expect(() => calculateInvoiceAmounts([{ quantity, unitPrice: 95, taxRate: 19 }])).not.toThrow();
  });

  it.each(['1:30', '1.5', '1,5', '01:60', '-01:30', '00:00', '1000:01', '9999:59', '', ' 01:30', '01:30 ', 90, null])('rejects ambiguous or invalid duration %j', value => {
    expect(() => parseManualDuration(value)).toThrow();
  });

  it('keeps quantity-only notes explicitly unknown and aggregates integer source minutes', () => {
    const notes = [{ durationMinutes: 1 }, { durationMinutes: 59 }, { durationMinutes: null }, {}, { durationMinutes: 60_000 }];
    expect(summarizeServiceDuration(notes)).toEqual({ durationMinutes: 60_060, quantityOnlyCount: 2 });
    expect(formatManualDuration(60_060)).toBe('1001:00');
    expect(formatManualDuration(0)).toBe('00:00');
  });

  it('uses the existing per-line cent rounding rather than pricing an aggregated time total', () => {
    const lines = [1, 1, 1].map(minutes => ({ quantity: durationToQuantity(minutes), unitPrice: 1, taxRate: 0 }));
    expect(calculateInvoiceAmounts(lines).netAmount).toBe(0.06);
    expect(calculateInvoiceAmounts([{ quantity: durationToQuantity(3), unitPrice: 1 }]).netAmount).toBe(0.05);
  });

  it('prices the displayed rounded hours, including rational-minute half-cent differences', () => {
    // 59/60 * 0.30 is exactly 0.295, but this is deliberately NOT a second
    // rational-minute pricing path: the invoice prices its displayed quantity.
    const quantity = durationToQuantity(59);
    expect(quantity).toBe(0.983333333333);
    expect(calculateInvoiceAmounts([{ quantity, unitPrice: 0.3 }]).lines[0].netAmount).toBe(0.29);
  });

  it('does not guess minutes from legacy decimal hours, and rejects conflicting units/quantities', () => {
    const base = { customerId: 1, serviceDate: '2026-10-21', description: 'Wartung' };
    expect(parseBillingNoteInput({ ...base, quantity: '1.5', unit: 'Stunde' })).toMatchObject({ durationMinutes: null, projectId: null, quantity: 1.5 });
    expect(parseBillingNoteInput({ ...base, duration: '01:30', projectId: 5 })).toMatchObject({ durationMinutes: 90, projectId: 5, quantity: 1.5, unit: 'Stunde' });
    expect(parseBillingNoteInput({ ...base, duration: '00:01', quantity: durationToQuantity(1), unit: 'Stunde' }).quantity).toBe(0.016666666667);
    expect(() => parseBillingNoteInput({ ...base, duration: '01:30', quantity: 90 })).toThrow(/Stundenmenge/);
    expect(() => parseBillingNoteInput({ ...base, duration: '01:30', unit: 'Tag' })).toThrow(/Stundenmenge/);
    expect(() => parseBillingNoteInput({ ...base, durationMinutes: 90 })).toThrow(/HH:MM/);
    expect(() => parseBillingNoteInput({ ...base, duration: '1,5' })).toThrow(/HH:MM/);
  });
});
