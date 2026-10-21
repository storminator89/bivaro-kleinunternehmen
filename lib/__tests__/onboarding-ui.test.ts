import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FiscalProfileSettings } from '@/components/onboarding/fiscal-profile-settings';
import { GettingStartedChecklist } from '@/components/onboarding/getting-started';
import { EMPTY_FISCAL_PROFILE } from '@/lib/fiscal-profile';

const fiscal = { fiscalTaxRegime: 'STANDARD' as const, fiscalEffectiveFrom: '2026-01-01', fiscalConfirmedAt: '2026-10-20T20:00:00.000Z' };

describe('onboarding server-rendered accessibility and copy', () => {
  it('starts with unknown regime, native radio controls and no invented effective date', () => {
    const html = renderToStaticMarkup(createElement(FiscalProfileSettings, { initialProfile: EMPTY_FISCAL_PROFILE }));
    expect(html).toContain('id="fiscal-profile"');
    expect((html.match(/type="radio"/gu) || []).length).toBe(3);
    expect(html).toMatch(/<input(?=[^>]*value="UNSET")(?=[^>]*checked="")[^>]*>/u);
    expect(html).not.toContain('type="date"');
    expect(html).toContain('nicht automatisch Kleinunternehmer');
    expect(html).toContain('keine Steuerberatung');
    expect(html).toContain('href="/help#steuerprofil"');
  });
  it('rehydrates saved standard regime and date while requiring a new deliberate confirmation', () => {
    const html = renderToStaticMarkup(createElement(FiscalProfileSettings, { initialProfile: fiscal }));
    expect(html).toMatch(/<input(?=[^>]*value="STANDARD")(?=[^>]*checked="")[^>]*>/u);
    expect(html).toContain('value="2026-01-01"');
    expect(html).toContain('type="checkbox"');
    expect(html).not.toMatch(/type="checkbox"[^>]*checked=""/u);
    expect(html).toContain('keine Änderung alter Belege');
  });
  it('points each incomplete start step to a real action without marking export done', () => {
    const html = renderToStaticMarkup(createElement(GettingStartedChecklist, { settings: {}, invoiceCount: 0, hasCustomer: false }));
    expect(html).toContain('0 von 3 Startschritten');
    expect(html).toContain('aria-current="step"');
    for (const href of ['/settings#company-settings', '/settings#fiscal-profile', '/customers', '/dashboard/invoices/new', '/help#export']) expect(html).toContain(`href="${href}"`);
    expect(html).toContain('keine Prüfung auf steuerliche oder rechtliche Vollständigkeit');
  });
  it('uses persisted evidence and keeps export/help accessible after the first invoice', () => {
    const html = renderToStaticMarkup(createElement(GettingStartedChecklist, { settings: { ...fiscal, companyName: 'Muster', companyAddress: 'Straße 1', taxNumber: '123' }, invoiceCount: 1, hasCustomer: true }));
    expect(html).toContain('3 von 3 Startschritten');
    expect(html).toContain('href="/help#export"');
    expect(html).not.toContain('<details open=""');
    expect(html).not.toContain('Einrichtung vollständig');
  });
});
