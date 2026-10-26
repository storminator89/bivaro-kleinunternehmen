import type { QueryClient } from '@tanstack/react-query';

/** Dispose only this retired dashboard's reads/cache, never a new owner's client. */
export async function disposeDashboardQueries(client: QueryClient): Promise<void> {
  const canceled = client.cancelQueries();
  // Clear synchronously; privacy must not wait for an old transport to settle.
  client.clear();
  await canceled;
}
