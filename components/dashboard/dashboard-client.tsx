"use client";

import { useEffect, useState } from "react";
import { DashboardHeader } from "./dashboard-header";

interface KpiData {
  revenueThisMonth: number;
  revenueThisYear: number;
  expensesThisMonth: number;
  openInvoices: number;
  totalRevenue: number;
  totalExpenses: number;
  recentActivities: any[];
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
    <DashboardHeader data={data} />
  );
}
