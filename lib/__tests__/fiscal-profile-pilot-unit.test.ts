import { describe, expect, it } from 'vitest';
import { EMPTY_FISCAL_PROFILE, isFiscalCalendarDate, readFiscalProfile, validateFiscalProfileInput } from '@/lib/fiscal-profile';

describe('pilot fiscal profile input contract', () => {
  it('keeps absent, legacy and unconfirmed rows unset without inference', () => {
    expect(readFiscalProfile()).toEqual(EMPTY_FISCAL_PROFILE);
    expect(readFiscalProfile({})).toEqual(EMPTY_FISCAL_PROFILE);
    expect(readFiscalProfile({ fiscalTaxRegime: 'SMALL_BUSINESS', fiscalEffectiveFrom: '2026-01-01' })).toEqual(EMPTY_FISCAL_PROFILE);
    expect(validateFiscalProfileInput({ companyName: 'Legacy company' })).toEqual({ ok: true, selection: undefined });
  });

  it.each(['SMALL_BUSINESS', 'STANDARD'])('accepts explicit %s selection with a valid date', (fiscalTaxRegime) => {
    const selection = { fiscalTaxRegime, fiscalEffectiveFrom: '2024-02-29' };
    expect(validateFiscalProfileInput(selection)).toEqual({ ok: true, selection });
    expect(readFiscalProfile({ ...selection, fiscalConfirmedAt: new Date('2026-10-20T12:00:00.000Z') })).toEqual({
      ...selection, fiscalConfirmedAt: '2026-10-20T12:00:00.000Z',
    });
  });

  it.each(['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-01', '2026-01-00', '2026-1-01', '1899-12-31', '2026-01-01T00:00:00Z', '', null, 2026])('rejects non-calendar date %s', (fiscalEffectiveFrom) => {
    expect(isFiscalCalendarDate(fiscalEffectiveFrom)).toBe(false);
    expect(validateFiscalProfileInput({ fiscalTaxRegime: 'STANDARD', fiscalEffectiveFrom })).toMatchObject({
      ok: false, fieldErrors: { fiscalEffectiveFrom: expect.any(String) },
    });
  });

  it.each(['small-business', 'AUTO', '', null, true, 1])('rejects an unsupported regime %s', (fiscalTaxRegime) => {
    expect(validateFiscalProfileInput({ fiscalTaxRegime, fiscalEffectiveFrom: '2026-01-01' })).toMatchObject({
      ok: false, fieldErrors: { fiscalTaxRegime: expect.any(String) },
    });
  });

  it('requires a complete explicit update and resets only explicitly', () => {
    expect(validateFiscalProfileInput({ fiscalTaxRegime: 'STANDARD' })).toMatchObject({ ok: false, fieldErrors: { fiscalEffectiveFrom: expect.any(String) } });
    expect(validateFiscalProfileInput({ fiscalEffectiveFrom: '2026-01-01' })).toMatchObject({ ok: false, fieldErrors: { fiscalTaxRegime: expect.any(String) } });
    expect(validateFiscalProfileInput({ fiscalTaxRegime: 'UNSET', fiscalEffectiveFrom: '2026-01-01' })).toMatchObject({ ok: false });
    expect(validateFiscalProfileInput({ fiscalTaxRegime: 'UNSET', fiscalEffectiveFrom: null })).toEqual({
      ok: true, selection: { fiscalTaxRegime: 'UNSET', fiscalEffectiveFrom: null },
    });
  });
});
