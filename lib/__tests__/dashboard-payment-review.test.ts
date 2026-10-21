import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DashboardHeader } from '@/components/dashboard/dashboard-header';
const data = { revenueThisMonth: 0, revenueThisYear: 0, expensesThisMonth: 0, openInvoices: 0, totalRevenue: 0, totalExpenses: 0, recentActivities: [] };
describe('ambiguous outstanding invoice dashboard subtotal', () => {
  it('does not present a verified zero subtotal as a known overall zero', () => {
    const html = renderToStaticMarkup(createElement(DashboardHeader, { data: { ...data, openInvoicesReviewRequired: 2 } }));
    expect(html).toContain('Bestätigter offener Teilbetrag');
    expect(html).toContain('role="status"');
    expect(html).toContain('Rechnungen mit ungeklärtem Zahlungsstand sind');
    expect(html).toContain('der gesamte offene Betrag ist noch unbekannt');
    expect(html).toContain('aria-label="Offene Rechnungen: 0,00');
  });
  it('retains the normal exact total without a review warning when all balances are known', () => {
    const html = renderToStaticMarkup(createElement(DashboardHeader, { data: { ...data, openInvoices: 80 } }));
    expect(html).toContain('Aktuell ausstehender Betrag');
    expect(html).not.toContain('der gesamte offene Betrag ist noch unbekannt');
  });
});
