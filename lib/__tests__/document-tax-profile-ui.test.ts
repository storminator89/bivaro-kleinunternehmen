import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DocumentTaxProfileFields } from '@/components/dashboard/document-tax-profile-fields';

const base = { id: 'invoice', settings: null, issueDate: '2026-10-20', selection: null, acknowledged: false, onAcknowledged: vi.fn(), onModeChange: vi.fn(), taxCase: 'domestic' as const, onTaxCaseChange: vi.fn() };

describe('fiscal-start UI safety and accessible recovery', () => {
  it('shows a deliberate empty selection for unknown companies, not a selected §19 mode', () => {
    const html = renderToStaticMarkup(createElement(DocumentTaxProfileFields, base));
    expect(html).toMatch(/value=""[^>]*selected=""/);
    expect(html).not.toContain('value="small-business" selected=""');
    expect(html).toContain('Kein gültiges Steuerprofil');
    expect(html).toContain('for="invoice-tax-mode"');
    expect(html).toContain('id="invoice-tax-mode"');
    expect(html).toContain('Berechtigung und Leistungsort selbst prüfen');
  });
  it('opens settings separately so entered customer, date and item data stay in the editor', () => {
    const html = renderToStaticMarkup(createElement(DocumentTaxProfileFields, base));
    expect(html).toContain('href="/settings#fiscal-profile" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('Profiländerungen werden erst beim Öffnen eines neuen Dokuments übernommen');
    expect(html).not.toContain('<form');
  });
  it('requires a separate, initially unchecked document-specific acknowledgement', () => {
    const html = renderToStaticMarkup(createElement(DocumentTaxProfileFields, { ...base, selection: { mode: 'small-business', source: 'manual' } }));
    expect(html).toContain('id="invoice-tax-acknowledged"');
    expect(html).toContain('nur für dieses Dokument');
    expect(html).not.toContain('checked=""');
  });
  it('clearly blocks unsupported scope and does not call an ISO country the tax case', () => {
    const unsupported = renderToStaticMarkup(createElement(DocumentTaxProfileFields, { ...base, taxCase: 'reverse-charge' }));
    expect(unsupported).toContain('role="alert"');
    expect(unsupported).toContain('Vorschau und Erstellung sind gesperrt');
    const foreign = renderToStaticMarkup(createElement(DocumentTaxProfileFields, { ...base, foreignAddress: true, onDomesticConfirmed: vi.fn() }));
    expect(foreign).toContain('Eine ausländische Anschrift bestimmt den Steuerfall nicht allein');
    expect(foreign).toContain('id="invoice-domestic-confirmed"');
  });
  it('explains preserved template treatment rather than overwriting it from the company', () => {
    const html = renderToStaticMarkup(createElement(DocumentTaxProfileFields, { ...base, selection: { mode: 'standard', source: 'template' }, settings: { fiscalTaxRegime: 'SMALL_BUSINESS', fiscalEffectiveFrom: '2026-01-01', fiscalConfirmedAt: '2026-10-20T20:00:00Z' } }));
    expect(html).toContain('Steuerangaben aus der Vorlage bleiben erhalten');
    expect(html).toContain('value="standard" selected=""');
  });
});
