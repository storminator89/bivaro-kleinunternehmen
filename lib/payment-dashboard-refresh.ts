import type { QueryClient } from '@tanstack/react-query';

/** Payment is already saved. Propagate active list/summary refresh failures so
 * the dialog can offer a read-only refresh retry, never another payment POST.
 * Inactive lists remain invalidated and refetch when their tab is opened.
 */
export async function refreshPaymentDashboardLists(queryClient: QueryClient): Promise<void> {
  await Promise.all(['invoices', 'incomes', 'summary', 'assets', 'year-comparison', 'filter-options', 'reminders'].map(resource =>
    queryClient.invalidateQueries({ queryKey: ['dashboard', resource] }, { throwOnError: true }),
  ));
}
