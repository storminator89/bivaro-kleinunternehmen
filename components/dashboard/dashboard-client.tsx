"use client";

import { useEffect, useState } from "react";
import { KpiCard } from "./kpi-card";
import { DollarSign, CreditCard, Banknote, TrendingUp, TrendingDown } from "lucide-react";
import { RecentActivity } from "./recent-activity";

interface KpiData {
  revenueThisMonth: number;
  expensesThisMonth: number;
  openInvoices: number;
  totalRevenue: number;
  totalExpenses: number;
  recentActivities: any[];
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount);
}

export function DashboardClient() {
  const [data, setData] = useState<KpiData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch("/api/dashboard/kpis");
        const kpiData = await res.json();
        setData(kpiData);
      } catch (error) {
        console.error("Failed to fetch KPI data", error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return <div>Lade Dashboard-Daten...</div>;
  }

  if (!data) {
    return <div>Fehler beim Laden der Daten.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <KpiCard title="Umsatz diesen Monat" value={formatCurrency(data.revenueThisMonth)} icon={<DollarSign className="h-4 w-4 text-muted-foreground" />} />
        <KpiCard title="Ausgaben diesen Monat" value={formatCurrency(data.expensesThisMonth)} icon={<CreditCard className="h-4 w-4 text-muted-foreground" />} />
        <KpiCard title="Offene Forderungen" value={formatCurrency(data.openInvoices)} icon={<Banknote className="h-4 w-4 text-muted-foreground" />} />
        <KpiCard title="Gesamtumsatz" value={formatCurrency(data.totalRevenue)} icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />} />
        <KpiCard title="Gesamtausgaben" value={formatCurrency(data.totalExpenses)} icon={<TrendingDown className="h-4 w-4 text-muted-foreground" />} />
      </div>
      <RecentActivity activities={data.recentActivities} />
    </div>
  );
}
