"use client";

import { useEffect, useState } from "react";
import { DashboardHeader } from "./dashboard-header";
import { DashboardActivityFeed } from "./dashboard-activity-feed";
import { YearComparison } from "./year-comparison";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

interface MonthlyData {
  month: number;
  monthName: string;
  revenue: number;
  expenses: number;
  profit: number;
}

interface YearComparisonData {
  currentYear: number;
  lastYear: number;
  revenueThisYearTotal: number;
  revenueLastYearTotal: number;
  expensesThisYearTotal: number;
  expensesLastYearTotal: number;
  revenueThisYearToDate: number;
  revenueLastYearToDate: number;
  expensesThisYearToDate: number;
  expensesLastYearToDate: number;
  monthlyDataThisYear: MonthlyData[];
  monthlyDataLastYear: MonthlyData[];
}

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
  yearComparison?: YearComparisonData;
}

export function DashboardClient() {
  const [data, setData] = useState<KpiData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    async function fetchData() {
      try {
        const res = await fetch("/api/dashboard/kpis", { signal: controller.signal });
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        const kpiData = await res.json();
        if (!controller.signal.aborted) setData(kpiData);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("Failed to fetch KPI data", error);
        setError("Die Dashboard-Auswertung konnte nicht geladen werden.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    fetchData();
    return () => controller.abort();
  }, [attempt]);

  if (loading) {
    return (
      <div role="status" aria-label="Finanzübersicht wird geladen" className="space-y-4">
        <span className="sr-only">Finanzübersicht wird geladen…</span>
        <Skeleton className="h-6 w-40" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => <div key={index} className="space-y-3 rounded-xl border bg-card p-5"><Skeleton className="h-4 w-28" /><Skeleton className="h-8 w-36" /></div>)}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-critical/40 bg-critical-surface p-6 text-sm text-critical-foreground" role="alert"><p>{error ?? "Fehler beim Laden der Daten."}</p><Button variant="outline" onClick={() => setAttempt(value => value + 1)}><RefreshCw className="h-4 w-4" aria-hidden="true" />Erneut laden</Button></div>;
  }

  return (
    <div className="space-y-6">
      <DashboardHeader data={data} />
      <div className="dashboard-analysis-grid">
      {data.yearComparison && (
        <YearComparison data={data.yearComparison} />
      )}
      <DashboardActivityFeed activities={data.recentActivities} />
      </div>
    </div>
  );
}
