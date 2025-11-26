"use client";

import { useEffect, useState } from "react";
import { DashboardHeader } from "./dashboard-header";
import { YearComparison } from "./year-comparison";

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

interface KpiData {
  revenueThisMonth: number;
  revenueThisYear: number;
  expensesThisMonth: number;
  openInvoices: number;
  totalRevenue: number;
  totalExpenses: number;
  recentActivities: any[];
  yearComparison?: YearComparisonData;
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
    <div className="space-y-6">
      <DashboardHeader data={data} />
      {data.yearComparison && (
        <YearComparison data={data.yearComparison} />
      )}
    </div>
  );
}
