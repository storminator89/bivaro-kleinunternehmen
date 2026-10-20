import { describe, expect, it } from 'vitest';
import { EMPTY_FISCAL_PROFILE } from '@/lib/fiscal-profile';
import { fiscalSelectionPayload, getSetupProgress, isFiscalSelectionChanged } from '@/components/onboarding/setup-state';

const company = { companyName: 'Muster', companyAddress: 'Musterstraße 1, 10115 Berlin', taxNumber: '12/345/67890' };
const fiscal = { fiscalTaxRegime: 'SMALL_BUSINESS' as const, fiscalEffectiveFrom: '2026-01-01', fiscalConfirmedAt: '2026-10-20T20:00:00.000Z' };

describe('persisted onboarding progress', () => {
  it('starts legacy and empty settings without an assumed tax regime or completed steps', () => {
    expect(getSetupProgress({}, 0)).toMatchObject({ completed: 0, nextStep: 'company', fiscalComplete: false });
  });
  it('requires saved name, address and tax number rather than a settings visit', () => {
    expect(getSetupProgress({ ...company, taxNumber: ' ' }, 0).companyComplete).toBe(false);
    expect(getSetupProgress(company, 0)).toMatchObject({ completed: 1, nextStep: 'fiscal' });
  });
  it('does not count a selected tax regime without server confirmation', () => {
    expect(getSetupProgress({ ...company, ...fiscal, fiscalConfirmedAt: null }, 0).fiscalComplete).toBe(false);
    expect(getSetupProgress({ ...company, ...fiscal, fiscalEffectiveFrom: '2026-02-30' }, 0).fiscalComplete).toBe(false);
  });
  it('recognizes an explicitly confirmed standard profile without treating it as §19', () => {
    expect(getSetupProgress({ ...company, ...fiscal, fiscalTaxRegime: 'STANDARD' }, 0)).toMatchObject({ fiscalComplete: true, completed: 2, nextStep: 'invoice' });
  });
  it('counts first invoice only from a positive unfiltered stored total', () => {
    expect(getSetupProgress({ ...company, ...fiscal }, 0).invoiceComplete).toBe(false);
    expect(getSetupProgress({ ...company, ...fiscal }, Number.NaN).invoiceComplete).toBe(false);
    expect(getSetupProgress({ ...company, ...fiscal }, 4)).toMatchObject({ completed: 3, nextStep: 'export' });
  });
  it('does not declare setup complete merely because an invoice already exists', () => {
    expect(getSetupProgress({}, 1)).toMatchObject({ completed: 1, companyComplete: false, fiscalComplete: false, nextStep: 'company' });
  });
  it('resetting a fiscal declaration reopens the saved-profile step', () => {
    expect(getSetupProgress({ ...company, ...EMPTY_FISCAL_PROFILE }, 1)).toMatchObject({ fiscalComplete: false, completed: 2, nextStep: 'fiscal' });
  });
});

describe('independent fiscal settings form', () => {
  it('identifies unsaved selection/date changes and cancellation to the saved baseline', () => {
    expect(isFiscalSelectionChanged(fiscal, fiscal)).toBe(false);
    expect(isFiscalSelectionChanged(fiscal, { ...fiscal, fiscalTaxRegime: 'STANDARD' })).toBe(true);
    expect(isFiscalSelectionChanged(fiscal, { ...fiscal, fiscalEffectiveFrom: '2027-01-01' })).toBe(true);
    expect(isFiscalSelectionChanged(fiscal, { fiscalTaxRegime: fiscal.fiscalTaxRegime, fiscalEffectiveFrom: fiscal.fiscalEffectiveFrom })).toBe(false);
  });
  it('sends only regime/date, never client confirmation or company/logo values', () => {
    const payload = fiscalSelectionPayload({ ...fiscal, companyName: 'Do not send', logoUrl: '/logo' } as typeof fiscal);
    expect(payload).toEqual({ fiscalTaxRegime: 'SMALL_BUSINESS', fiscalEffectiveFrom: '2026-01-01' });
    expect(payload).not.toHaveProperty('fiscalConfirmedAt');
  });
  it('clears the effective date together with an explicit UNSET reset', () => {
    expect(fiscalSelectionPayload({ fiscalTaxRegime: 'UNSET', fiscalEffectiveFrom: '2026-01-01' })).toEqual({ fiscalTaxRegime: 'UNSET', fiscalEffectiveFrom: null });
  });
});
