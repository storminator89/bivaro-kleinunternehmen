import { describe, expect, it } from 'vitest';
import { applicableDocumentTaxMode, hasUnsupportedDocumentTaxCategory, isSupportedDocumentTaxCase, preservedDocumentTaxMode, resolveDocumentTaxState, type DocumentFiscalSettings } from '@/lib/document-tax-profile';

const standard: DocumentFiscalSettings = { fiscalTaxRegime: 'STANDARD', fiscalEffectiveFrom: '2026-01-01', fiscalConfirmedAt: '2026-10-20T20:00:00Z' };
const small = { ...standard, fiscalTaxRegime: 'SMALL_BUSINESS' };

describe('document start: confirmed declaration and issue-date boundary', () => {
  it.each([null, {}, { fiscalTaxRegime: 'UNSET' }, { ...small, fiscalConfirmedAt: null }, { ...small, fiscalConfirmedAt: 'invalid' }, { ...small, fiscalTaxRegime: 'unknown' }, { ...small, fiscalEffectiveFrom: '2026-02-30' }])('never defaults missing, legacy or malformed settings %j to §19', settings => {
    expect(applicableDocumentTaxMode(settings, '2026-10-20')).toBe('');
    expect(resolveDocumentTaxState(settings, '2026-10-20', null, false).ready).toBe(false);
  });
  it('uses only a confirmed applicable profile; effective date is inclusive', () => {
    expect(applicableDocumentTaxMode(small, '2025-12-31')).toBe('');
    expect(applicableDocumentTaxMode(small, '2026-01-01')).toBe('small-business');
    expect(applicableDocumentTaxMode(standard, '2026-10-20')).toBe('standard');
    expect(applicableDocumentTaxMode(standard, '')).toBe('');
    expect(applicableDocumentTaxMode(standard, '2026-02-30')).toBe('');
  });
  it('does not apply a future declaration to a past issue date', () => {
    const future = { ...small, fiscalEffectiveFrom: '2027-01-01' };
    expect(resolveDocumentTaxState(future, '2026-12-31', null, false)).toMatchObject({ mode: '', ready: false });
    expect(resolveDocumentTaxState(future, '2027-01-01', null, false)).toMatchObject({ mode: 'small-business', ready: true });
  });
});

describe('explicit document decisions take precedence over company defaults', () => {
  it('requires both an explicit choice and separate acknowledgement with no profile', () => {
    const selection = { mode: 'small-business', source: 'manual' } as const;
    expect(resolveDocumentTaxState(null, '2026-10-20', null, true).ready).toBe(false);
    expect(resolveDocumentTaxState(null, '2026-10-20', selection, false)).toMatchObject({ mode: 'small-business', needsAcknowledgement: true, ready: false });
    expect(resolveDocumentTaxState(null, '2026-10-20', selection, true).ready).toBe(true);
  });
  it('requires acknowledgement when overriding the applicable company mode', () => {
    const selection = { mode: 'standard', source: 'manual' } as const;
    expect(resolveDocumentTaxState(small, '2026-10-20', selection, false).ready).toBe(false);
    expect(resolveDocumentTaxState(small, '2026-10-20', selection, true).ready).toBe(true);
    expect(resolveDocumentTaxState(standard, '2026-10-20', selection, false).ready).toBe(true);
  });
  it.each(['template', 'quote'] as const)('preserves explicit %s mode when a later profile disagrees or dates change', source => {
    const selection = { mode: 'standard', source } as const;
    expect(resolveDocumentTaxState(small, '2026-10-20', selection, false)).toMatchObject({ mode: 'standard', ready: true, source });
    expect(resolveDocumentTaxState(small, '2025-12-31', selection, false)).toMatchObject({ mode: 'standard', ready: true, source });
  });
  it('does not let a profile replace ambiguous legacy document treatment', () => {
    expect(resolveDocumentTaxState(small, '2026-10-20', { mode: '', source: 'quote' }, false)).toMatchObject({ mode: '', ready: false, source: 'quote' });
  });
  it('re-evaluates profile-derived dates, but keeps an explicit decision and acknowledgement', () => {
    expect(resolveDocumentTaxState(small, '2025-12-31', null, false).ready).toBe(false);
    expect(resolveDocumentTaxState(small, '2025-12-31', { mode: 'standard', source: 'manual' }, true)).toMatchObject({ mode: 'standard', ready: true });
  });
});

describe('legacy/template metadata and supported scope', () => {
  it('never infers small-business from 0%, but preserves explicitly saved modes', () => {
    expect(preservedDocumentTaxMode({ items: [{ taxRate: 0 }] })).toBe('');
    expect(preservedDocumentTaxMode({ items: [], taxMode: 'unknown' })).toBe('');
    expect(preservedDocumentTaxMode({ items: [{ taxRate: 0 }], taxMode: 'small-business' })).toBe('small-business');
    expect(preservedDocumentTaxMode({ items: [{ taxRate: 0 }], taxMode: 'standard' })).toBe('standard');
  });
  it('keeps existing taxable, exempt and zero-rate categories in the standard editor without mutating original items', () => {
    const items = Object.freeze([{ taxRate: 7 }, { taxRate: 0, taxCategory: 'E', exemptionReason: 'Bisheriger Grund' }, { taxRate: 0, taxCategory: 'Z' }]);
    expect(preservedDocumentTaxMode({ items })).toBe('standard');
    expect(items[1]).toEqual({ taxRate: 0, taxCategory: 'E', exemptionReason: 'Bisheriger Grund' });
  });
  it('blocks actual unsupported tax cases without banning all foreign-address domestic invoices', () => {
    expect(isSupportedDocumentTaxCase('reverse-charge', false, true)).toBe(false);
    expect(isSupportedDocumentTaxCase('cross-border', true, true)).toBe(false);
    expect(isSupportedDocumentTaxCase('domestic', false, false)).toBe(true);
    expect(isSupportedDocumentTaxCase('domestic', true, false)).toBe(false);
    expect(isSupportedDocumentTaxCase('domestic', true, true)).toBe(true);
  });
  it('does not silently reinterpret an unsupported imported tax category', () => {
    expect(hasUnsupportedDocumentTaxCategory([{ taxCategory: 'AE' }])).toBe(true);
    expect(hasUnsupportedDocumentTaxCategory([{ taxCategory: 'K' }])).toBe(true);
    expect(hasUnsupportedDocumentTaxCategory([{}, { taxCategory: 'E' }, { taxCategory: 'S' }, { taxCategory: 'Z' }])).toBe(false);
  });
});
