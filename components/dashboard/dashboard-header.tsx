"use client";

import { useEffect, useState } from "react";
import { RevenueIndicators } from "./revenue-indicators";
import type { RevenueIndicatorBasis } from "@/lib/revenue-indicators";
import { DashboardIcon } from "@/components/brand/dashboard-icon";
import { MetricCard } from "./metric-card";
import { ChevronDown, ChevronUp } from "lucide-react";

interface Activity {
  id: number | string;
  type: 'income' | 'expense';
  description: string;
  date: string;
  amount: number;
}

interface KpiData {
  revenueThisMonth: number;
  revenueThisYear: number;
  expensesThisMonth: number;
  openInvoices: number;
  openInvoicesReviewRequired?: number;
  totalRevenue: number;
  totalExpenses: number;
  recentActivities: Activity[];
  revenueBasis?: RevenueIndicatorBasis;
  yearComparison?: {
    currentYear: number;
    revenueThisYearToDate: number;
    expensesThisYearToDate: number;
    revenueLastYearToDate: number;
    expensesLastYearToDate: number;
    monthlyDataThisYear: { revenue: number; expenses: number; profit: number }[];
  };
}

interface DashboardHeaderProps {
  data: KpiData;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount);
}

export function DashboardHeader({ data }: DashboardHeaderProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  // Speichere den Zustand im localStorage
  useEffect(() => {
    // Initialisiere den Zustand beim ersten Laden
    const savedExpandedState = localStorage.getItem('dashboardExpanded');

    // Setze die Zustände basierend auf dem gespeicherten Wert oder Standardwert
    setIsExpanded(savedExpandedState !== null ? savedExpandedState === 'true' : true);
  }, []);

  // Berechne zusätzliche Metriken
  const reviewCount = data.openInvoicesReviewRequired ?? 0;
  const profit = data.totalRevenue - data.totalExpenses;
  const comparison = data.yearComparison;
  const revenue = comparison?.revenueThisYearToDate ?? data.totalRevenue;
  const expenses = comparison?.expensesThisYearToDate ?? data.totalExpenses;
  const period = comparison ? `${comparison.currentYear} bis heute` : 'Gesamtzeitraum';

  return (
    <div className="dashboard-summary">
      <div className="dashboard-metrics" aria-label="Finanzkennzahlen">
        <MetricCard title="Einnahmen" amount={revenue} icon="tile-incomes" period={period} previous={comparison?.revenueLastYearToDate} href="/dashboard?tab=incomes" series={comparison?.monthlyDataThisYear.map(month => month.revenue)} />
        <MetricCard title="Ausgaben" amount={expenses} icon="tile-expenses" tone="critical" period={period} previous={comparison?.expensesLastYearToDate} positiveIsGood={false} href="/dashboard?tab=expenses" series={comparison?.monthlyDataThisYear.map(month => month.expenses)} />
        <MetricCard title="Gewinn" amount={revenue - expenses} icon="tile-profit" period={period} previous={comparison ? comparison.revenueLastYearToDate - comparison.expensesLastYearToDate : undefined} href="/dashboard?tab=eur" />
        <MetricCard title="Offene Rechnungen" amount={data.openInvoices} icon="tile-open-invoices" tone="notice" period={reviewCount > 0 ? "Bestätigter offener Teilbetrag" : "Aktuell ausstehender Betrag"} href="/dashboard?tab=invoices" />
      </div>
      {reviewCount > 0 && <p role="status" className="rounded-lg border border-caution/40 bg-caution-surface p-3 text-sm text-caution-foreground">Der angezeigte offene Betrag enthält nur geprüfte Salden. {reviewCount} {reviewCount === 1 ? 'Rechnung mit ungeklärtem Zahlungsstand ist' : 'Rechnungen mit ungeklärtem Zahlungsstand sind'} nicht enthalten; der gesamte offene Betrag ist noch unbekannt.</p>}
      <section className="dashboard-context" aria-labelledby="dashboard-overview-title">
        <button type="button" className="dashboard-context-toggle" onClick={() => {
          const next = !isExpanded;
          setIsExpanded(next);
          localStorage.setItem('dashboardExpanded', String(next));
        }} aria-expanded={isExpanded} aria-controls="dashboard-overview-content">
          <span id="dashboard-overview-title" className="flex items-center gap-3"><DashboardIcon name="tile-limits" size={32} />Weitere Kennzahlen & Umsatzgrenzen</span>
          {isExpanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </button>
        {isExpanded && <div id="dashboard-overview-content" className="space-y-4">
          <dl className="dashboard-context-values">
            <div><DashboardIcon name="tile-incomes" className="context-artwork" size={32} /><dt>Einnahmen diesen Monat</dt><dd>{formatCurrency(data.revenueThisMonth)}</dd></div>
            <div><DashboardIcon name="tile-expenses" className="context-artwork" size={32} /><dt>Ausgaben diesen Monat</dt><dd>{formatCurrency(data.expensesThisMonth)}</dd></div>
            <div><DashboardIcon name="tile-profit" className="context-artwork" size={32} /><dt>Gewinn · Gesamtzeitraum</dt><dd>{formatCurrency(profit)}</dd></div>
          </dl>
          {data.revenueBasis ? <RevenueIndicators basis={data.revenueBasis} /> : <p className="rounded-lg border p-4 text-sm text-muted-foreground">Umsatzdatenbasis nicht verfügbar. Daraus wird kein Steuerstatus abgeleitet.</p>}

          </div>
        }
      </section>
    </div>
  );
}
