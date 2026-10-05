"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { CollapsibleKpiCard } from "./collapsible-kpi-card";
import { DollarSign, CreditCard, Banknote, ChevronDown, ChevronUp, ArrowUpRight } from "lucide-react";

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
  totalRevenue: number;
  totalExpenses: number;
  recentActivities: Activity[];
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
  const profit = data.totalRevenue - data.totalExpenses;
  const profitMargin = data.totalRevenue > 0 ? (profit / data.totalRevenue) * 100 : 0;

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
    <div className="space-y-4">
      {/* Hauptüberschrift mit Ausklappfunktion */}
      <section aria-labelledby="dashboard-overview-title">
        <button
          type="button"
          className="finance-overview-toggle flex min-h-12 w-full items-center justify-between border-b border-border/80 py-3 text-left"
          onClick={() => {
            const next = !isExpanded;
            setIsExpanded(next);
            localStorage.setItem("dashboardExpanded", String(next));
          }}
          aria-expanded={isExpanded}
          aria-controls="dashboard-overview-content"
        >
          <span>
            <span id="dashboard-overview-title" className="block text-lg font-semibold">Finanzlage</span>
            <span className="mt-0.5 block text-sm font-normal text-muted-foreground">Kennzahlen, Grenzstatus und letzte Buchungen</span>
          </span>
          {isExpanded ? <ChevronUp className="h-5 w-5" aria-hidden="true" /> : <ChevronDown className="h-5 w-5" aria-hidden="true" />}
        </button>

        {isExpanded && (
          <div id="dashboard-overview-content" className="space-y-6 pt-6">
            <div className="dashboard-top-grid">
            <section className="finance-hero" aria-label="Finanzübersicht Gesamtzeitraum">
              <div className="finance-hero-primary">
                <p className="finance-eyebrow">Finanzübersicht · Gesamtzeitraum</p>
                <div className="mt-5 flex items-start justify-between gap-4"><div><h2 className="text-sm font-medium">Gewinn</h2><p className="finance-hero-value">{formatCurrency(profit)}</p></div><ArrowUpRight className="h-8 w-8" aria-hidden="true" /></div>
                <p className="finance-hero-note">Einnahmen minus Ausgaben <span>· {profitMargin.toLocaleString('de-DE', { maximumFractionDigits: 1 })} % Marge</span></p>
              </div>
              <dl className="finance-hero-accounts">
                <div><dt><span className="finance-dot" />Gesamtumsatz</dt><dd>{formatCurrency(data.totalRevenue)}</dd></div>
                <div><dt><span className="finance-dot finance-dot-expense" />Gesamtausgaben</dt><dd>{formatCurrency(data.totalExpenses)}</dd></div>
              </dl>
            </section>
            <div className="dashboard-month-metrics grid gap-4">
              <CollapsibleKpiCard
                title="Umsatz diesen Monat"
                value={formatCurrency(data.revenueThisMonth)}
                icon={<DollarSign className="h-5 w-5 text-positive" />}
              >
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Letzter Monat</span>
                    <span className="text-sm font-medium">-</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Prognose</span>
                    <span className="text-sm font-medium">-</span>
                  </div>
                </div>
              </CollapsibleKpiCard>

              <CollapsibleKpiCard
                title="Ausgaben diesen Monat"
                value={formatCurrency(data.expensesThisMonth)}
                icon={<CreditCard className="h-5 w-5 text-critical" />}
              >
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Letzter Monat</span>
                    <span className="text-sm font-medium">-</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Budget</span>
                    <span className="text-sm font-medium">-</span>
                  </div>
                </div>
              </CollapsibleKpiCard>

              <CollapsibleKpiCard
                title="Offene Forderungen"
                value={formatCurrency(data.openInvoices)}
                icon={<Banknote className="h-5 w-5 text-notice" />}
              >
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Fällig in 7 Tagen</span>
                    <span className="text-sm font-medium">-</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Überfällig</span>
                    <span className="text-sm font-medium">-</span>
                  </div>
                </div>
              </CollapsibleKpiCard>
            </div>

            </div>
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
        )}
      </section>
    </div>
  );
}
