import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActionRow, dailyActionAmount } from '@/components/daily-actions/daily-actions-workspace';
import type { DailyAction } from '@/lib/daily-actions/contract';

const action: DailyAction = { id: 'invoice:7', kind: 'INVOICE_REVIEW', priority: 2, title: 'Zahlungsstand klären', reason: 'Historische Nachweise sind nicht eindeutig. Erst prüfen.', source: 'SOURCE-7', party: null, date: '2026-10-21', dateLabel: 'Fällig am', amountCents: null, amountLabel: 'Restbetrag ungeklärt', href: '/dashboard?tab=invoices&document=7', cta: 'Rechnung prüfen' };
describe('daily action presentation', () => {
  it('renders why/source/calendar date/unknown amount and an exactly named owned-workflow link', () => {
    const html = renderToStaticMarkup(createElement(ActionRow, { action, first: true }));
    for (const value of ['Zuerst prüfen', 'Historische Nachweise', 'SOURCE-7', '21.10.2026', 'Restbetrag ungeklärt', 'Nicht verfügbar', 'document=7', 'aria-label="Rechnung prüfen: SOURCE-7"']) expect(html).toContain(value);
    expect(html).not.toContain('0,00'); expect(html).toContain('dateTime="2026-10-21"');
  });
  it('keeps cent strings exact, including the large-number boundary, with no aggregate/forecast', () => {
    expect(dailyActionAmount('1')).toBe('0,01 €');
    expect(dailyActionAmount('0')).toBe('0,00 €');
    expect(dailyActionAmount('8000')).toBe('80,00 €');
    expect(dailyActionAmount('9007199254740991')).toBe('90.071.992.547.409,91 €');
    expect(dailyActionAmount(null)).toBe('Nicht verfügbar');
  });
});
