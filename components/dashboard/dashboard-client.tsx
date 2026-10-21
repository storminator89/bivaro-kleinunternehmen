"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { YearComparisonData } from "@/types/dashboard";
import { DashboardHeader } from "./dashboard-header";
import { DashboardActivityFeed } from "./dashboard-activity-feed";
import { YearComparison } from "./year-comparison";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

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
  yearComparison?: YearComparisonData;
}

export function DashboardClient() {
  const [data, setData] = useState<KpiData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [comparisonYear, setComparisonYear] = useState<number | null>(null);
  const referenceYear = data?.yearComparison?.currentYear ?? new Date().getFullYear();
  const selectedYear = comparisonYear ?? referenceYear;
  const comparisonQuery = useQuery({
    queryKey: ['dashboard', 'year-comparison', selectedYear],
    queryFn: async ({ signal }): Promise<YearComparisonData> => {
      const response = await fetch(`/api/dashboard/kpis?year=${selectedYear}`, { signal, cache: "no-store" });
      if (!response.ok) throw new Error('Der Jahresvergleich konnte nicht geladen werden.');
      return (await response.json()).yearComparison;
    },
    enabled: !!data?.yearComparison && selectedYear !== referenceYear,
  });

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
        <div className="dashboard-metrics">{Array.from({length:4}, (_,index) => <Skeleton key={index} className="h-40 w-full rounded-xl" />)}</div>
        <div className="dashboard-analysis-grid"><Skeleton className="h-80 w-full rounded-xl" /><Skeleton className="h-80 w-full rounded-xl" /></div>
      </div>
    );
  }

  if (error || !data) {
    return <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-critical/40 bg-critical-surface p-6 text-sm text-critical-foreground" role="alert"><p>{error ?? "Fehler beim Laden der Daten."}</p><Button variant="outline" onClick={() => setAttempt(value => value + 1)}><RefreshCw className="h-4 w-4" aria-hidden="true" />Erneut laden</Button></div>;
  }

  return (
    <div className="dashboard-layout">
      <DashboardHeader data={data} />
      <div className="dashboard-analysis-grid">
      {data.yearComparison && (
        <YearComparison
          data={selectedYear === referenceYear ? data.yearComparison : comparisonQuery.data ?? data.yearComparison}
          selectedYear={selectedYear}
          maxYear={referenceYear}
          onYearChange={setComparisonYear}
          isLoading={selectedYear !== referenceYear && comparisonQuery.isFetching}
          error={selectedYear !== referenceYear && comparisonQuery.isError}
          onRetry={() => { void comparisonQuery.refetch(); }}
        />
      )}
      <DashboardActivityFeed activities={data.recentActivities} />
      </div>
    </div>
  );
}
