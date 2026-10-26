import { Suspense } from "react";
import { connection } from 'next/server';
import { ownerQuoteReleaseCaptureEnabled } from '@/lib/quote-release-owner-access';
import { DashboardContent } from "@/components/dashboard/dashboard-content";
import { DashboardQueryProvider } from "@/components/dashboard/dashboard-query-provider";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";

export default async function Dashboard() {
  // Resolve the server-only, default-disabled gate per request, not at build time.
  await connection();
  return (
    <DashboardQueryProvider>
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent ownerQuoteCaptureEnabled={ownerQuoteReleaseCaptureEnabled()} />
      </Suspense>
    </DashboardQueryProvider>
  );
}
