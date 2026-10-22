import { afterEach, describe, expect, it } from 'vitest';
import { formatPaymentBusinessDate, addPaymentCalendarDays, assertCurrentPaymentTerm, assertPaymentTermDocument, isPaymentBusinessDate, parsePaymentTermDays, paymentTermSuggestion, validatePaymentTermSelection } from '@/lib/payment-terms';

const originalTimezone = process.env.TZ;
afterEach(() => { if (originalTimezone === undefined) delete process.env.TZ; else process.env.TZ = originalTimezone; });

describe('payment-term calendar and selection contract', () => {
  it('distinguishes inheritance from explicit zero and keeps the existing 14-day fallback', () => {
    expect(paymentTermSuggestion('2024-02-29', 3, 0, 30)).toMatchObject({ source: 'CUSTOMER', days: 0, dueDate: '2024-02-29' });
    expect(paymentTermSuggestion('2024-02-29', 3, null, 30)).toMatchObject({ source: 'COMPANY', days: 30, dueDate: '2024-03-30' });
    expect(paymentTermSuggestion('2024-02-29', null, null, null)).toMatchObject({ source: 'FALLBACK', days: 14, dueDate: '2024-03-14' });
  });
  it.each([
    ['2024-02-28', 1, '2024-02-29'], ['2024-02-29', 365, '2025-02-28'],
    ['2025-01-31', 30, '2025-03-02'], ['2026-12-31', 14, '2027-01-14'],
    ['2026-03-28', 2, '2026-03-30'], ['2026-10-24', 2, '2026-10-26'],
  ] as const)('adds calendar days across leap/month/year/DST boundaries: %s + %i', (date, days, due) => {
    for (const timezone of ['UTC', 'Europe/Berlin', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      process.env.TZ = timezone;
      expect(addPaymentCalendarDays(date, days)).toBe(due);
    }
  });
  it.each([-1, 366, 0.1, NaN, Infinity, '14', '', true, undefined, {}, []])('rejects invalid payment days %s', value => {
    expect(() => parsePaymentTermDays(value)).toThrow();
  });
  it.each([0, 14, 30, 365, null])('accepts strict integer or null %s', value => expect(parsePaymentTermDays(value)).toBe(value));
  it.each(['2023-02-29', '2024-02-30', '0000-01-01', '2026-1-01', '2026-10-22T00:00:00Z', ''])('rejects non-calendar input %s', value => expect(isPaymentBusinessDate(value)).toBe(false));
  it('renders PDF business dates without shifting a day in western or eastern timezones', () => {
    for (const timezone of ['UTC', 'Europe/Berlin', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      process.env.TZ = timezone;
      expect(formatPaymentBusinessDate('2024-02-29')).toBe('29.2.2024');
      expect(formatPaymentBusinessDate('2026-03-29')).toBe('29.3.2026');
      expect(formatPaymentBusinessDate('2026-10-25')).toBe('25.10.2026');
    }
    expect(formatPaymentBusinessDate('2023-02-29')).toBe('-');
    expect(formatPaymentBusinessDate()).toBe('-');
  });
  it('rejects out-of-range end dates instead of leaking extended ISO syntax', () => expect(() => addPaymentCalendarDays('9999-12-31', 1)).toThrow());
  it('detects stale company/customer/source changes without rejecting a conscious manual date', () => {
    const company = paymentTermSuggestion('2026-10-22', 5, null, 30);
    expect(() => assertCurrentPaymentTerm(company, null, 14)).toThrow(/geändert/);
    expect(() => assertCurrentPaymentTerm(company, 30, 30)).toThrow(/geändert/);
    expect(() => assertCurrentPaymentTerm(company, null, 30)).not.toThrow();
    const manual = validatePaymentTermSelection({ ...company, source: 'MANUAL', days: null, dueDate: '2027-01-20' });
    expect(() => assertCurrentPaymentTerm(manual, 0, 365)).not.toThrow();
    expect(() => assertPaymentTermDocument(manual, { invoiceDate: new Date('2026-10-22T00:00:00Z'), dueDate: '2027-01-20', customerId: 5 })).not.toThrow();
  });
  it('binds selected customer and actual invoice/due dates; manual null due remains explicit', () => {
    const selection = paymentTermSuggestion('2026-10-22', 5, 0, 30);
    expect(() => assertPaymentTermDocument(selection, { invoiceDate: '2026-10-22', dueDate: '2026-10-22', customerId: 6 })).toThrow();
    expect(() => assertPaymentTermDocument(selection, { invoiceDate: '2026-10-23', dueDate: '2026-10-22', customerId: 5 })).toThrow();
    expect(() => assertPaymentTermDocument(selection, { invoiceDate: '2026-10-22', dueDate: null, customerId: 5 })).toThrow();
    expect(validatePaymentTermSelection({ ...selection, source: 'MANUAL', days: null, dueDate: null })).toMatchObject({ source: 'MANUAL', dueDate: null });
  });
  it.each(['CUSTOMER', 'COMPANY', 'FALLBACK', 'MANUAL'])('rejects array-coerced source %s', source => {
    const valid = paymentTermSuggestion('2026-10-22', 5, 14);
    expect(() => validatePaymentTermSelection({ ...valid, source: [source] })).toThrow();
  });
  it('rejects forged source/version/days and unknown or missing fields', () => {
    const valid = paymentTermSuggestion('2026-10-22', 5, 30);
    for (const invalid of [
      { ...valid, version: 2 }, { ...valid, source: 'IMPORTED' }, { ...valid, source: 'FALLBACK' },
      { ...valid, source: 'MANUAL' }, { ...valid, customerId: null }, { ...valid, days: null },
      { ...valid, dueDate: '2026-10-22' }, { ...valid, customerId: '5' }, { ...valid, unknown: true },
    ]) expect(() => validatePaymentTermSelection(invalid)).toThrow();
    const { days: _days, ...missing } = valid;
    expect(() => validatePaymentTermSelection(missing)).toThrow();
    expect(validatePaymentTermSelection(valid)).toEqual(valid);
  });
});
