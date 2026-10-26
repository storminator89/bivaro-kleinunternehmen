"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSession } from 'next-auth/react';
import { reviewSessionKey } from '@/components/purchases/incoming-review-history';
import { disposeDashboardQueries } from '@/lib/dashboard-query-lifecycle';

export function DashboardQueryProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  // Expiry-only/session-object refetches intentionally retain the same key.
  // Ownership, role or sessionVersion replacement retires the entire subtree:
  // both its QueryClient and DashboardContent's drafts/dialogs/local leases.
  return <ScopedDashboardQueryProvider key={reviewSessionKey(session, status)}>{children}</ScopedDashboardQueryProvider>;
}

function ScopedDashboardQueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );
  useEffect(() => () => { void disposeDashboardQueries(queryClient).catch(() => {}); }, [queryClient]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
