import { Suspense } from "react";
import { DashboardContent } from "@/components/dashboard/dashboard-content";
import { DashboardQueryProvider } from "@/components/dashboard/dashboard-query-provider";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";

export default function Dashboard() {
  return (
    <DashboardQueryProvider>
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </DashboardQueryProvider>
  );
}
