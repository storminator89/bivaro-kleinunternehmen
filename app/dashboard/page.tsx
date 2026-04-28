import { Suspense } from "react";
import { DashboardContent } from "@/components/dashboard/dashboard-content";
import { DashboardQueryProvider } from "@/components/dashboard/dashboard-query-provider";

export default function Dashboard() {
  return (
    <DashboardQueryProvider>
      <Suspense fallback={<div>Loading...</div>}>
        <DashboardContent />
      </Suspense>
    </DashboardQueryProvider>
  );
}
