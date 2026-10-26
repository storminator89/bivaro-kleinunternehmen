import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GettingStartedChecklist } from '@/components/onboarding/getting-started';

const company = { companyName: 'Muster', companyAddress: 'Straße 1', taxNumber: '123' };
const fiscal = { fiscalTaxRegime: 'STANDARD' as const, fiscalEffectiveFrom: '2026-01-01', fiscalConfirmedAt: '2026-10-20T20:00:00.000Z' };

describe('visible single next setup step with full checklist still available', () => {
  it.each([
    [{}, 0, false, '/settings#company-settings', 'Firmendaten ergänzen'],
    [{}, 1, true, '/settings#company-settings', 'Firmendaten ergänzen'],
    [company, 0, false, '/settings#fiscal-profile', 'Steuerprofil einrichten'],
    [{ ...company, ...fiscal, fiscalConfirmedAt: null }, 1, true, '/settings#fiscal-profile', 'Steuerprofil einrichten'],
    [{ ...company, ...fiscal }, 0, false, '/customers', 'Kunde anlegen'],
    [{ ...company, ...fiscal }, 0, true, '/dashboard/invoices/new', 'Erste Rechnung erstellen'],
  ] as const)('shows the actual next action for saved settings=%j, invoiceCount=%s, customer=%s', (settings, invoiceCount, hasCustomer, href, action) => {
    const html = renderToStaticMarkup(createElement(GettingStartedChecklist, { settings, invoiceCount, hasCustomer }));
    const visibleStep = html.split('<details')[0];
    expect(visibleStep).toContain('Nächster Einrichtungsschritt');
    expect(visibleStep).toContain(`href="${href}"`);
    expect(visibleStep).toContain(action);
    expect([...visibleStep.matchAll(/<a\b/g)]).toHaveLength(1);
    expect(html).not.toContain('<details open=""');
    for (const target of ['/settings#company-settings', '/settings#fiscal-profile', invoiceCount > 0 ? '/dashboard?tab=invoices' : '/dashboard/invoices/new', '/help#export']) expect(html).toContain(`href="${target}"`);
    expect(html).not.toContain('Einrichtung vollständig');
  });

  it('does not add a recurring setup CTA after persisted steps; export remains available', () => {
    const html = renderToStaticMarkup(createElement(GettingStartedChecklist, { settings: { ...company, ...fiscal }, invoiceCount: 1, hasCustomer: true }));
    expect(html).not.toContain('Nächster Einrichtungsschritt');
    expect(html).toContain('3 / 3 gespeichert');
    expect(html).toContain('href="/help#export"');
    expect(html).not.toContain('Einrichtung vollständig');
  });
});
