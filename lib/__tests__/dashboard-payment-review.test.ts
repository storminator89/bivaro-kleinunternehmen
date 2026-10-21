import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DashboardHeader } from '@/components/dashboard/dashboard-header';
import { DashboardActivityFeed } from '@/components/dashboard/dashboard-activity-feed';
const data = { revenueThisMonth: 0, revenueThisYear: 0, expensesThisMonth: 0, openInvoices: 0, totalRevenue: 0, totalExpenses: 0, recentActivities: [] };
describe('ambiguous outstanding invoice dashboard subtotal', () => {
  it('distinguishes correction/refund activities as signed operational movements with journal links', () => {
    const html = renderToStaticMarkup(createElement(DashboardActivityFeed, { activities: [
      { id: 'correction:1', type: 'income', description: 'False receipt', date: '2026-10-20', amount: -40, movementKind: 'PAYMENT_CORRECTION', invoiceId: 7 },
      { id: 'refund:2', type: 'income', description: 'Actual payout', date: '2026-10-21', amount: -20, movementKind: 'CUSTOMER_REFUND', invoiceId: 7 },
    ] }));
    for (const value of ['Korrektur: nie erhalten', 'Erstattung: tatsächlich zurückgezahlt', 'href="/history?invoiceId=7"', '-40,00', '-20,00', 'activity-amount text-critical']) expect(html).toContain(value);
    expect(html).not.toContain('tab=incomes');
  });
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
