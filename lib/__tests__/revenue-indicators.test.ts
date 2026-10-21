import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildRevenueIndicatorBasis, formatDeclaredTurnover } from '@/lib/revenue-indicators';
import { RevenueIndicators } from '@/components/dashboard/revenue-indicators';
import type { AnnualContextRevision } from '@/lib/annual-business-context';

const now = new Date('2026-10-21T08:00:00.000Z');
const row = (overrides: Partial<AnnualContextRevision> = {}): AnnualContextRevision => ({ version: 1, provenance: 'USER_DECLARED', revision: 1, declaredAt: '2026-10-20T08:00:00.000Z', contextYear: 2026, effectiveFrom: '2026-01-01', foundingYear: 2020, previousYearTurnoverCents: '2400000', previousYearExternalTurnoverCents: '1000000', completeness: 'COMPLETE', sourceNote: 'Eigene Jahresaufstellung', ...overrides });
const basis = (history: AnnualContextRevision[] = [], year = 2026) => buildRevenueIndicatorBasis({ year, history, now, inAppRevenue: 1234.56, previousYearInAppRevenue: 12000 });
const html = (history: AnnualContextRevision[] = [], year = 2026) => renderToStaticMarkup(createElement(RevenueIndicators, { basis: basis(history, year) }));

describe('read-only revenue indicators with explicit input coverage', () => {
  it('labels signed payment movements as operational, never fiscal approval', () => {
    const content = renderToStaticMarkup(createElement(RevenueIndicators, { basis: { ...basis(), inAppRevenue: -10 } }));
    for (const text of ['Operativer Zahlungssaldo in Bivaro', '-10,00', 'abzüglich Fehlerkorrekturen', 'tatsächlich dokumentierter Erstattungen', 'Steuerliche Zuordnung prüfpflichtig, nicht fachlich freigegeben', 'kein geprüfter Gesamtumsatz nach § 19 UStG']) expect(content).toContain(text);
    expect(content).not.toContain('Steuerrelevante, berücksichtigte Einnahmen');
  });
  it('distinguishes absent, partial and self-declared complete context without inferring current completeness', () => {
    expect(basis().context).toBeNull();
    expect(html()).toContain('Jahreskontext fehlt');
    expect(html([row({ completeness: 'PARTIAL', previousYearTurnoverCents: null })])).toContain('Teilweise selbst erklärt');
    const complete = html([row()]);
    expect(complete).toContain('Als vollständig selbst erklärt');
    expect(complete).toContain('Außerhalb Bivaro erfasste Umsätze 2026: unbekannt und nicht enthalten');
    expect(complete).toContain('Kein Steuerstatus');
    expect(basis([row()])).toMatchObject({ externalRevenue: null, businessTotal: null, inAppRevenue: 1234.56 });
  });
  it('never double-adds the included external share, prior declaration or in-app prior receipts', () => {
    const result = basis([row()]);
    expect(result.context?.previousYearTurnoverCents).toBe('2400000');
    expect(result.context?.previousYearExternalTurnoverCents).toBe('1000000');
    expect(result.inAppRevenue).toBe(1234.56);
    expect(result.previousYearInAppRevenue).toBe(12000);
    expect(html([row()])).toContain('24.000,00');
    expect(html([row()])).not.toContain('34.000,00');
    expect(html([row()])).toContain('wird nicht addiert');
  });
  it('keeps explicit zero, unknown and large exact cents distinct', () => {
    expect(formatDeclaredTurnover(null)).toBe('Unbekannt');
    expect(formatDeclaredTurnover('0')).toBe('0,00 €');
    expect(formatDeclaredTurnover('9999999999999999')).toBe('99.999.999.999.999,99 €');
    expect(html([row({ previousYearTurnoverCents: '0', previousYearExternalTurnoverCents: '0' })])).toContain('0,00 €');
  });
  it('applies only same-year effective revisions and does not refill corrected unknowns from older declarations', () => {
    const history = [row(), row({ revision: 2, effectiveFrom: '2026-10-21', previousYearTurnoverCents: null, completeness: 'PARTIAL', sourceNote: 'Korrektur' }), row({ revision: 3, effectiveFrom: '2026-12-01', previousYearTurnoverCents: '1' }), row({ revision: 4, contextYear: 2025, effectiveFrom: '2025-01-01' })];
    const before = structuredClone(history);
    expect(basis(history)).toMatchObject({ context: { revision: 2, previousYearTurnoverCents: null }, pendingRevision: 3 });
    expect(html(history)).toContain('Revision 2');
    expect(html(history)).toContain('Revision 3 liegt mit einem späteren Gültigkeitsdatum');
    expect(history).toEqual(before);
    expect(basis([row({ effectiveFrom: '2026-12-01' })]).context).toBeNull();
  });
  it('limits references to reviewed years, handles founding context and never assigns a tax status', () => {
    expect(basis().reference?.currentYear).toBeNull();
    expect(basis([row()]).reference?.currentYear).toBe(100000);
    expect(basis([row({ foundingYear: 2026, previousYearTurnoverCents: '0', previousYearExternalTurnoverCents: '0' })]).reference?.currentYear).toBe(25000);
    expect(basis([], 2024).reference).toBeNull();
    expect(basis([], 2027).reference).toBeNull();
    for (const content of [html(), html([row()]), html([row({ previousYearTurnoverCents: '2500001' })])]) {
      expect(content).not.toMatch(/Sofort steuerpflichtig|Nächstes Jahr steuerpflichtig|Im Rahmen/);
      expect(content).toContain('Steuerprofil, Rechnungen und Zahlungen bleiben unverändert');
    }
  });
  it('labels prior and current years, provenance, effective date, source and correction link accessibly', () => {
    const content = html([row({ sourceNote: '<img src=x onerror=alert(1)>' })]);
    expect(content).toContain('aria-label="Umsatzdatenbasis 2026"');
    expect(content).toContain('Vorjahr 2025');
    expect(content).toContain('Kontext gültig ab 2026-01-01');
    expect(content).toContain('nicht unabhängig geprüft');
    expect(content).toContain('&lt;img');
    expect(content).toContain('href="/settings#annual-context"');
  });
});
