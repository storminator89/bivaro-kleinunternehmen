"use client";

import { useEffect, useState } from "react";
import { CollapsibleKpiCard } from "./collapsible-kpi-card";
import { DollarSign, CreditCard, Banknote, TrendingUp, TrendingDown, PieChart, ChevronDown, ChevronUp, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
  const [isExpanded, setIsExpanded] = useState(false);

  // Speichere den Zustand im localStorage
  useEffect(() => {
    // Initialisiere den Zustand beim ersten Laden
    const savedExpandedState = localStorage.getItem('dashboardExpanded');

    // Setze die Zustände basierend auf dem gespeicherten Wert oder Standardwert
    setIsExpanded(savedExpandedState !== null ? savedExpandedState === 'true' : true);
  }, []);

  // Speichere den Zustand im localStorage, wenn er sich ändert
  useEffect(() => {
    if (isExpanded !== undefined) {
      localStorage.setItem('dashboardExpanded', isExpanded.toString());
    }
  }, [isExpanded]);

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
      <Card className="bg-card border rounded-xl shadow-sm overflow-hidden">
        <div
          className="flex items-center justify-between cursor-pointer p-4"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <h2 className="text-lg font-semibold">Übersicht</h2>
          <Button variant="ghost" size="icon">
            {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </Button>
        </div>

        {isExpanded && (
          <div className="px-4 pb-4 space-y-6">
            {/* Kleinunternehmer-Status Tracker (Neue Regelung ab 2025) */}
            <div className="bg-muted/30 rounded-lg p-4 border">
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">Kleinunternehmer-Status 2025</span>
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
                <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${isOverPreviousYearLimit ? 'bg-red-500' : isCloseToYearlyLimit ? 'bg-amber-500' : 'bg-green-500'}`}
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
                <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${isOverHardLimit ? 'bg-red-500' : 'bg-blue-500'}`}
                    style={{ width: `${percentageHardLimit}%` }}
                  />
                </div>
              </div>

              <div className="mt-3 p-2 bg-background/50 rounded text-xs text-muted-foreground space-y-1">
                {isOverHardLimit ? (
                  <p className="text-red-500 font-medium">
                    ⚠️ ACHTUNG: Sie haben die 100.000 € Grenze überschritten! Sie sind ab dem Umsatz,
                    mit dem die Grenze überschritten wurde, SOFORT umsatzsteuerpflichtig.
                  </p>
                ) : isOverPreviousYearLimit ? (
                  <p className="text-amber-600 font-medium">
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

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <CollapsibleKpiCard
                title="Umsatz diesen Monat"
                value={formatCurrency(data.revenueThisMonth)}
                icon={<DollarSign className="h-5 w-5 text-green-500" />}
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
                icon={<CreditCard className="h-5 w-5 text-red-500" />}
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
                icon={<Banknote className="h-5 w-5 text-blue-500" />}
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

              <CollapsibleKpiCard
                title="Gesamtumsatz"
                value={formatCurrency(data.totalRevenue)}
                icon={<TrendingUp className="h-5 w-5 text-green-500" />}
              >
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Dieses Jahr</span>
                    <span className="text-sm font-medium">{formatCurrency(data.totalRevenue)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Letztes Jahr</span>
                    <span className="text-sm font-medium">-</span>
                  </div>
                </div>
              </CollapsibleKpiCard>

              <CollapsibleKpiCard
                title="Gesamtausgaben"
                value={formatCurrency(data.totalExpenses)}
                icon={<TrendingDown className="h-5 w-5 text-red-500" />}
              >
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Dieses Jahr</span>
                    <span className="text-sm font-medium">{formatCurrency(data.totalExpenses)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Letztes Jahr</span>
                    <span className="text-sm font-medium">-</span>
                  </div>
                </div>
              </CollapsibleKpiCard>

              <CollapsibleKpiCard
                title="Gewinn"
                value={formatCurrency(profit)}
                icon={<PieChart className="h-5 w-5 text-purple-500" />}
              >
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Marge</span>
                    <span className={`text-sm font-medium ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {profitMargin.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Vorjahr</span>
                    <span className="text-sm font-medium">-</span>
                  </div>
                </div>
              </CollapsibleKpiCard>
            </div>

            {/* Letzte Aktivitäten im Übersichtsbereich */}
            <div className="border rounded-lg">
              <div className="border-b p-4">
                <h3 className="font-semibold flex items-center">
                  <Activity className="h-5 w-5 mr-2 text-muted-foreground" />
                  Letzte Aktivitäten
                </h3>
              </div>
              <CardContent className="p-0">
                <div className="space-y-0">
                  {data.recentActivities.length > 0 ? (
                    data.recentActivities.slice(0, 5).map((activity) => (
                      <div key={`${activity.type}-${activity.id}`} className="flex items-center p-4 border-b last:border-b-0 hover:bg-muted/50 transition-colors">
                        <div className="flex-1">
                          <p className="text-sm font-medium leading-none">{activity.description}</p>
                          <p className="text-sm text-muted-foreground">{new Date(activity.date).toLocaleDateString('de-DE')}</p>
                        </div>
                        <div className={`text-right font-medium ${activity.type === 'income' ? 'text-green-600 dark:text-green-500' : 'text-red-600 dark:text-red-500'}`}>
                          {formatCurrency(activity.amount)}
                        </div>
                        <Badge variant={activity.type === 'income' ? 'default' : 'destructive'} className="ml-4">
                          {activity.type === 'income' ? 'Einnahme' : 'Ausgabe'}
                        </Badge>
                      </div>
                    ))
                  ) : (
                    <div className="p-8 text-center text-muted-foreground">
                      <p>Keine Aktivitäten vorhanden</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}