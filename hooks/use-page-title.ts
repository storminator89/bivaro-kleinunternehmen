"use client";

import { usePathname, useSearchParams } from "next/navigation";

const STATIC_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/dashboard/reminders": "Mahnwesen",
  "/dashboard/invoices/new": "Neue Rechnung",
  "/dashboard/quotes/new": "Neues Angebot",
  "/cashbook": "Kassenbuch",
  "/customers": "Kunden",
  "/settings": "Einstellungen",
  "/settings/api-keys": "API-Schlüssel",
  "/settings/api-keys/docs": "API-Dokumentation",
  "/settings/audit-logs": "Audit-Log",
  "/settings/documentation": "Dokumentation",
  "/steuer-simulation": "Steuer-Simulation",
  "/users": "Benutzerverwaltung",
};

const DASHBOARD_TAB_TITLES: Record<string, string> = {
  incomes: "Einnahmen",
  expenses: "Ausgaben",
  invoices: "Rechnungen",
  quotes: "Angebote",
  eur: "EÜR",
  gwg: "GWG-Verzeichnis",
  customers: "Kunden",
  reports: "Auswertungen",
};

export function usePageTitle(): string {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (pathname === "/dashboard") {
    const tab = searchParams.get("tab");
    if (tab && DASHBOARD_TAB_TITLES[tab]) return DASHBOARD_TAB_TITLES[tab];
    return "Dashboard";
  }

  return STATIC_TITLES[pathname] ?? "Bivaro";
}
