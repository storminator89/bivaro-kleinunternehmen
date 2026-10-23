import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DashboardOverview } from '@/components/dashboard/dashboard-overview';
import { DashboardHeader } from '@/components/dashboard/dashboard-header';
import { ActionRow } from '@/components/daily-actions/daily-actions-workspace';
import type { DailyAction } from '@/lib/daily-actions/contract';

const task: DailyAction = { id: 'invoice:7', kind: 'INVOICE_REVIEW', priority: 2, title: 'Zahlungsstand klären', reason: 'Historische Nachweise sind nicht eindeutig. Erst prüfen.', source: 'SOURCE-7', party: null, date: '2026-10-21', dateLabel: 'Fällig am', amountCents: null, amountLabel: 'Restbetrag ungeklärt', href: '/dashboard?tab=invoices&document=7', cta: 'Rechnung prüfen' };
const data = { revenueThisMonth: 30, revenueThisYear: 120, expensesThisMonth: 10, openInvoices: 80, totalRevenue: 120, totalExpenses: 20, recentActivities: [] };

describe('metric-led overview presentation', () => {
  it('keeps all four real metric links ahead of the independent task and analysis slots', () => {
    const html = renderToStaticMarkup(createElement(DashboardOverview, {
      summary: createElement(DashboardHeader, { data }),
      tasks: createElement('ul', null, createElement(ActionRow, { action: task, first: true })),
      analysis: createElement('section', { id: 'comparison-slot' }, 'Jahresvergleich'),
      showDataNote: true,
    }));
    expect(html.match(/class="dashboard-metric"/g)).toHaveLength(4);
    for (const href of ['incomes', 'expenses', 'eur', 'invoices']) expect(html).toContain(`href="/dashboard?tab=${href}"`);
    expect(html.indexOf('class="dashboard-metrics"')).toBeLessThan(html.indexOf('class="dashboard-overview-actions"'));
    expect(html.indexOf('class="dashboard-overview-actions"')).toBeLessThan(html.indexOf('id="comparison-slot"'));
    for (const value of ['120,00', '20,00', '100,00', '80,00', 'Zahlungsübersicht · steuerlich ungeprüft.', 'Historische Nachweise sind nicht eindeutig. Erst prüfen.', 'Restbetrag ungeklärt', 'Nicht verfügbar', 'aria-label="Rechnung prüfen: SOURCE-7"', 'document=7']) expect(html).toContain(value);
    expect(html).toContain('dashboard-overview-analysis');
    expect(html).not.toContain('dashboard-overview-grid-tasks-only');
  });

  it.each(['status', 'alert'])('keeps the complete task slot available beside a KPI %s without invented data', role => {
    const html = renderToStaticMarkup(createElement(DashboardOverview, {
      summary: createElement('p', { role }, role === 'status' ? 'Finanzübersicht wird geladen…' : 'Auswertung nicht verfügbar.'),
      tasks: createElement('ul', null, createElement(ActionRow, { action: task, first: true })),
    }));
    expect(html).toContain(`role="${role}"`);
    expect(html).toContain('dashboard-overview-grid-tasks-only');
    expect(html).toContain('Zahlungsstand klären');
    expect(html).toContain('document=7');
    expect(html).not.toContain('Zahlungsübersicht · steuerlich ungeprüft.');
    expect(html).not.toContain('0,00');
  });
});
