import { describe, expect, it } from 'vitest';
import { annualContextAppendAfter, readAnnualContextRevision, validateAnnualContext, validateAnnualContextHistory } from '@/lib/annual-business-context';

const base = { contextYear: 2026, effectiveFrom: '2026-01-01', foundingYear: 2020, previousYearTurnoverCents: null, previousYearExternalTurnoverCents: null, completeness: 'PARTIAL', sourceNote: 'Eigene Jahresaufstellung 2025' };
const revision = (overrides = {}) => ({ ...base, version: 1 as const, provenance: 'USER_DECLARED' as const, revision: 1, declaredAt: '2026-10-21T01:02:03.004Z', ...overrides });
describe('optional annual declarations, not a tax classification', () => {
  it('distinguishes explicit zero from unknown and never fabricates completeness', () => {
    expect(validateAnnualContext(base)).toMatchObject({ ok: true, data: { previousYearTurnoverCents: null } });
    expect(validateAnnualContext({ ...base, previousYearTurnoverCents: '0' })).toMatchObject({ ok: true, data: { previousYearTurnoverCents: '0' } });
    expect(validateAnnualContext({ ...base, completeness: 'COMPLETE' })).toMatchObject({ ok: false, fieldErrors: { completeness: expect.any(String) } });
    expect(validateAnnualContext({ ...base, completeness: 'COMPLETE', previousYearTurnoverCents: '0', previousYearExternalTurnoverCents: '0' })).toMatchObject({ ok: true });
    expect(validateAnnualContext({ ...base, foundingYear: null, completeness: 'COMPLETE', previousYearTurnoverCents: '0', previousYearExternalTurnoverCents: '0' })).toMatchObject({ ok: false });
  });
  it('does not infer the unknown total from a known external share', () => {
    expect(validateAnnualContext({ ...base, previousYearExternalTurnoverCents: '100' })).toMatchObject({ ok: true, data: { previousYearTurnoverCents: null, completeness: 'PARTIAL' } });
    expect(validateAnnualContext({ ...base, previousYearTurnoverCents: '99', previousYearExternalTurnoverCents: '100' })).toMatchObject({ ok: false, fieldErrors: { previousYearExternalTurnoverCents: expect.any(String) } });
  });
  it.each([null, [], { ...base, contextYear: 1900 }, { ...base, contextYear: 1.5 }, { ...base, effectiveFrom: '2026-02-30' }, { ...base, effectiveFrom: 'bad' }, { ...base, effectiveFrom: '2025-01-01' }, { ...base, foundingYear: 2027 }, { ...base, previousYearTurnoverCents: 0 }, { ...base, previousYearTurnoverCents: '-1' }, { ...base, previousYearTurnoverCents: '01' }, { ...base, sourceNote: '\nsecret' }, { ...base, sourceNote: 'x'.repeat(201) }])('rejects malformed or inconsistent context: %s', value => expect(validateAnnualContext(value).ok).toBe(false));
  it('handles founding year and year transition without projecting turnover backwards', () => {
    expect(validateAnnualContext({ ...base, foundingYear: 2026, previousYearTurnoverCents: '1' }).ok).toBe(false);
    expect(validateAnnualContext({ ...base, foundingYear: 2026, previousYearTurnoverCents: '0' }).ok).toBe(true);
    expect(validateAnnualContext({ ...base, contextYear: 2027, effectiveFrom: '2027-01-01', foundingYear: 2026, previousYearTurnoverCents: '1' }).ok).toBe(true);
  });
  it('strictly preserves revision history and provenance with canonical prefix comparison', () => {
    const source = validateAnnualContextHistory([revision()]);
    const existing = source.map(readAnnualContextRevision);
    expect(annualContextAppendAfter(existing, source)).toEqual([]);
    expect(annualContextAppendAfter(existing, [])).toEqual([]);
    expect(annualContextAppendAfter([], source)).toEqual(source);
    expect(() => annualContextAppendAfter(existing, validateAnnualContextHistory([revision({ sourceNote: 'Andere Quelle' })]))).toThrow(/Konflikt/);
    for (const value of [[revision({ revision: 2 })], [revision({ provenance: 'VERIFIED' })], [revision({ declaredAt: '2026-02-30T00:00:00.000Z' })], [revision({ userId: 'foreign' })], null]) expect(() => validateAnnualContextHistory(value)).toThrow();
  });
});
