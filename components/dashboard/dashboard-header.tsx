"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
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

  // Kleinunternehmer-Limit Logik (Neue Regelung ab 01.01.2025)
  // Vorjahresgrenze: 25.000 € (war 22.000 €)
  // Laufendes Jahr: 100.000 € harte Grenze (war 50.000 € Prognose)
  // Bei Überschreitung der 100.000 € im laufenden Jahr: SOFORTIGE Steuerpflicht!
  const previousYearLimit = 25000; // Grenze für Vorjahresumsatz
  const currentYearLimit = 100000; // Harte Grenze für laufendes Jahr

  // Wir zeigen primär die Vorjahresgrenze, da diese für den Status relevant ist
  const percentage = Math.min(100, (data.revenueThisYear / previousYearLimit) * 100);
  const percentageHardLimit = Math.min(100, (data.revenueThisYear / currentYearLimit) * 100);

  const isCloseToYearlyLimit = percentage > 80;
  const isOverPreviousYearLimit = data.revenueThisYear > previousYearLimit;
  const isOverHardLimit = data.revenueThisYear > currentYearLimit; // Sofortige Steuerpflicht!

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
            {/* Kleinunternehmer-Status Tracker (Neue Regelung ab 2025) */}
            <details className="limit-disclosure rounded-xl border bg-card" open={isCloseToYearlyLimit || isOverHardLimit ? true : undefined}>
              <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4"><span className="text-sm font-semibold">Kleinunternehmer · Umsatzgrenzen</span><span className="flex items-center gap-2 text-xs text-muted-foreground">{isOverHardLimit ? 'Grenze überschritten' : isCloseToYearlyLimit ? 'Prüfung empfohlen' : 'Im Rahmen'}<ChevronDown className="h-4 w-4" aria-hidden="true" /></span></summary>
              <div className="border-t p-5">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-sm">Kleinunternehmer-Status</span>
                  <Badge
                    variant={isOverHardLimit ? "destructive" : isOverPreviousYearLimit ? "destructive" : isCloseToYearlyLimit ? "secondary" : "outline"}
                    className="text-xs"
                  >
                    {isOverHardLimit
                      ? "Sofort steuerpflichtig!"
                      : isOverPreviousYearLimit
                        ? "Nächstes Jahr steuerpflichtig"
                        : isCloseToYearlyLimit
                          ? "Grenze nähert sich"
                          : "Im Rahmen"}
                  </Badge>
                </div>
              </div>

              {/* Vorjahresgrenze (25.000 €) */}
              <div className="space-y-1 mb-3">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Vorjahresgrenze (für Folgejahr-Status)</span>
                  <span>{formatCurrency(data.revenueThisYear)} / {formatCurrency(previousYearLimit)}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className={`h-full ${isOverPreviousYearLimit ? 'bg-critical' : isCloseToYearlyLimit ? 'bg-caution' : 'bg-positive'}`}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>

              {/* Harte Grenze laufendes Jahr (100.000 €) */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Harte Grenze lfd. Jahr (sofortige Steuerpflicht)</span>
                  <span>{formatCurrency(data.revenueThisYear)} / {formatCurrency(currentYearLimit)}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className={`h-full ${isOverHardLimit ? 'bg-critical' : 'bg-notice'}`}
                    style={{ width: `${percentageHardLimit}%` }}
                  />
                </div>
              </div>

              <div className="mt-4 space-y-1 border-t border-border/80 pt-4 text-xs text-muted-foreground">
                {isOverHardLimit ? (
                  <p className="font-medium text-critical">
                    ⚠️ ACHTUNG: Sie haben die 100.000 € Grenze überschritten! Sie sind ab dem Umsatz,
                    mit dem die Grenze überschritten wurde, SOFORT umsatzsteuerpflichtig.
                  </p>
                ) : isOverPreviousYearLimit ? (
                  <p className="font-medium text-caution">
                    ⚠️ Hinweis: Sie haben die 25.000 € Vorjahresgrenze überschritten.
                    Ab dem nächsten Jahr sind Sie umsatzsteuerpflichtig (Regelbesteuerung).
                  </p>
                ) : (
                  <>
                    <p><strong>Neue Regelung seit 01.01.2025:</strong></p>
                    <p>• <strong>25.000 €</strong> Vorjahresgrenze – Überschreitung führt zur Steuerpflicht im Folgejahr</p>
                    <p>• <strong>100.000 €</strong> harte Grenze – Überschreitung führt zur <em>sofortigen</em> Steuerpflicht</p>
                    <p className="text-muted-foreground/70">Die Grenzen beziehen sich auf den Nettoumsatz.</p>
                  </>
                )}
              </div>
              </div>
            </details>

          </div>
        }
      </section>
    </div>
  );
}
