import type { QueryClient } from '@tanstack/react-query';

export const PAYMENT_DASHBOARD_REFRESH_EVENT = 'bivaro:payment-dashboard-refresh';
const PAYMENT_REFRESH_CHANNEL = 'bivaro:payment-refresh:v2';
let channel: BroadcastChannel | null = null;
let connections = 0;
const remoteSubscribers = new Set<() => void>();
function remoteRefresh(event: MessageEvent) {
  if (event.data !== PAYMENT_DASHBOARD_REFRESH_EVENT || typeof window === 'undefined') return;
  // Remote/focus revalidation must never publish another signal.
  window.dispatchEvent(new Event(PAYMENT_DASHBOARD_REFRESH_EVENT));
  for (const refresh of remoteSubscribers) refresh();
}
/** Share one browser-only bridge; signals contain no account or payment data. */
export function connectPaymentRefreshBridge(onRemoteRefresh?: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  connections += 1;
  if (onRemoteRefresh) remoteSubscribers.add(onRemoteRefresh);
  if (!channel && typeof window.BroadcastChannel === 'function') {
    try { channel = new window.BroadcastChannel(PAYMENT_REFRESH_CHANNEL); channel.addEventListener('message', remoteRefresh); }
    catch { channel = null; /* focus/visibility revalidation remains mandatory */ }
  }
  let connected = true;
  return () => {
    if (!connected) return;
    connected = false;
    if (onRemoteRefresh) remoteSubscribers.delete(onRemoteRefresh);
    connections -= 1;
    if (connections === 0 && channel) {
      channel.removeEventListener('message', remoteRefresh); channel.close(); channel = null;
    }
  };
}
export function notifyPaymentDashboardRefresh(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PAYMENT_DASHBOARD_REFRESH_EVENT));
  if (typeof window.BroadcastChannel !== 'function') return;
  let sender: BroadcastChannel | null = null;
  try { sender = channel ?? new window.BroadcastChannel(PAYMENT_REFRESH_CHANNEL); sender.postMessage(PAYMENT_DASHBOARD_REFRESH_EVENT); }
  catch { /* A missed signal is covered by conservative focus/visibility reads. */ }
  finally { if (sender && sender !== channel) sender.close(); }
}

/** Payment is already saved. Propagate active list/summary refresh failures so
 * the dialog can offer a read-only refresh retry, never another payment POST.
 * Inactive lists remain invalidated and refetch when their tab is opened.
 */
export async function refreshPaymentDashboardLists(queryClient: QueryClient): Promise<void> {
  // DashboardClient owns a separate abort-safe KPI request outside QueryClient.
  // Notify even if one active list refresh fails; KPI errors stay visible there.
  notifyPaymentDashboardRefresh();
  await invalidatePaymentDashboardQueries(queryClient);
}
export async function invalidatePaymentDashboardQueries(queryClient: QueryClient): Promise<void> {
  await Promise.all(['invoices', 'incomes', 'expenses', 'summary', 'assets', 'year-comparison', 'filter-options', 'reminders'].map(resource =>
    queryClient.invalidateQueries({ queryKey: ['dashboard', resource] }, { throwOnError: true }),
  ));
}
